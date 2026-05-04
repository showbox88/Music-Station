/**
 * Left sidebar — pick "All Tracks" or one of the playlists.
 * Manages playlist creation, rename, delete.
 */
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Playlist } from '../types';
import { usePlayer } from '../player/PlayerContext';

export type View =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'lyrics-editor' }
  | { kind: 'playlist'; id: number };

interface Props {
  view: View;
  setView: (v: View) => void;
  refreshKey: number;          // bump to force reload
  onChanged: () => void;       // notify parent when something changed
  /** Mobile drawer open state. Ignored on >=md (sidebar is always visible). */
  open?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ view, setView, refreshKey, onChanged, open = false, onClose }: Props) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const player = usePlayer();

  function load() {
    api
      .listPlaylists()
      .then((r) => setPlaylists(r.playlists))
      .catch((e) => setErr(String(e?.message ?? e)));
  }
  useEffect(load, [refreshKey]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      const p = await api.createPlaylist(name);
      setNewName('');
      setCreating(false);
      load();
      setView({ kind: 'playlist', id: p.id });
      onChanged();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }

  async function onRename(p: Playlist) {
    const next = prompt('Rename playlist', p.name);
    if (!next || next.trim() === p.name) return;
    try {
      await api.updatePlaylist(p.id, { name: next.trim() });
      load();
      onChanged();
    } catch (e: any) {
      alert(String(e?.message ?? e));
    }
  }

  async function onPlayPlaylist(p: Playlist) {
    if (p.track_count === 0) return;
    try {
      const detail = await api.getPlaylist(p.id);
      player.playList(detail.tracks, 0);
    } catch (e: any) {
      alert(`Failed to start playlist: ${e?.message ?? e}`);
    }
  }

  async function onDelete(p: Playlist) {
    if (!confirm(`Delete playlist "${p.name}"? This does NOT delete the tracks.`)) return;
    try {
      await api.deletePlaylist(p.id);
      if (view.kind === 'playlist' && view.id === p.id) setView({ kind: 'all' });
      load();
      onChanged();
    } catch (e: any) {
      alert(String(e?.message ?? e));
    }
  }

  return (
    <aside
      className={`
        w-64 shrink-0 border-r border-black/80 flex flex-col
        fixed inset-y-0 left-0 z-40 transform transition-transform duration-200
        ${open ? 'translate-x-0' : '-translate-x-full'}
        md:static md:translate-x-0 md:w-56
      `}
      style={{
        background: 'linear-gradient(180deg, #1a1a1c 0%, #141415 100%)',
        boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.04)',
      }}
    >
      {/* Mobile-only header strip with close button */}
      <div className="md:hidden flex items-center justify-between px-3 py-2 border-b border-black/60">
        <span className="text-xs uppercase tracking-wide text-zinc-500">Library</span>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-full bezel text-zinc-300 hover:text-white flex items-center justify-center"
          title="Close menu"
        >
          ✕
        </button>
      </div>
      <div className="p-3 border-b border-black/60 space-y-1">
        <button
          onClick={() => setView({ kind: 'all' })}
          className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
            view.kind === 'all' ? 'bezel glow-text' : 'text-zinc-300 hover:bg-white/5'
          }`}
        >
          <span className="inline-block w-5 text-center mr-1">{'♪︎'}</span>All Tracks
        </button>
        <button
          onClick={() => setView({ kind: 'favorites' })}
          className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
            view.kind === 'favorites' ? 'bezel glow-text' : 'text-zinc-300 hover:bg-white/5'
          }`}
        >
          <span className="inline-block w-5 text-center mr-1">{'♥︎'}</span>Favorites
        </button>
        <button
          onClick={() => setView({ kind: 'lyrics-editor' })}
          className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
            view.kind === 'lyrics-editor' ? 'bezel glow-text' : 'text-zinc-300 hover:bg-white/5'
          }`}
          title="边听边按空格打时间戳，制作 LRC 同步歌词"
        >
          <span className="inline-block w-5 text-center mr-1">{'✎︎'}</span>Lyrics Editor
        </button>
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-0.5">
        <div className="text-xs uppercase text-zinc-500 px-2 py-1 flex items-center justify-between">
          <span>Playlists</span>
          <button
            onClick={() => setCreating((c) => !c)}
            className="w-6 h-6 rounded-full bezel text-zinc-300 hover:text-white flex items-center justify-center"
            title="New playlist"
          >
            +
          </button>
        </div>

        {creating && (
          <form onSubmit={onCreate} className="px-2 pb-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Playlist name"
              autoFocus
              onBlur={() => !newName && setCreating(false)}
              className="input text-xs"
            />
          </form>
        )}

        {playlists.map((pl) => {
          const selected = view.kind === 'playlist' && view.id === pl.id;
          return (
            <div
              key={pl.id}
              className={`group flex items-center px-2 py-1.5 rounded-lg text-sm cursor-pointer ${
                selected ? 'bezel glow-text' : 'text-zinc-300 hover:bg-white/5'
              }`}
              onClick={() => setView({ kind: 'playlist', id: pl.id })}
            >
              <span className="mr-2 opacity-70">▤</span>
              <span className="flex-1 truncate">{pl.name}</span>
              <span className="text-xs text-zinc-500 ml-2 tabular-nums">{pl.track_count}</span>
              <span className="ml-2 opacity-0 group-hover:opacity-100 flex gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayPlaylist(pl);
                  }}
                  className="text-xs px-1 glow-text disabled:opacity-30"
                  title="Play playlist"
                  disabled={pl.track_count === 0}
                >
                  ▶
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRename(pl);
                  }}
                  className="text-xs px-1 text-zinc-400 hover:text-white"
                  title="Rename"
                >
                  ✎
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(pl);
                  }}
                  className="text-xs px-1 text-zinc-400 hover:text-red-400"
                  title="Delete"
                >
                  ✕
                </button>
              </span>
            </div>
          );
        })}

        {playlists.length === 0 && !creating && (
          <div className="text-xs text-zinc-600 px-2 py-3">No playlists yet.</div>
        )}

        {err && <div className="text-xs text-red-400 px-2 py-1">{err}</div>}
      </div>
    </aside>
  );
}
