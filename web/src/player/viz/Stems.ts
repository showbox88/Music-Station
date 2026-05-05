/* Stems: alternating up/down vertical strokes with rounded caps. */
export function drawStems(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  heights: Float32Array,
) {
  const bars = heights.length;
  const midY = H / 2;
  const maxLen = H * 0.45;
  const segmentW = W / bars;
  const capR = Math.max(2, segmentW * 0.42);

  ctx.lineWidth = Math.max(1.5, segmentW * 0.18);
  for (let i = 0; i < bars; i++) {
    const v = Math.min(1, heights[i] * 1.4);
    const len = Math.max(capR + 1, v * maxLen);
    const x = (i + 0.5) * segmentW;
    const dir = i % 2 === 0 ? -1 : 1;
    const tipY = midY + dir * len;

    const t = i / Math.max(1, bars - 1);
    const hue = 200 + t * 160;
    ctx.strokeStyle = `hsla(${hue}, 95%, ${55 + v * 15}%, 0.95)`;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.shadowColor = `hsla(${hue}, 95%, 50%, 0.8)`;
    ctx.shadowBlur = 6 + v * 10;

    ctx.beginPath();
    ctx.moveTo(x, midY);
    ctx.lineTo(x, tipY);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, tipY, capR, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;

  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, midY, W, 1);
}
