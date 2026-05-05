import { ampColor } from './colors';

export function drawMirror(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  heights: Float32Array,
) {
  const bars = heights.length;
  const mid = Math.round(H / 2);
  const halfH = Math.round(H * 0.48);
  const gap = Math.max(2, Math.floor(W / bars / 6));
  const barW = (W - gap * (bars - 1)) / bars;
  const minBarH = Math.max(2, Math.round(H * 0.01));

  for (let i = 0; i < bars; i++) {
    const v = heights[i];
    const h = Math.max(minBarH, Math.round(v * halfH));
    const x = Math.round(i * (barW + gap));
    const w = Math.ceil(barW);

    ctx.fillStyle = ampColor(v);
    ctx.fillRect(x, mid - h, w, h);
    ctx.fillStyle = ampColor(v, 0.75);
    ctx.fillRect(x, mid, w, h);
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.fillRect(0, mid, W, 1);
}
