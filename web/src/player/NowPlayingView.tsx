/**
 * Fullscreen "now playing" view styled after the user's reference mockup:
 * deep purple gradient background, decorative wave at top, central vinyl
 * record with the album cover in its label area, large title/artist,
 * progress bar, and circular transport controls.
 *
 * Triggered by clicking the cover/info area in PlayerBar (or by external
 * state). Closes via the back arrow / collapse icon / Escape key.
 *
 * Vinyl rotates while playing via CSS animation, paused otherwise.
 * Tonearm is a static SVG that "touches" the record.
 */
import { useEffect, useState } from 'react';
import { usePlayer } from './PlayerContext';

function resolveCoverSrc(src: string | null): string | null {
  if (!src) return null;
  if (/^https?:/i.test(src) || src.startsWith('data:') || src.startsWith('blob:')) return src;
  if (src.startsWith('/')) {
    const base = import.meta.env.BASE_URL.replace(/\/$/, '');
    return `${base}${src}`;
  }
  return src;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtNeg(remaining: number): string {
  if (!Number.isFinite(remaining) || remaining < 0) return '-0:00';
  return `-${fmt(remaining)}`;
}

export default function NowPlayingView({ open, onClose }: Props) {
  const p = usePlayer();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !p.current) return null;

  const t = p.current;
  const remaining = Math.max(0, p.duration - p.position);
  const subtitle = [t.artist, t.year].filter(Boolean).join(' · ');

  return (
    <div
      className="fixed inset-0 z-40 text-white overflow-hidden"
      style={{
        background:
          'radial-gradient(ellipse at 50% 0%, #2a1620 0%, #0d0d0e 60%), #0d0d0e',
        backgroundColor: '#0d0d0e',
      }}
    >
      {/* Top wave decoration */}
      <div className="absolute top-12 left-0 right-0 pointer-events-none">
        <Wave />
      </div>

      {/* Centered column for everything */}
      <div className="relative h-full max-w-xl mx-auto flex flex-col px-6">
        {/* Top bar */}
        <div className="flex items-center justify-between pt-5 pb-2 shrink-0">
          <button
            onClick={onClose}
            className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 text-2xl"
            title="Back to library"
          >
            ‹
          </button>
          <div className="text-center min-w-0 flex-1 px-3">
            <div className="text-base font-medium truncate">{t.album || '—'}</div>
            {subtitle && (
              <div className="text-[11px] text-purple-200/70 truncate mt-0.5">{subtitle}</div>
            )}
          </div>
          <div className="w-10" />
        </div>

        {/* Vinyl + tonearm together (sized container so tonearm is positioned
            relative to the disc, not the page) */}
        <div className="flex-1 flex items-center justify-center min-h-0">
          <div
            className="relative"
            style={{ width: 'min(72vw, 320px)', aspectRatio: '1 / 1' }}
          >
            <Vinyl coverUrl={t.cover_url} spinning={p.isPlaying} />
            <Tonearm playing={p.isPlaying} />
          </div>
        </div>

        {/* Progress — recessed track + magenta fill */}
        <div className="mt-2 shrink-0">
          <input
            type="range"
            min={0}
            max={Math.max(0, p.duration)}
            step={0.5}
            value={p.position}
            onChange={(e) => p.seek(Number(e.target.value))}
            className="w-full"
            style={{
              background: `linear-gradient(to right,
                var(--accent) 0%,
                var(--accent-soft) ${(p.position / Math.max(1, p.duration)) * 100}%,
                #0a0a0b ${(p.position / Math.max(1, p.duration)) * 100}%,
                #1a1a1c 100%)`,
              WebkitAppearance: 'none',
              height: 4,
              borderRadius: 9999,
              boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.8), 0 0 8px var(--accent-glow)',
            }}
          />
          <div className="flex justify-between text-[11px] text-zinc-500 tabular-nums mt-1">
            <span>{fmt(p.position)}</span>
            <span>{fmtNeg(remaining)}</span>
          </div>
        </div>

        {/* Title + artist */}
        <div className="text-center mt-5 mb-4 shrink-0">
          <div className="text-2xl font-medium glow-text truncate">
            {t.title || t.rel_path}
          </div>
          <div className="text-sm text-zinc-400 mt-1 truncate">{t.artist || ''}</div>
        </div>

        {/* Transport — pill chassis with glowing center */}
        <div className="flex items-center justify-center gap-3 pb-8 shrink-0">
          <button
            onClick={p.cycleRepeat}
            title={`Repeat: ${p.repeat}`}
            className={`w-10 h-10 rounded-full bezel flex items-center justify-center text-base ${
              p.repeat !== 'off' ? 'glow-text glow-ring' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {p.repeat === 'one' ? '🔂' : '🔁'}
          </button>

          <div className="recess-pill flex items-center gap-1.5 px-2 py-1.5">
            <button
              onClick={p.prev}
              title="Previous"
              className="w-10 h-10 rounded-full bezel flex items-center justify-center text-zinc-300 hover:text-white"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 6h2v12H6zM9.5 12l8.5 6V6z" />
              </svg>
            </button>
            <button
              onClick={p.togglePlay}
              title={p.isPlaying ? 'Pause' : 'Play'}
              className="w-14 h-14 rounded-full bezel glow-ring flex items-center justify-center glow-text"
            >
              {p.isPlaying ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="5" width="4" height="14" />
                  <rect x="14" y="5" width="4" height="14" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            <button
              onClick={p.next}
              title="Next"
              className="w-10 h-10 rounded-full bezel flex items-center justify-center text-zinc-300 hover:text-white"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" />
              </svg>
            </button>
          </div>

          <button
            onClick={p.toggleShuffle}
            title="Shuffle"
            className={`w-10 h-10 rounded-full bezel flex items-center justify-center text-base ${
              p.shuffle ? 'glow-text glow-ring' : 'text-zinc-400 hover:text-white'
            }`}
          >
            🔀
          </button>
        </div>

        {/* Volume — magenta-fill recessed slider, subtle row below transport */}
        <div className="flex items-center gap-3 pb-6 shrink-0 px-2">
          <button
            onClick={() => p.setVolume(p.volume > 0 ? 0 : 0.7)}
            title={p.volume > 0 ? 'Mute' : 'Unmute'}
            className="text-zinc-400 hover:text-white text-base shrink-0 w-6 text-center"
          >
            {p.volume === 0 ? '🔇' : p.volume < 0.5 ? '🔉' : '🔊'}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={p.volume}
            onChange={(e) => p.setVolume(Number(e.target.value))}
            className="flex-1"
            style={{
              background: `linear-gradient(to right,
                var(--accent) 0%,
                var(--accent-soft) ${p.volume * 100}%,
                #0a0a0b ${p.volume * 100}%,
                #1a1a1c 100%)`,
              WebkitAppearance: 'none',
              height: 4,
              borderRadius: 9999,
              boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.8)',
            }}
          />
          <span className="text-xs text-zinc-500 tabular-nums w-9 text-right shrink-0">
            {Math.round(p.volume * 100)}%
          </span>
        </div>
      </div>

      {/* Bottom-right collapse */}
      <button
        onClick={onClose}
        title="Collapse"
        className="absolute bottom-3 right-3 w-9 h-9 rounded-full bezel flex items-center justify-center text-zinc-300 hover:text-white"
      >
        ⤡
      </button>

      {/* Embedded styles for vinyl spin */}
      <style>{`
        @keyframes mw-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function Wave() {
  return (
    <svg
      viewBox="0 0 600 80"
      className="w-full h-16 opacity-80"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="mw-grad-1" x1="0" x2="1">
          <stop offset="0" stopColor="#ff2db5" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ff66cc" stopOpacity="0.3" />
        </linearGradient>
        <linearGradient id="mw-grad-2" x1="0" x2="1">
          <stop offset="0" stopColor="#ff66cc" stopOpacity="0.6" />
          <stop offset="1" stopColor="#ff2db5" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      <path
        d="M0 50 Q 75 10, 150 40 T 300 40 T 450 40 T 600 30 V80 H0 Z"
        fill="url(#mw-grad-1)"
        opacity="0.18"
      />
      <path
        d="M0 50 Q 75 20, 150 50 T 300 45 T 450 55 T 600 40"
        stroke="url(#mw-grad-1)"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M0 60 Q 75 30, 150 55 T 300 50 T 450 60 T 600 50"
        stroke="url(#mw-grad-2)"
        strokeWidth="1.5"
        fill="none"
      />
    </svg>
  );
}

function Vinyl({ coverUrl, spinning }: { coverUrl: string | null; spinning: boolean }) {
  return (
    <div
      className="absolute inset-0 rounded-full shadow-2xl"
      style={{
        background: 'radial-gradient(circle at 30% 30%, #2a2a35 0%, #0d0d14 60%, #050507 100%)',
        animation: 'mw-spin 8s linear infinite',
        animationPlayState: spinning ? 'running' : 'paused',
      }}
    >
      {/* Concentric grooves */}
      <div className="absolute inset-2 rounded-full border border-white/5" />
      <div className="absolute inset-6 rounded-full border border-white/5" />
      <div className="absolute inset-12 rounded-full border border-white/5" />
      <div className="absolute inset-20 rounded-full border border-white/5" />
      {/* Center label area = the album cover */}
      <div
        className="absolute rounded-full overflow-hidden bg-zinc-800 flex items-center justify-center"
        style={{
          top: '28%',
          left: '28%',
          width: '44%',
          height: '44%',
          boxShadow: '0 0 0 6px #1a0d35, 0 0 0 7px rgba(255,255,255,0.15)',
        }}
      >
        <CenterCover src={coverUrl} />
      </div>
      {/* Center spindle hole */}
      <div
        className="absolute rounded-full bg-[#2d1466]"
        style={{
          top: 'calc(50% - 6px)',
          left: 'calc(50% - 6px)',
          width: 12,
          height: 12,
          boxShadow: 'inset 0 0 4px rgba(0,0,0,0.6)',
        }}
      />
    </div>
  );
}

function CenterCover({ src }: { src: string | null }) {
  const [errored, setErrored] = useState(false);
  const url = resolveCoverSrc(src);
  if (!url || errored) {
    return <span className="text-zinc-600 text-5xl">♪</span>;
  }
  return (
    <img
      src={url}
      alt=""
      onError={() => setErrored(true)}
      className="w-full h-full object-cover"
    />
  );
}

function Tonearm({ playing }: { playing: boolean }) {
  // The pivot lives at the upper-right OUTSIDE the disc; the arm reaches
  // toward the center. Sized as a percentage of the parent (vinyl wrapper)
  // so it scales with the disc on any screen.
  return (
    <svg
      viewBox="0 0 200 200"
      className="absolute pointer-events-none transition-transform duration-700"
      style={{
        // Tonearm svg occupies a square the same size as the vinyl, but
        // shifted up-right so the pivot sits near the disc's outer edge.
        top: '-20%',
        right: '-18%',
        width: '70%',
        height: '70%',
        transform: playing ? 'rotate(0deg)' : 'rotate(-15deg)',
        transformOrigin: '88% 12%',
      }}
    >
      <defs>
        <linearGradient id="mw-arm" x1="0" x2="1">
          <stop offset="0" stopColor="#9be3ff" />
          <stop offset="1" stopColor="#5b8cff" />
        </linearGradient>
      </defs>
      {/* Arm: pivot at upper-right (170,30), reaches toward (40,170) */}
      <line
        x1="170" y1="30" x2="60" y2="160"
        stroke="url(#mw-arm)"
        strokeWidth="6"
        strokeLinecap="round"
      />
      {/* Pivot disc */}
      <circle cx="170" cy="30" r="14" fill="#5b8cff" />
      <circle cx="170" cy="30" r="6" fill="#dff3ff" />
      {/* Cartridge at the tip */}
      <circle cx="60" cy="160" r="10" fill="#9be3ff" />
      <circle cx="60" cy="160" r="4" fill="#1a0d35" />
    </svg>
  );
}
