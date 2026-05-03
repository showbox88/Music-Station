# Project Instructions for Claude Code

> This file is read automatically by Claude Code when working in this repo.
> Follow these rules without being asked.

## What this project is

Music-Station — a personal music streaming server.

- **Web frontend**: React + Vite + TypeScript at `web/`
- **Backend**: Node + Express + better-sqlite3 at `server/`
- **Runs on**: a remote Debian VM, accessed over Tailscale as host `debian`
- **Public URL**: <https://debian.tail4cfa2.ts.net/app/>
- **Code repo**: <https://github.com/showbox88/Music-Station>

## Deploy workflow — DO THIS AFTER EVERY CODE CHANGE

When the user asks for a code change (frontend, backend, or anything that
ships to production), the standard flow is:

```bash
# 1. Verify the build (catches type errors before they hit the VM)
npm run build

# 2. Commit with a meaningful message
git add -A
git commit -m "<concise message — feat/fix/docs(scope): summary>"

# 3. Push to GitHub (origin/main)
git push

# 4. Deploy to the VM — this is what makes the change live
ssh showbox@debian 'sudo /opt/music-station/deploy.sh'
```

Step 4 is the **one** that makes the change visible on the public URL. If
you skip it the user will see no effect even though their code is "saved".

Always do all 4 steps unless the user says otherwise (e.g. "just commit
locally, don't deploy yet").

## Commit message style

Match the existing log:
- `feat(scope): ...` for new features
- `fix(scope): ...` for bug fixes
- `docs: ...` for docs-only changes

Multi-line OK for non-trivial commits. Use HEREDOC to preserve formatting:

```bash
git commit -m "$(cat <<'EOF'
feat(eq): per-track EQ memory, default off

Longer explanation of why and how.
EOF
)"
```

Don't add `Co-Authored-By:` lines. Don't add emojis to commit messages.

## Verification

`deploy.sh` ends with a health probe. A successful deploy prints something
like:

```
==> [music-station] systemctl restart music-station
==> [music-station] health OK after 1s
{"ok":true,"service":"music-station","version":"0.1.0",...}
==> [music-station] done
```

If the health check fails, investigate via:
```bash
ssh showbox@debian 'systemctl status music-station --no-pager'
ssh showbox@debian 'sudo journalctl -u music-station -n 50 --no-pager'
```

## SSH host name

Always `showbox@debian` — never the LAN IP `192.168.1.16` (that only
works from one specific office network). Tailscale resolves `debian` from
anywhere as long as Tailscale is running.

## What NOT to do

- **Don't run `deploy.sh` while a previous one is still running** — the
  user's `sudoers` entry only allows that exact path. If unsure, wait for
  the previous one to print "done" first.
- **Don't `git push --force`** to `main`. Make a new commit instead.
- **Don't modify `/opt/music/*`** (the audio library) directly via SSH
  unless explicitly asked. Use the web UI's Upload button or a `scp`
  command the user told you to run.
- **Don't commit `.env` or anything in `node_modules/`** — they're already
  in `.gitignore`, but double-check before `git add -A`.
- **Don't create files unless necessary**. Prefer editing existing files.
- **Don't write Markdown docs unless the user asks** for them.

## Useful one-liner

When the user says "deploy" or "ship it":

```bash
git add -A && git commit -m "<msg>" && git push && ssh showbox@debian 'sudo /opt/music-station/deploy.sh'
```

## Build & test commands

| What | Command |
|---|---|
| Install deps | `npm install` |
| Build everything (server tsc + web vite) | `npm run build` |
| Build just server | `npm run build:server` |
| Build just web | `npm run build:web` |
| Local dev (web hot reload) | `npm run dev:web` |

There are no test runners configured yet; verification is via `npm run build`
plus opening the public URL after deploy.

## Project conventions

- TypeScript strict mode, prefer functional React components with hooks
- Tailwind for styling; design tokens in `web/src/index.css`
- API calls go through `web/src/api.ts` — don't `fetch` ad-hoc from
  components
- Mobile responsiveness uses Tailwind's `md:` breakpoint (≥768px = desktop,
  below = mobile)
- Per-user features (EQ presets, favorites, etc.) currently live in
  `localStorage` or are per-track on the server; see `PLAN-multiuser.md`
  for the planned multi-user migration

## Setup for a fresh machine

If the user is on a new computer that has never connected to this project,
read [SETUP-home.md](SETUP-home.md) — it has the Tailscale + SSH + Git
bootstrap steps.
