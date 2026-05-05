/**
 * Left sidebar — pick "All Tracks" or one of the playlists.
 * Manages playlist creation, rename, delete.
 */
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { FavoritesOwner, Playlist } from '../types';
import { usePlayer } from '../player/PlayerContext';
import { useAuth } from '../AuthContext';
import FavoritesShareModal from './FavoritesShareModal';

export type View =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'user-favorites'; userId: number; ownerName: string }
  | { kind: 'lyrics-editor' }
  | { kind: 'admin' }
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
  const [favOwners, setFavOwners] = useState<FavoritesOwner[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [favShareOpen, setFavShareOpen] = useState(false);
  // Favorites section is auto-collapsed when the active view leaves it,
  // so the sidebar doesn't keep dangling "still highlighted" state after
  // the user navigates elsewhere. Manual click on the header still
  // toggles freely.
  const [favExpanded, setFavExpanded] = useState(false);
  const player = usePlayer();
  const { user } = useAuth();

  function load() {
    api
      .listPlaylists()
      .then((r) => setPlaylists(r.playlists))
      .catch((e) => setErr(String(e?.message ?? e)));
    api
      .visibleFavoritesOwners()
      .then((r) => setFavOwners(r.owners))
      .catch(() => setFavOwners([]));
  }
  useEffect(load, [refreshKey]);

  // Auto-collapse the Favorites group when the active view leaves it.
  // Auto-expand when something inside it becomes the view (e.g. via a
  // deep link or programmatic navigation).
  useEffect(() => {
    const inside = view.kind === 'favorites' || view.kind === 'user-favorites';
    setFavExpanded(inside);
  }, [view.kind]);

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
        {/* Favorites collapsible group:
            - clicking the header just toggles expand — no selected state
              ever shown on the header itself, it's pure structure.
            - "My Favorites" sub-item routes to the favorites view AND
              hosts the 🔗 share button.
            - Sub-items use a subtle selected style (left accent bar)
              that's distinct from the top-level All Tracks pill so the
              hierarchy stays readable. */}
        <div
          className={`w-full px-3 py-2 rounded-lg text-sm cursor-pointer flex items-center ${
            favExpanded ? 'bezel glow-text' : 'text-zinc-300 hover:bg-white/5'
          }`}
          onClick={() => setFavExpanded((v) => !v)}
        >
          <span className="inline-block w-5 text-center mr-1">{'♥︎'}</span>
          <span className="flex-1">Favorites</span>
        </div>
        {favExpanded && (
          <div className="ml-3 pl-2 border-l border-black/60 space-y-0.5">
            <div
              onClick={() => setView({ kind: 'favorites' })}
              className={`group w-full px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 cursor-pointer ${
                view.kind === 'favorites'
                  ? 'text-pink-300 bg-white/[0.04]'
                  : 'text-zinc-300 hover:bg-white/5'
              }`}
            >
              <span className="inline-block w-4 text-center text-zinc-500">♥</span>
              <span className="flex-1 truncate">My Favorites</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFavShareOpen(true);
                }}
                className="opacity-0 group-hover:opacity-100 text-xs px-1 text-zinc-400 hover:text-white"
                title="分享我的收藏"
              >
                🔗
              </button>
            </div>

            {favOwners.length > 0 && (
              <div className="text-[10px] uppercase text-zinc-600 px-3 pt-2 pb-0.5">
                Others Favorites
              </div>
            )}
            {favOwners.map((o) => {
              const selected =
                view.kind === 'user-favorites' && view.userId === o.user.id;
              const ownerLabel = o.user.display_name || o.user.username;
              return (
                <button
                  key={o.user.id}
                  onClick={() =>
                    setView({
                      kind: 'user-favorites',
                      userId: o.user.id,
                      ownerName: ownerLabel,
                    })
                  }
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm flex items-center gap-1 ${
                    selected
                      ? 'text-pink-300 bg-white/[0.04]'
                      : 'text-zinc-400 hover:bg-white/5'
                  }`}
                  title={
                    o.shared_with_me
                      ? `${ownerLabel} 把收藏分享给了你`
                      : `${ownerLabel} 的收藏是公开的`
                  }
                >
                  <span className="inline-block w-4 text-center text-zinc-500">♥</span>
                  <span className="flex-1 truncate">{ownerLabel}</span>
                  {o.shared_with_me ? (
                    <span className="text-[9px] uppercase text-pink-300/70">分享</span>
                  ) : (
                    <span className="text-[9px] uppercase text-zinc-500/70">公开</span>
                  )}
                  <span className="text-[10px] text-zinc-500 tabular-nums ml-1">
                    {o.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <button
          onClick={() => setView({ kind: 'lyrics-editor' })}
          className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
            view.kind === 'lyrics-editor' ? 'bezel glow-text' : 'text-zinc-300 hover:bg-white/5'
          }`}
          title="边听边按空格打时间戳，制作 LRC 同步歌词"
        >
          <span className="inline-block w-5 text-center mr-1">{'✎︎'}</span>Lyrics Editor
        </button>
        {!!user?.is_admin && (
          <button
            onClick={() => setView({ kind: 'admin' })}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
              view.kind === 'admin' ? 'bezel glow-text' : 'text-zinc-300 hover:bg-white/5'
            }`}
            title="用户管理（仅管理员）"
          >
            <span className="inline-block w-5 text-center mr-1">{'⚙︎'}</span>Admin
          </button>
        )}
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
          // Sharing badge — show only for non-owned playlists.
          const ownerLabel = pl.owner_display_name || pl.owner_username || '';
          const badge = pl.is_owner
            ? pl.is_public
              ? { text: '公开', cls: 'text-emerald-300/80', title: '所有用户可见' }
              : null
            : pl.shared_with_me
              ? {
                  text: `← ${ownerLabel}`,
                  cls: 'text-pink-300/80',
                  title: `${ownerLabel} 把这个列表分享给了你`,
                }
              : pl.is_public
                ? {
                    text: `公开 · ${ownerLabel}`,
                    cls: 'text-zinc-400/80',
                    title: `${ownerLabel} 把这个列表设为公开`,
                  }
                : null;
          return (
            <div
              key={pl.id}
              className={`group flex items-center px-2 py-1.5 rounded-lg text-sm cursor-pointer ${
                selected ? 'bezel glow-text' : 'text-zinc-300 hover:bg-white/5'
              }`}
              onClick={() => setView({ kind: 'playlist', id: pl.id })}
            >
              <span className="mr-2 opacity-70">▤</span>
              <span className="flex-1 min-w-0 truncate">
                <span className="truncate align-middle">{pl.name}</span>
                {badge && (
                  <span
                    className={`ml-1.5 text-[9px] uppercase ${badge.cls}`}
                    title={badge.title}
                  >
                    {badge.text}
                  </span>
                )}
              </span>
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
                {pl.is_owner && (
                  <>
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
                  </>
                )}
              </span>
            </div>
          );
        })}

        {playlists.length === 0 && !creating && (
          <div className="text-xs text-zinc-600 px-2 py-3">No playlists yet.</div>
        )}

        {err && <div className="text-xs text-red-400 px-2 py-1">{err}</div>}
      </div>
      {favShareOpen && (
        <FavoritesShareModal
          onClose={() => setFavShareOpen(false)}
          onChanged={load}
        />
      )}
    </aside>
  );
}
