# Zlib Workbench

A dark-mode-first Electron GUI wrapping Luigi Auriemma's **Offzip 0.4.1**
(extract zlib/deflate streams from a file) and **PackZip 0.3.1** (reinject a
recompressed stream back into a file at a given offset).

**Status:** source for both tools is in place under `native/`, and their
compiled Windows binaries are in `bin/win32-x64/`. Everything in this README
below has been verified against the real binaries (usage text, argument
order, and a full extract → modify → reinject → re-extract round-trip on a
synthetic test file) -- not just read from `--help` output.

## Architecture

```
Renderer (Chromium, no Node)  <-- contextBridge -->  Preload  <-- IPC -->  Main process (Node)
                                                                                |
                                                                        child_process.spawn
                                                                                |
                                                                    bin/win32-x64/offzip.exe
                                                                    bin/win32-x64/packzip.exe
```

**Integration strategy: compiled CLI binaries + `child_process.spawn`, not
ffi-napi / a native Node addon.** Reasoning:

- Both tools are `main(argc, argv)` + `printf` programs. Turning them into a
  callable native module means refactoring their entry points, taming global
  state, and rebuilding a native addon against Electron's Node ABI per
  platform/arch -- real ongoing cost for no benefit here.
- Spawning the `.exe` gets you **process isolation for free**: a crash on
  hostile/corrupt input takes down a child process, not the Electron app.
- Trivially cross-platform: recompile the same C source per OS/arch, drop the
  binary in the matching `bin/<platform>` folder.
- stdout/stderr streaming maps directly onto the progress bar and console log
  features -- no extra plumbing needed.

## Directory layout

```
zlib-workbench/
├── package.json                  # Electron + electron-builder config
├── src/
│   ├── main/
│   │   ├── main.js               # app lifecycle + IPC handlers
│   │   ├── preload.js            # contextBridge: renderer-safe API surface
│   │   └── engine.js             # spawns offzip.exe/packzip.exe, parses output
│   └── renderer/
│       ├── index.html            # Extract / Reinject tabs
│       ├── css/style.css         # dark theme
│       └── js/renderer.js        # drag-drop, IPC calls, results table, console
├── native/
│   ├── offzip/src/               # original offzip.c, sign_ext.c, zopfli/, Makefile
│   ├── packzip/src/              # original packzip.c/.h, compression/, libs/ (lzma, 7z/advancecomp, uberflate, zopfli), Makefile
│   └── zlib/                     # (not needed -- see note below)
├── bin/win32-x64/                # offzip.exe, packzip.exe (already built, verified working)
├── scripts/build-native-win.ps1  # rebuilds native/*/src -> bin/win32-x64 if you ever need to
└── assets/icon.ico
```

> **Note on zlib:** the vendored `packzip` source bundles its own zopfli,
> AdvanceCOMP, LZMA SDK, and uberflate implementations under
> `native/packzip/src/libs/`, and `offzip` bundles zopfli too -- so unlike a
> typical zlib-wrapping project, you likely do **not** need a separate zlib
> install to rebuild these from source. Check each tool's `Makefile` before
> assuming you need `native/zlib/`.

## Verified CLI contracts

### offzip 0.4.1

```
offzip.exe [options] <input> [output] [offset]
```

| Flag | Meaning |
|---|---|
| `-a` | extract ALL compressed streams found into the output folder |
| `-o` | overwrite existing output files without an interactive prompt (**required** for a GUI -- offzip has no stdin to answer y/n on) |
| `-z NUM` | windowBits: `15` = zlib (default), `-15` = raw deflate (e.g. inside ZIP archives) |
| `-m SIZE` | minimum compressed size to consider (default 32) |
| `-L FILE` | dump a machine-readable list of found streams to `FILE` |

`engine.js` always passes `-a -o -L <temp file>` and parses that temp file
rather than scraping the fancy box-drawing console table. **Empirically
verified format** (the tool's own `--help` text compresses this to one line,
but the real file is two lines per stream):
```
0x<START_OFFSET>
0x<END_OFFSET> <zsizeDecimal> <sizeDecimal>
```

### packzip 0.3.1

```
packzip.exe [options] <input> <output>
```
- `<input>` = the modified/replacement (uncompressed) data
- `<output>` = the archive being patched -- if it already exists, packzip
  **injects** the newly-compressed data into it at `-o OFFSET` rather than
  overwriting the whole file

| Flag | Meaning |
|---|---|
| `-o OFF` | byte offset in `<output>` where the compressed data is written |
| `-w BITS` | windowBits, default `15` (zlib); negative = raw deflate; `0` = LZMA |
| `-c` | force-recreate `<output>` from scratch even if it already exists |

**⚠️ Verified safety caveat (found by testing, not documented up front by the
tool):** packzip does **not** shift or resize surrounding data.
- If the recompressed replacement is **≤** the original stream's size, it
  overwrites in place and the file's total length is unchanged (leftover
  bytes in the old slot become harmless padding).
- If it is **larger**, packzip truncates the file immediately after the
  newly written data -- **silently discarding everything that came after it**
  in the original file.

Because of this, `runPackzip()` in `engine.js`:
1. Never touches your original file -- it always copies it to a working file
   first (`<original>.patched.<ext>` by default, or a path you choose).
2. Measures what packzip would *actually* produce, using a disposable scratch
   file (`packzip -o 0 -w BITS <replacement> <scratch>`, output file doesn't
   pre-exist so packzip takes its compress-only path -- the resulting file's
   size equals the exact bytes that would be written).
3. If you supplied the original stream's known compressed size (auto-filled
   when you click a row in the Extract results table, or type it in
   manually) and the measured size exceeds it, the run stops **before**
   touching the working copy and the UI shows a warning banner with an
   explicit "I understand -- inject anyway" confirmation button.

## Step-by-step setup

1. **Install Node.js**, if you haven't already (this dev machine doesn't have
   it) -- get the current LTS from https://nodejs.org.

2. **Install JS dependencies**
   ```powershell
   npm install
   ```

3. **Run the app**
   ```powershell
   npm run dev
   ```
   `--dev` opens DevTools detached. The binaries in `bin/win32-x64/` are
   already built, so this should work immediately.

4. **Package an installer** (once you're happy with it)
   ```powershell
   npm run dist:win
   ```
   `electron-builder` copies `bin/win32-x64/*` into the packaged app's
   `resources/bin` (see `extraResources` in `package.json`), and `engine.js`
   resolves the binary path relative to `process.resourcesPath` when
   `app.isPackaged` is true -- same code path in dev and in the built installer.

### If you ever need to rebuild the binaries from source

`native/offzip/src/Makefile` and `native/packzip/src/Makefile` came with the
original source and are the authoritative build recipe (they know about the
bundled zopfli/LZMA/uberflate/AdvanceCOMP sub-libraries). `scripts/build-native-win.ps1`
is a simpler MSVC/MinGW fallback for straightforward single-zlib-dependency
builds -- prefer the real Makefile if it works in your toolchain (e.g. via
`make` from MSYS2/MinGW, or WSL for a Linux build).

## UI feature map

| Requirement | Where |
|---|---|
| Extract/Reinject tabs | `#panel-extract` / `#panel-reinject` in `index.html`, toggled by `.mode-btn` in `renderer.js` |
| Drag-and-drop input file | `.dropzone` elements, `wireDropzone()` in `renderer.js` |
| Start offset / windowBits / min size inputs | `#extract-offset`, `#extract-windowbits`, `#extract-minsize` |
| Output directory picker | `#btn-pick-outdir` → `dialog:selectOutputDir` IPC → native folder picker |
| Results table (offset / compressed / uncompressed size) | `#extract-results-body`, populated from offzip's `-L` list file. **Click a row** to carry its offset + compressed size over to Reinject mode |
| Reinject original + modified dropzones, offset/windowBits fields | `#panel-reinject` |
| Overflow safety banner + confirm | `#reinject-overflow-warning`, `#btn-reinject-force` |
| Progress bar | `.progress-fill`, driven by `engine:progress` IPC events (indeterminate pulse -- neither tool reports a clean byte-offset percentage) |
| Console log of raw engine output | `#console` / `#console-body`, fed by `engine:log` IPC events streamed line-by-line from stdout/stderr |

## Security notes baked in

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on the
  `BrowserWindow` -- the renderer only ever touches the explicit API surface
  in `preload.js`, never raw `fs`/`child_process`.
- A `Content-Security-Policy` meta tag locks the renderer to same-origin
  scripts/styles.
- Drag-and-drop file paths are resolved via `webUtils.getPathForFile`
  (`File.path` was removed in modern Electron for exactly this reason).
- Reinject mode never writes to your original file -- see the safety caveat
  above.
