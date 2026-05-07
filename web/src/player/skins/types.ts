/**
 * Skin system types. Specs live under `D:/Projects/Music-Station/Player Skin/`.
 *
 * A skin is a complete visual rendering of the fullscreen "Now Playing"
 * view. The skin owns layout (where the cover, transport, progress live)
 * and styling. The wrapper (NowPlayingView.tsx) owns lifecycle: lyrics
 * fetch, escape key, favorite optimistic state, and modal popovers.
 */
import type { Track } from '../../types';
import type { ParsedLyrics } from '../LyricsPanel';

export type SkinId = 'cream' | 'cosmic' | 'aurora' | 'abyss';

export interface SkinManifest {
  id: SkinId;
  /** Display name in the picker. */
  name: string;
  /** Short tagline shown under the name. */
  tagline: string;
  /** Two CSS colors used for the picker swatch (background + accent). */
  swatch: { bg: string; accent: string };
}

/**
 * State + handlers that every skin component receives. Skins must not
 * fetch from the API or own playback state — they read this prop and
 * call handlers.
 */
export interface SkinProps {
  /* ---------- track + playback ---------- */
  track: Track;
  isPlaying: boolean;
  /** seconds played in current track */
  position: number;
  /** seconds remaining (already computed) */
  remaining: number;
  /** total duration in seconds */
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: 'off' | 'one' | 'all';

  /* ---------- transport ---------- */
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (seconds: number) => void;
  onSetVolume: (v: number) => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;

  /* ---------- favorite (optimistic) ---------- */
  isFavorite: boolean;
  onToggleFavorite: () => void;

  /* ---------- chrome handlers ---------- */
  onClose: () => void;
  onOpenEq: () => void;
  /** Anchor at the position of the click event. */
  onOpenAddToPlaylist: (anchor: { x: number; y: number }) => void;
  onCycleSpatial: () => void;
  spatialPreset: 'off' | 'cinema' | 'hall' | 'club';
  /** True if the equalizer has any non-zero gain (UI may glow the EQ button). */
  eqActive: boolean;

  /* ---------- lyrics ---------- */
  lyricsStatus: 'idle' | 'loading' | 'absent' | 'error' | 'present';
  lyrics: ParsedLyrics | null;
  onFetchLyrics: () => void;
  onOpenFullLyrics: () => void;
  fetchingLyrics: boolean;

  /* ---------- visualizer ---------- */
  /** Returns the live AnalyserNode; nullable until audio starts. */
  getAnalyser: () => AnalyserNode | null;

  /* ---------- skin picker ---------- */
  currentSkinId: SkinId;
  onPickSkin: (id: SkinId) => void;
}
