import { useEffect, useState } from 'react';
import { api, type TrackEdit } from '../api';
import type { Track } from '../types';

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
  });
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
      };
      const updated = await api.updateTrack(track.id, payload);
      onSaved(updated);
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
        className="w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl p-6 space-y-4"
      >
        <div>
          <h2 className="text-lg font-semibold">Edit track</h2>
          <p className="text-xs text-zinc-500 mt-1 truncate">{track.rel_path}</p>
          <p className="text-xs text-zinc-600 mt-1">
            Edits go to the database only — the MP3 file is never modified.
          </p>
        </div>

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
            className="px-4 py-1.5 rounded text-sm bg-zinc-800 hover:bg-zinc-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-1.5 rounded text-sm bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
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
