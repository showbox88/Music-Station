import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { Track } from '../types';
import EditTrackModal from './EditTrackModal';

function formatDuration(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatBytes(b: number): string {
  if (b > 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}

interface Props {
  refreshKey: number;
  onChanged?: () => void;
}

export default function TrackList({ refreshKey, onChanged }: Props) {
  const [q, setQ] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Track | null>(null);

  // Debounce search
  const [debouncedQ, setDebouncedQ] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    api
      .listTracks({ q: debouncedQ || undefined, limit: 500, sort: 'title', dir: 'asc' })
      .then((res) => {
        if (cancelled) return;
        setTracks(res.tracks);
        setTotal(res.total);
      })
      .catch((e) => !cancelled && setErr(String(e?.message ?? e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, refreshKey]);

  const showing = useMemo(() => tracks.length, [tracks]);

  async function onDelete(t: Track) {
    if (!confirm(`Delete "${t.title || t.rel_path}"?\n\nThis removes the file from disk and the track from the library.`)) {
      return;
    }
    try {
      await api.deleteTrack(t.id);
      setTracks((prev) => prev.filter((x) => x.id !== t.id));
      setTotal((n) => n - 1);
      onChanged?.();
    } catch (e: any) {
      alert(`Delete failed: ${e?.message ?? e}`);
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-6 py-3 border-b border-zinc-800 flex items-center gap-3 bg-zinc-900/50">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title / artist / album / path…"
          className="flex-1 max-w-md px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 focus:border-zinc-500 outline-none text-sm"
        />
        <span className="text-xs text-zinc-500">
          {loading ? 'Loading…' : `${showing} / ${total}`}
        </span>
      </div>

      {err && (
        <div className="px-6 py-3 text-sm text-red-400 bg-red-950/30 border-b border-red-900">
          {err}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-zinc-500 sticky top-0 bg-zinc-950">
            <tr className="border-b border-zinc-800">
              <th className="text-left font-medium py-2 pl-6 w-10">▶</th>
              <th className="text-left font-medium py-2">Title</th>
              <th className="text-left font-medium py-2">Artist</th>
              <th className="text-left font-medium py-2">Album</th>
              <th className="text-left font-medium py-2">Genre</th>
              <th className="text-right font-medium py-2 w-20">Duration</th>
              <th className="text-right font-medium py-2 w-20">Size</th>
              <th className="text-right font-medium py-2 pr-6 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {tracks.map((t) => (
              <tr
                key={t.id}
                className="border-b border-zinc-900 hover:bg-zinc-900/50"
              >
                <td className="pl-6">
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noreferrer"
                    title="Play in new tab"
                    className="inline-block w-6 h-6 leading-6 text-center rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-100"
                  >
                    ▶
                  </a>
                </td>
                <td className="py-2 pr-3 font-medium">
                  {t.last_edited_at && (
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 mr-2 align-middle"
                      title={`Edited ${t.last_edited_at}`}
                    />
                  )}
                  {t.title || '—'}
                </td>
                <td className="py-2 pr-3 text-zinc-400">{t.artist || '—'}</td>
                <td className="py-2 pr-3 text-zinc-400">{t.album || '—'}</td>
                <td className="py-2 pr-3 text-zinc-500">{t.genre || '—'}</td>
                <td className="py-2 pr-3 text-zinc-500 text-right tabular-nums">
                  {formatDuration(t.duration_sec)}
                </td>
                <td className="py-2 pr-3 text-zinc-500 text-right tabular-nums">
                  {formatBytes(t.size_bytes)}
                </td>
                <td className="pr-6 text-right whitespace-nowrap">
                  <button
                    onClick={() => setEditing(t)}
                    title="Edit metadata"
                    className="text-zinc-500 hover:text-zinc-100 px-2"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => onDelete(t)}
                    title="Delete (file + DB)"
                    className="text-zinc-500 hover:text-red-400 px-2"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {tracks.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="text-center py-12 text-zinc-500">
                  {debouncedQ ? `No tracks matching "${debouncedQ}"` : 'No tracks indexed yet. Drop MP3s into the music dir and click Rescan.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditTrackModal
          track={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setTracks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
          }}
        />
      )}
    </div>
  );
}
