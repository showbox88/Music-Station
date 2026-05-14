/**
 * Skin 04 — Abyss (Apple-Music Dark Blue).
 * Spec: Player Skin/skin-04-abyss.md
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

function fmtNeg(remaining: number): string {
  if (!Number.isFinite(remaining) || remaining < 0) return '-0:00';
  return `-${fmt(remaining)}`;
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

export default function AbyssSkin(p: SkinProps) {
  const [coverErr, setCoverErr] = useState(false);
  const cover = resolveCoverSrc(p.track.cover_url);
  const showCover = !!cover && !coverErr;
  const pct = (p.position / Math.max(1, p.duration)) * 100;
  const volPct = p.volume * 100;

  return (
    <div className="skin skin-abyss fixed inset-0 z-40 overflow-hidden">
      <div className="relative h-full max-w-xl mx-auto flex flex-col px-6 pb-6">
        {/* Top bar */}
        <div className="flex items-center justify-between pt-5 shrink-0">
          <button
            onClick={p.onClose}
            className="icon-btn-muted w-10 h-10 flex items-center justify-center text-2xl"
            title="Back"
          >
            ‹
          </button>
          <div className="flex items-center gap-2">
            <SkinPicker current={p.currentSkinId} onPick={p.onPickSkin} />
          </div>
        </div>

        {/* Album art */}
        <div className="flex-1 flex items-center justify-center min-h-0 py-6">
          <div
            className="album-shadow"
            style={{
              width: 'min(70vw, 320px)',
              aspectRatio: '1 / 1',
              borderRadius: 16,
              overflow: 'hidden',
              background: 'var(--bg-card)',
            }}
          >
            {showCover ? (
              <img src={cover!} alt="" onError={() => setCoverErr(true)} className="w-full h-full object-cover" draggable={false} />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-5xl" style={{ color: 'var(--text-faint)' }}>♪</div>
            )}
          </div>
        </div>

        {/* Title row + heart + ellipsis */}
        <div className="flex items-start justify-between shrink-0 mb-4 gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate" style={{ fontWeight: 700, fontSize: 22, letterSpacing: '0.01em', color: 'var(--text)' }}>
              {p.track.title || p.track.rel_path}
            </div>
            {p.track.artist && (
              <div className="truncate mt-1" style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-muted)' }}>
                {p.track.artist}
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={p.onToggleFavorite}
              className={p.isFavorite ? 'icon-btn-active' : 'icon-btn-muted'}
              title={p.isFavorite ? 'Unfavorite' : 'Favorite'}
              style={{ width: 28, height: 28 }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill={p.isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                p.onOpenAddToPlaylist({ x: r.left, y: r.top - 8 });
              }}
              className="icon-btn-muted"
              title="More"
              style={{ width: 28, height: 28 }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
            </button>
          </div>
        </div>

        {/* Progress + times (right-aligned countdown is the abyss signature) */}
        <div className="shrink-0 mb-4">
          <input
            type="range"
            min={0}
            max={Math.max(0, p.duration)}
            step={0.5}
            value={p.position}
            onChange={(e) => p.onSeek(Number(e.target.value))}
            className="skin-range h-4"
            style={{
              background: `linear-gradient(to right,
                #FFFFFF 0%,
                #FFFFFF ${pct}%,
                rgba(255,255,255,0.12) ${pct}%,
                rgba(255,255,255,0.12) 100%)`,
            }}
          />
          <div className="flex justify-between mt-1 tabular-nums" style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            <span>{fmt(p.position)}</span>
            <span>{fmtNeg(p.remaining)}</span>
          </div>
        </div>

        {/* Transport row */}
        <div className="shrink-0 flex items-center justify-center gap-10">
          <button onClick={p.onPrev} className="icon-btn" title="Previous">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zM9.5 12l8.5 6V6z" />
            </svg>
          </button>
          <button
            onClick={p.onTogglePlay}
            className="play-main rounded-full flex items-center justify-center"
            style={{ width: 56, height: 56 }}
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
          <button onClick={p.onNext} className="icon-btn" title="Next">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" />
            </svg>
          </button>
        </div>

        {/* Shuffle / repeat row — minor row with dot indicator on active */}
        <div className="shrink-0 flex items-center justify-center gap-12 mt-5">
          <button
            onClick={p.onToggleShuffle}
            className={p.shuffle ? 'icon-btn' : 'icon-btn-muted'}
            title="Shuffle"
            style={{ position: 'relative' }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 3 21 3 21 8" />
              <line x1="4" y1="20" x2="21" y2="3" />
              <polyline points="21 16 21 21 16 21" />
              <line x1="15" y1="15" x2="21" y2="21" />
              <line x1="4" y1="4" x2="9" y2="9" />
            </svg>
            {p.shuffle && (
              <span style={{ position: 'absolute', left: '50%', bottom: -6, transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: 9999, background: '#FFFFFF' }} />
            )}
          </button>
          <button
            onClick={p.onCycleRepeat}
            className={p.repeat !== 'off' ? 'icon-btn' : 'icon-btn-muted'}
            title={`Repeat: ${p.repeat}`}
            style={{ position: 'relative' }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="17 1 21 5 17 9" />
              <path d="M3 11V9a4 4 0 0 1 4-4h14" />
              <polyline points="7 23 3 19 7 15" />
              <path d="M21 13v2a4 4 0 0 1-4 4H3" />
            </svg>
            {p.repeat !== 'off' && (
              <span style={{ position: 'absolute', left: '50%', bottom: -6, transform: 'translateX(-50%)', width: 4, height: 4, borderRadius: 9999, background: '#FFFFFF' }} />
            )}
          </button>
        </div>

        {/* Volume slider */}
        <div className="shrink-0 mt-6 flex items-center gap-3">
          <button
            onClick={() => p.onSetVolume(p.volume > 0 ? 0 : 0.7)}
            className="icon-btn-muted"
            style={{ width: 18 }}
            title={p.volume > 0 ? 'Mute' : 'Unmute'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
            </svg>
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={p.volume}
            onChange={(e) => p.onSetVolume(Number(e.target.value))}
            className="skin-range h-2 flex-1"
            style={{
              background: `linear-gradient(to right,
                #FFFFFF 0%,
                #FFFFFF ${volPct}%,
                rgba(255,255,255,0.12) ${volPct}%,
                rgba(255,255,255,0.12) 100%)`,
            }}
          />
          <button
            onClick={() => p.onSetVolume(1)}
            className="icon-btn-muted"
            style={{ width: 22 }}
            title="Max volume"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="currentColor" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          </button>
        </div>

        {/* Lyrics tab */}
        <div className="shrink-0 mt-5 flex items-center justify-center gap-8">
          <button
            onClick={() => {
              if (p.lyricsStatus === 'present') p.onOpenFullLyrics();
              else if (!p.fetchingLyrics) p.onFetchLyrics();
            }}
            className={p.lyricsStatus === 'present' ? 'underline-active icon-btn' : 'icon-btn-muted'}
            style={{ fontSize: 13, fontWeight: 600, opacity: p.fetchingLyrics ? 0.5 : 1 }}
          >
            Lyrics
          </button>
          <button
            onClick={p.onToggleRemote}
            title={p.isRemote ? '退出遥控器' : '开启遥控器'}
            className={p.isRemote ? 'icon-btn-active' : 'icon-btn-muted'}
            style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.1em' }}
          >
            REMOTE
          </button>
          <button
            onClick={p.onCycleSpatial}
            className={p.spatialPreset !== 'off' ? 'icon-btn-active' : 'icon-btn-muted'}
            style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.1em' }}
          >
            {p.spatialPreset === 'off' ? 'DOLBY' : p.spatialPreset.toUpperCase()}
          </button>
          <button
            onClick={p.onOpenEq}
            className={p.eqActive ? 'icon-btn-active' : 'icon-btn-muted'}
            style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.1em' }}
          >
            EQ
          </button>
        </div>
      </div>
    </div>
  );
}
