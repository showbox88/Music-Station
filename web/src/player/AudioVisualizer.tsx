/**
 * Real-time audio visualizer driven by AnalyserNode from PlayerContext.
 *
 * Three pluggable styles (cycled via the small overlay button):
 *   - bars    — vertical EQ bars + reflection underneath
 *   - mirror  — bars extending up AND down from a center axis
 *   - wave    — smooth filled area chart (oscilloscope-ish)
 *
 * Color is amplitude-driven: low values stay cool magenta, high values
 * shift through red/orange to yellow (clockwise wrap from 320° to 60°).
 *
 * The user's chosen style is persisted to localStorage 'mw.viz.style'.
 */
import { useEffect, useRef, useState } from 'react';
import { usePlayer } from './PlayerContext';

type VizStyle =
  | 'bars'
  | 'mirror'
  | 'wave'
  | 'pulse'
  | 'rainbow'
  | 'caps'
  | 'dots'
  | 'ribbon'
  | 'flower';
const STYLES: VizStyle[] = [
  'bars',
  'mirror',
  'wave',
  'pulse',
  'rainbow',
  'caps',
  'dots',
  'ribbon',
  'flower',
];
const STYLE_LABEL: Record<VizStyle, string> = {
  bars: 'Bars',
  mirror: 'Mirror',
  wave: 'Wave',
  pulse: 'Pulse',
  rainbow: 'Rainbow',
  caps: 'Caps',
  dots: 'Dots',
  ribbon: 'Ribbon',
  flower: 'Flower',
};

/** Hue mapped to bar index, for rainbow-style strips. */
function rainbowColor(t: number, alpha = 1): string {
  const hue = (t * 300 + 280) % 360; // sweep magenta → red → yellow → green → cyan → blue
  return `hsla(${hue}, 95%, 60%, ${alpha})`;
}

interface Props {
  bars?: number;
  height?: number;
}

function loadStyle(): VizStyle {
  if (typeof window === 'undefined') return 'bars';
  const v = window.localStorage.getItem('mw.viz.style');
  return STYLES.includes(v as VizStyle) ? (v as VizStyle) : 'bars';
}

/** Amplitude → HSL string. v in 0..1.
 *  Hue rotates 320° → 60° going clockwise through red/orange. */
function ampColor(v: number, alpha = 1): string {
  const hue = (320 + v * 100) % 360;
  const sat = 95;
  const light = 50 + v * 12;
  return `hsla(${hue}, ${sat}%, ${light}%, ${alpha})`;
}

export default function AudioVisualizer({ bars = 56, height = 200 }: Props) {
  const { getAnalyser, isPlaying } = usePlayer();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [style, setStyleState] = useState<VizStyle>(loadStyle);

  const setStyle = (s: VizStyle) => {
    setStyleState(s);
    try {
      window.localStorage.setItem('mw.viz.style', s);
    } catch {
      /* ignore */
    }
  };
  const cycleStyle = () => {
    const i = STYLES.indexOf(style);
    setStyle(STYLES[(i + 1) % STYLES.length]);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let buffer: Uint8Array | null = null;
    const heights = new Float32Array(bars);
    // Floating peak caps for the "caps" style. Decay slowly so the cap
    // hovers above the current bar height before falling.
    const peaks = new Float32Array(bars);
    const peakHoldFrames = new Int16Array(bars);
    // Rotation for the flower style — slowly winds for a "spinning" feel.
    let rot = 0;
    // For Ribbon: each layer samples a different frequency slice (bass,
    // low-mid, mid, etc.) so the 6 ribbons actually represent different
    // tones rather than one signal phase-shifted six times.
    const RIBBON_LAYERS = 6;
    const ribbonHeights: Float32Array[] = Array.from(
      { length: RIBBON_LAYERS },
      () => new Float32Array(bars),
    );
    // Per-layer x-axis permutation: each layer scrambles which X position
    // gets which bin from its slice, so the 6 ribbons don't all peak on
    // the left like a sorted-low-to-high spectrum would.
    const ribbonPerms: Int16Array[] = Array.from({ length: RIBBON_LAYERS }, (_, l) => {
      const arr = new Int16Array(bars);
      for (let i = 0; i < bars; i++) arr[i] = i;
      let s = (l + 1) * 1664525 + 1013904223;
      for (let i = bars - 1; i > 0; i--) {
        s = (s * 1664525 + 1013904223) | 0;
        const j = Math.abs(s) % (i + 1);
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
      }
      return arr;
    });

    function resizeIfNeeded() {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }

    function sample(): Float32Array {
      const out = new Float32Array(bars);
      const analyser = getAnalyser();
      if (!analyser || !isPlaying) return out;
      if (!buffer || buffer.length !== analyser.frequencyBinCount) {
        buffer = new Uint8Array(analyser.frequencyBinCount);
      }
      analyser.getByteFrequencyData(buffer);
      const usable = Math.floor(buffer.length * 0.75);
      const perBar = Math.max(1, Math.floor(usable / bars));
      for (let i = 0; i < bars; i++) {
        let sum = 0;
        for (let j = 0; j < perBar; j++) sum += buffer[i * perBar + j];
        out[i] = sum / perBar / 255;
      }
      return out;
    }

    function tween(target: Float32Array) {
      for (let i = 0; i < bars; i++) {
        const t = target[i];
        const c = heights[i];
        const rate = t > c ? 0.55 : 0.12;
        heights[i] = c + (t - c) * rate;
        // Peak cap: jump to current height when it exceeds the cap, then
        // hold for ~12 frames before falling at a constant rate.
        if (heights[i] >= peaks[i]) {
          peaks[i] = heights[i];
          peakHoldFrames[i] = 12;
        } else if (peakHoldFrames[i] > 0) {
          peakHoldFrames[i]--;
        } else {
          peaks[i] = Math.max(heights[i], peaks[i] - 0.012);
        }
      }
    }

    /** Sample the FFT into RIBBON_LAYERS independent slices. Each layer
     *  covers a contiguous (but slightly overlapping) chunk of the
     *  spectrum, so layer 0 = sub-bass, layer N = high treble. Width is
     *  expanded sub-linearly so high-frequency layers (which span more
     *  Hz per bin) don't dominate. Tweens are applied per-layer. */
    function sampleAndTweenRibbon() {
      const analyser = getAnalyser();
      if (!analyser || !isPlaying) {
        // Decay all layers toward zero when paused
        for (let l = 0; l < RIBBON_LAYERS; l++) {
          for (let i = 0; i < bars; i++) {
            ribbonHeights[l][i] = ribbonHeights[l][i] * 0.9;
          }
        }
        return;
      }
      if (!buffer || buffer.length !== analyser.frequencyBinCount) {
        buffer = new Uint8Array(analyser.frequencyBinCount);
      }
      analyser.getByteFrequencyData(buffer);
      const usable = Math.max(8, Math.floor(buffer.length * 0.85));
      // Slice centers follow a power curve (perceptual). Slices OVERLAP
      // — each spans 30% of the usable spectrum — so even low-frequency
      // layers get plenty of bins to draw from.
      const sliceWidth = Math.max(6, Math.floor(usable * 0.3));
      for (let l = 0; l < RIBBON_LAYERS; l++) {
        const t = l / Math.max(1, RIBBON_LAYERS - 1);
        const center = Math.pow(t, 1.6) * usable;
        const start = Math.max(0, Math.floor(center - sliceWidth / 2));
        const end = Math.min(usable, start + sliceWidth);
        const sliceLen = Math.max(1, end - start);
        const perm = ribbonPerms[l];
        for (let i = 0; i < bars; i++) {
          // Permuted t spreads the slice across the full canvas width
          // in a scrambled order — bin 0 might land near the right,
          // bin N near the middle, etc., so the 6 layers create a
          // chaotic interleave instead of all sloping the same way.
          const tx = perm[i] / Math.max(1, bars - 1);
          const binIdxF = start + tx * (sliceLen - 1);
          const lo = Math.min(end - 1, Math.floor(binIdxF));
          const hi = Math.min(end - 1, lo + 1);
          const frac = binIdxF - lo;
          const sampled = (buffer[lo] * (1 - frac) + buffer[hi] * frac) / 255;
          const cur = ribbonHeights[l][i];
          const rate = sampled > cur ? 0.55 : 0.12;
          ribbonHeights[l][i] = cur + (sampled - cur) * rate;
        }
      }
    }

    function draw() {
      if (!canvas || !ctx) return;
      resizeIfNeeded();
      const W = canvas.width;
      const H = canvas.height;

      tween(sample());
      if (style === 'ribbon') sampleAndTweenRibbon();
      ctx.clearRect(0, 0, W, H);

      switch (style) {
        case 'bars':
          drawBars(ctx, W, H, heights);
          break;
        case 'mirror':
          drawMirror(ctx, W, H, heights);
          break;
        case 'wave':
          drawWave(ctx, W, H, heights);
          break;
        case 'pulse':
          drawPulse(ctx, W, H, heights);
          break;
        case 'rainbow':
          drawRainbow(ctx, W, H, heights);
          break;
        case 'caps':
          drawCaps(ctx, W, H, heights, peaks);
          break;
        case 'dots':
          drawDots(ctx, W, H, heights);
          break;
        case 'ribbon':
          drawRibbon(ctx, W, H, ribbonHeights);
          break;
        case 'flower':
          rot += 0.004;
          drawFlower(ctx, W, H, heights, rot);
          break;
      }

      raf = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(raf);
  }, [bars, style, getAnalyser, isPlaying]);

  return (
    <div className="relative" style={{ height: `${height}px` }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
      {/* Style switcher: small bezel button top-right */}
      <button
        onClick={cycleStyle}
        title={`Visualizer: ${STYLE_LABEL[style]} (click to cycle)`}
        className="absolute top-2 right-2 text-[10px] px-2 py-1 rounded-full bezel text-zinc-300 hover:text-white"
      >
        {STYLE_LABEL[style]}
      </button>
    </div>
  );
}

/* -------------------- Style implementations -------------------- */

function drawBars(
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

    // Reflection
    const refH = Math.min(reflectH, Math.round(h * 0.85));
    const grad = ctx.createLinearGradient(0, reflectStartY, 0, reflectStartY + refH);
    grad.addColorStop(0, ampColor(v, 0.6));
    grad.addColorStop(1, ampColor(v, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(x, reflectStartY, w, refH);
  }
}

function drawMirror(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  heights: Float32Array,
) {
  const bars = heights.length;
  const mid = Math.round(H / 2);
  const halfH = Math.round(H * 0.48);
  const gap = Math.max(2, Math.floor(W / bars / 6));
  const barW = (W - gap * (bars - 1)) / bars;
  const minBarH = Math.max(2, Math.round(H * 0.01));

  for (let i = 0; i < bars; i++) {
    const v = heights[i];
    const h = Math.max(minBarH, Math.round(v * halfH));
    const x = Math.round(i * (barW + gap));
    const w = Math.ceil(barW);

    ctx.fillStyle = ampColor(v);
    // Upward bar
    ctx.fillRect(x, mid - h, w, h);
    // Mirrored downward bar (slightly fainter)
    ctx.fillStyle = ampColor(v, 0.75);
    ctx.fillRect(x, mid, w, h);
  }

  // Faint center axis line
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.fillRect(0, mid, W, 1);
}

function drawWave(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  heights: Float32Array,
) {
  const bars = heights.length;
  // Baseline near the bottom; peak can reach almost to the top so the
  // curve uses ~85% of the canvas height instead of the previous 8%.
  const baseY = Math.round(H * 0.92);
  const peakH = Math.round(H * 0.06);

  // Build smooth curve via quadratic interpolation between bin centers
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

  // Fill with vertical gradient based on average amplitude
  let avg = 0;
  for (let i = 0; i < bars; i++) avg += heights[i];
  avg /= bars;
  const grad = ctx.createLinearGradient(0, peakH, 0, baseY);
  grad.addColorStop(0, ampColor(Math.min(1, avg * 1.4), 0.85));
  grad.addColorStop(1, ampColor(avg, 0.15));
  ctx.fillStyle = grad;
  ctx.fill();

  // Bright stroke on the curve
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

/* Pulse: bars are mirrored around the canvas center. When the music is
 * quiet, bars are squeezed close to the middle; as overall amplitude
 * rises, the whole pattern expands outward like a sound wave radiating
 * from the center. Each individual bar's height also scales with its
 * own band's amplitude so loud frequencies pop visibly. */
function drawPulse(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  heights: Float32Array,
) {
  const bars = heights.length;
  const halfBars = bars; // each band rendered once on each side
  const centerX = W / 2;
  const centerY = H / 2;
  const maxBarH = Math.round(H * 0.85);
  const minBarH = Math.max(2, Math.round(H * 0.02));

  // Average amplitude controls the lateral spread: quiet → 0.4 of width,
  // loud → 1.0 of width. Smoothed via the height tween already applied.
  let avg = 0;
  for (let i = 0; i < bars; i++) avg += heights[i];
  avg /= bars;
  const spread = 0.4 + Math.min(1, avg * 1.6) * 0.6;
  const halfWidth = (W / 2) * spread;

  // Center axis tint
  const axisGrad = ctx.createLinearGradient(centerX - halfWidth, 0, centerX + halfWidth, 0);
  axisGrad.addColorStop(0, 'rgba(255,255,255,0)');
  axisGrad.addColorStop(0.5, ampColor(Math.min(1, avg * 1.4), 0.18));
  axisGrad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = axisGrad;
  ctx.fillRect(centerX - halfWidth, centerY - 1, halfWidth * 2, 2);

  // Bar slot width derived from spread so bars stay flush as they expand
  const slotW = (halfWidth / halfBars) * 0.8;
  const barW = Math.max(1.5, slotW);

  for (let i = 0; i < halfBars; i++) {
    const v = heights[i];
    const h = Math.max(minBarH, Math.round(v * maxBarH));
    // Bars near center come from the lowest frequency bins, walking
    // outward through higher frequencies. A small pow curve makes the
    // expansion feel more organic than a linear ramp.
    const t = (i + 0.5) / halfBars;
    const offset = Math.pow(t, 0.85) * halfWidth;

    const yTop = centerY - h / 2;
    const color = ampColor(v);
    ctx.fillStyle = color;
    // Right side
    ctx.fillRect(Math.round(centerX + offset - barW / 2), yTop, barW, h);
    // Left side (mirrored)
    ctx.fillRect(Math.round(centerX - offset - barW / 2), yTop, barW, h);
  }

  // Subtle bloom dot at the dead center on hard hits — sells the
  // "compressed core releasing energy" feel.
  const coreR = Math.max(2, Math.min(W, H) * 0.012) * (0.6 + avg * 1.6);
  const coreGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, coreR * 4);
  coreGrad.addColorStop(0, ampColor(Math.min(1, avg * 1.6), 0.85));
  coreGrad.addColorStop(1, ampColor(avg, 0));
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(centerX, centerY, coreR * 4, 0, Math.PI * 2);
  ctx.fill();
}

/* Rainbow: bars colored by their position across the spectrum, with a
 * neon-style outer glow. Hue does NOT depend on amplitude here (unlike
 * the default ampColor) — it depends on bar index, so the strip always
 * shows a full rainbow regardless of how loud the music is. */
function drawRainbow(
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

    // Vertical gradient gives the neon "glowing core" look.
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

/* Caps: classic vintage-EQ bars with a small floating peak cap that
 * holds briefly above the current bar, then falls. Block segments make
 * the bar look pixelated like a hardware level meter. */
function drawCaps(
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
  // Stack of fixed-height "blocks" — fewer = chunkier
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
        // Bottom blocks cyan, top blocks shifting to magenta as it climbs
        const hue = 200 - t * 130;
        ctx.fillStyle = `hsl(${hue}, 90%, ${50 + t * 15}%)`;
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
      }
      ctx.fillRect(x, blockY, w, blockH);
    }

    // Floating peak cap
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

/* Dots: each bar is a column of glowing dots — like the orange dot-matrix
 * tile in the reference. Lit dots fade slightly with height for depth. */
function drawDots(
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
        // Warm gradient: yellow at base → orange → red at top
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

/* Ribbon: the wave drawn 6 times stacked with vertical phase offsets and
 * shifted hues, producing the multi-line "ribbon" feel from the
 * reference image's top-left tile. */
function drawRibbon(
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

  // Each layer represents a different frequency band — bass at the top
  // (or bottom, by sign) with chunky low-frequency motion, treble with
  // fast fine motion. We give each its own baseline offset and gain.
  const LAYER_DEF = [
    { label: 'sub-bass',  baseline: -0.30, gain: 1.7, hue: 290 }, // magenta
    { label: 'bass',      baseline: -0.18, gain: 1.7, hue: 320 }, // pink/red
    { label: 'low-mid',   baseline: -0.06, gain: 1.9, hue:   0 }, // red/orange
    { label: 'mid',       baseline:  0.06, gain: 2.1, hue:  45 }, // orange/yellow
    { label: 'upper-mid', baseline:  0.18, gain: 2.4, hue: 130 }, // green
    { label: 'treble',    baseline:  0.30, gain: 2.8, hue: 200 }, // cyan/blue
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
      // Alternate sign per bar so the band snakes through its baseline
      // instead of just bowing one way.
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

/* Flower: each bar becomes a petal radiating from the canvas center.
 * Petals are drawn as thin lines from an inner ring outward, length
 * scaling with band amplitude. A slow rotation gives the spirograph
 * feel of the reference's central tile. */
function drawFlower(
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

  // Multiple rotated layers for the spirograph weave. We boost the
  // per-band amplitude with a sqrt curve + a 1.8× gain so even modest
  // bands push petals past the inner ring; without this the petals
  // barely poked out of the core.
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
      // Sqrt amplifies low values more than high ones, then we cap at 1.
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

  // Bright inner core
  const coreR = innerR * (0.6 + avg * 0.6);
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2);
  coreGrad.addColorStop(0, `hsla(50, 100%, 65%, ${0.7 + avg * 0.3})`);
  coreGrad.addColorStop(1, 'hsla(50, 100%, 50%, 0)');
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR * 2, 0, Math.PI * 2);
  ctx.fill();

  // Dark inner hole, like the reference
  ctx.fillStyle = 'rgba(0,0,0,0.85)';
  ctx.beginPath();
  ctx.arc(cx, cy, innerR * 0.55, 0, Math.PI * 2);
  ctx.fill();
}
