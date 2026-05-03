/**
 * Cover art picker for a track. Three modes:
 *  - Show current cover with "Remove" button
 *  - "Upload" file picker for a local image
 *  - "Search online" → iTunes proxy, click any result tile to save it
 *
 * Each successful action calls onChanged(newCoverUrl) so the parent
 * (EditTrackModal) can update its preview.
 */
import { useEffect, useRef, useState } from 'react';
import { api, type CoverSearchResult } from '../api';
import type { Track } from '../types';
import CoverThumb from './CoverThumb';

interface Props {
  track: Track;
  onChanged: (newCoverUrl: string | null) => void;
}

export default function CoverPicker({ track, onChanged }: Props) {
  const [coverUrl, setCoverUrl] = useState<string | null>(track.cover_url);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CoverSearchResult[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Auto-suggest query from artist + album
  useEffect(() => {
    const initial = [track.artist, track.album].filter(Boolean).join(' ').trim();
    setQuery(initial || track.title || '');
  }, [track.id, track.artist, track.album, track.title]);

  async function handleUpload(f: File) {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.uploadCover(track.id, f);
      setCoverUrl(r.cover_url);
      onChanged(r.cover_url);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    setErr(null);
    try {
      await api.deleteCover(track.id);
      setCoverUrl(null);
      onChanged(null);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSearch() {
    if (!query.trim()) return;
    setBusy(true);
    setErr(null);
    setResults([]);
    setSearching(true);
    try {
      const r = await api.searchCovers(query.trim());
      setResults(r.results);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function handlePick(r: CoverSearchResult) {
    if (!r.full_url) return;
    setBusy(true);
    setErr(null);
    try {
      const out = await api.setCoverFromUrl(track.id, r.full_url);
      setCoverUrl(out.cover_url);
      onChanged(out.cover_url);
      setSearching(false);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3">
        <CoverThumb src={coverUrl} size={72} />
        <div className="flex-1 space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="text-xs px-3 py-1 rounded-full bezel text-zinc-300 hover:text-white disabled:opacity-50"
            >
              Upload…
            </button>
            <button
              type="button"
              onClick={() => setSearching((s) => !s)}
              disabled={busy}
              className="text-xs px-3 py-1 rounded-full bezel text-zinc-300 hover:text-white disabled:opacity-50"
            >
              {searching ? 'Hide search' : 'Search online'}
            </button>
            {coverUrl && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={busy}
                className="text-xs px-3 py-1 rounded-full bezel text-red-400 hover:text-red-300 disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
          {err && <div className="text-xs text-red-400">{err}</div>}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              if (fileRef.current) fileRef.current.value = '';
            }}
          />
        </div>
      </div>

      {searching && (
        // Note: NOT a <form> — this lives inside EditTrackModal's outer
        // <form>, and nested forms cause the inner submit to trigger the
        // outer form's onSubmit (which closes the modal). Using a div +
        // explicit button type=button + Enter key handler instead.
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSearch();
                }
              }}
              placeholder="Artist + album (e.g. Pink Floyd Dark Side)"
              className="input text-xs"
            />
            <button
              type="button"
              onClick={handleSearch}
              disabled={busy || !query.trim()}
              className="text-xs px-3 py-1 rounded-full bezel glow-text glow-ring disabled:opacity-50"
            >
              {busy ? '…' : 'Search'}
            </button>
          </div>
          {results.length > 0 && (
            <div className="grid grid-cols-4 gap-2 max-h-56 overflow-auto p-1 bg-zinc-950/50 rounded">
              {results.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handlePick(r)}
                  disabled={busy || !r.full_url}
                  title={[r.artist, r.album].filter(Boolean).join(' — ')}
                  className="group flex flex-col items-stretch text-left hover:ring-2 hover:ring-blue-500 rounded overflow-hidden disabled:opacity-50"
                >
                  {r.thumbnail_url ? (
                    <img src={r.thumbnail_url} className="w-full h-20 object-cover" />
                  ) : (
                    <div className="w-full h-20 bg-zinc-800" />
                  )}
                  <div className="px-1 py-0.5 text-[10px] truncate">{r.album ?? '—'}</div>
                  <div className="px-1 pb-0.5 text-[10px] text-zinc-500 truncate">
                    {r.artist ?? '—'}
                  </div>
                </button>
              ))}
            </div>
          )}
          {results.length === 0 && !busy && (
            <div className="text-xs text-zinc-500">
              Tip: try just the album name or "artist + album". Source: iTunes.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
