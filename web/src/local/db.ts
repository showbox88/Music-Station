/**
 * IndexedDB layer for the browser-local music library.
 *
 * Schema (object stores):
 *   meta    : key-value bag. 'folder_handle' → FileSystemDirectoryHandle
 *             (browsers serialize these via structured clone for free).
 *   tracks  : indexed by rel_path; one row per scanned mp3 in the chosen
 *             folder. Holds parsed ID3 fields + a tiny data: URL for the
 *             embedded cover (omitted if absent) + has_lrc flag.
 *
 * Why IndexedDB and not localStorage:
 *   - Folder handles must be stored via structured clone (localStorage
 *     only takes strings).
 *   - Cover data URLs can be tens of KB each → blow past localStorage
 *     quota fast.
 *   - We may add per-track user state (favorites/ratings/EQ) and local
 *     playlists later — same DB.
 */
import type { LocalTrack } from './types';

const DB_NAME = 'music-station-local';
const DB_VERSION = 3;
const STORE_META = 'meta';
const STORE_TRACKS = 'tracks';
const STORE_USER_STATE = 'user_state';
const STORE_PLAYLISTS = 'local_playlists';

let dbPromise: Promise<IDBDatabase> | null = null;

export function openLocalDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
      if (!db.objectStoreNames.contains(STORE_TRACKS)) {
        db.createObjectStore(STORE_TRACKS, { keyPath: 'rel_path' });
      }
      // v2: per-track user state (favorites, ratings, EQ) keyed by
      // rel_path. Independent of the server's per-user storage —
      // these never leave this browser.
      if (!db.objectStoreNames.contains(STORE_USER_STATE)) {
        db.createObjectStore(STORE_USER_STATE, { keyPath: 'rel_path' });
      }
      // v3: local playlists. Mixed-content (can reference server
      // tracks by id + local tracks by rel_path). Keys are negative
      // integers so they can't collide with server playlist ids
      // (positive AUTOINCREMENT). See newLocalPlaylistId().
      if (!db.objectStoreNames.contains(STORE_PLAYLISTS)) {
        db.createObjectStore(STORE_PLAYLISTS, { keyPath: 'id' });
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

export async function listLocalTracks(): Promise<LocalTrack[]> {
  const db = await openLocalDB();
  const store = tx(db, STORE_TRACKS, 'readonly');
  return reqAsPromise(store.getAll() as IDBRequest<LocalTrack[]>);
}

export async function getLocalTrack(rel_path: string): Promise<LocalTrack | undefined> {
  const db = await openLocalDB();
  const store = tx(db, STORE_TRACKS, 'readonly');
  return reqAsPromise(store.get(rel_path) as IDBRequest<LocalTrack | undefined>);
}

export async function putLocalTrack(t: LocalTrack): Promise<void> {
  const db = await openLocalDB();
  const store = tx(db, STORE_TRACKS, 'readwrite');
  await reqAsPromise(store.put(t));
}

export async function deleteLocalTrack(rel_path: string): Promise<void> {
  const db = await openLocalDB();
  const store = tx(db, STORE_TRACKS, 'readwrite');
  await reqAsPromise(store.delete(rel_path));
}

export async function clearLocalTracks(): Promise<void> {
  const db = await openLocalDB();
  const store = tx(db, STORE_TRACKS, 'readwrite');
  await reqAsPromise(store.clear());
}

/* --------------------------- user_state --------------------------- */

import type { LocalUserState } from './types';

export async function listLocalUserStates(): Promise<LocalUserState[]> {
  const db = await openLocalDB();
  const store = tx(db, STORE_USER_STATE, 'readonly');
  return reqAsPromise(store.getAll() as IDBRequest<LocalUserState[]>);
}

export async function getLocalUserState(
  rel_path: string,
): Promise<LocalUserState | undefined> {
  const db = await openLocalDB();
  const store = tx(db, STORE_USER_STATE, 'readonly');
  return reqAsPromise(
    store.get(rel_path) as IDBRequest<LocalUserState | undefined>,
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
 * Merge a partial update into the user_state row for this rel_path.
 * Pass `null` for a field to remove it. Returns the resulting row,
 * or undefined when the row is empty after the merge (in which case
 * we delete it to keep the store small).
 */
export async function patchLocalUserState(
  rel_path: string,
  patch: LocalUserStatePatch,
): Promise<LocalUserState | undefined> {
  const db = await openLocalDB();
  const store = tx(db, STORE_USER_STATE, 'readwrite');
  const existing =
    ((await reqAsPromise(
      store.get(rel_path) as IDBRequest<LocalUserState | undefined>,
    )) as LocalUserState | undefined) ?? { rel_path };
  const merged = { ...existing } as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) {
      delete merged[k];
    } else if (v !== undefined) {
      merged[k] = v;
    }
  }
  // Empty (only rel_path) → drop the row so the store doesn't bloat
  // with no-op entries.
  const onlyKey = Object.keys(merged).length === 1;
  if (onlyKey) {
    await reqAsPromise(store.delete(rel_path));
    return undefined;
  }
  const out = merged as unknown as LocalUserState;
  await reqAsPromise(store.put(out));
  return out;
}

export async function deleteLocalUserState(rel_path: string): Promise<void> {
  const db = await openLocalDB();
  const store = tx(db, STORE_USER_STATE, 'readwrite');
  await reqAsPromise(store.delete(rel_path));
}

/* ----------------------- folder handle helpers ----------------------- */

const FOLDER_KEY = 'folder_handle';

export async function getStoredFolderHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return metaGet<FileSystemDirectoryHandle>(FOLDER_KEY);
}

export async function setStoredFolderHandle(h: FileSystemDirectoryHandle): Promise<void> {
  await metaSet(FOLDER_KEY, h);
}

export async function clearStoredFolderHandle(): Promise<void> {
  await metaDelete(FOLDER_KEY);
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
