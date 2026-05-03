/**
 * LyricsPanel — renders synced (.lrc) or plain lyrics in three display modes.
 *
 *   mode='compact'   3 fixed-height lines: previous / current (highlighted) /
 *                    next. No scroll bar. Used embedded inside NowPlayingView.
 *
 *   mode='inline'    Scrollable list sized for a small in-page container
 *                    (e.g. replacing the 200px visualizer area). Smaller
 *                    pad/font than 'full'. Clicks bubble up so the parent
 *                    can use the area as a toggle target.
 *
 *   mode='full'      Full scrollable list. Auto-scrolls the current line to
 *                    the vertical center. Click a line to seek the audio
 *                    element. Used inside the fullscreen overlay.
 *
 * Falls back gracefully when:
 *   - lyrics absent             → caller decides what to render (we render nothing)
 *   - lyrics exist but no [mm:ss] timestamps → static block, no sync, no seek
 */
import { useEffect, useMemo, useRef } from 'react';
import { usePlayer } from './PlayerContext';

export interface LyricsLine {
  ms: number;
  text: string;
}

export interface ParsedLyrics {
  lines: LyricsLine[];
  hasTimestamps: boolean;
  /** Original raw text — used for plain-text fallback rendering. */
  raw: string;
}

const TS_RE = /\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

export function parseLrc(raw: string): ParsedLyrics {
  const out: LyricsLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    TS_RE.lastIndex = 0;
    const stamps: number[] = [];
    let lastEnd = 0;
    let m: RegExpExecArray | null;
    while ((m = TS_RE.exec(line)) !== null) {
      const min = Number(m[1]);
      const sec = Number(m[2]);
      const fracStr = m[3] ?? '0';
      // 1/2/3-digit fractional → milliseconds (pad-right then take first 3)
      const ms = Number(fracStr.padEnd(3, '0').slice(0, 3));
      stamps.push((min * 60 + sec) * 1000 + ms);
      lastEnd = m.index + m[0].length;
    }
    if (stamps.length === 0) continue;
    const text = line.slice(lastEnd).trim();
    // Skip empty header lines like a stray [00:00.00] with no content
    if (!text) continue;
    for (const ms of stamps) out.push({ ms, text });
  }
  out.sort((a, b) => a.ms - b.ms);
  return { lines: out, hasTimestamps: out.length > 0, raw };
}

/** Binary-search the index of the line whose timestamp is the largest
 *  one that's still <= currentMs. Returns -1 before the first line. */
function findActiveIndex(lines: LyricsLine[], currentMs: number): number {
  if (lines.length === 0) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  if (currentMs < lines[0].ms) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid].ms <= currentMs) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

interface Props {
  parsed: ParsedLyrics;
  mode: 'compact' | 'inline' | 'full';
  /** Lead time in ms — highlight a line a hair before its timestamp so it
   *  feels in-sync rather than chasing. Empirically ~150ms feels right. */
  lead?: number;
}

export default function LyricsPanel({ parsed, mode, lead = 150 }: Props) {
  const { position, seek } = usePlayer();
  const currentMs = Math.max(0, position * 1000 + lead);
  const activeIdx = useMemo(
    () => findActiveIndex(parsed.lines, currentMs),
    [parsed.lines, currentMs],
  );

  if (mode === 'compact') {
    return <CompactView lines={parsed.lines} activeIdx={activeIdx} hasTs={parsed.hasTimestamps} />;
  }
  return (
    <ScrollView
      parsed={parsed}
      activeIdx={activeIdx}
      onSeek={(ms) => seek(ms / 1000)}
      variant={mode}
    />
  );
}

function CompactView({
  lines,
  activeIdx,
  hasTs,
}: {
  lines: LyricsLine[];
  activeIdx: number;
  hasTs: boolean;
}) {
  // Plain-text (no timestamps) → just show first 3 non-empty lines, dim,
  // because we can't sync. The "open fullscreen" affordance stays in the
  // parent header so users can read the full text.
  if (!hasTs) {
    return (
      <div className="text-center text-zinc-500 text-xs leading-relaxed truncate">
        歌词已下载（无时间戳）— 点 🎤 打开全屏查看
      </div>
    );
  }
  if (lines.length === 0) {
    return null;
  }
  const prev = activeIdx > 0 ? lines[activeIdx - 1].text : '';
  const cur = activeIdx >= 0 ? lines[activeIdx].text : lines[0].text;
  const next = activeIdx + 1 < lines.length ? lines[activeIdx + 1].text : '';
  // Pre-roll: before the first timestamp, show "·" as current and the first line as next
  const showPreRoll = activeIdx < 0;
  return (
    <div className="text-center select-none" style={{ minHeight: '3.5rem' }}>
      <div className="text-[11px] text-zinc-600 truncate leading-tight h-4">
        {showPreRoll ? '' : prev}
      </div>
      <div
        className="text-sm font-medium truncate leading-tight glow-text transition-opacity duration-200"
        style={{ color: 'var(--accent)' }}
      >
        {showPreRoll ? '· · ·' : cur || '♪'}
      </div>
      <div className="text-[11px] text-zinc-500 truncate leading-tight h-4">
        {showPreRoll ? lines[0].text : next}
      </div>
    </div>
  );
}

function ScrollView({
  parsed,
  activeIdx,
  onSeek,
  variant,
}: {
  parsed: ParsedLyrics;
  activeIdx: number;
  onSeek: (ms: number) => void;
  variant: 'inline' | 'full';
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Array<HTMLDivElement | null>>([]);
  const isInline = variant === 'inline';

  // Auto-scroll the active line into vertical center of THIS container.
  // We use scrollTop rather than el.scrollIntoView because the latter would
  // also scroll the page when the container itself is partly off-screen.
  useEffect(() => {
    if (activeIdx < 0) return;
    const container = containerRef.current;
    const el = lineRefs.current[activeIdx];
    if (!container || !el) return;
    const target =
      el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
    container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }, [activeIdx]);

  if (!parsed.hasTimestamps) {
    return (
      <div
        ref={containerRef}
        className={`h-full overflow-y-auto whitespace-pre-wrap text-center ${
          isInline
            ? 'px-4 py-4 text-zinc-300 text-sm leading-relaxed'
            : 'px-6 py-10 text-zinc-300 text-base leading-relaxed'
        }`}
      >
        {parsed.raw}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`h-full overflow-y-auto text-center ${isInline ? 'px-3' : 'px-6'}`}
      style={{
        // Pad top/bottom so the first and last lines can sit at the
        // center. Full-screen uses viewport units; inline uses a smaller
        // pixel pad sized for the ~200px container in NowPlayingView.
        paddingTop: isInline ? 70 : '40vh',
        paddingBottom: isInline ? 70 : '40vh',
        scrollBehavior: 'smooth',
      }}
    >
      {parsed.lines.map((line, i) => {
        const isActive = i === activeIdx;
        const distance = Math.abs(i - activeIdx);
        const opacity = isActive ? 1 : Math.max(0.25, 1 - distance * 0.22);
        return (
          <div
            key={`${i}-${line.ms}`}
            ref={(el) => {
              lineRefs.current[i] = el;
            }}
            onClick={(e) => {
              // In inline mode the parent uses click to toggle the panel;
              // stop propagation only on actual line clicks so seek wins.
              e.stopPropagation();
              onSeek(line.ms);
            }}
            className={`cursor-pointer transition-all duration-200 ${
              isInline
                ? isActive
                  ? 'text-base font-medium py-1 glow-text'
                  : 'text-sm text-zinc-300 py-0.5'
                : isActive
                  ? 'text-xl font-medium py-2 glow-text'
                  : 'text-base text-zinc-300 py-2'
            }`}
            style={{
              opacity,
              color: isActive ? 'var(--accent)' : undefined,
            }}
            title="跳到这一句"
          >
            {line.text || '♪'}
          </div>
        );
      })}
    </div>
  );
}
