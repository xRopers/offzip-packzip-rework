// src/main/engine.js
//
// Thin, isolated wrapper around offzip.exe / packzip.exe (Luigi Auriemma).
// This is the ONLY module that knows how to build argv, spawn a process, and
// parse its output. The flag maps below were verified against the actual
// compiled binaries in bin/win32-x64/ (Offzip 0.4.1 / PackZip 0.3.1) by
// running each with no arguments and by round-tripping a real test fixture
// (extract -> modify -> reinject -> re-extract -> byte-compare). See
// native/offzip/README.md and native/packzip/README.md if you ever swap in a
// different build -- flag letters have drifted across releases of these tools.

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const readline = require('readline');
const { app } = require('electron');

// --- offzip -----------------------------------------------------------------
//
// Usage: offzip.exe [options] <input> [output] [offset]
//   -a       extract ALL compressed streams found into the output folder
//   -o       overwrite existing output files without an interactive prompt
//            (REQUIRED for a GUI: offzip has no stdin to answer "y/n" on)
//   -z NUM   windowBits: 15 = zlib (default), -15 = raw deflate
//   -m SIZE  minimum compressed size to consider (default 32)
//   -L FILE  dump a machine-readable list of found streams to FILE
//
// -L's format is two lines per stream (verified empirically, not just from
// the tool's own --help text, which compresses it to one line):
//   0x<START_OFFSET>
//   0x<END_OFFSET> <zsizeDecimal> <sizeDecimal>

const OFFZIP_FLAGS = {
  windowBits: '-z',
  minSize: '-m'
};

// --- packzip ------------------------------------------------------------------
//
// Usage: packzip.exe [options] <input> <output>
//   <input>  = the (modified, uncompressed) replacement data
//   <output> = the archive being patched -- if it already exists, packzip
//              INJECTS the newly-compressed data into it at -o OFFSET rather
//              than overwriting the whole file
//   -o OFF   byte offset in <output> where the compressed data is written
//   -w BITS  windowBits, default 15 (zlib); negative = raw deflate; 0 = LZMA
//   -c       force-recreate <output> from scratch even if it already exists
//
// VERIFIED BEHAVIOR / IMPORTANT SAFETY CAVEAT
// packzip does NOT shift or resize the rest of the file to make room:
//   - If the recompressed data is <= the original stream's size, it overwrites
//     in place and the file's total length is unchanged (any leftover bytes
//     in the old slot become inert padding -- harmless).
//   - If the recompressed data is LARGER than the original stream's size,
//     packzip truncates the file immediately after the newly written data,
//     silently discarding everything that came after it in the original file.
// This was confirmed with a real round-trip test against the compiled
// binaries, not assumed from documentation. Because of this, runPackzip()
// below always measures the actual recompressed size FIRST (via a disposable
// scratch file) and refuses to touch the real working copy if that size
// exceeds a known original size, unless the caller passes `force: true`.

const PACKZIP_FLAGS = {
  offset: '-o',
  windowBits: '-w',
  recreate: '-c'
};

// packzip prints a summary line like: "- output size   0x00000043 / 67"
const PACKZIP_OUTPUT_SIZE_LINE = /output size\s+0x[0-9a-f]+\s*\/\s*(\d+)/i;

// --- binary resolution --------------------------------------------------------

function binDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin');
  }
  return path.join(__dirname, '..', '..', 'bin', 'win32-x64');
}

function resolveBinary(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const full = path.join(binDir(), exe);
  if (!fs.existsSync(full)) {
    throw new Error(
      `${exe} not found at ${full}. Compile it (see native/${name}/README.md) ` +
      `and copy the binary into bin/win32-x64/.`
    );
  }
  return full;
}

// --- job tracking (for cancel support) ----------------------------------------

const activeProcesses = new Map(); // jobId -> ChildProcess

function cancel(jobId) {
  const child = activeProcesses.get(jobId);
  if (!child) return false;
  child.kill();
  return true;
}

// --- shared process runner -----------------------------------------------------

function runProcess(jobId, exePath, args, cwd, hooks) {
  const { onLog, onProgress } = hooks;

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(exePath, args, { cwd, windowsHide: true });
    } catch (err) {
      reject(err);
      return;
    }

    activeProcesses.set(jobId, child);

    // IMPORTANT (verified empirically): packzip writes essentially ALL of its
    // status/report text to stderr, not stdout -- offzip splits banner/summary
    // text to stdout but its per-item progress ticks to stderr. Neither
    // stream is "errors only" for these tools, so `allLines` (both streams,
    // in arrival order) is what callers should scan for report lines; the
    // stdout/stderr split is kept only for the `[stderr]`-tagged console
    // display below.
    const stdoutLines = [];
    const stderrLines = [];
    const allLines = [];
    let linesSeen = 0;

    const rlOut = readline.createInterface({ input: child.stdout });
    rlOut.on('line', (line) => {
      stdoutLines.push(line);
      allLines.push(line);
      linesSeen += 1;
      onLog(line);
      // Neither tool reports a clean byte-offset progress percentage, so this
      // is an indeterminate "still alive" pulse rather than a real percentage.
      onProgress({ indeterminate: true, linesSeen });
    });

    const rlErr = readline.createInterface({ input: child.stderr });
    rlErr.on('line', (line) => {
      stderrLines.push(line);
      allLines.push(line);
      onLog(`[stderr] ${line}`);
    });

    let closedCount = 0;
    let exitCode = null;
    let processExited = false; // separate from exitCode, which is legitimately null if killed by signal (e.g. cancel())
    let settled = false;

    // Wait for the process AND both readline interfaces to report closed
    // before resolving -- child 'close' alone can race ahead of readline
    // still flushing a final, not-newline-terminated buffered line.
    function maybeResolve() {
      if (settled || closedCount < 2 || !processExited) return;
      settled = true;
      activeProcesses.delete(jobId);
      resolve({ exitCode, stdoutLines, stderrLines, allLines });
    }

    rlOut.on('close', () => { closedCount += 1; maybeResolve(); });
    rlErr.on('close', () => { closedCount += 1; maybeResolve(); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      activeProcesses.delete(jobId);
      reject(err);
    });

    child.on('close', (code) => {
      exitCode = code;
      processExited = true;
      maybeResolve();
    });
  });
}

function tempPath(suffix) {
  return path.join(os.tmpdir(), `zlib-workbench-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${suffix}`);
}

function safeUnlink(p) {
  try { fs.unlinkSync(p); } catch { /* best-effort cleanup */ }
}

// --- offzip (extract) ----------------------------------------------------------

function buildOffzipArgs(options, listFile) {
  const args = ['-a', '-o']; // always extract-all, never prompt interactively

  if (options.windowBits) args.push(OFFZIP_FLAGS.windowBits, String(options.windowBits));
  if (options.minSize) args.push(OFFZIP_FLAGS.minSize, String(options.minSize));
  args.push('-L', listFile);

  args.push(options.inputFile);
  args.push(options.outputDir);
  args.push(options.startOffset ? String(options.startOffset) : '0');

  return args;
}

function parseOffzipListFile(listFile) {
  if (!fs.existsSync(listFile)) return [];
  const lines = fs.readFileSync(listFile, 'utf8').split(/\r?\n/).filter((l) => l.length > 0);

  const results = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const startMatch = lines[i].match(/^0x([0-9a-f]+)$/i);
    const endMatch = lines[i + 1].match(/^0x([0-9a-f]+)\s+(\d+)\s+(\d+)$/i);
    if (!startMatch || !endMatch) continue;

    results.push({
      offsetHex: `0x${startMatch[1]}`,
      offsetDec: parseInt(startMatch[1], 16),
      endOffsetHex: `0x${endMatch[1]}`,
      endOffsetDec: parseInt(endMatch[1], 16),
      zsizeDec: Number(endMatch[2]),
      sizeDec: Number(endMatch[3])
    });
  }
  return results;
}

async function runOffzipOnce(jobId, options, hooks) {
  const exePath = resolveBinary('offzip');
  const listFile = tempPath('.offzip-list.txt');
  const args = buildOffzipArgs(options, listFile);
  hooks.onLog(`> offzip ${args.join(' ')}`);

  try {
    const { exitCode, stdoutLines } = await runProcess(jobId, exePath, args, path.dirname(options.inputFile), hooks);
    const results = parseOffzipListFile(listFile);
    return { exitCode, results, rawLineCount: stdoutLines.length };
  } finally {
    safeUnlink(listFile);
  }
}

// -a/-A/-s/-S all take the same windowBits guess (-z), and a real archive
// commonly needs the *other* preset than whichever one is set: zlib-wrapped
// streams (windowBits 15, the default) vs. headerless raw-deflate streams
// (windowBits -15 -- e.g. inside ZIP archives). Rather than make a user
// manually flip this and re-run when a scan comes back empty, automatically
// retry with the other common preset once.
const OFFZIP_WINDOW_BITS_FALLBACK = { 15: '-15', '-15': '15' };

async function runOffzip(jobId, options, hooks) {
  if (!options.inputFile) throw new Error('inputFile is required');
  if (!options.outputDir) throw new Error('outputDir is required');

  const windowBits = options.windowBits ? String(options.windowBits) : '15';
  let pass = await runOffzipOnce(jobId, { ...options, windowBits }, hooks);
  let usedWindowBits = windowBits;

  const fallbackBits = OFFZIP_WINDOW_BITS_FALLBACK[windowBits];
  if (pass.results.length === 0 && fallbackBits) {
    hooks.onLog(
      `[auto] No streams found with windowBits=${windowBits}. Retrying with ` +
      `windowBits=${fallbackBits} in case this file uses the other common format ` +
      `(15 = zlib, -15 = raw deflate)...`
    );
    const retryPass = await runOffzipOnce(jobId, { ...options, windowBits: fallbackBits }, hooks);
    if (retryPass.results.length > 0) {
      pass = retryPass;
      usedWindowBits = fallbackBits;
      hooks.onLog(`[auto] Found ${retryPass.results.length} stream(s) with windowBits=${fallbackBits}.`);
      if (fallbackBits === '-15') {
        hooks.onLog(
          '[auto] Note: raw-deflate scanning (-15) has no header magic bytes to validate ' +
          'against, so it is more prone to false-positive matches than zlib (15) -- verify ' +
          'the results before relying on all of them.'
        );
      }
    } else {
      hooks.onLog(`[auto] Still nothing found with windowBits=${fallbackBits}. No further automatic retries.`);
    }
  }

  return { ...pass, usedWindowBits };
}

// --- packzip (reinject) ----------------------------------------------------------

function defaultPatchedPath(originalFile) {
  const ext = path.extname(originalFile);
  const base = originalFile.slice(0, originalFile.length - ext.length);
  return `${base}.patched${ext}`;
}

// Measures what packzip would actually produce for this replacement/windowBits
// combination, without touching any real file: compress-only, to a disposable
// scratch path that does not exist yet (so packzip takes its "create fresh
// file" path rather than its "inject into existing file" path).
async function measureCompressedSize(jobId, replacementFile, windowBits, hooks) {
  const exePath = resolveBinary('packzip');
  const scratchOut = tempPath('.packzip-measure.bin');
  safeUnlink(scratchOut);

  const args = [PACKZIP_FLAGS.offset, '0'];
  if (windowBits !== undefined && windowBits !== '') args.push(PACKZIP_FLAGS.windowBits, String(windowBits));
  args.push(replacementFile, scratchOut);

  try {
    await runProcess(`${jobId}-measure`, exePath, args, path.dirname(replacementFile), {
      onLog: () => {}, // silent: this is an internal probe, not shown in the console
      onProgress: () => {}
    });
    if (!fs.existsSync(scratchOut)) return null;
    const size = fs.statSync(scratchOut).size;
    return size;
  } finally {
    safeUnlink(scratchOut);
  }
}

function buildPackzipArgs(options, outputFile) {
  const args = [];
  args.push(PACKZIP_FLAGS.offset, String(options.offset));
  if (options.windowBits !== undefined && options.windowBits !== '') {
    args.push(PACKZIP_FLAGS.windowBits, String(options.windowBits));
  }
  args.push(options.replacementFile);
  args.push(outputFile);
  return args;
}

async function runPackzip(jobId, options, hooks) {
  if (!options.originalFile) throw new Error('originalFile is required');
  if (!options.replacementFile) throw new Error('replacementFile is required');
  if (options.offset === undefined || options.offset === null || options.offset === '') {
    throw new Error('offset is required');
  }

  const outputFile = options.outputFile || defaultPatchedPath(options.originalFile);

  // Never touch the user's original file: always work on a copy. If a prior
  // run already produced this working copy, this simply re-seeds it from the
  // pristine original so repeated attempts don't compound on each other.
  fs.copyFileSync(options.originalFile, outputFile);
  hooks.onLog(`[safety] Working on a copy: ${outputFile} (original left untouched)`);

  // Measure what packzip would actually produce before touching the copy for
  // real -- see the safety caveat documented above PACKZIP_FLAGS.
  const measuredSize = await measureCompressedSize(jobId, options.replacementFile, options.windowBits, hooks);
  if (measuredSize !== null) {
    hooks.onLog(`[safety] Recompressed size would be ${measuredSize} bytes.`);
  }

  const originalZsize = options.originalZsize ? Number(options.originalZsize) : null;
  if (originalZsize && measuredSize !== null && measuredSize > originalZsize && !options.force) {
    hooks.onLog(
      `[safety] ABORTED before writing: recompressed size (${measuredSize} bytes) exceeds the ` +
      `original stream's size (${originalZsize} bytes). packzip does not shift/resize surrounding ` +
      `data -- writing this would silently truncate the file right after this stream, destroying ` +
      `everything that came after it. Re-run with a smaller/more-compressible replacement, or ` +
      `confirm you understand the data loss to proceed anyway.`
    );
    return {
      exitCode: null,
      needsConfirmation: true,
      measuredSize,
      originalZsize,
      outputFile
    };
  }

  const exePath = resolveBinary('packzip');
  const args = buildPackzipArgs(options, outputFile);
  hooks.onLog(`> packzip ${args.join(' ')}`);

  const { exitCode, allLines } = await runProcess(jobId, exePath, args, path.dirname(outputFile), hooks);

  // packzip's report (including the "output size" line) is written to
  // stderr, not stdout -- verified empirically. Scan both, via allLines.
  let reportedSize = null;
  for (const line of allLines) {
    const m = line.match(PACKZIP_OUTPUT_SIZE_LINE);
    if (m) { reportedSize = Number(m[1]); break; }
  }

  return { exitCode, outputFile, measuredSize, reportedSize, originalZsize };
}

module.exports = {
  runOffzip,
  runPackzip,
  cancel
};
