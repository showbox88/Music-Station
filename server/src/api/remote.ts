// Remote-control feature: same-user devices register a presence slot
// here, open an SSE stream, and exchange commands + state snapshots
// through the in-memory registry. No DB schema changes.
//
// Registry is process-local; on restart, clients reconnect via standard
// EventSource auto-retry and re-register. We don't try to persist
// transient presence.

import { Router, type Response } from 'express';
import type { Database } from 'better-sqlite3';

export type DeviceId = string;
export type UserId = number;

/** Snapshot of a host's player state. Mirrors the spec §5 shape. */
export interface Snapshot {
  schema: 1;
  current_track: TrackSummary | null;
  duration_sec: number;
  queue_ids: number[];
  cursor: number;
  current_playlist_id: number | null;
  is_playing: boolean;
  shuffle: boolean;
  repeat: 'off' | 'one' | 'all';
  position_sec: number;
  position_at_server_ms: number;
}

export interface TrackSummary {
  id: number;
  title: string;
  artist: string;
  album: string;
  cover_url: string | null;
  url: string;
}

/** The whitelist of remoteable actions. Anything not in here is rejected. */
const ALLOWED_ACTIONS = new Set([
  'togglePlay',
  'next',
  'prev',
  'seek',
  'setVolume',
  'jumpTo',
  'toggleShuffle',
  'cycleRepeat',
  'playList',
  'playOne',
  'enqueue',
  'clearQueue',
] as const);
export type RemoteAction =
  | 'togglePlay' | 'next' | 'prev' | 'seek' | 'setVolume' | 'jumpTo'
  | 'toggleShuffle' | 'cycleRepeat' | 'playList' | 'playOne' | 'enqueue'
  | 'clearQueue';

interface DeviceSlot {
  device_id: DeviceId;
  user_id: UserId;
  name: string;
  user_agent: string;
  sse: Response | null;
  last_state: Snapshot | null;
  following: DeviceId | null;
  last_seen_ms: number;
  /** When non-null, the slot is scheduled for deletion. Cleared on reconnect. */
  grace_timer: NodeJS.Timeout | null;
}

const GRACE_MS = 30_000;
const KEEPALIVE_MS = 25_000;

/** registry[userId][deviceId] = slot */
const registry: Map<UserId, Map<DeviceId, DeviceSlot>> = new Map();

function getUserMap(userId: UserId): Map<DeviceId, DeviceSlot> {
  let m = registry.get(userId);
  if (!m) {
    m = new Map();
    registry.set(userId, m);
  }
  return m;
}

function deriveName(userAgent: string): string {
  // Cheap UA sniff. Good enough for "Chrome / Windows" style labels.
  const ua = userAgent || '';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'Unknown';
  return `${browser} / ${os}`;
}

interface DeviceListEntry {
  device_id: string;
  name: string;
  is_self: boolean;
  is_host: boolean;
  online: boolean;
  last_seen_ms: number;
  following: string | null;
}

function listDevices(userId: UserId, selfId: DeviceId | null): DeviceListEntry[] {
  const m = registry.get(userId);
  if (!m) return [];
  const out: DeviceListEntry[] = [];
  for (const slot of m.values()) {
    out.push({
      device_id: slot.device_id,
      name: slot.name,
      is_self: slot.device_id === selfId,
      is_host: slot.last_state !== null,
      online: slot.sse !== null,
      last_seen_ms: slot.last_seen_ms,
      following: slot.following,
    });
  }
  // Stable order: online first, then by name.
  out.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

/** Send one SSE frame on a writable response. Swallows errors. */
function sseSend(res: Response, event: string, data: unknown): void {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    /* socket might already be torn down — caller will detect on 'close' */
  }
}

/** Push a fresh presence event to every online device in this user's map. */
function broadcastPresence(userId: UserId): void {
  const m = registry.get(userId);
  if (!m) return;
  for (const slot of m.values()) {
    if (slot.sse) {
      sseSend(slot.sse, 'presence', { devices: listDevices(userId, slot.device_id) });
    }
  }
}

export function remoteRouter(_deps: { db: Database }): Router {
  const r = Router();
  // (endpoints added in later tasks)
  return r;
}
