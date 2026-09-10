// src/main/main.js
// Electron main process. Owns the window, native dialogs, and all IPC
// handlers that bridge the renderer to the offzip/packzip engine wrapper.

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const engine = require('./engine');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#14161a', // avoids a white flash before CSS paints (dark-first UI)
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------------------------------------------------------------------------
// IPC: filesystem dialogs
// ---------------------------------------------------------------------------

ipcMain.handle('dialog:selectOutputDir', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose output folder',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('dialog:selectFile', async (_evt, { title } = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Choose a file',
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('shell:showItemInFolder', (_evt, targetPath) => {
  shell.showItemInFolder(targetPath);
});

// ---------------------------------------------------------------------------
// IPC: engine operations
// ---------------------------------------------------------------------------
// Each run gets a unique jobId so the renderer can correlate streamed log
// lines / progress events with the correct request (in case a user cancels
// and starts another run quickly).

let jobCounter = 0;

function nextJobId() {
  jobCounter += 1;
  return `job-${Date.now()}-${jobCounter}`;
}

function forwardToRenderer(channel, jobId, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, { jobId, ...payload });
  }
}

ipcMain.handle('engine:runOffzip', async (_evt, options) => {
  const jobId = nextJobId();
  // Tell the renderer the jobId *before* the process finishes, so it can
  // wire up a Cancel button and correlate streamed log/progress events.
  forwardToRenderer('engine:started', jobId, {});
  try {
    const result = await engine.runOffzip(jobId, options, {
      onLog: (line) => forwardToRenderer('engine:log', jobId, { line }),
      onProgress: (progress) => forwardToRenderer('engine:progress', jobId, progress)
    });
    return { jobId, ok: true, ...result };
  } catch (err) {
    return { jobId, ok: false, error: err.message };
  }
});

ipcMain.handle('engine:runPackzip', async (_evt, options) => {
  const jobId = nextJobId();
  forwardToRenderer('engine:started', jobId, {});
  try {
    const result = await engine.runPackzip(jobId, options, {
      onLog: (line) => forwardToRenderer('engine:log', jobId, { line }),
      onProgress: (progress) => forwardToRenderer('engine:progress', jobId, progress)
    });
    return { jobId, ok: true, ...result };
  } catch (err) {
    return { jobId, ok: false, error: err.message };
  }
});

ipcMain.handle('engine:cancel', async (_evt, jobId) => {
  return engine.cancel(jobId);
});
