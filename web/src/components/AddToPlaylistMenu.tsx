/**
 * Tiny popover that lists existing playlists; click one to add the given
 * track. "+ New playlist" creates inline.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Playlist, Track } from '../types';

interface Props {
  track: Track;
  onClose: () => void;
  onAdded: () => void;
  anchor: { x: number; y: number };
}

export default function AddToPlaylistMenu({ track, onClose, onAdded, anchor }: Props) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .listPlaylists()
      .then((r) => setPlaylists(r.playlists))
      .catch((e) => setErr(String(e?.message ?? e)));
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

  async function add(p: Playlist) {
    setBusyId(p.id);
    setErr(null);
    try {
      await api.addTracksToPlaylist(p.id, [track.id]);
      onAdded();
      onClose();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusyId(null);
    }
  }

  async function createAndAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      const p = await api.createPlaylist(name);
      await api.addTracksToPlaylist(p.id, [track.id]);
      onAdded();
      onClose();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }

  // Position popover near anchor, keeping inside viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(anchor.x, window.innerWidth - 250),
    top: Math.min(anchor.y, window.innerHeight - 350),
    zIndex: 60,
  };

  return (
    <div
      ref={ref}
      style={style}
      className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-56 max-h-80 overflow-auto"
    >
      <div className="px-3 py-2 text-xs uppercase text-zinc-500 border-b border-zinc-800 truncate">
        Add to playlist
      </div>
      <div className="p-1">
        {playlists.map((p) => (
          <button
            key={p.id}
            onClick={() => add(p)}
            disabled={busyId === p.id}
            className="w-full text-left px-3 py-1.5 rounded text-sm hover:bg-zinc-800 flex items-center justify-between disabled:opacity-50"
          >
            <span className="truncate flex-1">{p.name}</span>
            <span className="text-xs text-zinc-500 ml-2">{p.track_count}</span>
          </button>
        ))}
        {playlists.length === 0 && (
          <div className="text-xs text-zinc-600 px-3 py-2">No playlists yet.</div>
        )}
      </div>
      <div className="border-t border-zinc-800 p-1">
        {creating ? (
          <form onSubmit={createAndAdd} className="px-2 py-1">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New playlist name"
              autoFocus
              onBlur={() => !newName.trim() && setCreating(false)}
              className="input text-xs"
            />
          </form>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="w-full text-left px-3 py-1.5 rounded text-sm hover:bg-zinc-800 text-blue-400"
          >
            + New playlist
          </button>
        )}
      </div>
      {err && <div className="px-3 py-1 text-xs text-red-400">{err}</div>}
    </div>
  );
}
