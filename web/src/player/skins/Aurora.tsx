/**
 * Skin 03 — Aurora Glass.
 * Spec: Player Skin/skin-03-aurora.md
 */
import { useEffect, useState } from 'react';
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

export default function AuroraSkin(p: SkinProps) {
  const [coverErr, setCoverErr] = useState(false);
  const cover = resolveCoverSrc(p.track.cover_url);
  const showCover = !!cover && !coverErr;
  const pct = (p.position / Math.max(1, p.duration)) * 100;

  // Two-layer cross-fade for the blurred background. Whenever the cover
  // changes, we fade the new layer in; the previous one fades out.
  const [bgA, setBgA] = useState<string | null>(cover);
  const [bgB, setBgB] = useState<string | null>(null);
  const [showA, setShowA] = useState(true);
  useEffect(() => {
    setCoverErr(false);
    if (showA) {
      setBgB(cover);
      requestAnimationFrame(() => setShowA(false));
    } else {
      setBgA(cover);
      requestAnimationFrame(() => setShowA(true));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cover]);

  return (
    <div className="skin skin-aurora fixed inset-0 z-40 overflow-hidden">
      {/* Blurred cover background — two layers cross-fade on track change. */}
      <div className="absolute inset-0 -z-10">
        {bgA && (
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage: `url("${bgA}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(60px) saturate(1.4) brightness(0.55)',
              transform: 'scale(1.2)',
              opacity: showA ? 1 : 0,
              transition: 'opacity 600ms ease',
            }}
          />
        )}
        {bgB && (
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage: `url("${bgB}")`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(60px) saturate(1.4) brightness(0.55)',
              transform: 'scale(1.2)',
              opacity: !showA ? 1 : 0,
              transition: 'opacity 600ms ease',
            }}
          />
        )}
        {/* Top violet halo */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(155,107,255,0.35) 0%, transparent 60%)',
          }}
        />
        {/* Bottom darken */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(180deg, rgba(15,10,31,0.20) 0%, rgba(15,10,31,0.85) 100%)',
          }}
        />
      </div>

      <div className="relative h-full max-w-xl mx-auto flex flex-col px-6 pb-6">
        {/* Top bar */}
        <div className="flex items-center justify-between pt-5 shrink-0">
          <button
            onClick={p.onToggleFavorite}
            className="glass-btn rounded-full flex items-center justify-center"
            style={{ width: 36, height: 36, color: p.isFavorite ? 'var(--accent-soft)' : 'currentColor', filter: p.isFavorite ? 'drop-shadow(0 0 6px var(--accent-glow))' : undefined }}
            title={p.isFavorite ? 'Unfavorite' : 'Favorite'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill={p.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>

          <div className="text-center min-w-0 flex-1 px-3">
            <div className="text-[11px] uppercase tracking-[0.2em]" style={{ color: 'var(--text-muted)' }}>NOW PLAYING</div>
          </div>

          <SkinPicker current={p.currentSkinId} onPick={p.onPickSkin} />
        </div>

        {/* Hero — circular cover with halo */}
        <div className="flex-1 flex items-center justify-center min-h-0 -mt-2">
          <button
            onClick={p.onClose}
            title="Back"
            className="relative md:cursor-default"
            style={{
              width: 'min(58vw, 220px)',
              aspectRatio: '1 / 1',
              borderRadius: '50%',
              overflow: 'hidden',
              border: '2px solid rgba(255,255,255,0.18)',
              boxShadow: '0 0 60px 8px rgba(155,107,255,0.35), 0 20px 40px rgba(0,0,0,0.5)',
              background: 'rgba(0,0,0,0.4)',
            }}
          >
            {showCover ? (
              <img src={cover!} alt="" onError={() => setCoverErr(true)} className="w-full h-full object-cover" draggable={false} />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-5xl" style={{ color: 'var(--text-faint)' }}>♪</div>
            )}
          </button>
        </div>

        {/* Title + artist */}
        <div className="text-center shrink-0 mt-3">
          <div
            className="truncate"
            style={{ fontWeight: 700, fontSize: 26, color: 'var(--text)', textShadow: '0 2px 12px rgba(0,0,0,0.6)' }}
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
        <div className="shrink-0 mt-4 mb-2">
          <input
            type="range"
            min={0}
            max={Math.max(0, p.duration)}
            step={0.5}
            value={p.position}
            onChange={(e) => p.onSeek(Number(e.target.value))}
            className="skin-range h-2"
            style={{
              background: `linear-gradient(to right,
                var(--accent-soft) 0%,
                var(--accent-soft) ${pct}%,
                rgba(255,255,255,0.10) ${pct}%,
                rgba(255,255,255,0.10) 100%)`,
            }}
          />
          <div className="flex justify-between mt-1 tabular-nums" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            <span>{fmt(p.position)}</span>
            <span>{fmt(p.duration)}</span>
          </div>
        </div>

        {/* Transport */}
        <div className="shrink-0 flex items-center justify-center gap-4 mt-2 mb-2">
          <button
            onClick={p.onToggleShuffle}
            className={`glass-btn rounded-full flex items-center justify-center ${p.shuffle ? 'glass-btn-active' : ''}`}
            style={{ width: 36, height: 36 }}
            title="Shuffle"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 3 21 3 21 8" />
              <line x1="4" y1="20" x2="21" y2="3" />
              <polyline points="21 16 21 21 16 21" />
              <line x1="15" y1="15" x2="21" y2="21" />
              <line x1="4" y1="4" x2="9" y2="9" />
            </svg>
          </button>
          <button onClick={p.onPrev} className="glass-btn rounded-full flex items-center justify-center" style={{ width: 40, height: 40 }} title="Previous">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zM9.5 12l8.5 6V6z" /></svg>
          </button>
          <button
            onClick={p.onTogglePlay}
            className="play-main rounded-full flex items-center justify-center"
            style={{ width: 56, height: 56, color: '#FFFFFF' }}
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
          <button onClick={p.onNext} className="glass-btn rounded-full flex items-center justify-center" style={{ width: 40, height: 40 }} title="Next">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" /></svg>
          </button>
          <button
            onClick={p.onCycleRepeat}
            className={`glass-btn rounded-full flex items-center justify-center ${p.repeat !== 'off' ? 'glass-btn-active' : ''}`}
            style={{ width: 36, height: 36 }}
            title={`Repeat: ${p.repeat}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
          </button>
        </div>

        {/* Bottom glass bar — Lyrics + EQ + Spatial + Add */}
        <div className="glass-bar shrink-0 -mx-6 mt-2 px-6 py-3 flex items-center justify-around">
          <button
            onClick={() => {
              if (p.lyricsStatus === 'present') p.onOpenFullLyrics();
              else if (!p.fetchingLyrics) p.onFetchLyrics();
            }}
            className={p.lyricsStatus === 'present' ? 'underline-active' : ''}
            style={{ fontSize: 12, fontWeight: 600, color: p.lyricsStatus === 'present' ? 'var(--accent-soft)' : 'var(--text-muted)', opacity: p.fetchingLyrics ? 0.5 : 1 }}
          >
            Lyrics
          </button>
          <button
            onClick={p.onToggleRemote}
            title={p.isRemote ? '退出遥控器' : '开启遥控器'}
            style={{ fontSize: 12, fontWeight: 600, color: p.isRemote ? 'var(--accent-soft)' : 'var(--text-muted)', letterSpacing: '0.1em' }}
          >
            REMOTE
          </button>
          <button
            onClick={p.onCycleSpatial}
            style={{ fontSize: 12, fontWeight: 600, color: p.spatialPreset !== 'off' ? 'var(--accent-soft)' : 'var(--text-muted)', letterSpacing: '0.1em' }}
          >
            {p.spatialPreset === 'off' ? 'DOLBY' : p.spatialPreset.toUpperCase()}
          </button>
          <button
            onClick={p.onOpenEq}
            style={{ fontSize: 12, fontWeight: 600, color: p.eqActive ? 'var(--accent-soft)' : 'var(--text-muted)', letterSpacing: '0.1em' }}
          >
            EQ
          </button>
          <button
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              p.onOpenAddToPlaylist({ x: r.left, y: r.top - 8 });
            }}
            style={{ color: 'var(--text-muted)' }}
            title="Add to playlist"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
