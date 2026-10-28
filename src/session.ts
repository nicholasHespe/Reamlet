// Reamlet — the tabs that outlive the app, and the downloaded files they need.
//
// Main-process logic with no Electron dependency: main.ts wires it to windows,
// IPC and settings, and the tests exercise it directly.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import * as fs from 'fs';
import * as path from 'path';

/** A restorable tab: a document on disk, with its web origin when it came from one. */
export interface SessionTab {
  filePath: string;
  sourceUrl: string | null;
}

/** The restorable tabs of one window, in tab-bar order. */
export interface WindowSession {
  tabs: SessionTab[];
  /** Index into `tabs` of the tab that was showing; -1 when none was. */
  activeIndex: number;
}

/** Every window's tabs, in the order the windows were opened. */
export interface Session {
  windows: WindowSession[];
}

/** When the app reopens the tabs a previous run left behind. */
export interface SessionSettings {
  /** After the app exits without the user closing it: a crash, power loss, OS restart. */
  restoreSession: boolean;
  /** Also after the user closes the window. */
  persistentTabs: boolean;
}

export const EMPTY_SESSION: Session = { windows: [] };

// ── Validation ────────────────────────────────────────────────

/** A WindowSession built from untrusted input (IPC or a file on disk), or null if it isn't one. */
export function toWindowSession(value: unknown): WindowSession | null {
  if (typeof value !== 'object' || value === null) return null;
  const { tabs, activeIndex } = value as { tabs?: unknown; activeIndex?: unknown };
  if (!Array.isArray(tabs)) return null;
  const clean: SessionTab[] = [];
  for (const tab of tabs) {
    if (typeof tab !== 'object' || tab === null) continue;
    const { filePath, sourceUrl } = tab as { filePath?: unknown; sourceUrl?: unknown };
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) continue;
    clean.push({ filePath, sourceUrl: typeof sourceUrl === 'string' ? sourceUrl : null });
  }
  const index = Number.isInteger(activeIndex) ? activeIndex as number : -1;
  return { tabs: clean, activeIndex: index >= 0 && index < clean.length ? index : -1 };
}

// ── Reading and writing ───────────────────────────────────────

/** The session saved at `file`; an empty one if it is missing or unreadable. */
export function readSession(file: string): Session {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return EMPTY_SESSION;
  }
  const windows = (parsed as { windows?: unknown })?.windows;
  if (!Array.isArray(windows)) return EMPTY_SESSION;
  return {
    windows: windows
      .map(toWindowSession)
      .filter((w): w is WindowSession => w !== null && w.tabs.length > 0),
  };
}

/**
 * Save `session` to `file`. It is written beside the target and renamed over
 * it, so losing power mid-write leaves the previous session intact rather than
 * a truncated file.
 */
export function writeSession(file: string, session: Session): void {
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

// ── Deciding what survives ────────────────────────────────────

/** Whether the saved session should be reopened at launch. */
export function shouldRestore(settings: SessionSettings, saved: Session): boolean {
  return (settings.restoreSession || settings.persistentTabs) && saved.windows.length > 0;
}

/**
 * The session left once the user closes window `closingId`. Closing one window
 * of several forgets its tabs. Closing the last window ends the run: its tabs
 * are kept only with persistent tabs on, since only a run that ends without
 * the user's say-so needs recovering.
 */
export function afterUserClose(
  windows: Map<number, WindowSession>, closingId: number,
  { isLastWindow, persistentTabs }: { isLastWindow: boolean; persistentTabs: boolean },
): Map<number, WindowSession> {
  if (!isLastWindow) {
    const remaining = new Map(windows);
    remaining.delete(closingId);
    return remaining;
  }
  return persistentTabs ? new Map(windows) : new Map();
}

// ── Downloaded files ──────────────────────────────────────────

/** A path in a form two spellings of the same file compare equal in. */
export function normalizePath(p: string, platform = process.platform): string {
  const resolved = path.resolve(p);
  return platform === 'win32' || platform === 'darwin' ? resolved.toLowerCase() : resolved;
}

/** Whether `filePath` lies inside directory `dir`. */
export function isInside(filePath: string, dir: string): boolean {
  const rel = path.relative(normalizePath(dir), normalizePath(filePath));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** The files any tab in `sessions` still needs, normalised. */
export function referencedFiles(...sessions: Session[]): Set<string> {
  const files = new Set<string>();
  for (const session of sessions) {
    for (const win of session.windows) {
      for (const tab of win.tabs) files.add(normalizePath(tab.filePath));
    }
  }
  return files;
}

/**
 * `fileName` made safe to save on Windows: no directory part, no reserved
 * characters or device names, and always ending in .pdf.
 */
export function safePdfName(fileName: string): string {
  let name = (fileName.split(/[\\/]/).pop() ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)) name = '_' + name;
  if (!name.toLowerCase().endsWith('.pdf')) name = (name || 'download') + '.pdf';
  if (name.length > 200) name = name.slice(0, 196) + '.pdf';
  return name;
}

/**
 * The name a downloaded PDF should be saved under: the server's
 * Content-Disposition filename (filename* first, then filename), else the
 * last segment of the URL's path.
 */
export function pdfFileName(contentDisposition: string | null | undefined, url: string): string {
  const cd = contentDisposition ?? '';
  let name = '';
  const encoded = /filename\*\s*=\s*[\w-]+'[^']*'([^;]+)/i.exec(cd);
  if (encoded) {
    try { name = decodeURIComponent(encoded[1].trim()); } catch { /* malformed */ }
  }
  if (!name) {
    const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i.exec(cd);
    if (plain) name = (plain[1]?.replace(/\\(.)/g, '$1') ?? plain[2]).trim();
  }
  if (!name) {
    let segment = '';
    try { segment = new URL(url).pathname.split('/').pop() ?? ''; } catch { /* not a URL */ }
    try { name = decodeURIComponent(segment); } catch { name = segment; }
  }
  return safePdfName(name);
}

/** The first of `name.ext`, `name (2).ext`, `name (3).ext`, … not taken in `dir`. */
export function uniquePath(dir: string, fileName: string): string {
  const { name, ext } = path.parse(fileName);
  let dest = path.join(dir, fileName);
  for (let n = 2; fs.existsSync(dest); n++) dest = path.join(dir, `${name} (${n})${ext}`);
  return dest;
}

/**
 * Create an empty file in `dir` named like uniquePath() and return its path.
 * Creating it claims the name, so two downloads can't pick the same one.
 */
export function createUniqueFile(dir: string, fileName: string): string {
  const { name, ext } = path.parse(fileName);
  for (let n = 1; ; n++) {
    const dest = path.join(dir, n === 1 ? fileName : `${name} (${n})${ext}`);
    try {
      fs.closeSync(fs.openSync(dest, 'wx'));
      return dest;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
}

/**
 * Move a file out of the temporary `inboxDir`, where downloads arrive, into
 * the durable `downloadsDir`, so the OS's temp-folder cleanup can't take a
 * document that a tab still has open. Files outside the inbox are returned
 * unchanged, as is the original path if the move fails.
 */
export function adoptDownload(filePath: string, inboxDir: string, downloadsDir: string): string {
  if (!isInside(filePath, inboxDir)) return filePath;
  try {
    fs.mkdirSync(downloadsDir, { recursive: true });
    const dest = uniquePath(downloadsDir, path.basename(filePath));
    try {
      fs.renameSync(filePath, dest);
    } catch {
      // Across volumes, or while another process holds the file: copy it, and
      // leave an original that won't delete to the inbox's own cleanup.
      fs.copyFileSync(filePath, dest);
      try { fs.unlinkSync(filePath); } catch { /* removed by cleanupDownloads later */ }
    }
    return dest;
  } catch {
    return filePath;
  }
}

/**
 * Delete files in `dirs` older than `maxAgeMs` that no tab needs. Returns the
 * paths removed. Missing directories and files that can't be removed (still
 * open elsewhere, say) are skipped.
 */
export function cleanupDownloads(dirs: string[], keep: Set<string>, maxAgeMs: number, now = Date.now()): string[] {
  const removed: string[] = [];
  for (const dir of dirs) {
    let names: string[];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      const file = path.join(dir, name);
      if (keep.has(normalizePath(file))) continue;
      try {
        const stat = fs.statSync(file);
        if (!stat.isFile() || now - stat.mtimeMs <= maxAgeMs) continue;
        fs.unlinkSync(file);
        removed.push(file);
      } catch { /* in use or already gone */ }
    }
  }
  return removed;
}
