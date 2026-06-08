/**
 * Browser-side scanner — mirrors server/src/scanner.ts in spirit.
 *
 * Walks a FileSystemDirectoryHandle recursively, parses ID3 via
 * music-metadata-browser, detects sibling `<basename>.lrc` files,
 * extracts the first embedded cover into a tiny data: URL, and
 * upserts rows into IndexedDB.
 *
 * Removed files (in DB but no longer on disk) are deleted from DB.
 * Existing rows are refreshed in place — there's no user-editable
 * subjective-metadata layer yet on the local side.
 *
 * Progress callback fires after every track so the view can render
 * a live count.
 */
import { parseBlob } from 'music-metadata-browser';
import {
  listLocalTracks,
  putLocalTrack,
  deleteLocalTrack,
} from './db';
import type { LocalTrack } from './types';

const AUDIO_EXT_RE = /\.(mp3|m4a|flac|ogg|opus|wav|aac)$/i;

export interface ScanProgress {
  scanned: number;
  total: number;
  current_rel_path: string | null;
}

export interface ScanResult {
  scanned: number;
  inserted: number;
  updated: number;
  removed: number;
  failed: number;
  took_ms: number;
}

/**
 * Recursively walk a directory handle yielding every audio file with
 * its rel_path (forward slashes, relative to the root handle) and the
 * set of filenames in its containing directory (so we can spot sibling
 * .lrc files without a second walk).
 */
async function* walkAudio(
  dir: FileSystemDirectoryHandle,
  prefix: string,
): AsyncGenerator<{
  rel_path: string;
  file_handle: FileSystemFileHandle;
  siblings: Set<string>;
}> {
  const subdirs: Array<[string, FileSystemDirectoryHandle]> = [];
  const files: Array<[string, FileSystemFileHandle]> = [];
  const siblings = new Set<string>();
  // @ts-expect-error — TS lib lacks values() generator on DirectoryHandle
  for await (const entry of dir.values() as AsyncIterable<FileSystemHandle>) {
    siblings.add(entry.name);
    if (entry.kind === 'directory') {
      subdirs.push([entry.name, entry as FileSystemDirectoryHandle]);
    } else if (entry.kind === 'file') {
      files.push([entry.name, entry as FileSystemFileHandle]);
    }
  }
  for (const [name, fh] of files) {
    if (AUDIO_EXT_RE.test(name)) {
      yield { rel_path: prefix + name, file_handle: fh, siblings };
    }
  }
  for (const [name, sub] of subdirs) {
    yield* walkAudio(sub, prefix + name + '/');
  }
}

/** Build a tiny data: URL from a music-metadata picture (front cover). */
function pictureToDataUrl(picture: {
  format?: string;
  data: Uint8Array;
}): string | null {
  if (!picture?.data || picture.data.length === 0) return null;
  // Some embedded covers are megabytes — that'd bloat IndexedDB. Skip
  // anything over 256 KB; the UI shows a placeholder instead.
  if (picture.data.length > 256 * 1024) return null;
  const mime = picture.format || 'image/jpeg';
  let binary = '';
  for (let i = 0; i < picture.data.length; i++) {
    binary += String.fromCharCode(picture.data[i]);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

async function parseOneFile(
  folder_id: number,
  rel_path: string,
  file_handle: FileSystemFileHandle,
  has_lrc: boolean,
): Promise<LocalTrack> {
  const file = await file_handle.getFile();
  const fallbackTitle =
    rel_path.replace(/\.[^.]+$/, '').split('/').pop() ?? rel_path;
  try {
    const meta = await parseBlob(file, { duration: true, skipCovers: false });
    const cover = meta.common.picture?.[0];
    return {
      folder_id,
      rel_path,
      title: meta.common.title?.trim() || fallbackTitle,
      artist: meta.common.artist?.trim() || null,
      album: meta.common.album?.trim() || null,
      year: typeof meta.common.year === 'number' ? meta.common.year : null,
      duration_sec:
        typeof meta.format.duration === 'number' ? meta.format.duration : null,
      size_bytes: file.size,
      bitrate:
        typeof meta.format.bitrate === 'number'
          ? Math.round(meta.format.bitrate)
          : null,
      has_lrc,
      cover_data_url: cover ? pictureToDataUrl(cover) : null,
    };
  } catch {
    // Malformed / unparseable tag: still index the file so the user
    // can play it — title falls back to filename.
    return {
      folder_id,
      rel_path,
      title: fallbackTitle,
      artist: null,
      album: null,
      year: null,
      duration_sec: null,
      size_bytes: file.size,
      bitrate: null,
      has_lrc,
      cover_data_url: null,
    };
  }
}

export async function scanFolder(
  root: FileSystemDirectoryHandle,
  folder_id: number,
  onProgress?: (p: ScanProgress) => void,
): Promise<ScanResult> {
  const start = Date.now();

  const found: Array<{
    rel_path: string;
    file_handle: FileSystemFileHandle;
    has_lrc: boolean;
  }> = [];
  for await (const item of walkAudio(root, '')) {
    const lrcName =
      item.rel_path.split('/').pop()!.replace(/\.[^.]+$/, '') + '.lrc';
    const has_lrc = item.siblings.has(lrcName);
    found.push({
      rel_path: item.rel_path,
      file_handle: item.file_handle,
      has_lrc,
    });
  }

  // Removal-detection is scoped to THIS folder so a track in another
  // folder doesn't get nuked by a scan of an unrelated handle.
  const existing = await listLocalTracks(folder_id);
  const existingByPath = new Map(existing.map((t) => [t.rel_path, t]));
  const foundPaths = new Set(found.map((f) => f.rel_path));

  let removed = 0;
  for (const t of existing) {
    if (!foundPaths.has(t.rel_path)) {
      await deleteLocalTrack(folder_id, t.rel_path);
      removed++;
    }
  }

  let inserted = 0;
  let updated = 0;
  let failed = 0;
  let n = 0;
  for (const item of found) {
    try {
      const t = await parseOneFile(folder_id, item.rel_path, item.file_handle, item.has_lrc);
      await putLocalTrack(t);
      if (existingByPath.has(item.rel_path)) updated++;
      else inserted++;
    } catch {
      failed++;
    }
    n++;
    onProgress?.({
      scanned: n,
      total: found.length,
      current_rel_path: item.rel_path,
    });
  }

  return {
    scanned: found.length,
    inserted,
    updated,
    removed,
    failed,
    took_ms: Date.now() - start,
  };
}

/**
 * Resolve a rel_path inside the (already-permission-granted) root
 * handle to its FileSystemFileHandle.
 */
export async function getFileHandle(
  root: FileSystemDirectoryHandle,
  rel_path: string,
): Promise<FileSystemFileHandle> {
  const segments = rel_path.split('/');
  const fileName = segments.pop()!;
  let dir: FileSystemDirectoryHandle = root;
  for (const seg of segments) {
    dir = await dir.getDirectoryHandle(seg);
  }
  return dir.getFileHandle(fileName);
}

/** Read the sibling .lrc file (same basename as the audio file). */
export async function readLrcFor(
  root: FileSystemDirectoryHandle,
  rel_path: string,
): Promise<string | null> {
  const lrcPath = rel_path.replace(/\.[^.]+$/, '') + '.lrc';
  try {
    const fh = await getFileHandle(root, lrcPath);
    const file = await fh.getFile();
    return await file.text();
  } catch {
    return null;
  }
}
