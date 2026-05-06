/**
 * Left sidebar — pick "All Tracks" or one of the playlists.
 * Manages playlist creation, rename, delete.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { FavoritesOwner, Playlist } from '../types';
import { usePlayer } from '../player/PlayerContext';
import { useAuth } from '../AuthContext';
import { useT } from '../i18n/useT';
import FavoritesShareModal from './FavoritesShareModal';

export type View =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'user-favorites'; userId: number; ownerName: string }
  | { kind: 'lyrics-editor' }
  | { kind: 'visualizer-lab' }
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
  const player = usePlayer();
  const { user } = useAuth();
  const t = useT();

  // Top-level highlight is purely a function of the active view: exactly
  // one main item lights up at a time, the rest go dark. Clicking
  // Favorites is equivalent to "go to My Favorites" — that's what fires
  // both the highlight and the auto-expansion below.
  const favExpanded = view.kind === 'favorites' || view.kind === 'user-favorites';
  const playlistsActive = view.kind === 'playlist';

  // Group playlists by visibility relationship for the sidebar. Order:
  //   1. mine            — playlists I own
  //   2. shared with me  — explicit per-user shares
  //   3. public          — public from someone else (not shared directly)
  const playlistGroups = useMemo(() => {
    const mine: typeof playlists = [];
    const shared: typeof playlists = [];
    const pub: typeof playlists = [];
    for (const p of playlists) {
      if (p.is_owner) mine.push(p);
      else if (p.shared_with_me) shared.push(p);
      else if (p.is_public) pub.push(p);
    }
    return { mine, shared, pub };
  }, [playlists]);

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
      player.playList(detail.tracks, 0, p.id);
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
          <span className="inline-block w-5 text-center mr-1">{'♪︎'}</span>
          {t('sidebar.all_tracks')}
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
          onClick={() => setView({ kind: 'favorites' })}
        >
          <span className="inline-block w-5 text-center mr-1">{'♥︎'}</span>
          <span className="flex-1">{t('sidebar.favorites')}</span>
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
              <span className="flex-1 truncate">{t('sidebar.my_favorites')}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setFavShareOpen(true);
                }}
                className="opacity-0 group-hover:opacity-100 text-xs px-1 text-zinc-400 hover:text-white"
                title={t('sidebar.share_favorites_tooltip')}
              >
                🔗
              </button>
            </div>

            {favOwners.length > 0 && (
              <div className="text-[10px] uppercase text-zinc-600 px-3 pt-2 pb-0.5">
                {t('sidebar.others_favorites')}
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
                      ? t('sidebar.shared_with_you_tooltip', { name: ownerLabel })
                      : t('sidebar.user_favorites_public_tooltip', { name: ownerLabel })
                  }
                >
                  <span className="inline-block w-4 text-center text-zinc-500">♥</span>
                  <span className="flex-1 truncate">{ownerLabel}</span>
                  {o.shared_with_me ? (
                    <span className="text-[9px] uppercase text-pink-300/70">
                      {t('sidebar.shared_short')}
                    </span>
                  ) : (
                    <span className="text-[9px] uppercase text-zinc-500/70">
                      {t('sidebar.public_short')}
                    </span>
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
          title={t('sidebar.lyrics_editor_tooltip')}
        >
          <span className="inline-block w-5 text-center mr-1">{'✎︎'}</span>
          {t('sidebar.lyrics_editor')}
        </button>
        <button
          onClick={() => setView({ kind: 'visualizer-lab' })}
          className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
            view.kind === 'visualizer-lab' ? 'bezel glow-text' : 'text-zinc-300 hover:bg-white/5'
          }`}
          title={t('sidebar.visualizer_lab_tooltip')}
        >
          <span className="inline-block w-5 text-center mr-1">{'◐'}</span>
          {t('sidebar.visualizer_lab')}
        </button>
        {!!user?.is_admin && (
          <button
            onClick={() => setView({ kind: 'admin' })}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
              view.kind === 'admin' ? 'bezel glow-text' : 'text-zinc-300 hover:bg-white/5'
            }`}
            title={t('sidebar.admin_tooltip')}
          >
            <span className="inline-block w-5 text-center mr-1">{'⚙︎'}</span>
            {t('sidebar.admin')}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-0.5">
        {/* Playlists header — same highlight rule as the main items
            (lights up when any playlist is the active view). */}
        <div
          className={`flex items-center px-3 py-2 rounded-lg text-sm ${
            playlistsActive ? 'bezel glow-text' : 'text-zinc-300'
          }`}
        >
          <span className="inline-block w-5 text-center mr-1">{'▤'}</span>
          <span className="flex-1">{t('sidebar.playlists')}</span>
          <button
            onClick={() => setCreating((c) => !c)}
            className="w-6 h-6 rounded-full bezel text-zinc-300 hover:text-white flex items-center justify-center"
            title={t('sidebar.new_playlist')}
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
              placeholder={t('sidebar.playlist_name_placeholder')}
              autoFocus
              onBlur={() => !newName && setCreating(false)}
              className="input text-xs"
            />
          </form>
        )}

        {/* Group sub-headers + rows. Each group only renders if non-empty
            so the divider doesn't dangle over thin air. */}
        <div className="ml-3 pl-2 border-l border-black/60 space-y-0.5">
          {playlistGroups.mine.length > 0 && (
            <>
              <div className="text-[10px] uppercase text-zinc-600 px-3 pt-1.5 pb-0.5">
                {t('sidebar.group_mine')}
              </div>
              {playlistGroups.mine.map((pl) => (
                <PlaylistRow
                  key={pl.id}
                  pl={pl}
                  selected={view.kind === 'playlist' && view.id === pl.id}
                  nowPlaying={player.currentPlaylistId === pl.id}
                  onSelect={() => setView({ kind: 'playlist', id: pl.id })}
                  onPlay={() => onPlayPlaylist(pl)}
                  onRename={() => onRename(pl)}
                  onDelete={() => onDelete(pl)}
                />
              ))}
            </>
          )}
          {playlistGroups.shared.length > 0 && (
            <>
              <div className="text-[10px] uppercase text-zinc-600 px-3 pt-2 pb-0.5">
                {t('sidebar.group_shared')}
              </div>
              {playlistGroups.shared.map((pl) => (
                <PlaylistRow
                  key={pl.id}
                  pl={pl}
                  selected={view.kind === 'playlist' && view.id === pl.id}
                  nowPlaying={player.currentPlaylistId === pl.id}
                  onSelect={() => setView({ kind: 'playlist', id: pl.id })}
                  onPlay={() => onPlayPlaylist(pl)}
                />
              ))}
            </>
          )}
          {playlistGroups.pub.length > 0 && (
            <>
              <div className="text-[10px] uppercase text-zinc-600 px-3 pt-2 pb-0.5">
                {t('sidebar.group_public')}
              </div>
              {playlistGroups.pub.map((pl) => (
                <PlaylistRow
                  key={pl.id}
                  pl={pl}
                  selected={view.kind === 'playlist' && view.id === pl.id}
                  nowPlaying={player.currentPlaylistId === pl.id}
                  onSelect={() => setView({ kind: 'playlist', id: pl.id })}
                  onPlay={() => onPlayPlaylist(pl)}
                />
              ))}
            </>
          )}

          {playlists.length === 0 && !creating && (
            <div className="text-xs text-zinc-600 px-2 py-3">{t('sidebar.no_playlists')}</div>
          )}
        </div>

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

/**
 * Single playlist row in the sidebar. Used inside each visibility group
 * (mine / shared / public). Owner-only row controls (rename, delete) are
 * gated by passing handlers — non-owners pass undefined and they don't
 * render. The selection style matches the Favorites sub-items: pink text
 * + faint bg tint, deliberately weaker than the top-level pill so the
 * hierarchy reads cleanly.
 */
function PlaylistRow({
  pl,
  selected,
  nowPlaying,
  onSelect,
  onPlay,
  onRename,
  onDelete,
}: {
  pl: Playlist;
  selected: boolean;
  nowPlaying: boolean;
  onSelect: () => void;
  onPlay: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  const ownerLabel = pl.owner_display_name || pl.owner_username || '';
  // Side-marker badge is only useful inside the "shared" / "public" groups
  // (showing the source). The group header already says which group, so
  // we keep just the owner name as a small dim hint.
  const ownerHint = !pl.is_owner ? ownerLabel : '';
  return (
    <div
      className={`group flex items-center px-3 py-1.5 rounded-lg text-sm cursor-pointer ${
        selected
          ? 'text-pink-300 bg-white/[0.04]'
          : nowPlaying
            ? 'text-fuchsia-400 bg-white/[0.03]'
            : 'text-zinc-300 hover:bg-white/5'
      }`}
      onClick={onSelect}
    >
      <span className="mr-2 opacity-70">{nowPlaying ? '♪' : '▤'}</span>
      <span className="flex-1 min-w-0 truncate">
        <span className="truncate align-middle">{pl.name}</span>
        {ownerHint && (
          <span className="ml-1.5 text-[9px] uppercase text-zinc-500">
            {ownerHint}
          </span>
        )}
      </span>
      <span className="text-xs text-zinc-500 ml-2 tabular-nums">{pl.track_count}</span>
      <span className="ml-2 opacity-0 group-hover:opacity-100 flex gap-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlay();
          }}
          className="text-xs px-1 glow-text disabled:opacity-30"
          title="Play playlist"
          disabled={pl.track_count === 0}
        >
          ▶
        </button>
        {onRename && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRename();
            }}
            className="text-xs px-1 text-zinc-400 hover:text-white"
            title="Rename"
          >
            ✎
          </button>
        )}
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-xs px-1 text-zinc-400 hover:text-red-400"
            title="Delete"
          >
            ✕
          </button>
        )}
      </span>
    </div>
  );
}
