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
    <div className="fixed inset-0 z-40 text-white overflow-hidden bg-gradient-to-b from-[#1a0d35] via-[#2d1466] to-[#421b80] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 pt-5 pb-2 shrink-0">
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
        {/* Spacer to balance the back arrow */}
        <div className="w-10" />
      </div>

      {/* Decorative top wave */}
      <div className="px-2 -mt-1 mb-2 shrink-0">
        <Wave />
      </div>

      {/* Vinyl */}
      <div className="flex-1 flex items-center justify-center min-h-0 relative">
        <Vinyl coverUrl={t.cover_url} spinning={p.isPlaying} />
        <Tonearm playing={p.isPlaying} />
      </div>

      {/* Progress */}
      <div className="px-8 mt-2 shrink-0">
        <input
          type="range"
          min={0}
          max={Math.max(0, p.duration)}
          step={0.5}
          value={p.position}
          onChange={(e) => p.seek(Number(e.target.value))}
          className="w-full accent-pink-300"
          style={{
            background: `linear-gradient(to right,
              #f9a8d4 0%,
              #f9a8d4 ${(p.position / Math.max(1, p.duration)) * 100}%,
              rgba(255,255,255,0.2) ${(p.position / Math.max(1, p.duration)) * 100}%,
              rgba(255,255,255,0.2) 100%)`,
            WebkitAppearance: 'none',
            height: 3,
            borderRadius: 9999,
          }}
        />
        <div className="flex justify-between text-[11px] text-purple-200/80 tabular-nums mt-1">
          <span>{fmt(p.position)}</span>
          <span>{fmtNeg(remaining)}</span>
        </div>
      </div>

      {/* Title + artist */}
      <div className="text-center mt-5 mb-4 px-6 shrink-0">
        <div className="text-2xl font-medium text-[#7fb3ff]">{t.title || t.rel_path}</div>
        <div className="text-base text-[#7fb3ff]/80 mt-1">{t.artist || ''}</div>
      </div>

      {/* Transport */}
      <div className="flex items-center justify-around px-8 pb-8 shrink-0">
        <button
          onClick={p.cycleRepeat}
          title={`Repeat: ${p.repeat}`}
          className={`w-10 h-10 flex items-center justify-center rounded-full text-xl ${
            p.repeat !== 'off' ? 'text-pink-300' : 'text-white/70 hover:text-white'
          }`}
        >
          {p.repeat === 'one' ? '🔂' : '🔁'}
        </button>
        <button
          onClick={p.prev}
          title="Previous"
          className="w-12 h-12 flex items-center justify-center rounded-full border border-white/40 hover:bg-white/10"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h2v12H6zM9.5 12l8.5 6V6z" />
          </svg>
        </button>
        <button
          onClick={p.togglePlay}
          title={p.isPlaying ? 'Pause' : 'Play'}
          className="w-16 h-16 flex items-center justify-center rounded-full border-2 border-white hover:bg-white/10"
        >
          {p.isPlaying ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" />
              <rect x="14" y="5" width="4" height="14" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <button
          onClick={p.next}
          title="Next"
          className="w-12 h-12 flex items-center justify-center rounded-full border border-white/40 hover:bg-white/10"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" />
          </svg>
        </button>
        <button
          onClick={p.toggleShuffle}
          title="Shuffle / queue"
          className={`w-10 h-10 flex items-center justify-center rounded-full text-xl ${
            p.shuffle ? 'text-pink-300' : 'text-white/70 hover:text-white'
          }`}
        >
          🔀
        </button>
      </div>

      {/* Bottom-right collapse */}
      <button
        onClick={onClose}
        title="Collapse"
        className="absolute bottom-3 right-3 w-9 h-9 rounded bg-white/10 hover:bg-white/20 flex items-center justify-center text-base"
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
      className="w-full h-16 opacity-70"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="mw-grad-1" x1="0" x2="1">
          <stop offset="0" stopColor="#ff64b1" stopOpacity="0.9" />
          <stop offset="1" stopColor="#7d4cff" stopOpacity="0.4" />
        </linearGradient>
        <linearGradient id="mw-grad-2" x1="0" x2="1">
          <stop offset="0" stopColor="#56a8ff" stopOpacity="0.6" />
          <stop offset="1" stopColor="#ff64b1" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <path
        d="M0 50 Q 75 10, 150 40 T 300 40 T 450 40 T 600 30 V80 H0 Z"
        fill="url(#mw-grad-1)"
        opacity="0.35"
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
    <div className="relative" style={{ width: 'min(75vw, 380px)', aspectRatio: '1 / 1' }}>
      {/* Outer disc */}
      <div
        className="absolute inset-0 rounded-full shadow-2xl"
        style={{
          background:
            'radial-gradient(circle at 30% 30%, #2a2a35 0%, #0d0d14 60%, #050507 100%)',
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
  // A subtle decorative SVG tonearm in the bottom-right of the vinyl area.
  // Slight tilt difference depending on playback state.
  return (
    <svg
      viewBox="0 0 200 200"
      className="absolute pointer-events-none transition-transform duration-700"
      style={{
        right: '6%',
        top: '38%',
        width: 'min(45vw, 220px)',
        transform: playing ? 'rotate(-12deg)' : 'rotate(-22deg)',
        transformOrigin: '85% 15%',
      }}
    >
      <defs>
        <linearGradient id="mw-arm" x1="0" x2="1">
          <stop offset="0" stopColor="#9be3ff" />
          <stop offset="1" stopColor="#5b8cff" />
        </linearGradient>
      </defs>
      {/* Pivot disc */}
      <circle cx="170" cy="30" r="14" fill="#5b8cff" />
      <circle cx="170" cy="30" r="6" fill="#dff3ff" />
      {/* Arm */}
      <rect
        x="40"
        y="26"
        width="130"
        height="8"
        rx="4"
        fill="url(#mw-arm)"
      />
      {/* Cartridge */}
      <rect x="34" y="20" width="22" height="20" rx="3" fill="#9be3ff" />
      <rect x="36" y="38" width="18" height="6" rx="1.5" fill="#dff3ff" />
    </svg>
  );
}
