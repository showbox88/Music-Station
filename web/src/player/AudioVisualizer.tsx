/**
 * Real-time audio visualizer driven by AnalyserNode from PlayerContext.
 *
 * This file owns the canvas, sampling/tweening of frequency bins, and
 * dispatch to a per-style draw function. The actual rendering for each
 * style lives in its own module under `./viz/` and is registered through
 * `./viz/index.ts`.
 *
 * The user's chosen style is persisted via PrefsContext as `viz_style`.
 */
import { useEffect, useRef } from 'react';
import { usePlayer } from './PlayerContext';
import { usePrefs } from '../PrefsContext';
import {
  STYLES,
  STYLE_LABEL,
  drawBars,
  drawMirror,
  drawWave,
  drawPulse,
  drawRainbow,
  drawCaps,
  drawDots,
  drawRibbon,
  drawFlower,
  drawStems,
  drawGrid,
  type VizStyle,
} from './viz';

interface Props {
  bars?: number;
  height?: number;
}

export default function AudioVisualizer({ bars = 56, height = 200 }: Props) {
  const { getAnalyser, isPlaying } = usePlayer();
  const { prefs, setPref } = usePrefs();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const style: VizStyle = STYLES.includes(prefs.viz_style as VizStyle)
    ? (prefs.viz_style as VizStyle)
    : 'bars';

  const cycleStyle = () => {
    const i = STYLES.indexOf(style);
    setPref('viz_style', STYLES[(i + 1) % STYLES.length]);
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
    // For Ribbon: each layer samples a different frequency slice.
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
     *  spectrum, so layer 0 = sub-bass, layer N = high treble. */
    function sampleAndTweenRibbon() {
      const analyser = getAnalyser();
      if (!analyser || !isPlaying) {
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
      const sliceWidth = Math.max(6, Math.floor(usable * 0.3));
      for (let l = 0; l < RIBBON_LAYERS; l++) {
        const t = l / Math.max(1, RIBBON_LAYERS - 1);
        const center = Math.pow(t, 1.6) * usable;
        const start = Math.max(0, Math.floor(center - sliceWidth / 2));
        const end = Math.min(usable, start + sliceWidth);
        const sliceLen = Math.max(1, end - start);
        const perm = ribbonPerms[l];
        for (let i = 0; i < bars; i++) {
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
        case 'bars':    drawBars(ctx, W, H, heights); break;
        case 'mirror':  drawMirror(ctx, W, H, heights); break;
        case 'wave':    drawWave(ctx, W, H, heights); break;
        case 'pulse':   drawPulse(ctx, W, H, heights); break;
        case 'rainbow': drawRainbow(ctx, W, H, heights); break;
        case 'caps':    drawCaps(ctx, W, H, heights, peaks); break;
        case 'dots':    drawDots(ctx, W, H, heights); break;
        case 'ribbon':  drawRibbon(ctx, W, H, ribbonHeights); break;
        case 'flower':
          rot += 0.004;
          drawFlower(ctx, W, H, heights, rot);
          break;
        case 'stems':   drawStems(ctx, W, H, heights); break;
        case 'grid':    drawGrid(ctx, W, H, heights); break;
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
