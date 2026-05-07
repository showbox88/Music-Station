/**
 * Skin 01 — Cream / Coral Daylight.
 * Spec: Player Skin/skin-01-cream.md
 */
import { useState } from 'react';
import type { SkinProps } from './types';
import SkinPicker from './SkinPicker';

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

export default function CreamSkin(p: SkinProps) {
  const [coverErr, setCoverErr] = useState(false);
  const cover = resolveCoverSrc(p.track.cover_url);
  const showCover = !!cover && !coverErr;
  const pct = (p.position / Math.max(1, p.duration)) * 100;

  return (
    <div className="skin skin-cream fixed inset-0 z-40 overflow-hidden">
      <div className="relative h-full max-w-xl mx-auto flex flex-col px-6 pb-6">
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
          <div
            className="text-[11px] font-semibold uppercase tracking-[0.18em]"
            style={{ color: 'var(--text-muted)' }}
          >
            NOW PLAYING ▾
          </div>
          <SkinPicker current={p.currentSkinId} onPick={p.onPickSkin} />
        </div>

        {/* Album art — large rounded square */}
        <div className="flex-1 flex items-center justify-center min-h-0 py-4">
          <div
            className="relative"
            style={{
              width: 'min(78vw, 320px)',
              aspectRatio: '1 / 1',
              borderRadius: 22,
              overflow: 'hidden',
              boxShadow: '0 2px 8px rgba(31, 26, 23, 0.06), 0 24px 48px -12px rgba(31, 26, 23, 0.18)',
              background: '#EAE3D9',
            }}
          >
            {showCover ? (
              <img
                src={cover!}
                alt=""
                onError={() => setCoverErr(true)}
                className="w-full h-full object-cover"
                draggable={false}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-5xl" style={{ color: 'var(--text-faint)' }}>♪</div>
            )}
          </div>
        </div>

        {/* Title + artist */}
        <div className="text-center shrink-0 mb-3">
          {p.track.album && (
            <div className="text-[12px] font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
              {p.track.album}
            </div>
          )}
          <div
            className="font-bold truncate"
            style={{
              fontSize: 22,
              letterSpacing: '-0.01em',
              color: 'var(--text)',
            }}
          >
            {p.track.title || p.track.rel_path}
          </div>
          {p.track.artist && (
            <div className="mt-1 truncate" style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-muted)' }}>
              {p.track.artist}
            </div>
          )}
        </div>

        {/* Progress */}
        <div className="shrink-0 mb-3">
          <input
            type="range"
            min={0}
            max={Math.max(0, p.duration)}
            step={0.5}
            value={p.position}
            onChange={(e) => p.onSeek(Number(e.target.value))}
            className="skin-range h-3"
            style={{
              background: `linear-gradient(to right,
                var(--accent-soft) 0%,
                var(--accent) ${pct}%,
                var(--bg-recessed) ${pct}%,
                var(--bg-recessed) 100%)`,
            }}
          />
          <div
            className="flex justify-between mt-1 tabular-nums"
            style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-faint)' }}
          >
            <span>{fmt(p.position)}</span>
            <span>{fmt(p.duration)}</span>
          </div>
        </div>

        {/* Transport */}
        <div className="shrink-0 flex items-center justify-center gap-10 my-2">
          <button
            onClick={p.onPrev}
            className="icon-btn"
            title="Previous"
            style={{ width: 32, height: 32 }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="19 20 9 12 19 4 19 20" fill="currentColor" />
              <line x1="5" y1="19" x2="5" y2="5" />
            </svg>
          </button>

          <button
            onClick={p.onTogglePlay}
            className="play-main rounded-full flex items-center justify-center"
            style={{ width: 64, height: 64, color: '#FFFFFF' }}
            title={p.isPlaying ? 'Pause' : 'Play'}
          >
            {p.isPlaying ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" />
                <rect x="14" y="5" width="4" height="14" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 2 }}>
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          <button
            onClick={p.onNext}
            className="icon-btn"
            title="Next"
            style={{ width: 32, height: 32 }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 4 15 12 5 20 5 4" fill="currentColor" />
              <line x1="19" y1="5" x2="19" y2="19" />
            </svg>
          </button>
        </div>

        {/* Bottom row — favorite / lyrics / share */}
        <div className="shrink-0 flex items-center justify-center gap-12 mt-4">
          <button
            onClick={p.onToggleFavorite}
            title={p.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            style={{ color: p.isFavorite ? 'var(--heart-active)' : 'var(--text-muted)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill={p.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
          <button
            onClick={() => {
              if (p.lyricsStatus === 'present') p.onOpenFullLyrics();
              else if (!p.fetchingLyrics) p.onFetchLyrics();
            }}
            title="Lyrics"
            style={{ color: p.lyricsStatus === 'present' ? 'var(--accent)' : 'var(--text-muted)', opacity: p.fetchingLyrics ? 0.5 : 1 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0" />
              <line x1="12" y1="18" x2="12" y2="22" />
              <line x1="8" y1="22" x2="16" y2="22" />
            </svg>
          </button>
          <button
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              p.onOpenAddToPlaylist({ x: r.left, y: r.top - 8 });
            }}
            title="Add to playlist"
            style={{ color: 'var(--text-muted)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            onClick={p.onCycleSpatial}
            title={`Spatial: ${p.spatialPreset}`}
            style={{
              color: p.spatialPreset !== 'off' ? 'var(--accent)' : 'var(--text-muted)',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.1em',
            }}
          >
            {p.spatialPreset === 'off' ? 'DOLBY' : p.spatialPreset.toUpperCase()}
          </button>
          <button
            onClick={p.onOpenEq}
            title="Equalizer"
            style={{
              color: p.eqActive ? 'var(--accent)' : 'var(--text-muted)',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.1em',
            }}
          >
            EQ
          </button>
        </div>
      </div>
    </div>
  );
}
