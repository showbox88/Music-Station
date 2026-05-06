/**
 * Read-only view of another user's favorites list.
 *
 * Routed via Sidebar's "X 的收藏" entries when those users have made
 * their favorites public or shared with us.
 *
 * Behavior:
 *   - Header shows owner + 公开/分享自 badge.
 *   - Tracks are visible because of the favorites-share path; the server
 *     enforces visibility (non-shared favorites return 403).
 *   - You can play, favorite, edit your own metadata-equivalent fields
 *     (rating/favorite). The track-edit modal already gates owner
 *     metadata edits server-side.
 */
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { FavoritesView, Track } from '../types';
import { usePlayer } from '../player/PlayerContext';
import StarRating from './StarRating';
import CoverThumb from './CoverThumb';
import EditTrackModal from './EditTrackModal';
import TrackContextMenu from './TrackContextMenu';
import { useT } from '../i18n/useT';

interface Props {
  userId: number;
  ownerName: string;
  refreshKey: number;
  onChanged: () => void;
}

function fmtDur(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function UserFavoritesView({ userId, ownerName, refreshKey, onChanged }: Props) {
  const [data, setData] = useState<FavoritesView | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Track | null>(null);
  const [contextMenu, setContextMenu] = useState<{ track: Track; idx: number; x: number; y: number } | null>(null);
  const player = usePlayer();
  const t = useT();

  function load() {
    setLoading(true);
    setErr(null);
    api
      .getUserFavorites(userId)
      .then(setData)
      .catch((e) => setErr(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }
  useEffect(load, [userId, refreshKey]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-6 py-3 border-b border-black/60 flex flex-wrap items-center justify-between gap-2 surface-raised">
        {data ? (
          <>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold truncate">
                ♥ {t('user_favorites_view.title', {
                  name: data.user.display_name || data.user.username,
                })}
                <span
                  className={`ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded border align-middle ${
                    data.shared_with_me
                      ? 'border-pink-500/30 bg-pink-500/10 text-pink-300'
                      : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'
                  }`}
                >
                  {data.shared_with_me
                    ? t('user_favorites_view.shared_with_me_badge')
                    : t('user_favorites_view.public_badge')}
                </span>
              </h2>
              <div className="text-xs text-zinc-500">
                {t('user_favorites_view.n_tracks', { count: data.tracks.length })}
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
            </div>
          </>
        ) : (
          <div className="text-sm text-zinc-500">{loading ? t('common.loading') : err ? err : ''}</div>
        )}
      </div>

      {err && data === null && (
        <div className="px-6 py-3 text-sm text-red-400 bg-red-950/30 border-b border-red-900">
          {err.includes('403') ? t('user_favorites_view.no_access', { name: ownerName }) : err}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-zinc-500 sticky top-0" style={{ background: '#141415' }}>
            <tr className="border-b border-black/60">
              <th className="text-left font-medium py-2 pl-6 w-12">#</th>
              <th className="text-left font-medium py-2 w-10">▶</th>
              <th className="text-left font-medium py-2 w-12"></th>
              <th className="text-left font-medium py-2">{t('tracks.header.title')}</th>
              <th className="text-left font-medium py-2">{t('tracks.header.artist')}</th>
              <th className="text-left font-medium py-2">{t('tracks.header.album')}</th>
              <th className="text-left font-medium py-2 w-24">{t('tracks.header.rating')}</th>
              <th className="text-right font-medium py-2 pr-6 w-20">{t('tracks.header.duration')}</th>
            </tr>
          </thead>
          <tbody>
            {data?.tracks.map((track, idx) => {
              const isPlaying = player.current?.id === track.id;
              return (
                <tr
                  key={track.id}
                  onDoubleClick={() => data && player.playList(data.tracks, idx)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ track, idx, x: e.clientX, y: e.clientY });
                  }}
                  className={`border-b border-black/40 cursor-default select-none ${
                    isPlaying ? '' : 'hover:bg-white/[0.03]'
                  }`}
                  style={isPlaying ? { background: 'rgba(255, 45, 181, 0.06)' } : undefined}
                >
                  <td className="hidden md:table-cell pl-6 text-zinc-500 tabular-nums">
                    {idx + 1}
                  </td>
                  <td className="hidden md:table-cell">
                    <button
                      onClick={() => data && player.playList(data.tracks, idx)}
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
                        if (isPlaying) player.togglePlay();
                        else if (data) player.playList(data.tracks, idx);
                      }}
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
                    {track.title || '—'}
                    {!track.is_owner && (
                      <span
                        className="ml-1.5 text-[9px] uppercase text-zinc-500"
                        title={t('common.owned_by', {
                          name: track.owner_display_name || track.owner_username || '',
                        })}
                      >
                        · {track.owner_display_name || track.owner_username}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-zinc-400">{track.artist || '—'}</td>
                  <td className="py-2 pr-3 text-zinc-400">{track.album || '—'}</td>
                  <td className="py-2 pr-3">
                    <StarRating value={track.rating} />
                  </td>
                  <td className="py-2 pr-6 text-zinc-500 text-right tabular-nums">
                    {fmtDur(track.duration_sec)}
                  </td>
                </tr>
              );
            })}
            {data && data.tracks.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-12 text-zinc-500">
                  {t('user_favorites_view.no_tracks')}
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
            setData((d) =>
              d
                ? { ...d, tracks: d.tracks.map((x) => (x.id === updated.id ? updated : x)) }
                : d,
            );
            onChanged();
          }}
        />
      )}

      {contextMenu && (
        <TrackContextMenu
          anchor={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onPlay={() => data && player.playList(data.tracks, contextMenu.idx)}
          onEdit={() => setEditing(contextMenu.track)}
        />
      )}
    </div>
  );
}
