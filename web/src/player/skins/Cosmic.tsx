/**
 * Skin 02 — Cosmic Neon.
 * Spec: Player Skin/skin-02-cosmic.md
 */
import { useState } from 'react';
import type { SkinProps } from './types';
import SkinPicker from './SkinPicker';
import CosmicWave from './CosmicWave';

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function resolveCoverSrc(src: string | null): string | null {
  if (!src) return null;
  if (/^https?:/i.test(src) || src.startsWith('data:') || src.startsWith('blob:')) return src;
  if (src.startsWith('/')) {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
    return `${base}${src}`;
  }
  return src;
}

export default function CosmicSkin(p: SkinProps) {
  const [coverErr, setCoverErr] = useState(false);
  const cover = resolveCoverSrc(p.track.cover_url);
  const showCover = !!cover && !coverErr;
  const ratio = p.duration > 0 ? Math.min(1, Math.max(0, p.position / p.duration)) : 0;
  // conic-gradient progress: paint from -90deg (top) clockwise.
  const startDeg = -90;
  const endDeg = startDeg + ratio * 360;

  // Position of the orange progress dot on the ring.
  const RING_DIAMETER = 220; // px on desktop
  const r = RING_DIAMETER / 2 - 3; // radius of dot center, accounting for ring stroke
  const angle = startDeg + ratio * 360; // degrees
  const rad = (angle * Math.PI) / 180;
  const dotX = Math.cos(rad) * r;
  const dotY = Math.sin(rad) * r;

  return (
    <div className="skin skin-cosmic fixed inset-0 z-40 overflow-hidden flex">
      {/* Inline SVG defs for gradient-stroked icons (heart/share/download) */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <linearGradient id="cosmicGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7C3AED" />
            <stop offset="50%" stopColor="#E040C8" />
            <stop offset="100%" stopColor="#FF6FB5" />
          </linearGradient>
        </defs>
      </svg>

      {/* Centered single-column layout, max-w to keep it phone-like on desktop */}
      <div className="relative h-full w-full max-w-xl mx-auto flex flex-col px-6 pb-6">
        {/* Top bar */}
        <div className="flex items-center justify-between pt-5 shrink-0">
          <button
            onClick={p.onClose}
            className="w-10 h-10 flex items-center justify-center rounded-full text-2xl"
            style={{ color: 'var(--text-muted)' }}
            title="Back"
          >
            ‹
          </button>
          <div className="text-[11px] uppercase tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>
            NOW PLAYING
          </div>
          <SkinPicker current={p.currentSkinId} onPick={p.onPickSkin} />
        </div>

        {/* Hero — circular cover with conic progress ring */}
        <div className="flex flex-col items-center justify-center mt-6 shrink-0">
          <div className="relative" style={{ width: RING_DIAMETER, height: RING_DIAMETER }}>
            {/* Progress ring (conic) */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: `conic-gradient(from ${startDeg}deg,
                  #7C3AED 0deg,
                  #E040C8 ${(endDeg - startDeg) * 0.5}deg,
                  #FF6FB5 ${endDeg - startDeg}deg,
                  rgba(255,255,255,0.05) ${endDeg - startDeg}deg,
                  rgba(255,255,255,0.05) 360deg)`,
                padding: 6,
                filter: 'drop-shadow(0 0 12px rgba(124,58,237,0.35))',
              }}
            >
              <div
                className="w-full h-full rounded-full overflow-hidden flex items-center justify-center"
                style={{
                  background: 'var(--bg-base)',
                  boxShadow: 'inset 0 0 0 4px var(--bg-base)',
                }}
              >
                {showCover ? (
                  <img src={cover!} alt="" onError={() => setCoverErr(true)} className="w-full h-full object-cover rounded-full" draggable={false} />
                ) : (
                  <div className="text-5xl" style={{ color: 'var(--text-faint)' }}>♪</div>
                )}
              </div>
            </div>
            {/* Orange progress dot */}
            <span
              className="ring-progress-dot absolute"
              style={{
                width: 10,
                height: 10,
                borderRadius: 9999,
                left: `calc(50% + ${dotX}px - 5px)`,
                top: `calc(50% + ${dotY}px - 5px)`,
              }}
            />
            {/* Time labels — left/right of ring */}
            <span
              className="absolute tabular-nums"
              style={{
                left: -42,
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: 11,
                color: 'var(--text-faint)',
                letterSpacing: '0.05em',
              }}
            >
              {fmt(p.position)}
            </span>
            <span
              className="absolute tabular-nums"
              style={{
                right: -42,
                top: '50%',
                transform: 'translateY(-50%)',
                fontSize: 11,
                color: 'var(--text-faint)',
                letterSpacing: '0.05em',
              }}
            >
              {fmt(p.duration)}
            </span>
          </div>
        </div>

        {/* Mini icon row — heart / download / share, gradient strokes */}
        <div className="flex items-center justify-center gap-7 mt-6 shrink-0">
          <button onClick={p.onToggleFavorite} title="Favorite">
            <svg width="22" height="22" viewBox="0 0 24 24" fill={p.isFavorite ? 'url(#cosmicGrad)' : 'none'} stroke="url(#cosmicGrad)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
          <button
            onClick={() => {
              if (p.lyricsStatus === 'present') p.onOpenFullLyrics();
              else if (!p.fetchingLyrics) p.onFetchLyrics();
            }}
            title="Lyrics"
            style={{ opacity: p.fetchingLyrics ? 0.5 : 1 }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="url(#cosmicGrad)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
          <button
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              p.onOpenAddToPlaylist({ x: r.left, y: r.top - 8 });
            }}
            title="Add to playlist"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="url(#cosmicGrad)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>

        {/* Waveform */}
        <div className="shrink-0 mt-2">
          <CosmicWave getAnalyser={p.getAnalyser} isPlaying={p.isPlaying} height={92} />
        </div>

        {/* Title + artist */}
        <div className="text-center mt-3 shrink-0">
          <div
            className="truncate"
            style={{ fontWeight: 600, fontSize: 26, letterSpacing: '0.04em', color: 'var(--text)' }}
          >
            {p.track.title || p.track.rel_path}
          </div>
          {p.track.artist && (
            <div className="mt-1 truncate" style={{ fontSize: 13, color: 'var(--text-muted)', letterSpacing: '0.02em' }}>
              {p.track.artist}
            </div>
          )}
        </div>

        {/* Transport row */}
        <div className="flex items-center justify-center gap-7 mt-auto pb-2 shrink-0">
          <button
            onClick={p.onToggleShuffle}
            className={p.shuffle ? 'icon-btn-active' : 'icon-btn'}
            title="Shuffle"
            style={{ width: 22, height: 22 }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 3 21 3 21 8" />
              <line x1="4" y1="20" x2="21" y2="3" />
              <polyline points="21 16 21 21 16 21" />
              <line x1="15" y1="15" x2="21" y2="21" />
              <line x1="4" y1="4" x2="9" y2="9" />
            </svg>
          </button>

          <button onClick={p.onPrev} className="icon-btn" title="Previous">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zM9.5 12l8.5 6V6z" />
            </svg>
          </button>

          <button
            onClick={p.onTogglePlay}
            className="play-main rounded-full flex items-center justify-center"
            style={{ width: 64, height: 64, color: '#FFFFFF' }}
            title={p.isPlaying ? 'Pause' : 'Play'}
          >
            {p.isPlaying ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" />
                <rect x="14" y="5" width="4" height="14" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 2 }}>
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <button onClick={p.onNext} className="icon-btn" title="Next">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" />
            </svg>
          </button>

          <button
            onClick={p.onCycleRepeat}
            className={p.repeat !== 'off' ? 'icon-btn-active' : 'icon-btn'}
            title={`Repeat: ${p.repeat}`}
            style={{ width: 22, height: 22 }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          </button>
        </div>

        {/* Auxiliary row — Spatial / EQ as small text labels */}
        <div className="flex items-center justify-center gap-6 pt-2 shrink-0">
          <button
            onClick={p.onToggleRemote}
            title={p.isRemote ? '退出遥控器' : '开启遥控器'}
            className={p.isRemote ? 'icon-btn-active' : 'icon-btn'}
            style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.15em' }}
          >
            REMOTE
          </button>
          <button
            onClick={p.onCycleSpatial}
            className={p.spatialPreset !== 'off' ? 'icon-btn-active' : 'icon-btn'}
            style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.15em' }}
          >
            {p.spatialPreset === 'off' ? 'DOLBY' : p.spatialPreset.toUpperCase()}
          </button>
          <button
            onClick={p.onOpenEq}
            className={p.eqActive ? 'icon-btn-active' : 'icon-btn'}
            style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.15em' }}
          >
            EQ
          </button>
        </div>
      </div>
    </div>
  );
}
