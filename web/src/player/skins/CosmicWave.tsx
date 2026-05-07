import { useEffect, useRef } from 'react';

interface Props {
  /** Live AnalyserNode getter from PlayerContext. */
  getAnalyser: () => AnalyserNode | null;
  isPlaying: boolean;
  height?: number;
}

/**
 * Cosmic-skin signature waveform: horizontal neon gradient bars driven by
 * the same analyser the global visualizer uses. Stripped-down, no preset
 * cycling, no settings. See `Player Skin/skin-02-cosmic.md` §4.
 */
export default function CosmicWave({ getAnalyser, isPlaying, height = 100 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const BARS = 64;
    const heights = new Float32Array(BARS);
    let raf = 0;
    let buffer: Uint8Array | null = null;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas!.getBoundingClientRect();
      canvas!.width = Math.round(rect.width * dpr);
      canvas!.height = Math.round(rect.height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    function frame() {
      const W = canvas!.clientWidth;
      const H = canvas!.clientHeight;
      ctx!.clearRect(0, 0, W, H);

      const analyser = getAnalyser();
      if (analyser && isPlaying) {
        const N = analyser.frequencyBinCount;
        if (!buffer || buffer.length !== N) buffer = new Uint8Array(N);
        analyser.getByteFrequencyData(buffer);

        // Sample log-distributed bins into BARS slots.
        const minBin = 2;
        const maxBin = Math.min(N - 1, Math.floor(N * 0.55));
        for (let i = 0; i < BARS; i++) {
          const t0 = i / BARS;
          const t1 = (i + 1) / BARS;
          const lo = Math.floor(minBin + (maxBin - minBin) * Math.pow(t0, 1.6));
          const hi = Math.max(lo + 1, Math.floor(minBin + (maxBin - minBin) * Math.pow(t1, 1.6)));
          let s = 0;
          for (let k = lo; k < hi; k++) s += buffer[k];
          const v = s / ((hi - lo) * 255);
          // Smooth attack/decay so bars don't jitter.
          const target = Math.min(1, Math.pow(v, 1.1) * 1.5);
          const prev = heights[i];
          heights[i] = target > prev ? prev * 0.55 + target * 0.45 : prev * 0.85 + target * 0.15;
        }
      } else {
        // Decay to flat when paused.
        for (let i = 0; i < BARS; i++) heights[i] *= 0.92;
      }

      // Horizontal neon gradient.
      const grad = ctx!.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0.00, '#7C3AED');
      grad.addColorStop(0.25, '#E040C8');
      grad.addColorStop(0.45, '#FF6FB5');
      grad.addColorStop(0.55, '#FF9D4D');
      grad.addColorStop(0.70, '#FF6FB5');
      grad.addColorStop(0.85, '#E040C8');
      grad.addColorStop(1.00, '#7C3AED');

      const barW = W / BARS;
      const gap = Math.max(1, barW * 0.18);
      const drawW = Math.max(1, barW - gap);

      ctx!.shadowColor = 'rgba(224, 64, 200, 0.55)';
      ctx!.shadowBlur = 6;
      ctx!.fillStyle = grad;

      for (let i = 0; i < BARS; i++) {
        const h = Math.max(2, heights[i] * H);
        const x = i * barW + gap / 2;
        const y = H - h;
        ctx!.fillRect(x, y, drawW, h);
      }
      ctx!.shadowBlur = 0;

      // Center thin line for inactivity reference.
      ctx!.fillStyle = 'rgba(255,255,255,0.04)';
      ctx!.fillRect(0, H - 1, W, 1);

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [getAnalyser, isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height, display: 'block' }}
    />
  );
}
