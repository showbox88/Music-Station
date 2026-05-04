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
  const player = usePlayer();

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
      <div
        className="px-6 py-3 border-b border-black/60 flex flex-wrap items-center justify-between gap-2"
        style={{ background: 'linear-gradient(180deg, #1c1c1e 0%, #18181a 100%)' }}
      >
        {data ? (
          <>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold truncate">
                ♥ {data.user.display_name || data.user.username} 的收藏
                <span
                  className={`ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded border align-middle ${
                    data.shared_with_me
                      ? 'border-pink-500/30 bg-pink-500/10 text-pink-300'
                      : 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'
                  }`}
                >
                  {data.shared_with_me ? '分享给我' : '公开'}
                </span>
              </h2>
              <div className="text-xs text-zinc-500">
                {data.tracks.length} 首
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => data.tracks.length && player.playList(data.tracks, 0)}
                disabled={data.tracks.length === 0}
                className="px-4 py-1.5 rounded-full bezel glow-text glow-ring text-sm disabled:opacity-50"
              >
                ▶ Play
              </button>
              <button
                onClick={() => {
                  if (data.tracks.length === 0) return;
                  if (!player.shuffle) player.toggleShuffle();
                  player.playList(data.tracks, 0);
                }}
                disabled={data.tracks.length === 0}
                className="px-4 py-1.5 rounded-full bezel text-sm text-zinc-300 hover:text-white disabled:opacity-50"
              >
                🔀 Shuffle
              </button>
            </div>
          </>
        ) : (
          <div className="text-sm text-zinc-500">{loading ? '加载中…' : err ? err : ''}</div>
        )}
      </div>

      {err && data === null && (
        <div className="px-6 py-3 text-sm text-red-400 bg-red-950/30 border-b border-red-900">
          {err.includes('403') ? `无权访问 ${ownerName} 的收藏` : err}
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
              <th className="text-right font-medium py-2 pr-6 w-20">Duration</th>
            </tr>
          </thead>
          <tbody>
            {data?.tracks.map((t, idx) => {
              const isPlaying = player.current?.id === t.id;
              return (
                <tr
                  key={t.id}
                  onDoubleClick={() => setEditing(t)}
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
                  <td className="py-1 pl-3 pr-2 md:pl-0">
                    <button
                      onClick={() => {
                        if (isPlaying) player.togglePlay();
                        else if (data) player.playList(data.tracks, idx);
                      }}
                      className="md:hidden relative block rounded overflow-hidden"
                      style={{ width: 56, height: 56 }}
                    >
                      <CoverThumb src={t.cover_url} size={56} />
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
                      <CoverThumb src={t.cover_url} size={32} />
                    </div>
                  </td>
                  <td className="py-2 pr-3 font-medium">
                    {t.title || '—'}
                    {!t.is_owner && (
                      <span
                        className="ml-1.5 text-[9px] uppercase text-zinc-500"
                        title={`所有者：${t.owner_display_name || t.owner_username}`}
                      >
                        · {t.owner_display_name || t.owner_username}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-zinc-400">{t.artist || '—'}</td>
                  <td className="py-2 pr-3 text-zinc-400">{t.album || '—'}</td>
                  <td className="py-2 pr-3">
                    <StarRating value={t.rating} />
                  </td>
                  <td className="py-2 pr-6 text-zinc-500 text-right tabular-nums">
                    {fmtDur(t.duration_sec)}
                  </td>
                </tr>
              );
            })}
            {data && data.tracks.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-12 text-zinc-500">
                  这位用户的收藏夹是空的。
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
    </div>
  );
}
