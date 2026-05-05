/**
 * Visualizer style registry. AudioVisualizer.tsx owns the canvas, sampling,
 * tweening and dispatch; each per-style draw function lives in its own file
 * so they can be edited independently.
 */
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

export { drawBars } from './Bars';
export { drawMirror } from './Mirror';
export { drawWave } from './Wave';
export { drawPulse } from './Pulse';
export { drawRainbow } from './Rainbow';
export { drawCaps } from './Caps';
export { drawDots } from './Dots';
export { drawRibbon } from './Ribbon';
export { drawFlower } from './Flower';
export { drawStems } from './Stems';
export { drawGrid } from './Grid';
