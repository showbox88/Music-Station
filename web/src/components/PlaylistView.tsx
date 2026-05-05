/**
 * Single-playlist view: ordered tracks with ↑/↓ to reorder and × to remove.
 *
 * Reorder strategy: optimistic local swap + PUT /api/playlists/:id/order
 * with the new full order. If the server rejects, revert.
 */
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { PlaylistDetail, Track } from '../types';
import { usePlayer } from '../player/PlayerContext';
import StarRating from './StarRating';
import CoverThumb from './CoverThumb';
import EditTrackModal from './EditTrackModal';

interface Props {
  playlistId: number;
  refreshKey: number;
  onChanged: () => void;
}

function formatDuration(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function PlaylistView({ playlistId, refreshKey, onChanged }: Props) {
  const [data, setData] = useState<PlaylistDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Track | null>(null);
  const player = usePlayer();

  function load() {
    setLoading(true);
    setErr(null);
    api
      .getPlaylist(playlistId)
      .then(setData)
      .catch((e) => setErr(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }
  useEffect(load, [playlistId, refreshKey]);

  async function move(idx: number, dir: -1 | 1) {
    if (!data) return;
    const target = idx + dir;
    if (target < 0 || target >= data.tracks.length) return;
    const next = [...data.tracks];
    [next[idx], next[target]] = [next[target], next[idx]];
    const prev = data;
    setData({ ...data, tracks: next });
    try {
      await api.reorderPlaylist(playlistId, next.map((t) => t.id));
    } catch (e: any) {
      setErr(`Reorder failed: ${e?.message ?? e}`);
      setData(prev); // revert
    }
  }

  async function remove(t: Track) {
    if (!confirm(`Remove "${t.title || t.rel_path}" from this playlist?`)) return;
    try {
      await api.removeTrackFromPlaylist(playlistId, t.id);
      load();
      onChanged();
    } catch (e: any) {
      alert(String(e?.message ?? e));
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-6 py-3 border-b border-black/60 flex flex-wrap items-center justify-between gap-2"
        style={{ background: 'linear-gradient(180deg, #1c1c1e 0%, #18181a 100%)' }}>
        {data ? (
          <>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold truncate">
                {data.name}
                {!data.is_owner && (
                  <span
                    className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded border border-pink-500/30 bg-pink-500/10 text-pink-300 align-middle"
                    title={`所有者：${data.owner_display_name || data.owner_username}`}
                  >
                    {data.shared_with_me ? '分享自' : '公开 ·'}{' '}
                    {data.owner_display_name || data.owner_username}
                  </span>
                )}
                {data.is_owner && data.is_public && (
                  <span
                    className="ml-2 text-[10px] uppercase px-1.5 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 align-middle"
                    title="所有用户可见"
                  >
                    公开
                  </span>
                )}
              </h2>
              <div className="text-xs text-zinc-500">
                {data.tracks.length} track{data.tracks.length !== 1 ? 's' : ''}
                {data.description ? ` · ${data.description}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => data.tracks.length && player.playList(data.tracks, 0)}
                disabled={data.tracks.length === 0}
                className="px-4 py-1.5 rounded-full bezel glow-text glow-ring text-sm disabled:opacity-50"
              >
                ▶ Play
              </button>
              <button
                onClick={() => {
                  if (data.tracks.length === 0) return;
                  if (!player.shuffle) player.toggleShuffle();
                  player.playList(data.tracks, 0);
                }}
                disabled={data.tracks.length === 0}
                className="px-4 py-1.5 rounded-full bezel text-sm text-zinc-300 hover:text-white disabled:opacity-50"
              >
                🔀 Shuffle
              </button>
              {data.is_owner && (
                <PlaylistShareControls playlist={data} onChanged={load} />
              )}
            </div>
          </>
        ) : (
          <div className="text-sm text-zinc-500">{loading ? 'Loading…' : ''}</div>
        )}
      </div>

      {err && (
        <div className="px-6 py-3 text-sm text-red-400 bg-red-950/30 border-b border-red-900">
          {err}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-zinc-500 sticky top-0" style={{ background: '#141415' }}>
            <tr className="border-b border-black/60">
              <th className="text-left font-medium py-2 pl-6 w-12">#</th>
              <th className="text-left font-medium py-2 w-10">▶</th>
              <th className="text-left font-medium py-2 w-12"></th>
              <th className="text-left font-medium py-2">Title</th>
              <th className="text-left font-medium py-2">Artist</th>
              <th className="text-left font-medium py-2">Album</th>
              <th className="text-left font-medium py-2 w-24">Rating</th>
              <th className="text-right font-medium py-2 w-20">Duration</th>
              <th className="text-right font-medium py-2 pr-6 w-28"></th>
            </tr>
          </thead>
          <tbody>
            {data?.tracks.map((t, idx) => {
              const isPlaying = player.current?.id === t.id;
              return (
              <tr
                key={t.id}
                onDoubleClick={() => setEditing(t)}
                className={`border-b border-black/40 cursor-default select-none ${
                  isPlaying ? '' : 'hover:bg-white/[0.03]'
                }`}
                style={isPlaying ? { background: 'rgba(255, 45, 181, 0.06)' } : undefined}
              >
                <td className="hidden md:table-cell pl-6 text-zinc-500 tabular-nums">{idx + 1}</td>
                <td className="hidden md:table-cell">
                  <button
                    onClick={() => data && player.playList(data.tracks, idx)}
                    title={
                      isPlaying && player.isPlaying
                        ? 'Now playing'
                        : 'Play (queues this playlist)'
                    }
                    className={`inline-flex items-center justify-center w-7 h-7 rounded-full bezel ${
                      isPlaying ? 'glow-text glow-ring' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {isPlaying && player.isPlaying ? '♪' : '▶'}
                  </button>
                </td>
                <td className="py-1 pl-3 pr-2 md:pl-4">
                  <button
                    onClick={() => {
                      if (isPlaying) {
                        player.togglePlay();
                      } else if (data) {
                        player.playList(data.tracks, idx);
                      }
                    }}
                    title={
                      isPlaying
                        ? player.isPlaying
                          ? 'Pause'
                          : 'Resume'
                        : 'Play'
                    }
                    className="md:hidden relative block rounded overflow-hidden"
                    style={{ width: 56, height: 56 }}
                  >
                    <CoverThumb src={t.cover_url} size={56} />
                    <span
                      className="absolute inset-0 flex items-center justify-center pointer-events-none"
                      style={{ color: 'rgba(255,255,255,0.6)' }}
                    >
                      {isPlaying && player.isPlaying ? (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                          <rect x="6" y="5" width="4" height="14" />
                          <rect x="14" y="5" width="4" height="14" />
                        </svg>
                      ) : (
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </span>
                  </button>
                  <div className="hidden md:block">
                    <CoverThumb src={t.cover_url} size={56} />
                  </div>
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
                <td className="py-2 pr-3">
                  <StarRating value={t.rating} />
                </td>
                <td className="py-2 pr-3 text-zinc-500 text-right tabular-nums">
                  {formatDuration(t.duration_sec)}
                </td>
                <td className="pr-2 md:pr-4 text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1.5 md:gap-2">
                    {/* Reorder + remove only for the playlist owner —
                        non-owners can play but not modify the list. */}
                    {data?.is_owner && (
                      <>
                        <button
                          onClick={() => move(idx, -1)}
                          disabled={idx === 0}
                          title="Move up"
                          className="hidden md:flex w-8 h-8 rounded-full bezel items-center justify-center text-zinc-300 hover:text-white disabled:opacity-30"
                        >
                          ↑
                        </button>
                        <button
                          onClick={() => move(idx, 1)}
                          disabled={idx === (data?.tracks.length ?? 0) - 1}
                          title="Move down"
                          className="hidden md:flex w-8 h-8 rounded-full bezel items-center justify-center text-zinc-300 hover:text-white disabled:opacity-30"
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => remove(t)}
                          title="Remove from playlist"
                          className="w-8 h-8 rounded-full bezel flex items-center justify-center text-zinc-300 hover:text-red-400"
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                            <line x1="6" y1="6" x2="18" y2="18" />
                            <line x1="18" y1="6" x2="6" y2="18" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
            {data && data.tracks.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-12 text-zinc-500">
                  No tracks in this playlist yet. Switch to All Tracks and click + to add.
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
            // Patch local list so the row reflects the edit immediately
            setData((d) =>
              d
                ? { ...d, tracks: d.tracks.map((x) => (x.id === updated.id ? updated : x)) }
                : d,
            );
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/**
 * Visibility / share controls for a playlist owner. A button in the header
 * opens a modal: "公开" toggle + user checklist (replace semantics for the
 * share list). On change, calls onChanged() so the parent refreshes the
 * data (which updates the badge in the header + sidebar).
 */
function PlaylistShareControls({
  playlist,
  onChanged,
}: {
  playlist: PlaylistDetail;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-full bezel text-sm text-zinc-300 hover:text-white"
        title="可见性 / 分享"
      >
        🔗 分享
      </button>
      {open && (
        <PlaylistShareModal
          playlist={playlist}
          onClose={() => setOpen(false)}
          onChanged={onChanged}
        />
      )}
    </>
  );
}

function PlaylistShareModal({
  playlist,
  onClose,
  onChanged,
}: {
  playlist: PlaylistDetail;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [isPublic, setIsPublic] = useState(playlist.is_public);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<
    Array<{ id: number; username: string; display_name: string | null }>
  >([]);
  const [shared, setShared] = useState<Set<number>>(new Set());
  const [origShared, setOrigShared] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [savingShares, setSavingShares] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.shareCandidates(), api.getPlaylistShares(playlist.id)])
      .then(([cands, mine]) => {
        setCandidates(cands.users);
        const ids = new Set(mine.shared_with.map((u) => u.id));
        setShared(ids);
        setOrigShared(new Set(ids));
        setLoaded(true);
      })
      .catch((e: any) => setMsg(`加载失败：${e?.message ?? e}`));
  }, [playlist.id]);

  async function togglePublic() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.setPlaylistVisibility(playlist.id, !isPublic);
      setIsPublic(r.is_public);
      onChanged();
      setMsg(r.is_public ? '已设为公开' : '已设为私有');
    } catch (e: any) {
      setMsg(`保存失败：${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  }

  function toggleShare(id: number) {
    setShared((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const dirty =
    shared.size !== origShared.size ||
    [...shared].some((id) => !origShared.has(id));

  async function saveShares() {
    if (savingShares || !dirty) return;
    setSavingShares(true);
    setMsg(null);
    try {
      await api.setPlaylistShares(playlist.id, [...shared]);
      setOrigShared(new Set(shared));
      onChanged();
      setMsg(`已更新分享列表（${shared.size} 人）`);
    } catch (e: any) {
      setMsg(`保存失败：${e?.message ?? e}`);
    } finally {
      setSavingShares(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl shadow-2xl p-6 space-y-3"
        style={{
          background: 'linear-gradient(180deg, #232325 0%, #18181a 100%)',
          border: '1px solid #050506',
        }}
      >
        <div>
          <h2 className="text-base font-semibold">分享 “{playlist.name}”</h2>
          <p className="text-xs text-zinc-500 mt-1">
            列表对别人可见时，列表里的歌曲也跟着可见（即使是私有歌）。
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-zinc-200">
          <input
            type="checkbox"
            checked={isPublic}
            onChange={togglePublic}
            disabled={busy}
          />
          公开（所有登录用户都能看到）
        </label>

        <div className="text-xs text-zinc-500">或者只分享给特定用户：</div>

        {!loaded ? (
          <div className="text-xs text-zinc-500">加载用户列表…</div>
        ) : candidates.length === 0 ? (
          <div className="text-xs text-zinc-600">暂无其他用户。</div>
        ) : (
          <div className="max-h-48 overflow-auto rounded border border-zinc-800 bg-black/30 p-1.5 space-y-0.5">
            {candidates.map((u) => (
              <label
                key={u.id}
                className="flex items-center gap-2 text-sm text-zinc-300 px-1.5 py-1 rounded hover:bg-white/5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={shared.has(u.id)}
                  onChange={() => toggleShare(u.id)}
                />
                <span className="truncate">
                  {u.display_name || u.username}
                  <span className="text-zinc-600 ml-1">@{u.username}</span>
                </span>
              </label>
            ))}
          </div>
        )}

        {msg && <div className="text-xs text-zinc-500">{msg}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-full bezel text-sm text-zinc-300 hover:text-white"
          >
            关闭
          </button>
          {loaded && candidates.length > 0 && (
            <button
              type="button"
              onClick={saveShares}
              disabled={!dirty || savingShares}
              className="px-4 py-1.5 rounded-full bezel glow-text glow-ring text-sm disabled:opacity-40"
            >
              {savingShares ? '保存中…' : dirty ? '保存分享列表' : '已保存'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
