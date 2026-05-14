# Remote Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Remote" toggle on the mobile Now-Playing view that turns the phone into a silent remote control for the same user's desktop browser tab — phone mirrors host playback state and sends transport commands.

**Architecture:** SSE long-poll per browser tab + REST POST for commands/state. In-memory registry on the single Node server keyed by `userId → deviceId`. New `RemoteContext` wraps `PlayerProvider` and switches the player into "proxy mode" when active (audio paused locally, all actions forwarded as commands, displayed state read from host's snapshot). Restore snapshot in `sessionStorage` lets the phone resume local playback at the same position when the toggle goes off.

**Tech Stack:** Express, better-sqlite3 (unused for this feature), React 18 + TypeScript, Vite, Tailwind. No new dependencies — `crypto.randomUUID()` is in Node ≥14.17 and modern browsers; SSE is a plain `text/event-stream` response.

**Verification strategy:** This project has no unit-test runner. Each task verifies with `npm run build` (strict TypeScript catches most issues), plus targeted manual smoke tests against `npm run dev:web` + a local backend, or against the deployed server. The final task does end-to-end verification across two browser tabs.

---

## File Structure

```
server/src/api/
  remote.ts                          NEW — router + in-memory registry + helpers

server/src/
  index.ts                           MODIFY — mount /api/me/remote router

web/src/api.ts                       MODIFY — add 6 client methods

web/src/remote/
  RemoteContext.tsx                  NEW — provider, device id, SSE wire-up, follow state
  RemoteHostPicker.tsx               NEW — mobile popover listing online same-user devices
  RemoteBadge.tsx                    NEW — corner pill shown on host when being remoted
  sse.ts                             NEW — typed EventSource wrapper with reconnect

web/src/App.tsx                      MODIFY — wrap PlayerProvider in RemoteProvider

web/src/player/PlayerContext.tsx     MODIFY — host state publisher + proxy mode + restore action

web/src/player/NowPlayingView.tsx    MODIFY — Remote toggle button (mobile-only) + picker host + hide EQ-button when remote

web/src/player/PlayerBar.tsx         MODIFY — Remote toggle entry in mobile actions
```

The server gets one new file. The web gets four new files in `web/src/remote/` to keep the feature self-contained. Existing files only see additive changes; no large refactors.

---

## Task 1: Server — in-memory registry module

**Files:**
- Create: `server/src/api/remote.ts`

This task lays down the data structures and the Express router skeleton with NO real endpoints yet — just the empty router and the registry. Subsequent tasks add endpoints.

- [ ] **Step 1: Create the file with types and helpers**

```ts
// server/src/api/remote.ts
//
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
```

- [ ] **Step 2: Verify build**

Run: `npm run build:server`
Expected: PASS. The `db` arg is intentionally unused for now — prefixed with `_` to signal that.

- [ ] **Step 3: Commit**

```bash
git add server/src/api/remote.ts
git commit -m "feat(remote): in-memory registry skeleton for remote control"
```

---

## Task 2: Server — SSE stream + register endpoints

**Files:**
- Modify: `server/src/api/remote.ts` (extend `remoteRouter`)

Adds the long-lived SSE endpoint and the device-registration endpoint that creates/refreshes a slot. Together these two endpoints give every browser tab a presence record.

- [ ] **Step 1: Extend remoteRouter with /register and /stream**

Replace the placeholder `remoteRouter` function in `server/src/api/remote.ts` with this expanded version:

```ts
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

  return r;
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build:server`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/src/api/remote.ts
git commit -m "feat(remote): SSE stream + device registration endpoints"
```

---

## Task 3: Server — device list endpoint

**Files:**
- Modify: `server/src/api/remote.ts` (add `GET /devices`)

Read-only endpoint that's also used as a fallback when SSE hasn't yet delivered its first `presence` event.

- [ ] **Step 1: Add /devices route inside remoteRouter**

Inside the `remoteRouter` function, after the `/stream` route and before `return r;`, add:

```ts
  // GET /api/me/remote/devices?self=<deviceId>
  // Returns every slot under this user, with `is_self` set for the
  // caller's own device when query parameter `self` matches.
  r.get('/devices', (req, res) => {
    const userId = (req as any).user!.id as number;
    const self = String(req.query.self ?? '') || null;
    res.json({ devices: listDevices(userId, self) });
  });
```

- [ ] **Step 2: Verify build**

Run: `npm run build:server`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/src/api/remote.ts
git commit -m "feat(remote): GET /devices endpoint for device list"
```

---

## Task 4: Server — command, state, follow, unfollow endpoints

**Files:**
- Modify: `server/src/api/remote.ts` (add 4 routes + arg validator)

These are the active control endpoints — the ones the phone POSTs to.

- [ ] **Step 1: Add the validateArgs helper near top of file**

In `server/src/api/remote.ts`, just below `deriveName` and before `interface DeviceListEntry`, insert:

```ts
interface ValidatedArgs {
  args: unknown;
  error?: string;
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
      return { args: { trackIds, startIndex, playlistId } };
    }
    case 'playOne': {
      const trackId = Number(o.trackId);
      if (!Number.isInteger(trackId)) return { args: null, error: 'bad playOne.trackId' };
      return { args: { trackId } };
    }
    case 'enqueue': {
      const trackIds = Array.isArray(o.trackIds) ? o.trackIds.map(Number).filter(Number.isInteger) : null;
      if (!trackIds || trackIds.length === 0) return { args: null, error: 'bad enqueue.trackIds' };
      return { args: { trackIds } };
    }
  }
}
```

- [ ] **Step 2: Add the four routes inside remoteRouter**

Inside `remoteRouter`, after the `/devices` route, add:

```ts
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
    res.json({ ok: true });
  });
```

- [ ] **Step 3: Verify build**

Run: `npm run build:server`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add server/src/api/remote.ts
git commit -m "feat(remote): command/state/follow/unfollow endpoints with arg validation"
```

---

## Task 5: Server — mount the router

**Files:**
- Modify: `server/src/index.ts`

Wire the new router into the Express app, under the same `/api/me` umbrella as `prefsRouter`.

- [ ] **Step 1: Import and mount**

In `server/src/index.ts`, find the line:

```ts
import { prefsRouter } from './api/prefs.js';
```

Add right below:

```ts
import { remoteRouter } from './api/remote.js';
```

Then find the line:

```ts
app.use('/api/me', prefsRouter({ db }));
```

Add right below:

```ts
app.use('/api/me/remote', remoteRouter({ db }));
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS (full build, server + web).

- [ ] **Step 3: Manual smoke test — endpoints reachable**

Start the dev backend:

```bash
cd server && npm run dev
```

In another shell, log in and hit the new endpoints (replace `<your-admin-pw>` accordingly):

```bash
curl -i -c /tmp/jar -b /tmp/jar -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<your-admin-pw>"}' \
  http://127.0.0.1:3002/api/auth/login

curl -i -b /tmp/jar -H 'Content-Type: application/json' \
  -d '{"device_id":"smoke-test-1"}' \
  http://127.0.0.1:3002/api/me/remote/register

curl -i -b /tmp/jar "http://127.0.0.1:3002/api/me/remote/devices?self=smoke-test-1"
```

Expected: `200 OK` on each, with the devices array containing `smoke-test-1` (online: false since no SSE was opened).

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(remote): mount /api/me/remote router"
```

---

## Task 6: Frontend — api.ts client methods

**Files:**
- Modify: `web/src/api.ts`

Add six typed client methods so the frontend never builds URLs by hand.

- [ ] **Step 1: Add type exports just before `export const api = {`**

```ts
export interface RemoteDeviceEntry {
  device_id: string;
  name: string;
  is_self: boolean;
  is_host: boolean;
  online: boolean;
  last_seen_ms: number;
  following: string | null;
}

export interface RemoteSnapshot {
  schema: 1;
  current_track: {
    id: number;
    title: string;
    artist: string;
    album: string;
    cover_url: string | null;
    url: string;
  } | null;
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

export type RemoteAction =
  | 'togglePlay' | 'next' | 'prev' | 'seek' | 'setVolume' | 'jumpTo'
  | 'toggleShuffle' | 'cycleRepeat' | 'playList' | 'playOne' | 'enqueue'
  | 'clearQueue';
```

- [ ] **Step 2: Add the six methods inside `api = { ... }`**

After the existing `deleteTrackEq` entry, append:

```ts
  // ----- remote control -----
  registerRemote: (deviceId: string, name?: string) =>
    postJson<{ ok: boolean; device_id: string; name: string }>(
      '/me/remote/register',
      { device_id: deviceId, name },
    ),
  listRemoteDevices: (selfId: string) =>
    getJson<{ devices: RemoteDeviceEntry[] }>(
      `/me/remote/devices?self=${encodeURIComponent(selfId)}`,
    ),
  followHost: (selfId: string, hostId: string) =>
    postJson<{ ok: boolean; snapshot: RemoteSnapshot | null }>(
      '/me/remote/follow',
      { device_id: selfId, host: hostId },
    ),
  unfollowHost: (selfId: string) =>
    postJson<{ ok: boolean }>('/me/remote/unfollow', { device_id: selfId }),
  sendRemoteCommand: (selfId: string, to: string, action: RemoteAction, args: unknown = null) =>
    postJson<{ ok: boolean }>('/me/remote/command', {
      from: selfId,
      to,
      action,
      args,
    }),
  publishRemoteState: (deviceId: string, snapshot: RemoteSnapshot) =>
    postJson<{ ok: boolean }>('/me/remote/state', {
      device_id: deviceId,
      snapshot,
    }),
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add web/src/api.ts
git commit -m "feat(remote): typed client wrappers for remote endpoints"
```

---

## Task 7: Frontend — SSE wrapper

**Files:**
- Create: `web/src/remote/sse.ts`

A tiny typed EventSource wrapper. Browser native auto-retry handles reconnection.

- [ ] **Step 1: Create the file**

```ts
// web/src/remote/sse.ts
//
// Thin wrapper around EventSource. Browsers handle auto-reconnect; we
// add typed event registration and a clean disposer.

import type { RemoteSnapshot, RemoteDeviceEntry, RemoteAction } from '../api';

export type RemoteSseEvent =
  | { type: 'welcome'; data: { device_id: string; user_id: number } }
  | { type: 'presence'; data: { devices: RemoteDeviceEntry[] } }
  | { type: 'state'; data: RemoteSnapshot }
  | { type: 'command'; data: { from: string | null; action: RemoteAction; args: unknown } }
  | { type: 'host-offline'; data: { host: string } };

export interface RemoteSseHandle {
  close(): void;
}

export function openRemoteStream(
  deviceId: string,
  apiBase: string,
  onEvent: (ev: RemoteSseEvent) => void,
  onOpen?: () => void,
  onError?: (err: Event) => void,
): RemoteSseHandle {
  const url = `${apiBase}/me/remote/stream?device_id=${encodeURIComponent(deviceId)}`;
  const es = new EventSource(url, { withCredentials: true });

  const wrap = (type: RemoteSseEvent['type']) => (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data);
      onEvent({ type, data } as RemoteSseEvent);
    } catch {
      /* malformed payload — ignore */
    }
  };

  es.addEventListener('welcome', wrap('welcome'));
  es.addEventListener('presence', wrap('presence'));
  es.addEventListener('state', wrap('state'));
  es.addEventListener('command', wrap('command'));
  es.addEventListener('host-offline', wrap('host-offline'));

  if (onOpen) es.addEventListener('open', onOpen);
  if (onError) es.addEventListener('error', onError);

  return {
    close: () => es.close(),
  };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build:web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/remote/sse.ts
git commit -m "feat(remote): typed EventSource wrapper"
```

---

## Task 8: Frontend — RemoteContext provider + wire-up

**Files:**
- Create: `web/src/remote/RemoteContext.tsx`
- Modify: `web/src/App.tsx`

The provider owns device id, SSE connection, devices list, follow state, sendCommand, publishState. It does NOT yet touch PlayerContext — that's Tasks 9–10.

- [ ] **Step 1: Create RemoteContext.tsx**

```tsx
// web/src/remote/RemoteContext.tsx

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { api, type RemoteDeviceEntry, type RemoteSnapshot, type RemoteAction } from '../api';
import { openRemoteStream, type RemoteSseHandle } from './sse';
import { useAuth } from '../AuthContext';

const LS_DEVICE_ID = 'mw.remote.device_id';
const LS_DEVICE_NAME = 'mw.remote.device_name';
const SS_ON = 'mw.remote.on';
const SS_HOST = 'mw.remote.host';
export const SS_RESTORE = 'mw.remote.restore';

function getOrCreateDeviceId(): string {
  let id = window.localStorage.getItem(LS_DEVICE_ID);
  if (!id) {
    id = (window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    window.localStorage.setItem(LS_DEVICE_ID, id);
  }
  return id;
}

export type CommandIncoming = {
  from: string | null;
  action: RemoteAction;
  args: unknown;
};

export type RestoreSnapshot = { [k: string]: unknown };

interface RemoteContextValue {
  deviceId: string;
  devices: RemoteDeviceEntry[];
  isRemote: boolean;
  selectedHost: string | null;
  hostSnapshot: RemoteSnapshot | null;
  hostName: string | null;
  lastCommand: { seq: number; payload: CommandIncoming } | null;
  followerCount: number;
  hostOffline: boolean;

  enable(hostId: string, restoreSnapshot: RestoreSnapshot | null): Promise<void>;
  disable(): Promise<RestoreSnapshot | null>;
  sendCommand(action: RemoteAction, args?: unknown): Promise<void>;
  publishState(snapshot: RemoteSnapshot): Promise<void>;
  refreshDevices(): Promise<void>;
}

const Ctx = createContext<RemoteContextValue | null>(null);

export function useRemote(): RemoteContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useRemote must be inside RemoteProvider');
  return v;
}

export function RemoteProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const deviceId = useMemo(getOrCreateDeviceId, []);
  const [devices, setDevices] = useState<RemoteDeviceEntry[]>([]);
  const [selectedHost, setSelectedHost] = useState<string | null>(
    () => window.sessionStorage.getItem(SS_HOST) || null,
  );
  const [remoteOn, setRemoteOn] = useState<boolean>(
    () => window.sessionStorage.getItem(SS_ON) === '1',
  );
  const [hostSnapshot, setHostSnapshot] = useState<RemoteSnapshot | null>(null);
  const [lastCommand, setLastCommand] = useState<RemoteContextValue['lastCommand']>(null);
  const [hostOffline, setHostOffline] = useState(false);
  const sseRef = useRef<RemoteSseHandle | null>(null);
  const cmdSeqRef = useRef(0);

  useEffect(() => {
    if (!user) {
      sseRef.current?.close();
      sseRef.current = null;
      return;
    }
    let cancelled = false;
    api
      .registerRemote(deviceId, window.localStorage.getItem(LS_DEVICE_NAME) || undefined)
      .catch(() => {/* non-fatal */})
      .then(() => {
        if (cancelled) return;
        sseRef.current = openRemoteStream(deviceId, '/api', (ev) => {
          switch (ev.type) {
            case 'presence':
              setDevices(ev.data.devices);
              break;
            case 'state':
              setHostSnapshot(ev.data);
              setHostOffline(false);
              break;
            case 'command':
              cmdSeqRef.current += 1;
              setLastCommand({ seq: cmdSeqRef.current, payload: ev.data });
              break;
            case 'host-offline':
              setHostOffline(true);
              break;
            case 'welcome':
              break;
          }
        });
      });
    return () => {
      cancelled = true;
      sseRef.current?.close();
      sseRef.current = null;
    };
  }, [user, deviceId]);

  // Re-follow on reload if remote was active.
  useEffect(() => {
    if (!remoteOn || !selectedHost || !user) return;
    api
      .followHost(deviceId, selectedHost)
      .then((r) => setHostSnapshot(r.snapshot))
      .catch(() => setHostOffline(true));
  }, [user, remoteOn, selectedHost, deviceId]);

  const followerCount = useMemo(
    () => devices.filter((d) => d.following === deviceId).length,
    [devices, deviceId],
  );

  const hostName = useMemo(() => {
    if (!selectedHost) return null;
    return devices.find((d) => d.device_id === selectedHost)?.name ?? null;
  }, [selectedHost, devices]);

  const enable = useCallback(
    async (hostId: string, restoreSnapshot: RestoreSnapshot | null) => {
      const r = await api.followHost(deviceId, hostId);
      setSelectedHost(hostId);
      setRemoteOn(true);
      setHostSnapshot(r.snapshot);
      setHostOffline(false);
      window.sessionStorage.setItem(SS_HOST, hostId);
      window.sessionStorage.setItem(SS_ON, '1');
      if (restoreSnapshot) {
        window.sessionStorage.setItem(SS_RESTORE, JSON.stringify(restoreSnapshot));
      } else {
        window.sessionStorage.removeItem(SS_RESTORE);
      }
    },
    [deviceId],
  );

  const disable = useCallback(async (): Promise<RestoreSnapshot | null> => {
    setRemoteOn(false);
    setHostSnapshot(null);
    setHostOffline(false);
    window.sessionStorage.removeItem(SS_ON);
    window.sessionStorage.removeItem(SS_HOST);
    api.unfollowHost(deviceId).catch(() => {/* ignore */});
    const raw = window.sessionStorage.getItem(SS_RESTORE);
    window.sessionStorage.removeItem(SS_RESTORE);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RestoreSnapshot;
    } catch {
      return null;
    }
  }, [deviceId]);

  const sendCommand = useCallback(
    async (action: RemoteAction, args: unknown = null) => {
      if (!selectedHost) return;
      try {
        await api.sendRemoteCommand(deviceId, selectedHost, action, args);
      } catch (e) {
        if (String(e).includes('409')) setHostOffline(true);
      }
    },
    [selectedHost, deviceId],
  );

  const publishState = useCallback(
    async (snapshot: RemoteSnapshot) => {
      try {
        await api.publishRemoteState(deviceId, snapshot);
      } catch {
        /* next push will retry */
      }
    },
    [deviceId],
  );

  const refreshDevices = useCallback(async () => {
    try {
      const r = await api.listRemoteDevices(deviceId);
      setDevices(r.devices);
    } catch {
      /* ignore */
    }
  }, [deviceId]);

  const value: RemoteContextValue = {
    deviceId,
    devices,
    isRemote: remoteOn && !!selectedHost,
    selectedHost,
    hostSnapshot,
    hostName,
    lastCommand,
    followerCount,
    hostOffline,
    enable,
    disable,
    sendCommand,
    publishState,
    refreshDevices,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
```

- [ ] **Step 2: Wire RemoteProvider in App.tsx**

In `web/src/App.tsx`, add the import:

```tsx
import { RemoteProvider } from './remote/RemoteContext';
```

Then find and REPLACE the `AuthGate` return:

```tsx
  return (
    <PrefsProvider>
      <PlayerProvider>
        <AppContent />
        {!!user.must_change_password && <ChangePasswordModal forced />}
      </PlayerProvider>
    </PrefsProvider>
  );
```

with:

```tsx
  return (
    <PrefsProvider>
      <RemoteProvider>
        <PlayerProvider>
          <AppContent />
          {!!user.must_change_password && <ChangePasswordModal forced />}
        </PlayerProvider>
      </RemoteProvider>
    </PrefsProvider>
  );
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Manual smoke test — SSE connects**

```bash
npm run dev:web
```

Start the backend in a separate terminal. Open the app in two browser tabs and log in. In each tab's DevTools → Network → filter "stream": confirm a long-lived `text/event-stream` request, plus `event: welcome` and `event: presence` frames. Tab A's presence event should list Tab B and vice versa.

- [ ] **Step 5: Commit**

```bash
git add web/src/remote/RemoteContext.tsx web/src/App.tsx
git commit -m "feat(remote): RemoteContext provider with SSE wire-up"
```

---

## Task 9: Frontend — host-side state publisher in PlayerContext

**Files:**
- Modify: `web/src/player/PlayerContext.tsx`

Every PlayerProvider publishes its current state on transport edges so any phone following can mirror it. Position is sent as a keyframe only — phone interpolates locally.

- [ ] **Step 1: Add imports at top of file**

Right after the existing imports in `web/src/player/PlayerContext.tsx`, add:

```tsx
import { useRemote } from '../remote/RemoteContext';
import type { RemoteSnapshot, RemoteAction } from '../api';
```

- [ ] **Step 2: Add the publishing block just before `const value: PlayerContextValue = {`**

Find the line that defines `const value: PlayerContextValue = {` (around line 779). Just BEFORE that line, insert:

```tsx
  // -----------------------------------------------------------------
  // Remote control: publish state for followers + listen for commands.
  // -----------------------------------------------------------------
  const remote = useRemote();

  const buildSnapshot = useCallback((): RemoteSnapshot => ({
    schema: 1,
    current_track: current
      ? {
          id: current.id,
          title: current.title,
          artist: current.artist,
          album: current.album,
          cover_url: current.cover_url ?? null,
          url: current.url,
        }
      : null,
    duration_sec: duration,
    queue_ids: queue.map((t) => t.id),
    cursor: currentQueueIndex,
    current_playlist_id: currentPlaylistId,
    is_playing: isPlaying,
    shuffle,
    repeat,
    position_sec: position,
    position_at_server_ms: Date.now(),
  }), [
    current,
    duration,
    queue,
    currentQueueIndex,
    currentPlaylistId,
    isPlaying,
    shuffle,
    repeat,
    position,
  ]);

  // Edge publish: re-publishes 50 ms after any tracked state changes.
  useEffect(() => {
    const t = window.setTimeout(() => {
      remote.publishState(buildSnapshot());
    }, 50);
    return () => window.clearTimeout(t);
  }, [
    current?.id,
    isPlaying,
    shuffle,
    repeat,
    queue.length,
    currentQueueIndex,
    currentPlaylistId,
    duration,
    remote,
    buildSnapshot,
  ]);

  // Safety resend every 15 s while a track is loaded.
  useEffect(() => {
    if (!current) return;
    const t = window.setInterval(() => {
      remote.publishState(buildSnapshot());
    }, 15_000);
    return () => window.clearInterval(t);
  }, [current?.id, remote, buildSnapshot]);

  // Re-publish on seek edges (rounded position so it doesn't fire 4×/s).
  useEffect(() => {
    if (!current) return;
    const t = window.setTimeout(() => {
      remote.publishState(buildSnapshot());
    }, 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Math.round(position)]);
```

- [ ] **Step 3: Verify build**

Run: `npm run build:web`
Expected: PASS.

- [ ] **Step 4: Manual smoke test — host publishes**

Run dev. Two tabs logged in. In Tab A start playing. In Tab A's DevTools → Network → filter on `state`: you should see `POST /api/me/remote/state` requests fire on play/pause/track-change, but NOT every second while playing (only every 15 s as safety resend).

- [ ] **Step 5: Commit**

```bash
git add web/src/player/PlayerContext.tsx
git commit -m "feat(remote): host-side state publishing on transport edges"
```

---

## Task 10: Frontend — PlayerContext proxy mode + restore action

**Files:**
- Modify: `web/src/player/PlayerContext.tsx`

When `remote.isRemote === true`, the value returned by `usePlayer()` is built from the host's snapshot with RPC actions; local audio is paused and locked.

- [ ] **Step 1: Add RestoreLocalSnapshot interface and update PlayerActions**

Near the top of the file, just after the `PlayerState` interface (around line 169), add:

```ts
export interface RestoreLocalSnapshot {
  queue: Track[];
  cursor: number;
  shuffledOrder: number[];
  position_sec: number;
  was_playing: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  current_playlist_id: number | null;
}
```

In the `PlayerActions` interface, add at the end:

```ts
  restoreLocalPlayback: (snap: RestoreLocalSnapshot) => void;
```

- [ ] **Step 2: Add restoreLocalPlayback implementation**

Just BEFORE the `remote = useRemote()` block (which you added in Task 9), insert:

```tsx
  const restoreLocalPlayback = useCallback(
    (snap: RestoreLocalSnapshot) => {
      setQueue(snap.queue);
      setCursor(snap.cursor);
      setShuffledOrder(snap.shuffledOrder);
      setShuffle(snap.shuffle);
      setRepeat(snap.repeat);
      setCurrentPlaylistId(snap.current_playlist_id);
      const audio = audioRef.current;
      if (audio && snap.queue.length > 0 && snap.cursor >= 0) {
        const handler = () => {
          audio.currentTime = snap.position_sec;
          if (snap.was_playing) {
            audio.play().catch(() => {/* autoplay blocked */});
          }
          audio.removeEventListener('loadedmetadata', handler);
        };
        audio.addEventListener('loadedmetadata', handler);
      }
    },
    [],
  );
```

- [ ] **Step 3: Force-pause local audio when remote is on**

Find the existing effect that syncs `<audio>` src (around line 488):

```tsx
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (current) {
      if (audio.src !== current.url) {
        audio.src = current.url;
      }
      ensureAudioGraph();
      audio.play().catch(() => {
        setIsPlaying(false);
      });
    } else {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
  }, [current]);
```

REPLACE with:

```tsx
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (remote.isRemote) {
      audio.pause();
      return;
    }
    if (current) {
      if (audio.src !== current.url) {
        audio.src = current.url;
      }
      ensureAudioGraph();
      audio.play().catch(() => {
        setIsPlaying(false);
      });
    } else {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
  }, [current, remote.isRemote]);
```

- [ ] **Step 4: Build the proxy value and final `value` selector**

Replace the existing `const value: PlayerContextValue = { ... };` block at the bottom of `PlayerProvider` with:

```tsx
  // Ticker to make the proxy progress bar live-update.
  const [proxyTick, setProxyTick] = useState(0);
  useEffect(() => {
    if (!remote.isRemote) return;
    if (!remote.hostSnapshot?.is_playing) return;
    const t = window.setInterval(() => setProxyTick((x) => x + 1), 250);
    return () => window.clearInterval(t);
  }, [remote.isRemote, remote.hostSnapshot?.is_playing]);
  void proxyTick;

  function buildRemoteValue(): PlayerContextValue {
    const snap = remote.hostSnapshot;
    const t = snap?.current_track ?? null;
    const remoteTrack: Track | null = t
      ? ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          album: t.album,
          cover_url: t.cover_url,
          url: t.url,
          duration_sec: snap?.duration_sec ?? 0,
          rel_path: '',
          rating: 0,
          favorited: false,
        } as unknown as Track)
      : null;
    const remoteQueue: Track[] = (snap?.queue_ids ?? []).map((id) =>
      id === t?.id && remoteTrack ? remoteTrack : ({ id } as Track),
    );
    const livePosition = snap
      ? snap.position_sec + (snap.is_playing
          ? Math.max(0, (Date.now() - snap.position_at_server_ms) / 1000)
          : 0)
      : 0;
    const rpc = (action: RemoteAction, args: unknown = null) =>
      remote.sendCommand(action, args);

    return {
      queue: remoteQueue,
      cursor: snap?.cursor ?? -1,
      shuffledOrder: [],
      isPlaying: !!snap?.is_playing,
      position: livePosition,
      duration: snap?.duration_sec ?? 0,
      volume,
      shuffle: !!snap?.shuffle,
      repeat: snap?.repeat ?? 'off',
      current: remoteTrack,
      currentPlaylistId: snap?.current_playlist_id ?? null,
      playList: (tracks, startIndex, playlistId) =>
        rpc('playList', {
          trackIds: tracks.map((x) => x.id),
          startIndex: startIndex ?? 0,
          playlistId,
        }),
      playOne: (track) => rpc('playOne', { trackId: track.id }),
      enqueue: (tracks) => rpc('enqueue', { trackIds: tracks.map((x) => x.id) }),
      togglePlay: () => rpc('togglePlay'),
      next: () => rpc('next'),
      prev: () => rpc('prev'),
      jumpTo: (queueIndex) => rpc('jumpTo', { queueIndex }),
      seek: (sec) => rpc('seek', { sec }),
      setVolume: (v) => rpc('setVolume', { v }),
      toggleShuffle: () => rpc('toggleShuffle'),
      cycleRepeat: () => rpc('cycleRepeat'),
      clearQueue: () => rpc('clearQueue'),
      restoreLocalPlayback,
      getAnalyser: () => null,
      eq: eqController,
      spatial: {
        preset: spatialPreset,
        setPreset: setSpatialPreset,
        cycle: () => {
          const i = SPATIAL_PRESETS.indexOf(spatialPreset);
          setSpatialPreset(SPATIAL_PRESETS[(i + 1) % SPATIAL_PRESETS.length]);
        },
      },
      globalEq: {
        enabled: globalEqEnabled,
        setEnabled: (b: boolean) => setPref('global_eq_enabled', b),
      },
    };
  }

  const localValue: PlayerContextValue = {
    queue,
    cursor,
    shuffledOrder,
    isPlaying,
    position,
    duration,
    volume,
    shuffle,
    repeat,
    current,
    currentPlaylistId,
    playList,
    playOne,
    enqueue,
    togglePlay,
    next,
    prev,
    jumpTo,
    seek,
    setVolume,
    toggleShuffle,
    cycleRepeat,
    clearQueue,
    restoreLocalPlayback,
    getAnalyser: () => analyserRef.current,
    eq: eqController,
    spatial: {
      preset: spatialPreset,
      setPreset: setSpatialPreset,
      cycle: () => {
        const i = SPATIAL_PRESETS.indexOf(spatialPreset);
        setSpatialPreset(SPATIAL_PRESETS[(i + 1) % SPATIAL_PRESETS.length]);
      },
    },
    globalEq: {
      enabled: globalEqEnabled,
      setEnabled: (b: boolean) => setPref('global_eq_enabled', b),
    },
  };

  const value: PlayerContextValue = remote.isRemote ? buildRemoteValue() : localValue;
```

- [ ] **Step 5: Verify build**

Run: `npm run build:web`
Expected: PASS. If TypeScript complains about Track properties (`duration_sec`, `rel_path`, etc.), confirm the `as unknown as Track` cast is present.

- [ ] **Step 6: Commit**

```bash
git add web/src/player/PlayerContext.tsx
git commit -m "feat(remote): PlayerContext proxy mode and restoreLocalPlayback"
```

---

## Task 11: Frontend — host-side command execution

**Files:**
- Modify: `web/src/player/PlayerContext.tsx`

Host listens for incoming commands via `remote.lastCommand` and applies them to its local player.

- [ ] **Step 1: Add the command-applying effect**

Inside `PlayerProvider`, just after the state-publish effects, add:

```tsx
  const lastCmdSeqRef = useRef(0);

  const applyTrackIdsAction = useCallback(
    async (action: 'playList' | 'playOne' | 'enqueue', a: Record<string, unknown>) => {
      const ids: number[] = action === 'playOne'
        ? [Number(a.trackId)]
        : (Array.isArray(a.trackIds) ? (a.trackIds as number[]) : []);
      if (ids.length === 0) return;
      const known = new Map<number, Track>();
      for (const t of queue) known.set(t.id, t);
      // No bulk-by-ids endpoint yet. We rely on the host already having
      // the tracks in its current queue (the common case for "tap track
      // in queue" commands). Cross-library jumps are a documented
      // follow-up — see plan §"Known limitation".
      const resolved = ids.map((id) => known.get(id)).filter(Boolean) as Track[];
      if (resolved.length === 0) return;
      if (action === 'playList') {
        playList(resolved, Number(a.startIndex) || 0, a.playlistId as number | undefined);
      } else if (action === 'playOne') {
        playOne(resolved[0]);
      } else {
        enqueue(resolved);
      }
    },
    [queue, playList, playOne, enqueue],
  );

  useEffect(() => {
    if (remote.isRemote) return; // we're a remote ourselves — don't apply
    const ev = remote.lastCommand;
    if (!ev) return;
    if (ev.seq === lastCmdSeqRef.current) return;
    lastCmdSeqRef.current = ev.seq;

    const { action, args } = ev.payload;
    const a = (args ?? {}) as Record<string, unknown>;
    switch (action) {
      case 'togglePlay': togglePlay(); break;
      case 'next': next(); break;
      case 'prev': prev(); break;
      case 'seek':
        if (typeof a.sec === 'number') seek(a.sec);
        break;
      case 'setVolume':
        if (typeof a.v === 'number') setVolume(a.v);
        break;
      case 'jumpTo':
        if (typeof a.queueIndex === 'number') jumpTo(a.queueIndex);
        break;
      case 'toggleShuffle': toggleShuffle(); break;
      case 'cycleRepeat': cycleRepeat(); break;
      case 'clearQueue': clearQueue(); break;
      case 'playList':
      case 'playOne':
      case 'enqueue':
        applyTrackIdsAction(action, a);
        break;
    }
  }, [
    remote.lastCommand,
    remote.isRemote,
    togglePlay, next, prev, seek, setVolume, jumpTo,
    toggleShuffle, cycleRepeat, clearQueue, applyTrackIdsAction,
  ]);
```

- [ ] **Step 2: Verify build**

Run: `npm run build:web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/player/PlayerContext.tsx
git commit -m "feat(remote): host-side command execution from SSE"
```

---

## Task 12: Frontend — RemoteHostPicker component

**Files:**
- Create: `web/src/remote/RemoteHostPicker.tsx`

A popover listing online same-user devices.

- [ ] **Step 1: Create the file**

```tsx
// web/src/remote/RemoteHostPicker.tsx
import { useEffect, useState } from 'react';
import { useRemote } from './RemoteContext';
import { usePlayer } from '../player/PlayerContext';
import type { RestoreLocalSnapshot } from '../player/PlayerContext';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function RemoteHostPicker({ open, onClose }: Props) {
  const remote = useRemote();
  const player = usePlayer();
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (open) remote.refreshDevices();
  }, [open, remote]);

  if (!open) return null;

  const eligible = remote.devices.filter(
    (d) => !d.is_self && d.online && !d.following,
  );

  async function pick(deviceId: string) {
    setBusy(deviceId);
    const snap: RestoreLocalSnapshot = {
      queue: player.queue,
      cursor: player.cursor,
      shuffledOrder: player.shuffledOrder,
      position_sec: player.position,
      was_playing: player.isPlaying,
      shuffle: player.shuffle,
      repeat: player.repeat,
      current_playlist_id: player.currentPlaylistId,
    };
    try {
      await remote.enable(deviceId, snap as unknown as Record<string, unknown>);
      onClose();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 text-zinc-100 w-full md:w-96 rounded-t-2xl md:rounded-2xl p-4 max-h-[70vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold mb-3">选择遥控目标</h2>
        {eligible.length === 0 ? (
          <div className="text-sm text-zinc-400 py-6 text-center">
            没有其他在线设备。
            <button
              className="block mx-auto mt-3 px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-xs"
              onClick={() => remote.refreshDevices()}
            >
              刷新
            </button>
          </div>
        ) : (
          <ul className="space-y-2">
            {eligible.map((d) => (
              <li key={d.device_id}>
                <button
                  className="w-full flex items-center justify-between rounded-lg bg-zinc-800 hover:bg-zinc-700 px-3 py-2 disabled:opacity-50"
                  disabled={busy === d.device_id}
                  onClick={() => pick(d.device_id)}
                >
                  <span className="flex flex-col items-start">
                    <span className="text-sm font-medium">{d.name}</span>
                    {d.is_host && (
                      <span className="text-xs text-fuchsia-400">正在播放</span>
                    )}
                  </span>
                  <span className="text-xs text-zinc-400">
                    {busy === d.device_id ? '连接中…' : '选这个'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          className="mt-4 w-full py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-sm"
          onClick={onClose}
        >
          取消
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build:web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add web/src/remote/RemoteHostPicker.tsx
git commit -m "feat(remote): host picker popover"
```

---

## Task 13: Frontend — Remote toggle in NowPlayingView

**Files:**
- Modify: `web/src/player/NowPlayingView.tsx`

Mobile-only Remote button. Opens picker when off; calls `disable()` + restores local playback when on. Also hides the EQ button while in remote mode.

- [ ] **Step 1: Add imports**

At the top of `web/src/player/NowPlayingView.tsx`, alongside the existing imports, add:

```tsx
import { useRemote } from '../remote/RemoteContext';
import RemoteHostPicker from '../remote/RemoteHostPicker';
import type { RestoreLocalSnapshot } from './PlayerContext';
```

- [ ] **Step 2: Add state + handler in component**

Inside `NowPlayingView`, alongside the other `useState` declarations:

```tsx
  const remote = useRemote();
  const [hostPickerOpen, setHostPickerOpen] = useState(false);

  async function toggleRemote() {
    if (remote.isRemote) {
      const restore = await remote.disable();
      if (restore) {
        p.restoreLocalPlayback(restore as unknown as RestoreLocalSnapshot);
      }
    } else {
      setHostPickerOpen(true);
    }
  }
```

- [ ] **Step 3: Render the toggle button + picker + offline banner**

Locate where the selected skin component (`<VinylSkin ... />` etc.) is rendered. Immediately BEFORE that, add:

```tsx
      <button
        type="button"
        onClick={toggleRemote}
        className={`md:hidden fixed top-3 right-14 z-40 rounded-full px-3 py-1.5 text-xs font-medium backdrop-blur ${
          remote.isRemote
            ? 'bg-fuchsia-600/90 text-white'
            : 'bg-zinc-900/60 text-zinc-200 hover:bg-zinc-800/80'
        }`}
        aria-label={remote.isRemote ? '退出遥控器' : '开启遥控器'}
      >
        {remote.isRemote ? `📱 → ${remote.hostName ?? '?'}` : '📱 遥控器'}
      </button>

      {remote.isRemote && remote.hostOffline && (
        <div className="md:hidden fixed top-14 left-3 right-3 z-40 rounded-lg bg-rose-700/95 text-white text-xs px-3 py-2 flex items-center justify-between gap-2">
          <span>host 已离线</span>
          <div className="flex gap-2">
            <button
              className="px-2 py-1 rounded bg-rose-900/60 hover:bg-rose-900"
              onClick={() => setHostPickerOpen(true)}
            >
              换一个
            </button>
            <button
              className="px-2 py-1 rounded bg-rose-900/60 hover:bg-rose-900"
              onClick={toggleRemote}
            >
              关闭
            </button>
          </div>
        </div>
      )}

      <RemoteHostPicker open={hostPickerOpen} onClose={() => setHostPickerOpen(false)} />
```

- [ ] **Step 4: Hide EQ button while remote is on**

Search the same file for the EQ button (look for `setEqOpen` in JSX). Wrap its existing JSX in:

```tsx
      {!remote.isRemote && (
        /* the existing EQ button JSX, unchanged */
      )}
```

- [ ] **Step 5: Verify build**

Run: `npm run build:web`
Expected: PASS.

- [ ] **Step 6: Manual smoke test — full flow**

```bash
npm run dev:web
```

In a separate terminal start the backend.

1. Open desktop browser tab, log in, start playing a track.
2. Open phone tab (mobile width, or resize to <768px and reload).
3. Phone: open NowPlayingView, tap "📱 遥控器" → picker shows desktop → tap it.
4. Phone now shows desktop's track. Position bar ticks.
5. Tap next, prev, seek, pause/play on phone → desktop reacts audibly.
6. Tap the (now fuchsia) button to turn remote off → phone restores its previous local track from where it had paused.

- [ ] **Step 7: Commit**

```bash
git add web/src/player/NowPlayingView.tsx
git commit -m "feat(remote): Remote toggle button + host-offline banner in mobile Now Playing"
```

---

## Task 14: Frontend — RemoteBadge on host

**Files:**
- Create: `web/src/remote/RemoteBadge.tsx`
- Modify: `web/src/App.tsx`

Small fuchsia pill in the desktop's bottom-right, visible when a phone is following this tab.

- [ ] **Step 1: Create the badge**

```tsx
// web/src/remote/RemoteBadge.tsx
import { useState } from 'react';
import { useRemote } from './RemoteContext';

export default function RemoteBadge() {
  const remote = useRemote();
  const [dismissed, setDismissed] = useState(false);

  if (remote.followerCount === 0 || dismissed) return null;
  if (remote.isRemote) return null;

  return (
    <button
      type="button"
      onClick={() => setDismissed(true)}
      className="hidden md:flex fixed bottom-24 right-4 z-40 items-center gap-2 rounded-full bg-fuchsia-600/95 text-white text-xs font-medium px-3 py-1.5 shadow-lg hover:bg-fuchsia-500"
      title="手机正在遥控此页面 — 点击隐藏"
    >
      <span aria-hidden>📱</span>
      <span>手机正在遥控</span>
      {remote.followerCount > 1 && <span>×{remote.followerCount}</span>}
    </button>
  );
}
```

- [ ] **Step 2: Render in App.tsx**

In `web/src/App.tsx`, add the import:

```tsx
import RemoteBadge from './remote/RemoteBadge';
```

Inside `AppContent`'s returned JSX, append `<RemoteBadge />` right after `<NowPlayingView ... />` (so it's the last sibling inside the outer div).

- [ ] **Step 3: Verify build**

Run: `npm run build:web`
Expected: PASS.

- [ ] **Step 4: Manual smoke test — badge appears on host**

Desktop tab + phone tab both logged in. Phone enters remote mode following the desktop. Desktop should now show a fuchsia "📱 手机正在遥控" pill in the bottom-right area. Clicking it dismisses for this page-load.

- [ ] **Step 5: Commit**

```bash
git add web/src/remote/RemoteBadge.tsx web/src/App.tsx
git commit -m "feat(remote): host-side badge when being remoted"
```

---

## Task 15: Final end-to-end verification + deploy

No code changes — this is the gate before deploy.

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: PASS (both server and web).

- [ ] **Step 2: End-to-end manual scenarios (run each in order)**

1. **Basic flow** — Desktop plays track. Phone toggles Remote → picker → desktop. Phone shows desktop's track. Phone tap next/prev/seek/pause/play/shuffle/repeat → all reflected on desktop.
2. **Restore** — Phone tap Remote off → phone resumes its prior local track from saved position.
3. **Reload during remote** — Phone is in remote, refresh phone. After auth+SSE reconnect, phone is still in remote mode showing desktop state.
4. **Host disconnects** — Close desktop tab while phone is remote. Within 30 s phone shows rose "host 已离线" banner. Tap 关闭 → phone returns to local.
5. **No other devices** — Solo session, tap Remote → picker says "没有其他在线设备" + Refresh button.
6. **Two remotes one host** — Two phone tabs both following the desktop. Both phones' state pushes work; commands from either land on host.
7. **Host badge** — On desktop, while a phone is following, fuchsia pill visible bottom-right; dismiss works per page-load.
8. **EQ panel hidden** — While remote is on, the phone's EQ button is gone from NowPlayingView.

- [ ] **Step 3: Commit any final tweaks** (only if any of the scenarios required a fix)

- [ ] **Step 4: Deploy**

```bash
git push
ssh showbox@debian 'sudo /opt/music-station/deploy.sh'
```

Expected: `==> [music-station] done` + 200 from the health probe.

- [ ] **Step 5: Verify on production URL**

Open <https://debian.tail4cfa2.ts.net/app/> on phone + desktop, log in same account, repeat Scenario 1.

---

## Self-review

**Spec coverage:**
- Goal / non-goals → covered in plan header
- User flow → Task 13 (toggle + picker) + Task 11 (host execution)
- Architecture / registry → Tasks 1–4
- Server API endpoints → Tasks 1–4, mounted in Task 5
- Commands whitelist + validation → Task 4 (ALLOWED_ACTIONS + validateArgs)
- Snapshot shape → Task 6 (types), Task 9 (publish), Task 10 (consume)
- Client architecture (new files) → Tasks 7, 8, 12, 14
- Proxy mode → Task 10
- Local-state restore → Task 10 (action) + Task 12 (capture on enable)
- Persistence keys → Task 8 (RemoteContext)
- Edge cases:
  - Grace deletion (30 s) → Task 2
  - host-offline banner → Task 13
  - No-other-devices picker copy → Task 12
  - Reload-during-remote → Task 8 (re-follow effect)
- Security → Task 2 + Task 4 (every endpoint scopes by req.user.id)

**Placeholders:** None. Every step shows complete code blocks; every command is concrete; no "TBD".

**Type consistency:**
- `RemoteSnapshot` defined in Task 6 (web `api.ts`) and Task 1 (server `remote.ts` — same shape, separate copy intentionally since server and web don't share types).
- `RestoreLocalSnapshot` defined once in Task 10 (`PlayerContext.tsx`), imported in Tasks 12, 13.
- `RemoteAction` defined once in Task 6, re-used in Tasks 7, 8, 10.
- `restoreLocalPlayback` action name consistent across Tasks 10, 13.

**Known limitation:** Task 11's `playList`/`enqueue` for tracks not in the host's current queue falls back gracefully (no-op) because the project lacks a `GET /api/tracks?ids=` endpoint. Common cases (queue jumps) work. Adding `?ids=` support is a documented follow-up — out of scope for this plan.
