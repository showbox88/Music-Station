/**
 * Persistent bottom bar with playback controls.
 *
 * Layout (left → right):
 *   [Now playing: title / artist]   [⏮ ▶/⏸ ⏭]   [time bar]   [shuffle repeat volume]
 *
 * Visible only when there's something in the queue (otherwise the page
 * has full height for the list).
 */
import { usePlayer } from './PlayerContext';
import CoverThumb from '../components/CoverThumb';

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
    <div className="border-t border-zinc-800 bg-zinc-950/95 backdrop-blur px-4 py-2 flex items-center gap-4">
      {/* Now playing info — clickable to open the fullscreen view */}
      <button
        onClick={onExpand}
        title="Open full player"
        className="min-w-0 flex-1 max-w-xs flex items-center gap-3 text-left hover:bg-zinc-900/60 rounded px-1 py-1"
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

      {/* Transport */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={p.prev}
          title="Previous (or restart)"
          className="text-zinc-300 hover:text-white px-2 text-lg"
        >
          ⏮
        </button>
        <button
          onClick={p.togglePlay}
          title={p.isPlaying ? 'Pause' : 'Play'}
          className="bg-white text-zinc-900 hover:bg-zinc-200 rounded-full w-8 h-8 leading-none text-base font-semibold"
        >
          {p.isPlaying ? '⏸' : '▶'}
        </button>
        <button
          onClick={p.next}
          title="Next"
          className="text-zinc-300 hover:text-white px-2 text-lg"
        >
          ⏭
        </button>
      </div>

      {/* Progress */}
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span className="text-xs text-zinc-500 tabular-nums w-10 text-right">{fmt(p.position)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(0, p.duration)}
          step={0.5}
          value={p.position}
          onChange={(e) => p.seek(Number(e.target.value))}
          className="flex-1 accent-zinc-300"
          // Show a fallback fill if accent isn't supported (rare)
          style={{
            background: `linear-gradient(to right, rgb(212 212 216) 0%, rgb(212 212 216) ${pct}%, rgb(63 63 70) ${pct}%, rgb(63 63 70) 100%)`,
            WebkitAppearance: 'none',
            height: 4,
            borderRadius: 9999,
          }}
        />
        <span className="text-xs text-zinc-500 tabular-nums w-10">{fmt(p.duration)}</span>
      </div>

      {/* Modes */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={p.toggleShuffle}
          title="Shuffle"
          className={`px-2 ${p.shuffle ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-200'}`}
        >
          🔀
        </button>
        <button
          onClick={p.cycleRepeat}
          title={`Repeat: ${p.repeat}`}
          className={`px-2 ${p.repeat !== 'off' ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-200'}`}
        >
          {p.repeat === 'one' ? '🔂' : '🔁'}
        </button>
      </div>

      {/* Volume */}
      <div className="flex items-center gap-2 shrink-0 w-32">
        <span className="text-xs text-zinc-500">{Math.round(p.volume * 100)}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={p.volume}
          onChange={(e) => p.setVolume(Number(e.target.value))}
          className="flex-1 accent-zinc-300"
        />
      </div>

      {/* Queue length indicator */}
      <div className="text-xs text-zinc-500 shrink-0 tabular-nums">
        {(p.shuffle ? p.cursor : p.queue.findIndex((t) => t.id === p.current?.id)) + 1}
        /{p.queue.length}
      </div>

      {/* Expand to full Now Playing view */}
      <button
        onClick={onExpand}
        title="Open full player"
        className="shrink-0 text-zinc-400 hover:text-white px-2 text-base"
      >
        ⤢
      </button>
    </div>
  );
}
