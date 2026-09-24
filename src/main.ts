// Reamlet — Electron main process
// SPDX-License-Identifier: GPL-3.0-or-later

'use strict';

import type { BrowserWindow as BW, NativeImage, IpcMainInvokeEvent, IpcMainEvent, Event as ElectronEvent, ContextMenuParams } from 'electron';

const { app, BrowserWindow, ipcMain, dialog, Menu, nativeImage, nativeTheme, shell } = require('electron');
const { execFile } = require('child_process');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const https = require('https');

import { printPdf, type PrintJobOptions, type PrintJobResult } from './print-job';
import {
  readSession, writeSession, toWindowSession, shouldRestore, afterUserClose,
  referencedFiles, adoptDownload, cleanupDownloads,
  type Session, type SessionSettings, type WindowSession,
} from './session';

// ── Window factory ─────────────────────────────────────────────

const isMac = process.platform === 'darwin';

/** A document to open in a freshly created window, with its web origin when it came from one. */
interface OpenTarget { filePath: string; sourceUrl: string | null }

/**
 * Open a window. `restore` is a window from a previous run whose tabs it
 * reopens; `openTarget` opens after them, so it ends up as the active tab.
 */
function createWindow(openTarget: OpenTarget | null, showInactive = false, restore: WindowSession | null = null): BW {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    minWidth: 640,
    minHeight: 480,
    title: 'Reamlet',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff',
    // Mac: use native traffic lights with hidden titlebar; Windows: fully custom frame
    ...(isMac
      ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 13 } }
      : { frame: false }
    ),
    autoHideMenuBar: true, // hide native menu bar; accelerators still work
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => {
    if (showInactive) win.showInactive();
    else win.show();
  });

  wireEditableContextMenu(win);
  trackWindowSession(win, restore);

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Ask renderer to handle the close so it can prompt for unsaved changes
  win.on('close', (e: ElectronEvent) => {
    e.preventDefault();
    win.webContents.send('before-close');
  });

  win.webContents.once('did-finish-load', () => {
    if (restore) win.webContents.send('restore-session', restore);
    if (!openTarget) return;
    try {
      const buffer = fs.readFileSync(openTarget.filePath);
      win.webContents.send('open-file-data', {
        filePath:  openTarget.filePath,
        buffer:    buffer.buffer,
        sourceUrl: openTarget.sourceUrl,
      });
    } catch { /* ignore */ }
  });

  return win;
}

function buildMenu(): void {
  const fw = () => BrowserWindow.getFocusedWindow();
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Open…',       accelerator: 'CmdOrCtrl+O',       click: () => fw()?.webContents.send('menu-open') },
        { label: 'Save',        accelerator: 'CmdOrCtrl+S',       click: () => fw()?.webContents.send('menu-save') },
        { label: 'Save Copy…',  accelerator: 'CmdOrCtrl+Shift+S', click: () => fw()?.webContents.send('menu-save-copy') },
        { type: 'separator' },
        { label: 'Print…',          accelerator: 'CmdOrCtrl+P',           click: () => fw()?.webContents.send('menu-print') },
        { type: 'separator' },
        { label: 'Close Tab',       accelerator: 'CmdOrCtrl+W',           click: () => fw()?.webContents.send('menu-close-tab') },
        { label: 'Reopen Closed Tab', accelerator: 'CmdOrCtrl+Shift+T',  click: () => fw()?.webContents.send('menu-reopen-tab') },
        { type: 'separator' },
        { label: 'Extension ID…', click: () => fw()?.webContents.send('menu-extension-id') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Theme',
          submenu: [
            { label: 'Light',           type: 'radio', checked: nativeTheme.themeSource === 'light',  click: () => fw()?.webContents.send('menu-theme-light') },
            { label: 'Dark',            type: 'radio', checked: nativeTheme.themeSource === 'dark',   click: () => fw()?.webContents.send('menu-theme-dark') },
            { label: 'System Default',  type: 'radio', checked: nativeTheme.themeSource === 'system', click: () => fw()?.webContents.send('menu-theme-system') },
          ],
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'reload' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Drag icon (created once, reused for all native file drags) ──

let _dragIcon: NativeImage | null = null;
function getDragIcon(): NativeImage {
  if (_dragIcon) return _dragIcon;
  _dragIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png'));
  return _dragIcon!;
}

// ── IPC handlers ───────────────────────────────────────────────

ipcMain.handle('open-file-dialog', async (event: IpcMainInvokeEvent) => {
  const win    = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title:      'Open PDF',
    filters:    [{ name: 'PDF Files', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths.map((filePath: string) => ({
    filePath,
    buffer: Buffer.from(fs.readFileSync(filePath)),
  }));
});

ipcMain.handle('save-file', async (_event: IpcMainInvokeEvent, filePath: string, arrayBuffer: ArrayBuffer) => {
  if (!filePath) return { ok: false, error: 'no file path' };
  try {
    fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.handle('save-file-copy', async (event: IpcMainInvokeEvent, arrayBuffer: ArrayBuffer, defaultPath?: string) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  // Default to the user's Downloads folder so saves land somewhere sensible.
  const fallbackDir = app.getPath('downloads');
  const resolvedDefault = defaultPath ?? path.join(fallbackDir, 'document.pdf');
  const result = await dialog.showSaveDialog(win, {
    title: 'Save Copy',
    defaultPath: resolvedDefault,
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return { ok: false };
  try {
    fs.writeFileSync(result.filePath, Buffer.from(arrayBuffer));
    return { ok: true, filePath: result.filePath };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

// Open a new Reamlet window, optionally pre-loading a file
ipcMain.handle('open-new-window', (_event: IpcMainInvokeEvent, filePath?: string) => {
  createWindow(filePath ? { filePath, sourceUrl: null } : null);
  return { ok: true };
});

// Return the BrowserWindow ID so the renderer can tag its drags
ipcMain.handle('get-window-id', (event: IpcMainInvokeEvent) => {
  return BrowserWindow.fromWebContents(event.sender)?.id ?? null;
});

// Read a file from disk and return its buffer (used for cross-window tab drops)
ipcMain.handle('open-file-from-path', (_event: IpcMainInvokeEvent, filePath: string) => {
  try {
    const buffer = fs.readFileSync(filePath);
    return { filePath, buffer: Buffer.from(buffer) };
  } catch {
    return null;
  }
});

// Show a native message box and return the index of the button pressed
ipcMain.handle('show-message-box', async (event: IpcMainInvokeEvent, options: Electron.MessageBoxOptions) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { response } = await dialog.showMessageBox(win, options);
  return response;
});

// Bring this window to the front (called when an external drag hovers over it)
ipcMain.handle('focus-window', (event: IpcMainInvokeEvent) => {
  BrowserWindow.fromWebContents(event.sender)?.focus();
  return { ok: true };
});

// Destroy window unconditionally (after renderer confirms close is OK). This is
// the only way a window closes at the user's request, so it is also where the
// session learns which tabs the user is done with.
ipcMain.handle('force-close', (event: IpcMainInvokeEvent) => {
  forgetUserClosedWindow(event.sender.id);
  BrowserWindow.fromWebContents(event.sender)?.destroy();
  return { ok: true };
});

// Custom window controls
ipcMain.handle('minimize-window',  (event: IpcMainInvokeEvent) => { BrowserWindow.fromWebContents(event.sender)?.minimize();  return { ok: true }; });
ipcMain.handle('toggle-maximize',  (event: IpcMainInvokeEvent) => { const w = BrowserWindow.fromWebContents(event.sender); if (w) { if (w.isMaximized()) { w.unmaximize(); } else { w.maximize(); } } return { ok: true }; });
ipcMain.handle('close-window',     (event: IpcMainInvokeEvent) => { BrowserWindow.fromWebContents(event.sender)?.close();     return { ok: true }; });

// Tell the source window to close the tab that was dragged into another window
ipcMain.handle('notify-tab-transferred', (_event: IpcMainInvokeEvent, sourceWindowId: number, filePath: string) => {
  const win = BrowserWindow.fromId(sourceWindowId);
  if (win) win.webContents.send('close-tab-by-filepath', filePath);
  return { ok: true };
});

ipcMain.on('open-devtools', (event: IpcMainEvent) => {
  BrowserWindow.fromWebContents(event.sender)?.webContents.toggleDevTools();
});

// Copy a file to the system clipboard via PowerShell so it can be pasted
// into Windows Explorer, email clients, etc.
ipcMain.handle('copy-file-to-clipboard', (_event: IpcMainInvokeEvent, filePath: string) => {
  const escaped = filePath.replace(/'/g, "''");
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    execFile('powershell', ['-command', `Set-Clipboard -Path '${escaped}'`], (error: Error | null) => {
      if (error) resolve({ ok: false, error: error.message });
      else resolve({ ok: true });
    });
  });
});

// Show the file in its containing folder in Windows Explorer / Finder
ipcMain.handle('reveal-in-explorer', (_event: IpcMainInvokeEvent, filePath: string) => {
  shell.showItemInFolder(filePath);
  return { ok: true };
});

// Return the list of system printers from the print preview window's web contents
ipcMain.handle('get-printers', async (event: IpcMainInvokeEvent) => {
  return event.sender.getPrintersAsync();
});

// Open the Windows printer preferences dialog for the given printer
ipcMain.handle('open-printer-preferences', async (event: IpcMainInvokeEvent, printerName: string) => {
  const printers = await event.sender.getPrintersAsync();
  const valid = printers.some((p: { name: string }) => p.name === printerName);
  if (!valid) return { ok: false, error: 'Unknown printer.' };
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    execFile('rundll32', ['printui.dll,PrintUIEntry', '/e', '/n', printerName], (error: Error | null) => {
      if (error) resolve({ ok: false, error: error.message });
      else resolve({ ok: true });
    });
  });
});

// Open a visible print preview window where the user can configure and execute printing.
ipcMain.handle('open-print-preview', async (_event: IpcMainInvokeEvent, filePath: string): Promise<{ ok: boolean; error?: string }> => {
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: 'File not found.' };

  const previewWin: BW = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 600,
    minHeight: 400,
    title: 'Print',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  try {
    await previewWin.loadFile(path.join(__dirname, '..', 'renderer', 'print-preview.html'));
    previewWin.show();
    const buffer = fs.readFileSync(filePath);
    previewWin.webContents.send('pdf-data', { buffer: buffer.buffer });
    return { ok: true };
  } catch (err) {
    previewWin.destroy();
    return { ok: false, error: (err as Error).message };
  }
});

// Execute a silent print (no system dialog) of a PDF built by the preview
// window; see src/print-job.ts.
ipcMain.handle('execute-print', (_event: IpcMainInvokeEvent, options: PrintJobOptions & { pdfBytes: ArrayBuffer }): Promise<PrintJobResult> =>
  printPdf(Buffer.from(options.pdfBytes), options));

// Read / write the extension ID in the native messaging host manifest.
// The manifest lives next to the Reamlet exe (installed and portable builds).
function getManifestPath(): string {
  return path.join(path.dirname(process.execPath), 'com.reamlet.chromebridge.json');
}

// ── Spell-check suggestions ──────────────────────────────────────
// Chromium reports the misspelled word and its suggestions only through this
// event, so they're relayed to the renderer to build its own menu with.

/** How many candidates to offer; Chromium usually returns a handful more. */
const MAX_SPELLING_SUGGESTIONS = 5;

export interface EditableContextMenu {
  x: number;
  y: number;
  misspelledWord: string;
  suggestions: string[];
  canCut: boolean;
  canCopy: boolean;
  canPaste: boolean;
}

function wireEditableContextMenu(win: BW): void {
  win.webContents.on('context-menu', (_e: ElectronEvent, params: ContextMenuParams) => {
    if (!params.isEditable) return;
    const payload: EditableContextMenu = {
      x: params.x,
      y: params.y,
      misspelledWord: params.misspelledWord,
      suggestions:    params.dictionarySuggestions.slice(0, MAX_SPELLING_SUGGESTIONS),
      canCut:         params.editFlags.canCut,
      canCopy:        params.editFlags.canCopy,
      canPaste:       params.editFlags.canPaste,
    };
    win.webContents.send('editable-context-menu', payload);
  });
}

// A native edit on the focused field, so it joins the undo stack.
ipcMain.on('replace-misspelling', (e: IpcMainEvent, word: string) => {
  e.sender.replaceMisspelling(word);
});

ipcMain.on('add-to-dictionary', (e: IpcMainEvent, word: string) => {
  e.sender.session.addWordToSpellCheckerDictionary(word);
});

ipcMain.on('editable-edit', (e: IpcMainEvent, command: 'cut' | 'copy' | 'paste') => {
  if      (command === 'cut')   e.sender.cut();
  else if (command === 'copy')  e.sender.copy();
  else if (command === 'paste') e.sender.paste();
});

// Persist user settings (e.g. extensionId) in userData so they survive reinstalls.
function getUserDataSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}
function readUserDataSettings(): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(getUserDataSettingsPath(), 'utf8')); } catch { return {}; }
}
function writeUserDataSettings(settings: Record<string, unknown>): void {
  fs.writeFileSync(getUserDataSettingsPath(), JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

// Apply a saved extension ID to the manifest. Called on startup so reinstalls don't wipe the ID.
function restoreExtensionIdToManifest(): void {
  const settings = readUserDataSettings();
  const id = settings.extensionId;
  if (typeof id !== 'string' || !id) return;
  try {
    const p = getManifestPath();
    const manifest = JSON.parse(fs.readFileSync(p, 'utf8'));
    manifest.allowed_origins = [`chrome-extension://${id}/`];
    fs.writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  } catch { /* manifest unwritable — ignore */ }
}

ipcMain.handle('get-extension-id', () => {
  try {
    const manifest = JSON.parse(fs.readFileSync(getManifestPath(), 'utf8'));
    const origins: string[] = manifest.allowed_origins ?? [];
    const id = origins.map((o: string) => {
      const m = o.match(/^chrome-extension:\/\/([^/]+)\/$/);
      return m ? m[1] : null;
    }).filter(Boolean)[0] ?? '';
    return { ok: true, id };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.handle('set-extension-id', (_event: IpcMainInvokeEvent, id: string) => {
  try {
    const p = getManifestPath();
    const manifest = JSON.parse(fs.readFileSync(p, 'utf8'));
    manifest.allowed_origins = [`chrome-extension://${id}/`];
    fs.writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    const settings = readUserDataSettings();
    settings.extensionId = id;
    writeUserDataSettings(settings);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});

// ── Theme (Light / Dark / System Default) ───────────────────────

type ThemeMode = 'light' | 'dark' | 'system';

// Apply the saved theme preference (defaults to 'system') to nativeTheme.
// Called on startup, before any window is created, so the first paint is already correct.
function restoreThemeSource(): void {
  const settings = readUserDataSettings();
  const mode = settings.themeMode;
  nativeTheme.themeSource = (mode === 'light' || mode === 'dark') ? mode : 'system';
}

function effectiveTheme(): 'light' | 'dark' {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

// ── "Switch to already-open tab" setting ─────────────────────────

ipcMain.handle('get-reuse-tab-setting', () => {
  const settings = readUserDataSettings();
  return { enabled: settings.reuseOpenTab !== false };
});

ipcMain.handle('set-reuse-tab-setting', (_event: IpcMainInvokeEvent, enabled: boolean) => {
  const settings = readUserDataSettings();
  settings.reuseOpenTab = enabled;
  writeUserDataSettings(settings);
  return { ok: true };
});

// ── Session: tabs that outlive the app ───────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** Where downloads land: the browser extension's host and older versions put them here. */
const DOWNLOAD_INBOX = path.join(os.tmpdir(), 'ReamletDownloads');

/** Where downloaded documents live while a tab needs them; unlike the temp folder, the OS leaves it alone. */
function downloadsDir(): string {
  return path.join(app.getPath('userData'), 'Downloads');
}

function sessionFile(): string {
  return path.join(app.getPath('userData'), 'session.json');
}

function sessionSettings(): SessionSettings {
  const settings = readUserDataSettings();
  return {
    restoreSession: settings.restoreSession !== false,
    persistentTabs: settings.persistentTabs === true,
  };
}

/** Each open window's restorable tabs, keyed by webContents id, in window order. */
const _windowSessions = new Map<number, WindowSession>();
let _sessionWriteTimer: ReturnType<typeof setTimeout> | null = null;
/** Set once the OS starts logging off or shutting down, which is not the user closing Reamlet. */
let _osSessionEnding = false;

function currentSession(): Session {
  return { windows: [..._windowSessions.values()].filter(w => w.tabs.length > 0) };
}

/** Write the session file now, or remove it when neither setting wants one kept. */
function saveSessionNow(): void {
  if (_sessionWriteTimer) { clearTimeout(_sessionWriteTimer); _sessionWriteTimer = null; }
  const { restoreSession, persistentTabs } = sessionSettings();
  try {
    if (restoreSession || persistentTabs) writeSession(sessionFile(), currentSession());
    else fs.rmSync(sessionFile(), { force: true });
  } catch { /* unwritable profile: carry on without a saved session */ }
}

function saveSessionSoon(): void {
  if (_sessionWriteTimer) clearTimeout(_sessionWriteTimer);
  _sessionWriteTimer = setTimeout(saveSessionNow, 500);
}

function trackWindowSession(win: BW, restore: WindowSession | null): void {
  const id = win.webContents.id;
  // Until the renderer reports its own tabs, the window holds what it is restoring.
  _windowSessions.set(id, restore ?? { tabs: [], activeIndex: -1 });
  // A logoff, restart or shutdown (Windows) ends the run without the user closing anything.
  win.on('session-end', () => { _osSessionEnding = true; saveSessionNow(); });
}

function forgetUserClosedWindow(id: number): void {
  if (_osSessionEnding) return;
  const isLastWindow = BrowserWindow.getAllWindows().every((w: BW) => w.webContents.id === id);
  const next = afterUserClose(_windowSessions, id, { isLastWindow, persistentTabs: sessionSettings().persistentTabs });
  _windowSessions.clear();
  next.forEach((ws, wid) => _windowSessions.set(wid, ws));
  saveSessionNow();
}

ipcMain.on('session-update', (event: IpcMainEvent, value: unknown) => {
  const ws = toWindowSession(value);
  if (!ws) return;
  _windowSessions.set(event.sender.id, ws);
  saveSessionSoon();
});

ipcMain.handle('get-session-settings', () => sessionSettings());

ipcMain.handle('set-session-settings', (_event: IpcMainInvokeEvent, changes: Partial<SessionSettings>) => {
  const settings = readUserDataSettings();
  if (typeof changes?.restoreSession === 'boolean') settings.restoreSession = changes.restoreSession;
  if (typeof changes?.persistentTabs === 'boolean') settings.persistentTabs = changes.persistentTabs;
  writeUserDataSettings(settings);
  saveSessionNow(); // start or stop keeping the session file straight away
  return sessionSettings();
});

/**
 * Delete day-old downloads that no tab needs: not one open in a window now,
 * nor one a saved session will reopen.
 */
function cleanupAllDownloads(): void {
  const keep = referencedFiles(currentSession(), readSession(sessionFile()));
  cleanupDownloads([DOWNLOAD_INBOX, downloadsDir()], keep, DAY_MS);
}

app.on('before-quit', () => saveSessionNow());

ipcMain.handle('get-theme', () => ({
  mode:      nativeTheme.themeSource as ThemeMode,
  effective: effectiveTheme(),
}));

ipcMain.handle('set-theme', (_event: IpcMainInvokeEvent, mode: ThemeMode) => {
  if (mode !== 'light' && mode !== 'dark' && mode !== 'system') return { ok: false, error: 'Invalid theme mode.' };
  nativeTheme.themeSource = mode;
  const settings = readUserDataSettings();
  settings.themeMode = mode;
  writeUserDataSettings(settings);
  return { ok: true };
});

// Fires whenever themeSource changes (our own calls above, or the OS theme when mode is 'system').
// Broadcast to every window and rebuild the app menu so its radio checkmarks stay in sync.
nativeTheme.on('updated', () => {
  const payload = { mode: nativeTheme.themeSource as ThemeMode, effective: effectiveTheme() };
  BrowserWindow.getAllWindows().forEach((w: BW) => w.webContents.send('theme-updated', payload));
  buildMenu();
});

// Initiate a native OS file drag so external apps (Outlook, Explorer, etc.) can receive the file.
// Must be ipcMain.on (synchronous) — startDrag() must be called in the same tick as the IPC event.
ipcMain.on('start-drag', (event: IpcMainEvent, filePath: string) => {
  if (!filePath || !fs.existsSync(filePath)) return;
  event.sender.startDrag({ file: filePath, icon: getDragIcon() });
});

// ── App lifecycle ──────────────────────────────────────────────

// On macOS, file-open requests arrive via this event (not argv).
// It can fire before app is ready, so queue the path if needed.
let _pendingOpenFile: string | null = null;

app.on('open-file', (e: ElectronEvent, filePath: string) => {
  e.preventDefault();
  if (!app.isReady()) {
    _pendingOpenFile = filePath;
    return;
  }
  filePath = adoptDownload(filePath, DOWNLOAD_INBOX, downloadsDir());
  const wins = BrowserWindow.getAllWindows();
  if (wins.length > 0) {
    const win = wins[0];
    if (win.isMinimized()) win.restore();
    win.focus();
    try {
      const buffer = fs.readFileSync(filePath);
      win.webContents.send('open-file-data', { filePath, buffer: buffer.buffer, sourceUrl: null });
    } catch { /* ignore */ }
  } else {
    createWindow({ filePath, sourceUrl: null });
  }
});

// ── URL / file argument helpers ────────────────────────────────

function isHttpUrl(s: string): boolean {
  return s.startsWith('http://') || s.startsWith('https://');
}

// Extract the first useful argument: an http/https URL, or a local .pdf path.
function getArgvTarget(argv: string[]): string | null {
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a || a.startsWith('-')) continue;
    if (isHttpUrl(a)) return a;
    if (a.toLowerCase().endsWith('.pdf')) {
      try { if (fs.existsSync(a)) return a; } catch { /* ignore */ }
    }
  }
  return null;
}

// Download a remote PDF into the downloads folder and return the local path.
// Only follows HTTPS redirects (no HTTP downgrade). Rejects on HTTP errors or network failures.
function downloadPdf(url: string, redirectsLeft = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    if (redirectsLeft <= 0) { reject(new Error('Too many redirects')); return; }
    if (!url.startsWith('https://')) { reject(new Error('Only HTTPS URLs are supported')); return; }

    const dir = downloadsDir();
    try { fs.mkdirSync(dir, { recursive: true }); } catch { /* already exists */ }

    const req = https.get(url, (res: NodeJS.ReadableStream & { statusCode: number; headers: Record<string, string> }) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        const location = res.headers['location'];
        if (location) {
          resolve(downloadPdf(location, redirectsLeft - 1));
          return;
        }
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let baseName: string;
      try {
        const base = path.basename(new URL(url).pathname) || 'download';
        baseName = base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
      } catch {
        baseName = 'download.pdf';
      }
      // Prefix with a random token to prevent concurrent downloads of the same
      // URL from racing to write the same temp file.
      const token    = Math.random().toString(36).slice(2, 10);
      const filePath = path.join(dir, `${token}-${baseName}`);
      const fileStream = fs.createWriteStream(filePath);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        // Verify the file starts with the PDF magic bytes (%PDF-)
        try {
          const header = Buffer.alloc(5);
          const fd = fs.openSync(filePath, 'r');
          fs.readSync(fd, header, 0, 5, 0);
          fs.closeSync(fd);
          if (header.toString('ascii') !== '%PDF-') {
            fs.unlinkSync(filePath);
            reject(new Error('Downloaded file is not a valid PDF'));
            return;
          }
        } catch (err) {
          reject(err);
          return;
        }
        resolve(filePath);
      });
      fileStream.on('error', reject);
    });
    req.on('error', reject);
  });
}

// Resolve a target (URL or local path) to a local file path ready for opening.
async function resolveTarget(target: string): Promise<OpenTarget | null> {
  if (isHttpUrl(target)) {
    try {
      const filePath = await downloadPdf(target);
      dialog.showMessageBox({
        type:    'info',
        title:   'Reamlet — Download complete',
        message: `Downloaded to:\n${filePath}`,
        buttons: ['OK'],
      });
      return { filePath, sourceUrl: target };
    } catch (err) {
      dialog.showErrorBox('Reamlet — Could not open URL', (err as Error).message ?? 'Download failed.');
      return null;
    }
  }
  return { filePath: adoptDownload(target, DOWNLOAD_INBOX, downloadsDir()), sourceUrl: null };
}

/**
 * Open the first window(s) of a run: one per window of the saved session when
 * it is being restored, with `openTarget` added to the first, else one window.
 */
function openStartupWindows(openTarget: OpenTarget | null, showInactive: boolean): void {
  const saved = readSession(sessionFile());
  if (!shouldRestore(sessionSettings(), saved)) {
    createWindow(openTarget, showInactive);
    return;
  }
  saved.windows.forEach((ws, i) => createWindow(i === 0 ? openTarget : null, showInactive, ws));
}

// Single-instance lock: if another Reamlet is already running, forward the
// file to it and quit, so the user always ends up with one window.
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', async (_event: ElectronEvent, argv: string[]) => {
    const target     = getArgvTarget(argv);
    const background = argv.includes('--background');
    // Find the existing window, bring it forward, and open the file as a new tab
    const wins = BrowserWindow.getAllWindows();
    const win  = wins[0];
    if (!win) return;
    if (!background) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    if (target) {
      const resolved = await resolveTarget(target);
      if (resolved) {
        try {
          const buffer = fs.readFileSync(resolved.filePath);
          win.webContents.send('open-file-data', {
            filePath:  resolved.filePath,
            buffer:    buffer.buffer,
            sourceUrl: resolved.sourceUrl,
          });
        } catch { /* ignore */ }
      }
    }
  });

  app.whenReady().then(async () => {
    restoreExtensionIdToManifest();
    restoreThemeSource();
    cleanupAllDownloads();
    setInterval(cleanupAllDownloads, 60 * 60 * 1000);
    const pendingTarget = _pendingOpenFile || getArgvTarget(process.argv);
    _pendingOpenFile = null;
    const openTarget  = pendingTarget ? await resolveTarget(pendingTarget) : null;
    const background  = process.argv.includes('--background');
    openStartupWindows(openTarget, background);
    buildMenu();
  });

  // Mac: keep the app running when the last window is closed (dock icon stays)
  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });

  // Mac: re-open a window when the dock icon is clicked with none open
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openStartupWindows(null, false);
  });
}
