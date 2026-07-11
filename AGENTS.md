# AGENTS.md

_Static web repackaging of the LayaAir H5 game "赵云与阿斗" (originally a Douyin/Android mini-game). Deployed to Vercel; mirrored to an nginx Docker image for parity._

## What this repo is NOT

- **Not a source repo.** The game logic in `build-ctx/html/js/bundle.js` (23k lines, minified IIFE closure) and `index.js` is compiled output from LayaAir IDE. There is no `src/`, no `package.json`, no build pipeline, no TypeScript, no tests. Do not attempt to rebuild the game from here — you cannot.
- **Not a Linux distro.** The top-level `bin/ sbin/ lib/ usr/ etc/ var/ proc/ sys/ dev/ tmp/ root/ run/` directories are read-only artifacts of the `nginx:1.27-alpine` base image, committed only so the Dockerfile's `COPY` targets resolve. They are gitignored (see `.gitignore`) and not source. Ignore them entirely.

## The actual source

Everything under `build-ctx/html/` is the hand-edited surface area:
- `index.html` — script load order is load-bearing: Laya core libs → `web-platform-patch.js` → `bundle.js` (game) → `index.js` (Laya config bootstrap). Do not reorder.
- `js/web-platform-patch.js` — the only hand-written JS. Stubs the Douyin `PlatformClass`/`PlatformObj` native bridge for web and forces `Browser.onAndroid=false` so the game treats web as web. Edit this when web behavior diverges from the app.
- `js/bundle.js` / `js/index.js` — minified, treat as binary. Changes here are surgical patches only (search for the specific string/instruction), never reformat.
- `data/*.json` (`weapon`, `rank`, `rankData`, `weaponTxt`) — gameplay data tables. Safe to tweak values; preserve JSON shape consumed by the bundle.
- `*.lh` (prefabs/dialogs), `*.ls` (scenes), `*.atlas`/`*.sk`/`*.shader` — Laya binary/serialized assets. Not human-editable.
- `fileconfig.json` (root + one per `resources/{anim,img,music,sound}`) — Laya's file manifest with texture config. Must list every asset shipped in its folder; Laya uses it to load resources. If you add/remove an asset, update the matching `fileconfig.json` or it 404s at runtime.

## Hosting wiring

Two parallel hosts serve the same `build-ctx/html`:
- **Vercel** (`vercel.json`, primary) — `outputDirectory: build-ctx/html`. SPA rewrite `/(.*)` → `/index.html`. Asset `.shader` requests are rewritten to `.shader.txt` (Laya ships shaders as `.txt` but the game requests extensionless `.shader`). Custom `Content-Type` + 30-day immutable cache headers on data/asset extensions. **Vercel rejects PCRE capture groups** — headers/rewrites use `:path*` path-param syntax, not `$1`/`(.*)` captures (see commit `d5f0f65`). Keep that convention.
- **nginx** (`build-ctx/Dockerfile` + `build-ctx/default.conf`, parity mirror) — same `try_files $uri $uri/ /index.html` SPA fallback, same 30d cache, same custom mime types (`lh/ls/atlas`→json, `sk/shader`→octet-stream). The repo-root `Dockerfile` + `docker-entrypoint.sh` + `docker-entrypoint.d/` + gitignored FS dirs exist solely to make this image build; the real config is `build-ctx/default.conf`. Keep both hosts in sync when changing routing/headers/mime.

## Working rules

- **Preview locally:** `npx serve build-ctx/html` or any static server pointing at `build-ctx/html`. No install, no build step. Verify routing + asset MIME on both Vercel and nginx configs if you touch routing.
- **No lint/typecheck/test commands exist.** Don't claim to run them. Verification = load the page in a browser and check the console for missing assets / init errors.
- **Commit discipline:** since there is no CI, the only safety net is you. Diff `vercel.json` against `build-ctx/default.conf` and the root `Dockerfile` against `build-ctx/Dockerfile` before committing hosting changes — they are meant to mirror each other.
- **Encoding:** `index.html` is `lang="zh-CN"`; game strings and data files are Chinese. Preserve UTF-8.
