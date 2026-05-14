# Remote Control — Phone-as-Remote for Web Player

**Status:** Approved design — pending implementation plan
**Author:** Claude Code + showbox88
**Date:** 2026-05-13

## Goal

Let the same user, logged in on phone + desktop, use the phone's existing
"Now Playing" UI as a **remote control** for the desktop's player. Phone
emits no sound while remote is on; phone shows host's data; phone's
controls drive host's playback.

When remote is turned off, the phone returns to its previous local
playback point (same track, same position, same play/pause state).

## Non-goals

- Cross-user control (Spotify-style social sharing). Strictly same user.
- "Cast" to dumb speakers / Chromecast / AirPlay. We're controlling another
  browser running the same app, not an external sink.
- Multi-room sync (two desktops playing the same track in sync).
- Remoting EQ / spatial / skin / visualizer settings. Those stay local to
  the host. See §4 *Commands*.
- Persisting remote state across browser tabs (each tab = one device).
- DB schema changes. Presence is in-memory only.

## User flow

1. User logs in on desktop, starts playing.
2. User logs in on phone (same account), starts playing something else
   on the phone.
3. Phone user taps the new **Remote** icon in the mobile Now-Playing view.
4. A picker shows the same-user devices currently online (e.g.
   "Chrome / Windows", "Edge / Windows"). User taps one.
5. Phone:
   - Pauses local `<audio>` and snapshots its queue + cursor + position
     + `is_playing` to `sessionStorage`.
   - Subscribes to host's player state via SSE.
   - Re-renders the same Now Playing view, but bound to host's snapshot.
   - All transport buttons send commands to host.
6. User taps next / seeks / picks a queue item — host audibly changes.
7. User taps Remote icon again to turn it off. Phone restores the
   sessionStorage snapshot to its own `PlayerContext`, seeks the
   `<audio>` to the saved position, and resumes if previously playing.

## Architecture

```
┌──────────┐    SSE: state, presence, host-offline    ┌──────────┐
│  PHONE   │◄────────────────────────────────────────┤  NODE    │
│ (remote) │                                          │  SERVER  │
│          ├──POST /api/me/remote/command────────────►│          │
│          │                                          │ in-mem   │
└──────────┘                                          │ registry │
                                                      │          │
                                                      │          │
┌──────────┐                                          │          │
│ DESKTOP  │◄──SSE: command, presence────────────────┤          │
│  (host)  │                                          │          │
│          ├──POST /api/me/remote/state──────────────►│          │
└──────────┘                                          └──────────┘
```

Single Node process, single in-memory registry. No DB. No Redis. If the
server restarts, every browser reconnects via standard `EventSource`
auto-reconnect and re-registers; nothing is lost beyond the live
in-flight state.

### Server-side registry

```ts
type DeviceId = string;        // UUID, client-generated
type UserId = number;

interface DeviceSlot {
  device_id: DeviceId;
  user_id: UserId;
  name: string;                // "Chrome / Windows" auto, user-renamable later
  user_agent: string;
  sse: express.Response | null;       // active SSE stream or null
  last_state: Snapshot | null;        // last state published by this device (host role)
  following: DeviceId | null;          // if this device is currently a remote, target host
  last_seen_ms: number;
}

const registry: Map<UserId, Map<DeviceId, DeviceSlot>> = new Map();
```

A device is "online" when `sse !== null`. When the SSE connection closes
(client disconnect, network drop), the slot stays around for 30 s of
grace then is deleted. This stops the host-picker from flapping during
brief network blips.

A device that has `following === X` is a "remote following X". Multiple
remotes can follow the same host; that's allowed.

### Why SSE (not WS, not polling)

- **SSE** is one ~50-line addition to Express, no new deps. Browsers
  reconnect automatically. Perfect for state push.
- Commands are tiny POSTs — REST is fine, more debuggable, idempotent
  retries are free.
- WebSocket would be overkill for ≤10 users and adds an HTTP upgrade
  dance behind Tailscale serve.
- Polling wastes battery and gives 250–500 ms button latency.

### Single-process assumption

The server runs as one systemd unit on the Debian VM. The in-memory map
is therefore the single source of truth. If we ever scale to multiple
worker processes, we'd add a Redis pub/sub broker — out of scope.

## Server API

All routes mount at `/api/me/remote` (already gated by `requireAuth`).

### `GET /api/me/remote/stream`

Establishes the SSE channel. Each browser tab opens exactly one. The
server uses `req.user.id` from the auth middleware; the client passes
`?device_id=<uuid>` so the server knows which slot to fill.

Response headers:
```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

Server writes a keepalive comment `: ping\n\n` every 25 s so proxies
don't reap idle connections.

Event types pushed to a client:

| event | when | data |
|---|---|---|
| `welcome` | on connect | `{device_id, user_id}` |
| `presence` | this user's online devices changed | `{devices: DeviceListEntry[]}` |
| `command` | only to hosts: a remote has issued a command | `{from, action, args}` |
| `state` | only to followers: target host's state changed | `Snapshot` |
| `host-offline` | only to followers: target host disconnected | `{host: deviceId}` |

### `POST /api/me/remote/register`

Body: `{ device_id: string, name?: string }`

If `device_id` is unknown for this user, creates a slot. If known,
updates `name` and `last_seen_ms`. Returns the slot summary. Called
right after the SSE handshake (or before — order doesn't matter, since
we accept register before stream open and just hold state).

**Auto-name fallback:** if `name` is missing/empty, server derives one
from the `User-Agent` header — `"<Browser> / <OS>"` (e.g. "Chrome /
Windows"). Bare-minimum UA sniff, OK if it's "Unknown / Unknown" for
weird agents.

### `GET /api/me/remote/devices`

Returns `{ devices: DeviceListEntry[] }` where:

```ts
interface DeviceListEntry {
  device_id: string;
  name: string;
  is_self: boolean;            // this == the requesting tab
  is_host: boolean;            // currently has a last_state (i.e. has actively been a host)
  online: boolean;             // sse connected
  last_seen_ms: number;
  following: string | null;    // who this device is currently remoting (usually null)
}
```

Used as a one-shot fallback for the picker if SSE hasn't delivered a
`presence` event yet.

### `POST /api/me/remote/command`

Body: `{ to: deviceId, action: string, args?: any }`

Verifies:
- target device exists for this user
- target is online (`sse !== null`)
- `action` is in the allowed whitelist (§4)

On success, pushes an SSE `command` event to the target with
`{from: senderDeviceId, action, args}`. Returns `{ok: true}`.

On any failure (offline target, bad action) returns 4xx and the phone
shows a transient toast.

### `POST /api/me/remote/state`

Body: a `Snapshot` (§5).

Stores it as `slot.last_state` for the calling device. Pushes an SSE
`state` event to every device whose `following == this.device_id`.

### `POST /api/me/remote/follow`

Body: `{ host: deviceId }`. Sets the caller's `following` field. If host
is online, server immediately replies with the host's `last_state` so
the phone has data to render before the next state push.

Errors out if host isn't in this user's registry.

### `POST /api/me/remote/unfollow`

Clears the caller's `following`. Cheap and idempotent.

## Commands whitelist

Phone may issue these (mirroring `PlayerContext` action surface):

```
togglePlay
next
prev
seek                { sec: number }
setVolume           { v: number /* 0..1 */ }
jumpTo              { queueIndex: number }
toggleShuffle
cycleRepeat
playList            { trackIds: number[], startIndex?: number, playlistId?: number }
playOne             { trackId: number }
enqueue             { trackIds: number[] }
clearQueue
```

**Not** in the whitelist:
- EQ controls (`eq.setGain`, `eq.setPreamp`, `eq.setBypass`, `eq.reset`)
- `spatial.setPreset`, `spatial.cycle`
- `globalEq.setEnabled`
- skin / visualizer / language prefs

Rationale: these change *how the host's audio sounds at host*, but the
remote user can't hear it from across the room, so adjusting them
remotely is bad UX. Anything they want to tweak there, they walk over
to the desktop.

## Snapshot shape (host → server → phone)

```ts
interface Snapshot {
  schema: 1;

  // Track-level
  current_track: TrackSummary | null;     // null = idle
  duration_sec: number;                    // 0 when idle

  // Queue (just ids; phone resolves details by hitting /api/tracks if
  // it doesn't already have them cached locally)
  queue_ids: number[];
  cursor: number;                          // -1 = idle
  current_playlist_id: number | null;

  // Transport
  is_playing: boolean;
  shuffle: boolean;
  repeat: 'off' | 'one' | 'all';

  // Position — sent as a keyframe + the server's wallclock when this
  // snapshot was generated. Phone computes live position locally as:
  //   position = position_sec + (is_playing ? (now - position_at_server_ms) / 1000 : 0)
  position_sec: number;
  position_at_server_ms: number;
}

interface TrackSummary {
  id: number;
  title: string;
  artist: string;
  album: string;
  cover_url: string | null;
  url: string;       // streaming URL — phone uses for nothing audible, but keeps for parity
}
```

**When does the host publish state?**

1. On every PlayerContext state transition that changes anything in the
   snapshot fields above (debounced 50 ms to coalesce React batches).
2. On every transport edge: play → pause, pause → play, track change,
   seek end, shuffle toggle, repeat cycle, queue mutation.
3. **NOT on `timeupdate`.** Position is reconstructed client-side from
   the keyframe.
4. Force-resend every 15 s as a safety net (clock drift, missed events).

## Client architecture

### New files

- `web/src/remote/RemoteContext.tsx`
  - Owns: `deviceId`, `eventSource`, `devices`, `selectedHost`,
    `isRemote`, `hostSnapshot`, `restoreSnapshot`, `connectionStatus`
  - Methods: `enable(hostId)`, `disable()`, `sendCommand(action, args)`,
    `renameSelf(name)`
- `web/src/remote/RemoteHostPicker.tsx` — mobile-only popover listing
  online same-user devices. Disables `is_self`. Marks offline devices.
- `web/src/remote/RemoteBadge.tsx` — small "📱 phone remote" pill in
  the corner of the desktop when at least one device is currently
  `following` this tab.
- `web/src/remote/sse.ts` — small EventSource wrapper with reconnect +
  typed event dispatch.

### Modified files

- `web/src/api.ts` — add `registerRemote`, `getDevices`,
  `sendCommand`, `publishState`, `followHost`, `unfollowHost`.
- `web/src/App.tsx` — wrap `<PlayerProvider>` in `<RemoteProvider>` so
  the player can read remote state.
- `web/src/player/PlayerContext.tsx` — see §"Proxy mode" below.
- `web/src/player/NowPlayingView.tsx`:
  - new "Remote" icon button (only renders below `md:` breakpoint)
  - opens `RemoteHostPicker` when off, toggles off when on
  - when `isRemote` is true: hides EQ button, hides skin picker entry,
    keeps everything else. Visual indicator (icon turns fuchsia, small
    "→ Chrome / Windows" caption beside track title).
- `web/src/player/PlayerBar.tsx` — same icon also lives in the bottom
  bar mobile dropdown for one-tap toggle.

### Proxy mode in PlayerContext

The simplest version: PlayerContext has its own state (`queue`,
`cursor`, `position`, etc.) and its own `<audio>`. We *don't* tear that
out — we override what `usePlayer()` returns when remote is active.

Inside `PlayerProvider`:

```tsx
const remote = useRemote();
const isRemote = remote.isRemote && remote.selectedHost && remote.hostSnapshot;

const value: PlayerContextValue = isRemote
  ? buildRemoteValue(remote, sendCommand)
  : buildLocalValue(/* existing state + actions */);
```

`buildRemoteValue` synthesizes:
- `current` from `hostSnapshot.current_track`
- `queue`: a stub array of `Track` whose `id`s come from `queue_ids`
  and whose details fall back to `current_track` for the cursor position
  (the rest can be lazy-resolved via the cached track lookup; the queue
  panel needs `title` + `artist` to render)
- `position`: live-computed from the keyframe (re-render with a 250 ms
  interval while `is_playing` is true)
- `duration`: `hostSnapshot.duration_sec`
- `isPlaying`, `shuffle`, `repeat`, `volume` (we may not mirror
  `volume` — see open questions): from snapshot
- Action methods: `togglePlay = () => sendCommand('togglePlay')` etc.

While `isRemote` is true:
- Local `<audio>` is force-paused at the top of every effect that would
  otherwise try to play it. We also short-circuit `ensureAudioGraph` to
  do nothing.
- The handoff snapshot (local `queue`, `cursor`, `audio.currentTime`,
  `audio.paused`) is captured in `RemoteContext` at `enable()` time, not
  in PlayerContext, so PlayerContext doesn't need to know about restore.

When `isRemote` flips false:
- `RemoteContext` calls back into PlayerContext with
  `restoreLocalPlayback(snapshot)` which sets queue + cursor + seeks
  audio to position + calls `play()` if the snapshot was playing.

### Local-state restore details

Stored shape:

```ts
interface RestoreSnapshot {
  queue: Track[];          // full Track objects (phone already had them)
  cursor: number;
  position_sec: number;
  was_playing: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  current_playlist_id: number | null;
  saved_at_ms: number;
}
```

Saved to `sessionStorage` so a page reload during remote keeps the
ability to restore. Cleared after restore. If `cursor < 0` or
`queue.length === 0` the snapshot is "empty" and restore is a no-op.

### Persistence keys

- `localStorage['mw.remote.device_id']` — UUID, generated lazily, never
  deleted by us
- `localStorage['mw.remote.device_name']` — optional user-set name
- `sessionStorage['mw.remote.on']` — `"1"` if remote mode active, gone
  if not (tab-scoped)
- `sessionStorage['mw.remote.host']` — followed `device_id`
- `sessionStorage['mw.remote.restore']` — JSON `RestoreSnapshot`

## Edge cases

| Scenario | Behavior |
|---|---|
| Phone reloads with remote on | Re-open SSE, re-follow, keep remote UI. Restore snapshot still in sessionStorage in case user turns remote off. |
| Host closes its tab | Server detects SSE close, schedules 30 s grace delete. After grace, sends `host-offline` to followers; phone shows banner "host disconnected" + "Pick another / Turn off". |
| Host comes back within 30 s | Slot is reused (same device_id), state stream resumes; phone sees no event because slot was never deleted. |
| User opens picker, no other devices online | Picker shows "No other devices online" + a Refresh button + an explanation. Remote stays off. |
| Command sent but host has gone offline since picker | Server returns 409 `host-offline`; phone shows toast and surfaces "Pick another / Turn off". |
| Two phones remote the same desktop | Allowed. Both get state pushes. Commands from either land on host in arrival order. (Race conditions are user-visible "I pressed next at the same time as my brother" — acceptable.) |
| Phone with remote-on switches accounts (logout) | RemoteContext sees `me` change, calls `disable()` + restore (a no-op when there's nothing to restore on a fresh login). |
| Server restart | All sessions reconnect via `EventSource`. Phone's "selected host" might no longer exist (different `device_id` after re-register? no, `device_id` lives in localStorage and is reused). State arrives once host publishes again. |
| Same browser opens two tabs | Two different `device_id`s — each tab is its own device. Picker shows both; user can ignore the other. |

## Security

- All routes require the existing `requireAuth` cookie session.
- Server only ever cross-references devices within the same `user_id`.
- A user cannot see, command, or follow another user's devices —
  enforced at every endpoint by looking up via `registry.get(req.user.id)`.
- Command payloads are validated against the whitelist; unknown actions
  are 400'd; numeric args are bounded server-side (`seek`'s `sec` ≥ 0,
  `volume` clamped 0..1, `queueIndex` integer).
- SSE responses include `X-Accel-Buffering: no` and conservative
  `Cache-Control` to avoid intermediate buffering.
- `device_id` is treated as opaque; we don't echo it cross-user. If a
  client passes a `device_id` that exists under a different user, the
  server creates a fresh slot under the caller's user — no leak.

## Performance

- Idle cost per online device: one SSE connection + a 25 s keepalive
  comment. Negligible.
- Per command: one POST + one server-side `res.write` to the target.
  Sub-50 ms LAN/Tailscale.
- Per state update: one POST (host) → fan-out write to ≤N followers
  (typically 1, occasionally 2). State payloads are < 1 KB.
- Position is reconstructed locally — zero per-second traffic for the
  progress bar.

## Testing

No unit-test framework configured yet. Verification path:

1. `npm run build` — TS + Vite must pass.
2. Deploy via `deploy.sh` (per CLAUDE.md).
3. Manual: open desktop browser, log in, start playing a track.
4. Open phone browser (or another tab with mobile viewport), log in
   same account.
5. Phone: tap Remote → picker shows desktop → tap it → verify Now
   Playing flips to host's track + position ticks.
6. Tap Next on phone → desktop audibly skips. Tap pause → desktop
   pauses. Seek the phone scrubber → desktop seeks.
7. Tap Remote again → phone resumes its previous local track from where
   it had paused.
8. Close desktop tab while remote-on → phone shows "host disconnected"
   within 30 s.
9. Two phone tabs both following the desktop → both update; commands
   from either land.

## Out of scope (deferred)

- Renaming devices via UI (placeholder field reserved in
  `DeviceListEntry`, no UI yet).
- Persistent device history ("forget this device").
- Cross-process scaling (Redis pub/sub).
- Remoting EQ / spatial / visualizer / skin.
- "Cast to" external (Chromecast / AirPlay).
- Push notifications when phone disconnects mid-remote.

## Open questions

None blocking. Two cosmetic calls that can be decided during
implementation:

- **Volume on remote**: do we mirror host volume on the phone scrubber,
  or hide volume entirely (since phone has its own physical volume
  buttons that mean nothing here)? Suggest: show + let it command host
  volume, with a small "(host)" label.
- **RemoteBadge location**: bottom-right of viewport, or inside
  PlayerBar? Suggest: bottom-right, dismissible-on-click.
