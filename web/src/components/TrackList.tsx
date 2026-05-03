import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Track } from '../types';
import EditTrackModal from './EditTrackModal';
import AddToPlaylistMenu from './AddToPlaylistMenu';
import StarRating from './StarRating';
import CoverThumb from './CoverThumb';
import { usePlayer } from '../player/PlayerContext';

function formatDuration(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatBytes(b: number): string {
  if (b > 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}

interface Props {
  refreshKey: number;
  onChanged?: () => void;
}

export default function TrackList({ refreshKey, onChanged }: Props) {
  const [q, setQ] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Track | null>(null);
  const [addingTo, setAddingTo] = useState<{ track: Track; x: number; y: number } | null>(null);
  const player = usePlayer();

  // Debounce search
  const [debouncedQ, setDebouncedQ] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    api
      .listTracks({ q: debouncedQ || undefined, limit: 500, sort: 'title', dir: 'asc' })
      .then((res) => {
        if (cancelled) return;
        setTracks(res.tracks);
        setTotal(res.total);
      })
      .catch((e) => !cancelled && setErr(String(e?.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, refreshKey]);

  const showing = useMemo(() => tracks.length, [tracks]);

  async function onDelete(t: Track) {
    if (!confirm(`Delete "${t.title || t.rel_path}"?\n\nThis removes the file from disk and the track from the library.`)) {
      return;
    }
    try {
      await api.deleteTrack(t.id);
      setTracks((prev) => prev.filter((x) => x.id !== t.id));
      setTotal((n) => n - 1);
      onChanged?.();
    } catch (e: any) {
      alert(`Delete failed: ${e?.message ?? e}`);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 md:px-6 py-3 border-b border-black/60 flex items-center gap-2 md:gap-3"
        style={{ background: 'linear-gradient(180deg, #1c1c1e 0%, #18181a 100%)' }}>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title / artist…"
          className="input flex-1 max-w-md"
        />
        <span className="text-xs text-zinc-500 tabular-nums shrink-0">
          {loading ? '…' : `${showing}/${total}`}
        </span>
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
              <th className="text-left font-medium py-2 pl-3 md:pl-6 w-10">▶</th>
              <th className="text-left font-medium py-2 w-12"></th>
              <th className="text-left font-medium py-2">Title</th>
              <th className="hidden md:table-cell text-left font-medium py-2">Artist</th>
              <th className="hidden lg:table-cell text-left font-medium py-2">Album</th>
              <th className="hidden xl:table-cell text-left font-medium py-2">Genre</th>
              <th className="hidden xl:table-cell text-left font-medium py-2 w-20">Year</th>
              <th className="hidden md:table-cell text-left font-medium py-2 w-24">Rating</th>
              <th className="hidden md:table-cell text-right font-medium py-2 w-20">Duration</th>
              <th className="text-right font-medium py-2 pr-3 md:pr-6 w-16 md:w-28"></th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((t) => {
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
                {/* Desktop play column (hidden on mobile — the cover
                    overlay below takes its place). */}
                <td className="hidden md:table-cell pl-3 md:pl-6">
                  <button
                    onClick={() => {
                      const idx = tracks.findIndex((x) => x.id === t.id);
                      player.playList(tracks, Math.max(0, idx));
                    }}
                    title={
                      isPlaying && player.isPlaying
                        ? 'Now playing'
                        : 'Play (queues this view)'
                    }
                    className={`inline-flex items-center justify-center w-7 h-7 rounded-full bezel ${
                      isPlaying ? 'glow-text glow-ring' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {isPlaying && player.isPlaying ? '♪' : '▶'}
                  </button>
                </td>
                <td className="py-1 pl-3 pr-2 md:pl-0">
                  {/* Mobile: cover with translucent play overlay; tap
                      anywhere on the cover to start playback. */}
                  <button
                    onClick={() => {
                      // Tapping the row of the currently-playing track is
                      // a play/pause toggle; tapping any other row queues
                      // the list and starts from there.
                      if (isPlaying) {
                        player.togglePlay();
                      } else {
                        const idx = tracks.findIndex((x) => x.id === t.id);
                        player.playList(tracks, Math.max(0, idx));
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
                  {/* Desktop: plain cover next to the dedicated play button column. */}
                  <div className="hidden md:block">
                    <CoverThumb src={t.cover_url} size={32} />
                  </div>
                </td>
                <td className="py-2 pr-3 font-medium min-w-0">
                  {t.last_edited_at && (
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 mr-2 align-middle"
                      title={`Edited ${t.last_edited_at}`}
                    />
                  )}
                  <div className="truncate">{t.title || '—'}</div>
                  {/* Mobile-only: artist stacked under title since the
                      Artist column is hidden below md. */}
                  <div className="md:hidden text-xs text-zinc-500 truncate mt-0.5">
                    {t.artist || '—'}
                  </div>
                </td>
                <td className="hidden md:table-cell py-2 pr-3 text-zinc-400">{t.artist || '—'}</td>
                <td className="hidden lg:table-cell py-2 pr-3 text-zinc-400">{t.album || '—'}</td>
                <td className="hidden xl:table-cell py-2 pr-3 text-zinc-500">{t.genre || '—'}</td>
                <td className="hidden xl:table-cell py-2 pr-3 text-zinc-500 tabular-nums">{t.year ?? '—'}</td>
                <td className="hidden md:table-cell py-2 pr-3">
                  <StarRating
                    value={t.rating}
                    onChange={async (v) => {
                      try {
                        const updated = await api.updateTrack(t.id, { rating: v });
                        setTracks((prev) =>
                          prev.map((x) => (x.id === t.id ? { ...updated, cover_url: x.cover_url } : x)),
                        );
                      } catch (e: any) {
                        alert(`Rating update failed: ${e?.message ?? e}`);
                      }
                    }}
                  />
                </td>
                <td className="hidden md:table-cell py-2 pr-3 text-zinc-500 text-right tabular-nums">
                  {formatDuration(t.duration_sec)}
                </td>
                <td className="pr-3 md:pr-6 text-right whitespace-nowrap">
                  <button
                    onClick={(e) => {
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setAddingTo({ track: t, x: r.left, y: r.bottom + 4 });
                    }}
                    title="Add to playlist"
                    className="text-zinc-500 hover:text-blue-400 px-2"
                  >
                    +
                  </button>
                  <button
                    onClick={() => setEditing(t)}
                    title="Edit metadata"
                    className="hidden md:inline text-zinc-500 hover:text-zinc-100 px-2"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => onDelete(t)}
                    title="Delete (file + DB)"
                    className="text-zinc-500 hover:text-red-400 px-2"
                  >
                    ✕
                  </button>
                </td>
              </tr>
              );
            })}
            {tracks.length === 0 && !loading && (
              <tr>
                <td colSpan={4} className="text-center py-12 text-zinc-500">
                  {debouncedQ ? `No tracks matching "${debouncedQ}"` : 'No tracks indexed yet. Drop MP3s into the music dir and click Rescan.'}
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
            setTracks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
          }}
        />
      )}

      {addingTo && (
        <AddToPlaylistMenu
          track={addingTo.track}
          anchor={{ x: addingTo.x, y: addingTo.y }}
          onClose={() => setAddingTo(null)}
          onAdded={() => onChanged?.()}
        />
      )}
    </div>
  );
}
