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

export type RepeatMode = 'off' | 'one' | 'all';

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
}

interface PlayerActions {
  /** Replace queue and start at the given index. */
  playList: (tracks: Track[], startIndex?: number) => void;
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
}

interface PlayerContextValue extends PlayerState, PlayerActions {
  /** The track currently playing, or null if idle. */
  current: Track | null;
  /** AnalyserNode for real-time visualizers. May be null until first play. */
  getAnalyser: () => AnalyserNode | null;
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

  // Web Audio graph for visualizers. Lazily created on first user-gesture
  // play (browsers require a gesture before AudioContext can run).
  // The MediaElementSource can only be created ONCE per <audio>, so we
  // memoize all three nodes in refs.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);

  function ensureAudioGraph() {
    if (audioCtxRef.current) {
      // Already set up — just resume if it was suspended (some browsers
      // suspend on tab blur).
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
      source.connect(analyser);
      analyser.connect(ctx.destination);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      sourceRef.current = source;
    } catch (err) {
      // CORS or browser unsupported — visualizer just won't show.
      console.warn('audio graph init failed:', err);
    }
  }

  const [queue, setQueue] = useState<Track[]>([]);
  const [cursor, setCursor] = useState(-1);
  const [shuffledOrder, setShuffledOrder] = useState<number[]>([]);
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

  // Sync <audio> src whenever current track changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
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
  }, [current]);

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
    (tracks: Track[], startIndex = 0) => {
      if (tracks.length === 0) return;
      const safeStart = Math.max(0, Math.min(startIndex, tracks.length - 1));
      setQueue(tracks);
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

  const value: PlayerContextValue = {
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
    getAnalyser: () => analyserRef.current,
  };

  return (
    <PlayerContext.Provider value={value}>
      {children}
      {/* Single hidden <audio>, lives at the root so navigation doesn't
          interrupt playback. */}
      <audio ref={audioRef} preload="metadata" className="hidden" />
    </PlayerContext.Provider>
  );
}
