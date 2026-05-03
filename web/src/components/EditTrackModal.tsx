import { useEffect, useRef, useState } from 'react';
import { api, type TrackEdit } from '../api';
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
          <LyricsField trackId={track.id} />
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
 */
function LyricsField({ trackId }: { trackId: number }) {
  const [status, setStatus] = useState<'loading' | 'absent' | 'present' | 'error'>('loading');
  const [source, setSource] = useState<string | null>(null);
  const [hasTs, setHasTs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

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
          上传 .lrc 文件
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

      {msg && <div className="text-xs text-zinc-500">{msg}</div>}
    </div>
  );
}
