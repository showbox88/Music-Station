/**
 * Per-user preferences synced to the server (Slice 6).
 *
 * Replaces a handful of `localStorage` keys (mw.eq.tracks,
 * mw.spatial.preset, mw.viz.style) so settings follow the user across
 * devices instead of being trapped on one browser.
 *
 * Two pieces of state:
 *   - prefs:        free-form JSON blob (user_prefs.data on the server)
 *                   shape: { spatial_preset, viz_style, global_eq_enabled,
 *                            global_eq, ... }
 *   - trackEqMap:   { [trackId]: EQState } — per-user-per-track EQ
 *
 * Server is the source of truth. On mount we fetch both, render a thin
 * loading screen until they're in. Writes are debounced (~400ms) and
 * fire-and-forget — UI doesn't block on the network round-trip.
 *
 * One-time migration: if the freshly-fetched server prefs are EMPTY and
 * the old localStorage keys still have data, we POST the localStorage
 * values to the server, then nuke the localStorage keys. This way users
 * who set things up before Slice 6 keep their settings.
 *
 * Volume is intentionally NOT in here — it's session-level (still in
 * localStorage on PlayerContext) since people fiddle with it constantly
 * and per-device behavior is what they expect.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { api } from './api';

/* ----------------------------- types ----------------------------- */

export interface EQState {
  gains: number[];
  preamp: number;
  bypass: boolean;
}

export type SpatialPreset = 'off' | 'cinema' | 'hall' | 'club';

export interface PrefsBlob {
  spatial_preset?: SpatialPreset;
  viz_style?: string;
  global_eq_enabled?: boolean;
  global_eq?: EQState;
  [k: string]: unknown;
}

interface PrefsContextValue {
  prefs: PrefsBlob;
  setPref: <K extends keyof PrefsBlob>(key: K, value: PrefsBlob[K] | null) => void;
  trackEqMap: Record<number, EQState>;
  setTrackEq: (trackId: number, state: EQState) => void;
  clearTrackEq: (trackId: number) => void;
}

const Ctx = createContext<PrefsContextValue | null>(null);

/* -------------------- localStorage migration keys -------------------- */

const LS_EQ_TRACKS = 'mw.eq.tracks';
const LS_SPATIAL = 'mw.spatial.preset';
const LS_VIZ = 'mw.viz.style';

/* ----------------------------- helpers ----------------------------- */

function readLocalEqTracks(): Record<number, EQState> {
  try {
    const raw = window.localStorage.getItem(LS_EQ_TRACKS);
    if (!raw) return {};
    const j = JSON.parse(raw);
    if (!j || typeof j !== 'object') return {};
    const out: Record<number, EQState> = {};
    for (const [k, v] of Object.entries(j)) {
      const id = Number(k);
      if (!Number.isFinite(id)) continue;
      const eq = sanitizeEQ(v);
      if (eq) out[id] = eq;
    }
    return out;
  } catch {
    return {};
  }
}

function sanitizeEQ(j: any): EQState | null {
  if (!j || typeof j !== 'object') return null;
  if (!Array.isArray(j.gains) || !j.gains.every((g: any) => Number.isFinite(g))) return null;
  return {
    gains: j.gains.map((g: number) => g),
    preamp: Number(j.preamp) || 0,
    bypass: Boolean(j.bypass),
  };
}

/* ----------------------------- provider ----------------------------- */

const SAVE_DEBOUNCE_MS = 400;

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<PrefsBlob>({});
  const [trackEqMap, setTrackEqMap] = useState<Record<number, EQState>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pending writes — coalesce repeated saves into one PUT per debounce window.
  const prefsTimerRef = useRef<number | null>(null);
  const prefsPendingRef = useRef<PrefsBlob>({});
  const eqTimersRef = useRef<Record<number, number>>({});
  const eqPendingRef = useRef<Record<number, EQState>>({});

  // Initial load + one-time localStorage migration
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [serverPrefs, serverEq] = await Promise.all([api.getPrefs(), api.getTrackEq()]);
        if (cancelled) return;

        // Migration: server is empty + localStorage has data → seed server.
        const serverPrefsEmpty =
          !serverPrefs || Object.keys(serverPrefs).length === 0;
        const serverEqEmpty = !serverEq || Object.keys(serverEq).length === 0;

        let mergedPrefs = serverPrefs as PrefsBlob;
        let mergedEq = serverEq;

        if (serverPrefsEmpty) {
          const migrated: PrefsBlob = {};
          const sp = window.localStorage.getItem(LS_SPATIAL);
          if (sp && ['off', 'cinema', 'hall', 'club'].includes(sp)) {
            migrated.spatial_preset = sp as SpatialPreset;
          }
          const vz = window.localStorage.getItem(LS_VIZ);
          if (vz) migrated.viz_style = vz;
          if (Object.keys(migrated).length > 0) {
            mergedPrefs = await api.savePrefs(migrated);
          }
        }
        if (serverEqEmpty) {
          const local = readLocalEqTracks();
          const ids = Object.keys(local);
          if (ids.length > 0) {
            for (const id of ids) {
              await api.saveTrackEq(Number(id), local[Number(id)]);
            }
            mergedEq = local;
          }
        }

        // Always nuke the localStorage keys after a successful initial
        // fetch so we never silently fall behind the server.
        try {
          window.localStorage.removeItem(LS_EQ_TRACKS);
          window.localStorage.removeItem(LS_SPATIAL);
          window.localStorage.removeItem(LS_VIZ);
        } catch {
          /* ignore */
        }

        setPrefs(mergedPrefs);
        setTrackEqMap(mergedEq);
        setLoaded(true);
      } catch (e: any) {
        if (cancelled) return;
        setError(String(e?.message ?? e));
        setLoaded(true);  // unblock UI even on failure — better degraded than stuck
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* -------------------------- writers --------------------------- */

  function flushPrefs() {
    const patch = prefsPendingRef.current;
    prefsPendingRef.current = {};
    api.savePrefs(patch as Record<string, unknown>).catch((e) =>
      console.warn('prefs save failed', e),
    );
  }

  const setPref = useCallback<PrefsContextValue['setPref']>((key, value) => {
    setPrefs((prev) => {
      const next = { ...prev };
      if (value === null) delete next[key as string];
      else next[key as string] = value as any;
      return next;
    });
    if (value === null) prefsPendingRef.current[key as string] = null as any;
    else prefsPendingRef.current[key as string] = value as any;
    if (prefsTimerRef.current) window.clearTimeout(prefsTimerRef.current);
    prefsTimerRef.current = window.setTimeout(flushPrefs, SAVE_DEBOUNCE_MS);
  }, []);

  function flushOneEq(trackId: number) {
    const state = eqPendingRef.current[trackId];
    if (!state) return;
    delete eqPendingRef.current[trackId];
    api.saveTrackEq(trackId, state).catch((e) =>
      console.warn('track-eq save failed', e),
    );
  }

  const setTrackEq = useCallback((trackId: number, state: EQState) => {
    setTrackEqMap((prev) => ({ ...prev, [trackId]: state }));
    eqPendingRef.current[trackId] = state;
    if (eqTimersRef.current[trackId]) {
      window.clearTimeout(eqTimersRef.current[trackId]);
    }
    eqTimersRef.current[trackId] = window.setTimeout(() => flushOneEq(trackId), SAVE_DEBOUNCE_MS);
  }, []);

  const clearTrackEq = useCallback((trackId: number) => {
    setTrackEqMap((prev) => {
      const next = { ...prev };
      delete next[trackId];
      return next;
    });
    delete eqPendingRef.current[trackId];
    if (eqTimersRef.current[trackId]) {
      window.clearTimeout(eqTimersRef.current[trackId]);
      delete eqTimersRef.current[trackId];
    }
    api.deleteTrackEq(trackId).catch(() => {/* ignore */});
  }, []);

  if (!loaded) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-zinc-500">
        加载偏好…
      </div>
    );
  }
  if (error) {
    // Soft-fail: continue with empty defaults but show a small warning.
    console.warn('PrefsProvider load error:', error);
  }

  return (
    <Ctx.Provider value={{ prefs, setPref, trackEqMap, setTrackEq, clearTrackEq }}>
      {children}
    </Ctx.Provider>
  );
}

export function usePrefs(): PrefsContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePrefs must be used inside <PrefsProvider>');
  return v;
}
