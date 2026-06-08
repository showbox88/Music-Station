/**
 * Tiny popover that lists existing playlists; click one to add the given
 * track. "+ New playlist" creates inline.
 *
 * Lists BOTH server playlists and browser-local playlists.
 * Rules at add-time:
 *   - server track + server playlist  → POST /api/playlists/:id/tracks
 *   - server track + local playlist   → IndexedDB addToLocalPlaylist
 *   - local track  + local playlist   → IndexedDB addToLocalPlaylist
 *   - local track  + server playlist  → DISABLED (server has no file).
 *     We render the entry greyed-out with a tooltip rather than hide
 *     it so users see the option exists but isn't reachable.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Playlist, Track } from '../types';
import {
  listLocalPlaylists,
  createLocalPlaylist,
  addToLocalPlaylist,
} from '../local/db';
import type { LocalPlaylist } from '../local/types';

interface Props {
  track: Track;
  onClose: () => void;
  onAdded: () => void;
  anchor: { x: number; y: number };
}

export default function AddToPlaylistMenu({ track, onClose, onAdded, anchor }: Props) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [localPlaylists, setLocalPlaylists] = useState<LocalPlaylist[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newScope, setNewScope] = useState<'server' | 'local'>('server');
  const [err, setErr] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const isLocalTrack = track.id < 0;

  useEffect(() => {
    api
      .listPlaylists()
      .then((r) => setPlaylists(r.playlists))
      .catch((e) => setErr(String(e?.message ?? e)));
    listLocalPlaylists()
      .then(setLocalPlaylists)
      .catch(() => setLocalPlaylists([]));
  }, []);

  // Close on outside click / Escape
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  async function addServer(p: Playlist) {
    if (isLocalTrack) return;
    const key = `s${p.id}`;
    setBusyKey(key);
    setErr(null);
    try {
      await api.addTracksToPlaylist(p.id, [track.id]);
      onAdded();
      onClose();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusyKey(null);
    }
  }

  async function addLocal(p: LocalPlaylist) {
    const key = `l${p.id}`;
    setBusyKey(key);
    setErr(null);
    try {
      const item = isLocalTrack
        ? { kind: 'local' as const, rel_path: track.rel_path }
        : { kind: 'server' as const, track_id: track.id };
      await addToLocalPlaylist(p.id, item);
      onAdded();
      onClose();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusyKey(null);
    }
  }

  async function createAndAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setErr(null);
    try {
      if (newScope === 'local') {
        const p = await createLocalPlaylist(name);
        await addLocal(p);
        return;
      }
      if (isLocalTrack) {
        setErr('本地曲目不能加进服务端 playlist。请选"本地"。');
        return;
      }
      const p = await api.createPlaylist(name);
      await api.addTracksToPlaylist(p.id, [track.id]);
      onAdded();
      onClose();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }

  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(anchor.x, window.innerWidth - 250),
    top: Math.min(anchor.y, window.innerHeight - 380),
    zIndex: 60,
  };

  return (
    <div
      ref={ref}
      style={{
        ...style,
        background: 'linear-gradient(180deg, #232325 0%, #18181a 100%)',
        border: '1px solid #050506',
        boxShadow:
          '0 12px 32px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 16px rgba(255,45,181,0.06)',
      }}
      className="rounded-lg w-60 max-h-96 overflow-auto"
    >
      <div className="px-3 py-2 text-xs uppercase text-zinc-500 border-b border-black/60 truncate flex items-center gap-1.5">
        <span>Add to playlist</span>
        {isLocalTrack && (
          <span
            className="text-[9px] uppercase text-pink-300/80"
            title="本地曲目只能加到本地 playlist"
          >
            local track
          </span>
        )}
      </div>

      <div className="p-1">
        {playlists.length > 0 && (
          <div className="text-[10px] uppercase text-zinc-600 px-3 pt-1 pb-0.5">
            服务端
          </div>
        )}
        {playlists.map((p) => {
          const disabled = isLocalTrack;
          return (
            <button
              key={`s${p.id}`}
              onClick={() => !disabled && addServer(p)}
              disabled={disabled || busyKey === `s${p.id}`}
              title={
                disabled ? '本地曲目不能直接加进服务端 playlist' : undefined
              }
              className={`w-full text-left px-3 py-1.5 rounded text-sm flex items-center justify-between disabled:opacity-30 ${
                disabled ? 'cursor-not-allowed' : 'hover:bg-white/5'
              }`}
            >
              <span className="truncate flex-1">{p.name}</span>
              <span className="text-xs text-zinc-500 ml-2">{p.track_count}</span>
            </button>
          );
        })}
      </div>

      <div className="p-1 border-t border-black/60">
        <div className="text-[10px] uppercase text-zinc-600 px-3 pt-1 pb-0.5 flex items-center gap-1.5">
          <span>本地</span>
          <span className="text-[8px] uppercase text-pink-300/70">local</span>
        </div>
        {localPlaylists.length > 0 ? (
          localPlaylists.map((p) => (
            <button
              key={`l${p.id}`}
              onClick={() => addLocal(p)}
              disabled={busyKey === `l${p.id}`}
              className="w-full text-left px-3 py-1.5 rounded text-sm hover:bg-white/5 flex items-center justify-between disabled:opacity-50"
            >
              <span className="truncate flex-1">{p.name}</span>
              <span className="text-xs text-zinc-500 ml-2">{p.items.length}</span>
            </button>
          ))
        ) : (
          <div className="text-xs text-zinc-600 px-3 py-1">还没有本地 playlist</div>
        )}
      </div>

      <div className="border-t border-black/60 p-1">
        {creating ? (
          <form onSubmit={createAndAdd} className="px-2 py-1 space-y-1">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New playlist name"
              autoFocus
              className="input text-xs"
            />
            <div className="flex gap-1 text-[10px]">
              {(
                [
                  ['server', '服务端'],
                  ['local', '本地'],
                ] as Array<['server' | 'local', string]>
              ).map(([k, label]) => {
                const disabled = k === 'server' && isLocalTrack;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => !disabled && setNewScope(k)}
                    disabled={disabled}
                    className={`px-2 py-0.5 rounded-full bezel ${
                      newScope === k
                        ? 'glow-text glow-ring text-white'
                        : 'text-zinc-400 hover:text-white'
                    } disabled:opacity-30 disabled:cursor-not-allowed`}
                    title={
                      disabled
                        ? '本地曲目只能加到本地 playlist'
                        : k === 'server'
                          ? '跨设备同步、可分享'
                          : '只存这台浏览器、可混本地曲目、不可分享'
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </form>
        ) : (
          <button
            onClick={() => {
              if (isLocalTrack) setNewScope('local');
              setCreating(true);
            }}
            className="w-full text-left px-3 py-1.5 rounded text-sm hover:bg-white/5 glow-text"
          >
            + New playlist
          </button>
        )}
      </div>
      {err && <div className="px-3 py-1 text-xs text-red-400">{err}</div>}
    </div>
  );
}
