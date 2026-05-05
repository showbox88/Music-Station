import { ampColor } from './colors';

/* Pulse: bars mirrored around center; spread expands with average amplitude. */
export function drawPulse(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  heights: Float32Array,
) {
  const bars = heights.length;
  const halfBars = bars;
  const centerX = W / 2;
  const centerY = H / 2;
  const maxBarH = Math.round(H * 0.85);
  const minBarH = Math.max(2, Math.round(H * 0.02));

  let avg = 0;
  for (let i = 0; i < bars; i++) avg += heights[i];
  avg /= bars;
  const spread = 0.4 + Math.min(1, avg * 1.6) * 0.6;
  const halfWidth = (W / 2) * spread;

  const axisGrad = ctx.createLinearGradient(centerX - halfWidth, 0, centerX + halfWidth, 0);
  axisGrad.addColorStop(0, 'rgba(255,255,255,0)');
  axisGrad.addColorStop(0.5, ampColor(Math.min(1, avg * 1.4), 0.18));
  axisGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = axisGrad;
  ctx.fillRect(centerX - halfWidth, centerY - 1, halfWidth * 2, 2);

  const slotW = (halfWidth / halfBars) * 0.8;
  const barW = Math.max(1.5, slotW);

  for (let i = 0; i < halfBars; i++) {
    const v = heights[i];
    const h = Math.max(minBarH, Math.round(v * maxBarH));
    const t = (i + 0.5) / halfBars;
    const offset = Math.pow(t, 0.85) * halfWidth;

    const yTop = centerY - h / 2;
    const color = ampColor(v);
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(centerX + offset - barW / 2), yTop, barW, h);
    ctx.fillRect(Math.round(centerX - offset - barW / 2), yTop, barW, h);
  }

  const coreR = Math.max(2, Math.min(W, H) * 0.012) * (0.6 + avg * 1.6);
  const coreGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, coreR * 4);
  coreGrad.addColorStop(0, ampColor(Math.min(1, avg * 1.6), 0.85));
  coreGrad.addColorStop(1, ampColor(avg, 0));
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(centerX, centerY, coreR * 4, 0, Math.PI * 2);
  ctx.fill();
}
