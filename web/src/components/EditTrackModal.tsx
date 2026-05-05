import { useEffect, useRef, useState } from 'react';
import { api, type LyricCandidate, type TrackEdit } from '../api';
import type { Track } from '../types';
import StarRating from './StarRating';
import CoverPicker from './CoverPicker';
import { useT } from '../i18n/useT';
import ModalShell from './Modal';
import UserSharePanel from './UserSharePanel';

interface Props {
  track: Track;
  onClose: () => void;
  onSaved: (updated: Track) => void;
}

type ModalTab = 'info' | 'lyrics' | 'share';

export default function EditTrackModal({ track, onClose, onSaved }: Props) {
  const [form, setForm] = useState({
    title: track.title ?? '',
    artist: track.artist ?? '',
    album: track.album ?? '',
    genre: track.genre ?? '',
    year: track.year != null ? String(track.year) : '',
    track_no: track.track_no != null ? String(track.track_no) : '',
    rating: track.rating ?? 0,
  });
  const [coverUrl, setCoverUrl] = useState<string | null>(track.cover_url);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<ModalTab>('info');
  const t = useT();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      // Owner-only metadata fields are dropped from the payload for
      // non-owners — the server would 403 the request as a whole if any
      // owner-only key is present, so we'd lose the rating change too.
      // rating is always per-user so always sent.
      const payload: TrackEdit = track.is_owner
        ? {
            title: form.title.trim() || null,
            artist: form.artist.trim() || null,
            album: form.album.trim() || null,
            genre: form.genre.trim() || null,
            year: form.year.trim() ? Number(form.year) : null,
            track_no: form.track_no.trim() ? Number(form.track_no) : null,
            rating: form.rating,
          }
        : { rating: form.rating };
      const updated = await api.updateTrack(track.id, payload);
      // Cover URL may have been changed by CoverPicker out-of-band; reflect it
      onSaved({ ...updated, cover_url: coverUrl });
      onClose();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      as="form"
      onSubmit={onSave}
      onClose={onClose}
      maxWidth="max-w-lg"
      className="flex flex-col max-h-[90vh]"
    >
        {/* Header */}
        <div className="px-6 pt-6 pb-3 shrink-0">
          <h2 className="text-lg font-semibold">{t('modal_edit.title')}</h2>
          <p className="text-xs text-zinc-500 mt-1 truncate">{track.rel_path}</p>
          {!track.is_owner && (
            <p className="text-xs text-amber-400 mt-2">
              {t('modal_edit.non_owner_warning', {
                name: track.owner_display_name || track.owner_username || '',
              })}
            </p>
          )}
        </div>

        {/* Tab strip */}
        <div className="px-6 shrink-0 flex gap-1.5 border-b border-black/60">
          <ModalTabButton id="info" active={tab} setTab={setTab}>
            {t('modal_edit.tab.info')}
          </ModalTabButton>
          <ModalTabButton id="lyrics" active={tab} setTab={setTab}>
            {t('modal_edit.tab.lyrics')}
          </ModalTabButton>
          {track.is_owner && (
            <ModalTabButton id="share" active={tab} setTab={setTab}>
              {t('modal_edit.tab.share')}
            </ModalTabButton>
          )}
        </div>

        {/* Tab content — scrollable so the modal stays bounded */}
        <div className="flex-1 min-h-0 overflow-auto px-6 py-4 space-y-4">
          {tab === 'info' && (
            <>
              <Field label={t("modal_edit.field.cover")}>
                <CoverPicker
                  track={{ ...track, cover_url: coverUrl }}
                  onChanged={setCoverUrl}
                />
              </Field>

              <Field label={t("modal_edit.field.rating")}>
                <StarRating
                  value={form.rating}
                  onChange={(v) => setForm({ ...form, rating: v })}
                  size="md"
                />
              </Field>

              <Field label={t("modal_edit.field.title")}>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="input"
                  autoFocus
                  disabled={!track.is_owner}
                />
              </Field>
              <Field label={t("modal_edit.field.artist")}>
                <input
                  type="text"
                  value={form.artist}
                  onChange={(e) => setForm({ ...form, artist: e.target.value })}
                  className="input"
                  disabled={!track.is_owner}
                />
              </Field>
              <Field label={t("modal_edit.field.album")}>
                <input
                  type="text"
                  value={form.album}
                  onChange={(e) => setForm({ ...form, album: e.target.value })}
                  className="input"
                  disabled={!track.is_owner}
                />
              </Field>
              <Field label={t("modal_edit.field.genre")}>
                <input
                  type="text"
                  value={form.genre}
                  onChange={(e) => setForm({ ...form, genre: e.target.value })}
                  className="input"
                  disabled={!track.is_owner}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("modal_edit.field.year")}>
                  <input
                    type="number"
                    min={0}
                    max={9999}
                    value={form.year}
                    onChange={(e) => setForm({ ...form, year: e.target.value })}
                    className="input"
                    disabled={!track.is_owner}
                  />
                </Field>
                <Field label={t("modal_edit.field.track_no")}>
                  <input
                    type="number"
                    min={0}
                    max={9999}
                    value={form.track_no}
                    onChange={(e) => setForm({ ...form, track_no: e.target.value })}
                    className="input"
                    disabled={!track.is_owner}
                  />
                </Field>
              </div>
            </>
          )}

          {tab === 'lyrics' && <LyricsField track={track} />}

          {tab === 'share' && track.is_owner && <VisibilityField track={track} />}
        </div>

        {/* Footer */}
        {err && (
          <div className="px-6 pb-2 shrink-0">
            <div className="text-sm text-red-400 bg-red-950/30 p-2 rounded">{err}</div>
          </div>
        )}
        <div className="px-6 pb-5 pt-3 shrink-0 flex justify-end gap-2 border-t border-black/60">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-full bezel text-sm text-zinc-300 hover:text-white"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-1.5 rounded-full bezel glow-text glow-ring text-sm disabled:opacity-50"
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
    </ModalShell>
  );
}

function ModalTabButton({
  id,
  active,
  setTab,
  children,
}: {
  id: ModalTab;
  active: ModalTab;
  setTab: (t: ModalTab) => void;
  children: React.ReactNode;
}) {
  const isActive = active === id;
  return (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
        isActive
          ? 'border-pink-500 glow-text'
          : 'border-transparent text-zinc-400 hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Visibility / sharing controls for the track owner.
 *
 *  - "公开" toggle: any logged-in user can then see this track.
 *  - User picker: a checklist of all other users; checked users get this
 *    track via track_shares. PUT-replace semantics — the displayed checked
 *    set is the current truth, save commits it.
 */
function VisibilityField({ track }: { track: Track }) {
  return (
    <UserSharePanel
      maxListHeight="max-h-32"
      loadInitial={async () => {
        const r = await api.getTrackShares(track.id);
        return { is_public: track.is_public, shared_with: r.shared_with };
      }}
      setVisibility={(pub) => api.setTrackVisibility(track.id, pub)}
      setShares={(ids) => api.setTrackShares(track.id, ids)}
    />
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs uppercase text-zinc-500 mb-1 block">{label}</span>
      {children}
    </label>
  );
}

/**
 * Lyrics manager for EditTrackModal. Independent from the metadata Save
 * button — uploads/deletes hit the API immediately so users can iterate
 * (delete a wrong auto-fetched .lrc, paste the right one, see the result
 * without saving the rest of the form).
 *
 * Three ways to get lyrics:
 *   1. Auto fetch: server picks best candidate across all sources
 *   2. Search & select: list candidates from all sources, user picks
 *   3. Manual upload / paste
 */
type LyricTab = 'auto' | 'search' | 'upload' | 'paste';

function LyricsField({ track }: { track: Track }) {
  const t = useT();
  const trackId = track.id;
  const [status, setStatus] = useState<'loading' | 'absent' | 'present' | 'error'>('loading');
  const [source, setSource] = useState<string | null>(null);
  const [hasTs, setHasTs] = useState(false);
  const [busy, setBusy] = useState(false);
  // Active tab — null means no panel is open. Replaces the old separate
  // `pasting` / `searching` booleans so only ONE panel can be open at a
  // time and the modal doesn't grow vertically without bound.
  const [tab, setTab] = useState<LyricTab | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Search-tab-specific state
  const [searchLoading, setSearchLoading] = useState(false);
  const [candidates, setCandidates] = useState<LyricCandidate[]>([]);
  const [previewing, setPreviewing] = useState<{
    cand: LyricCandidate;
    text: string | null;
    loading: boolean;
  } | null>(null);

  // Load status on mount / when track changes
  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    api
      .getLyrics(trackId)
      .then((r) => {
        if (cancelled) return;
        if (r.found && r.synced) {
          setStatus('present');
          setSource(r.source ?? null);
          setHasTs(/\[\d+:\d{1,2}(?:[.:]\d{1,3})?\]/.test(r.synced));
        } else {
          setStatus('absent');
          setSource(null);
          setHasTs(false);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [trackId]);

  async function uploadFile(file: File) {
    if (busy) return;
    if (file.size > 256 * 1024) {
      setMsg(t('lyrics.upload.too_large'));
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const text = await file.text();
      const r = await api.setLyrics(trackId, text);
      if (r.ok) {
        setStatus('present');
        setSource('manual');
        setHasTs(!!r.has_timestamps);
        const tsSuffix = r.has_timestamps
          ? t('lyrics.auto.timestamps_yes')
          : t('lyrics.auto.timestamps_no');
        setMsg(t('lyrics.upload.success', { ts: tsSuffix }));
      }
    } catch (err: any) {
      setMsg(t('lyrics.upload.failed', { err: err?.message ?? String(err) }));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function savePasted() {
    if (busy || !pasteText.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.setLyrics(trackId, pasteText);
      if (r.ok) {
        setStatus('present');
        setSource('manual');
        setHasTs(!!r.has_timestamps);
        setTab(null);
        setPasteText('');
        const tsSuffix = r.has_timestamps
          ? t('lyrics.auto.timestamps_yes')
          : t('lyrics.auto.timestamps_no');
        setMsg(t('lyrics.paste.success', { ts: tsSuffix }));
      }
    } catch (err: any) {
      setMsg(t('lyrics.paste.failed', { err: err?.message ?? String(err) }));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    if (!confirm(t('lyrics.delete.confirm'))) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.deleteLyrics(trackId);
      setStatus('absent');
      setSource(null);
      setHasTs(false);
      setMsg(t('lyrics.delete.deleted'));
    } catch (err: any) {
      setMsg(t('lyrics.delete.failed', { err: err?.message ?? String(err) }));
    } finally {
      setBusy(false);
    }
  }

  async function autoFetch() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.fetchLyrics(trackId);
      if (r.ok && r.found) {
        setStatus('present');
        setSource(r.source ?? null);
        setHasTs(!!r.has_timestamps);
        const tsSuffix = r.has_timestamps
          ? t('lyrics.auto.timestamps_yes')
          : t('lyrics.auto.timestamps_no');
        setMsg(t('lyrics.auto.fetched', { source: r.source ?? '?', ts: tsSuffix }));
      } else {
        setMsg(t('lyrics.auto.no_results'));
      }
    } catch (err: any) {
      setMsg(t('lyrics.auto.failed', { err: err?.message ?? String(err) }));
    } finally {
      setBusy(false);
    }
  }

  async function runSearch() {
    setSearchLoading(true);
    setCandidates([]);
    setPreviewing(null);
    setMsg(null);
    try {
      const r = await api.searchLyrics(trackId);
      setCandidates(r.candidates);
      if (r.count === 0) setMsg(t('lyrics.search.no_source_returned'));
    } catch (err: any) {
      setMsg(t('lyrics.search.search_failed', { err: err?.message ?? String(err) }));
    } finally {
      setSearchLoading(false);
    }
  }

  async function previewCandidate(cand: LyricCandidate) {
    setPreviewing({ cand, text: null, loading: true });
    try {
      const r = await api.previewLyric(cand.source, cand.ext_id);
      setPreviewing({
        cand,
        text: r.synced ?? r.plain ?? t('lyrics.search.fetch_select_failed'),
        loading: false,
      });
    } catch (err: any) {
      setPreviewing({
        cand,
        text: t('lyrics.search.preview_failed', { err: err?.message ?? String(err) }),
        loading: false,
      });
    }
  }

  async function selectCandidate(cand: LyricCandidate) {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.selectLyric(trackId, cand.source, cand.ext_id);
      if (r.ok && r.found) {
        setStatus('present');
        setSource(cand.source);
        setHasTs(!!r.has_timestamps);
        const tsSuffix = r.has_timestamps
          ? t('lyrics.auto.timestamps_yes')
          : t('lyrics.auto.timestamps_no');
        setMsg(t('lyrics.select.used', { source: cand.source, ts: tsSuffix }));
        setTab(null);
        setPreviewing(null);
      } else {
        setMsg(t('lyrics.search.fetch_select_failed'));
      }
    } catch (err: any) {
      setMsg(t('share.save_failed', { err: err?.message ?? String(err) }));
    } finally {
      setBusy(false);
    }
  }

  const statusLine =
    status === 'loading'
      ? t('lyrics.status.loading')
      : status === 'present'
        ? hasTs
          ? t('lyrics.status.present_synced', { source: source ?? 'unknown' })
          : t('lyrics.status.present_plain', { source: source ?? 'unknown' })
        : status === 'absent'
          ? t('lyrics.status.absent')
          : t('lyrics.status.error');

  function pickTab(tabId: LyricTab) {
    if (tab === tabId) {
      setTab(null);
      return;
    }
    setTab(tabId);
    setMsg(null);
    if (tabId === 'search' && candidates.length === 0) {
      // Auto-fire search when first opening the tab so the user sees
      // candidates immediately.
      runSearch();
    }
    if (tabId === 'upload') {
      // Trigger file picker right away — most users come to this tab
      // already wanting to pick a file.
      setTimeout(() => fileRef.current?.click(), 0);
    }
  }

  const tabBtnClass = (tabId: LyricTab) =>
    `px-3 py-1.5 rounded-full bezel text-xs disabled:opacity-50 ${
      tab === tabId ? 'glow-text glow-ring' : 'text-zinc-300 hover:text-white'
    }`;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-400 flex-1">{statusLine}</span>
        {status === 'present' && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="px-3 py-1 rounded-full bezel text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
          >
            {t('common.delete')}
          </button>
        )}
      </div>

      {/* Tab strip — clicking an inactive tab opens its panel; clicking the
          active tab closes it. Only one panel is visible at a time, in a
          fixed-height scrollable area below, so the rest of the form
          never gets pushed off-screen. */}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => pickTab('auto')} disabled={busy} className={tabBtnClass('auto')}>
          {t('lyrics.tab.auto')}
        </button>
        <button type="button" onClick={() => pickTab('search')} disabled={busy} className={tabBtnClass('search')}>
          {t('lyrics.tab.search')}
        </button>
        <button type="button" onClick={() => pickTab('upload')} disabled={busy} className={tabBtnClass('upload')}>
          {t('lyrics.tab.upload')}
        </button>
        <button type="button" onClick={() => pickTab('paste')} disabled={busy} className={tabBtnClass('paste')}>
          {t('lyrics.tab.paste')}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".lrc,.txt,text/plain"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) uploadFile(f);
        }}
      />

      {tab && (
        <div
          className="rounded-lg border border-zinc-800 bg-black/30 p-3 space-y-2"
          style={{ maxHeight: 320, overflow: 'auto' }}
        >
          {tab === 'auto' && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-400">{t('lyrics.auto.description')}</p>
              <button
                type="button"
                onClick={autoFetch}
                disabled={busy}
                className="px-3 py-1.5 rounded-full bezel glow-text glow-ring text-xs disabled:opacity-50"
              >
                {busy ? t('lyrics.auto.processing') : t('lyrics.auto.fetch_now')}
              </button>
            </div>
          )}

          {tab === 'search' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">{t('lyrics.search.description')}</span>
                <button
                  type="button"
                  onClick={runSearch}
                  disabled={busy || searchLoading}
                  className="px-2.5 py-1 rounded-full bezel text-[11px] text-zinc-300 hover:text-white disabled:opacity-50"
                >
                  {searchLoading ? t('lyrics.search.searching') : t('lyrics.search.research')}
                </button>
              </div>
              <SearchPanel
                loading={searchLoading}
                candidates={candidates}
                targetDuration={track.duration_sec}
                previewing={previewing}
                onPreview={previewCandidate}
                onUse={selectCandidate}
                onClosePreview={() => setPreviewing(null)}
              />
            </div>
          )}

          {tab === 'upload' && (
            <div className="space-y-2">
              <p className="text-xs text-zinc-400">{t('lyrics.upload.description')}</p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="px-3 py-1.5 rounded-full bezel glow-text glow-ring text-xs disabled:opacity-50"
              >
                {busy ? t('lyrics.upload.uploading') : t('lyrics.upload.choose_file')}
              </button>
            </div>
          )}

          {tab === 'paste' && (
            <div className="space-y-2">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                rows={6}
                placeholder={t('lyrics.paste.placeholder')}
                className="input font-mono text-xs w-full"
                style={{ minHeight: 120, resize: 'vertical' }}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={savePasted}
                  disabled={busy || !pasteText.trim()}
                  className="px-3 py-1.5 rounded-full bezel glow-text glow-ring text-xs disabled:opacity-50"
                >
                  {busy ? t('lyrics.paste.saving') : t('lyrics.paste.save')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {msg && <div className="text-xs text-zinc-500">{msg}</div>}
    </div>
  );
}

/* ----------------------------- Search panel ----------------------------- */

// Source display names — kept in English (recognizable transliterations
// for non-CJK users) since the codes are also used by the server.
const SOURCE_LABEL: Record<string, string> = {
  lrclib: 'LRCLIB',
  netease: 'Netease',
  qq: 'QQ Music',
  kugou: 'Kugou',
};

const SOURCE_COLOR: Record<string, string> = {
  lrclib: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  netease: 'bg-red-500/15 text-red-300 border-red-500/30',
  qq: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  kugou: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
};

function fmtSec(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function SearchPanel({
  loading,
  candidates,
  targetDuration,
  previewing,
  onPreview,
  onUse,
  onClosePreview,
}: {
  loading: boolean;
  candidates: LyricCandidate[];
  targetDuration: number | null;
  previewing: { cand: LyricCandidate; text: string | null; loading: boolean } | null;
  onPreview: (c: LyricCandidate) => void;
  onUse: (c: LyricCandidate) => void;
  onClosePreview: () => void;
}) {
  const t = useT();
  return (
    <div
      className="rounded-lg border border-zinc-800 bg-black/30 p-2 space-y-2"
      style={{ maxHeight: 380, overflow: 'auto' }}
    >
      {loading && <div className="text-xs text-zinc-500 px-2 py-1">{t('lyrics.search.searching')}</div>}
      {!loading && candidates.length === 0 && (
        <div className="text-xs text-zinc-500 px-2 py-1">{t('lyrics.search.no_results')}</div>
      )}
      {!loading && candidates.length > 0 && (
        <div className="text-[10px] text-zinc-500 px-1">
          {t('lyrics.search.count_hint', { count: candidates.length })}
        </div>
      )}
      <ul className="space-y-1">
        {candidates.map((c) => {
          const dt =
            targetDuration && c.duration_sec
              ? Math.abs(c.duration_sec - targetDuration)
              : null;
          const mismatch = dt !== null && dt > 5;
          return (
            <li
              key={`${c.source}:${c.ext_id}`}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.03]"
            >
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded border ${SOURCE_COLOR[c.source] ?? ''}`}
              >
                {SOURCE_LABEL[c.source] ?? c.source}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs truncate text-zinc-200">
                  {c.title || '—'}
                  {c.artist && (
                    <span className="text-zinc-500"> · {c.artist}</span>
                  )}
                </div>
                <div className="text-[10px] text-zinc-500 truncate">
                  {c.album || '—'} ·{' '}
                  <span className={mismatch ? 'text-amber-400' : ''}>
                    {fmtSec(c.duration_sec)}
                    {dt !== null && (
                      <span className="text-zinc-600">
                        {' '}
                        ({dt > 0
                          ? t('lyrics.search.duration_diff', { diff: Math.round(dt) })
                          : t('lyrics.search.duration_match')})
                      </span>
                    )}
                  </span>
                  {!c.has_synced && (
                    <span className="text-zinc-600"> · {t('lyrics.search.plain_text')}</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onPreview(c)}
                className="px-2 py-1 rounded-full bezel text-[10px] text-zinc-300 hover:text-white shrink-0"
              >
                {t('lyrics.search.preview')}
              </button>
              <button
                type="button"
                onClick={() => onUse(c)}
                className="px-2 py-1 rounded-full bezel glow-text glow-ring text-[10px] shrink-0"
              >
                {t('lyrics.search.use')}
              </button>
            </li>
          );
        })}
      </ul>

      {previewing && (
        <ModalShell
          onClose={onClosePreview}
          maxWidth="max-w-xl"
          className="p-4 space-y-3 max-h-[80vh] flex flex-col"
          backdropClassName="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
        >
            <div className="flex items-baseline gap-2">
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded border ${SOURCE_COLOR[previewing.cand.source] ?? ''}`}
              >
                {SOURCE_LABEL[previewing.cand.source] ?? previewing.cand.source}
              </span>
              <span className="text-sm text-zinc-200 truncate">
                {previewing.cand.title}
                {previewing.cand.artist && (
                  <span className="text-zinc-500"> · {previewing.cand.artist}</span>
                )}
              </span>
            </div>
            <pre
              className="flex-1 overflow-auto text-xs font-mono whitespace-pre-wrap text-zinc-300 bg-black/40 rounded p-3"
              style={{ minHeight: 200 }}
            >
              {previewing.loading ? t('lyrics.search.preview_loading') : previewing.text}
            </pre>
            <div className="flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={onClosePreview}
                className="px-3 py-1.5 rounded-full bezel text-xs text-zinc-300 hover:text-white"
              >
                {t('common.close')}
              </button>
              <button
                type="button"
                onClick={() => onUse(previewing.cand)}
                disabled={previewing.loading || !previewing.text}
                className="px-3 py-1.5 rounded-full bezel glow-text glow-ring text-xs disabled:opacity-50"
              >
                {t('lyrics.search.use_this')}
              </button>
            </div>
        </ModalShell>
      )}
    </div>
  );
}
