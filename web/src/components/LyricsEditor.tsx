/**
 * Lyrics Editor — a "tap-to-tag" LRC maker.
 *
 * Three stages, controlled by a local `stage` state:
 *
 *   1. pick    Choose a track from the library (search box + list).
 *   2. paste   Paste already-line-broken lyric text into a textarea.
 *              Optionally pre-fills from the server's existing .lrc with
 *              timestamps stripped, so the user can re-tag.
 *   3. tag     Play the audio and press Space at the start of each line
 *              to stamp [mm:ss.xx] in front of it.
 *
 * Each stage lives in its own file under web/src/components/lyrics-editor/.
 * This wrapper just owns the cross-stage state (current stage, picked
 * track, the in-progress lines) and routes between them.
 */
import { useState } from 'react';
import type { Track } from '../types';
import { useT } from '../i18n/useT';
import PickStage from './lyrics-editor/PickStage';
import PasteStage from './lyrics-editor/PasteStage';
import TagStage from './lyrics-editor/TagStage';
import type { TaggedLine } from './lyrics-editor/types';

type Stage = 'pick' | 'paste' | 'tag';

export default function LyricsEditor() {
  const t = useT();
  const [stage, setStage] = useState<Stage>('pick');
  const [picked, setPicked] = useState<Track | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [lines, setLines] = useState<TaggedLine[]>([]);

  function onPicked(track: Track, prefill: string) {
    setPicked(track);
    setPasteText(prefill);
    setStage('paste');
  }

  function startTagging() {
    const parsed: TaggedLine[] = pasteText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((text) => ({ text, ms: -1 }));
    if (parsed.length === 0) {
      alert(t('lyrics_editor.no_text_alert'));
      return;
    }
    setLines(parsed);
    setStage('tag');
  }

  function backToPick() {
    if (
      stage === 'tag' &&
      lines.some((l) => l.ms >= 0) &&
      !confirm(t('lyrics_editor.leave_warn_tag'))
    )
      return;
    setPicked(null);
    setPasteText('');
    setLines([]);
    setStage('pick');
  }

  function backToPaste() {
    if (lines.some((l) => l.ms >= 0) && !confirm(t('lyrics_editor.leave_warn_tag'))) return;
    setLines([]);
    setStage('paste');
  }

  return (
    <main className="flex-1 min-w-0 flex flex-col h-full">
      <div className="px-5 py-3 border-b border-black/60 flex items-center gap-3 shrink-0">
        <h1 className="text-base font-semibold">🎤 {t('lyrics_editor.title')}</h1>
        <span className="text-xs text-zinc-500">
          {stage === 'pick' && t('lyrics_editor.step1')}
          {stage === 'paste' && t('lyrics_editor.step2')}
          {stage === 'tag' && t('lyrics_editor.step3')}
        </span>
        {picked && (
          <span className="text-xs text-zinc-400 ml-auto truncate max-w-md">
            {picked.title || picked.rel_path}
            {picked.artist ? ` · ${picked.artist}` : ''}
          </span>
        )}
      </div>

      {stage === 'pick' && <PickStage onPick={onPicked} />}
      {stage === 'paste' && picked && (
        <PasteStage
          track={picked}
          text={pasteText}
          setText={setPasteText}
          onBack={backToPick}
          onNext={startTagging}
        />
      )}
      {stage === 'tag' && picked && (
        <TagStage
          track={picked}
          lines={lines}
          setLines={setLines}
          onBackToPaste={backToPaste}
          onBackToPick={backToPick}
        />
      )}
    </main>
  );
}
