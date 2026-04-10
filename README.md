# Dragonwake Pages

This repo is the live static GitHub Pages site for Dragonwake. GitHub serves the repo root as-is at:

- `https://kalineh.github.io/dragonwake-pages/`

Deployment is intentionally simple:

- build the game in the main repo with `bash ./build.sh web-ascii`
- deploy from the main repo with `bash ./deploy_web.sh`
- that script copies `builds/web-ascii/` into this repo, renames `dragonwake.html` to `index.html`, commits, and pushes

Portal behavior on the page:

- the page loads the Vibe Jam widget from `https://vibejam.cc/2026/widget.js`
- query params are parsed on startup and exposed as `Module.portalState`
- supported page-level params include `portal`, `ref`, `username`, `color`, `hp`, `team`, `avatar_url`, `speed`, `speed_x`, `speed_y`, `speed_z`, `rotation_x`, `rotation_y`, and `rotation_z`
- the page exposes `window.dragonwakePortal.buildPortalHubUrl()`, `window.dragonwakePortal.buildReturnUrl()`, `window.dragonwakePortal.goToHub()`, and `window.dragonwakePortal.returnToRef()` for later runtime integration

Canonical ref URL:

- update the `<meta name="dragonwake:canonical-ref">` value in `index.html`
- keep the same value in `../dragonwake/web/shell.html` so future rebuilt HTML keeps the same outbound ref

Local test:

- from this repo root: `python -m http.server`
- then open `http://localhost:8000/`
