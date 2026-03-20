// PDFox — Electron main process
// SPDX-License-Identifier: GPL-3.0-or-later

'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 640,
    minHeight: 480,
    title: 'PDFox',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  buildMenu();
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow.webContents.send('menu-open'),
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.send('menu-save'),
        },
        {
          label: 'Save Copy…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow.webContents.send('menu-save-copy'),
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => mainWindow.webContents.send('menu-close-tab'),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools' },
        { role: 'reload' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// IPC: open file dialog, return { filePath, buffer }
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open PDF',
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  // Buffer.from() creates a standalone copy (not a shared pool view)
  // Electron IPC serialises Node Buffer → Uint8Array in the renderer
  const buffer = Buffer.from(fs.readFileSync(filePath));
  return { filePath, buffer };
});

// IPC: overwrite original file — asks for confirmation first
ipcMain.handle('save-file', async (_event, filePath, arrayBuffer) => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type:      'question',
    buttons:   ['Replace', 'Cancel'],
    defaultId: 0,
    cancelId:  1,
    title:     'Save',
    message:   `Replace "${path.basename(filePath)}"?`,
    detail:    'The existing file will be overwritten with your annotated version.',
  });
  if (response !== 0) return { ok: false, error: 'cancelled' };
  try {
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// IPC: save to a new path chosen by the user
ipcMain.handle('save-file-copy', async (_event, arrayBuffer) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Copy',
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false };
  try {
    fs.writeFileSync(result.filePath, Buffer.from(arrayBuffer));
    return { ok: true, filePath: result.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
