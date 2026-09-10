# native/packzip

The original PackZip 0.3.1 source is here (`packzip.c`/`.h`, `compression/`,
and `libs/` -- bundled zopfli, LZMA SDK, 7z/AdvanceCOMP, and uberflate
sub-libraries -- plus the original `Makefile`), and its compiled binary is
already at [`../../bin/win32-x64/packzip.exe`](../../bin/win32-x64/packzip.exe)
-- verified working, including the reinjection-overflow safety behavior
documented in the root [README](../../README.md).

You only need anything in this folder if you want to **rebuild** the binary.

## Rebuilding

The original `src/Makefile` is the authoritative build recipe -- it already
knows about all the bundled sub-libraries, so a standalone zlib install is
unlikely to be needed. From a shell with `make` and a C/C++ compiler
(MSYS2/MinGW on Windows, or WSL for a Linux build):

```sh
cd native/packzip/src
make
```

Then copy the resulting binary into `bin/win32-x64/packzip.exe` (or the
appropriate `bin/<platform>/` folder for a non-Windows build).

`scripts/build-native-win.ps1` at the repo root is a simpler MSVC/MinGW
fallback if the Makefile doesn't suit your toolchain, but expects a
standalone zlib -- check the Makefile first.

## After rebuilding: re-verify the CLI contract

Run the binary with no arguments -- it prints its usage/help text:

```powershell
bin\win32-x64\packzip.exe
```

Compare against `PACKZIP_FLAGS` and `buildPackzipArgs()` in
[`src/main/engine.js`](../../src/main/engine.js), and re-run the
overflow-truncation test described in the root README if you're rebuilding
from a patched or different-version source -- that behavior was empirically
confirmed against this exact binary, not assumed from its `--help` text.
