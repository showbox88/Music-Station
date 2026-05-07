/**
 * Fullscreen "Now Playing" — the visual chrome is delegated to one of four
 * SKINS (see `Player Skin/skin-NN-*.md` for the spec source of truth and
 * `web/src/player/skins/` for the React implementations). This component
 * is the SHELL: it owns lifecycle (Esc key, lyrics fetch, optimistic
 * favorite state, modal popovers), reads `prefs.player_skin` to pick a
 * skin, and renders the chosen skin component with all state + handlers.
 *
 * Modals (EQ panel, add-to-playlist popover, fullscreen-lyrics overlay)
 * are rendered here, on top of the active skin, so each skin doesn't
 * have to re-implement them.
 */
import { useEffect, useState } from 'react';
import { usePlayer } from './PlayerContext';
import { usePrefs } from '../PrefsContext';
import EQPanel from './EQPanel';
import LyricsPanel, { parseLrc, type ParsedLyrics } from './LyricsPanel';
import { api } from '../api';
import AddToPlaylistMenu from '../components/AddToPlaylistMenu';
import './skins/skins.css';
import { DEFAULT_SKIN, isSkinId } from './skins/registry';
import type { SkinId, SkinProps } from './skins/types';
import CreamSkin from './skins/Cream';
import CosmicSkin from './skins/Cosmic';
import AuroraSkin from './skins/Aurora';
import AbyssSkin from './skins/Abyss';

type LyricsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'absent' }
  | { status: 'error'; message: string }
  | { status: 'present'; parsed: ParsedLyrics; source: string | null };

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a server-side library change (e.g. favorite toggle)
   *  so the parent can refresh open lists. */
  onLibraryChange?: () => void;
}

export default function NowPlayingView({ open, onClose, onLibraryChange }: Props) {
  const p = usePlayer();
  const { prefs, setPref } = usePrefs();

  const [eqOpen, setEqOpen] = useState(false);
  const [lyricsFull, setLyricsFull] = useState(false);
  const [lyrics, setLyrics] = useState<LyricsState>({ status: 'idle' });
  const [fetchingLyrics, setFetchingLyrics] = useState(false);

  // Optimistic favorite state — track object is shared so we mirror locally
  // for instant feedback and reset whenever the playing track changes.
  const [favOpt, setFavOpt] = useState<boolean | null>(null);
  const [addingTo, setAddingTo] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setFavOpt(null);
  }, [p.current?.id]);

  // Load cached lyrics whenever the playing track changes. Local-only —
  // never auto-fetches; the user must press the lyrics button.
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

  // Skin selection. Persisted via prefs (server-synced).
  const currentSkinId: SkinId = isSkinId(prefs.player_skin)
    ? (prefs.player_skin as SkinId)
    : DEFAULT_SKIN;
  function pickSkin(id: SkinId) {
    setPref('player_skin', id);
  }

  const isFav = (favOpt ?? t.favorited) ?? false;
  async function toggleFavorite() {
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
  }

  const eqActive = !p.eq.bypass && p.eq.gains.some((g) => Math.abs(g) > 0.05);

  const skinProps: SkinProps = {
    track: t,
    isPlaying: p.isPlaying,
    position: p.position,
    duration: p.duration,
    remaining,
    volume: p.volume,
    shuffle: p.shuffle,
    repeat: p.repeat,

    onTogglePlay: p.togglePlay,
    onNext: p.next,
    onPrev: p.prev,
    onSeek: p.seek,
    onSetVolume: p.setVolume,
    onToggleShuffle: p.toggleShuffle,
    onCycleRepeat: p.cycleRepeat,

    isFavorite: isFav,
    onToggleFavorite: toggleFavorite,

    onClose,
    onOpenEq: () => setEqOpen(true),
    onOpenAddToPlaylist: setAddingTo,
    onCycleSpatial: () => p.spatial.cycle(),
    spatialPreset: p.spatial.preset,
    eqActive,

    lyricsStatus: lyrics.status,
    lyrics: lyrics.status === 'present' ? lyrics.parsed : null,
    onFetchLyrics: handleFetchLyrics,
    onOpenFullLyrics: () => setLyricsFull(true),
    fetchingLyrics,

    getAnalyser: p.getAnalyser,

    currentSkinId,
    onPickSkin: pickSkin,
  };

  const SkinComponent =
    currentSkinId === 'cream'
      ? CreamSkin
      : currentSkinId === 'cosmic'
        ? CosmicSkin
        : currentSkinId === 'aurora'
          ? AuroraSkin
          : AbyssSkin;

  return (
    <>
      <SkinComponent {...skinProps} />

      {/* Modals layered above the skin, identical across skins. */}
      {addingTo && (
        <AddToPlaylistMenu
          track={t}
          anchor={addingTo}
          onClose={() => setAddingTo(null)}
          onAdded={() => onLibraryChange?.()}
        />
      )}

      <EQPanel open={eqOpen} onClose={() => setEqOpen(false)} />

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
    </>
  );
}

/* ----------------------------- Fullscreen Lyrics ----------------------------- */

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
