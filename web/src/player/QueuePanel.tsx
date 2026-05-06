/**
 * Queue panel — a fixed popup that lists every track in the current queue.
 * Clicking a row calls jumpTo() to switch playback to that track immediately.
 * Opens anchored above whatever button triggered it (same pattern as
 * AddToPlaylistMenu), closes on outside-click or Escape.
 */
import { useEffect, useRef } from 'react';
import { usePlayer } from './PlayerContext';

interface Props {
  /** Viewport coords of the trigger button's top-left corner. */
  anchor: { x: number; y: number };
  onClose: () => void;
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function QueuePanel({ anchor, onClose }: Props) {
  const p = usePlayer();
  const panelRef = useRef<HTMLDivElement>(null);
  const currentRowRef = useRef<HTMLButtonElement>(null);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Close on outside click
  useEffect(() => {
    function onPointer(e: PointerEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    // Delay one frame so the opening click doesn't immediately close the panel
    const id = setTimeout(() => window.addEventListener('pointerdown', onPointer), 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [onClose]);

  // Scroll the current track into view when the panel opens
  useEffect(() => {
    currentRowRef.current?.scrollIntoView({ block: 'center' });
  }, []);

  const currentQueueIndex = p.shuffle
    ? p.shuffledOrder[p.cursor] ?? -1
    : p.queue.findIndex((tr) => tr.id === p.current?.id);

  // Position: open upward from the anchor point, clamped to viewport
  const PANEL_W = 360;
  const left = Math.min(anchor.x, window.innerWidth - PANEL_W - 12);
  const bottom = window.innerHeight - anchor.y + 8;

  return (
    <div
      ref={panelRef}
      className="fixed z-60 flex flex-col rounded-xl border border-black/60 shadow-2xl overflow-hidden"
      style={{
        left,
        bottom,
        width: PANEL_W,
        maxHeight: '65vh',
        background: 'linear-gradient(180deg, #232325 0%, #18181a 100%)',
        boxShadow:
          '0 0 0 1px rgba(255,255,255,0.06), 0 8px 32px rgba(0,0,0,0.7), 0 0 20px rgba(255,45,181,0.08)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-black/50 shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          队列
        </span>
        <span className="text-xs text-zinc-600 tabular-nums">
          {p.queue.length} 首
        </span>
      </div>

      {/* Track list */}
      <div className="overflow-y-auto flex-1 py-1">
        {p.queue.map((track, qIdx) => {
          const isCurrent = qIdx === currentQueueIndex;
          return (
            <button
              key={`${track.id}-${qIdx}`}
              ref={isCurrent ? currentRowRef : undefined}
              onClick={() => {
                p.jumpTo(qIdx);
                onClose();
              }}
              className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                isCurrent
                  ? 'bg-white/[0.06]'
                  : 'hover:bg-white/[0.04]'
              }`}
            >
              {/* Track position number */}
              <span
                className="text-[11px] tabular-nums w-5 text-right shrink-0"
                style={{ color: isCurrent ? 'var(--accent)' : '#52525b' }}
              >
                {isCurrent ? '♪' : qIdx + 1}
              </span>

              {/* Title + artist */}
              <span className="flex-1 min-w-0">
                <span
                  className="block text-sm font-medium truncate"
                  style={{ color: isCurrent ? 'var(--accent)' : '#e4e4e7' }}
                >
                  {track.title || track.rel_path}
                </span>
                <span className="block text-[11px] text-zinc-500 truncate">
                  {track.artist || '—'}
                  {track.album ? ` · ${track.album}` : ''}
                </span>
              </span>

              {/* Duration */}
              {track.duration != null && (
                <span className="text-[11px] text-zinc-600 tabular-nums shrink-0">
                  {fmt(track.duration)}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
