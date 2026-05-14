/**
 * Global player state + a hidden <audio> element that survives page changes.
 *
 * Design:
 *   - One <audio> element rendered by PlayerProvider, controlled via a ref.
 *   - Queue is a flat array of Track. currentIndex = -1 means idle.
 *   - "Play this list from track N" replaces the queue + starts from N.
 *   - "ended" event triggers next(). When repeat='all' wraps to 0;
 *     repeat='one' replays current. When end of queue and repeat='off',
 *     pauses (browser default).
 *   - Shuffle: maintains a shuffledOrder index list. We always advance
 *     through shuffledOrder, not the raw queue. Toggling shuffle preserves
 *     current track's position in the new order.
 *
 * Persistence: not yet — refresh = empty queue. Easy to add later by
 * mirroring queue + currentIndex to localStorage.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { Track } from '../types';
import { usePrefs } from '../PrefsContext';
import { useRemote } from '../remote/RemoteContext';
import type { RemoteSnapshot, RemoteAction } from '../api';

export type RepeatMode = 'off' | 'one' | 'all';

/* -------------------- 10-band ISO equalizer -------------------- */
export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_GAIN_MIN = -12;
export const EQ_GAIN_MAX = 12;
export const EQ_PREAMP_MIN = -24;
export const EQ_PREAMP_MAX = 6;

export interface EQController {
  /** Center frequencies of each band, in Hz. */
  frequencies: number[];
  /** Per-band gain in dB. Length matches `frequencies`. */
  gains: number[];
  /** Pre-amp gain in dB (negative reduces output to prevent clipping). */
  preamp: number;
  /** When true, all filters are flattened (no audible effect). */
  bypass: boolean;
  setGain: (bandIndex: number, db: number) => void;
  setGains: (db: number[]) => void;
  setPreamp: (db: number) => void;
  setBypass: (b: boolean) => void;
  reset: () => void;
}

/* -------------------- Spatial / Cinema enhancer --------------------
 * Real convolution reverb (Web Audio's ConvolverNode) driven by IRs we
 * synthesize at runtime — no external files, no licensing. Each preset
 * uses a different decay length / envelope to evoke a particular space:
 *   - cinema: 1.8s, smoother decay, gentle bass lift
 *   - hall:   3.5s, longer tail, neutral EQ
 *   - club:   1.0s, dense early reflections, mild bass lift
 * Toggle button cycles through 'off' → cinema → hall → club → off. */
export type SpatialPreset = 'off' | 'cinema' | 'hall' | 'club';
export const SPATIAL_PRESETS: SpatialPreset[] = ['off', 'cinema', 'hall', 'club'];

export interface SpatialController {
  preset: SpatialPreset;
  setPreset: (p: SpatialPreset) => void;
  cycle: () => void;
}

export interface GlobalEQController {
  /** When true, all tracks use the same global EQ curve, ignoring
   *  per-track entries. The EQ panel toggles between this mode and
   *  per-track mode independently of the EQ on/off bypass. */
  enabled: boolean;
  setEnabled: (b: boolean) => void;
}

interface EQState {
  gains: number[];
  preamp: number;
  bypass: boolean;
}

function defaultEQState(): EQState {
  // New tracks start with EQ OFF — only takes effect after the user
  // explicitly engages it from the panel.
  return {
    gains: new Array(EQ_FREQUENCIES.length).fill(0),
    preamp: 0,
    bypass: true,
  };
}

function sanitizeEQ(j: any): EQState | null {
  if (!j || typeof j !== 'object') return null;
  if (
    !Array.isArray(j.gains) ||
    j.gains.length !== EQ_FREQUENCIES.length ||
    !j.gains.every((g: any) => Number.isFinite(g))
  ) {
    return null;
  }
  return {
    gains: j.gains.map((g: number) => clampDb(g, EQ_GAIN_MIN, EQ_GAIN_MAX)),
    preamp: clampDb(Number(j.preamp) || 0, EQ_PREAMP_MIN, EQ_PREAMP_MAX),
    bypass: Boolean(j.bypass),
  };
}

function clampDb(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(lo, Math.min(hi, v));
}

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/** Synthesize a stereo impulse response: white noise shaped by an
 *  exponential decay envelope. Decorrelating L/R (independent noise per
 *  channel) plus a tiny pre-delay on one channel gives a wide, natural
 *  reverb tail. predelaySec: silence at the head before reflections start
 *  (a few ms = small room, 30–80ms = hall). decayPow: how fast the tail
 *  fades — 2 = natural, higher = punchier/shorter feel. */
function synthIR(
  ctx: AudioContext,
  durationSec: number,
  predelaySec: number,
  decayPow: number,
): AudioBuffer {
  const sr = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sr * durationSec));
  const predelay = Math.max(0, Math.floor(sr * predelaySec));
  const buf = ctx.createBuffer(2, length, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    // Slightly different predelay per channel for stereo width.
    const channelPredelay = predelay + (ch === 1 ? Math.floor(sr * 0.004) : 0);
    for (let i = 0; i < length; i++) {
      if (i < channelPredelay) {
        data[i] = 0;
        continue;
      }
      const t = (i - channelPredelay) / Math.max(1, length - channelPredelay);
      const env = Math.pow(1 - t, decayPow);
      data[i] = (Math.random() * 2 - 1) * env;
    }
  }
  return buf;
}

interface SpatialPresetConfig {
  durationSec: number;
  predelaySec: number;
  decayPow: number;
  wet: number;       // 0..1, how loud the reverb mix is
  bassDb: number;    // cinema-style low-shelf lift
}

const SPATIAL_PRESET_CONFIG: Record<Exclude<SpatialPreset, 'off'>, SpatialPresetConfig> = {
  cinema: { durationSec: 1.8, predelaySec: 0.025, decayPow: 2.2, wet: 0.32, bassDb: 4 },
  hall:   { durationSec: 3.5, predelaySec: 0.05,  decayPow: 2.4, wet: 0.38, bassDb: 1.5 },
  club:   { durationSec: 1.0, predelaySec: 0.008, decayPow: 1.8, wet: 0.28, bassDb: 3 },
};

interface PlayerState {
  queue: Track[];
  /** Index into shuffledOrder if shuffle is on, else direct index into queue */
  cursor: number;            // -1 if idle
  shuffledOrder: number[];   // permutation of [0..queue.length-1] when shuffling
  isPlaying: boolean;
  position: number;          // seconds
  duration: number;          // seconds
  volume: number;            // 0..1
  shuffle: boolean;
  repeat: RepeatMode;
  currentPlaylistId: number | null;
}

export interface RestoreLocalSnapshot {
  queue: Track[];
  cursor: number;
  shuffledOrder: number[];
  position_sec: number;
  was_playing: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  current_playlist_id: number | null;
}

interface PlayerActions {
  /** Replace queue and start at the given index. */
  playList: (tracks: Track[], startIndex?: number, playlistId?: number) => void;
  /** Replace queue with a single track. */
  playOne: (track: Track) => void;
  /** Append to current queue (does not change current playback). */
  enqueue: (tracks: Track[]) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  /** Jump to absolute index in queue. */
  jumpTo: (queueIndex: number) => void;
  seek: (sec: number) => void;
  setVolume: (v: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  clearQueue: () => void;
  restoreLocalPlayback: (snap: RestoreLocalSnapshot) => void;
}

interface PlayerContextValue extends PlayerState, PlayerActions {
  /** The track currently playing, or null if idle. */
  current: Track | null;
  /** AnalyserNode for real-time visualizers. May be null until first play. */
  getAnalyser: () => AnalyserNode | null;
  /** 10-band parametric equalizer. */
  eq: EQController;
  /** Cinema/Dolby-style enhance toggle. */
  spatial: SpatialController;
  /** "Use one EQ curve for all tracks" mode. */
  globalEq: GlobalEQController;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be inside PlayerProvider');
  return ctx;
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Web Audio graph: source → preamp → [10 BiquadFilters] → analyser → destination
  // Lazily created on first user-gesture play (autoplay policy).
  // MediaElementSource can only be created ONCE per <audio>, so we memoize.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const eqFiltersRef = useRef<BiquadFilterNode[]>([]);
  const preampNodeRef = useRef<GainNode | null>(null);
  // Convolution reverb chain. Wet path (convolver) is mixed with dry
  // path via two gains; preset selection swaps the IR + tweaks gains
  // and the bass-shelf "cinema lift". IRs are cached once generated.
  const convolverRef = useRef<ConvolverNode | null>(null);
  const wetGainRef = useRef<GainNode | null>(null);
  const dryGainRef = useRef<GainNode | null>(null);
  const cinemaBassRef = useRef<BiquadFilterNode | null>(null);
  const irCacheRef = useRef<Map<SpatialPreset, AudioBuffer>>(new Map());

  // Prefs (server-synced): spatial_preset, global_eq_enabled, global_eq,
  // and the per-track EQ map all live in PrefsContext now.
  const { prefs, setPref, trackEqMap, setTrackEq } = usePrefs();

  const spatialPreset: SpatialPreset =
    SPATIAL_PRESETS.includes(prefs.spatial_preset as SpatialPreset)
      ? (prefs.spatial_preset as SpatialPreset)
      : 'off';
  const setSpatialPreset = useCallback(
    (p: SpatialPreset) => setPref('spatial_preset', p),
    [setPref],
  );

  const globalEqEnabled = !!prefs.global_eq_enabled;
  const globalEqState = useMemo<EQState>(() => {
    return sanitizeEQ(prefs.global_eq) ?? defaultEQState();
  }, [prefs.global_eq]);

  // Active EQ state — what the panel binds to and what's applied to the
  // audio graph. Source-of-truth depends on mode:
  //   global mode:  prefs.global_eq
  //   per-track:    trackEqMap[currentTrackId] || flat
  //
  // Local state lets the panel re-render snappily. Saves do NOT happen
  // through a useEffect on this state — that loops because PrefsContext
  // returns new object references after each save. Instead, the EQ
  // controller methods below explicitly write to the right destination
  // (global vs per-track) at the moment the user changes something.
  const [eqGains, setEqGains] = useState<number[]>(defaultEQState().gains);
  const [eqPreamp, setEqPreampState] = useState<number>(defaultEQState().preamp);
  const [eqBypass, setEqBypassState] = useState<boolean>(defaultEQState().bypass);
  const activeEQTrackIdRef = useRef<number | null>(null);
  // Refs mirror state for use inside controller methods that need the
  // *current* values to assemble a snapshot for save (closures over state
  // would capture stale values when multiple setters fire in a row).
  const eqGainsRef = useRef(eqGains);
  const eqPreampRef = useRef(eqPreamp);
  const eqBypassRef = useRef(eqBypass);
  useEffect(() => { eqGainsRef.current = eqGains; }, [eqGains]);
  useEffect(() => { eqPreampRef.current = eqPreamp; }, [eqPreamp]);
  useEffect(() => { eqBypassRef.current = eqBypass; }, [eqBypass]);

  // Apply current spatial preset whenever it changes (or once the graph
  // exists). Generates and caches the IR on first use of each preset.
  useEffect(() => {
    const ctx = audioCtxRef.current;
    const conv = convolverRef.current;
    const dry = dryGainRef.current;
    const wet = wetGainRef.current;
    const bass = cinemaBassRef.current;
    if (!ctx || !conv || !dry || !wet || !bass) return;

    const t0 = ctx.currentTime;
    if (spatialPreset === 'off') {
      // Smooth fade to fully dry, no bass lift.
      wet.gain.linearRampToValueAtTime(0, t0 + 0.06);
      dry.gain.linearRampToValueAtTime(1, t0 + 0.06);
      bass.gain.linearRampToValueAtTime(0, t0 + 0.06);
      return;
    }
    const cfg = SPATIAL_PRESET_CONFIG[spatialPreset];
    let ir = irCacheRef.current.get(spatialPreset);
    if (!ir) {
      ir = synthIR(ctx, cfg.durationSec, cfg.predelaySec, cfg.decayPow);
      irCacheRef.current.set(spatialPreset, ir);
    }
    conv.buffer = ir;
    wet.gain.linearRampToValueAtTime(cfg.wet, t0 + 0.06);
    // Slight dry attenuation so total perceived loudness stays steady
    // when the wet signal is added in.
    dry.gain.linearRampToValueAtTime(0.85, t0 + 0.06);
    bass.gain.linearRampToValueAtTime(cfg.bassDb, t0 + 0.06);
  }, [spatialPreset]);

  // Apply current EQ state to the audio graph whenever it changes (also
  // re-runs when the graph is created, since filters start empty). Save
  // happens elsewhere — in the controller methods below — so this effect
  // is one-way (state → graph) and can never feed back into save.
  useEffect(() => {
    const filters = eqFiltersRef.current;
    if (filters.length > 0) {
      for (let i = 0; i < filters.length; i++) {
        filters[i].gain.value = eqBypass ? 0 : eqGains[i] ?? 0;
      }
    }
    if (preampNodeRef.current) {
      preampNodeRef.current.gain.value = dbToLinear(eqBypass ? 0 : eqPreamp);
    }
  }, [eqGains, eqPreamp, eqBypass]);

  /**
   * Save the current EQ state to the right destination based on mode.
   * Called by the controller setters below — never by an effect, so we
   * don't accidentally echo loads back to the server.
   */
  const saveActiveEqState = useCallback(
    (state: EQState) => {
      if (globalEqEnabled) {
        setPref('global_eq', state);
      } else {
        const id = activeEQTrackIdRef.current;
        if (id != null) setTrackEq(id, state);
      }
    },
    [globalEqEnabled, setPref, setTrackEq],
  );

  function ensureAudioGraph() {
    if (audioCtxRef.current) {
      audioCtxRef.current.resume().catch(() => {});
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    try {
      const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      const ctx = new Ctx();
      const source = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;

      // Pre-amp (dB → linear gain)
      const preamp = ctx.createGain();
      preamp.gain.value = dbToLinear(eqBypass ? 0 : eqPreamp);

      // 10-band filter chain. Lowest = lowshelf, highest = highshelf, rest = peaking.
      const filters: BiquadFilterNode[] = [];
      for (let i = 0; i < EQ_FREQUENCIES.length; i++) {
        const f = ctx.createBiquadFilter();
        if (i === 0) f.type = 'lowshelf';
        else if (i === EQ_FREQUENCIES.length - 1) f.type = 'highshelf';
        else f.type = 'peaking';
        f.frequency.value = EQ_FREQUENCIES[i];
        f.Q.value = 1.4; // moderate Q for natural sound
        f.gain.value = eqBypass ? 0 : eqGains[i] ?? 0;
        filters.push(f);
      }

      // Spatial chain (parallel dry + convolved wet):
      //   eq output ─┬─ dryGain ──────────────┐
      //              └─ convolver → wetGain ──┴→ cinemaBass → analyser
      const dryGain = ctx.createGain();
      const wetGain = ctx.createGain();
      const convolver = ctx.createConvolver();
      const cinemaBass = ctx.createBiquadFilter();
      cinemaBass.type = 'lowshelf';
      cinemaBass.frequency.value = 110;
      cinemaBass.gain.value = 0;
      dryGain.gain.value = 1;
      wetGain.gain.value = 0;

      // Wire: source → preamp → eq filters → split into dry + wet
      source.connect(preamp);
      let prev: AudioNode = preamp;
      for (const f of filters) {
        prev.connect(f);
        prev = f;
      }
      prev.connect(dryGain);
      prev.connect(convolver);
      convolver.connect(wetGain);
      dryGain.connect(cinemaBass);
      wetGain.connect(cinemaBass);
      cinemaBass.connect(analyser);
      analyser.connect(ctx.destination);

      convolverRef.current = convolver;
      dryGainRef.current = dryGain;
      wetGainRef.current = wetGain;
      cinemaBassRef.current = cinemaBass;

      // Apply the current spatial preset to the freshly-built graph.
      // The [spatialPreset] effect only fires when the preset CHANGES, so
      // a preset persisted from a previous session (or set by the user
      // before they hit play) would otherwise sit in state without ever
      // touching the audio graph.
      if (spatialPreset !== 'off') {
        const cfg = SPATIAL_PRESET_CONFIG[spatialPreset];
        let ir = irCacheRef.current.get(spatialPreset);
        if (!ir) {
          ir = synthIR(ctx, cfg.durationSec, cfg.predelaySec, cfg.decayPow);
          irCacheRef.current.set(spatialPreset, ir);
        }
        convolver.buffer = ir;
        wetGain.gain.value = cfg.wet;
        dryGain.gain.value = 0.85;
        cinemaBass.gain.value = cfg.bassDb;
      }

      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      sourceRef.current = source;
      eqFiltersRef.current = filters;
      preampNodeRef.current = preamp;
    } catch (err) {
      console.warn('audio graph init failed:', err);
    }
  }

  const [queue, setQueue] = useState<Track[]>([]);
  const [cursor, setCursor] = useState(-1);
  const [shuffledOrder, setShuffledOrder] = useState<number[]>([]);
  const [currentPlaylistId, setCurrentPlaylistId] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  // Volume is persisted to localStorage so it survives refresh.
  const [volume, setVolumeState] = useState<number>(() => {
    if (typeof window === 'undefined') return 0.9;
    const raw = window.localStorage.getItem('mw.volume');
    const v = raw == null ? NaN : Number(raw);
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.9;
  });
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>('off');

  // Persist volume changes
  useEffect(() => {
    try {
      window.localStorage.setItem('mw.volume', String(volume));
    } catch {
      /* private mode / quota */
    }
  }, [volume]);

  // Resolve current queue index (handles shuffle indirection)
  const currentQueueIndex = useMemo(() => {
    if (cursor < 0) return -1;
    return shuffle ? shuffledOrder[cursor] ?? -1 : cursor;
  }, [cursor, shuffle, shuffledOrder]);

  const current: Track | null =
    currentQueueIndex >= 0 ? queue[currentQueueIndex] ?? null : null;

  // Remote control context — must be declared before any effect that
  // reads remote.* in its dep array (e.g. the audio src sync below),
  // otherwise we hit a TDZ during render.
  const remote = useRemote();

  // Optimistic volume + effects state while in remote mode. A controlled
  // <input type=range> whose `value` only updates after a host round-trip
  // can't follow the user's finger during a drag — the thumb sticks at
  // the snapshot's current value and the user gives up. So for every
  // remote-control surface (volume, spatial preset, EQ bands, EQ preamp,
  // EQ bypass, global-EQ toggle) we mirror the user's input locally,
  // fire the RPC, and only clear the override once the host snapshot
  // catches up. This is what makes EQ sliders actually draggable on the
  // phone instead of snapping back to a stale value.
  const [remoteVolumeOpt, setRemoteVolumeOpt] = useState<number | null>(null);
  const [optSpatial, setOptSpatial] = useState<SpatialPreset | null>(null);
  const [optGlobalEqEnabled, setOptGlobalEqEnabled] = useState<boolean | null>(null);
  const [optEqGains, setOptEqGains] = useState<number[] | null>(null);
  const [optEqPreamp, setOptEqPreamp] = useState<number | null>(null);
  const [optEqBypass, setOptEqBypass] = useState<boolean | null>(null);

  useEffect(() => {
    const sv = remote.hostSnapshot?.volume;
    if (typeof sv !== 'number') return;
    setRemoteVolumeOpt((opt) => {
      if (opt == null) return null;
      // 0.015 covers one 0.01 slider step plus a hair of float drift.
      return Math.abs(opt - sv) < 0.015 ? null : opt;
    });
  }, [remote.hostSnapshot?.volume]);

  useEffect(() => {
    const v = remote.hostSnapshot?.effects?.spatial_preset;
    if (v == null) return;
    setOptSpatial((opt) => (opt != null && opt === v ? null : opt));
  }, [remote.hostSnapshot?.effects?.spatial_preset]);

  useEffect(() => {
    const v = remote.hostSnapshot?.effects?.global_eq_enabled;
    if (v == null) return;
    setOptGlobalEqEnabled((opt) => (opt != null && opt === v ? null : opt));
  }, [remote.hostSnapshot?.effects?.global_eq_enabled]);

  useEffect(() => {
    const sg = remote.hostSnapshot?.effects?.eq_state?.gains;
    if (!sg) return;
    setOptEqGains((opt) => {
      if (!opt) return null;
      if (opt.length !== sg.length) return opt;
      const match = opt.every((g, i) => Math.abs(g - sg[i]) < 0.05);
      return match ? null : opt;
    });
  }, [remote.hostSnapshot?.effects?.eq_state?.gains]);

  useEffect(() => {
    const sp = remote.hostSnapshot?.effects?.eq_state?.preamp;
    if (typeof sp !== 'number') return;
    setOptEqPreamp((opt) => {
      if (opt == null) return null;
      return Math.abs(opt - sp) < 0.05 ? null : opt;
    });
  }, [remote.hostSnapshot?.effects?.eq_state?.preamp]);

  useEffect(() => {
    const sb = remote.hostSnapshot?.effects?.eq_state?.bypass;
    if (typeof sb !== 'boolean') return;
    setOptEqBypass((opt) => (opt != null && opt === sb ? null : opt));
  }, [remote.hostSnapshot?.effects?.eq_state?.bypass]);

  // Sync <audio> src whenever current track changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (remote.isRemote) {
      audio.pause();
      return;
    }
    if (current) {
      if (audio.src !== current.url) {
        audio.src = current.url;
      }
      // playList / playOne are user gestures (button clicks) so the
      // AudioContext can be safely created here too.
      ensureAudioGraph();
      audio.play().catch(() => {
        // Autoplay blocked — user gesture required first time.
        // We surface isPlaying=false until user clicks play.
        setIsPlaying(false);
      });
    } else {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
  }, [current, remote.isRemote]);

  // Load EQ when the playing track changes OR when we toggle global mode.
  //   - global mode: always show the prefs.global_eq curve
  //   - per-track:   load trackEqMap[id] || flat
  // No save flag needed — saves are explicit in the controller setters,
  // not in the apply effect, so loading here can't loop.
  useEffect(() => {
    const id = current?.id ?? null;
    activeEQTrackIdRef.current = id;
    let next: EQState;
    if (globalEqEnabled) {
      // Global mode is always engaged — bypass=false is locked in until
      // the user switches back to per-track mode. The Off button in the
      // panel is also disabled to reflect this.
      next = { ...globalEqState, bypass: false };
    } else {
      next = (id != null && trackEqMap[id]) || defaultEQState();
    }
    setEqGains(next.gains);
    setEqPreampState(next.preamp);
    setEqBypassState(next.bypass);
  }, [current?.id, globalEqEnabled, globalEqState, trackEqMap]);

  // Volume binding
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // Audio event listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => setPosition(audio.currentTime || 0);
    const onMeta = () => setDuration(audio.duration || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      // Hand off to the latest closure of next() via a ref-stored callback
      handleEndedRef.current?.();
    };

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  // Stable next() needs current closure of state. We expose it via a ref
  // that 'ended' handler reads, to avoid re-binding listeners every render.
  const handleEndedRef = useRef<(() => void) | null>(null);

  const playList = useCallback(
    (tracks: Track[], startIndex = 0, playlistId?: number) => {
      if (tracks.length === 0) return;
      const safeStart = Math.max(0, Math.min(startIndex, tracks.length - 1));
      setQueue(tracks);
      setCurrentPlaylistId(playlistId ?? null);
      if (shuffle) {
        // Build new shuffled order; place safeStart first so user hears that one
        const others = Array.from({ length: tracks.length }, (_, i) => i).filter(
          (i) => i !== safeStart,
        );
        setShuffledOrder([safeStart, ...shuffleArray(others)]);
        setCursor(0);
      } else {
        setShuffledOrder([]);
        setCursor(safeStart);
      }
    },
    [shuffle],
  );

  const playOne = useCallback((track: Track) => {
    setQueue([track]);
    setShuffledOrder([]);
    setCursor(0);
    setCurrentPlaylistId(null);
  }, []);

  const enqueue = useCallback(
    (tracks: Track[]) => {
      if (tracks.length === 0) return;
      setQueue((q) => {
        const newQ = [...q, ...tracks];
        if (shuffle) {
          const newIndices = Array.from({ length: tracks.length }, (_, i) => q.length + i);
          setShuffledOrder((order) => [...order, ...shuffleArray(newIndices)]);
        }
        return newQ;
      });
    },
    [shuffle],
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      // First-gesture play is the right moment to spin up the audio graph
      ensureAudioGraph();
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, []);

  const next = useCallback(() => {
    if (queue.length === 0) return;
    const order = shuffle ? shuffledOrder : queue.map((_, i) => i);
    if (order.length === 0) return;
    const i = shuffle ? cursor : currentQueueIndex;
    if (i < 0) return;
    if (repeat === 'one') {
      // Restart current
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
      return;
    }
    if (i >= order.length - 1) {
      if (repeat === 'all') {
        if (shuffle) setCursor(0);
        else setCursor(0);
      } else {
        // End — pause
        audioRef.current?.pause();
      }
      return;
    }
    setCursor((c) => c + 1);
  }, [queue, shuffle, shuffledOrder, cursor, currentQueueIndex, repeat]);

  const prev = useCallback(() => {
    if (queue.length === 0) return;
    const audio = audioRef.current;
    // If we're more than 3s in, restart current rather than go to previous
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    setCursor((c) => Math.max(0, c - 1));
  }, [queue]);

  const jumpTo = useCallback(
    (qIndex: number) => {
      if (qIndex < 0 || qIndex >= queue.length) return;
      if (shuffle) {
        const orderIdx = shuffledOrder.indexOf(qIndex);
        if (orderIdx >= 0) setCursor(orderIdx);
      } else {
        setCursor(qIndex);
      }
    },
    [queue.length, shuffle, shuffledOrder],
  );

  const seek = useCallback((sec: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = sec;
  }, []);

  const setVolume = useCallback((v: number) => {
    setVolumeState(Math.max(0, Math.min(1, v)));
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffle((s) => {
      const next = !s;
      // Build a new shuffled order keeping current track first
      if (next && queue.length > 0) {
        const cur = currentQueueIndex >= 0 ? currentQueueIndex : 0;
        const others = Array.from({ length: queue.length }, (_, i) => i).filter(
          (i) => i !== cur,
        );
        setShuffledOrder([cur, ...shuffleArray(others)]);
        setCursor(0);
      } else {
        // Turning shuffle off — set cursor to absolute queue index
        setShuffledOrder([]);
        if (currentQueueIndex >= 0) setCursor(currentQueueIndex);
      }
      return next;
    });
  }, [queue.length, currentQueueIndex]);

  const cycleRepeat = useCallback(() => {
    setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off'));
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
    setShuffledOrder([]);
    setCursor(-1);
  }, []);

  // Wire 'ended' → next/repeat handler (uses freshest state)
  useEffect(() => {
    handleEndedRef.current = () => {
      next();
    };
  }, [next]);

  const eqController: EQController = {
    frequencies: EQ_FREQUENCIES,
    gains: eqGains,
    preamp: eqPreamp,
    bypass: eqBypass,
    setGain: (i, db) => {
      const v = clampDb(db, EQ_GAIN_MIN, EQ_GAIN_MAX);
      const next = eqGainsRef.current.map((g, j) => (j === i ? v : g));
      setEqGains(next);
      saveActiveEqState({
        gains: next,
        preamp: eqPreampRef.current,
        bypass: eqBypassRef.current,
      });
    },
    setGains: (db) => {
      if (!Array.isArray(db) || db.length !== EQ_FREQUENCIES.length) return;
      const next = db.map((d) => clampDb(d, EQ_GAIN_MIN, EQ_GAIN_MAX));
      setEqGains(next);
      saveActiveEqState({
        gains: next,
        preamp: eqPreampRef.current,
        bypass: eqBypassRef.current,
      });
    },
    setPreamp: (db) => {
      const v = clampDb(db, EQ_PREAMP_MIN, EQ_PREAMP_MAX);
      setEqPreampState(v);
      saveActiveEqState({
        gains: eqGainsRef.current,
        preamp: v,
        bypass: eqBypassRef.current,
      });
    },
    setBypass: (b) => {
      // Global mode is always engaged — refuse to bypass while in it.
      // The panel's Off button is also disabled, but defend in depth.
      if (globalEqEnabled && b) return;
      setEqBypassState(b);
      saveActiveEqState({
        gains: eqGainsRef.current,
        preamp: eqPreampRef.current,
        bypass: b,
      });
    },
    reset: () => {
      const flat = new Array(EQ_FREQUENCIES.length).fill(0);
      setEqGains(flat);
      setEqPreampState(0);
      saveActiveEqState({
        gains: flat,
        preamp: 0,
        bypass: eqBypassRef.current,
      });
    },
  };

  const restoreLocalPlayback = useCallback(
    (snap: RestoreLocalSnapshot) => {
      setQueue(snap.queue);
      setCursor(snap.cursor);
      setShuffledOrder(snap.shuffledOrder);
      setShuffle(snap.shuffle);
      setRepeat(snap.repeat);
      setCurrentPlaylistId(snap.current_playlist_id);
      const audio = audioRef.current;
      if (audio && snap.queue.length > 0 && snap.cursor >= 0) {
        const handler = () => {
          audio.currentTime = snap.position_sec;
          if (snap.was_playing) {
            audio.play().catch(() => {/* autoplay blocked */});
          }
          audio.removeEventListener('loadedmetadata', handler);
        };
        audio.addEventListener('loadedmetadata', handler);
      }
    },
    [],
  );

  // -----------------------------------------------------------------
  // Remote control: publish state for followers + listen for commands.
  // (remote was declared earlier — before the audio src sync effect.)
  // -----------------------------------------------------------------

  // Keep a ref for position so buildSnapshot doesn't re-create on every
  // 250ms timeupdate tick (which would trip the edge-publish effect).
  const positionRef = useRef(position);
  useEffect(() => { positionRef.current = position; }, [position]);

  const buildSnapshot = useCallback((): RemoteSnapshot => ({
    schema: 1,
    current_track: current
      ? {
          id: current.id,
          title: current.title,
          artist: current.artist,
          album: current.album,
          cover_url: current.cover_url ?? null,
          url: current.url,
        }
      : null,
    duration_sec: duration,
    queue_ids: queue.map((t) => t.id),
    cursor: currentQueueIndex,
    current_playlist_id: currentPlaylistId,
    is_playing: isPlaying,
    shuffle,
    repeat,
    position_sec: positionRef.current,
    position_at_server_ms: Date.now(),
    volume,
    effects: {
      spatial_preset: spatialPreset,
      global_eq_enabled: globalEqEnabled,
      eq_state: {
        gains: eqGains,
        preamp: eqPreamp,
        bypass: eqBypass,
      },
    },
  }), [
    current,
    duration,
    queue,
    currentQueueIndex,
    currentPlaylistId,
    isPlaying,
    shuffle,
    repeat,
    volume,
    spatialPreset,
    globalEqEnabled,
    eqGains,
    eqPreamp,
    eqBypass,
  ]);

  // Edge publish: re-publishes 50 ms after any tracked state changes.
  useEffect(() => {
    const t = window.setTimeout(() => {
      remote.publishState(buildSnapshot());
    }, 50);
    return () => window.clearTimeout(t);
  }, [
    current?.id,
    isPlaying,
    shuffle,
    repeat,
    queue.length,
    currentQueueIndex,
    currentPlaylistId,
    duration,
    remote,
    buildSnapshot,
  ]);

  // Safety resend every 15 s. Runs even when no track is loaded so
  // effects state (DOLBY / EQ) keeps propagating to followers while
  // the host sits idle between tracks.
  useEffect(() => {
    const t = window.setInterval(() => {
      remote.publishState(buildSnapshot());
    }, 15_000);
    return () => window.clearInterval(t);
  }, [remote, buildSnapshot]);

  // Host-side viz stream. When a phone is following and the analyser is
  // up, sample frequency data at 10 Hz and push it to followers. Stops
  // automatically when no one is following so we're not burning network
  // for nothing. The visualizer on the phone uses these frames to render
  // a bar / ribbon that tracks the host's actual audio.
  useEffect(() => {
    if (remote.isRemote) return;
    if (remote.followerCount === 0) return;
    let buf: Uint8Array | null = null;
    const tick = () => {
      const analyser = analyserRef.current;
      if (!analyser) return;
      if (!buf || buf.length !== analyser.frequencyBinCount) {
        buf = new Uint8Array(analyser.frequencyBinCount);
      }
      analyser.getByteFrequencyData(buf);
      remote.publishVizFrame(buf);
    };
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [remote.isRemote, remote.followerCount, remote]);

  // Force-publish on effect state changes. The edge-publish 50ms debounce
  // gets cancelled-and-rescheduled by every render — when the host
  // re-renders rapidly (e.g., a phone is hammering RPCs during an EQ
  // drag), the debounced publish can be starved. Effects are discrete
  // events, so we just publish immediately here. Followers see the
  // change without round-trip lag.
  useEffect(() => {
    if (remote.isRemote) return; // followers shouldn't broadcast their own state as if they were the host
    remote.publishState(buildSnapshot());
    // We intentionally trigger on the raw effect state, not on
    // buildSnapshot's identity, so this fires even if buildSnapshot's
    // memoization didn't update for some reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spatialPreset, globalEqEnabled, eqGains, eqPreamp, eqBypass]);

  // Re-publish on seek edges (rounded position so it doesn't fire 4×/s).
  useEffect(() => {
    if (!current) return;
    const t = window.setTimeout(() => {
      remote.publishState(buildSnapshot());
    }, 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.round(position)]);

  // -----------------------------------------------------------------
  // Host-side command execution: consume remote.lastCommand and apply
  // it to the local player. Skipped when we are the remote ourselves.
  // -----------------------------------------------------------------
  const lastCmdSeqRef = useRef(0);

  const applyTrackIdsAction = useCallback(
    async (action: 'playList' | 'playOne' | 'enqueue', a: Record<string, unknown>) => {
      // Prefer fully-hydrated tracks the phone shipped along with the
      // RPC — this is what lets cross-library jumps work (e.g., phone
      // is viewing All Tracks, host is sitting on a playlist queue).
      // Without these, the host would have to look the ids up in its
      // own queue, which silently fails when the picked track isn't in
      // the current playlist — the exact bug where the host appeared
      // to only "advance within the playlist" instead of switching out.
      let resolved: Track[] = Array.isArray(a.tracks)
        ? (a.tracks as Track[]).filter(
            (t) => t && typeof t === 'object' && Number.isInteger(t.id),
          )
        : [];

      if (resolved.length === 0) {
        // Back-compat path: older phone clients only sent ids. Resolve
        // from the host's current queue — works for in-queue jumpTo-
        // style actions but not for cross-library picks.
        const ids: number[] = action === 'playOne'
          ? [Number(a.trackId)]
          : (Array.isArray(a.trackIds) ? (a.trackIds as number[]) : []);
        if (ids.length === 0) return;
        const known = new Map<number, Track>();
        for (const t of queue) known.set(t.id, t);
        resolved = ids.map((id) => known.get(id)).filter(Boolean) as Track[];
      }

      if (resolved.length === 0) return;

      if (action === 'playList') {
        playList(resolved, Number(a.startIndex) || 0, a.playlistId as number | undefined);
      } else if (action === 'playOne') {
        playOne(resolved[0]);
      } else {
        enqueue(resolved);
      }
    },
    [queue, playList, playOne, enqueue],
  );

  useEffect(() => {
    if (remote.isRemote) return; // we're a remote ourselves — don't apply
    const ev = remote.lastCommand;
    if (!ev) return;
    if (ev.seq === lastCmdSeqRef.current) return;
    lastCmdSeqRef.current = ev.seq;

    const { action, args } = ev.payload;
    const a = (args ?? {}) as Record<string, unknown>;
    switch (action) {
      case 'togglePlay': togglePlay(); break;
      case 'next': next(); break;
      case 'prev': prev(); break;
      case 'seek':
        if (typeof a.sec === 'number') seek(a.sec);
        break;
      case 'setVolume':
        if (typeof a.v === 'number') setVolume(a.v);
        break;
      case 'jumpTo':
        if (typeof a.queueIndex === 'number') jumpTo(a.queueIndex);
        break;
      case 'toggleShuffle': toggleShuffle(); break;
      case 'cycleRepeat': cycleRepeat(); break;
      case 'clearQueue': clearQueue(); break;
      case 'playList':
      case 'playOne':
      case 'enqueue':
        applyTrackIdsAction(action, a);
        break;
      case 'setSpatialPreset':
        if (typeof a.preset === 'string' && SPATIAL_PRESETS.includes(a.preset as SpatialPreset)) {
          setSpatialPreset(a.preset as SpatialPreset);
        }
        break;
      case 'setGlobalEqEnabled':
        if (typeof a.enabled === 'boolean') {
          setPref('global_eq_enabled', a.enabled);
        }
        break;
      case 'setEqGains':
        if (Array.isArray(a.gains) && a.gains.length === EQ_FREQUENCIES.length) {
          eqController.setGains(a.gains as number[]);
        }
        break;
      case 'setEqPreamp':
        if (typeof a.preamp === 'number') {
          eqController.setPreamp(a.preamp);
        }
        break;
      case 'setEqBypass':
        if (typeof a.bypass === 'boolean') {
          eqController.setBypass(a.bypass);
        }
        break;
      case 'eqReset':
        eqController.reset();
        break;
    }
  }, [
    remote.lastCommand,
    remote.isRemote,
    togglePlay, next, prev, seek, setVolume, jumpTo,
    toggleShuffle, cycleRepeat, clearQueue, applyTrackIdsAction,
    setSpatialPreset, setPref, eqController,
  ]);

  // Ticker to make the proxy progress bar live-update.
  const [proxyTick, setProxyTick] = useState(0);
  useEffect(() => {
    if (!remote.isRemote) return;
    if (!remote.hostSnapshot?.is_playing) return;
    const t = window.setInterval(() => setProxyTick((x) => x + 1), 250);
    return () => window.clearInterval(t);
  }, [remote.isRemote, remote.hostSnapshot?.is_playing]);
  void proxyTick;

  function buildRemoteValue(): PlayerContextValue {
    const snap = remote.hostSnapshot;
    const t = snap?.current_track ?? null;
    const remoteTrack: Track | null = t
      ? ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          album: t.album,
          cover_url: t.cover_url,
          url: t.url,
          duration_sec: snap?.duration_sec ?? 0,
          rel_path: '',
          rating: 0,
          favorited: false,
        } as unknown as Track)
      : null;
    const remoteQueue: Track[] = (snap?.queue_ids ?? []).map((id) =>
      id === t?.id && remoteTrack ? remoteTrack : ({ id } as Track),
    );
    const livePosition = snap
      ? snap.position_sec + (snap.is_playing
          ? Math.max(0, (Date.now() - snap.position_at_server_ms) / 1000)
          : 0)
      : 0;
    const rpc = (action: RemoteAction, args: unknown = null) =>
      remote.sendCommand(action, args);

    return {
      queue: remoteQueue,
      cursor: snap?.cursor ?? -1,
      shuffledOrder: [],
      isPlaying: !!snap?.is_playing,
      position: livePosition,
      duration: snap?.duration_sec ?? 0,
      // Reflect the host's volume so the slider on the phone matches
      // what's actually playing. The optimistic override wins while a
      // drag is in flight (see remoteVolumeOpt above); otherwise we
      // trust the host snapshot, falling back to local volume only if
      // the host hasn't pushed a snapshot with this field yet.
      volume:
        remoteVolumeOpt != null
          ? remoteVolumeOpt
          : typeof snap?.volume === 'number'
            ? snap.volume
            : volume,
      shuffle: !!snap?.shuffle,
      repeat: snap?.repeat ?? 'off',
      current: remoteTrack,
      currentPlaylistId: snap?.current_playlist_id ?? null,
      // Ship the full Track objects alongside the id list so the host
      // can play tracks that aren't already in its current queue (e.g.,
      // phone picks from All Tracks while host sits on a playlist).
      playList: (tracks, startIndex, playlistId) =>
        rpc('playList', {
          trackIds: tracks.map((x) => x.id),
          tracks,
          startIndex: startIndex ?? 0,
          playlistId,
        }),
      playOne: (track) => rpc('playOne', { trackId: track.id, tracks: [track] }),
      enqueue: (tracks) =>
        rpc('enqueue', { trackIds: tracks.map((x) => x.id), tracks }),
      togglePlay: () => rpc('togglePlay'),
      next: () => rpc('next'),
      prev: () => rpc('prev'),
      jumpTo: (queueIndex) => rpc('jumpTo', { queueIndex }),
      seek: (sec) => rpc('seek', { sec }),
      setVolume: (v) => {
        // Stash the local override first so the slider thumb moves in
        // the same frame as the drag — the RPC then catches up.
        setRemoteVolumeOpt(Math.max(0, Math.min(1, v)));
        return rpc('setVolume', { v });
      },
      toggleShuffle: () => rpc('toggleShuffle'),
      cycleRepeat: () => rpc('cycleRepeat'),
      clearQueue: () => rpc('clearQueue'),
      restoreLocalPlayback,
      // Fake AnalyserNode backed by viz frames the host pushes over SSE.
      // AudioVisualizer only uses .frequencyBinCount + getByteFrequencyData,
      // so we don't need to implement the full AnalyserNode surface.
      getAnalyser: () => {
        const frame = remote.lastVizFrame;
        if (!frame) return null;
        return {
          frequencyBinCount: frame.length,
          getByteFrequencyData: (target: Uint8Array) => {
            const src = remote.lastVizFrame;
            if (!src) {
              target.fill(0);
              return;
            }
            const n = Math.min(target.length, src.length);
            for (let i = 0; i < n; i++) target[i] = src[i];
            for (let i = n; i < target.length; i++) target[i] = 0;
          },
          // The visualizer never calls these, but TypeScript needs the
          // AnalyserNode shape; stub them so the cast doesn't blow up at
          // runtime if some path probes for them.
          getByteTimeDomainData: () => {},
          getFloatFrequencyData: () => {},
          getFloatTimeDomainData: () => {},
        } as unknown as AnalyserNode;
      },
      // Effects: optimistic local override wins (lets sliders track the
      // finger during a drag), then host snapshot, then phone's local
      // prefs as last resort. Setters set the override AND fire the RPC
      // in the same frame; the override clears once the host's snapshot
      // catches up to the user's value.
      eq: {
        frequencies: EQ_FREQUENCIES,
        gains: optEqGains ?? snap?.effects?.eq_state?.gains ?? eqGains,
        preamp: optEqPreamp ?? snap?.effects?.eq_state?.preamp ?? eqPreamp,
        bypass: optEqBypass ?? snap?.effects?.eq_state?.bypass ?? eqBypass,
        setGain: (i, db) => {
          const current =
            optEqGains ?? snap?.effects?.eq_state?.gains ?? eqGains;
          const nextGains = current.map((g, j) => (j === i ? db : g));
          setOptEqGains(nextGains);
          rpc('setEqGains', { gains: nextGains });
        },
        setGains: (db) => {
          setOptEqGains(db);
          rpc('setEqGains', { gains: db });
        },
        setPreamp: (db) => {
          setOptEqPreamp(db);
          rpc('setEqPreamp', { preamp: db });
        },
        setBypass: (b) => {
          setOptEqBypass(b);
          rpc('setEqBypass', { bypass: b });
        },
        reset: () => {
          setOptEqGains(new Array(EQ_FREQUENCIES.length).fill(0));
          setOptEqPreamp(0);
          rpc('eqReset');
        },
      },
      spatial: {
        preset: optSpatial ?? snap?.effects?.spatial_preset ?? spatialPreset,
        setPreset: (p) => {
          setOptSpatial(p);
          rpc('setSpatialPreset', { preset: p });
        },
        cycle: () => {
          const cur =
            optSpatial ?? snap?.effects?.spatial_preset ?? spatialPreset;
          const i = SPATIAL_PRESETS.indexOf(cur);
          const next = SPATIAL_PRESETS[(i + 1) % SPATIAL_PRESETS.length];
          setOptSpatial(next);
          rpc('setSpatialPreset', { preset: next });
        },
      },
      globalEq: {
        enabled:
          optGlobalEqEnabled ??
          snap?.effects?.global_eq_enabled ??
          globalEqEnabled,
        setEnabled: (b: boolean) => {
          setOptGlobalEqEnabled(b);
          rpc('setGlobalEqEnabled', { enabled: b });
        },
      },
    };
  }

  const localValue: PlayerContextValue = {
    queue,
    cursor,
    shuffledOrder,
    isPlaying,
    position,
    duration,
    volume,
    shuffle,
    repeat,
    current,
    currentPlaylistId,
    playList,
    playOne,
    enqueue,
    togglePlay,
    next,
    prev,
    jumpTo,
    seek,
    setVolume,
    toggleShuffle,
    cycleRepeat,
    clearQueue,
    restoreLocalPlayback,
    getAnalyser: () => analyserRef.current,
    eq: eqController,
    spatial: {
      preset: spatialPreset,
      setPreset: setSpatialPreset,
      cycle: () => {
        const i = SPATIAL_PRESETS.indexOf(spatialPreset);
        setSpatialPreset(SPATIAL_PRESETS[(i + 1) % SPATIAL_PRESETS.length]);
      },
    },
    globalEq: {
      enabled: globalEqEnabled,
      setEnabled: (b: boolean) => setPref('global_eq_enabled', b),
    },
  };

  const value: PlayerContextValue = remote.isRemote ? buildRemoteValue() : localValue;

  return (
    <PlayerContext.Provider value={value}>
      {children}
      {/* Single hidden <audio>, lives at the root so navigation doesn't
          interrupt playback. */}
      <audio ref={audioRef} preload="metadata" className="hidden" />
    </PlayerContext.Provider>
  );
}
