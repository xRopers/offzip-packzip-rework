# native/offzip

The original Offzip 0.4.1 source is here (`offzip.c`, `sign_ext.c`, the
bundled `zopfli/` sub-library, and the original `Makefile`), and its compiled
binary is already at [`../../bin/win32-x64/offzip.exe`](../../bin/win32-x64/offzip.exe)
-- verified working (see the root [README](../../README.md) for the CLI
contract and how `src/main/engine.js` drives it).

You only need anything in this folder if you want to **rebuild** the binary
(different compiler, different platform, a patched source, etc).

## Rebuilding

The original `src/Makefile` is the authoritative build recipe -- it already
knows about the bundled `zopfli/` sources, so a plain zlib install is
unlikely to be needed. From a shell with `make` and a C compiler (MSYS2/MinGW
on Windows, or WSL for a Linux build):

```sh
cd native/offzip/src
make
```

Then copy the resulting binary into `bin/win32-x64/offzip.exe` (or the
appropriate `bin/<platform>/` folder for a non-Windows build).

`scripts/build-native-win.ps1` at the repo root is a simpler MSVC/MinGW
fallback if the Makefile doesn't suit your toolchain, but expects a
standalone zlib -- check the Makefile first.

## After rebuilding: re-verify the CLI contract

Run the binary with no arguments -- it prints its usage/help text:

```powershell
bin\win32-x64\offzip.exe
```

Compare against `OFFZIP_FLAGS` and `parseOffzipListFile()` in
[`src/main/engine.js`](../../src/main/engine.js). These were verified against
the binary already in this repo; only re-check them if you rebuild from a
patched or different-version source.
