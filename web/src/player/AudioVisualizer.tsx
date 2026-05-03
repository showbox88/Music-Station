/**
 * Real-time frequency-bar visualizer driven by the AnalyserNode exposed
 * from PlayerContext. EQ-style bars with magenta→orange→yellow gradient
 * and a faint reflection underneath.
 *
 * Polls AnalyserNode.getByteFrequencyData each rAF tick. If the analyser
 * isn't available yet (no play has happened), draws a flat idle line.
 */
import { useEffect, useRef } from 'react';
import { usePlayer } from './PlayerContext';

interface Props {
  /** Number of bars to render across the width. */
  bars?: number;
  /** Height in CSS pixels. */
  height?: number;
}

export default function AudioVisualizer({ bars = 56, height = 80 }: Props) {
  const { getAnalyser, isPlaying } = usePlayer();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let buffer: Uint8Array | null = null;

    // Idle decay state — when analyser isn't available or playback is
    // paused, the bar heights ease toward zero instead of snapping.
    const heights = new Float32Array(bars);

    function resizeIfNeeded() {
      if (!canvas) return false;
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      const w = Math.round(cssW * dpr);
      const h = Math.round(cssH * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        return true;
      }
      return false;
    }

    function draw() {
      if (!canvas || !ctx) return;
      resizeIfNeeded();
      const W = canvas.width;
      const H = canvas.height;

      const analyser = getAnalyser();
      // Bin the FFT down to `bars` discrete columns by averaging chunks
      let nextHeights: Float32Array;
      if (analyser && isPlaying) {
        if (!buffer || buffer.length !== analyser.frequencyBinCount) {
          buffer = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(buffer);
        // Use the lower 75% of bins (high freq is mostly silence in music)
        const usable = Math.floor(buffer.length * 0.75);
        const perBar = Math.max(1, Math.floor(usable / bars));
        nextHeights = new Float32Array(bars);
        for (let i = 0; i < bars; i++) {
          let sum = 0;
          for (let j = 0; j < perBar; j++) sum += buffer[i * perBar + j];
          // Boost lows (perceptual): amplify mid bars slightly
          const v = (sum / perBar) / 255;
          nextHeights[i] = v;
        }
      } else {
        nextHeights = new Float32Array(bars); // all zeros → decay toward 0
      }

      // Smooth toward target (visual easing)
      for (let i = 0; i < bars; i++) {
        const target = nextHeights[i];
        const cur = heights[i];
        // Faster rise than fall feels punchier
        const rate = target > cur ? 0.55 : 0.12;
        heights[i] = cur + (target - cur) * rate;
      }

      // Clear
      ctx.clearRect(0, 0, W, H);

      // Layout: draw bars in upper 2/3, reflection in lower 1/3
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

        // Hue gradient: magenta (left) → red → orange → yellow (right)
        // Hue 320 → 60 (clockwise on the color wheel: pink→red→orange→yellow)
        const hue = 320 - (i / Math.max(1, bars - 1)) * 260;
        // Brightness pulses slightly with the bar height for liveliness
        const lightness = 50 + v * 10;
        ctx.fillStyle = `hsl(${hue}, 95%, ${lightness}%)`;

        // Main bar
        ctx.fillRect(x, y, w, h);

        // Reflection — flipped, fading out
        const refH = Math.min(reflectH, Math.round(h * 0.8));
        const grad = ctx.createLinearGradient(0, reflectStartY, 0, reflectStartY + refH);
        grad.addColorStop(0, `hsla(${hue}, 95%, ${lightness}%, 0.55)`);
        grad.addColorStop(1, `hsla(${hue}, 95%, ${lightness}%, 0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(x, reflectStartY, w, refH);
      }

      raf = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(raf);
  }, [bars, getAnalyser, isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      style={{ height: `${height}px`, width: '100%', display: 'block' }}
    />
  );
}
