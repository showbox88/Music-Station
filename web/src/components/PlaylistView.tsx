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
  const player = usePlayer();

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
      await api.reorderPlaylist(playlistId, next.map((t) => t.id));
    } catch (e: any) {
      setErr(`Reorder failed: ${e?.message ?? e}`);
      setData(prev); // revert
    }
  }

  async function remove(t: Track) {
    if (!confirm(`Remove "${t.title || t.rel_path}" from this playlist?`)) return;
    try {
      await api.removeTrackFromPlaylist(playlistId, t.id);
      load();
      onChanged();
    } catch (e: any) {
      alert(String(e?.message ?? e));
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-6 py-3 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
        {data ? (
          <>
            <div>
              <h2 className="text-lg font-semibold">{data.name}</h2>
              <div className="text-xs text-zinc-500">
                {data.tracks.length} track{data.tracks.length !== 1 ? 's' : ''}
                {data.description ? ` · ${data.description}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => data.tracks.length && player.playList(data.tracks, 0)}
                disabled={data.tracks.length === 0}
                className="px-3 py-1.5 rounded text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
              >
                ▶ Play
              </button>
              <button
                onClick={() => {
                  if (data.tracks.length === 0) return;
                  // Toggle shuffle on, then play
                  if (!player.shuffle) player.toggleShuffle();
                  player.playList(data.tracks, 0);
                }}
                disabled={data.tracks.length === 0}
                className="px-3 py-1.5 rounded text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
              >
                🔀 Shuffle
              </button>
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
          <thead className="text-xs uppercase text-zinc-500 sticky top-0 bg-zinc-950">
            <tr className="border-b border-zinc-800">
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
            {data?.tracks.map((t, idx) => (
              <tr key={t.id} className="border-b border-zinc-900 hover:bg-zinc-900/50">
                <td className="pl-6 text-zinc-500 tabular-nums">{idx + 1}</td>
                <td>
                  <button
                    onClick={() => data && player.playList(data.tracks, idx)}
                    title={
                      player.current?.id === t.id && player.isPlaying
                        ? 'Now playing'
                        : 'Play (queues this playlist)'
                    }
                    className={`inline-block w-6 h-6 leading-6 text-center rounded hover:bg-zinc-700 ${
                      player.current?.id === t.id ? 'text-blue-400' : 'text-zinc-400 hover:text-zinc-100'
                    }`}
                  >
                    {player.current?.id === t.id && player.isPlaying ? '♪' : '▶'}
                  </button>
                </td>
                <td className="py-1 pr-2">
                  <CoverThumb src={t.cover_url} size={32} />
                </td>
                <td className="py-2 pr-3 font-medium">
                  {t.last_edited_at && (
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 mr-2 align-middle"
                      title={`Edited ${t.last_edited_at}`}
                    />
                  )}
                  {t.title || '—'}
                </td>
                <td className="py-2 pr-3 text-zinc-400">{t.artist || '—'}</td>
                <td className="py-2 pr-3 text-zinc-400">{t.album || '—'}</td>
                <td className="py-2 pr-3">
                  <StarRating value={t.rating} />
                </td>
                <td className="py-2 pr-3 text-zinc-500 text-right tabular-nums">
                  {formatDuration(t.duration_sec)}
                </td>
                <td className="pr-6 text-right whitespace-nowrap">
                  <button
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    title="Move up"
                    className="text-zinc-500 hover:text-zinc-100 px-1 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => move(idx, 1)}
                    disabled={idx === (data?.tracks.length ?? 0) - 1}
                    title="Move down"
                    className="text-zinc-500 hover:text-zinc-100 px-1 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => remove(t)}
                    title="Remove from playlist"
                    className="text-zinc-500 hover:text-red-400 px-2"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {data && data.tracks.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-12 text-zinc-500">
                  No tracks in this playlist yet. Switch to All Tracks and click + to add.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
