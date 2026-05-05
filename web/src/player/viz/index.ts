/**
 * Visualizer style registry. AudioVisualizer.tsx owns the canvas, sampling,
 * tweening and dispatch; each per-style draw function lives in its own file
 * so they can be edited independently. Adding a new built-in = add a file
 * + register it in STYLES / STYLE_LABEL / drawStyle below.
 */
import { drawBars } from './Bars';
import { drawMirror } from './Mirror';
import { drawWave } from './Wave';
import { drawPulse } from './Pulse';
import { drawRainbow } from './Rainbow';
import { drawCaps } from './Caps';
import { drawDots } from './Dots';
import { drawRibbon } from './Ribbon';
import { drawFlower } from './Flower';
import { drawStems } from './Stems';
import { drawGrid } from './Grid';

export type VizStyle =
  | 'bars'
  | 'mirror'
  | 'wave'
  | 'pulse'
  | 'rainbow'
  | 'caps'
  | 'dots'
  | 'ribbon'
  | 'flower'
  | 'stems'
  | 'grid';

export const STYLES: VizStyle[] = [
  'bars',
  'mirror',
  'wave',
  'pulse',
  'rainbow',
  'caps',
  'dots',
  'ribbon',
  'flower',
  'stems',
  'grid',
];

export const STYLE_LABEL: Record<VizStyle, string> = {
  bars: 'Bars',
  mirror: 'Mirror',
  wave: 'Wave',
  pulse: 'Pulse',
  rainbow: 'Rainbow',
  caps: 'Caps',
  dots: 'Dots',
  ribbon: 'Ribbon',
  flower: 'Flower',
  stems: 'Stems',
  grid: 'Grid',
};

export {
  drawBars,
  drawMirror,
  drawWave,
  drawPulse,
  drawRainbow,
  drawCaps,
  drawDots,
  drawRibbon,
  drawFlower,
  drawStems,
  drawGrid,
};

/** Bag of all per-frame state any built-in might need. */
export interface DrawCtx {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  heights: Float32Array;
  peaks: Float32Array;
  rot: number;
  /** Optional multi-layer heights for the ribbon style. */
  ribbonHeights?: Float32Array[];
}

/** Unified dispatch — picks the right draw fn for `style`. */
export function drawStyle(style: VizStyle, d: DrawCtx) {
  switch (style) {
    case 'bars':    return drawBars(d.ctx, d.W, d.H, d.heights);
    case 'mirror':  return drawMirror(d.ctx, d.W, d.H, d.heights);
    case 'wave':    return drawWave(d.ctx, d.W, d.H, d.heights);
    case 'pulse':   return drawPulse(d.ctx, d.W, d.H, d.heights);
    case 'rainbow': return drawRainbow(d.ctx, d.W, d.H, d.heights);
    case 'caps':    return drawCaps(d.ctx, d.W, d.H, d.heights, d.peaks);
    case 'dots':    return drawDots(d.ctx, d.W, d.H, d.heights);
    case 'ribbon':  return drawRibbon(d.ctx, d.W, d.H, d.ribbonHeights ?? [d.heights]);
    case 'flower':  return drawFlower(d.ctx, d.W, d.H, d.heights, d.rot);
    case 'stems':   return drawStems(d.ctx, d.W, d.H, d.heights);
    case 'grid':    return drawGrid(d.ctx, d.W, d.H, d.heights);
  }
}

/* ------------------------- Custom-style support ------------------------- */

/** A user-pasted draw function. Stored in PrefsBlob.viz_custom. */
export interface VizCustom {
  /** Stable id, e.g. "custom_<timestamp>". */
  id: string;
  /** User-chosen display name, shown in the cycle button + lab. */
  name: string;
  /** JS body — runs as `function(ctx, W, H, heights, peaks, rot) { <code> }`. */
  code: string;
}

export type CustomDrawFn = (
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  heights: Float32Array,
  peaks: Float32Array,
  rot: number,
) => void;

/**
 * Compile a user-pasted snippet into a draw function. Returns `{ fn }` on
 * success or `{ error }` on parse failure. Caller is responsible for
 * try/catching runtime errors during the actual draw call.
 */
export function compileCustom(code: string): { fn: CustomDrawFn } | { error: string } {
  try {
    const fn = new Function(
      'ctx',
      'W',
      'H',
      'heights',
      'peaks',
      'rot',
      code,
    ) as CustomDrawFn;
    return { fn };
  } catch (e: any) {
    return { error: String(e?.message ?? e) };
  }
}
