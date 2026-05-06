import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Track } from '../types';
import EditTrackModal from './EditTrackModal';
import AddToPlaylistMenu from './AddToPlaylistMenu';
import TrackContextMenu from './TrackContextMenu';
import StarRating from './StarRating';
import CoverThumb from './CoverThumb';
import { usePlayer } from '../player/PlayerContext';
import { useT } from '../i18n/useT';

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
  /** When true, only tracks with favorited=true are listed (Favorites view). */
  favoritedOnly?: boolean;
}

type SourceFilter = 'all' | 'mine' | 'public' | 'shared';

export default function TrackList({ refreshKey, onChanged, favoritedOnly = false }: Props) {
  const [q, setQ] = useState('');
  const [source, setSource] = useState<SourceFilter>('all');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Track | null>(null);
  const [addingTo, setAddingTo] = useState<{ track: Track; x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ track: Track; x: number; y: number } | null>(null);
  const player = usePlayer();
  const t = useT();

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
      .listTracks({
        q: debouncedQ || undefined,
        favorited: favoritedOnly || undefined,
        source: source === 'all' ? undefined : source,
        limit: 500,
        sort: 'title',
        dir: 'asc',
      })
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
  }, [debouncedQ, refreshKey, favoritedOnly, source]);

  const showing = useMemo(() => tracks.length, [tracks]);

  async function onDelete(track: Track) {
    if (!confirm(t('tracks.delete_confirm', { name: track.title || track.rel_path }))) {
      return;
    }
    try {
      await api.deleteTrack(track.id);
      setTracks((prev) => prev.filter((x) => x.id !== track.id));
      setTotal((n) => n - 1);
      onChanged?.();
    } catch (e: any) {
      alert(t('tracks.delete_failed', { err: e?.message ?? String(e) }));
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 md:px-6 py-3 border-b border-black/60 flex flex-wrap items-center gap-2 md:gap-3 surface-raised">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('tracks.search_placeholder')}
          className="input flex-1 max-w-md min-w-0"
        />
        {!favoritedOnly && (
          <div className="flex items-center gap-1 shrink-0">
            {(
              [
                ['all', t('tracks.filter.all')],
                ['mine', t('tracks.filter.mine')],
                ['public', t('tracks.filter.public')],
                ['shared', t('tracks.filter.shared')],
              ] as Array<[SourceFilter, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setSource(key)}
                className={`text-[11px] px-2.5 py-1 rounded-full bezel ${
                  source === key
                    ? 'glow-text glow-ring text-white'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <span className="text-xs text-zinc-500 tabular-nums shrink-0 ml-auto">
          {loading ? '…' : `${showing}/${total}`}
        </span>
      </div>

      {err && (
        <div className="px-6 py-3 text-sm text-red-400 bg-red-950/30 border-b border-red-900">
          {err}
        </div>
      )}

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <table className="w-full text-sm table-fixed">
          <thead className="text-xs uppercase text-zinc-500 sticky top-0" style={{ background: '#141415' }}>
            <tr className="border-b border-black/60">
              {/* Headers must mirror the body cells' visibility, otherwise
                  the column widths drift and rows leave empty space. */}
              <th className="hidden md:table-cell text-left font-medium py-2 pl-6 w-10">▶</th>
              <th className="text-left font-medium py-2 w-20 md:w-20"></th>
              <th className="text-left font-medium py-2">{t('tracks.header.title')}</th>
              <th className="hidden md:table-cell text-left font-medium py-2 md:w-44 lg:w-48">{t('tracks.header.artist')}</th>
              <th className="hidden lg:table-cell text-left font-medium py-2 lg:w-48">{t('tracks.header.album')}</th>
              <th className="hidden xl:table-cell text-left font-medium py-2 xl:w-32">{t('tracks.header.genre')}</th>
              <th className="hidden xl:table-cell text-left font-medium py-2 w-20">{t('tracks.header.year')}</th>
              <th className="hidden md:table-cell text-left font-medium py-2 w-24">{t('tracks.header.rating')}</th>
              <th className="hidden md:table-cell text-right font-medium py-2 w-20">{t('tracks.header.duration')}</th>
              <th className="text-right font-medium py-2 pr-2 md:pr-4 w-20 md:w-32"></th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((track) => {
              const isPlaying = player.current?.id === track.id;
              return (
              <tr
                key={track.id}
                onDoubleClick={() => {
                  const idx = tracks.findIndex((x) => x.id === track.id);
                  player.playList(tracks, Math.max(0, idx));
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ track, x: e.clientX, y: e.clientY });
                }}
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
                      const idx = tracks.findIndex((x) => x.id === track.id);
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
                <td className="py-1 pl-3 pr-2 md:pl-4">
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
                        const idx = tracks.findIndex((x) => x.id === track.id);
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
                  {/* Desktop: plain cover next to the dedicated play button column. */}
                  <div className="hidden md:block">
                    <CoverThumb src={track.cover_url} size={56} />
                  </div>
                </td>
                <td className="py-2 pr-3 font-medium min-w-0 w-full">
                  {track.last_edited_at && (
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 mr-2 align-middle"
                      title={`Edited ${track.last_edited_at}`}
                    />
                  )}
                  <div className="truncate whitespace-nowrap flex items-center gap-1.5">
                    <span className="truncate">{track.title || '—'}</span>
                    <SourceBadge track={track} />
                  </div>
                  {/* Mobile-only second line: artist (truncated, never
                      wraps) on the left, star rating on the right. */}
                  <div className="md:hidden flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-xs text-zinc-500 truncate whitespace-nowrap min-w-0 flex-1">
                      {track.artist || '—'}
                    </span>
                    <span className="shrink-0">
                      <StarRating
                        value={track.rating}
                        onChange={async (v) => {
                          try {
                            const updated = await api.updateTrack(track.id, { rating: v });
                            setTracks((prev) =>
                              prev.map((x) =>
                                x.id === track.id ? { ...updated, cover_url: x.cover_url } : x,
                              ),
                            );
                          } catch (e: any) {
                            alert(t("tracks.rating_update_failed", { err: e?.message ?? String(e) }));
                          }
                        }}
                      />
                    </span>
                  </div>
                </td>
                <td className="hidden md:table-cell py-2 pr-3 text-zinc-400">{track.artist || '—'}</td>
                <td className="hidden lg:table-cell py-2 pr-3 text-zinc-400">{track.album || '—'}</td>
                <td className="hidden xl:table-cell py-2 pr-3 text-zinc-500">{track.genre || '—'}</td>
                <td className="hidden xl:table-cell py-2 pr-3 text-zinc-500 tabular-nums">{track.year ?? '—'}</td>
                <td className="hidden md:table-cell py-2 pr-3">
                  <StarRating
                    value={track.rating}
                    onChange={async (v) => {
                      try {
                        const updated = await api.updateTrack(track.id, { rating: v });
                        setTracks((prev) =>
                          prev.map((x) => (x.id === track.id ? { ...updated, cover_url: x.cover_url } : x)),
                        );
                      } catch (e: any) {
                        alert(t("tracks.rating_update_failed", { err: e?.message ?? String(e) }));
                      }
                    }}
                  />
                </td>
                <td className="hidden md:table-cell py-2 pr-3 text-zinc-500 text-right tabular-nums">
                  {formatDuration(track.duration_sec)}
                </td>
                <td className="pr-2 md:pr-4 text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1.5 md:gap-2">
                    <button
                      onClick={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setAddingTo({ track: track, x: r.left, y: r.bottom + 4 });
                      }}
                      title="Add to playlist"
                      className="w-8 h-8 rounded-full bezel flex items-center justify-center text-zinc-300 hover:text-blue-400"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setEditing(track)}
                      title="Edit metadata"
                      className="hidden md:flex w-8 h-8 rounded-full bezel items-center justify-center text-zinc-300 hover:text-white"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => onDelete(track)}
                      title={track.is_owner ? '' : t('tracks.delete_only_owner_tooltip')}
                      disabled={!track.is_owner}
                      className="w-8 h-8 rounded-full bezel flex items-center justify-center text-zinc-300 hover:text-red-400 disabled:opacity-30 disabled:hover:text-zinc-300"
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
            {tracks.length === 0 && !loading && (
              <tr>
                <td colSpan={10} className="text-center py-12 text-zinc-500">
                  {debouncedQ
                    ? t('tracks.no_results', { q: debouncedQ })
                    : t('tracks.no_tracks')}
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

      {contextMenu && (
        <TrackContextMenu
          anchor={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onPlay={() => {
            const idx = tracks.findIndex((x) => x.id === contextMenu.track.id);
            player.playList(tracks, Math.max(0, idx));
          }}
          onEdit={() => setEditing(contextMenu.track)}
          onAddToPlaylist={() =>
            setAddingTo({ track: contextMenu.track, x: contextMenu.x, y: contextMenu.y })
          }
          onDelete={
            contextMenu.track.is_owner ? () => onDelete(contextMenu.track) : undefined
          }
        />
      )}
    </div>
  );
}

/**
 * Tiny inline pill that says where this track came from for the calling
 * user. Only shown when not "mine" — the user owns most of their library
 * by default and a "mine" badge would just be noise.
 */
function SourceBadge({ track }: { track: Track }) {
  const t = useT();
  if (track.is_owner) {
    if (track.is_public) {
      return (
        <span
          className="text-[9px] uppercase px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 shrink-0"
          title={t('tracks.badge.public_tooltip')}
        >
          {t('tracks.badge.public')}
        </span>
      );
    }
    return null;
  }
  const ownerLabel =
    track.owner_display_name || track.owner_username || t('common.shared');
  if (track.shared_with_me) {
    return (
      <span
        className="text-[9px] uppercase px-1.5 py-0.5 rounded border border-pink-500/30 bg-pink-500/10 text-pink-300 shrink-0"
        title={t('tracks.badge.shared_tooltip', { name: ownerLabel })}
      >
        {t('tracks.badge.shared_from', { name: ownerLabel })}
      </span>
    );
  }
  if (track.is_public) {
    return (
      <span
        className="text-[9px] uppercase px-1.5 py-0.5 rounded border border-zinc-500/30 bg-zinc-500/10 text-zinc-300 shrink-0"
        title={t('tracks.badge.public_from_tooltip', { name: ownerLabel })}
      >
        {t('tracks.badge.public_from', { name: ownerLabel })}
      </span>
    );
  }
  return null;
}
