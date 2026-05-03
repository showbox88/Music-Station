import { useEffect, useState } from 'react';
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
