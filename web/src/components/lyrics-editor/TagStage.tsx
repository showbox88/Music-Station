/**
 * Step 3 of the LyricsEditor flow: play audio and time-stamp each line.
 *
 * Audio: an independent <audio> element (NOT the global PlayerContext)
 * so the user's main playback queue isn't disturbed and we get clean
 * keyboard control.
 *
 * Save: only timestamped lines are written. Untagged lines are dropped
 * (with a confirmation if any are missing).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import type { Track } from '../../types';
import { useT } from '../../i18n/useT';
import type { TaggedLine } from './types';

function formatLrcTime(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const cs = Math.floor((ms % 1000) / 10); // hundredths of a second
  return `[${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}]`;
}

function fmtClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function TagStage({
  track,
  lines,
  setLines,
  onBackToPaste,
  onBackToPick,
}: {
  track: Track;
  lines: TaggedLine[];
  setLines: React.Dispatch<React.SetStateAction<TaggedLine[]>>;
  onBackToPaste: () => void;
  onBackToPick: () => void;
}) {
  const t = useT();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0); // sec
  const [duration, setDuration] = useState(track.duration_sec || 0);
  const [saving, setSaving] = useState(false);
  // Editor's audio is its own element (independent of the global player)
  // so the user can listen here without interrupting their main queue.
  // Volume defaults to 0.9 — typical comfortable listening level.
  const [volume, setVolume] = useState(0.9);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);
  // Index of the line awaiting a tap. We auto-advance to the next untagged
  // line after each Space press so the user can keep both hands free of
  // the mouse and just hit Space repeatedly.
  const cursorRef = useRef(0);
  const [cursor, setCursorState] = useState(0);
  const setCursor = (v: number) => {
    cursorRef.current = v;
    setCursorState(v);
  };
  const lineListRef = useRef<HTMLDivElement | null>(null);
  const lineElsRef = useRef<Array<HTMLDivElement | null>>([]);

  // Keep a ref of lines so the keyboard handler reads the latest state
  // without re-binding the listener on every keystroke.
  const linesRef = useRef(lines);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  // Audio event wiring
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setPosition(audio.currentTime || 0);
    const onMeta = () => setDuration(audio.duration || track.duration_sec || 0);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
    };
  }, [track.duration_sec]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, []);

  const seekDelta = useCallback((delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration || 0, audio.currentTime + delta));
  }, []);

  const stampCurrent = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const i = cursorRef.current;
    const cur = linesRef.current[i];
    if (!cur) return;
    const ms = Math.max(0, Math.round(audio.currentTime * 1000));
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ms } : l)));
    // Advance to the next line (loop stops at end).
    if (i + 1 < linesRef.current.length) {
      setCursor(i + 1);
    }
  }, [setLines]);

  const undoLast = useCallback(() => {
    setLines((prev) => {
      // Find the last tagged line; clear it; move cursor back there.
      let lastIdx = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].ms >= 0) {
          lastIdx = i;
          break;
        }
      }
      if (lastIdx < 0) return prev;
      const next = prev.map((l, idx) => (idx === lastIdx ? { ...l, ms: -1 } : l));
      setCursor(lastIdx);
      return next;
    });
  }, [setLines]);

  // Global key handler. Only active in tag stage. We don't intercept keys
  // when focus is in an input/textarea/contenteditable — there are none
  // visible here, but be defensive.
  useEffect(() => {
    function isEditable(el: EventTarget | null): boolean {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.isContentEditable
      );
    }
    function onKey(e: KeyboardEvent) {
      if (isEditable(e.target)) return;
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          stampCurrent();
          break;
        case 'Backspace':
          e.preventDefault();
          undoLast();
          break;
        case 'Enter':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekDelta(-3);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekDelta(3);
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (cursorRef.current > 0) setCursor(cursorRef.current - 1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (cursorRef.current < linesRef.current.length - 1)
            setCursor(cursorRef.current + 1);
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stampCurrent, undoLast, togglePlay, seekDelta]);

  // Auto-scroll the cursor line into view
  useEffect(() => {
    const el = lineElsRef.current[cursor];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [cursor]);

  const taggedCount = useMemo(() => lines.filter((l) => l.ms >= 0).length, [lines]);

  function buildLrc(): string {
    return lines
      .filter((l) => l.ms >= 0)
      .map((l) => `${formatLrcTime(l.ms)}${l.text}`)
      .join('\n');
  }

  async function handleSave() {
    if (taggedCount === 0) {
      alert(t('lyrics_editor.no_marks_alert'));
      return;
    }
    if (taggedCount < lines.length) {
      const skipped = lines.length - taggedCount;
      if (!confirm(t('lyrics_editor.save_partial_confirm', { count: skipped })))
        return;
    }
    setSaving(true);
    try {
      await api.setLyrics(track.id, buildLrc());
      alert(t('lyrics_editor.save_success', { count: taggedCount }));
    } catch (err: any) {
      alert(t('lyrics_editor.save_failed', { err: err?.message ?? String(err) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={track.url}
        preload="auto"
        autoPlay
      />

      {/* Player + controls bar */}
      <div className="px-5 py-3 border-b border-black/60 shrink-0 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <button
            onClick={togglePlay}
            className="w-12 h-12 rounded-full play-btn flex items-center justify-center"
            title={isPlaying ? t('lyrics_editor.tag_pause') : t('lyrics_editor.tag_play')}
          >
            {isPlaying ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" />
                <rect x="14" y="5" width="4" height="14" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          <button
            onClick={() => seekDelta(-3)}
            className="btn-pill-xs text-zinc-300 hover:text-white"
            title={t('lyrics_editor.tag_back_3s')}
          >
            ‹‹ 3s
          </button>
          <button
            onClick={() => seekDelta(3)}
            className="btn-pill-xs text-zinc-300 hover:text-white"
            title={t('lyrics_editor.tag_forward_3s')}
          >
            3s ››
          </button>
          <span className="text-xs text-zinc-500 tabular-nums ml-2">
            {fmtClock(position)} / {fmtClock(duration)}
          </span>
          <span className="text-xs text-zinc-500 ml-auto">
            {t('lyrics_editor.tag_marked_count', {
              tagged: taggedCount,
              total: lines.length,
            })}
          </span>
          {/* Volume — local to this editor's audio element. Same recessed
              slider visual as PlayerBar / NowPlayingView. */}
          <div className="flex items-center gap-2 shrink-0 w-32">
            <span className="text-xs text-zinc-500 tabular-nums w-6 text-right">
              {Math.round(volume * 100)}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="flex-1"
              title={t('lyrics_editor.tag_volume_tooltip')}
              style={{
                background: `linear-gradient(to right,
                  var(--accent) 0%,
                  var(--accent-soft) ${volume * 100}%,
                  #0a0a0b ${volume * 100}%,
                  #1a1a1c 100%)`,
                WebkitAppearance: 'none',
                height: 4,
                borderRadius: 9999,
                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.8)',
              }}
            />
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(0, duration)}
          step={0.1}
          value={position}
          onChange={(e) => {
            const audio = audioRef.current;
            if (audio) audio.currentTime = Number(e.target.value);
          }}
          className="w-full"
          style={{
            background: `linear-gradient(to right,
              var(--accent) 0%,
              var(--accent-soft) ${(position / Math.max(1, duration)) * 100}%,
              #0a0a0b ${(position / Math.max(1, duration)) * 100}%,
              #1a1a1c 100%)`,
            WebkitAppearance: 'none',
            height: 4,
            borderRadius: 9999,
          }}
        />
        <div className="flex items-center justify-between text-[11px] text-zinc-500">
          <span>{t('lyrics_editor.tag_kbd_help_l')}</span>
          <span>{t('lyrics_editor.tag_kbd_help_r')}</span>
        </div>
      </div>

      {/* Lines list */}
      <div ref={lineListRef} className="flex-1 overflow-auto px-5 py-4">
        <div className="max-w-3xl mx-auto space-y-1">
          {lines.map((l, i) => {
            const isCursor = i === cursor;
            const isTagged = l.ms >= 0;
            return (
              <div
                key={i}
                ref={(el) => {
                  lineElsRef.current[i] = el;
                }}
                onClick={() => setCursor(i)}
                className={`flex items-baseline gap-3 px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${
                  isCursor
                    ? 'bg-white/5 ring-2 ring-pink-500/40'
                    : 'hover:bg-white/[0.03]'
                }`}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isTagged) return;
                    const audio = audioRef.current;
                    if (audio) audio.currentTime = l.ms / 1000;
                  }}
                  disabled={!isTagged}
                  className={`text-xs tabular-nums shrink-0 w-20 text-left font-mono ${
                    isTagged
                      ? 'text-pink-400 hover:text-pink-300'
                      : 'text-zinc-700'
                  }`}
                  title={isTagged ? t('lyrics_editor.tag_jump_to_time') : t('lyrics_editor.tag_unmarked')}
                >
                  {isTagged ? formatLrcTime(l.ms) : '[--:--.--]'}
                </button>
                <span
                  className={`flex-1 min-w-0 ${
                    isCursor
                      ? 'text-white font-medium glow-text'
                      : isTagged
                        ? 'text-zinc-300'
                        : 'text-zinc-500'
                  }`}
                  style={isCursor ? { color: 'var(--accent)' } : undefined}
                >
                  {l.text}
                </span>
                {isCursor && (
                  <span className="text-[10px] text-pink-400 shrink-0 animate-pulse">
                    {t('lyrics_editor.tag_press_space')}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom action bar */}
      <div className="px-5 py-3 border-t border-black/60 shrink-0 flex items-center gap-2">
        <button
          onClick={onBackToPick}
          className="btn-pill-xs text-zinc-400 hover:text-white"
        >
          {t('lyrics_editor.tag_back_to_pick_short')}
        </button>
        <button
          onClick={onBackToPaste}
          className="btn-pill-xs text-zinc-400 hover:text-white"
        >
          {t('lyrics_editor.tag_back_to_paste')}
        </button>
        <button
          onClick={undoLast}
          className="btn-pill-xs text-zinc-300 hover:text-white"
          disabled={taggedCount === 0}
        >
          {t('lyrics_editor.tag_undo_last')}
        </button>
        <button
          onClick={() => {
            if (confirm(t('lyrics_editor.tag_clear_all_confirm'))) {
              setLines((prev) => prev.map((l) => ({ ...l, ms: -1 })));
              setCursor(0);
            }
          }}
          className="btn-pill-xs text-zinc-400 hover:text-red-400"
          disabled={taggedCount === 0}
        >
          {t('lyrics_editor.tag_clear_all')}
        </button>
        <span className="ml-auto" />
        <button
          onClick={handleSave}
          disabled={saving || taggedCount === 0}
          className="btn-primary"
        >
          {saving ? t('lyrics_editor.tag_saving') : t('lyrics_editor.tag_save')}
        </button>
      </div>
    </div>
  );
}
