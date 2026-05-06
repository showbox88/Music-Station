/**
 * Persistent bottom bar with playback controls.
 *
 * Visual: dark bezel chassis with magenta glow accents — matches the UI
 * mockup the user provided (recessed pill housing the prev/play/next
 * triplet, glowing pink play button, recessed slider tracks).
 */
import { useEffect, useState } from 'react';
import { usePlayer } from './PlayerContext';
import CoverThumb from '../components/CoverThumb';
import AddToPlaylistMenu from '../components/AddToPlaylistMenu';
import QueuePanel from './QueuePanel';
import { RepeatIcon, RepeatOneIcon, ShuffleIcon } from '../components/Icons';
import { api } from '../api';

interface Props {
  onExpand?: () => void;
  /** Called after a server-side library change so other views (e.g. the
   *  Favorites sidebar list) can refresh. */
  onLibraryChange?: () => void;
}

/* ---- Reusable per-track action icons ---- */

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function PlayerBar({ onExpand, onLibraryChange }: Props) {
  const p = usePlayer();
  // Optimistic favorite state — the queue's track object is shared and
  // doesn't update on its own; mirror locally for instant feedback and
  // reset whenever the playing track changes.
  const [favOpt, setFavOpt] = useState<boolean | null>(null);
  const [addingTo, setAddingTo] = useState<{ x: number; y: number } | null>(null);
  const [queueAnchor, setQueueAnchor] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    setFavOpt(null);
  }, [p.current?.id]);

  if (p.queue.length === 0 || !p.current) return null;

  const t = p.current;
  const isFav = favOpt ?? t.favorited;

  async function toggleFav() {
    if (!t) return;
    const next = !isFav;
    setFavOpt(next);
    try {
      await api.updateTrack(t.id, { favorited: next });
      // Mutate the shared track object so other places that read it
      // (NowPlayingView, lists) see the new value without a refetch.
      (t as { favorited: boolean }).favorited = next;
      onLibraryChange?.();
    } catch (err: any) {
      setFavOpt(!next);
      alert(`Favorite failed: ${err?.message ?? err}`);
    }
  }

  function openAddToPlaylist(e: React.MouseEvent<HTMLButtonElement>) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // Anchor above the button so the popover doesn't land off-screen on
    // a short viewport — AddToPlaylistMenu opens upward from this point.
    setAddingTo({ x: r.left, y: r.top - 8 });
  }

  function openQueue(e: React.MouseEvent<HTMLButtonElement>) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setQueueAnchor((prev) => (prev ? null : { x: r.left, y: r.top - 8 }));
  }

  const pct = p.duration > 0 ? (p.position / p.duration) * 100 : 0;

  return (
    <div
      className="border-t border-black/80 px-3 md:px-4 py-2 md:py-3 flex flex-wrap items-center gap-x-2 gap-y-2 md:flex-nowrap md:gap-4"
      style={{
        background: 'linear-gradient(180deg, #1f1f21 0%, #141415 100%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 -4px 12px rgba(0,0,0,0.5)',
      }}
    >
      {/* Mobile layout: 80px cover on the left; right column stacks
          title/artist (with queue counter at the end of the title line)
          on top of a row containing the larger transport pill (prev/
          play/next) and the smaller shuffle/repeat pair pushed to the
          right edge. Tapping cover or title opens the fullscreen
          player. */}
      <div className="md:hidden flex items-stretch gap-3 flex-1 min-w-0">
        <button
          onClick={onExpand}
          title="Open full player"
          className="shrink-0 rounded-md overflow-hidden"
          style={{ width: 80, height: 80 }}
        >
          <CoverThumb src={p.current.cover_url} size={80} />
        </button>
        <div className="flex-1 min-w-0 flex flex-col gap-2 py-0.5">
          <div className="flex items-start gap-2">
            <button
              onClick={onExpand}
              title="Open full player"
              className="min-w-0 flex-1 text-left rounded-lg px-1 py-0.5 hover:bg-white/5"
            >
              <div className="text-sm font-medium truncate whitespace-nowrap">
                {p.current.title || p.current.rel_path}
              </div>
              <div className="text-xs text-zinc-500 truncate whitespace-nowrap">
                {p.current.artist || '—'}
                {p.current.album ? ` · ${p.current.album}` : ''}
              </div>
            </button>
            {/* Counter on top, then mini per-track action buttons under
                it (slightly smaller than desktop's 8px squares). Same
                bezel + glow vocabulary as the rest of the bar. */}
            <div className="shrink-0 flex flex-col items-end gap-1 pt-0.5">
              <span className="text-[11px] text-zinc-500 tabular-nums leading-none">
                {(p.shuffle ? p.cursor : p.queue.findIndex((tr) => tr.id === p.current?.id)) + 1}
                /{p.queue.length}
              </span>
              <div className="flex items-center gap-1">
                <MiniBtn onClick={openAddToPlaylist} title="Add to playlist">
                  <PlusIcon />
                </MiniBtn>
                <MiniBtn
                  onClick={toggleFav}
                  title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                  active={isFav}
                  accent
                >
                  <HeartIcon filled={isFav} />
                </MiniBtn>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 px-1">
            {/* Main transport pill — bigger than mode buttons. prev/next
                = 40px, play = 48px. Generous gap-2 between the three. */}
            <div className="recess-pill flex items-center gap-2 px-2 py-1 shrink-0">
              <button
                onClick={p.prev}
                title="Previous"
                className="w-10 h-10 rounded-full bezel flex items-center justify-center text-zinc-300 hover:text-white"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 6h2v12H6zM9.5 12l8.5 6V6z" />
                </svg>
              </button>
              <button
                onClick={p.togglePlay}
                title={p.isPlaying ? 'Pause' : 'Play'}
                className="w-12 h-12 rounded-full play-btn flex items-center justify-center"
              >
                {p.isPlaying ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="5" width="4" height="14" />
                    <rect x="14" y="5" width="4" height="14" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
              <button
                onClick={p.next}
                title="Next"
                className="w-10 h-10 rounded-full bezel flex items-center justify-center text-zinc-300 hover:text-white"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" />
                </svg>
              </button>
            </div>
            {/* Modes hugged to the right edge of the row. */}
            <div className="flex items-center gap-2 ml-auto shrink-0">
              <ModeBtn active={p.shuffle} onClick={p.toggleShuffle} title="Shuffle">
                <ShuffleIcon />
              </ModeBtn>
              <ModeBtn active={p.repeat !== 'off'} onClick={p.cycleRepeat} title={`Repeat: ${p.repeat}`}>
                {p.repeat === 'one' ? <RepeatOneIcon /> : <RepeatIcon />}
              </ModeBtn>
              <ModeBtn active={queueAnchor !== null} onClick={openQueue} title="Queue">
                <QueueIcon />
              </ModeBtn>
            </div>
          </div>
        </div>
      </div>

      {/* Desktop layout: single button containing cover + text. */}
      <button
        onClick={onExpand}
        title="Open full player"
        className="hidden md:flex min-w-0 md:flex-none md:max-w-xs items-center gap-3 text-left rounded-lg px-1 md:px-2 py-1 hover:bg-white/5"
      >
        <CoverThumb src={p.current.cover_url} size={44} />
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{p.current.title || p.current.rel_path}</div>
          <div className="text-xs text-zinc-500 truncate">
            {p.current.artist || '—'}
            {p.current.album ? ` · ${p.current.album}` : ''}
          </div>
        </div>
      </button>

      {/* Transport pill — desktop only (on mobile the pill is embedded
          inside the cover/title block above). */}
      <div className="hidden md:flex recess-pill items-center gap-1 px-2 py-1 shrink-0">
        <TransportBtn onClick={p.prev} title="Previous">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h2v12H6zM9.5 12l8.5 6V6z" />
          </svg>
        </TransportBtn>
        <button
          onClick={p.togglePlay}
          title={p.isPlaying ? 'Pause' : 'Play'}
          className="w-10 h-10 rounded-full play-btn flex items-center justify-center"
        >
          {p.isPlaying ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" />
              <rect x="14" y="5" width="4" height="14" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <TransportBtn onClick={p.next} title="Next">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" />
          </svg>
        </TransportBtn>
      </div>

      {/* Progress — recessed track with magenta fill. min-w-full on
          mobile (paired with flex-wrap on the parent) forces it to its
          own line so the bar is wide enough to scrub on a phone. */}
      <div className="flex flex-1 items-center gap-2 min-w-full md:min-w-0">
        <span className="text-xs text-zinc-500 tabular-nums w-10 text-right">{fmt(p.position)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, p.duration)}
          step={0.5}
          value={p.position}
          onChange={(e) => p.seek(Number(e.target.value))}
          className="flex-1"
          style={{
            background: `linear-gradient(to right,
              var(--accent) 0%,
              var(--accent-soft) ${pct}%,
              #0a0a0b ${pct}%,
              #1a1a1c 100%)`,
            WebkitAppearance: 'none',
            height: 4,
            borderRadius: 9999,
            boxShadow: `inset 0 1px 2px rgba(0,0,0,0.8), 0 0 6px ${pct > 0 ? 'var(--accent-glow)' : 'transparent'}`,
          }}
        />
        <span className="text-xs text-zinc-500 tabular-nums w-10">{fmt(p.duration)}</span>
      </div>

      {/* Per-track actions + mode toggles (desktop only — mobile copies
          live inside the cover/title block). Same w-8 h-8 bezel circle
          across the row so add / favorite / shuffle / repeat read as one
          control cluster. */}
      <div className="hidden md:flex items-center gap-2 shrink-0">
        <ModeBtn onClick={openAddToPlaylist} title="Add to playlist">
          <PlusIcon />
        </ModeBtn>
        <ModeBtn
          onClick={toggleFav}
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
          active={isFav}
          accent
        >
          <HeartIcon filled={isFav} />
        </ModeBtn>
        <ModeBtn active={p.shuffle} onClick={p.toggleShuffle} title="Shuffle">
          <ShuffleIcon />
        </ModeBtn>
        <ModeBtn active={p.repeat !== 'off'} onClick={p.cycleRepeat} title={`Repeat: ${p.repeat}`}>
          {p.repeat === 'one' ? <RepeatOneIcon /> : <RepeatIcon />}
        </ModeBtn>
        <ModeBtn active={queueAnchor !== null} onClick={openQueue} title="Queue">
          <QueueIcon />
        </ModeBtn>
      </div>

      {/* Volume — recessed track (desktop only; mobile uses device volume) */}
      <div className="hidden md:flex items-center gap-2 shrink-0 w-32">
        <span className="text-xs text-zinc-500 tabular-nums w-6 text-right">
          {Math.round(p.volume * 100)}
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={p.volume}
          onChange={(e) => p.setVolume(Number(e.target.value))}
          className="flex-1"
          style={{
            background: `linear-gradient(to right,
              var(--accent) 0%,
              var(--accent-soft) ${p.volume * 100}%,
              #0a0a0b ${p.volume * 100}%,
              #1a1a1c 100%)`,
            WebkitAppearance: 'none',
            height: 4,
            borderRadius: 9999,
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.8)',
          }}
        />
      </div>

      {/* Queue indicator (desktop only). */}
      <div className="hidden md:block text-xs text-zinc-500 shrink-0 tabular-nums">
        {(p.shuffle ? p.cursor : p.queue.findIndex((t) => t.id === p.current?.id)) + 1}
        /{p.queue.length}
      </div>

      {/* Expand button — desktop only. On mobile, tapping the title or
          the cover already gets you in (and NowPlaying has its own back
          button), so the chevron is just clutter. */}
      <button
        onClick={onExpand}
        title="Open full player"
        className="hidden md:flex shrink-0 w-9 h-9 rounded-full bezel items-center justify-center text-zinc-400 hover:text-white"
      >
        ⤢
      </button>

      {/* Add-to-playlist popover anchored near whichever + button was
          clicked. Closes itself on outside click / Escape. */}
      {addingTo && (
        <AddToPlaylistMenu
          track={t}
          anchor={addingTo}
          onClose={() => setAddingTo(null)}
          onAdded={() => onLibraryChange?.()}
        />
      )}

      {/* Queue panel — shows all tracks in the current queue and lets the
          user jump to any track by clicking its row. */}
      {queueAnchor && (
        <QueuePanel
          anchor={queueAnchor}
          onClose={() => setQueueAnchor(null)}
        />
      )}
    </div>
  );
}

function TransportBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-8 h-8 rounded-full bezel flex items-center justify-center text-zinc-300 hover:text-white"
    >
      {children}
    </button>
  );
}

function ModeBtn({
  active = false,
  accent = false,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  /** When true the active state glows pink (favorite heart) instead of
   *  the regular accent ring — visual hierarchy: love > toggle. */
  accent?: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  title: string;
  children: React.ReactNode;
}) {
  const accentStyle = accent && active
    ? {
        color: '#ff2db5',
        boxShadow:
          '0 0 6px rgba(255,45,181,0.55), 0 0 14px rgba(255,45,181,0.45), inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.6)',
      }
    : undefined;
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 rounded-full bezel flex items-center justify-center ${
        active && !accent
          ? 'glow-text glow-ring'
          : !active
            ? 'text-zinc-100 hover:text-white'
            : ''
      }`}
      style={accentStyle}
    >
      {children}
    </button>
  );
}

function QueueIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="15" y2="18" />
      <polygon points="17,15 17,21 22,18" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Mobile compact variant of ModeBtn — same vocabulary, 7×7 instead of 8×8. */
function MiniBtn({
  active = false,
  accent = false,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  accent?: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  title: string;
  children: React.ReactNode;
}) {
  const accentStyle = accent && active
    ? {
        color: '#ff2db5',
        boxShadow:
          '0 0 5px rgba(255,45,181,0.5), 0 0 10px rgba(255,45,181,0.4), inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.6)',
      }
    : undefined;
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-7 h-7 rounded-full bezel flex items-center justify-center ${
        active && !accent
          ? 'glow-text glow-ring'
          : !active
            ? 'text-zinc-300 hover:text-white'
            : ''
      }`}
      style={accentStyle}
    >
      {children}
    </button>
  );
}
