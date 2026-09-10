// src/main/preload.js
// Runs in an isolated context with access to Node + a subset of Electron.
// Exposes a small, explicit API to the renderer via contextBridge -- the
// renderer itself has nodeIntegration disabled and cannot touch fs/child_process.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Electron >= 32 removed File.path for security; webUtils.getPathForFile is
// the replacement for resolving a real filesystem path out of a drag-and-drop
// File object. Fall back to `.path` for older Electron just in case.
function resolveDroppedFilePath(file) {
  if (webUtils && typeof webUtils.getPathForFile === 'function') {
    return webUtils.getPathForFile(file);
  }
  return file.path || null;
}

contextBridge.exposeInMainWorld('zlibWorkbench', {
  // --- native dialogs ---
  selectOutputDir: () => ipcRenderer.invoke('dialog:selectOutputDir'),
  selectFile: (title) => ipcRenderer.invoke('dialog:selectFile', { title }),
  showItemInFolder: (targetPath) => ipcRenderer.invoke('shell:showItemInFolder', targetPath),

  // --- drag & drop helper ---
  getPathForFile: resolveDroppedFilePath,

  // --- engine operations ---
  runOffzip: (options) => ipcRenderer.invoke('engine:runOffzip', options),
  runPackzip: (options) => ipcRenderer.invoke('engine:runPackzip', options),
  cancelJob: (jobId) => ipcRenderer.invoke('engine:cancel', jobId),

  // --- streamed events from the running job ---
  onJobStarted: (callback) => {
    const listener = (_evt, payload) => callback(payload);
    ipcRenderer.on('engine:started', listener);
    return () => ipcRenderer.removeListener('engine:started', listener);
  },
  onEngineLog: (callback) => {
    const listener = (_evt, payload) => callback(payload);
    ipcRenderer.on('engine:log', listener);
    return () => ipcRenderer.removeListener('engine:log', listener);
  },
  onEngineProgress: (callback) => {
    const listener = (_evt, payload) => callback(payload);
    ipcRenderer.on('engine:progress', listener);
    return () => ipcRenderer.removeListener('engine:progress', listener);
  }
});
