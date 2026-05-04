/**
 * Professional 10-band parametric EQ panel.
 *
 * Visual: dark gunmetal panel with 10 vertical fader strips (rotated
 * range inputs), gain readouts, frequency labels, dB scale on the side.
 * Below: pre-amp slider + preset selector + bypass + reset.
 *
 * Real audio: drives the EQController exposed by PlayerContext, which
 * applies the gain values to BiquadFilterNode.gain.value in real time.
 *
 * Triggered from NowPlayingView via an EQ icon button. Modal-style
 * overlay; click outside or press Esc to close.
 */
import { useEffect } from 'react';
import {
  usePlayer,
  EQ_GAIN_MIN,
  EQ_GAIN_MAX,
  EQ_PREAMP_MIN,
  EQ_PREAMP_MAX,
} from './PlayerContext';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Preset {
  name: string;
  gains: number[];
}

// Common presets — gain values are dB per band (32, 64, 125, 250, 500, 1k, 2k, 4k, 8k, 16k)
const PRESETS: Preset[] = [
  { name: 'Flat',         gains: [ 0,  0,  0,  0,  0,  0,  0,  0,  0,  0] },
  { name: 'Bass Boost',   gains: [ 6,  5,  4,  2,  0,  0,  0,  0,  0,  0] },
  { name: 'Treble Boost', gains: [ 0,  0,  0,  0,  0,  1,  3,  4,  5,  6] },
  { name: 'V-Shape',      gains: [ 5,  4,  2, -1, -3, -3, -1,  2,  4,  5] },
  { name: 'Vocal',        gains: [-2, -1,  0,  1,  3,  4,  3,  2,  0, -1] },
  { name: 'Acoustic',     gains: [ 3,  3,  2,  1,  2,  1,  2,  3,  3,  2] },
  { name: 'Electronic',   gains: [ 4,  4,  2,  0, -2,  1,  0,  1,  3,  4] },
  { name: 'Classical',    gains: [ 3,  2,  0,  0,  0,  0, -1, -1, -1, -2] },
  { name: 'Loudness',     gains: [ 6,  4,  0,  0, -2,  0,  0,  2,  4,  6] },
];

function fmtFreq(hz: number): string {
  if (hz >= 1000) return `${hz / 1000}k`;
  return String(hz);
}

function fmtGain(db: number): string {
  const v = Math.round(db * 10) / 10;
  if (v === 0) return '0';
  return (v > 0 ? '+' : '') + v.toFixed(v % 1 === 0 ? 0 : 1);
}

function detectActivePreset(gains: number[]): string | null {
  for (const p of PRESETS) {
    if (p.gains.every((g, i) => Math.abs(g - gains[i]) < 0.05)) return p.name;
  }
  return null;
}

export default function EQPanel({ open, onClose }: Props) {
  const { eq, globalEq } = usePlayer();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const active = detectActivePreset(eq.gains);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-xl p-6"
        style={{
          background: 'linear-gradient(180deg, #232325 0%, #18181a 100%)',
          border: '1px solid #050506',
          boxShadow:
            '0 20px 60px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 30px rgba(255,45,181,0.06)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold tracking-wide glow-text">Equalizer</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              10-band · ±12 dB ·{' '}
              {globalEq.enabled ? (
                <span className="text-emerald-400">全局模式（所有歌曲共用此曲线）</span>
              ) : (
                <span>每首歌独立保存</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => globalEq.setEnabled(!globalEq.enabled)}
              className={`text-xs px-3 py-1 rounded-full bezel ${
                globalEq.enabled ? 'glow-text glow-ring' : 'text-zinc-300'
              }`}
              title={
                globalEq.enabled
                  ? '全局模式开 — 所有歌共用此曲线，关掉则回到每首歌独立'
                  : '点击开启全局模式：所有歌都用同一条曲线，忽略每首独立的 EQ'
              }
            >
              {globalEq.enabled ? '全局' : '独立'}
            </button>
            <button
              onClick={() => eq.setBypass(!eq.bypass)}
              className={`text-xs px-3 py-1 rounded-full bezel ${
                eq.bypass ? 'text-zinc-300' : 'glow-text glow-ring'
              }`}
              title={eq.bypass ? 'EQ off — click to engage' : 'EQ engaged — click to bypass'}
            >
              {eq.bypass ? 'Off' : 'On'}
            </button>
            <button
              onClick={eq.reset}
              className="text-xs px-3 py-1 rounded-full bezel text-zinc-300 hover:text-white"
              title="Reset all bands and pre-amp to 0 dB"
            >
              Reset
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bezel text-zinc-300 hover:text-white flex items-center justify-center"
              title="Close (Esc)"
            >
              ✕
            </button>
          </div>
        </div>

        {!globalEq.enabled && (
          <button
            onClick={globalEq.promoteCurrent}
            className="mb-4 text-[11px] px-3 py-1 rounded-full bezel text-zinc-400 hover:text-white"
            title="把当前曲线保存为全局曲线并切换到全局模式"
          >
            ↑ 把当前曲线设为全局
          </button>
        )}

        {/* dB scale + faders row */}
        <div className="flex items-stretch gap-1 mb-4" style={{ opacity: eq.bypass ? 0.4 : 1 }}>
          {/* Left scale */}
          <div className="flex flex-col justify-between text-[10px] text-zinc-600 tabular-nums py-1 pr-2 select-none">
            <span>+12</span>
            <span>+6</span>
            <span>0</span>
            <span>-6</span>
            <span>-12</span>
          </div>

          {/* Faders */}
          <div className="flex-1 flex items-stretch justify-around gap-1">
            {eq.frequencies.map((hz, i) => (
              <FaderColumn
                key={hz}
                hz={hz}
                value={eq.gains[i]}
                onChange={(v) => eq.setGain(i, v)}
                bypassed={eq.bypass}
              />
            ))}
          </div>

          {/* Right scale (mirrored, optional) */}
          <div className="flex flex-col justify-between text-[10px] text-zinc-600 tabular-nums py-1 pl-2 select-none">
            <span>+12</span>
            <span>+6</span>
            <span>0</span>
            <span>-6</span>
            <span>-12</span>
          </div>
        </div>

        {/* Pre-amp + presets row */}
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-black/40">
          {/* Pre-amp */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs uppercase text-zinc-500 tracking-wide">Pre-amp</span>
              <span className="text-xs text-zinc-300 tabular-nums">
                {fmtGain(eq.preamp)} dB
              </span>
            </div>
            <input
              type="range"
              min={EQ_PREAMP_MIN}
              max={EQ_PREAMP_MAX}
              step={0.5}
              value={eq.preamp}
              onChange={(e) => eq.setPreamp(Number(e.target.value))}
              className="w-full"
              style={{
                background: `linear-gradient(to right,
                  var(--accent) 0%,
                  var(--accent-soft) ${
                    ((eq.preamp - EQ_PREAMP_MIN) / (EQ_PREAMP_MAX - EQ_PREAMP_MIN)) * 100
                  }%,
                  #0a0a0b ${
                    ((eq.preamp - EQ_PREAMP_MIN) / (EQ_PREAMP_MAX - EQ_PREAMP_MIN)) * 100
                  }%,
                  #1a1a1c 100%)`,
                WebkitAppearance: 'none',
                height: 4,
                borderRadius: 9999,
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.8)',
              }}
            />
            <p className="text-[10px] text-zinc-600 mt-1">
              Reduce when boosting bands to prevent clipping.
            </p>
          </div>

          {/* Presets */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs uppercase text-zinc-500 tracking-wide">Preset</span>
              <span className="text-xs text-zinc-500">{active ? '' : 'Custom'}</span>
            </div>
            <select
              value={active ?? ''}
              onChange={(e) => {
                const p = PRESETS.find((x) => x.name === e.target.value);
                if (p) eq.setGains(p.gains);
              }}
              className="input"
              style={{ colorScheme: 'dark' }}
            >
              <option value="" disabled hidden>
                — Custom —
              </option>
              {PRESETS.map((p) => (
                <option
                  key={p.name}
                  value={p.name}
                  style={{ background: '#18181a', color: '#e5e5e5' }}
                >
                  {p.name}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-zinc-600 mt-1">
              Pick a starting curve, then fine-tune any band.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------- Single fader column -------------------- */
function FaderColumn({
  hz,
  value,
  onChange,
  bypassed,
}: {
  hz: number;
  value: number;
  onChange: (v: number) => void;
  bypassed: boolean;
}) {
  const FADER_HEIGHT = 180;
  const showGain = !bypassed && Math.abs(value) >= 0.05;
  // Track fill percentage relative to range (-12..+12 → 0..100)
  const fillPct = ((value - EQ_GAIN_MIN) / (EQ_GAIN_MAX - EQ_GAIN_MIN)) * 100;

  return (
    <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
      {/* Gain readout */}
      <div className={`text-[11px] tabular-nums h-4 ${showGain ? 'glow-text' : 'text-zinc-500'}`}>
        {showGain ? fmtGain(value) : '·'}
      </div>

      {/* Fader well — recessed track + custom range input */}
      <div
        className="relative w-full flex items-center justify-center"
        style={{ height: FADER_HEIGHT }}
      >
        {/* Recessed track */}
        <div
          className="absolute"
          style={{
            width: 4,
            height: '100%',
            borderRadius: 9999,
            background: 'linear-gradient(180deg, #0a0a0b, #1a1a1c)',
            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.8)',
          }}
        />
        {/* Magenta fill from the 0-dB midline to the current thumb
            position. The slider is rotated -90°, so a higher value
            shows the thumb HIGHER (closer to top), and the fill should
            extend from the midline up to it. fillPct here is "how far
            from min" (0..100); 1−fillPct/100 gives "from top" in CSS. */}
        <div
          className="absolute pointer-events-none"
          style={{
            width: 4,
            top: value >= 0 ? `${100 - fillPct}%` : '50%',
            height: `${Math.abs(50 - fillPct)}%`,
            background: bypassed
              ? 'transparent'
              : `linear-gradient(180deg, var(--accent) 0%, var(--accent-soft) 100%)`,
            borderRadius: 9999,
            boxShadow: bypassed ? 'none' : '0 0 6px var(--accent-glow)',
          }}
        />
        {/* Center 0-dB tick */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: 'calc(50% - 0.5px)',
            width: 14,
            height: 1,
            background: 'rgba(255,255,255,0.18)',
          }}
        />
        {/* Range input rotated to vertical — absolutely positioned so the
            non-rotated layout box (180px wide) does not push the column wider. */}
        <input
          type="range"
          min={EQ_GAIN_MIN}
          max={EQ_GAIN_MAX}
          step={0.5}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onDoubleClick={() => onChange(0)}
          title={`${hz} Hz: ${fmtGain(value)} dB (double-click to reset)`}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%) rotate(-90deg)',
            transformOrigin: 'center center',
            width: FADER_HEIGHT,
            height: 24,
            appearance: 'none',
            background: 'transparent',
            cursor: bypassed ? 'not-allowed' : 'pointer',
          }}
          disabled={bypassed}
        />
      </div>

      {/* Frequency label */}
      <div className="text-[10px] text-zinc-500 tabular-nums">{fmtFreq(hz)}</div>
    </div>
  );
}
