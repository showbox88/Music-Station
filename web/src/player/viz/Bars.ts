import { ampColor } from './colors';

export function drawBars(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  heights: Float32Array,
) {
  const bars = heights.length;
  const barAreaH = Math.round(H * 0.66);
  const reflectStartY = barAreaH;
  const reflectH = H - barAreaH;
  const gap = Math.max(2, Math.floor(W / bars / 6));
  const barW = (W - gap * (bars - 1)) / bars;
  const minBarH = Math.max(2, Math.round(H * 0.02));

  for (let i = 0; i < bars; i++) {
    const v = heights[i];
    const h = Math.max(minBarH, Math.round(v * (barAreaH - 4)));
    const x = Math.round(i * (barW + gap));
    const y = barAreaH - h;
    const w = Math.ceil(barW);

    ctx.fillStyle = ampColor(v);
    ctx.fillRect(x, y, w, h);

    const refH = Math.min(reflectH, Math.round(h * 0.85));
    const grad = ctx.createLinearGradient(0, reflectStartY, 0, reflectStartY + refH);
    grad.addColorStop(0, ampColor(v, 0.6));
    grad.addColorStop(1, ampColor(v, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(x, reflectStartY, w, refH);
  }
}
