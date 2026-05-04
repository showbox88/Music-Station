/**
 * LyricsPanel — renders synced (.lrc) or plain lyrics in two display modes.
 *
 *   mode='inline'    Scrollable list sized for a small in-page container
 *                    (e.g. replacing the 200px visualizer area). Smaller
 *                    pad/font than 'full'. Clicks bubble up so the parent
 *                    can use the area as a toggle target.
 *
 *   mode='full'      Full scrollable list filling its parent. Auto-scrolls
 *                    the current line to the vertical center of the
 *                    container (NOT the page).
 *
 * Both modes apply a "convex-lens" curve: the active line is large + bold
 * + glowing, neighbours are progressively smaller and dimmer along a
 * cosine arc. Scrollbars are hidden in both modes (the active-line
 * auto-scroll is the only intended way to navigate).
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

/**
 * Convex-lens style sizing: active line pops big and bold; neighbouring
 * lines shrink along a cosine arc so the cluster around the cursor looks
 * like it sits under a magnifier. Past distance=4 lines fade to a small
 * resting size and very low opacity.
 *
 * Returned font sizes are in px (so they can drive layout reflow + the
 * scrollTo math below).
 */
function lensStyle(
  distance: number,
  variant: 'inline' | 'full',
): { fontSize: number; opacity: number; weight: 400 | 500 | 700 } {
  if (distance === 0) {
    return {
      fontSize: variant === 'inline' ? 22 : 32,
      opacity: 1,
      weight: 700,
    };
  }
  // Cosine arc — distance 1 → curve 0.951, 2 → 0.809, 3 → 0.588,
  // 4 → 0.309, 5+ → 0. This gives the "bulge" feel.
  const t = Math.min(distance, 5) / 5;
  const curve = Math.cos((t * Math.PI) / 2);
  const minSize = variant === 'inline' ? 11 : 14;
  const maxSize = variant === 'inline' ? 17 : 22;
  return {
    fontSize: minSize + curve * (maxSize - minSize),
    opacity: 0.18 + curve * 0.7,
    weight: distance === 1 ? 500 : 400,
  };
}

interface Props {
  parsed: ParsedLyrics;
  mode: 'inline' | 'full';
  /** Lead time in ms — highlight a line a hair before its timestamp so it
   *  feels in-sync rather than chasing. Empirically ~150ms feels right. */
  lead?: number;
  /** Inline-mode top/bottom padding override (px). Should be ~40% of the
   *  parent container height so the active line scrolls to the center.
   *  Defaults to 70 (good for ~200px containers). */
  padBlock?: number;
}

export default function LyricsPanel({ parsed, mode, lead = 150, padBlock }: Props) {
  const { position, seek } = usePlayer();
  const currentMs = Math.max(0, position * 1000 + lead);
  const activeIdx = useMemo(
    () => findActiveIndex(parsed.lines, currentMs),
    [parsed.lines, currentMs],
  );

  return (
    <ScrollView
      parsed={parsed}
      activeIdx={activeIdx}
      onSeek={(ms) => seek(ms / 1000)}
      variant={mode}
      padBlock={padBlock}
    />
  );
}

function ScrollView({
  parsed,
  activeIdx,
  onSeek,
  variant,
  padBlock,
}: {
  parsed: ParsedLyrics;
  activeIdx: number;
  onSeek: (ms: number) => void;
  variant: 'inline' | 'full';
  padBlock?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<Array<HTMLDivElement | null>>([]);
  const isInline = variant === 'inline';

  // Auto-scroll the active line into vertical center of THIS container.
  // Scoped to the container (not page) so a partly-off-screen container
  // doesn't yank the rest of the layout.
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
        className={`mw-no-scrollbar h-full overflow-y-auto whitespace-pre-wrap text-center ${
          isInline
            ? 'px-4 py-4 text-zinc-300 text-sm leading-relaxed'
            : 'px-6 py-10 text-zinc-300 text-base leading-relaxed'
        }`}
      >
        <ScrollbarHider />
        {parsed.raw}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`mw-no-scrollbar h-full overflow-y-auto text-center ${isInline ? 'px-3' : 'px-6'}`}
      style={{
        // Pad top/bottom so the first and last lines can sit at the
        // center. Full-screen uses viewport units; inline accepts a
        // caller-provided px value sized to ~40% of the container height.
        paddingTop: isInline ? (padBlock ?? 70) : '40vh',
        paddingBottom: isInline ? (padBlock ?? 70) : '40vh',
        scrollBehavior: 'smooth',
      }}
    >
      <ScrollbarHider />
      {parsed.lines.map((line, i) => {
        const distance = Math.abs(i - activeIdx);
        const { fontSize, opacity, weight } = lensStyle(distance, variant);
        const isActive = i === activeIdx;
        return (
          <div
            key={`${i}-${line.ms}`}
            ref={(el) => {
              lineRefs.current[i] = el;
            }}
            onClick={(e) => {
              e.stopPropagation();
              onSeek(line.ms);
            }}
            className={`cursor-pointer transition-all duration-300 ${
              isActive ? 'glow-text' : ''
            }`}
            style={{
              fontSize,
              fontWeight: weight,
              opacity,
              lineHeight: 1.45,
              padding: '4px 0',
              color: isActive ? 'var(--accent)' : '#d4d4d8',
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

/** Inject scrollbar-hiding CSS for our overflow container. Idempotent —
 *  React de-dupes identical <style> tags in the head, and even if it
 *  didn't, repeated identical rules cost nothing. */
function ScrollbarHider() {
  return (
    <style>{`
      .mw-no-scrollbar { scrollbar-width: none; -ms-overflow-style: none; }
      .mw-no-scrollbar::-webkit-scrollbar { display: none; width: 0; height: 0; }
    `}</style>
  );
}
