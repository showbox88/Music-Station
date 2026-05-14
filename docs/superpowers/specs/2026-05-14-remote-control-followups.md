# Remote Control — Follow-ups

> Tomorrow's work list. Carry-over from 2026-05-13 session after feature deployed and tested on host (Tailscale: `https://debian.tail4cfa2.ts.net/app/`).
> Branch tip at carry-over: `9f0f5ab feat(remote): move Remote toggle inline next to DOLBY button in all skins` on main.

## Issue 1 — Host badge "手机正在遥控" needs different presentation + sticky

**User report:** "host 端的手机正在遥控 显示方式要改，而且点击了以后就消失了。"

**Current behavior** (`web/src/remote/RemoteBadge.tsx`):
- Fixed bottom-right fuchsia pill, `hidden md:flex` (desktop only).
- One click dismisses it for the page-load via local `useState`.

**Likely complaints:**
- Visual style not what the user wants (too prominent? wrong position? wrong color?)
- Click-to-dismiss is too aggressive — once dismissed, no way to see it again without reload.

**To clarify tomorrow:**
- What should it look like instead? (Smaller? In the header? An icon-only badge? An inline indicator on the player bar?)
- Should it be dismissible at all? If yes, what restores it (auto-reappear when follower count changes? a re-show button somewhere?)

**Files likely touched:** `web/src/remote/RemoteBadge.tsx`, possibly `web/src/components/Header.tsx` or `web/src/player/PlayerBar.tsx` if the indicator moves there.

---

## Issue 2 — Phone stuck inside a playlist while in remote mode

**User report:** "手机遥控进了播放列表后出不来，没法再选择全部歌曲。"

**Hypothesis:** While in remote mode, the phone still has its own library/sidebar UI active. When the user taps a playlist from the sidebar:
1. The phone sends `playList(...)` RPC to the host — host audibly switches. ✓
2. But the phone's **own view state** (`view` in `App.tsx`) also navigates to that playlist's `PlaylistView`.
3. From there, the user has trouble navigating back to "All tracks" — either the sidebar is hidden in mobile mode (drawer pattern), or some UI element is missing while remote is on.

**Verify first:**
- Does the sidebar drawer button (hamburger in `Header`) work on mobile while remote is on?
- Does tapping "All tracks" in the drawer actually call `handleSetView({ kind: 'all' })`?
- Is the issue specifically about going back to All tracks, or also about leaving a playlist's tracklist?

**Possible root causes to investigate:**
- A z-index / overlay issue specific to remote mode (RemoteHostPicker or offline banner blocking taps).
- The mobile hamburger button being hidden because of the fuchsia REMOTE pill in the top-right area (Vinyl skin's button row crowding mobile width).
- A logical bug where remote-mode commands switch local view but never restore it.

**Files likely involved:** `web/src/components/Sidebar.tsx`, `web/src/components/Header.tsx`, `web/src/App.tsx`, and possibly NowPlayingView (if the issue is about closing it).

---

## Issue 3 — Phone cannot control volume

**User report:** "手机不能控制音量。"

**Wiring expected:**
- `buildRemoteValue()` in `web/src/player/PlayerContext.tsx` returns `setVolume: (v) => rpc('setVolume', { v })`.
- The whitelist on server `server/src/api/remote.ts` includes `setVolume` with validation (`v` clamped to 0..1).
- Host's command-handler effect calls `setVolume(a.v)` which updates the local `<audio>.volume`.

**Possible failure modes:**
1. **No volume control in skin on mobile.** The vinyl/cream/cosmic/aurora/abyss skin layouts may hide the volume slider on narrow widths. Phone has no UI surface to call `setVolume`.
2. **RPC firing but host's setVolume callback is no-op when audio is paused.** Unlikely — `setVolume` just sets state.
3. **The `volume` value displayed in remote mode is LOCAL (from `buildRemoteValue()`'s `volume` field), not host's volume.** So the slider position is wrong: user drags from local 0.9 to local 0.5, but host was at 0.7 before — host jumps to 0.5, but the slider shows where the user dragged from (local position), creating confusion.

**Most-likely fix:**
- Add `volume` to the host's `RemoteSnapshot` (it's not in the schema yet — only the playback fields are).
- Have `buildRemoteValue` return `volume: snap.volume` instead of local `volume`.
- Server-side: `Snapshot` schema bump or just add the field (schema is `schema: 1`; can add a field non-breakingly if clients ignore unknown fields).
- Then verify the volume slider actually renders on mobile in each skin.

**Files likely touched:** `web/src/api.ts` (RemoteSnapshot type), `server/src/api/remote.ts` (Snapshot type), `web/src/player/PlayerContext.tsx` (buildSnapshot + buildRemoteValue). Maybe each skin if the slider isn't rendering on mobile.

---

## Issue 4 — New feature: QR-code pairing

**User report:** "要加个手机扫码后直接进入遥控模式的功能。"

**Design sketch (NEEDS BRAINSTORMING TOMORROW):**

Two architectures:

**A. Static QR encoding host device_id**
- Host displays a QR code somewhere (in the badge area, or a dedicated "show pair code" button).
- QR payload: `https://debian.tail4cfa2.ts.net/app/?remote_host=<host_device_id>`.
- Phone scans → opens the URL.
- `App.tsx`'s deep-link useEffect (already present for `?play=`) reads `remote_host` and calls `remote.enable(remote_host, /* current local state */)` automatically.
- **Caveat:** requires the phone to already be logged in. If not, redirect through login first.
- **Tradeoff:** QR is just a shortcut for the picker. Replay risk minimal — `device_id` alone doesn't grant access (auth cookie still required).

**B. Ephemeral pair-code with server validation**
- Host POSTs `/api/me/remote/pair-code/create` → server returns a 6-digit short code valid for 60s, mapping to that host's device_id.
- Host displays both the QR (encoding the code) and the human-readable code.
- Phone scans (or types the code) → POSTs `/api/me/remote/pair-code/use` → server resolves to device_id → phone enables remote.
- **Tradeoff:** more secure (short window, single-use) but more code, more server endpoints, marginally better in our threat model (everything is already same-user-scoped).

**Recommendation:** Start with **A** — simpler, sufficient for personal-use case, no server changes. Can upgrade to B if needed.

**Files likely touched:**
- Host UI to show QR: `web/src/remote/RemoteBadge.tsx` (or new component, e.g., `RemoteQRDisplay.tsx`).
- QR rendering: needs a QR library. Cheapest: `qrcode` or `react-qr-code` (~5KB gzipped).
- Phone deep-link: `web/src/App.tsx` (extend the existing `?play=` useEffect).
- Auto-enable logic: `web/src/remote/RemoteContext.tsx` already exposes `enable(hostId, snapshot)` — just call it from the deep-link handler.

**Open questions:**
- Where on the host UI should the QR live? Toggle from the badge? A dedicated button in the header? Inside the player bar?
- Should the QR auto-refresh, or static per session?
- Display only when no remote is currently connected, or always?

---

## Suggested order for tomorrow

1. **Issue 2 first** (most blocking — UX dead-end after picking a playlist). Investigate, find the navigation hole, fix.
2. **Issue 3 next** (volume — likely a one-line fix to mirror host's volume in the snapshot).
3. **Issue 1** (badge polish — needs a quick design chat before coding).
4. **Issue 4** (QR pairing — biggest scope, save for last since it's an addition not a fix).

## Quick start commands

```bash
cd E:/Project/Music-Station
git checkout main
git pull
# then open this file and pick an issue:
# code docs/superpowers/specs/2026-05-14-remote-control-followups.md
```

Or pick up via Claude Code: `claude` then "let's tackle issue N from the followups file".
