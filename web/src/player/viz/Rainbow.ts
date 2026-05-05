import { rainbowColor } from './colors';

/* Rainbow: bars colored by position across the spectrum, with neon glow. */
export function drawRainbow(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  heights: Float32Array,
) {
  const bars = heights.length;
  const baseY = H;
  const maxBarH = Math.round(H * 0.92);
  const gap = Math.max(2, Math.floor(W / bars / 5));
  const barW = (W - gap * (bars - 1)) / bars;
  const minBarH = Math.max(2, Math.round(H * 0.02));

  for (let i = 0; i < bars; i++) {
    const v = heights[i];
    const h = Math.max(minBarH, Math.round(v * maxBarH));
    const x = Math.round(i * (barW + gap));
    const t = i / Math.max(1, bars - 1);

    const grad = ctx.createLinearGradient(0, baseY - h, 0, baseY);
    grad.addColorStop(0, rainbowColor(t, 1));
    grad.addColorStop(1, rainbowColor(t, 0.6));
    ctx.fillStyle = grad;
    ctx.shadowColor = rainbowColor(t, 0.7);
    ctx.shadowBlur = 8 + v * 12;
    ctx.fillRect(x, baseY - h, Math.ceil(barW), h);
  }
  ctx.shadowBlur = 0;
}
