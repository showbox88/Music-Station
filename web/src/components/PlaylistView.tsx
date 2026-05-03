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
      <div className="px-6 py-3 border-b border-black/60 flex items-center justify-between"
        style={{ background: 'linear-gradient(180deg, #1c1c1e 0%, #18181a 100%)' }}>
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
                <td className="py-1 pl-3 pr-2 md:pl-0">
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
                <td className="pr-2 md:pr-4 text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1.5 md:gap-2">
                    {/* Reorder arrows are desktop-only — drag/up-down on
                        a phone is awkward, leave it for the desktop view. */}
                    <button
                      onClick={() => move(idx, -1)}
                      disabled={idx === 0}
                      title="Move up"
                      className="hidden md:flex w-8 h-8 rounded-full bezel items-center justify-center text-zinc-300 hover:text-white disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => move(idx, 1)}
                      disabled={idx === (data?.tracks.length ?? 0) - 1}
                      title="Move down"
                      className="hidden md:flex w-8 h-8 rounded-full bezel items-center justify-center text-zinc-300 hover:text-white disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => remove(t)}
                      title="Remove from playlist"
                      className="w-8 h-8 rounded-full bezel flex items-center justify-center text-zinc-300 hover:text-red-400"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                        <line x1="6" y1="6" x2="18" y2="18" />
                        <line x1="18" y1="6" x2="6" y2="18" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
              );
            })}
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
