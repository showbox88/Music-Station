/**
 * Real-time audio visualizer driven by AnalyserNode from PlayerContext.
 *
 * This file owns the canvas, sampling/tweening of frequency bins, and
 * dispatch to a per-style draw function. Built-in styles live under
 * `./viz/` and are registered through `./viz/index.ts`. The user can also
 * paste custom draw snippets via VisualizerLab — those are stored in
 * prefs.viz_custom and compiled lazily here.
 *
 * The user's chosen style is persisted via PrefsContext as `viz_style`.
 * Built-in styles can be hidden from the cycle via `viz_disabled`.
 */
import { useEffect, useMemo, useRef } from 'react';
import { usePlayer } from './PlayerContext';
import { usePrefs } from '../PrefsContext';
import {
  STYLES,
  STYLE_LABEL,
  drawStyle,
  compileCustom,
  type VizStyle,
  type CustomDrawFn,
} from './viz';

interface Props {
  bars?: number;
  height?: number;
}

export default function AudioVisualizer({ bars = 56, height = 200 }: Props) {
  const { getAnalyser, isPlaying } = usePlayer();
  const { prefs, setPref } = usePrefs();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // In remote mode `getAnalyser` is a fresh closure every render (it
  // captures the latest viz frame from RemoteContext). If we depended
  // on its identity directly, the RAF effect below would restart every
  // PlayerContext render, wiping the height / peak buffers and making
  // the visualizer look frozen / flickery. Stash it in a ref so the
  // draw loop always reads the latest function without re-entering.
  const getAnalyserRef = useRef(getAnalyser);
  useEffect(() => {
    getAnalyserRef.current = getAnalyser;
  }, [getAnalyser]);

  // Cycle list = enabled built-ins (in STYLES order) + custom ids.
  // If the user disables every built-in and has no customs, we fall back
  // to the full STYLES list so something still renders.
  const cycle = useMemo<string[]>(() => {
    const disabled = new Set(prefs.viz_disabled ?? []);
    const customs = prefs.viz_custom ?? [];
    const enabled = STYLES.filter((s) => !disabled.has(s));
    const list = [...enabled, ...customs.map((c) => c.id)];
    return list.length > 0 ? list : [...STYLES];
  }, [prefs.viz_disabled, prefs.viz_custom]);

  // Resolve current style id against the cycle. If the saved one was
  // removed (deleted custom, or hidden), pick the first available.
  const styleId: string = cycle.includes(prefs.viz_style as string)
    ? (prefs.viz_style as string)
    : cycle[0];

  const isBuiltin = (STYLES as string[]).includes(styleId);
  const customDef = !isBuiltin
    ? (prefs.viz_custom ?? []).find((c) => c.id === styleId) ?? null
    : null;
  const label = isBuiltin
    ? STYLE_LABEL[styleId as VizStyle]
    : customDef?.name ?? '?';

  const cycleStyle = () => {
    const i = cycle.indexOf(styleId);
    setPref('viz_style', cycle[(i + 1) % cycle.length]);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let buffer: Uint8Array | null = null;
    const heights = new Float32Array(bars);
    const peaks = new Float32Array(bars);
    const peakHoldFrames = new Int16Array(bars);
    let rot = 0;
    const RIBBON_LAYERS = 6;
    const ribbonHeights: Float32Array[] = Array.from(
      { length: RIBBON_LAYERS },
      () => new Float32Array(bars),
    );
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

    // Compile the custom draw fn once per (effect run × style change).
    // If compile fails, customErr stays set and we fall back to clearing
    // the canvas + a tiny "error" hint at top-left so the user knows.
    let customFn: CustomDrawFn | null = null;
    let customErr: string | null = null;
    if (!isBuiltin && customDef) {
      const r = compileCustom(customDef.code);
      if ('fn' in r) customFn = r.fn;
      else customErr = r.error;
    }

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
      const analyser = getAnalyserRef.current();
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

    function sampleAndTweenRibbon() {
      const analyser = getAnalyserRef.current();
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
      if (styleId === 'ribbon') sampleAndTweenRibbon();
      ctx.clearRect(0, 0, W, H);
      rot += 0.004;

      if (isBuiltin) {
        drawStyle(styleId as VizStyle, {
          ctx, W, H, heights, peaks, rot, ribbonHeights,
        });
      } else if (customFn) {
        try {
          customFn(ctx, W, H, heights, peaks, rot);
        } catch (e: any) {
          customErr = String(e?.message ?? e);
          customFn = null; // stop hammering — show error and stand still
        }
      }

      if (customErr) {
        ctx.fillStyle = 'rgba(255, 80, 80, 0.9)';
        ctx.font = '11px ui-monospace, monospace';
        ctx.fillText(`viz error: ${customErr.slice(0, 80)}`, 8, 16);
      }

      raf = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(raf);
    // getAnalyser intentionally not in deps — read via ref so we don't
    // tear down the draw loop on every PlayerContext render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, styleId, isBuiltin, customDef, isPlaying]);

  return (
    <div className="relative" style={{ height: `${height}px` }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
      <button
        onClick={cycleStyle}
        title={`Visualizer: ${label} (click to cycle)`}
        className="absolute top-2 right-2 text-[10px] px-2 py-1 rounded-full bezel text-zinc-300 hover:text-white"
      >
        {label}
      </button>
    </div>
  );
}
