/**
 * IndexedDB layer for the browser-local music library.
 *
 * Schema (object stores):
 *   meta            : key-value bag. v3 stored 'folder_handle' here;
 *                     v4 keeps it for compat only — the source of
 *                     truth moved to the folders store.
 *   folders         : list of registered local folders (v4+).
 *                     Row: {id, handle, name, created_at}.
 *   tracks          : one row per scanned audio file. v4+ compound
 *                     key [folder_id, rel_path] so two folders can
 *                     have files with the same path.
 *   user_state      : per-track favorites/ratings/EQ. Same compound
 *                     key as tracks since v4.
 *   local_playlists : keyed by negative-int id; items[].local now
 *                     carries folder_id alongside rel_path (v4).
 *
 * Why IndexedDB and not localStorage:
 *   - Folder handles must be stored via structured clone (localStorage
 *     only takes strings).
 *   - Cover data URLs can be tens of KB each → blow past localStorage
 *     quota fast.
 *
 * v3 → v4 migration (multi-folder):
 *   Existing single folder becomes folder #DEFAULT_FOLDER_ID (-1).
 *   All existing tracks/user_state rows get folder_id = -1.
 *   All existing playlist items[].local entries get folder_id = -1.
 *   Done inside onupgradeneeded so it's atomic with the version bump.
 */
import type { LocalTrack } from './types';

const DB_NAME = 'music-station-local';
const DB_VERSION = 4;
const STORE_META = 'meta';
const STORE_TRACKS = 'tracks';
const STORE_USER_STATE = 'user_state';
const STORE_PLAYLISTS = 'local_playlists';
const STORE_FOLDERS = 'folders';

/**
 * Fixed id given to the single folder pre-v4 users had. We pick a
 * value (-1) that the negative-timestamp generator for new folders
 * never produces, so it can't collide with subsequently-added folders.
 */
export const DEFAULT_FOLDER_ID = -1;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openLocalDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;
      const upgradeTx = req.transaction!;

      if (oldVersion < 1) {
        db.createObjectStore(STORE_META);
      }
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(STORE_USER_STATE)) {
          db.createObjectStore(STORE_USER_STATE, { keyPath: 'rel_path' });
        }
      }
      if (oldVersion < 3) {
        if (!db.objectStoreNames.contains(STORE_PLAYLISTS)) {
          db.createObjectStore(STORE_PLAYLISTS, { keyPath: 'id' });
        }
      }
      // Before v3 there was no playlists store; before v2 no
      // user_state. v1 created tracks keyed by 'rel_path'.
      if (oldVersion < 1) {
        db.createObjectStore(STORE_TRACKS, { keyPath: 'rel_path' });
      }

      if (oldVersion < 4) {
        // ---- multi-folder migration ----

        // 1. Create folders store.
        if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
          db.createObjectStore(STORE_FOLDERS, { keyPath: 'id' });
        }

        // 2. Pull the old single handle from meta and turn it into
        //    a row in folders (with id = DEFAULT_FOLDER_ID). We
        //    chain the migrations off this so DEFAULT_FOLDER_ID is
        //    already in place before track rows reference it.
        const meta = upgradeTx.objectStore(STORE_META);
        const getHandleReq = meta.get('folder_handle');
        getHandleReq.onsuccess = () => {
          const handle = getHandleReq.result as FileSystemDirectoryHandle | undefined;
          if (handle) {
            const folders = upgradeTx.objectStore(STORE_FOLDERS);
            folders.put({
              id: DEFAULT_FOLDER_ID,
              handle,
              name: handle.name || '本地文件夹',
              created_at: new Date().toISOString(),
            });
          }
        };

        // 3. Re-key tracks: read all → delete store → recreate with
        //    compound keyPath → reinsert with folder_id.
        // Must run BEFORE re-key user_state — they're independent
        // but both rely on the same getAll/delete/create pattern.
        if (db.objectStoreNames.contains(STORE_TRACKS)) {
          const oldTracks = upgradeTx.objectStore(STORE_TRACKS);
          const getAllTracksReq = oldTracks.getAll();
          getAllTracksReq.onsuccess = () => {
            const rows = (getAllTracksReq.result as LocalTrack[]) || [];
            db.deleteObjectStore(STORE_TRACKS);
            const newTracks = db.createObjectStore(STORE_TRACKS, {
              keyPath: ['folder_id', 'rel_path'],
            });
            for (const row of rows) {
              newTracks.put({ ...row, folder_id: DEFAULT_FOLDER_ID });
            }
          };
        } else {
          // Fresh DB never had tracks store yet. Create with new
          // compound keyPath directly.
          db.createObjectStore(STORE_TRACKS, {
            keyPath: ['folder_id', 'rel_path'],
          });
        }

        // 4. Same migration for user_state.
        if (db.objectStoreNames.contains(STORE_USER_STATE)) {
          const oldStates = upgradeTx.objectStore(STORE_USER_STATE);
          const getAllStatesReq = oldStates.getAll();
          getAllStatesReq.onsuccess = () => {
            const rows = (getAllStatesReq.result as Array<Record<string, unknown>>) || [];
            db.deleteObjectStore(STORE_USER_STATE);
            const newStates = db.createObjectStore(STORE_USER_STATE, {
              keyPath: ['folder_id', 'rel_path'],
            });
            for (const row of rows) {
              newStates.put({ ...row, folder_id: DEFAULT_FOLDER_ID });
            }
          };
        } else {
          db.createObjectStore(STORE_USER_STATE, {
            keyPath: ['folder_id', 'rel_path'],
          });
        }

        // 5. Walk playlists, inject folder_id into items[].local
        //    rows that don't have one yet. In-place update — no
        //    key change.
        if (db.objectStoreNames.contains(STORE_PLAYLISTS)) {
          const playlists = upgradeTx.objectStore(STORE_PLAYLISTS);
          const getAllPlReq = playlists.getAll();
          getAllPlReq.onsuccess = () => {
            const rows = (getAllPlReq.result as Array<{
              id: number;
              items: Array<Record<string, unknown>>;
            }>) || [];
            for (const pl of rows) {
              let mutated = false;
              pl.items = pl.items.map((it) => {
                if (it.kind === 'local' && it.folder_id === undefined) {
                  mutated = true;
                  return { ...it, folder_id: DEFAULT_FOLDER_ID };
                }
                return it;
              });
              if (mutated) playlists.put(pl);
            }
          };
        }
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
  return dbPromise;
}

function tx(db: IDBDatabase, store: string, mode: IDBTransactionMode) {
  return db.transaction(store, mode).objectStore(store);
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ------------------------------ meta ------------------------------ */

export async function metaGet<T = unknown>(key: string): Promise<T | undefined> {
  const db = await openLocalDB();
  const store = tx(db, STORE_META, 'readonly');
  return reqAsPromise<T | undefined>(store.get(key) as IDBRequest<T | undefined>);
}

export async function metaSet(key: string, value: unknown): Promise<void> {
  const db = await openLocalDB();
  const store = tx(db, STORE_META, 'readwrite');
  await reqAsPromise(store.put(value, key));
}

export async function metaDelete(key: string): Promise<void> {
  const db = await openLocalDB();
  const store = tx(db, STORE_META, 'readwrite');
  await reqAsPromise(store.delete(key));
}

/* ----------------------------- tracks ----------------------------- */

/**
 * All tracks across all folders. Pass a folderId to restrict to that
 * folder only — uses IDBKeyRange.bound on the compound key.
 */
export async function listLocalTracks(folderId?: number): Promise<LocalTrack[]> {
  const db = await openLocalDB();
  const store = tx(db, STORE_TRACKS, 'readonly');
  if (folderId == null) {
    return reqAsPromise(store.getAll() as IDBRequest<LocalTrack[]>);
  }
  const range = IDBKeyRange.bound([folderId, ''], [folderId, '￿']);
  return reqAsPromise(store.getAll(range) as IDBRequest<LocalTrack[]>);
}

export async function getLocalTrack(
  folderId: number,
  rel_path: string,
): Promise<LocalTrack | undefined> {
  const db = await openLocalDB();
  const store = tx(db, STORE_TRACKS, 'readonly');
  return reqAsPromise(
    store.get([folderId, rel_path]) as IDBRequest<LocalTrack | undefined>,
  );
}

export async function putLocalTrack(t: LocalTrack): Promise<void> {
  const db = await openLocalDB();
  const store = tx(db, STORE_TRACKS, 'readwrite');
  await reqAsPromise(store.put(t));
}

export async function deleteLocalTrack(
  folderId: number,
  rel_path: string,
): Promise<void> {
  const db = await openLocalDB();
  const store = tx(db, STORE_TRACKS, 'readwrite');
  await reqAsPromise(store.delete([folderId, rel_path]));
}

/** Wipe ALL tracks (every folder). Used when a fresh pick replaces
 *  the world (rare — usually you want clearLocalTracksForFolder). */
export async function clearLocalTracks(): Promise<void> {
  const db = await openLocalDB();
  const store = tx(db, STORE_TRACKS, 'readwrite');
  await reqAsPromise(store.clear());
}

/** Delete all tracks for one folder. Used when the folder's handle
 *  is swapped or the folder is deleted entirely. */
export async function clearLocalTracksForFolder(folderId: number): Promise<void> {
  const db = await openLocalDB();
  const store = tx(db, STORE_TRACKS, 'readwrite');
  const range = IDBKeyRange.bound([folderId, ''], [folderId, '￿']);
  await reqAsPromise(store.delete(range));
}

/* --------------------------- user_state --------------------------- */

import type { LocalUserState } from './types';

export async function listLocalUserStates(
  folderId?: number,
): Promise<LocalUserState[]> {
  const db = await openLocalDB();
  const store = tx(db, STORE_USER_STATE, 'readonly');
  if (folderId == null) {
    return reqAsPromise(store.getAll() as IDBRequest<LocalUserState[]>);
  }
  const range = IDBKeyRange.bound([folderId, ''], [folderId, '￿']);
  return reqAsPromise(store.getAll(range) as IDBRequest<LocalUserState[]>);
}

export async function getLocalUserState(
  folderId: number,
  rel_path: string,
): Promise<LocalUserState | undefined> {
  const db = await openLocalDB();
  const store = tx(db, STORE_USER_STATE, 'readonly');
  return reqAsPromise(
    store.get([folderId, rel_path]) as IDBRequest<LocalUserState | undefined>,
  );
}

/**
 * Patch payload for `patchLocalUserState`. Each field is optional;
 * passing `null` means "clear this field". Omitting a field leaves it
 * unchanged. This is a parallel type to LocalUserState rather than
 * Partial<LocalUserState> because Partial doesn't add `| null`.
 */
export interface LocalUserStatePatch {
  favorited?: boolean | null;
  rating?: number | null;
  eq?: LocalUserState['eq'] | null;
}

/**
 * Merge a partial update into the user_state row for this
 * (folder_id, rel_path). Pass `null` for a field to remove it.
 * Returns the resulting row, or undefined when the row is empty
 * after the merge (in which case we delete it to keep the store
 * small).
 */
export async function patchLocalUserState(
  folderId: number,
  rel_path: string,
  patch: LocalUserStatePatch,
): Promise<LocalUserState | undefined> {
  const db = await openLocalDB();
  const store = tx(db, STORE_USER_STATE, 'readwrite');
  const existing =
    ((await reqAsPromise(
      store.get([folderId, rel_path]) as IDBRequest<LocalUserState | undefined>,
    )) as LocalUserState | undefined) ?? {
      folder_id: folderId,
      rel_path,
    };
  const merged = { ...existing } as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) {
      delete merged[k];
    } else if (v !== undefined) {
      merged[k] = v;
    }
  }
  // Empty (only the compound key) → drop the row so the store doesn't
  // bloat with no-op entries.
  const onlyKey = Object.keys(merged).length === 2; // folder_id + rel_path
  if (onlyKey) {
    await reqAsPromise(store.delete([folderId, rel_path]));
    return undefined;
  }
  const out = merged as unknown as LocalUserState;
  await reqAsPromise(store.put(out));
  return out;
}

export async function deleteLocalUserState(
  folderId: number,
  rel_path: string,
): Promise<void> {
  const db = await openLocalDB();
  const store = tx(db, STORE_USER_STATE, 'readwrite');
  await reqAsPromise(store.delete([folderId, rel_path]));
}

/** Wipe all user_state rows for one folder (after a folder delete). */
export async function clearLocalUserStateForFolder(folderId: number): Promise<void> {
  const db = await openLocalDB();
  const store = tx(db, STORE_USER_STATE, 'readwrite');
  const range = IDBKeyRange.bound([folderId, ''], [folderId, '￿']);
  await reqAsPromise(store.delete(range));
}

/* ------------------------------ folders ------------------------------ */

import type { LocalFolder } from './types';

/**
 * Generate a unique negative integer id for a new folder. Uses
 * Date.now()*1000 + random so two clicks in the same ms still differ.
 * Negated so the migrated default folder (id -1) never collides with
 * a freshly-generated id.
 */
function newLocalFolderId(): number {
  return -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
}

export async function listLocalFolders(): Promise<LocalFolder[]> {
  const db = await openLocalDB();
  const store = tx(db, STORE_FOLDERS, 'readonly');
  const rows = await reqAsPromise(store.getAll() as IDBRequest<LocalFolder[]>);
  // Default folder first (id == -1), then the rest by most-recent
  // creation (more-negative id = newer).
  return rows.sort((a, b) => {
    if (a.id === DEFAULT_FOLDER_ID) return -1;
    if (b.id === DEFAULT_FOLDER_ID) return 1;
    return a.id - b.id;
  });
}

export async function getLocalFolder(id: number): Promise<LocalFolder | undefined> {
  const db = await openLocalDB();
  const store = tx(db, STORE_FOLDERS, 'readonly');
  return reqAsPromise(store.get(id) as IDBRequest<LocalFolder | undefined>);
}

/**
 * Add a brand-new folder. Use `forceId` to pin the row to a specific
 * id (mostly for migration code paths or "reuse the default slot").
 */
export async function createLocalFolder(
  handle: FileSystemDirectoryHandle,
  name?: string,
  forceId?: number,
): Promise<LocalFolder> {
  const f: LocalFolder = {
    id: forceId ?? newLocalFolderId(),
    handle,
    name: (name?.trim() || handle.name || '本地文件夹').slice(0, 80),
    created_at: new Date().toISOString(),
  };
  const db = await openLocalDB();
  const store = tx(db, STORE_FOLDERS, 'readwrite');
  await reqAsPromise(store.put(f));
  return f;
}

export async function renameLocalFolder(id: number, name: string): Promise<void> {
  const db = await openLocalDB();
  const store = tx(db, STORE_FOLDERS, 'readwrite');
  const cur = (await reqAsPromise(
    store.get(id) as IDBRequest<LocalFolder | undefined>,
  )) as LocalFolder | undefined;
  if (!cur) return;
  cur.name = (name.trim() || cur.name).slice(0, 80);
  await reqAsPromise(store.put(cur));
}

/** Swap the FileSystemDirectoryHandle on an existing folder row.
 *  Used by "换文件夹" — keeps the same folder id (so all tracks /
 *  state / playlist refs survive) but points at a new directory. */
export async function replaceLocalFolderHandle(
  id: number,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const db = await openLocalDB();
  const store = tx(db, STORE_FOLDERS, 'readwrite');
  const cur = (await reqAsPromise(
    store.get(id) as IDBRequest<LocalFolder | undefined>,
  )) as LocalFolder | undefined;
  if (!cur) return;
  cur.handle = handle;
  await reqAsPromise(store.put(cur));
}

/**
 * Delete a folder row AND its tracks + user_state. Local-playlist
 * items pointing into this folder are NOT touched — they become
 * stale "本地文件不在当前文件夹里" rows in LocalPlaylistView.
 */
export async function deleteLocalFolder(id: number): Promise<void> {
  await clearLocalTracksForFolder(id);
  await clearLocalUserStateForFolder(id);
  const db = await openLocalDB();
  const store = tx(db, STORE_FOLDERS, 'readwrite');
  await reqAsPromise(store.delete(id));
}

/* --------------------------- local_playlists --------------------------- */

import type { LocalPlaylist, LocalPlaylistItem } from './types';

/**
 * Generate a unique negative integer id for a new local playlist.
 * `Date.now()` + tiny random suffix so two clicks in the same ms still
 * differ. Negated so it can never collide with server playlist ids
 * (positive AUTOINCREMENT). Range: roughly -2^53 .. 0, plenty of room.
 */
function newLocalPlaylistId(): number {
  return -(Date.now() * 1000 + Math.floor(Math.random() * 1000));
}

export async function listLocalPlaylists(): Promise<LocalPlaylist[]> {
  const db = await openLocalDB();
  const store = tx(db, STORE_PLAYLISTS, 'readonly');
  const rows = await reqAsPromise(store.getAll() as IDBRequest<LocalPlaylist[]>);
  // ids are negative timestamps → more-recent = more-negative; ascending
  // order puts most-recent first.
  return rows.sort((a, b) => a.id - b.id);
}

export async function getLocalPlaylist(
  id: number,
): Promise<LocalPlaylist | undefined> {
  const db = await openLocalDB();
  const store = tx(db, STORE_PLAYLISTS, 'readonly');
  return reqAsPromise(store.get(id) as IDBRequest<LocalPlaylist | undefined>);
}

export async function createLocalPlaylist(name: string): Promise<LocalPlaylist> {
  const pl: LocalPlaylist = {
    id: newLocalPlaylistId(),
    name: name.trim() || '未命名',
    created_at: new Date().toISOString(),
    items: [],
  };
  const db = await openLocalDB();
  const store = tx(db, STORE_PLAYLISTS, 'readwrite');
  await reqAsPromise(store.put(pl));
  return pl;
}

export async function renameLocalPlaylist(id: number, name: string): Promise<void> {
  const db = await openLocalDB();
  const store = tx(db, STORE_PLAYLISTS, 'readwrite');
  const cur = (await reqAsPromise(
    store.get(id) as IDBRequest<LocalPlaylist | undefined>,
  )) as LocalPlaylist | undefined;
  if (!cur) return;
  cur.name = name.trim() || cur.name;
  await reqAsPromise(store.put(cur));
}

export async function deleteLocalPlaylist(id: number): Promise<void> {
  const db = await openLocalDB();
  const store = tx(db, STORE_PLAYLISTS, 'readwrite');
  await reqAsPromise(store.delete(id));
}

/**
 * Append an item. Allows duplicates (matches server playlist behavior:
 * adding the same track twice yields two entries).
 */
export async function addToLocalPlaylist(
  id: number,
  item: LocalPlaylistItem,
): Promise<LocalPlaylist | undefined> {
  const db = await openLocalDB();
  const store = tx(db, STORE_PLAYLISTS, 'readwrite');
  const cur = (await reqAsPromise(
    store.get(id) as IDBRequest<LocalPlaylist | undefined>,
  )) as LocalPlaylist | undefined;
  if (!cur) return undefined;
  cur.items = [...cur.items, item];
  await reqAsPromise(store.put(cur));
  return cur;
}

export async function removeFromLocalPlaylistAt(
  id: number,
  position: number,
): Promise<LocalPlaylist | undefined> {
  const db = await openLocalDB();
  const store = tx(db, STORE_PLAYLISTS, 'readwrite');
  const cur = (await reqAsPromise(
    store.get(id) as IDBRequest<LocalPlaylist | undefined>,
  )) as LocalPlaylist | undefined;
  if (!cur) return undefined;
  if (position < 0 || position >= cur.items.length) return cur;
  cur.items = cur.items.filter((_, i) => i !== position);
  await reqAsPromise(store.put(cur));
  return cur;
}

export async function moveItemInLocalPlaylist(
  id: number,
  from: number,
  to: number,
): Promise<LocalPlaylist | undefined> {
  const db = await openLocalDB();
  const store = tx(db, STORE_PLAYLISTS, 'readwrite');
  const cur = (await reqAsPromise(
    store.get(id) as IDBRequest<LocalPlaylist | undefined>,
  )) as LocalPlaylist | undefined;
  if (!cur) return undefined;
  if (from === to) return cur;
  if (from < 0 || from >= cur.items.length) return cur;
  if (to < 0 || to >= cur.items.length) return cur;
  const next = [...cur.items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  cur.items = next;
  await reqAsPromise(store.put(cur));
  return cur;
}
