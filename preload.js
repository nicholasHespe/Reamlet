// PDFox — preload script
// Exposes a minimal, typed API to the renderer via contextBridge.
// SPDX-License-Identifier: GPL-3.0-or-later

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Opens system file dialog and returns { filePath, buffer } or null
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),

  // Overwrites the file at filePath with the given ArrayBuffer
  saveFile: (filePath, arrayBuffer) => ipcRenderer.invoke('save-file', filePath, arrayBuffer),

  // Shows save-as dialog and writes the ArrayBuffer; returns { ok, filePath }
  saveFileCopy: (arrayBuffer) => ipcRenderer.invoke('save-file-copy', arrayBuffer),

  // Subscribe to menu events sent from main process
  onMenuEvent: (callback) => {
    const events = ['menu-open', 'menu-save', 'menu-save-copy', 'menu-close-tab'];
    events.forEach(event => {
      ipcRenderer.on(event, () => callback(event));
    });
  },
});
