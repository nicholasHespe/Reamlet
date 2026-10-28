// Reamlet — printing a PDF, silently (no system dialog), to a named printer.
// SPDX-License-Identifier: GPL-3.0-or-later
//
// The PDF is loaded into Chromium's own native PDF viewer (a real, separate
// BrowserWindow) rather than printing the calling window's own HTML. That
// viewer renders vector PDF content directly, so printed output keeps full
// fidelity at whatever resolution the printer uses, instead of the fixed,
// low-DPI raster a <canvas>/<img>-based print previously baked in (see
// src/renderer/print-compose.ts for where that PDF is built).

import { BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface PrintJobOptions {
  deviceName:  string;
  copies:      number;
  color:       boolean;
  collate:     boolean;
  duplexMode:  'simplex' | 'longEdge' | 'shortEdge';
  scaleFactor: number;
  landscape:   boolean;
  pageSize:    { width: number; height: number }; // microns
}

export interface PrintJobResult {
  ok: boolean;
  error?: string;
}

/** Send `pdfBytes` to the printer `options.deviceName`. Resolves once the job is on its way. */
export async function printPdf(pdfBytes: Uint8Array, options: PrintJobOptions): Promise<PrintJobResult> {
  const tempDir  = path.join(os.tmpdir(), 'ReamletPrintJobs');
  const tempFile = path.join(tempDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`);
  let printWin: BrowserWindow | null = null;
  try {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(tempFile, pdfBytes);

    const win = new BrowserWindow({
      show: false, // never shown — see backgroundThrottling below for why this doesn't blank the print output
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        // Enables Chromium's built-in (PDFium) PDF viewer for the load below.
        plugins: true,
        // Chromium normally throttles/skips rendering work for a backgrounded
        // (never-shown) page, which is why an earlier version of this code had
        // to actually show the window to get the PDF viewer to render at all —
        // at the cost of flashing Chromium's own PDF viewer chrome (with its
        // own print button) on screen. Disabling backgroundThrottling keeps
        // frames rendering normally while the window stays fully hidden,
        // which is the documented purpose of this option (see Electron's
        // BrowserWindowConstructorOptions.webPreferences.backgroundThrottling).
        backgroundThrottling: false,
      },
    });
    printWin = win;

    // The built-in PDF viewer sets the window title to the document's name once
    // it has finished loading and laying out the PDF; page-title-updated is a
    // more reliable "ready to print" signal than did-finish-load (which fires
    // once the viewer *shell* loads, before the PDF itself has rendered). A
    // fallback timeout guards against PDFs that never trigger the title update.
    const readyPromise = new Promise<void>(resolve => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      const timer = setTimeout(finish, 3000);
      win.webContents.once('page-title-updated', () => { clearTimeout(timer); finish(); });
    });

    await win.loadURL('file:///' + tempFile.replace(/\\/g, '/'));
    await readyPromise;

    // webContents.print()'s completion callback is unreliable on Windows for
    // at least some printer/driver combinations: confirmed by testing against
    // a real network printer, where a job that printed correctly never called
    // back at all (waited 90+ seconds). Genuine failures — an unknown device
    // name, a driver rejecting the job outright — do call back, and quickly
    // (well under a second in testing). So the callback is trustworthy for
    // fast failures but not for slow-or-missing success, meaning we can't
    // just await it directly without hanging on exactly the printers that work.
    //
    // Tried watching the Windows print spooler (via a WMI event subscription)
    // for the job to actually appear, as a real signal instead of a guess —
    // reliable in isolated testing, but not in practice: it depends on a
    // freshly spawned PowerShell process reaching a ready state fast enough
    // to catch a job that a quick printer can spool and clear in well under a
    // second, and PowerShell's own startup time turned out to be highly
    // variable (measured 1-5+ seconds), even when kept warm across prints. A
    // flat timeout is simpler, has no OS-specific moving parts, and — once
    // the window/temp-file cleanup below was decoupled from it — carries no
    // real downside beyond making the user wait out the window.
    const RESPONSE_TIMEOUT_MS = 2000;
    let printResult: { ok: true } | { ok: false; error: string } | null = null;
    const callbackDone = new Promise<void>(resolve => {
      win.webContents.print(
        {
          silent:      true,
          deviceName:  options.deviceName,
          copies:      options.copies,
          color:       options.color,
          collate:     options.collate,
          duplexMode:  options.duplexMode,
          scaleFactor: options.scaleFactor,
          landscape:   options.landscape,
          // Without an explicit pageSize the printer's own default paper size is
          // used (often mismatched with the source PDF), and the print job's
          // content — sized in physical units to match — can end up taller
          // than the printer's chosen page, spilling onto an extra blank page.
          pageSize:    options.pageSize,
        },
        (ok: boolean, errorType: string) => {
          printResult = ok ? { ok: true } : { ok: false, error: errorType };
          resolve();
        }
      );
    });

    await Promise.race([callbackDone, new Promise<void>(resolve => setTimeout(resolve, RESPONSE_TIMEOUT_MS))]);

    // Don't tear down the window/temp file the instant the response goes out —
    // if the callback hasn't fired yet, the job may still be spooling from it,
    // and destroying the window mid-transfer reports (and may cause) a failure
    // even though the print itself completes fine. Let it finish in the
    // background, bounded so a job that genuinely never calls back doesn't
    // leak the window/temp file forever.
    void (async () => {
      await Promise.race([callbackDone, new Promise<void>(resolve => setTimeout(resolve, 120_000))]);
      win.destroy();
      try { fs.unlinkSync(tempFile); } catch { /* already gone */ }
    })();
    printWin = null; // ownership of cleanup moved to the background task above

    return printResult ?? { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  } finally {
    printWin?.destroy();
    if (printWin) { try { fs.unlinkSync(tempFile); } catch { /* already gone */ } }
  }
}
