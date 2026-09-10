// src/renderer/js/renderer.js
// No Node/Electron APIs here directly -- everything goes through the
// `window.zlibWorkbench` bridge exposed by preload.js (contextIsolation-safe).

const api = window.zlibWorkbench;

// ---------------------------------------------------------------------------
// Mode switching
// ---------------------------------------------------------------------------

const modeButtons = document.querySelectorAll('.mode-btn');
const panels = {
  extract: document.getElementById('panel-extract'),
  reinject: document.getElementById('panel-reinject')
};

modeButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    modeButtons.forEach((b) => {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-selected', String(b === btn));
    });
    const mode = btn.dataset.mode;
    Object.entries(panels).forEach(([name, el]) => el.classList.toggle('hidden', name !== mode));
  });
});

// ---------------------------------------------------------------------------
// Console + progress
// ---------------------------------------------------------------------------

const consoleEl = document.getElementById('console');
const consoleBody = document.getElementById('console-body');
const progressFill = document.getElementById('progress-fill');
const progressLabel = document.getElementById('progress-label');

document.getElementById('btn-console-toggle').addEventListener('click', (e) => {
  consoleEl.hidden = !consoleEl.hidden;
  e.target.innerHTML = consoleEl.hidden ? 'Console &#9650;' : 'Console &#9660;';
});

document.getElementById('btn-console-clear').addEventListener('click', () => {
  consoleBody.textContent = '';
});

function appendLog(line) {
  consoleBody.textContent += line + '\n';
  consoleBody.parentElement.scrollTop = consoleBody.parentElement.scrollHeight;
}

function setProgress(state) {
  if (state === 'idle') {
    progressFill.classList.remove('indeterminate');
    progressFill.style.width = '0%';
    progressLabel.textContent = 'Idle';
  } else if (state === 'running') {
    progressFill.classList.add('indeterminate');
    progressLabel.textContent = 'Running…';
  } else if (state === 'done') {
    progressFill.classList.remove('indeterminate');
    progressFill.style.width = '100%';
    progressLabel.textContent = 'Done';
    setTimeout(() => { progressFill.style.width = '0%'; progressLabel.textContent = 'Idle'; }, 1500);
  } else if (state === 'error') {
    progressFill.classList.remove('indeterminate');
    progressFill.style.width = '100%';
    progressLabel.textContent = 'Error';
  }
}

let currentJobId = null;
api.onJobStarted(({ jobId }) => { currentJobId = jobId; });
api.onEngineLog(({ jobId, line }) => { if (jobId === currentJobId) appendLog(line); });
api.onEngineProgress(({ jobId }) => { if (jobId === currentJobId) setProgress('running'); });

// ---------------------------------------------------------------------------
// Generic dropzone wiring
// ---------------------------------------------------------------------------

function wireDropzone(zoneEl, labelEl, onFilePicked) {
  const showFile = (filePath) => {
    labelEl.textContent = filePath;
    zoneEl.dataset.path = filePath;
  };

  zoneEl.addEventListener('click', async () => {
    const filePath = await api.selectFile('Choose a file');
    if (filePath) { showFile(filePath); onFilePicked(filePath); }
  });

  zoneEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') zoneEl.click();
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    zoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      zoneEl.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach((evt) => {
    zoneEl.addEventListener(evt, (e) => {
      e.preventDefault();
      zoneEl.classList.remove('drag-over');
    });
  });

  zoneEl.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const filePath = api.getPathForFile(file);
    if (!filePath) {
      appendLog('[ui] Could not resolve a filesystem path for the dropped file.');
      return;
    }
    showFile(filePath);
    onFilePicked(filePath);
  });
}

// ---------------------------------------------------------------------------
// Extract mode
// ---------------------------------------------------------------------------

let extractInputFile = null;

wireDropzone(
  document.getElementById('dropzone-extract-input'),
  document.getElementById('extract-input-filename'),
  (filePath) => { extractInputFile = filePath; }
);

document.getElementById('btn-pick-outdir').addEventListener('click', async () => {
  const dir = await api.selectOutputDir();
  if (dir) document.getElementById('extract-outdir').value = dir;
});

const extractResultsBody = document.getElementById('extract-results-body');

function renderExtractResults(results) {
  extractResultsBody.innerHTML = '';
  if (!results || results.length === 0) {
    extractResultsBody.innerHTML = '<tr class="empty-row"><td colspan="4">No zlib streams found.</td></tr>';
    return;
  }
  results.forEach((r, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${r.offsetHex} <span style="color:var(--text-faint)">(${r.offsetDec})</span></td>
      <td>${r.zsizeDec} bytes</td>
      <td>${r.sizeDec} bytes</td>
    `;
    // Clicking a row carries its offset + compressed size over to Reinject
    // mode, so the overflow safety check there has something to compare against.
    tr.addEventListener('click', () => {
      document.querySelector('.mode-btn[data-mode="reinject"]').click();
      document.getElementById('reinject-offset').value = r.offsetHex;
      document.getElementById('reinject-original-zsize').value = String(r.zsizeDec);
    });
    tr.style.cursor = 'pointer';
    tr.title = 'Click to reinject a replacement for this stream';
    extractResultsBody.appendChild(tr);
  });
}

document.getElementById('btn-run-extract').addEventListener('click', async () => {
  const outDir = document.getElementById('extract-outdir').value;
  if (!extractInputFile) return appendLog('[ui] Pick an input file first.');
  if (!outDir) return appendLog('[ui] Pick an output folder first.');

  const options = {
    inputFile: extractInputFile,
    outputDir: outDir,
    startOffset: document.getElementById('extract-offset').value || undefined,
    windowBits: document.getElementById('extract-windowbits').value || undefined,
    minSize: document.getElementById('extract-minsize').value || undefined
  };

  setProgress('running');
  const result = await api.runOffzip(options);
  if (result.ok) {
    renderExtractResults(result.results);
    setProgress('done');
    // If the auto windowBits fallback kicked in and found something, reflect
    // the setting that actually worked back into the field -- otherwise the
    // UI would keep showing the value that found nothing.
    if (result.usedWindowBits && result.usedWindowBits !== options.windowBits) {
      document.getElementById('extract-windowbits').value = result.usedWindowBits;
    }
    appendLog(`[ui] Done. Exit code ${result.exitCode}. Found ${result.results.length} stream(s).`);
  } else {
    setProgress('error');
    appendLog(`[ui] Error: ${result.error}`);
  }
});

// ---------------------------------------------------------------------------
// Reinject mode
// ---------------------------------------------------------------------------

let reinjectOriginalFile = null;
let reinjectModifiedFile = null;

wireDropzone(
  document.getElementById('dropzone-reinject-original'),
  document.getElementById('reinject-original-filename'),
  (filePath) => { reinjectOriginalFile = filePath; }
);

wireDropzone(
  document.getElementById('dropzone-reinject-modified'),
  document.getElementById('reinject-modified-filename'),
  (filePath) => { reinjectModifiedFile = filePath; }
);

document.getElementById('btn-pick-outfile').addEventListener('click', async () => {
  const dir = await api.selectOutputDir();
  if (dir) document.getElementById('reinject-outfile').value = dir;
});

const overflowWarning = document.getElementById('reinject-overflow-warning');
const overflowBody = document.getElementById('reinject-overflow-body');

function buildReinjectOptions() {
  return {
    originalFile: reinjectOriginalFile,
    replacementFile: reinjectModifiedFile,
    offset: document.getElementById('reinject-offset').value,
    windowBits: document.getElementById('reinject-windowbits').value || undefined,
    originalZsize: document.getElementById('reinject-original-zsize').value || undefined,
    outputFile: document.getElementById('reinject-outfile').value || undefined
  };
}

async function runReinject(force) {
  const options = buildReinjectOptions();
  if (!reinjectOriginalFile) return appendLog('[ui] Pick the original file first.');
  if (!reinjectModifiedFile) return appendLog('[ui] Pick the modified file first.');
  if (!options.offset) return appendLog('[ui] Enter a target offset first.');

  if (force) options.force = true;

  setProgress('running');
  const result = await api.runPackzip(options);

  if (!result.ok) {
    setProgress('error');
    appendLog(`[ui] Error: ${result.error}`);
    return;
  }

  if (result.needsConfirmation) {
    setProgress('idle');
    overflowBody.textContent =
      `Recompressed size: ${result.measuredSize} bytes. Original stream size: ${result.originalZsize} bytes.`;
    overflowWarning.hidden = false;
    appendLog('[ui] Paused before writing -- see the warning above.');
    return;
  }

  overflowWarning.hidden = true;
  setProgress('done');
  appendLog(
    `[ui] Done. Exit code ${result.exitCode}. Wrote ${result.reportedSize ?? result.measuredSize ?? '?'} bytes ` +
    `to ${result.outputFile}.`
  );
}

document.getElementById('btn-run-reinject').addEventListener('click', () => runReinject(false));
document.getElementById('btn-reinject-force').addEventListener('click', () => runReinject(true));
