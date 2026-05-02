/**
 * Left sidebar — pick "All Tracks" or one of the playlists.
 * Manages playlist creation, rename, delete.
 */
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Playlist } from '../types';

export type View = { kind: 'all' } | { kind: 'playlist'; id: number };

interface Props {
  view: View;
  setView: (v: View) => void;
  refreshKey: number;          // bump to force reload
  onChanged: () => void;       // notify parent when something changed
}

export default function Sidebar({ view, setView, refreshKey, onChanged }: Props) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

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
    <aside className="w-56 shrink-0 border-r border-zinc-800 bg-zinc-900/40 flex flex-col">
      <div className="p-3 border-b border-zinc-800">
        <button
          onClick={() => setView({ kind: 'all' })}
          className={`w-full text-left px-3 py-1.5 rounded text-sm ${
            view.kind === 'all' ? 'bg-zinc-700' : 'hover:bg-zinc-800'
          }`}
        >
          🎵 All Tracks
        </button>
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-0.5">
        <div className="text-xs uppercase text-zinc-500 px-2 py-1 flex items-center justify-between">
          <span>Playlists</span>
          <button
            onClick={() => setCreating((c) => !c)}
            className="text-xs px-1.5 py-0.5 rounded hover:bg-zinc-800"
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

        {playlists.map((p) => {
          const selected = view.kind === 'playlist' && view.id === p.id;
          return (
            <div
              key={p.id}
              className={`group flex items-center px-2 py-1.5 rounded text-sm cursor-pointer ${
                selected ? 'bg-zinc-700' : 'hover:bg-zinc-800'
              }`}
              onClick={() => setView({ kind: 'playlist', id: p.id })}
            >
              <span className="mr-2">▤</span>
              <span className="flex-1 truncate">{p.name}</span>
              <span className="text-xs text-zinc-500 ml-2 tabular-nums">{p.track_count}</span>
              <span className="ml-2 opacity-0 group-hover:opacity-100 flex gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRename(p);
                  }}
                  className="text-xs px-1 hover:text-zinc-100"
                  title="Rename"
                >
                  ✎
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(p);
                  }}
                  className="text-xs px-1 hover:text-red-400"
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
