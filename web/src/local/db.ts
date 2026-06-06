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
const DB_VERSION = 2;
const STORE_META = 'meta';
const STORE_TRACKS = 'tracks';
const STORE_USER_STATE = 'user_state';

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
