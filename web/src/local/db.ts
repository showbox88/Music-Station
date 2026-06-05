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
const DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_TRACKS = 'tracks';

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
