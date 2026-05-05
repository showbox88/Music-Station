/* Ribbon: 6 stacked layers, each sampling a different frequency slice. */
export function drawRibbon(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  layerHeights: Float32Array[],
) {
  const layers = layerHeights.length;
  const bars = layerHeights[0]?.length ?? 0;
  if (bars === 0) return;
  const midY = H / 2;
  const amp = H * 0.42;

  const LAYER_DEF = [
    { label: 'sub-bass',  baseline: -0.30, gain: 1.7, hue: 290 },
    { label: 'bass',      baseline: -0.18, gain: 1.7, hue: 320 },
    { label: 'low-mid',   baseline: -0.06, gain: 1.9, hue:   0 },
    { label: 'mid',       baseline:  0.06, gain: 2.1, hue:  45 },
    { label: 'upper-mid', baseline:  0.18, gain: 2.4, hue: 130 },
    { label: 'treble',    baseline:  0.30, gain: 2.8, hue: 200 },
  ];

  ctx.lineWidth = 1.6;
  for (let layer = 0; layer < layers; layer++) {
    const def = LAYER_DEF[layer % LAYER_DEF.length];
    const heights = layerHeights[layer];
    ctx.strokeStyle = `hsla(${def.hue}, 95%, 62%, 0.85)`;
    ctx.shadowColor = `hsla(${def.hue}, 95%, 55%, 0.8)`;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    for (let i = 0; i < bars; i++) {
      const x = (i / (bars - 1)) * W;
      const v = Math.min(1, heights[i] * def.gain);
      const sign = i % 2 === 0 ? 1 : -1;
      const y = midY + def.baseline * amp - sign * v * amp * 0.55;
      if (i === 0) ctx.moveTo(x, y);
      else {
        const prevX = ((i - 1) / (bars - 1)) * W;
        const prevV = Math.min(1, heights[i - 1] * def.gain);
        const prevSign = (i - 1) % 2 === 0 ? 1 : -1;
        const prevY = midY + def.baseline * amp - prevSign * prevV * amp * 0.55;
        const cx = (prevX + x) / 2;
        const cy = (prevY + y) / 2;
        ctx.quadraticCurveTo(prevX, prevY, cx, cy);
      }
    }
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}
