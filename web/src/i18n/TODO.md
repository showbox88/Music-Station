# i18n — Strings Still to Translate

Status: most of the UI is fully translated through `useT()`. What's left
is a handful of strings in two playback-related components and a few JSDoc
header comments.

## Real UI strings (user-visible)

### `web/src/player/NowPlayingView.tsx` — ~13 strings
The Now Playing screen and its lyrics overlay. Roughly:

| Line | String | Context |
|------|--------|---------|
| 157 | `'两个歌词源都没找到这首歌的歌词'` | alert when fetch fails |
| 160 | `` `下载歌词失败：${err?.message ?? err}` `` | alert on error |
| 249 | `'查看完整歌词'` | mic button title |
| 251 | `'加载中...'` | mic button title (loading) |
| 253 | `'下载中...'` | mic button title (fetching) |
| 254 | `'下载歌词'` | mic button title (no lyrics yet) |
| 319 | `'切换为音波'` | LRC ↔ wave toggle button title |
| 321 | `'切换为歌词'` | same toggle, opposite state |
| 323 | `'下载中…'` | same toggle while fetching |
| 324 | `'下载并显示歌词'` | same toggle when no lyrics |
| 333 | `lyricsExpanded ? '收起歌词区' : '向上扩展歌词区'` | expand toggle title |
| 715 | `'关闭歌词'` | close button on full-lyrics overlay |
| 729 | `'重新下载（覆盖现有）'` | re-download button title |

Suggested key prefix: `now_playing.*` (e.g. `now_playing.btn.fetch_lyrics`,
`now_playing.alert.fetch_failed`).

### `web/src/player/LyricsPanel.tsx` — 1 string
- Line 265: `title="跳到这一句"` — per-line jump tooltip in the synced lyrics
  panel. Suggested key: `lyrics_panel.line_jump_tooltip`.

## Code comments (not user-facing, low priority)

These are inside JSDoc / inline comments — they don't reach the UI but
should still be translated for consistency. Search-and-replace when
convenient:

- `web/src/components/AdminPanel.tsx:12` — `Toggle disabled (封锁)`
- `web/src/components/EditTrackModal.tsx:261` — `"公开" toggle: any …`
- `web/src/components/PlaylistView.tsx:324` — `"公开" toggle + user checklist`
- `web/src/components/UserFavoritesView.tsx:4,8` — JSDoc references to
  `"X 的收藏"` and `公开/分享自 badge`

## Done in earlier rounds

For reference (do not re-translate):
- App / AuthContext / Login / ChangePasswordModal / Header
- Sidebar (All Tracks, Favorites tree, Playlists tree, Lyrics Editor, Admin)
- TrackList (chips, headers, badges, delete confirm, rating alerts)
- EditTrackModal (3 top tabs + all fields + Lyrics inner tabs + Visibility)
- AdminPanel (every UserRow label, CreateUserModal, ResetPasswordModal)
- PlaylistView (header badges, share button + modal, reorder/remove)
- FavoritesShareModal
- UserFavoritesView
- EQPanel (mode pill, On/Off, Reset, Pre-amp, Preset)
- LyricsEditor (pick / paste / tag stages, all alerts and tooltips)

## How to find what's left

```bash
LC_ALL=C.UTF-8 grep -RnP "[\x{4e00}-\x{9fff}]" web/src --include="*.tsx" --include="*.ts"
```

Inside each component, add `import { useT } from '../i18n/useT';` and
`const t = useT();` at the top, then replace the literal with
`{t('your.key')}`. Add the key to both `en.json` and `zh.json`.
