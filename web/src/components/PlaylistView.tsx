/**
 * Single-playlist view: ordered tracks with ↑/↓ to reorder and × to remove.
 *
 * Reorder strategy: optimistic local swap + PUT /api/playlists/:id/order
 * with the new full order. If the server rejects, revert.
 */
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { PlaylistDetail, Track } from '../types';
import { usePlayer } from '../player/PlayerContext';
import StarRating from './StarRating';
import CoverThumb from './CoverThumb';
import EditTrackModal from './EditTrackModal';
import { useT } from '../i18n/useT';
import ModalShell from './Modal';
import UserSharePanel from './UserSharePanel';

interface Props {
  playlistId: number;
  refreshKey: number;
  onChanged: () => void;
}

function formatDuration(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function PlaylistView({ playlistId, refreshKey, onChanged }: Props) {
  const [data, setData] = useState<PlaylistDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Track | null>(null);
  const player = usePlayer();
  const t = useT();

  function load() {
    setLoading(true);
    setErr(null);
    api
      .getPlaylist(playlistId)
      .then(setData)
      .catch((e) => setErr(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }
  useEffect(load, [playlistId, refreshKey]);

  async function move(idx: number, dir: -1 | 1) {
    if (!data) return;
    const target = idx + dir;
    if (target < 0 || target >= data.tracks.length) return;
    const next = [...data.tracks];
    [next[idx], next[target]] = [next[target], next[idx]];
    const prev = data;
    setData({ ...data, tracks: next });
    try {
      await api.reorderPlaylist(playlistId, next.map((x) => x.id));
    } catch (e: any) {
      setErr(t('playlist_view.reorder_failed', { err: e?.message ?? String(e) }));
      setData(prev); // revert
    }
  }

  async function remove(track: Track) {
    if (!confirm(
      t('playlist_view.remove_confirm', { name: track.title || track.rel_path }),
    )) return;
    try {
      await api.removeTrackFromPlaylist(playlistId, track.id);
      load();
      onChanged();
    } catch (e: any) {
      alert(String(e?.message ?? e));
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-6 py-3 border-b border-black/60 flex flex-wrap items-center justify-between gap-2 surface-raised">
        {data ? (
          <>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold truncate">
                {data.name}
                {!data.is_owner && (
                  <span
                    className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded border border-pink-500/30 bg-pink-500/10 text-pink-300 align-middle"
                    title={t('common.owned_by', {
                      name: data.owner_display_name || data.owner_username || '',
                    })}
                  >
                    {data.shared_with_me
                      ? t('playlist_view.shared_from_owner', {
                          name: data.owner_display_name || data.owner_username || '',
                        })
                      : t('playlist_view.public_from_owner', {
                          name: data.owner_display_name || data.owner_username || '',
                        })}
                  </span>
                )}
                {data.is_owner && data.is_public && (
                  <span
                    className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 align-middle"
                    title={t('playlist_view.owner_public_tooltip')}
                  >
                    {t('playlist_view.owner_public_badge')}
                  </span>
                )}
              </h2>
              <div className="text-xs text-zinc-500">
                {data.tracks.length === 1
                  ? t('playlist_view.tracks_count', { count: 1 })
                  : t('playlist_view.tracks_count_plural', { count: data.tracks.length })}
                {data.description ? ` · ${data.description}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => data.tracks.length && player.playList(data.tracks, 0)}
                disabled={data.tracks.length === 0}
                className="btn-primary"
              >
                ▶ {t('playlist_view.play')}
              </button>
              <button
                onClick={() => {
                  if (data.tracks.length === 0) return;
                  if (!player.shuffle) player.toggleShuffle();
                  player.playList(data.tracks, 0);
                }}
                disabled={data.tracks.length === 0}
                className="btn-secondary disabled:opacity-50"
              >
                🔀 {t('playlist_view.shuffle')}
              </button>
              {data.is_owner && (
                <PlaylistShareControls playlist={data} onChanged={load} />
              )}
            </div>
          </>
        ) : (
          <div className="text-sm text-zinc-500">{loading ? 'Loading…' : ''}</div>
        )}
      </div>

      {err && (
        <div className="px-6 py-3 text-sm text-red-400 bg-red-950/30 border-b border-red-900">
          {err}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-zinc-500 sticky top-0" style={{ background: '#141415' }}>
            <tr className="border-b border-black/60">
              <th className="text-left font-medium py-2 pl-6 w-12">#</th>
              <th className="text-left font-medium py-2 w-10">▶</th>
              <th className="text-left font-medium py-2 w-12"></th>
              <th className="text-left font-medium py-2">Title</th>
              <th className="text-left font-medium py-2">Artist</th>
              <th className="text-left font-medium py-2">Album</th>
              <th className="text-left font-medium py-2 w-24">Rating</th>
              <th className="text-right font-medium py-2 w-20">Duration</th>
              <th className="text-right font-medium py-2 pr-6 w-28"></th>
            </tr>
          </thead>
          <tbody>
            {data?.tracks.map((track, idx) => {
              const isPlaying = player.current?.id === track.id;
              return (
              <tr
                key={track.id}
                onDoubleClick={() => setEditing(track)}
                className={`border-b border-black/40 cursor-default select-none ${
                  isPlaying ? '' : 'hover:bg-white/[0.03]'
                }`}
                style={isPlaying ? { background: 'rgba(255, 45, 181, 0.06)' } : undefined}
              >
                <td className="hidden md:table-cell pl-6 text-zinc-500 tabular-nums">{idx + 1}</td>
                <td className="hidden md:table-cell">
                  <button
                    onClick={() => data && player.playList(data.tracks, idx)}
                    title={
                      isPlaying && player.isPlaying
                        ? 'Now playing'
                        : 'Play (queues this playlist)'
                    }
                    className={`inline-flex items-center justify-center w-7 h-7 rounded-full bezel ${
                      isPlaying ? 'glow-text glow-ring' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {isPlaying && player.isPlaying ? '♪' : '▶'}
                  </button>
                </td>
                <td className="py-1 pl-3 pr-2 md:pl-4">
                  <button
                    onClick={() => {
                      if (isPlaying) {
                        player.togglePlay();
                      } else if (data) {
                        player.playList(data.tracks, idx);
                      }
                    }}
                    title={
                      isPlaying
                        ? player.isPlaying
                          ? 'Pause'
                          : 'Resume'
                        : 'Play'
                    }
                    className="md:hidden relative block rounded overflow-hidden"
                    style={{ width: 56, height: 56 }}
                  >
                    <CoverThumb src={track.cover_url} size={56} />
                    <span
                      className="absolute inset-0 flex items-center justify-center pointer-events-none"
                      style={{ color: 'rgba(255,255,255,0.6)' }}
                    >
                      {isPlaying && player.isPlaying ? (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6" y="5" width="4" height="14" />
                          <rect x="14" y="5" width="4" height="14" />
                        </svg>
                      ) : (
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </span>
                  </button>
                  <div className="hidden md:block">
                    <CoverThumb src={track.cover_url} size={56} />
                  </div>
                </td>
                <td className="py-2 pr-3 font-medium">
                  {track.last_edited_at && (
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 mr-2 align-middle"
                      title={`Edited ${track.last_edited_at}`}
                    />
                  )}
                  {track.title || '—'}
                </td>
                <td className="py-2 pr-3 text-zinc-400">{track.artist || '—'}</td>
                <td className="py-2 pr-3 text-zinc-400">{track.album || '—'}</td>
                <td className="py-2 pr-3">
                  <StarRating value={track.rating} />
                </td>
                <td className="py-2 pr-3 text-zinc-500 text-right tabular-nums">
                  {formatDuration(track.duration_sec)}
                </td>
                <td className="pr-2 md:pr-4 text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1.5 md:gap-2">
                    {/* Reorder + remove only for the playlist owner —
                        non-owners can play but not modify the list. */}
                    {data?.is_owner && (
                      <>
                        <button
                          onClick={() => move(idx, -1)}
                          disabled={idx === 0}
                          title={t('playlist_view.move_up')}
                          className="hidden md:flex w-8 h-8 rounded-full bezel items-center justify-center text-zinc-300 hover:text-white disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => move(idx, 1)}
                          disabled={idx === (data?.tracks.length ?? 0) - 1}
                          title={t('playlist_view.move_down')}
                          className="hidden md:flex w-8 h-8 rounded-full bezel items-center justify-center text-zinc-300 hover:text-white disabled:opacity-30"
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => remove(track)}
                          title={t('playlist_view.remove_tooltip')}
                          className="w-8 h-8 rounded-full bezel flex items-center justify-center text-zinc-300 hover:text-red-400"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                            <line x1="6" y1="6" x2="18" y2="18" />
                            <line x1="18" y1="6" x2="6" y2="18" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
            {data && data.tracks.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-12 text-zinc-500">
                  {t('playlist_view.no_tracks')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditTrackModal
          track={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            // Patch local list so the row reflects the edit immediately
            setData((d) =>
              d
                ? { ...d, tracks: d.tracks.map((x) => (x.id === updated.id ? updated : x)) }
                : d,
            );
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/**
 * Visibility / share controls for a playlist owner. A button in the header
 * opens a modal: "公开" toggle + user checklist (replace semantics for the
 * share list). On change, calls onChanged() so the parent refreshes the
 * data (which updates the badge in the header + sidebar).
 */
function PlaylistShareControls({
  playlist,
  onChanged,
}: {
  playlist: PlaylistDetail;
  onChanged: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-full bezel text-sm text-zinc-300 hover:text-white"
        title={t('playlist_view.share_button_tooltip')}
      >
        🔗 {t('playlist_view.share_button')}
      </button>
      {open && (
        <PlaylistShareModal
          playlist={playlist}
          onClose={() => setOpen(false)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}

function PlaylistShareModal({
  playlist,
  onClose,
  onChanged,
}: {
  playlist: PlaylistDetail;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  return (
    <ModalShell onClose={onClose} maxWidth="max-w-md" className="p-6 space-y-3">
      <div>
        <h2 className="text-base font-semibold">
          {t('playlist_view.share_modal_title', { name: playlist.name })}
        </h2>
        <p className="text-xs text-zinc-500 mt-1">
          {t('playlist_view.share_modal_intro')}
        </p>
      </div>

      <UserSharePanel
        loadInitial={async () => {
          const r = await api.getPlaylistShares(playlist.id);
          return { is_public: playlist.is_public, shared_with: r.shared_with };
        }}
        setVisibility={(pub) => api.setPlaylistVisibility(playlist.id, pub)}
        setShares={(ids) => api.setPlaylistShares(playlist.id, ids)}
        onChanged={onChanged}
      />

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          className="btn-secondary"
        >
          {t('common.close')}
        </button>
      </div>
    </ModalShell>
  );
}
