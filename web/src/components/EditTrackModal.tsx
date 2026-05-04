import { useEffect, useRef, useState } from 'react';
import { api, type LyricCandidate, type TrackEdit } from '../api';
import type { Track } from '../types';
import StarRating from './StarRating';
import CoverPicker from './CoverPicker';

interface Props {
  track: Track;
  onClose: () => void;
  onSaved: (updated: Track) => void;
}

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
      const payload: TrackEdit = {
        title: form.title.trim() || null,
        artist: form.artist.trim() || null,
        album: form.album.trim() || null,
        genre: form.genre.trim() || null,
        year: form.year.trim() ? Number(form.year) : null,
        track_no: form.track_no.trim() ? Number(form.track_no) : null,
        rating: form.rating,
      };
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
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <form
        onSubmit={onSave}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-xl shadow-2xl p-6 space-y-4"
        style={{
          background: 'linear-gradient(180deg, #232325 0%, #18181a 100%)',
          border: '1px solid #050506',
          boxShadow:
            '0 20px 60px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.06), 0 0 30px rgba(255,45,181,0.08)',
        }}
      >
        <div>
          <h2 className="text-lg font-semibold">Edit track</h2>
          <p className="text-xs text-zinc-500 mt-1 truncate">{track.rel_path}</p>
          <p className="text-xs text-zinc-600 mt-1">
            Edits go to the database only — the MP3 file is never modified.
          </p>
        </div>

        <Field label="Cover">
          <CoverPicker track={{ ...track, cover_url: coverUrl }} onChanged={setCoverUrl} />
        </Field>

        <Field label="Lyrics">
          <LyricsField track={track} />
        </Field>

        <Field label="Rating">
          <StarRating
            value={form.rating}
            onChange={(v) => setForm({ ...form, rating: v })}
            size="md"
          />
        </Field>

        <Field label="Title">
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="input"
            autoFocus
          />
        </Field>
        <Field label="Artist">
          <input
            type="text"
            value={form.artist}
            onChange={(e) => setForm({ ...form, artist: e.target.value })}
            className="input"
          />
        </Field>
        <Field label="Album">
          <input
            type="text"
            value={form.album}
            onChange={(e) => setForm({ ...form, album: e.target.value })}
            className="input"
          />
        </Field>
        <Field label="Genre">
          <input
            type="text"
            value={form.genre}
            onChange={(e) => setForm({ ...form, genre: e.target.value })}
            className="input"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Year">
            <input
              type="number"
              min={0}
              max={9999}
              value={form.year}
              onChange={(e) => setForm({ ...form, year: e.target.value })}
              className="input"
            />
          </Field>
          <Field label="Track #">
            <input
              type="number"
              min={0}
              max={9999}
              value={form.track_no}
              onChange={(e) => setForm({ ...form, track_no: e.target.value })}
              className="input"
            />
          </Field>
        </div>

        {err && <div className="text-sm text-red-400 bg-red-950/30 p-2 rounded">{err}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-full bezel text-sm text-zinc-300 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-1.5 rounded-full bezel glow-text glow-ring text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
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
function LyricsField({ track }: { track: Track }) {
  const trackId = track.id;
  const [status, setStatus] = useState<'loading' | 'absent' | 'present' | 'error'>('loading');
  const [source, setSource] = useState<string | null>(null);
  const [hasTs, setHasTs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Search panel state
  const [searching, setSearching] = useState(false);  // panel open?
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
      setMsg('文件超过 256KB 上限');
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
        setMsg(`上传成功${r.has_timestamps ? '（带时间戳）' : '（纯文本）'}`);
      }
    } catch (err: any) {
      setMsg(`上传失败：${err?.message ?? err}`);
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
        setPasting(false);
        setPasteText('');
        setMsg(`保存成功${r.has_timestamps ? '（带时间戳）' : '（纯文本）'}`);
      }
    } catch (err: any) {
      setMsg(`保存失败：${err?.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    if (!confirm('确认删除这首歌的歌词文件？')) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.deleteLyrics(trackId);
      setStatus('absent');
      setSource(null);
      setHasTs(false);
      setMsg('已删除');
    } catch (err: any) {
      setMsg(`删除失败：${err?.message ?? err}`);
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
        setMsg(`已获取（${r.source}${r.has_timestamps ? ' · 带时间戳' : ' · 纯文本'}）`);
      } else {
        setMsg('所有源都没找到匹配的歌词');
      }
    } catch (err: any) {
      setMsg(`获取失败：${err?.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }

  async function openSearch() {
    setSearching(true);
    setSearchLoading(true);
    setCandidates([]);
    setPreviewing(null);
    setMsg(null);
    try {
      const r = await api.searchLyrics(trackId);
      setCandidates(r.candidates);
      if (r.count === 0) setMsg('没有任何源返回结果');
    } catch (err: any) {
      setMsg(`搜索失败：${err?.message ?? err}`);
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
        text: r.synced ?? r.plain ?? '（这一条获取失败或为空）',
        loading: false,
      });
    } catch (err: any) {
      setPreviewing({
        cand,
        text: `预览失败：${err?.message ?? err}`,
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
        setMsg(
          `已使用 ${cand.source} 的歌词${r.has_timestamps ? '（带时间戳）' : '（纯文本）'}`,
        );
        setSearching(false);
        setPreviewing(null);
      } else {
        setMsg('该候选项获取失败');
      }
    } catch (err: any) {
      setMsg(`保存失败：${err?.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }

  const statusLine =
    status === 'loading'
      ? '加载中…'
      : status === 'present'
        ? `已下载 · ${source ?? 'unknown'} · ${hasTs ? '带时间戳' : '纯文本'}`
        : status === 'absent'
          ? '暂无歌词'
          : '加载失败';

  return (
    <div className="space-y-2">
      <div className="text-xs text-zinc-400">{statusLine}</div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={autoFetch}
          disabled={busy}
          className="px-3 py-1.5 rounded-full bezel glow-text glow-ring text-xs disabled:opacity-50"
        >
          {busy ? '处理中…' : '自动获取'}
        </button>
        <button
          type="button"
          onClick={() => (searching ? setSearching(false) : openSearch())}
          disabled={busy}
          className="px-3 py-1.5 rounded-full bezel text-xs text-zinc-300 hover:text-white disabled:opacity-50"
        >
          {searching ? '关闭搜索' : '搜索并选择'}
        </button>
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
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="px-3 py-1.5 rounded-full bezel text-xs text-zinc-300 hover:text-white disabled:opacity-50"
        >
          上传 .lrc
        </button>
        <button
          type="button"
          onClick={() => setPasting((v) => !v)}
          disabled={busy}
          className="px-3 py-1.5 rounded-full bezel text-xs text-zinc-300 hover:text-white disabled:opacity-50"
        >
          {pasting ? '取消粘贴' : '粘贴文本'}
        </button>
        {status === 'present' && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="px-3 py-1.5 rounded-full bezel text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
          >
            删除
          </button>
        )}
      </div>

      {pasting && (
        <div className="space-y-2">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={6}
            placeholder="粘贴 LRC 文本，例如：&#10;[00:12.34]第一句&#10;[00:18.20]第二句"
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
              {busy ? '保存中…' : '保存歌词'}
            </button>
          </div>
        </div>
      )}

      {searching && (
        <SearchPanel
          loading={searchLoading}
          candidates={candidates}
          targetDuration={track.duration_sec}
          previewing={previewing}
          onPreview={previewCandidate}
          onUse={selectCandidate}
          onClosePreview={() => setPreviewing(null)}
        />
      )}

      {msg && <div className="text-xs text-zinc-500">{msg}</div>}
    </div>
  );
}

/* ----------------------------- Search panel ----------------------------- */

const SOURCE_LABEL: Record<string, string> = {
  lrclib: 'LRCLIB',
  netease: '网易云',
  qq: 'QQ 音乐',
  kugou: '酷狗',
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
  return (
    <div
      className="rounded-lg border border-zinc-800 bg-black/30 p-2 space-y-2"
      style={{ maxHeight: 380, overflow: 'auto' }}
    >
      {loading && <div className="text-xs text-zinc-500 px-2 py-1">搜索中…</div>}
      {!loading && candidates.length === 0 && (
        <div className="text-xs text-zinc-500 px-2 py-1">没有结果</div>
      )}
      {!loading && candidates.length > 0 && (
        <div className="text-[10px] text-zinc-500 px-1">
          共 {candidates.length} 条 · 时长偏差超过 ±5 秒会标黄
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
                  {c.title || '（无标题）'}
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
                        {' '}({dt > 0 ? '差 ' + Math.round(dt) + 's' : '完全匹配'})
                      </span>
                    )}
                  </span>
                  {!c.has_synced && (
                    <span className="text-zinc-600"> · 纯文本</span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onPreview(c)}
                className="px-2 py-1 rounded-full bezel text-[10px] text-zinc-300 hover:text-white shrink-0"
              >
                预览
              </button>
              <button
                type="button"
                onClick={() => onUse(c)}
                className="px-2 py-1 rounded-full bezel glow-text glow-ring text-[10px] shrink-0"
              >
                使用
              </button>
            </li>
          );
        })}
      </ul>

      {previewing && (
        <div
          className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
          onClick={onClosePreview}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl rounded-xl shadow-2xl p-4 space-y-3 max-h-[80vh] flex flex-col"
            style={{
              background: 'linear-gradient(180deg, #232325 0%, #18181a 100%)',
              border: '1px solid #050506',
            }}
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
              {previewing.loading ? '加载中…' : previewing.text}
            </pre>
            <div className="flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={onClosePreview}
                className="px-3 py-1.5 rounded-full bezel text-xs text-zinc-300 hover:text-white"
              >
                关闭
              </button>
              <button
                type="button"
                onClick={() => onUse(previewing.cand)}
                disabled={previewing.loading || !previewing.text}
                className="px-3 py-1.5 rounded-full bezel glow-text glow-ring text-xs disabled:opacity-50"
              >
                使用这条
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
