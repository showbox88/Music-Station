/**
 * Browser-local folder library view.
 *
 * Distinct from TrackList: no server API calls, no per-user features
 * (favorites/ratings/edit/share). Reads from IndexedDB (populated by
 * web/src/local/scanner.ts) and plays via blob URLs resolved from the
 * stored FileSystemDirectoryHandle.
 *
 * States:
 *   - need-picker        : nothing stored yet → "Pick folder" button
 *   - need-permission    : handle stored but permission not granted on
 *                          this session → "Grant access" button
 *   - ready              : list of tracks + search + rescan
 *   - scanning           : progress display
 *
 * Blob URLs are created lazily when a track is asked to play and cached
 * by rel_path. We do NOT proactively revoke them — typical libraries are
 * well under the size where holding a few hundred File-backed object
 * URLs matters, and the browser releases them on page unload. (The blob
 * URL holds a reference to the File which is cheap; data is not loaded
 * until <audio> reads it.)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlayer } from '../player/PlayerContext';
import { usePrefs } from '../PrefsContext';
import {
  getStoredFolderHandle,
  setStoredFolderHandle,
  clearStoredFolderHandle,
  listLocalTracks,
  clearLocalTracks,
  listLocalUserStates,
  patchLocalUserState,
} from '../local/db';
import {
  scanFolder,
  getFileHandle,
  type ScanProgress,
  type ScanResult,
} from '../local/scanner';
import type { LocalTrack, LocalUserState } from '../local/types';
import { localToTrack, localIdFromRelPath } from '../local/types';
import StarRating from './StarRating';
import AddToPlaylistMenu from './AddToPlaylistMenu';

type Mode = 'need-picker' | 'need-permission' | 'ready' | 'scanning';

function formatDuration(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatBytes(b: number): string {
  if (b > 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}

async function queryReadPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await (handle as any).queryPermission({ mode: 'read' })) as PermissionState;
}

async function requestReadPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await (handle as any).requestPermission({ mode: 'read' })) as PermissionState;
}

interface Props {
  /**
   * Bumped by the parent (App.tsx) when something this view did
   * affects the sidebar — e.g. a track was added to a playlist via
   * AddToPlaylistMenu. App's `refresh` increments `refreshKey` which
   * the Sidebar's load effect watches.
   */
  onChanged?: () => void;
}

export default function LocalFolderView({ onChanged }: Props = {}) {
  const player = usePlayer();
  const { prefs, setPref, refreshLocalTrackIndex } = usePrefs();
  const view: 'list' | 'card' = prefs.tracks_view === 'card' ? 'card' : 'list';
  const [mode, setMode] = useState<Mode>('need-picker');
  const [handle, setHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [tracks, setTracks] = useState<LocalTrack[]>([]);
  const [userStateByPath, setUserStateByPath] = useState<
    Record<string, LocalUserState>
  >({});
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [q, setQ] = useState('');
  const [favOnly, setFavOnly] = useState(false);
  const [addingTo, setAddingTo] = useState<{
    track: LocalTrack;
    x: number;
    y: number;
  } | null>(null);

  const blobCacheRef = useRef<Map<string, string>>(new Map());

  // Load user_state alongside the track list. Called whenever the
  // displayed list of tracks changes (initial load, after scan).
  const reloadUserStates = useCallback(async () => {
    try {
      const all = await listLocalUserStates();
      const map: Record<string, LocalUserState> = {};
      for (const s of all) map[s.rel_path] = s;
      setUserStateByPath(map);
    } catch {
      setUserStateByPath({});
    }
  }, []);

  // On mount: try the stored handle.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await getStoredFolderHandle();
        if (cancelled) return;
        if (!stored) {
          setMode('need-picker');
          return;
        }
        setHandle(stored);
        const perm = await queryReadPermission(stored);
        if (cancelled) return;
        if (perm === 'granted') {
          const [ts] = await Promise.all([listLocalTracks(), reloadUserStates()]);
          if (cancelled) return;
          setTracks(ts);
          setMode('ready');
        } else {
          setMode('need-permission');
        }
      } catch (e) {
        if (!cancelled) setErr(String((e as Error).message ?? e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runScan = useCallback(async (h: FileSystemDirectoryHandle) => {
    setMode('scanning');
    setProgress({ scanned: 0, total: 0, current_rel_path: null });
    setLastResult(null);
    try {
      const r = await scanFolder(h, (p) => setProgress(p));
      setLastResult(r);
      const ts = await listLocalTracks();
      setTracks(ts);
      await reloadUserStates();
      // Let PrefsContext rebuild its negative-id → rel_path lookup so
      // the player's per-track EQ can find local tracks just scanned.
      await refreshLocalTrackIndex();
      const stillExisting = new Set(ts.map((t) => t.rel_path));
      for (const [path, url] of blobCacheRef.current.entries()) {
        if (!stillExisting.has(path)) {
          URL.revokeObjectURL(url);
          blobCacheRef.current.delete(path);
        }
      }
      setMode('ready');
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      setMode('ready');
    } finally {
      setProgress(null);
    }
  }, []);

  const pickFolder = useCallback(async () => {
    setErr(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const picked: FileSystemDirectoryHandle = await (window as any).showDirectoryPicker({
        mode: 'read',
        id: 'music-station-local-folder',
      });
      await setStoredFolderHandle(picked);
      // Wipe any old DB rows from a previous folder so the list reflects
      // ONLY the new pick.
      await clearLocalTracks();
      for (const url of blobCacheRef.current.values()) URL.revokeObjectURL(url);
      blobCacheRef.current.clear();
      setHandle(picked);
      await runScan(picked);
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      // User-aborted the picker — silent
      if (!/abort/i.test(msg)) setErr(msg);
    }
  }, [runScan]);

  const grantPermission = useCallback(async () => {
    if (!handle) return;
    setErr(null);
    try {
      const r = await requestReadPermission(handle);
      if (r === 'granted') {
        const ts = await listLocalTracks();
        setTracks(ts);
        setMode('ready');
      } else {
        setErr('权限未授予');
      }
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  }, [handle]);

  const rescan = useCallback(() => {
    if (handle) runScan(handle);
  }, [handle, runScan]);

  const changeFolder = useCallback(async () => {
    if (!confirm('换一个文件夹？当前列表会被清空。')) return;
    await clearStoredFolderHandle();
    await clearLocalTracks();
    for (const url of blobCacheRef.current.values()) URL.revokeObjectURL(url);
    blobCacheRef.current.clear();
    setHandle(null);
    setTracks([]);
    setMode('need-picker');
  }, []);

  const blobUrlFor = useCallback(
    async (lt: LocalTrack): Promise<string> => {
      const cached = blobCacheRef.current.get(lt.rel_path);
      if (cached) return cached;
      if (!handle) throw new Error('no folder handle');
      const fh = await getFileHandle(handle, lt.rel_path);
      const file = await fh.getFile();
      const url = URL.createObjectURL(file);
      blobCacheRef.current.set(lt.rel_path, url);
      return url;
    },
    [handle],
  );

  const playOne = useCallback(
    async (lt: LocalTrack) => {
      try {
        const url = await blobUrlFor(lt);
        player.playOne(localToTrack(lt, url, userStateByPath[lt.rel_path]));
      } catch (e) {
        setErr(`播放失败: ${(e as Error).message}`);
      }
    },
    [blobUrlFor, player, userStateByPath],
  );

  const enqueueOne = useCallback(
    async (lt: LocalTrack) => {
      try {
        const url = await blobUrlFor(lt);
        player.enqueue([localToTrack(lt, url, userStateByPath[lt.rel_path])]);
      } catch (e) {
        setErr(`加入队列失败: ${(e as Error).message}`);
      }
    },
    [blobUrlFor, player, userStateByPath],
  );

  const toggleFavorite = useCallback(
    async (lt: LocalTrack) => {
      const current = !!userStateByPath[lt.rel_path]?.favorited;
      const next = !current;
      // Optimistic update.
      setUserStateByPath((prev) => {
        const merged: LocalUserState = {
          ...(prev[lt.rel_path] ?? { rel_path: lt.rel_path }),
          favorited: next,
        };
        return { ...prev, [lt.rel_path]: merged };
      });
      try {
        await patchLocalUserState(lt.rel_path, { favorited: next || null });
      } catch (e) {
        // Roll back on persistence failure.
        setUserStateByPath((prev) => {
          const merged: LocalUserState = {
            ...(prev[lt.rel_path] ?? { rel_path: lt.rel_path }),
            favorited: current,
          };
          return { ...prev, [lt.rel_path]: merged };
        });
        setErr(`本地收藏保存失败: ${(e as Error).message}`);
      }
    },
    [userStateByPath],
  );

  const setRating = useCallback(
    async (lt: LocalTrack, value: number) => {
      const prevValue = userStateByPath[lt.rel_path]?.rating ?? 0;
      const cleared = value === 0;
      setUserStateByPath((prev) => {
        const merged: LocalUserState = {
          ...(prev[lt.rel_path] ?? { rel_path: lt.rel_path }),
          rating: value,
        };
        return { ...prev, [lt.rel_path]: merged };
      });
      try {
        await patchLocalUserState(lt.rel_path, {
          rating: cleared ? null : value,
        });
      } catch (e) {
        setUserStateByPath((prev) => {
          const merged: LocalUserState = {
            ...(prev[lt.rel_path] ?? { rel_path: lt.rel_path }),
            rating: prevValue,
          };
          return { ...prev, [lt.rel_path]: merged };
        });
        setErr(`本地评分保存失败: ${(e as Error).message}`);
      }
    },
    [userStateByPath],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = tracks;
    if (favOnly) {
      out = out.filter((t) => !!userStateByPath[t.rel_path]?.favorited);
    }
    if (needle) {
      out = out.filter(
        (t) =>
          (t.title ?? '').toLowerCase().includes(needle) ||
          (t.artist ?? '').toLowerCase().includes(needle) ||
          (t.album ?? '').toLowerCase().includes(needle) ||
          t.rel_path.toLowerCase().includes(needle),
      );
    }
    return out;
  }, [tracks, q, favOnly, userStateByPath]);

  const playAll = useCallback(async () => {
    if (filtered.length === 0) return;
    try {
      const resolved = await Promise.all(
        filtered.map(async (lt) =>
          localToTrack(lt, await blobUrlFor(lt), userStateByPath[lt.rel_path]),
        ),
      );
      player.playList(resolved, 0);
    } catch (e) {
      setErr(`播放失败: ${(e as Error).message}`);
    }
  }, [filtered, blobUrlFor, player, userStateByPath]);

  // Card click: if this track is the current one, toggle play/pause;
  // otherwise materialize the full filtered list and start from idx.
  const playFromIndex = useCallback(
    async (idx: number) => {
      const target = filtered[idx];
      if (!target) return;
      const targetId = localIdFromRelPath(target.rel_path);
      if (player.current?.id === targetId) {
        player.togglePlay();
        return;
      }
      try {
        const resolved = await Promise.all(
          filtered.map(async (lt) =>
            localToTrack(lt, await blobUrlFor(lt), userStateByPath[lt.rel_path]),
          ),
        );
        player.playList(resolved, idx);
      } catch (e) {
        setErr(`播放失败: ${(e as Error).message}`);
      }
    },
    [filtered, blobUrlFor, player, userStateByPath],
  );

  /* ---------- render ---------- */

  if (mode === 'need-picker') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-4">
        <div className="text-zinc-400 text-sm max-w-md">
          选一个本地文件夹，扫描里面的音乐文件，在这里浏览和播放。
          所有数据只存在这台电脑的浏览器里，服务器不知道。
        </div>
        <button
          onClick={pickFolder}
          className="px-5 py-2.5 rounded-full bezel glow-text glow-ring text-sm"
        >
          📁 选择文件夹
        </button>
        {err && <div className="text-xs text-red-400">{err}</div>}
      </div>
    );
  }

  if (mode === 'need-permission') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-4">
        <div className="text-zinc-400 text-sm max-w-md">
          上次选的文件夹「{handle?.name}」还在，但浏览器需要你重新确认读权限。
        </div>
        <button
          onClick={grantPermission}
          className="px-5 py-2.5 rounded-full bezel glow-text glow-ring text-sm"
        >
          🔓 授予访问
        </button>
        <button
          onClick={changeFolder}
          className="text-xs text-zinc-500 hover:text-white"
        >
          换一个文件夹
        </button>
        {err && <div className="text-xs text-red-400">{err}</div>}
      </div>
    );
  }

  if (mode === 'scanning') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-3">
        <div className="text-sm text-zinc-300">扫描中…</div>
        {progress && (
          <div className="text-xs text-zinc-500 tabular-nums">
            {progress.scanned} / {progress.total}
          </div>
        )}
        {progress?.current_rel_path && (
          <div className="text-[11px] text-zinc-600 truncate max-w-md">
            {progress.current_rel_path}
          </div>
        )}
      </div>
    );
  }

  // mode === 'ready'
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 md:px-6 py-3 border-b border-black/60 flex flex-wrap items-center gap-2 md:gap-3 surface-raised">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索本地曲目"
          className="input flex-1 max-w-md min-w-0"
        />
        <button
          onClick={() => setFavOnly((v) => !v)}
          className={`text-[11px] px-2.5 py-1 rounded-full bezel shrink-0 ${
            favOnly
              ? 'glow-text glow-ring text-white'
              : 'text-zinc-400 hover:text-white'
          }`}
          title="只看本地收藏"
        >
          ♥ 收藏
        </button>
        <span className="text-xs text-zinc-500 tabular-nums shrink-0 ml-auto">
          {filtered.length}/{tracks.length}
        </span>
        <button
          onClick={playAll}
          disabled={filtered.length === 0}
          className="text-[11px] px-2.5 py-1 rounded-full bezel text-zinc-300 hover:text-white disabled:opacity-50"
          title="播放当前列表里的全部"
        >
          ▶ 全部播放
        </button>
        <button
          onClick={rescan}
          className="text-[11px] px-2.5 py-1 rounded-full bezel text-zinc-300 hover:text-white"
          title="重新扫描这个文件夹"
        >
          ↻ 重新扫描
        </button>
        <button
          onClick={changeFolder}
          className="text-[11px] px-2.5 py-1 rounded-full bezel text-zinc-300 hover:text-white"
          title="选另一个文件夹（清空当前列表）"
        >
          📁 换文件夹
        </button>
        {/* List ↔ Card toggle. Shares the tracks_view pref with the
            server-side TrackList so flipping it here also flips it
            there — intentional, one mental model. */}
        <div
          className="inline-flex rounded-full overflow-hidden shrink-0"
          style={{ border: '1px solid #050506' }}
        >
          <button
            onClick={() => setPref('tracks_view', 'list')}
            className={`w-8 h-7 flex items-center justify-center ${
              view === 'list' ? 'glow-text glow-ring' : 'text-zinc-400 hover:text-white'
            }`}
            title="列表视图"
            aria-pressed={view === 'list'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="6"  x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>
          <button
            onClick={() => setPref('tracks_view', 'card')}
            className={`w-8 h-7 flex items-center justify-center ${
              view === 'card' ? 'glow-text glow-ring' : 'text-zinc-400 hover:text-white'
            }`}
            title="封面视图"
            aria-pressed={view === 'card'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3"  y="3"  width="7" height="7" />
              <rect x="14" y="3"  width="7" height="7" />
              <rect x="3"  y="14" width="7" height="7" />
              <rect x="14" y="14" width="7" height="7" />
            </svg>
          </button>
        </div>
      </div>

      <div className="px-3 md:px-6 py-1.5 border-b border-black/60 text-[11px] text-zinc-500 flex items-center gap-3">
        <span className="truncate">📁 {handle?.name}</span>
        {lastResult && (
          <span className="tabular-nums">
            +{lastResult.inserted} ↻{lastResult.updated} −{lastResult.removed}{' '}
            {lastResult.failed > 0 && (
              <span className="text-red-400">!{lastResult.failed}</span>
            )}
            <span className="ml-2 text-zinc-600">{lastResult.took_ms}ms</span>
          </span>
        )}
      </div>

      {err && (
        <div className="px-3 md:px-6 py-2 text-xs text-red-400 border-b border-red-900/40">
          {err}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="p-6 text-sm text-zinc-500 text-center">
            {tracks.length === 0
              ? '这个文件夹里没找到音频文件。'
              : '搜索没有结果。'}
          </div>
        ) : view === 'card' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6 gap-3 p-3 md:p-4">
            {filtered.map((t, idx) => {
              const fav = !!userStateByPath[t.rel_path]?.favorited;
              const rating = userStateByPath[t.rel_path]?.rating ?? 0;
              const isCur = player.current?.id === localIdFromRelPath(t.rel_path);
              const playing = isCur && player.isPlaying;
              return (
                <div
                  key={t.rel_path}
                  className="group relative flex flex-col rounded-lg overflow-hidden surface-raised select-none"
                  style={
                    isCur
                      ? { boxShadow: '0 0 0 1px rgba(255,45,181,0.55), 0 0 12px rgba(255,45,181,0.25)' }
                      : undefined
                  }
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => playFromIndex(idx)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        playFromIndex(idx);
                      }
                    }}
                    title={isCur ? (playing ? 'Pause' : 'Resume') : 'Play'}
                    className="relative block w-full aspect-square bg-zinc-800 cursor-pointer focus:outline-none focus:ring-2 focus:ring-pink-500/40"
                  >
                    {t.cover_data_url ? (
                      <img
                        src={t.cover_data_url}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-4xl text-zinc-600">
                        ♪
                      </div>
                    )}
                    {/* Play/pause overlay — same UX as the server card */}
                    <span
                      className="absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity opacity-0 group-hover:opacity-100 md:opacity-0"
                      style={{
                        color: 'rgba(255,255,255,0.85)',
                        background: 'linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.45))',
                        opacity: isCur ? 1 : undefined,
                      }}
                    >
                      {playing ? (
                        <svg width="42" height="42" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6" y="5" width="4" height="14" />
                          <rect x="14" y="5" width="4" height="14" />
                        </svg>
                      ) : (
                        <svg width="44" height="44" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </span>
                    {/* Top-right action chips on hover. Heart always
                        rendered (the main local-side action); + enqueue;
                        ▤ add-to-playlist. */}
                    <span className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          enqueueOne(t);
                        }}
                        title="加入播放队列"
                        className="w-7 h-7 rounded-full bezel flex items-center justify-center text-zinc-200 hover:text-blue-400"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setAddingTo({ track: t, x: r.left, y: r.bottom + 4 });
                        }}
                        title="加到 playlist"
                        className="w-7 h-7 rounded-full bezel flex items-center justify-center text-zinc-200 hover:text-pink-300"
                      >
                        ▤
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          toggleFavorite(t);
                        }}
                        title={fav ? '取消收藏' : '收藏到本地'}
                        className="w-7 h-7 rounded-full bezel flex items-center justify-center"
                      >
                        <span className={fav ? 'text-pink-400' : 'text-zinc-200'}>
                          {fav ? '♥' : '♡'}
                        </span>
                      </button>
                    </span>
                    {/* LRC badge bottom-left when sibling .lrc exists. */}
                    {t.has_lrc && (
                      <span
                        className="absolute bottom-1.5 left-1.5 text-[9px] uppercase tracking-wide text-pink-300/90 bezel px-1.5 py-0.5 rounded-full"
                        title="有 .lrc 歌词文件"
                      >
                        lrc
                      </span>
                    )}
                  </div>

                  <div className="px-2 py-1.5 min-w-0">
                    <div className="text-sm font-medium truncate" title={t.title || t.rel_path}>
                      {t.title || '—'}
                    </div>
                    <div className="text-xs text-zinc-500 truncate" title={t.artist || ''}>
                      {t.artist || '—'}
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <StarRating value={rating} onChange={(v) => setRating(t, v)} />
                      <span className="text-[10px] text-zinc-500 tabular-nums">
                        {formatDuration(t.duration_sec)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase text-zinc-500 sticky top-0 bg-black/60 backdrop-blur">
              <tr>
                <th className="text-left px-3 py-1.5 w-10"></th>
                <th className="text-left px-3 py-1.5">标题</th>
                <th className="text-left px-3 py-1.5 hidden md:table-cell">艺术家</th>
                <th className="text-left px-3 py-1.5 hidden lg:table-cell">专辑</th>
                <th className="text-center px-3 py-1.5 w-10">♥</th>
                <th className="text-left px-3 py-1.5 w-28 hidden md:table-cell">评分</th>
                <th className="text-right px-3 py-1.5 w-16 tabular-nums">时长</th>
                <th className="text-right px-3 py-1.5 w-20 tabular-nums hidden md:table-cell">大小</th>
                <th className="text-right px-3 py-1.5 w-24"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr
                  key={t.rel_path}
                  className="border-t border-black/40 hover:bg-white/[0.03] group"
                >
                  <td className="px-3 py-1.5">
                    {t.cover_data_url ? (
                      <img
                        src={t.cover_data_url}
                        alt=""
                        className="w-7 h-7 rounded object-cover"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded bg-zinc-800 text-zinc-500 flex items-center justify-center text-xs">
                        ♪
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="truncate max-w-md flex items-center gap-1.5">
                      <span>{t.title}</span>
                      {t.has_lrc && (
                        <span
                          className="text-[9px] uppercase text-pink-300/70"
                          title="有 .lrc 歌词文件"
                        >
                          lrc
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 hidden md:table-cell text-zinc-400 truncate max-w-xs">
                    {t.artist ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 hidden lg:table-cell text-zinc-400 truncate max-w-xs">
                    {t.album ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    {(() => {
                      const fav = !!userStateByPath[t.rel_path]?.favorited;
                      return (
                        <button
                          onClick={() => toggleFavorite(t)}
                          className={`text-base leading-none ${
                            fav ? 'text-pink-400' : 'text-zinc-600 hover:text-zinc-300'
                          }`}
                          title={fav ? '取消收藏' : '收藏到本地'}
                          aria-pressed={fav}
                        >
                          {fav ? '♥' : '♡'}
                        </button>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-1.5 hidden md:table-cell">
                    <StarRating
                      value={userStateByPath[t.rel_path]?.rating ?? 0}
                      onChange={(v) => setRating(t, v)}
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right text-zinc-400 tabular-nums">
                    {formatDuration(t.duration_sec)}
                  </td>
                  <td className="px-3 py-1.5 text-right text-zinc-500 tabular-nums hidden md:table-cell">
                    {formatBytes(t.size_bytes)}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100">
                      <button
                        onClick={() => playOne(t)}
                        className="w-7 h-7 rounded-full bezel text-zinc-300 hover:text-white flex items-center justify-center"
                        title="播放"
                      >
                        ▶
                      </button>
                      <button
                        onClick={() => enqueueOne(t)}
                        className="w-7 h-7 rounded-full bezel text-zinc-300 hover:text-white flex items-center justify-center"
                        title="加入播放队列"
                      >
                        +
                      </button>
                      <button
                        onClick={(e) => {
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          setAddingTo({ track: t, x: r.left, y: r.bottom + 4 });
                        }}
                        className="w-7 h-7 rounded-full bezel text-zinc-300 hover:text-pink-300 flex items-center justify-center"
                        title="加到 playlist"
                      >
                        ▤
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {addingTo && (
        <AddToPlaylistMenu
          track={localToTrack(
            addingTo.track,
            '', // url unused — the menu only reads track.id / rel_path
            userStateByPath[addingTo.track.rel_path],
          )}
          anchor={{ x: addingTo.x, y: addingTo.y }}
          onClose={() => setAddingTo(null)}
          onAdded={() => {
            // Bumping refreshLocalTrackIndex isn't strictly needed for
            // playlists (only EQ lookup uses it), but keeps PrefsContext
            // and IndexedDB in lockstep.
            void refreshLocalTrackIndex();
            // Tell the parent so the Sidebar reloads its playlist
            // counts after a successful add.
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
