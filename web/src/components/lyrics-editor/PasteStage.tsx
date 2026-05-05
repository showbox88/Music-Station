/**
 * Step 2 of the LyricsEditor flow: paste already-line-broken lyrics.
 * The next step (TagStage) will time-stamp each line.
 */
import type { Track } from '../../types';
import { useT } from '../../i18n/useT';

export default function PasteStage({
  track,
  text,
  setText,
  onBack,
  onNext,
}: {
  track: Track;
  text: string;
  setText: (s: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const t = useT();
  const lineCount = text.split(/\r?\n/).filter((s) => s.trim().length > 0).length;
  // The intro string includes a {bold} placeholder we replace with a styled
  // span. Split on it manually so we keep the styling.
  const introTemplate = t('lyrics_editor.paste_intro', {
    bold: '__BOLD__',
  });
  const introParts = introTemplate.split('__BOLD__');
  return (
    <div className="flex-1 min-h-0 flex flex-col p-4 gap-3 max-w-3xl">
      <p className="text-xs text-zinc-500">
        {introParts[0]}
        <strong className="text-zinc-300">{t('lyrics_editor.paste_already_split')}</strong>
        {introParts[1] ?? ''}
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
        className="input flex-1 font-mono text-sm"
        style={{ minHeight: 280, resize: 'vertical' }}
        placeholder={`Dancing in the moonlight\nEverybody here is feeling alright\n...`}
      />
      <div className="flex items-center justify-between shrink-0">
        <span className="text-xs text-zinc-500">
          {t('lyrics_editor.paste_lines', { count: lineCount })}
        </span>
        <div className="flex gap-2">
          <button onClick={onBack} className="btn-secondary">
            {t('lyrics_editor.back_to_pick')}
          </button>
          <button
            onClick={onNext}
            disabled={lineCount === 0}
            className="btn-primary"
          >
            {t('lyrics_editor.start_tagging')}
          </button>
        </div>
      </div>
      {!track.duration_sec && (
        <p className="text-xs text-amber-400">{t('lyrics_editor.no_duration_warning')}</p>
      )}
    </div>
  );
}
