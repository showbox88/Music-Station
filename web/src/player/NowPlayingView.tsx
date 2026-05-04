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
import AudioVisualizer from './AudioVisualizer';
import EQPanel from './EQPanel';
import LyricsPanel, { parseLrc, type ParsedLyrics } from './LyricsPanel';
import { RepeatIcon, RepeatOneIcon, ShuffleIcon, VolumeIcon } from '../components/Icons';
import { api } from '../api';
import AddToPlaylistMenu from '../components/AddToPlaylistMenu';

type LyricsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'absent' }
  | { status: 'error'; message: string }
  | { status: 'present'; parsed: ParsedLyrics; source: string | null };

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
  /** Called after a server-side library change (e.g. favorite toggle)
   *  so the parent can refresh open lists. */
  onLibraryChange?: () => void;
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

export default function NowPlayingView({ open, onClose, onLibraryChange }: Props) {
  const p = usePlayer();
  const [eqOpen, setEqOpen] = useState(false);
  const [lyricsFull, setLyricsFull] = useState(false);
  const [vizMode, setVizMode] = useState<'wave' | 'lyrics'>('wave');
  // When true, the lyrics box grows upward to swallow the vinyl area so
  // many more lines fit on screen. Reset on track change or wave switch.
  const [lyricsExpanded, setLyricsExpanded] = useState(false);
  const [lyrics, setLyrics] = useState<LyricsState>({ status: 'idle' });
  const [fetchingLyrics, setFetchingLyrics] = useState(false);
  // Visualizer / lyrics area is taller on desktop than on mobile so that
  // the vinyl above stays prominent on small phones (where 200px would
  // squash the disc). Tracks the matchMedia state with a listener so it
  // adapts on viewport resize / orientation change.
  const [vizHeight, setVizHeight] = useState<number>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
      ? 120
      : 200,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const handler = (e: MediaQueryListEvent) => setVizHeight(e.matches ? 120 : 200);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  // Optimistic favorite state: the queue's track object is shared and
  // doesn't update on its own; we mirror it locally for instant feedback
  // and reset whenever the playing track changes.
  const [favOpt, setFavOpt] = useState<boolean | null>(null);
  const [addingTo, setAddingTo] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    setFavOpt(null);
  }, [p.current?.id]);

  // Load cached lyrics whenever the playing track changes. Local-only —
  // never auto-fetches; the user must press the download button.
  useEffect(() => {
    const id = p.current?.id;
    if (!id) {
      setLyrics({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setLyrics({ status: 'loading' });
    api
      .getLyrics(id)
      .then((r) => {
        if (cancelled) return;
        if (r.found && r.synced) {
          setLyrics({
            status: 'present',
            parsed: parseLrc(r.synced),
            source: r.source ?? null,
          });
        } else {
          setLyrics({ status: 'absent' });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLyrics({ status: 'error', message: String(err?.message ?? err) });
      });
    return () => {
      cancelled = true;
    };
  }, [p.current?.id]);

  // If the new track has no lyrics, fall back to wave mode so the
  // visualizer area isn't stuck on an empty placeholder.
  useEffect(() => {
    if (lyrics.status !== 'present' && vizMode === 'lyrics') {
      setVizMode('wave');
    }
  }, [lyrics.status, vizMode]);

  // Collapse the expanded lyrics view whenever we leave lyrics mode or
  // change tracks, so a fresh play doesn't start with the vinyl hidden.
  useEffect(() => {
    if (vizMode !== 'lyrics') setLyricsExpanded(false);
  }, [vizMode]);
  useEffect(() => {
    setLyricsExpanded(false);
  }, [p.current?.id]);

  async function handleFetchLyrics() {
    const id = p.current?.id;
    if (!id || fetchingLyrics) return;
    setFetchingLyrics(true);
    try {
      const r = await api.fetchLyrics(id);
      if (r.ok && r.synced) {
        setLyrics({
          status: 'present',
          parsed: parseLrc(r.synced),
          source: r.source ?? null,
        });
      } else {
        setLyrics({ status: 'absent' });
        alert('两个歌词源都没找到这首歌的歌词');
      }
    } catch (err: any) {
      alert(`下载歌词失败：${err?.message ?? err}`);
    } finally {
      setFetchingLyrics(false);
    }
  }

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
          {/* Back button — desktop only. On mobile, tap the vinyl to
              close (less chrome at the top). */}
          <button
            onClick={onClose}
            className="hidden md:flex w-10 h-10 items-center justify-center rounded-full hover:bg-white/10 text-2xl"
            title="Back to library"
          >
            ‹
          </button>
          {/* Spacer that keeps the title centered when the back button
              is hidden. */}
          <div className="md:hidden w-10 h-10 shrink-0" />
          <div className="text-center min-w-0 flex-1 px-3">
            {/* Album line — only shown when there's a real album. The
                previous "—" fallback looked like a stray underscore in
                the top bar when metadata was missing. */}
            {t.album && (
              <div className="text-base font-medium truncate">{t.album}</div>
            )}
            {subtitle && (
              <div className="text-[11px] text-purple-200/70 truncate mt-0.5">{subtitle}</div>
            )}
          </div>
          <button
            onClick={() => p.spatial.cycle()}
            title={`Spatial reverb: ${p.spatial.preset.toUpperCase()} — click to cycle Off → Cinema → Hall → Club. Real ConvolverNode with synthesized IR.`}
            className={`min-w-[3.25rem] h-6 px-2 rounded-md bezel flex items-center justify-center text-[10px] font-semibold tracking-wider mr-1 ${
              p.spatial.preset !== 'off' ? 'glow-text glow-ring' : 'text-zinc-300 hover:text-white'
            }`}
          >
            {p.spatial.preset === 'off' ? 'DOLBY' : p.spatial.preset.toUpperCase()}
          </button>
          <button
            onClick={() => setEqOpen(true)}
            title="Equalizer"
            className={`h-6 px-3 rounded-md bezel flex items-center justify-center text-[10px] font-semibold tracking-wider ${
              !p.eq.bypass && p.eq.gains.some((g) => Math.abs(g) > 0.05)
                ? 'glow-text glow-ring'
                : 'text-zinc-300 hover:text-white'
            }`}
          >
            EQ
          </button>
          <button
            onClick={() => {
              if (lyrics.status === 'present') setLyricsFull(true);
              else handleFetchLyrics();
            }}
            title={
              lyrics.status === 'present'
                ? '查看完整歌词'
                : lyrics.status === 'loading'
                  ? '加载中...'
                  : fetchingLyrics
                    ? '下载中...'
                    : '下载歌词'
            }
            disabled={fetchingLyrics || lyrics.status === 'loading'}
            className={`h-6 px-3 ml-1 rounded-md bezel flex items-center justify-center ${
              lyrics.status === 'present'
                ? 'glow-text glow-ring'
                : 'text-zinc-300 hover:text-white'
            } disabled:opacity-50`}
          >
            {/* Microphone-ish icon for "lyrics" — speaker bubble with note inside */}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0" />
              <line x1="12" y1="18" x2="12" y2="22" />
              <line x1="8" y1="22" x2="16" y2="22" />
            </svg>
          </button>
        </div>

        {/* Vinyl + tonearm together (sized container so tonearm is positioned
            relative to the disc, not the page). On mobile the disc is
            slightly smaller and pushed down so the tonearm doesn't
            collide with the EQ / DOLBY buttons in the top bar; tapping
            the disc closes the view (replaces the back arrow).
            Hidden when lyricsExpanded, freeing all vertical space for
            the lyrics column. */}
        {!lyricsExpanded && (
          <div className="flex-1 flex items-start md:items-center justify-center min-h-0 pt-14 md:pt-0">
            <button
              onClick={onClose}
              title="Back to library"
              className="relative md:cursor-default md:pointer-events-none"
              style={{ width: 'min(56vw, 320px)', aspectRatio: '1 / 1' }}
            >
              <Vinyl coverUrl={t.cover_url} spinning={p.isPlaying} />
              <Tonearm playing={p.isPlaying} />
            </button>
          </div>
        )}

        {/* Visualizer / lyrics area. Top-left LRC switch toggles between
            wave and lyrics; without it, clicks inside the lyrics panel
            were ambiguous (seek vs. switch back). Same bezel style as the
            EQ/DOLBY buttons in the top bar so it reads as a peer toggle.
            When lyricsExpanded, this box grows (flex-1) to swallow the
            vinyl area above so many more lyric lines fit on screen. */}
        <div
          className={`mt-2 relative ${lyricsExpanded ? 'flex-1 min-h-0' : 'shrink-0'}`}
          style={lyricsExpanded ? undefined : { height: vizHeight }}
        >
          <button
            onClick={() => {
              if (vizMode === 'lyrics') {
                setVizMode('wave');
              } else if (lyrics.status === 'present') {
                setVizMode('lyrics');
              } else if (!fetchingLyrics) {
                handleFetchLyrics();
              }
            }}
            disabled={fetchingLyrics || lyrics.status === 'loading'}
            title={
              vizMode === 'lyrics'
                ? '切换为音波'
                : lyrics.status === 'present'
                  ? '切换为歌词'
                  : fetchingLyrics
                    ? '下载中…'
                    : '下载并显示歌词'
            }
            className="absolute top-2 left-2 z-10 text-[10px] px-2 py-1 rounded-full bezel text-zinc-300 hover:text-white disabled:opacity-50"
          >
            {vizMode === 'lyrics' ? 'Wave' : 'LRC'}
          </button>
          {vizMode === 'lyrics' && lyrics.status === 'present' && (
            <button
              onClick={() => setLyricsExpanded((e) => !e)}
              title={lyricsExpanded ? '收起歌词区' : '向上扩展歌词区'}
              className="absolute top-2 right-2 z-10 text-[10px] px-2 py-1 rounded-full bezel text-zinc-300 hover:text-white"
            >
              {lyricsExpanded ? 'Shrink' : 'Expand'}
            </button>
          )}
          {vizMode === 'wave' ? (
            <AudioVisualizer height={vizHeight} bars={56} />
          ) : lyrics.status === 'present' ? (
            <LyricsPanel
              parsed={lyrics.parsed}
              mode="inline"
              // When expanded, container height is dynamic (flex-1) so we
              // let LyricsPanel measure itself and pick a 40%-height pad.
              padBlock={lyricsExpanded ? undefined : Math.round(vizHeight * 0.4)}
            />
          ) : null}
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
          {/* Symmetrical action row aligned under the times: add-to-playlist
              on the left (under elapsed time), favorite heart on the right
              (under remaining time). Same 32px bezel circle as the
              shuffle/repeat buttons. */}
          <div className="flex justify-between items-center mt-2">
            <button
              onClick={(e) => {
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setAddingTo({ x: r.left, y: r.top - 8 });
              }}
              title="Add to playlist"
              className="w-8 h-8 rounded-full bezel flex items-center justify-center text-zinc-300 hover:text-blue-400"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            {(() => {
              const isFav = favOpt ?? t.favorited;
              return (
                <button
                  onClick={async () => {
                    const next = !isFav;
                    setFavOpt(next);
                    try {
                      await api.updateTrack(t.id, { favorited: next });
                      (t as any).favorited = next;
                      onLibraryChange?.();
                    } catch (err: any) {
                      setFavOpt(!next);
                      alert(`Favorite failed: ${err?.message ?? err}`);
                    }
                  }}
                  title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                  className="w-8 h-8 rounded-full bezel flex items-center justify-center"
                  style={{
                    color: isFav ? '#ff2db5' : '#a0a0a8',
                    boxShadow: isFav
                      ? '0 0 6px rgba(255,45,181,0.55), 0 0 14px rgba(255,45,181,0.45), inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.6)'
                      : undefined,
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill={isFav ? 'currentColor' : 'none'}
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                  </svg>
                </button>
              );
            })()}
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
            className={`w-10 h-10 rounded-full bezel flex items-center justify-center ${
              p.repeat !== 'off' ? 'glow-text glow-ring' : 'text-zinc-300 hover:text-white'
            }`}
          >
            {p.repeat === 'one' ? <RepeatOneIcon /> : <RepeatIcon />}
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
              className="w-14 h-14 rounded-full play-btn flex items-center justify-center"
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
            className={`w-10 h-10 rounded-full bezel flex items-center justify-center ${
              p.shuffle ? 'glow-text glow-ring' : 'text-zinc-300 hover:text-white'
            }`}
          >
            <ShuffleIcon />
          </button>
        </div>

        {/* Volume — desktop only; phone uses hardware volume keys. */}
        <div className="hidden md:flex items-center gap-3 pb-6 shrink-0 px-2">
          <button
            onClick={() => p.setVolume(p.volume > 0 ? 0 : 0.7)}
            title={p.volume > 0 ? 'Mute' : 'Unmute'}
            className="text-zinc-300 hover:text-white shrink-0 w-6 flex items-center justify-center"
          >
            <VolumeIcon level={p.volume === 0 ? 0 : p.volume < 0.5 ? 1 : 2} />
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

      {/* Add-to-playlist popover anchored at the + button. */}
      {addingTo && (
        <AddToPlaylistMenu
          track={t}
          anchor={addingTo}
          onClose={() => setAddingTo(null)}
          onAdded={() => onLibraryChange?.()}
        />
      )}

      {/* Equalizer modal */}
      <EQPanel open={eqOpen} onClose={() => setEqOpen(false)} />

      {/* Fullscreen lyrics overlay (z-50 sits above NowPlayingView's z-40) */}
      {lyricsFull && lyrics.status === 'present' && (
        <FullscreenLyrics
          parsed={lyrics.parsed}
          source={lyrics.source}
          title={t.title || t.rel_path}
          artist={t.artist || ''}
          onClose={() => setLyricsFull(false)}
          onRefetch={handleFetchLyrics}
          refetching={fetchingLyrics}
        />
      )}

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

function FullscreenLyrics({
  parsed,
  source,
  title,
  artist,
  onClose,
  onRefetch,
  refetching,
}: {
  parsed: ParsedLyrics;
  source: string | null;
  title: string;
  artist: string;
  onClose: () => void;
  onRefetch: () => void;
  refetching: boolean;
}) {
  // Esc closes the overlay (the underlying NowPlayingView's Esc handler
  // also fires, but it's idempotent — closing twice is a no-op).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 text-white flex flex-col"
      style={{
        background:
          'radial-gradient(ellipse at 50% 0%, #2a1620 0%, #0d0d0e 60%), #0d0d0e',
      }}
    >
      <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 text-2xl"
          title="关闭歌词"
        >
          ‹
        </button>
        <div className="text-center min-w-0 flex-1 px-3">
          <div className="text-base font-medium truncate">{title}</div>
          <div className="text-[11px] text-zinc-400 truncate mt-0.5">
            {artist}
            {source ? ` · ${source}` : ''}
          </div>
        </div>
        <button
          onClick={onRefetch}
          disabled={refetching}
          title="重新下载（覆盖现有）"
          className="w-10 h-10 rounded-full bezel flex items-center justify-center text-zinc-300 hover:text-white disabled:opacity-50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <LyricsPanel parsed={parsed} mode="full" />
      </div>
    </div>
  );
}

function Tonearm({ playing }: { playing: boolean }) {
  // Realistic-ish turntable tonearm: counterweight + pivot housing on a
  // base mount, S-curved aluminum arm tube, angled headshell with the
  // stylus tip resting on the record (with a subtle magenta glow).
  // Pivot at viewBox (176, 24) so it sits just outside the disc's upper-right.
  return (
    <svg
      viewBox="0 0 200 200"
      className="absolute pointer-events-none transition-transform duration-700"
      style={{
        top: '-20%',
        right: '-18%',
        width: '70%',
        height: '70%',
        transform: playing ? 'rotate(0deg)' : 'rotate(-18deg)',
        transformOrigin: '88% 12%',
        filter: 'drop-shadow(0 4px 6px rgba(0,0,0,0.6))',
      }}
    >
      <defs>
        {/* Brushed-aluminum gradient for the arm tube */}
        <linearGradient id="ta-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e6e6ea" />
          <stop offset="40%" stopColor="#a8a8b0" />
          <stop offset="100%" stopColor="#4a4a52" />
        </linearGradient>
        {/* Dark-anodized for housings */}
        <linearGradient id="ta-dark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a3a3e" />
          <stop offset="100%" stopColor="#15151a" />
        </linearGradient>
        <radialGradient id="ta-pivot" cx="35%" cy="30%">
          <stop offset="0%" stopColor="#f0f0f4" />
          <stop offset="60%" stopColor="#9a9aa0" />
          <stop offset="100%" stopColor="#2a2a30" />
        </radialGradient>
      </defs>

      {/* Counterweight: ribbed cylinder behind the pivot */}
      <g>
        <rect x="178" y="6" width="20" height="14" rx="3"
              fill="url(#ta-dark)" stroke="#000" strokeWidth="0.5" />
        <line x1="180" y1="10" x2="196" y2="10" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
        <line x1="180" y1="13" x2="196" y2="13" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
        <line x1="180" y1="16" x2="196" y2="16" stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" />
      </g>

      {/* Pivot base plate (the mount on the plinth) */}
      <circle cx="176" cy="24" r="18" fill="url(#ta-dark)" stroke="#000" strokeWidth="0.5" />
      <circle cx="176" cy="24" r="14" fill="url(#ta-pivot)" />
      <circle cx="176" cy="24" r="3" fill="#0a0a0c" />

      {/* Cueing lever (lift) just to the left of the pivot */}
      <rect x="158" y="32" width="3" height="14" rx="1.5"
            fill="url(#ta-metal)" stroke="#1a1a1c" strokeWidth="0.3" />
      <rect x="156" y="44" width="7" height="3" rx="1" fill="url(#ta-dark)" />

      {/* Arm tube — gentle S-curve from pivot to headshell */}
      {/* Outer thicker tube for depth */}
      <path
        d="M 168 32 Q 130 70, 105 92 T 60 142"
        stroke="#1a1a1c"
        strokeWidth="7"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M 168 32 Q 130 70, 105 92 T 60 142"
        stroke="url(#ta-metal)"
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
      />
      {/* Highlight strip on tube (specular) */}
      <path
        d="M 168 30 Q 130 68, 105 90 T 62 140"
        stroke="rgba(255,255,255,0.25)"
        strokeWidth="1"
        fill="none"
        strokeLinecap="round"
      />

      {/* Headshell + stylus at the tip, angled to point at the spindle */}
      <g transform="translate(60, 142) rotate(-35)">
        {/* Headshell body */}
        <rect x="-14" y="-6" width="24" height="12" rx="2"
              fill="url(#ta-dark)" stroke="#000" strokeWidth="0.5" />
        {/* Cartridge mount detail (screws) */}
        <circle cx="-8" cy="-3" r="0.8" fill="#888" />
        <circle cx="-8" cy="3" r="0.8" fill="#888" />
        <circle cx="6" cy="-3" r="0.8" fill="#888" />
        <circle cx="6" cy="3" r="0.8" fill="#888" />
        {/* Cartridge body extending below the headshell */}
        <rect x="-4" y="6" width="8" height="6" rx="0.5" fill="#0a0a0c" />
        {/* Stylus + glowing tip */}
        <line x1="0" y1="12" x2="0" y2="16" stroke="#cccccc" strokeWidth="0.8" />
        <circle cx="0" cy="16" r="1.6" fill="var(--accent)" />
        <circle cx="0" cy="16" r="3" fill="var(--accent)" opacity="0.4" />
      </g>
    </svg>
  );
}
