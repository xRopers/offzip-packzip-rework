---
name: run-desktop
description: Build, run, and drive the Zlib Workbench Electron desktop app. Use when asked to start the desktop app, take a screenshot of it, or interact with its UI.
---

Zlib Workbench is an Electron desktop app. This machine has a real Windows
desktop (not a headless container), so the driver launches Electron directly
-- no xvfb/X server needed. All paths are relative to the repo root.

## Prerequisites

Node.js must be on `PATH`. If a shell session predates a Node install, invoke
it by full path instead of waiting for a fresh shell:

```bash
export PATH="/c/Program Files/nodejs:$PATH"
```

```bash
npm install
```

This also downloads Electron's binary via a postinstall script -- confirm
`node_modules/electron/dist/electron.exe` exists after install.

## Run (agent path)

No tmux on this machine, so drive it in scripted (non-interactive) mode:
each argv is one command, run in order, then the driver exits.

```bash
node .claude/skills/run-desktop/driver.mjs "launch" "ss 01-landing" "quit"
```

Screenshots land in `.driver-shots/` at the repo root (override with the
`SCREENSHOT_DIR` env var). Chain more commands to interact before quitting:

```bash
node .claude/skills/run-desktop/driver.mjs \
  "launch" "ss 01-extract" \
  "click-text Reinject (packzip)" "sleep 300" "ss 02-reinject" \
  "click-text Extract (offzip)" "ss 03-back-to-extract" \
  "quit"
```

If tmux is ever available, the interactive REPL (below) can instead be run
inside a `tmux` pane with `send-keys`/`capture-pane`, one command at a time,
without relaunching the app between commands.

### Commands

| command | what it does |
|---|---|
| `launch` | launch the app, wait for the window to load |
| `ss [name]` | screenshot -> `.driver-shots/<name>.png` |
| `click <css-sel>` | click element via DOM `.click()` (not coordinates) |
| `click-text <text>` | click a button/tab/link containing that text |
| `type <text>` / `press <key>` | keyboard input |
| `wait <css-sel>` | wait for element, 10s timeout |
| `sleep <ms>` | pause (useful after a click before screenshotting) |
| `eval <js>` | evaluate JS in the page, print JSON |
| `text [css-sel]` | print `innerText` (whole body if no selector) |
| `windows` | list open BrowserWindow URLs |
| `quit` | close the app |

## Run (human path)

```bash
npm run dev
```

Opens a real window with DevTools detached (`--dev` flag). `npm start` omits
DevTools.

## Gotchas

- **Node/npm not on `PATH` in an already-open shell after installing
  Node.js.** Windows updates the registry PATH, but processes already
  running (including persistent shell sessions) keep their old environment.
  Invoke `node`/`npm` by full path (`/c/Program Files/nodejs/...`) rather
  than waiting for/assuming a shell restart.
- **A backgrounded `electron.cmd . &` launched from a single throwaway Bash
  invocation exits immediately (code 0), not because Electron crashed** --
  the wrapping shell process ends and takes the child down with it on
  Windows. Use this driver (a single Node process that owns the Electron
  child via Playwright, and stays alive until `quit`) instead of raw
  shell backgrounding.
- **npm's `install-scripts` guard**: on first `npm install`, watch for
  `electron@... postinstall: node install.js` being flagged as "not yet
  covered by allowScripts" -- verify `node_modules/electron/dist/electron.exe`
  actually exists afterward; if not, run `npx electron-fixup` or re-run
  `npm install` (this repo's install has run clean so far).

## Troubleshooting

- **Launch timeout (30s):** confirm `node_modules/electron/dist/electron.exe`
  exists (see the install-scripts gotcha above).
- **Blank/white screenshot:** check `src/renderer/index.html` loaded at all --
  run `windows` to see the loaded URL, and check devtools console via the
  `--dev` flag's detached DevTools window (visible only in the human path).
