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

type VizStyle = 'bars' | 'mirror' | 'wave';
const STYLES: VizStyle[] = ['bars', 'mirror', 'wave'];
const STYLE_LABEL: Record<VizStyle, string> = {
  bars: 'Bars',
  mirror: 'Mirror',
  wave: 'Wave',
};

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
      }
    }

    function draw() {
      if (!canvas || !ctx) return;
      resizeIfNeeded();
      const W = canvas.width;
      const H = canvas.height;

      tween(sample());
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
  const baseY = Math.round(H * 0.85);
  const peakH = baseY - Math.round(H * 0.08);

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
