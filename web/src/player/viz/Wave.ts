import { ampColor } from './colors';

export function drawWave(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  heights: Float32Array,
) {
  const bars = heights.length;
  const baseY = Math.round(H * 0.92);
  const peakH = Math.round(H * 0.06);

  ctx.beginPath();
  ctx.moveTo(0, baseY);
  for (let i = 0; i < bars; i++) {
    const x = (i / (bars - 1)) * W;
    const y = baseY - heights[i] * (baseY - peakH);
    if (i === 0) ctx.lineTo(x, y);
    else {
      const prevX = ((i - 1) / (bars - 1)) * W;
      const prevY = baseY - heights[i - 1] * (baseY - peakH);
      const cx = (prevX + x) / 2;
      const cy = (prevY + y) / 2;
      ctx.quadraticCurveTo(prevX, prevY, cx, cy);
    }
  }
  ctx.lineTo(W, baseY);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();

  let avg = 0;
  for (let i = 0; i < bars; i++) avg += heights[i];
  avg /= bars;
  const grad = ctx.createLinearGradient(0, peakH, 0, baseY);
  grad.addColorStop(0, ampColor(Math.min(1, avg * 1.4), 0.85));
  grad.addColorStop(1, ampColor(avg, 0.15));
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < bars; i++) {
    const x = (i / (bars - 1)) * W;
    const y = baseY - heights[i] * (baseY - peakH);
    if (i === 0) ctx.moveTo(x, y);
    else {
      const prevX = ((i - 1) / (bars - 1)) * W;
      const prevY = baseY - heights[i - 1] * (baseY - peakH);
      const cx = (prevX + x) / 2;
      const cy = (prevY + y) / 2;
      ctx.quadraticCurveTo(prevX, prevY, cx, cy);
    }
  }
  ctx.strokeStyle = ampColor(Math.min(1, avg * 1.5), 0.9);
  ctx.lineWidth = 2;
  ctx.stroke();
}
