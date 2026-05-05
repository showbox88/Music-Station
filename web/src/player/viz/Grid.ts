/* Grid: vertical strips of square cells, vintage VU-meter array. */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  heights: Float32Array,
) {
  const bars = heights.length;
  const colW = W / bars;
  const cellGap = 2;
  const cellH = Math.max(4, Math.round(colW * 0.55));
  const rowStride = cellH + cellGap;
  const rows = Math.floor((H * 0.94) / rowStride);
  const cellW = Math.max(2, Math.floor(colW - cellGap));

  for (let i = 0; i < bars; i++) {
    const v = heights[i];
    const lit = Math.round(v * rows);
    const x = Math.round(i * colW + cellGap / 2);

    for (let r = 0; r < rows; r++) {
      const y = H - (r + 1) * rowStride;
      const t = r / Math.max(1, rows - 1);
      const hue = 120 - t * 120;
      if (r < lit) {
        ctx.fillStyle = `hsl(${hue}, 95%, ${50 + (1 - t) * 12}%)`;
        ctx.shadowColor = `hsl(${hue}, 95%, 55%)`;
        ctx.shadowBlur = 4;
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.shadowBlur = 0;
      }
      ctx.fillRect(x, y, cellW, cellH);
    }
  }
  ctx.shadowBlur = 0;
}
