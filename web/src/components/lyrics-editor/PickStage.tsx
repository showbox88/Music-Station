/**
 * Step 1 of the LyricsEditor flow: search the library, pick a track.
 *
 * If the picked track already has lyrics on the server, ExistingLyricsDialog
 * pops up offering three choices (load existing without timestamps / start
 * blank / cancel back to the list). The browser confirm() was a two-button
 * affair that conflated cancel with "start blank" — users misclicked.
 */
import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { Track, TrackListResponse } from '../../types';
import { useT } from '../../i18n/useT';
import ModalShell from '../Modal';

function fmtClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Strip [mm:ss.xx] tags from each line so the user can re-tag from
 *  scratch when they pre-load existing lyrics. */
function stripTimestamps(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/\[\d+:\d{1,2}(?:[.:]\d{1,3})?\]/g, '').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

export default function PickStage({ onPick }: { onPick: (t: Track, prefill: string) => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<{ track: Track; existing: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listTracks({ q, limit: 100, sort: 'title' })
      .then((r: TrackListResponse) => {
        if (!cancelled) setTracks(r.tracks);
      })
      .catch(() => {
        if (!cancelled) setTracks([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [q]);

  async function handlePick(track: Track) {
    try {
      const r = await api.getLyrics(track.id);
      if (r.found && r.synced) {
        setDialog({ track, existing: r.synced });
        return;
      }
    } catch {
      /* network error → treat as no existing lyrics */
    }
    onPick(track, '');
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="p-4 shrink-0">
        <input
          type="search"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('lyrics_editor.search_placeholder')}
          className="input w-full max-w-lg"
        />
      </div>
      <div className="flex-1 overflow-auto px-4 pb-4">
        {loading ? (
          <div className="text-sm text-zinc-500 px-2">{t('lyrics_editor.loading')}</div>
        ) : tracks.length === 0 ? (
          <div className="text-sm text-zinc-500 px-2">{t('lyrics_editor.no_results')}</div>
        ) : (
          <ul className="space-y-1 max-w-3xl">
            {tracks.map((track) => (
              <li
                key={track.id}
                onClick={() => handlePick(track)}
                className="px-3 py-2 rounded-lg hover:bg-white/5 cursor-pointer flex items-center gap-3"
              >
                <span className="text-zinc-500 text-xs tabular-nums w-10 text-right shrink-0">
                  #{track.id}
                </span>
                <span className="flex-1 min-w-0 truncate text-sm">
                  {track.title || track.rel_path}
                </span>
                <span className="text-xs text-zinc-500 truncate max-w-xs">
                  {track.artist || ''}
                </span>
                <span className="text-xs text-zinc-600 tabular-nums shrink-0">
                  {fmtClock(track.duration_sec ?? 0)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {dialog && (
        <ExistingLyricsDialog
          track={dialog.track}
          onLoad={() => {
            const tr = dialog.track;
            const existing = dialog.existing;
            setDialog(null);
            onPick(tr, stripTimestamps(existing));
          }}
          onBlank={() => {
            const tr = dialog.track;
            setDialog(null);
            onPick(tr, '');
          }}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function ExistingLyricsDialog({
  track,
  onLoad,
  onBlank,
  onCancel,
}: {
  track: Track;
  onLoad: () => void;
  onBlank: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  // Esc cancels — same affordance as the X button.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <ModalShell onClose={onCancel} maxWidth="max-w-md" className="p-6 space-y-4">
      <div>
        <h2 className="text-base font-semibold">{t('lyrics_editor.existing_lyrics')}</h2>
        <p className="text-xs text-zinc-500 mt-1 truncate">
          {track.title || track.rel_path}
        </p>
      </div>
      <div className="flex flex-col gap-2 pt-1">
        <button
          type="button"
          onClick={onLoad}
          className="px-4 py-2 rounded-full bezel glow-text glow-ring text-sm text-left"
        >
          {t('lyrics_editor.existing_load')}
        </button>
        <button
          type="button"
          onClick={onBlank}
          className="px-4 py-2 rounded-full bezel text-sm text-zinc-200 hover:text-white text-left"
        >
          {t('lyrics_editor.existing_blank')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-full bezel text-sm text-zinc-400 hover:text-white text-left"
        >
          {t('lyrics_editor.existing_cancel')}
        </button>
      </div>
    </ModalShell>
  );
}
