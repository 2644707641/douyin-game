# Repository Guidelines

## Project Structure & Module Organization

This repository packages a compiled LayaAir H5 game; it is not the original IDE source project. `build-ctx/html/` is the primary deployable tree. Hand-maintained code lives mainly in `js/web-platform-patch.js`, `js/cloud-save-config.js`, and `js/game-bootstrap.js`; treat `js/bundle.js`, `libs/`, and Laya scene, prefab, shader, and skeleton files as generated artifacts. Tests live in `tests/`, database schema/RPC/RLS definitions in `supabase/game_saves.sql`, and design notes in `docs/plans/`. `vercel.json` deploys the static tree, while `build-ctx/Dockerfile` and `default.conf` provide Nginx parity. `hf-space/` is an older port-7860 deployment variant; do not assume content parity. Ignore top-level Unix-style directories; they are container-image leftovers, not application modules.

## Build, Test, and Development Commands

There is no dependency-install or compilation step.

- `python -m http.server 8000 --directory build-ctx/html` serves a local browser preview.
- `node --test tests/web-platform-patch.test.js` runs the complete automated suite.
- `docker build -t douyin-game ./build-ctx` builds the Nginx image.
- `docker run --rm -p 8080:80 douyin-game` serves that image locally.

## Coding Style & Naming Conventions

Match the hand-written JavaScript: two-space indentation, double quotes, semicolons, trailing commas in multiline structures, `camelCase` identifiers, and kebab-case filenames. Preserve UTF-8 Chinese text. Never reformat compiled bundles or vendor libraries; make narrow, searchable edits instead. Keep `index.html` script order intact, and keep Vercel and Nginx routing, MIME, and cache behavior aligned.

## Testing Guidelines

Tests use `node:test` with `node:assert/strict`. Name new files `tests/<target>.test.js` and describe observable behavior. There is no formal coverage threshold, but every hand-written logic change should include a focused regression test. After HTML, asset, or hosting changes, smoke-test in a browser and check the console and Network panel for initialization errors, 404s, and incorrect content types.

## Commit & Pull Request Guidelines

History primarily follows Conventional Commits: `feat:`, `fix:`, and `chore:`, with optional narrow scopes such as `fix(vercel):`. Keep each commit focused and its subject short and imperative. Pull requests should explain motivation and impact, link relevant issues, list verification performed, and include screenshots or a short recording for visible changes. Call out surgical edits to generated files and deployment-parity checks.

## Security & Configuration Tips

Browser configuration is public. Never add Supabase service-role keys, passwords, or session tokens. Treat edits to `supabase/game_saves.sql` as security-sensitive schema and policy changes; validate them in a non-production project before rollout.
