// Reamlet — preload script
// SPDX-License-Identifier: GPL-3.0-or-later

'use strict';

import type { MessageBoxOptions } from 'electron';

interface EditableContextMenuData {
  x: number;
  y: number;
  misspelledWord: string;
  suggestions: string[];
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
}

const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // File open dialog → [{ filePath, buffer }] or null
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),

  // Overwrite file at filePath
  saveFile: (filePath: string, arrayBuffer: ArrayBuffer) => ipcRenderer.invoke('save-file', filePath, arrayBuffer),

  // Save-as dialog (defaultPath is optional; used for combined tabs to suggest a directory)
  saveFileCopy: (arrayBuffer: ArrayBuffer, defaultPath?: string) => ipcRenderer.invoke('save-file-copy', arrayBuffer, defaultPath),

  // Show a native message box; returns the index of the button pressed
  showMessageBox: (options: MessageBoxOptions) => ipcRenderer.invoke('show-message-box', options),

  // Open a new window, optionally preloading a file path
  openNewWindow: (filePath?: string) => ipcRenderer.invoke('open-new-window', filePath),

  // This window's Electron BrowserWindow ID (for cross-window drag tagging)
  getWindowId: () => ipcRenderer.invoke('get-window-id'),

  // Read a PDF from disk (for cross-window tab drag target)
  openFileFromPath: (filePath: string) => ipcRenderer.invoke('open-file-from-path', filePath),

  // Tell the source window to close the tab that was just accepted here
  notifyTabTransferred: (sourceWindowId: number, filePath: string) =>
    ipcRenderer.invoke('notify-tab-transferred', sourceWindowId, filePath),

  // Read the current extension ID from the native messaging manifest
  getExtensionId: () => ipcRenderer.invoke('get-extension-id'),

  // Write a new extension ID to the native messaging manifest
  setExtensionId: (id: string) => ipcRenderer.invoke('set-extension-id', id),

  // Whether re-opening an already-open document switches to its tab
  getReuseTabSetting: () => ipcRenderer.invoke('get-reuse-tab-setting'),
  setReuseTabSetting: (enabled: boolean) => ipcRenderer.invoke('set-reuse-tab-setting', enabled),

  // Tabs that outlive the app: the settings, this window's tabs as they change,
  // and the tabs of a previous run to reopen
  getSessionSettings: () => ipcRenderer.invoke('get-session-settings'),
  setSessionSettings: (changes: { restoreSession?: boolean; persistentTabs?: boolean }) =>
    ipcRenderer.invoke('set-session-settings', changes),
  updateSession: (session: { tabs: { filePath: string; sourceUrl: string | null }[]; activeIndex: number }) =>
    ipcRenderer.send('session-update', session),
  onRestoreSession: (callback: (session: { tabs: { filePath: string; sourceUrl: string | null }[]; activeIndex: number }) => void) => {
    ipcRenderer.on('restore-session', (_e: unknown, session: { tabs: { filePath: string; sourceUrl: string | null }[]; activeIndex: number }) => callback(session));
  },

  // Theme (Light / Dark / System Default)
  getTheme: () => ipcRenderer.invoke('get-theme'),
  setTheme: (mode: 'light' | 'dark' | 'system') => ipcRenderer.invoke('set-theme', mode),
  onThemeUpdated: (callback: (data: { mode: 'light' | 'dark' | 'system'; effective: 'light' | 'dark' }) => void) => {
    ipcRenderer.on('theme-updated', (_e: unknown, data: { mode: 'light' | 'dark' | 'system'; effective: 'light' | 'dark' }) => callback(data));
  },

  // Spell-check + editing context menu for text fields
  onEditableContextMenu: (callback: (data: EditableContextMenuData) => void) => {
    ipcRenderer.on('editable-context-menu', (_e: unknown, data: EditableContextMenuData) => callback(data));
  },
  replaceMisspelling: (word: string) => ipcRenderer.send('replace-misspelling', word),
  addToDictionary:    (word: string) => ipcRenderer.send('add-to-dictionary', word),
  editableCommand:    (command: 'cut' | 'copy' | 'paste') => ipcRenderer.send('editable-edit', command),

  // Subscribe to menu events
  onMenuEvent: (callback: (event: string) => void) => {
    ['menu-open', 'menu-save', 'menu-save-copy', 'menu-print', 'menu-close-tab', 'menu-reopen-tab', 'menu-extension-id',
     'menu-theme-light', 'menu-theme-dark', 'menu-theme-system']
      .forEach(ev => ipcRenderer.on(ev, () => callback(ev)));
  },

  // File data pushed from main when a new window opens with a pre-selected
  // file, or a file/URL is forwarded to the running instance. sourceUrl is set
  // only when the document came from the web.
  onOpenFileData: (callback: (data: { filePath: string; buffer: ArrayBuffer; sourceUrl: string | null }) => void) => {
    ipcRenderer.on('open-file-data', (_e: unknown, data: { filePath: string; buffer: ArrayBuffer; sourceUrl: string | null }) => callback(data));
  },

  // Main relays this when another window accepted one of our tabs via drag
  onCloseTabByFilepath: (callback: (filePath: string) => void) => {
    ipcRenderer.on('close-tab-by-filepath', (_e: unknown, filePath: string) => callback(filePath));
  },

  // Copy a file to the clipboard so it can be pasted into Explorer, email, etc.
  copyFileToClipboard: (filePath: string) => ipcRenderer.invoke('copy-file-to-clipboard', filePath),

  // Show the file in its containing folder
  revealInExplorer: (filePath: string) => ipcRenderer.invoke('reveal-in-explorer', filePath),

  // Print preview APIs
  openPrintPreview:       (filePath: string) => ipcRenderer.invoke('open-print-preview', filePath),
  onPdfData:              (callback: (data: { buffer: ArrayBuffer }) => void) => {
    ipcRenderer.on('pdf-data', (_e: unknown, data: { buffer: ArrayBuffer }) => callback(data));
  },
  getPrinters:            () => ipcRenderer.invoke('get-printers'),
  openPrinterPreferences: (printerName: string) => ipcRenderer.invoke('open-printer-preferences', printerName),
  executePrint: (options: {
    pdfBytes:    ArrayBuffer;
    deviceName:  string;
    copies:      number;
    color:       boolean;
    collate:     boolean;
    duplexMode:  'simplex' | 'longEdge' | 'shortEdge';
    scaleFactor: number;
    landscape:   boolean;
    pageSize:    { width: number; height: number }; // microns
  }) => ipcRenderer.invoke('execute-print', options),

  // Initiate a native OS file drag (for dragging into Outlook, Explorer, etc.)
  startDrag: (filePath: string) => ipcRenderer.send('start-drag', filePath),

  // Scale the entire UI (webFrame zoom, 1.0 = 100%)
  setUiZoom: (factor: number) => webFrame.setZoomFactor(factor),
  getUiZoom: () => webFrame.getZoomFactor(),

  // Custom window controls (used because frame: false removes native chrome)
  minimizeWindow:  () => ipcRenderer.invoke('minimize-window'),
  toggleMaximize:  () => ipcRenderer.invoke('toggle-maximize'),
  closeWindow:     () => ipcRenderer.invoke('close-window'),

  // Current platform — lets the renderer apply Mac-specific UI adjustments
  platform: process.platform,

  // Toggle DevTools for the current window
  openDevTools: () => ipcRenderer.send('open-devtools'),

  // Bring this window to the front (used when an external tab drag hovers over it)
  focusWindow: () => ipcRenderer.invoke('focus-window'),

  // Destroy window after renderer confirms close (for unsaved-changes dialog)
  forceClose: () => ipcRenderer.invoke('force-close'),

  // Main fires this when the OS close button is pressed
  onBeforeClose: (callback: () => void) => {
    ipcRenderer.on('before-close', () => callback());
  },
});
