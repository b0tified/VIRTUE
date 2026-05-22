# VIRTUE Desktop (Electron)

Wraps the live VIRTUE PWA in a borderless desktop window — produces real
.exe / .dmg / .AppImage installers you can give friends without telling
them to "open Chrome and visit a URL".

The desktop build connects to **the same servers** as the browser version, so
accounts, ranked queues, leaderboards and matchmaking are all shared.

## One-time setup

```bash
cd frontend
yarn electron:install    # adds electron + electron-builder (~250MB)
```

## Run locally (no install needed)

```bash
yarn electron:dev
```

## Build installers

```bash
yarn electron:build:linux   # AppImage + deb
yarn electron:build:win     # NSIS .exe installer
yarn electron:build:mac     # .dmg (must build on macOS)
```

Output goes to `frontend/dist-electron/`. Distribute the installer however
you like — GitHub Releases, your own site, an itch.io page, etc.

## Customising the target URL

By default the wrapper points at `https://blast-arena-servers.emergent.host`.
Override at run-time with the `VIRTUE_URL` env var:

```bash
VIRTUE_URL=https://staging.example.com yarn electron:dev
```

Or edit `frontend/electron/main.js` constant `PROD_URL`.

## Code-signing

Production releases should be signed (Windows: code-sign cert; macOS:
Apple Developer ID + notarization). Without signing, users see a "this app
is from an unknown developer" warning. `electron-builder` config in
`package.json` is set up for both — drop your certificate paths in
`build.win.certificateFile` / `build.mac.identity` once you have them.
