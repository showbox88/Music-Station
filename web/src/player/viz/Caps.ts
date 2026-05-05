/* Caps: vintage block-segment EQ bars with floating peak caps. */
export function drawCaps(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  heights: Float32Array,
  peaks: Float32Array,
) {
  const bars = heights.length;
  const maxBarH = Math.round(H * 0.92);
  const gap = Math.max(2, Math.floor(W / bars / 5));
  const barW = (W - gap * (bars - 1)) / bars;
  const blockH = Math.max(3, Math.round(H * 0.04));
  const blockGap = 2;
  const totalBlocks = Math.floor(maxBarH / (blockH + blockGap));

  for (let i = 0; i < bars; i++) {
    const v = heights[i];
    const lit = Math.round(v * totalBlocks);
    const x = Math.round(i * (barW + gap));
    const w = Math.ceil(barW);

    for (let b = 0; b < totalBlocks; b++) {
      const blockY = H - (b + 1) * (blockH + blockGap);
      if (b < lit) {
        const t = b / Math.max(1, totalBlocks - 1);
        const hue = 200 - t * 130;
        ctx.fillStyle = `hsl(${hue}, 90%, ${50 + t * 15}%)`;
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
      }
      ctx.fillRect(x, blockY, w, blockH);
    }

    const peak = peaks[i];
    if (peak > 0.01) {
      const capBlock = Math.min(totalBlocks - 1, Math.round(peak * totalBlocks));
      const capY = H - (capBlock + 1) * (blockH + blockGap);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 6;
      ctx.fillRect(x, capY, w, Math.max(2, Math.round(blockH * 0.5)));
      ctx.shadowBlur = 0;
    }
  }
}
