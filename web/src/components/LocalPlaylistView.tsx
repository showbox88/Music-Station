/**
 * Browser-local playlist view (mixed-content: server tracks + local
 * tracks). The playlist row itself lives in IndexedDB; we resolve its
 * items at view-time:
 *   - 'server' items → looked up in a Map<id, Track> built from one
 *      bulk listTracks() call (visibility filter applies, so items
 *      the user can no longer see become "曲目已删除")
 *   - 'local'  items → resolved against the LocalTrack rows in
 *     IndexedDB; blob URL is materialized on demand via the stored
 *     FileSystemDirectoryHandle (which may need permission re-grant
 *     if this is a fresh page load)
 *
 * Mutating actions:
 *   - remove item at index (writes IndexedDB)
 *   - rename / delete playlist are handled by the sidebar; this view
 *     re-renders via the refreshKey prop after those mutations.
 *
 * Not yet wired (v1.2+):
 *   - reorder (move up/down): db helper exists, UI doesn't
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { Track } from '../types';
import { usePlayer } from '../player/PlayerContext';
import {
  getLocalPlaylist,
  removeFromLocalPlaylistAt,
  getLocalTrack,
  listLocalUserStates,
  listLocalFolders,
} from '../local/db';
import { getFileHandle } from '../local/scanner';
import type {
  LocalFolder,
  LocalPlaylist,
  LocalPlaylistItem,
  LocalTrack,
  LocalUserState,
} from '../local/types';
import { localToTrack, localIdFromFolderAndPath } from '../local/types';

interface Props {
  playlistId: number;
  refreshKey: number;
  onChanged: () => void;
}

function formatDuration(sec: number | null | undefined): string {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface RowView {
  key: string;
  position: number;
  kind: 'server' | 'local';
  serverTrack?: Track;
  localTrack?: LocalTrack;
  localState?: LocalUserState;
  stale: boolean;
  staleReason?: string;
}

async function queryReadPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await (handle as any).queryPermission({ mode: 'read' })) as PermissionState;
}
async function requestReadPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await (handle as any).requestPermission({ mode: 'read' })) as PermissionState;
}

export default function LocalPlaylistView({ playlistId, refreshKey, onChanged }: Props) {
  const player = usePlayer();
  const [playlist, setPlaylist] = useState<LocalPlaylist | null>(null);
  const [rows, setRows] = useState<RowView[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** Per-folder permission state for folders referenced by this
   *  playlist's local items. Keyed by folder_id. */
  const [folderMap, setFolderMap] = useState<
    Map<number, { folder: LocalFolder; permission: PermissionState }>
  >(new Map());

  // Blob URL cache keyed by `${folder_id}:${rel_path}` so two folders
  // with the same rel_path don't shadow each other.
  const blobCacheRef = useRef<Map<string, string>>(new Map());
  const blobCacheKey = (fid: number, p: string) => `${fid}:${p}`;

  const reload = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const pl = await getLocalPlaylist(playlistId);
      if (!pl) {
        setPlaylist(null);
        setRows([]);
        return;
      }
      setPlaylist(pl);

      // Load every folder referenced by a local item in this playlist,
      // plus their permission states. We do this lazily — only the
      // folders we actually need, not every folder in the DB.
      const referencedFolderIds = new Set(
        pl.items
          .filter((it): it is Extract<LocalPlaylistItem, { kind: 'local' }> => it.kind === 'local')
          .map((it) => it.folder_id),
      );
      const allFolders = referencedFolderIds.size > 0 ? await listLocalFolders() : [];
      const newFolderMap = new Map<
        number,
        { folder: LocalFolder; permission: PermissionState }
      >();
      for (const f of allFolders) {
        if (!referencedFolderIds.has(f.id)) continue;
        const perm = await queryReadPermission(f.handle);
        newFolderMap.set(f.id, { folder: f, permission: perm });
      }
      setFolderMap(newFolderMap);

      const serverIds = pl.items
        .filter((it): it is Extract<LocalPlaylistItem, { kind: 'server' }> => it.kind === 'server')
        .map((it) => it.track_id);
      let serverMap = new Map<number, Track>();
      if (serverIds.length > 0) {
        const r = await api.listTracks({ limit: 5000 });
        serverMap = new Map(r.tracks.map((t) => [t.id, t]));
      }

      const localItems = pl.items.filter(
        (it): it is Extract<LocalPlaylistItem, { kind: 'local' }> => it.kind === 'local',
      );
      const localTrackByKey = new Map<string, LocalTrack>();
      for (const it of localItems) {
        const lt = await getLocalTrack(it.folder_id, it.rel_path);
        if (lt) localTrackByKey.set(`${it.folder_id}:${it.rel_path}`, lt);
      }
      const stateMap = new Map<string, LocalUserState>();
      for (const s of await listLocalUserStates()) {
        stateMap.set(`${s.folder_id}:${s.rel_path}`, s);
      }

      const resolved: RowView[] = pl.items.map((it, i) => {
        if (it.kind === 'server') {
          const t = serverMap.get(it.track_id);
          return {
            key: `s${it.track_id}-${i}`,
            position: i,
            kind: 'server',
            serverTrack: t,
            stale: !t,
            staleReason: !t ? '曲目已删除或对你不可见' : undefined,
          };
        }
        const lookupKey = `${it.folder_id}:${it.rel_path}`;
        const lt = localTrackByKey.get(lookupKey);
        const folderMissing = !newFolderMap.has(it.folder_id);
        return {
          key: `l${lookupKey}-${i}`,
          position: i,
          kind: 'local',
          localTrack: lt,
          localState: stateMap.get(lookupKey),
          stale: !lt || folderMissing,
          staleReason: folderMissing
            ? '原文件夹已被删除'
            : !lt
              ? '本地文件不在文件夹里了'
              : undefined,
        };
      });
      setRows(resolved);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setLoading(false);
    }
  }, [playlistId]);

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

  /** Re-grant permission for ONE specific folder by id. */
  const grantPermissionFor = useCallback(
    async (folderId: number) => {
      const entry = folderMap.get(folderId);
      if (!entry) return;
      try {
        const r = await requestReadPermission(entry.folder.handle);
        if (r === 'granted') {
          setFolderMap((prev) => {
            const next = new Map(prev);
            next.set(folderId, { folder: entry.folder, permission: 'granted' });
            return next;
          });
        }
      } catch (e) {
        setErr(String((e as Error).message ?? e));
      }
    },
    [folderMap],
  );

  const resolveForPlay = useCallback(
    async (row: RowView): Promise<Track | null> => {
      if (row.kind === 'server') return row.serverTrack ?? null;
      if (!row.localTrack) return null;
      const folder = folderMap.get(row.localTrack.folder_id);
      if (!folder || folder.permission !== 'granted') return null;
      const cacheKey = blobCacheKey(row.localTrack.folder_id, row.localTrack.rel_path);
      let url = blobCacheRef.current.get(cacheKey);
      if (!url) {
        const fh = await getFileHandle(folder.folder.handle, row.localTrack.rel_path);
        const file = await fh.getFile();
        url = URL.createObjectURL(file);
        blobCacheRef.current.set(cacheKey, url);
      }
      return localToTrack(row.localTrack, url, row.localState);
    },
    [folderMap],
  );

  const playAll = useCallback(async () => {
    if (rows.length === 0) return;
    try {
      const resolved = (await Promise.all(rows.map(resolveForPlay))).filter(
        (t): t is Track => t !== null,
      );
      if (resolved.length === 0) {
        setErr('没有可播放的曲目（服务端不可见 + 本地未授权）');
        return;
      }
      player.playList(resolved, 0);
    } catch (e) {
      setErr(`播放失败: ${(e as Error).message}`);
    }
  }, [rows, resolveForPlay, player]);

  const playFromIndex = useCallback(
    async (idx: number) => {
      const target = rows[idx];
      if (!target || target.stale) return;

      const targetId =
        target.kind === 'server'
          ? target.serverTrack?.id
          : target.localTrack
            ? localIdFromFolderAndPath(
                target.localTrack.folder_id,
                target.localTrack.rel_path,
              )
            : null;
      if (targetId != null && player.current?.id === targetId) {
        player.togglePlay();
        return;
      }

      try {
        const resolved = (await Promise.all(rows.map(resolveForPlay))).filter(
          (t): t is Track => t !== null,
        );
        if (resolved.length === 0) return;
        // Find the adjusted index: how many playable rows precede `idx`.
        let adjustedIdx = 0;
        let playableSeen = 0;
        for (let i = 0; i <= idx && i < rows.length; i++) {
          const r = rows[i];
          const folderOk =
            r.kind !== 'local' ||
            (r.localTrack &&
              folderMap.get(r.localTrack.folder_id)?.permission === 'granted');
          const isPlayable = !r.stale && folderOk;
          if (i === idx) {
            adjustedIdx = playableSeen;
            break;
          }
          if (isPlayable) playableSeen++;
        }
        player.playList(resolved, adjustedIdx);
      } catch (e) {
        setErr(`播放失败: ${(e as Error).message}`);
      }
    },
    [rows, resolveForPlay, player, folderMap],
  );

  const removeAt = useCallback(
    async (position: number) => {
      try {
        await removeFromLocalPlaylistAt(playlistId, position);
        await reload();
        onChanged();
      } catch (e) {
        setErr(`移除失败: ${(e as Error).message}`);
      }
    },
    [playlistId, reload, onChanged],
  );

  const hasLocalItems = useMemo(
    () => rows.some((r) => r.kind === 'local'),
    [rows],
  );

  /** Folders this playlist references that aren't 'granted' yet. */
  const foldersNeedingGrant = useMemo(
    () =>
      Array.from(folderMap.values()).filter(
        (e) => e.permission !== 'granted',
      ),
    [folderMap],
  );

  /** True iff the playlist references a folder_id we couldn't find in
   *  the folders store (user deleted the folder after building the
   *  playlist). Render a distinct banner for this. */
  const hasMissingFolders = useMemo(() => {
    const referenced = new Set<number>();
    for (const r of rows) {
      if (r.kind === 'local' && r.localTrack) referenced.add(r.localTrack.folder_id);
    }
    for (const id of referenced) {
      if (!folderMap.has(id)) return true;
    }
    return false;
  }, [rows, folderMap]);

  if (loading && !playlist) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-zinc-500">
        加载中…
      </div>
    );
  }
  if (!playlist) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-zinc-500">
        playlist 不存在（可能刚被删了）
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-3 md:px-6 py-3 border-b border-black/60 flex flex-wrap items-center gap-2 md:gap-3 surface-raised">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-lg font-medium truncate">{playlist.name}</span>
            <span
              className="text-[9px] uppercase text-pink-300/80"
              title="本地 playlist，只存这台浏览器，不跨设备"
            >
              local
            </span>
          </div>
          <div className="text-xs text-zinc-500">
            {rows.length} 项 · 创建于 {new Date(playlist.created_at).toLocaleString()}
          </div>
        </div>
        <button
          onClick={playAll}
          disabled={rows.length === 0}
          className="text-[11px] px-2.5 py-1 rounded-full bezel text-zinc-300 hover:text-white disabled:opacity-50"
        >
          ▶ 全部播放
        </button>
      </div>

      {foldersNeedingGrant.map((entry) => (
        <div
          key={entry.folder.id}
          className="px-3 md:px-6 py-2 text-xs text-amber-300 border-b border-amber-900/40 flex items-center gap-3"
        >
          <span>
            需要重新授权读文件夹「{entry.folder.name}」(里面有曲目在这个 playlist 里)
          </span>
          <button
            onClick={() => grantPermissionFor(entry.folder.id)}
            className="text-[11px] px-2 py-0.5 rounded-full bezel glow-text glow-ring"
          >
            🔓 授予访问
          </button>
        </div>
      ))}
      {hasMissingFolders && (
        <div className="px-3 md:px-6 py-2 text-xs text-amber-300 border-b border-amber-900/40">
          这个 playlist 里有曲目来自已删除的文件夹，下面会标灰。可以挨个移除，或保留等以后重新添加同名文件夹。
        </div>
      )}

      {err && (
        <div className="px-3 md:px-6 py-2 text-xs text-red-400 border-b border-red-900/40">
          {err}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="p-6 text-sm text-zinc-500 text-center">
            空 playlist。在曲目列表里点 + 加进来。
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase text-zinc-500 sticky top-0 bg-black/60 backdrop-blur">
              <tr>
                <th className="text-left px-3 py-1.5 w-8">#</th>
                <th className="text-left px-3 py-1.5 w-10"></th>
                <th className="text-left px-3 py-1.5 w-14">来源</th>
                <th className="text-left px-3 py-1.5">标题</th>
                <th className="text-left px-3 py-1.5 hidden md:table-cell">艺术家</th>
                <th className="text-right px-3 py-1.5 w-16 tabular-nums">时长</th>
                <th className="text-right px-3 py-1.5 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const title =
                  row.kind === 'server'
                    ? row.serverTrack?.title ?? '—'
                    : row.localTrack?.title ?? row.localTrack?.rel_path ?? '(missing)';
                const artist =
                  row.kind === 'server'
                    ? row.serverTrack?.artist ?? '—'
                    : row.localTrack?.artist ?? '—';
                const cover =
                  row.kind === 'server'
                    ? row.serverTrack?.cover_url
                    : row.localTrack?.cover_data_url;
                const duration =
                  row.kind === 'server'
                    ? row.serverTrack?.duration_sec
                    : row.localTrack?.duration_sec;
                return (
                  <tr
                    key={row.key}
                    className={`border-t border-black/40 hover:bg-white/[0.03] group ${
                      row.stale ? 'opacity-40' : ''
                    }`}
                  >
                    <td className="px-3 py-1.5 text-zinc-500 tabular-nums">
                      {row.position + 1}
                    </td>
                    <td className="px-3 py-1.5">
                      {cover ? (
                        <img
                          src={cover}
                          alt=""
                          className="w-7 h-7 rounded object-cover"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded bg-zinc-800 text-zinc-500 flex items-center justify-center text-xs">
                          ♪
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={`text-[9px] uppercase px-1.5 py-0.5 rounded-full bezel ${
                          row.kind === 'local' ? 'text-pink-300/90' : 'text-zinc-400'
                        }`}
                        title={
                          row.staleReason ??
                          (row.kind === 'local'
                            ? '本地文件夹里的曲目'
                            : '服务端曲目')
                        }
                      >
                        {row.kind === 'local' ? 'local' : 'server'}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <div
                        className="truncate max-w-md cursor-pointer"
                        onClick={() => playFromIndex(row.position)}
                        title={row.staleReason ?? '点击播放'}
                      >
                        {title}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 hidden md:table-cell text-zinc-400 truncate max-w-xs">
                      {artist}
                    </td>
                    <td className="px-3 py-1.5 text-right text-zinc-400 tabular-nums">
                      {formatDuration(duration ?? null)}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-60 group-hover:opacity-100">
                        <button
                          onClick={() => playFromIndex(row.position)}
                          disabled={row.stale}
                          className="w-7 h-7 rounded-full bezel text-zinc-300 hover:text-white flex items-center justify-center disabled:opacity-30"
                          title="播放"
                        >
                          ▶
                        </button>
                        <button
                          onClick={() => removeAt(row.position)}
                          className="w-7 h-7 rounded-full bezel text-zinc-300 hover:text-red-400 flex items-center justify-center"
                          title="从 playlist 移除（不删原曲目）"
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
