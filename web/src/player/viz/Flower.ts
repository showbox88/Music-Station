/* Flower: petals radiating from canvas center, with slow rotation. */
export function drawFlower(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  heights: Float32Array,
  rot: number,
) {
  const bars = heights.length;
  const cx = W / 2;
  const cy = H / 2;
  const innerR = Math.min(W, H) * 0.06;
  const maxR = Math.min(W, H) * 0.5;

  let avg = 0;
  for (let i = 0; i < bars; i++) avg += heights[i];
  avg /= bars;

  const layers = 3;
  ctx.lineWidth = 1.4;
  for (let layer = 0; layer < layers; layer++) {
    const layerRot = rot * (1 + layer * 0.4);
    const hue = (60 + layer * 60) % 360;
    ctx.strokeStyle = `hsla(${hue}, 95%, 60%, ${0.5 + (layer === 0 ? 0.3 : 0)})`;
    ctx.shadowColor = `hsla(${hue}, 95%, 55%, 0.8)`;
    ctx.shadowBlur = 6 + avg * 12;
    ctx.beginPath();
    for (let i = 0; i < bars; i++) {
      const v = Math.min(1, Math.sqrt(heights[i]) * 1.8);
      const a = (i / bars) * Math.PI * 2 + layerRot;
      const r = innerR + v * (maxR - innerR);
      const x1 = cx + Math.cos(a) * innerR;
      const y1 = cy + Math.sin(a) * innerR;
      const x2 = cx + Math.cos(a) * r;
      const y2 = cy + Math.sin(a) * r;
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  const coreR = innerR * (0.6 + avg * 0.6);
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2);
  coreGrad.addColorStop(0, `hsla(50, 100%, 65%, ${0.7 + avg * 0.3})`);
  coreGrad.addColorStop(1, 'hsla(50, 100%, 50%, 0)');
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR * 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.beginPath();
  ctx.arc(cx, cy, innerR * 0.55, 0, Math.PI * 2);
  ctx.fill();
}
