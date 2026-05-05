/**
 * Visualizer Lab — preview every visualizer style at once, hide ones you
 * don't want in the cycle, and paste your own draw code as a custom style.
 *
 * The grid runs ONE shared RAF that updates synthetic heights/peaks/rot
 * (so previews animate even with no audio playing) and then asks each
 * tile to redraw. New tiles attach a per-tile draw callback through a
 * ref-based registry.
 *
 * Custom styles are stored in PrefsContext as `viz_custom`; built-in
 * styles can be hidden via `viz_disabled`. Both lists feed
 * AudioVisualizer.tsx's cycle button.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrefs } from '../PrefsContext';
import {
  STYLES,
  STYLE_LABEL,
  drawStyle,
  compileCustom,
  type VizStyle,
  type VizCustom,
  type CustomDrawFn,
} from '../player/viz';
import { useT } from '../i18n/useT';

const BARS = 56;
const RIBBON_LAYERS = 6;

/** Generate a smooth, periodic synthetic spectrum so previews animate
 *  without an audio source. The pattern modulates per-bar, with fast
 *  high-frequency wiggle and a slow low-frequency envelope. */
function synthHeights(t: number, out: Float32Array) {
  for (let i = 0; i < out.length; i++) {
    const norm = i / out.length;
    const fast = Math.sin(t * 2.4 + i * 0.42);
    const slow = Math.sin(t * 0.7 + i * 0.13);
    // Falloff so high bins are quieter, mimicking real music spectra.
    const tilt = 1 - norm * 0.55;
    const v = (0.55 + 0.45 * fast) * (0.55 + 0.45 * slow) * tilt;
    out[i] = Math.max(0, Math.min(1, v));
  }
}

function synthRibbon(t: number, layers: Float32Array[]) {
  for (let l = 0; l < layers.length; l++) {
    const phase = (l / layers.length) * 2.6;
    for (let i = 0; i < layers[l].length; i++) {
      const v =
        0.5 +
        0.5 *
          Math.sin(t * (1 + l * 0.25) + i * 0.31 + phase) *
          Math.sin(t * 0.6 + i * 0.07);
      layers[l][i] = Math.max(0, Math.min(1, v));
    }
  }
}

export default function VisualizerLab() {
  const t = useT();
  const { prefs, setPref } = usePrefs();
  const disabled = useMemo(
    () => new Set(prefs.viz_disabled ?? []),
    [prefs.viz_disabled],
  );
  const customs = prefs.viz_custom ?? [];

  // Each tile registers a (heights, peaks, rot, ribbon) → void callback
  // here. The shared RAF iterates and calls them all every frame.
  const drawersRef = useRef<Map<string, (s: SharedState) => void>>(new Map());

  // Single RAF drives all tiles + the live-preview pane.
  useEffect(() => {
    let raf = 0;
    const heights = new Float32Array(BARS);
    const peaks = new Float32Array(BARS);
    const ribbon: Float32Array[] = Array.from(
      { length: RIBBON_LAYERS },
      () => new Float32Array(BARS),
    );
    let rot = 0;
    let t0 = performance.now();

    function tick() {
      const t = (performance.now() - t0) / 1000;
      synthHeights(t, heights);
      synthRibbon(t, ribbon);
      // Peaks track heights with a slow decay, like the real visualizer.
      for (let i = 0; i < BARS; i++) {
        peaks[i] = Math.max(heights[i], peaks[i] - 0.008);
      }
      rot += 0.004;
      const state: SharedState = { heights, peaks, ribbon, rot };
      for (const fn of drawersRef.current.values()) {
        try {
          fn(state);
        } catch {
          /* per-tile errors are surfaced inside that tile */
        }
      }
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  function toggleBuiltin(s: VizStyle) {
    const next = new Set(prefs.viz_disabled ?? []);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setPref('viz_disabled', Array.from(next));
  }

  function deleteCustom(id: string) {
    if (!confirm(t('viz_lab.delete_confirm'))) return;
    const next = (prefs.viz_custom ?? []).filter((c) => c.id !== id);
    setPref('viz_custom', next);
    // If the user was actively using this custom, reset to first built-in.
    if (prefs.viz_style === id) setPref('viz_style', STYLES[0]);
  }

  function saveCustom(name: string, code: string) {
    const id = `custom_${Date.now().toString(36)}`;
    const next: VizCustom[] = [...(prefs.viz_custom ?? []), { id, name, code }];
    setPref('viz_custom', next);
  }

  return (
    <main className="flex-1 min-w-0 flex flex-col h-full overflow-hidden">
      <div className="px-5 py-3 border-b border-black/60 flex items-center gap-3 shrink-0">
        <h1 className="text-base font-semibold">🎨 {t('viz_lab.title')}</h1>
        <span className="text-xs text-zinc-500 truncate">{t('viz_lab.description')}</span>
      </div>

      <div className="flex-1 overflow-auto px-5 py-4 space-y-6">
        {/* Built-ins */}
        <section>
          <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">
            {t('viz_lab.builtins_section')}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {STYLES.map((s) => (
              <BuiltinTile
                key={s}
                style={s}
                hidden={disabled.has(s)}
                onToggle={() => toggleBuiltin(s)}
                drawersRef={drawersRef}
              />
            ))}
          </div>
        </section>

        {/* Customs */}
        <section>
          <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">
            {t('viz_lab.custom_section')}
            <span className="ml-2 normal-case text-zinc-600 tracking-normal">
              ({customs.length})
            </span>
          </div>
          {customs.length === 0 ? (
            <div className="text-sm text-zinc-500">{t('viz_lab.no_customs')}</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {customs.map((c) => (
                <CustomTile
                  key={c.id}
                  custom={c}
                  onDelete={() => deleteCustom(c.id)}
                  drawersRef={drawersRef}
                />
              ))}
            </div>
          )}
        </section>

        {/* Add new */}
        <section>
          <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">
            {t('viz_lab.add_new')}
          </div>
          <CodePlayground onSave={saveCustom} drawersRef={drawersRef} />
        </section>
      </div>
    </main>
  );
}

/* ------------------------------ shared types ----------------------------- */

interface SharedState {
  heights: Float32Array;
  peaks: Float32Array;
  ribbon: Float32Array[];
  rot: number;
}

type DrawersRef = React.MutableRefObject<Map<string, (s: SharedState) => void>>;

/* ------------------------------ tile pieces ------------------------------ */

function TileCanvas({ tileId, draw, drawersRef }: {
  tileId: string;
  draw: (ctx: CanvasRenderingContext2D, W: number, H: number, s: SharedState) => void;
  drawersRef: DrawersRef;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Stash latest draw fn in a ref so the registered callback always uses
  // the current closure (heights array etc. are stable refs in the parent).
  const drawRef = useRef(draw);
  drawRef.current = draw;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cb = (s: SharedState) => {
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(canvas.clientWidth * dpr);
      const h = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawRef.current(ctx, canvas.width, canvas.height, s);
    };
    drawersRef.current.set(tileId, cb);
    return () => {
      drawersRef.current.delete(tileId);
    };
  }, [tileId, drawersRef]);

  return (
    <canvas
      ref={ref}
      className="block w-full"
      style={{ height: 120, background: '#0d0d0e' }}
    />
  );
}

function BuiltinTile({
  style,
  hidden,
  onToggle,
  drawersRef,
}: {
  style: VizStyle;
  hidden: boolean;
  onToggle: () => void;
  drawersRef: DrawersRef;
}) {
  const t = useT();
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, W: number, H: number, s: SharedState) => {
      drawStyle(style, {
        ctx, W, H,
        heights: s.heights,
        peaks: s.peaks,
        rot: s.rot,
        ribbonHeights: s.ribbon,
      });
    },
    [style],
  );

  return (
    <div
      className={`rounded-xl overflow-hidden border ${
        hidden ? 'border-zinc-800 opacity-45' : 'border-black/60'
      }`}
      style={{ background: 'linear-gradient(180deg, #1c1c1e 0%, #18181a 100%)' }}
    >
      <TileCanvas tileId={`builtin:${style}`} draw={draw} drawersRef={drawersRef} />
      <div className="flex items-center px-3 py-2 gap-2">
        <span className="text-sm font-medium flex-1 truncate">
          {STYLE_LABEL[style]}
        </span>
        <span className="text-[10px] text-zinc-600 uppercase">
          {t('viz_lab.builtin_badge')}
        </span>
        <button
          onClick={onToggle}
          className="text-xs px-3 py-1 rounded-full bezel text-zinc-300 hover:text-white"
          title={hidden ? t('viz_lab.show_tooltip') : t('viz_lab.hide_tooltip')}
        >
          {hidden ? t('viz_lab.show') : t('viz_lab.hide')}
        </button>
      </div>
    </div>
  );
}

function CustomTile({
  custom,
  onDelete,
  drawersRef,
}: {
  custom: VizCustom;
  onDelete: () => void;
  drawersRef: DrawersRef;
}) {
  const t = useT();
  const [err, setErr] = useState<string | null>(null);

  const fnRef = useRef<CustomDrawFn | null>(null);
  useEffect(() => {
    const r = compileCustom(custom.code);
    if ('fn' in r) {
      fnRef.current = r.fn;
      setErr(null);
    } else {
      fnRef.current = null;
      setErr(r.error);
    }
  }, [custom.code]);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, W: number, H: number, s: SharedState) => {
      const fn = fnRef.current;
      if (!fn) return;
      try {
        fn(ctx, W, H, s.heights, s.peaks, s.rot);
      } catch (e: any) {
        fnRef.current = null;
        setErr(String(e?.message ?? e));
      }
    },
    [],
  );

  return (
    <div
      className="rounded-xl overflow-hidden border border-black/60"
      style={{ background: 'linear-gradient(180deg, #1c1c1e 0%, #18181a 100%)' }}
    >
      <TileCanvas tileId={`custom:${custom.id}`} draw={draw} drawersRef={drawersRef} />
      {err && (
        <div className="error-box mx-3 mt-2 truncate" title={err}>
          {err}
        </div>
      )}
      <div className="flex items-center px-3 py-2 gap-2">
        <span className="text-sm font-medium flex-1 truncate">{custom.name}</span>
        <span className="text-[10px] text-fuchsia-400 uppercase">
          {t('viz_lab.custom_badge')}
        </span>
        <button
          onClick={onDelete}
          className="text-xs px-3 py-1 rounded-full bezel text-zinc-300 hover:text-red-400"
          title={t('viz_lab.delete_tooltip')}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/* ------------------------- code paste + live preview --------------------- */

const STARTER_CODE = `// (ctx, W, H, heights, peaks, rot) — heights[i] in 0..1, length 56
const bars = heights.length;
const gap = 2;
const barW = (W - gap * (bars - 1)) / bars;
for (let i = 0; i < bars; i++) {
  const v = heights[i];
  const h = v * H * 0.9;
  const x = i * (barW + gap);
  const hue = (i / bars) * 360 + rot * 60;
  ctx.fillStyle = \`hsl(\${hue}, 90%, \${50 + v * 20}%)\`;
  ctx.fillRect(x, H - h, barW, h);
}`;

function CodePlayground({
  onSave,
  drawersRef,
}: {
  onSave: (name: string, code: string) => void;
  drawersRef: DrawersRef;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [code, setCode] = useState(STARTER_CODE);
  const [previewCode, setPreviewCode] = useState(STARTER_CODE);
  const [err, setErr] = useState<string | null>(null);

  const fnRef = useRef<CustomDrawFn | null>(null);
  useEffect(() => {
    const r = compileCustom(previewCode);
    if ('fn' in r) {
      fnRef.current = r.fn;
      setErr(null);
    } else {
      fnRef.current = null;
      setErr(r.error);
    }
  }, [previewCode]);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, W: number, H: number, s: SharedState) => {
      const fn = fnRef.current;
      if (!fn) return;
      try {
        fn(ctx, W, H, s.heights, s.peaks, s.rot);
      } catch (e: any) {
        fnRef.current = null;
        setErr(String(e?.message ?? e));
      }
    },
    [],
  );

  function handlePreview() {
    setPreviewCode(code);
  }

  function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      alert(t('viz_lab.name_required'));
      return;
    }
    // Compile once before saving so we don't store known-broken code.
    const r = compileCustom(code);
    if ('error' in r) {
      setErr(r.error);
      return;
    }
    onSave(trimmedName, code);
    setName('');
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="space-y-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('viz_lab.name_placeholder')}
          className="input w-full"
        />
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          className="input w-full font-mono text-xs"
          style={{ minHeight: 220, resize: 'vertical' }}
        />
        <div className="flex gap-2">
          <button onClick={handlePreview} className="btn-secondary">
            {t('viz_lab.preview')}
          </button>
          <button onClick={handleSave} className="btn-primary">
            {t('viz_lab.save')}
          </button>
        </div>
        <p className="text-[11px] text-zinc-500 leading-snug">
          {t('viz_lab.signature_hint')}
        </p>
      </div>
      <div className="space-y-2">
        <div
          className="rounded-xl overflow-hidden border border-black/60"
          style={{ background: 'linear-gradient(180deg, #1c1c1e 0%, #18181a 100%)' }}
        >
          <TileCanvas tileId="playground" draw={draw} drawersRef={drawersRef} />
          <div className="px-3 py-2 text-xs text-zinc-500">
            {t('viz_lab.live_preview')}
          </div>
        </div>
        {err && <div className="error-box">{err}</div>}
      </div>
    </div>
  );
}
