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
  /** Host's audio volume, 0..1. Optional for back-compat with older clients. */
  volume?: number;
  /** Audio-effect state being applied right now. Optional so older
   *  hosts can publish snapshots without it. */
  effects?: {
    spatial_preset: 'off' | 'cinema' | 'hall' | 'club';
    global_eq_enabled: boolean;
    eq_state: {
      gains: number[];
      preamp: number;
      bypass: boolean;
    };
  };
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
  'setSpatialPreset',
  'setGlobalEqEnabled',
  'setEqGains',
  'setEqPreamp',
  'setEqBypass',
  'eqReset',
  'setVizStyle',
] as const);
export type RemoteAction =
  | 'togglePlay' | 'next' | 'prev' | 'seek' | 'setVolume' | 'jumpTo'
  | 'toggleShuffle' | 'cycleRepeat' | 'playList' | 'playOne' | 'enqueue'
  | 'clearQueue'
  | 'setSpatialPreset' | 'setGlobalEqEnabled'
  | 'setEqGains' | 'setEqPreamp' | 'setEqBypass' | 'eqReset'
  | 'setVizStyle';

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

interface ValidatedArgs {
  args: unknown;
  error?: string;
}

/**
 * Pass-through validation for the optional `tracks` field carried by
 * playList / playOne / enqueue. Each entry must at least have a numeric
 * id; everything else is forwarded to the host without inspection
 * (host's PlayerContext owns the shape). Same-user auth already gates
 * who can send this, so we trust the structure.
 */
function sanitizeTracks(raw: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Record<string, unknown>[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const obj = t as Record<string, unknown>;
    if (!Number.isInteger(obj.id)) continue;
    out.push(obj);
  }
  return out.length > 0 ? out : null;
}

function validateArgs(action: RemoteAction, raw: unknown): ValidatedArgs {
  const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  switch (action) {
    case 'togglePlay':
    case 'next':
    case 'prev':
    case 'toggleShuffle':
    case 'cycleRepeat':
    case 'clearQueue':
      return { args: null };
    case 'seek': {
      const sec = Number(o.sec);
      if (!Number.isFinite(sec) || sec < 0) return { args: null, error: 'bad seek.sec' };
      return { args: { sec } };
    }
    case 'setVolume': {
      const v = Number(o.v);
      if (!Number.isFinite(v)) return { args: null, error: 'bad setVolume.v' };
      return { args: { v: Math.max(0, Math.min(1, v)) } };
    }
    case 'jumpTo': {
      const queueIndex = Number(o.queueIndex);
      if (!Number.isInteger(queueIndex) || queueIndex < 0) return { args: null, error: 'bad jumpTo.queueIndex' };
      return { args: { queueIndex } };
    }
    case 'playList': {
      const trackIds = Array.isArray(o.trackIds) ? o.trackIds.map(Number).filter(Number.isInteger) : null;
      if (!trackIds || trackIds.length === 0) return { args: null, error: 'bad playList.trackIds' };
      const startIndex = Number.isInteger(o.startIndex) ? o.startIndex as number : 0;
      const playlistId = Number.isInteger(o.playlistId) ? o.playlistId as number : null;
      const tracks = sanitizeTracks(o.tracks);
      return { args: { trackIds, startIndex, playlistId, tracks } };
    }
    case 'playOne': {
      const trackId = Number(o.trackId);
      if (!Number.isInteger(trackId)) return { args: null, error: 'bad playOne.trackId' };
      const tracks = sanitizeTracks(o.tracks);
      return { args: { trackId, tracks } };
    }
    case 'enqueue': {
      const trackIds = Array.isArray(o.trackIds) ? o.trackIds.map(Number).filter(Number.isInteger) : null;
      if (!trackIds || trackIds.length === 0) return { args: null, error: 'bad enqueue.trackIds' };
      const tracks = sanitizeTracks(o.tracks);
      return { args: { trackIds, tracks } };
    }
    case 'setSpatialPreset': {
      const preset = String(o.preset ?? '');
      if (!['off', 'cinema', 'hall', 'club'].includes(preset)) {
        return { args: null, error: 'bad setSpatialPreset.preset' };
      }
      return { args: { preset } };
    }
    case 'setGlobalEqEnabled': {
      if (typeof o.enabled !== 'boolean') {
        return { args: null, error: 'bad setGlobalEqEnabled.enabled' };
      }
      return { args: { enabled: o.enabled } };
    }
    case 'setEqGains': {
      const gains = Array.isArray(o.gains)
        ? o.gains.map(Number).filter((n) => Number.isFinite(n))
        : null;
      if (!gains || gains.length !== 10) {
        return { args: null, error: 'bad setEqGains.gains (need 10 finite numbers)' };
      }
      // Host clamps to [-12, 12] internally; we just guard against
      // absurd values that would suggest a bug.
      if (gains.some((g) => Math.abs(g) > 60)) {
        return { args: null, error: 'setEqGains.gains out of sane range' };
      }
      return { args: { gains } };
    }
    case 'setEqPreamp': {
      const preamp = Number(o.preamp);
      if (!Number.isFinite(preamp) || Math.abs(preamp) > 60) {
        return { args: null, error: 'bad setEqPreamp.preamp' };
      }
      return { args: { preamp } };
    }
    case 'setEqBypass': {
      if (typeof o.bypass !== 'boolean') {
        return { args: null, error: 'bad setEqBypass.bypass' };
      }
      return { args: { bypass: o.bypass } };
    }
    case 'eqReset':
      return { args: null };
    case 'setVizStyle': {
      const style = String(o.style ?? '').trim();
      if (!style || style.length > 64) {
        return { args: null, error: 'bad setVizStyle.style' };
      }
      return { args: { style } };
    }
  }
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

  // POST /api/me/remote/register
  // Body: { device_id, name? }
  // Creates or refreshes a slot under the caller's user. The slot is
  // *unconnected* until /stream is opened; that's OK — the picker can
  // still list it as offline.
  r.post('/register', (req, res) => {
    const userId = (req as any).user!.id as number;
    const deviceId = String(req.body?.device_id ?? '').trim();
    if (!deviceId || deviceId.length > 64) {
      res.status(400).json({ error: 'device_id required' });
      return;
    }
    const name = String(req.body?.name ?? '').trim()
      || deriveName(String(req.headers['user-agent'] ?? ''));
    const m = getUserMap(userId);
    let slot = m.get(deviceId);
    if (!slot) {
      slot = {
        device_id: deviceId,
        user_id: userId,
        name,
        user_agent: String(req.headers['user-agent'] ?? '').slice(0, 200),
        sse: null,
        last_state: null,
        following: null,
        last_seen_ms: Date.now(),
        grace_timer: null,
      };
      m.set(deviceId, slot);
    } else {
      slot.name = name;
      slot.last_seen_ms = Date.now();
    }
    broadcastPresence(userId);
    res.json({ ok: true, device_id: deviceId, name: slot.name });
  });

  // GET /api/me/remote/stream?device_id=<uuid>
  // Long-lived SSE channel. One per tab.
  r.get('/stream', (req, res) => {
    const userId = (req as any).user!.id as number;
    const deviceId = String(req.query.device_id ?? '').trim();
    if (!deviceId) {
      res.status(400).json({ error: 'device_id required' });
      return;
    }
    const m = getUserMap(userId);
    let slot = m.get(deviceId);
    if (!slot) {
      // Auto-create on connect (clients usually POST /register first, but
      // race conditions during reload can flip the order).
      slot = {
        device_id: deviceId,
        user_id: userId,
        name: deriveName(String(req.headers['user-agent'] ?? '')),
        user_agent: String(req.headers['user-agent'] ?? '').slice(0, 200),
        sse: null,
        last_state: null,
        following: null,
        last_seen_ms: Date.now(),
        grace_timer: null,
      };
      m.set(deviceId, slot);
    }

    // If a grace timer was running (reconnect within 30 s), cancel it.
    if (slot.grace_timer) {
      clearTimeout(slot.grace_timer);
      slot.grace_timer = null;
    }

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    slot.sse = res;
    slot.last_seen_ms = Date.now();

    sseSend(res, 'welcome', { device_id: deviceId, user_id: userId });
    broadcastPresence(userId);

    const keepalive = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* connection gone; 'close' below handles cleanup */
      }
    }, KEEPALIVE_MS);

    req.on('close', () => {
      clearInterval(keepalive);
      if (slot!.sse === res) {
        slot!.sse = null;
        // Schedule grace deletion. Reconnect within 30 s reuses the slot.
        slot!.grace_timer = setTimeout(() => {
          const cur = m.get(deviceId);
          if (cur && cur.sse === null) {
            // Notify any followers that the host went away.
            const userMap = registry.get(userId);
            if (userMap) {
              for (const other of userMap.values()) {
                if (other.following === deviceId && other.sse) {
                  sseSend(other.sse, 'host-offline', { host: deviceId });
                  other.following = null;
                }
              }
            }
            m.delete(deviceId);
            broadcastPresence(userId);
          }
        }, GRACE_MS);
        broadcastPresence(userId);
      }
    });
  });

  // GET /api/me/remote/devices?self=<deviceId>
  // Returns every slot under this user, with `is_self` set for the
  // caller's own device when query parameter `self` matches.
  r.get('/devices', (req, res) => {
    const userId = (req as any).user!.id as number;
    const self = String(req.query.self ?? '') || null;
    res.json({ devices: listDevices(userId, self) });
  });

  // POST /api/me/remote/command
  // Body: { from?, to, action, args? }
  r.post('/command', (req, res) => {
    const userId = (req as any).user!.id as number;
    const to = String(req.body?.to ?? '').trim();
    const action = String(req.body?.action ?? '').trim();
    const args = req.body?.args ?? null;
    const from = String(req.body?.from ?? '').trim() || null;

    if (!to || !action) {
      res.status(400).json({ error: 'to and action required' });
      return;
    }
    if (!ALLOWED_ACTIONS.has(action as RemoteAction)) {
      res.status(400).json({ error: 'action not allowed' });
      return;
    }
    const validated = validateArgs(action as RemoteAction, args);
    if (validated.error) {
      res.status(400).json({ error: validated.error });
      return;
    }
    const m = registry.get(userId);
    const target = m?.get(to);
    if (!target) {
      res.status(404).json({ error: 'unknown device' });
      return;
    }
    if (!target.sse) {
      res.status(409).json({ error: 'host-offline' });
      return;
    }
    sseSend(target.sse, 'command', { from, action, args: validated.args });
    res.json({ ok: true });
  });

  // POST /api/me/remote/viz
  // Body: { device_id, data: number[0..255][] }
  // Forwards live FFT frequency data to followers as a 'viz' SSE event
  // so they can render an audio visualizer that matches the host's
  // actual audio. No storage — discarded after fan-out. Rate-limited
  // implicitly by the host's own publish cadence (10 Hz currently).
  r.post('/viz', (req, res) => {
    const userId = (req as any).user!.id as number;
    const deviceId = String(req.body?.device_id ?? '').trim();
    const data = req.body?.data;
    if (!deviceId || !Array.isArray(data)) {
      res.status(400).json({ error: 'device_id and data array required' });
      return;
    }
    if (data.length > 512) {
      res.status(400).json({ error: 'data too long' });
      return;
    }
    const bytes: number[] = [];
    for (const n of data) {
      const v = Number(n);
      if (Number.isFinite(v)) bytes.push(Math.max(0, Math.min(255, Math.round(v))));
    }
    const m = registry.get(userId);
    if (!m) {
      res.status(404).json({ error: 'unknown device' });
      return;
    }
    for (const slot of m.values()) {
      if (slot.following === deviceId && slot.sse) {
        sseSend(slot.sse, 'viz', { data: bytes });
      }
    }
    res.json({ ok: true });
  });

  // POST /api/me/remote/state
  // Body: { device_id, snapshot }
  r.post('/state', (req, res) => {
    const userId = (req as any).user!.id as number;
    const deviceId = String(req.body?.device_id ?? '').trim();
    const snapshot = req.body?.snapshot;
    if (!deviceId || !snapshot || typeof snapshot !== 'object') {
      res.status(400).json({ error: 'device_id and snapshot required' });
      return;
    }
    const m = registry.get(userId);
    const slot = m?.get(deviceId);
    if (!slot) {
      res.status(404).json({ error: 'unknown device' });
      return;
    }
    slot.last_state = snapshot as Snapshot;
    slot.last_seen_ms = Date.now();
    if (m) {
      for (const other of m.values()) {
        if (other.following === deviceId && other.sse) {
          sseSend(other.sse, 'state', snapshot);
        }
      }
    }
    res.json({ ok: true });
  });

  // POST /api/me/remote/follow
  // Body: { device_id, host }
  r.post('/follow', (req, res) => {
    const userId = (req as any).user!.id as number;
    const selfId = String(req.body?.device_id ?? '').trim();
    const hostId = String(req.body?.host ?? '').trim();
    if (!selfId || !hostId) {
      res.status(400).json({ error: 'device_id and host required' });
      return;
    }
    const m = registry.get(userId);
    const me = m?.get(selfId);
    const host = m?.get(hostId);
    if (!me || !host) {
      res.status(404).json({ error: 'unknown device' });
      return;
    }
    me.following = hostId;
    broadcastPresence(userId);
    res.json({ ok: true, snapshot: host.last_state });
  });

  // POST /api/me/remote/unfollow
  // Body: { device_id }
  r.post('/unfollow', (req, res) => {
    const userId = (req as any).user!.id as number;
    const selfId = String(req.body?.device_id ?? '').trim();
    if (!selfId) {
      res.status(400).json({ error: 'device_id required' });
      return;
    }
    const m = registry.get(userId);
    const me = m?.get(selfId);
    if (me) me.following = null;
    broadcastPresence(userId);
    res.json({ ok: true });
  });

  return r;
}
