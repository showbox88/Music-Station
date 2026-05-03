/**
 * Persistent bottom bar with playback controls.
 *
 * Visual: dark bezel chassis with magenta glow accents — matches the UI
 * mockup the user provided (recessed pill housing the prev/play/next
 * triplet, glowing pink play button, recessed slider tracks).
 */
import { usePlayer } from './PlayerContext';
import CoverThumb from '../components/CoverThumb';
import { RepeatIcon, RepeatOneIcon, ShuffleIcon } from '../components/Icons';

interface Props {
  onExpand?: () => void;
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function PlayerBar({ onExpand }: Props) {
  const p = usePlayer();
  if (p.queue.length === 0 || !p.current) return null;

  const pct = p.duration > 0 ? (p.position / p.duration) * 100 : 0;

  return (
    <div
      className="border-t border-black/80 px-3 md:px-4 py-2 md:py-3 flex items-center gap-2 md:gap-4"
      style={{
        background: 'linear-gradient(180deg, #1f1f21 0%, #141415 100%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05), 0 -4px 12px rgba(0,0,0,0.5)',
      }}
    >
      {/* Now playing info — clickable to open the fullscreen view */}
      <button
        onClick={onExpand}
        title="Open full player"
        className="min-w-0 flex-1 md:flex-none md:max-w-xs flex items-center gap-3 text-left rounded-lg px-1 md:px-2 py-1 hover:bg-white/5"
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

      {/* Transport pill — prev / play / next chassis. On mobile we only
          render a single play button (no surrounding pill) since space
          is tight; users open NowPlaying for prev/next + scrubbing. */}
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

      {/* Mobile-only standalone play button (no transport pill). */}
      <button
        onClick={p.togglePlay}
        title={p.isPlaying ? 'Pause' : 'Play'}
        className="md:hidden w-10 h-10 rounded-full play-btn flex items-center justify-center shrink-0"
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

      {/* Progress — recessed track with magenta fill (desktop only) */}
      <div className="hidden md:flex flex-1 items-center gap-2 min-w-0">
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

      {/* Mode toggles (desktop only) */}
      <div className="hidden md:flex items-center gap-2 shrink-0">
        <ModeBtn active={p.shuffle} onClick={p.toggleShuffle} title="Shuffle">
          <ShuffleIcon />
        </ModeBtn>
        <ModeBtn active={p.repeat !== 'off'} onClick={p.cycleRepeat} title={`Repeat: ${p.repeat}`}>
          {p.repeat === 'one' ? <RepeatOneIcon /> : <RepeatIcon />}
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

      {/* Queue indicator (desktop only) */}
      <div className="hidden md:block text-xs text-zinc-500 shrink-0 tabular-nums">
        {(p.shuffle ? p.cursor : p.queue.findIndex((t) => t.id === p.current?.id)) + 1}
        /{p.queue.length}
      </div>

      {/* Expand — keep on both, but on mobile this is the main way to
          access prev/next/seek/volume. */}
      <button
        onClick={onExpand}
        title="Open full player"
        className="shrink-0 w-9 h-9 rounded-full bezel flex items-center justify-center text-zinc-400 hover:text-white"
      >
        ⤢
      </button>
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
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 rounded-full bezel flex items-center justify-center ${
        active ? 'glow-text glow-ring' : 'text-zinc-100 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}
