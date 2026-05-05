/* Dots: each bar is a column of glowing dots, like a dot-matrix display. */
export function drawDots(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  heights: Float32Array,
) {
  const bars = heights.length;
  const colW = W / bars;
  const dotR = Math.max(1.5, Math.min(colW * 0.32, H * 0.025));
  const rowGap = dotR * 2.4;
  const rows = Math.floor((H * 0.92) / rowGap);

  for (let i = 0; i < bars; i++) {
    const v = heights[i];
    const lit = Math.round(v * rows);
    const cx = Math.round((i + 0.5) * colW);
    for (let r = 0; r < rows; r++) {
      const cy = H - (r + 0.7) * rowGap;
      const t = r / Math.max(1, rows - 1);
      if (r < lit) {
        const hue = 50 - t * 50;
        ctx.fillStyle = `hsl(${hue}, 95%, ${55 + (1 - t) * 15}%)`;
        ctx.shadowColor = `hsl(${hue}, 95%, 55%)`;
        ctx.shadowBlur = 6;
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.shadowBlur = 0;
      }
      ctx.beginPath();
      ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.shadowBlur = 0;
}
