// Reamlet — printer preferences that apply to one print, not to the printer.
//
// Windows keeps a printer's settings (paper tray, media type, quality...) as a
// per-user default that every program starts from, so a program that changes
// them there changes them for all of them. Most programs avoid that by showing
// the driver's preferences dialog through DocumentProperties, which hands the
// edited settings back instead of saving them. Reamlet used to open the
// Printers control panel's dialog (`printui.dll /e`), which saves them — so one
// pick of a label tray stuck until someone picked the paper tray back.
//
// Electron's print() can't be given a tray or media type, only read them from
// the printer's default, so a chosen set of settings is put there for the
// length of the print and the previous ones restored afterwards.
//
// Main-process logic with no Electron dependency: main.ts wires it to IPC and
// the tests exercise it directly.
//
// SPDX-License-Identifier: GPL-3.0-or-later

import * as fs from 'fs';
import * as path from 'path';
import { execFile, type ExecFileException } from 'child_process';

// ── Settings blobs ────────────────────────────────────────────

/**
 * A printer's settings (a DEVMODE, including the driver's private part) as
 * base64. The renderer holds them between the dialog and the print, but they
 * only mean anything to the driver that produced them.
 */
export type DevMode = string;

// Offsets in the fixed header of a DEVMODEW: dmSize and dmDriverExtra, both
// 16-bit, whose sum is the length of the whole structure.
const DM_SIZE_OFFSET = 68;
const DM_HEADER_LENGTH = 72;

/** Whether `value` is the right length for the DEVMODE it claims to be. */
export function isDevMode(value: unknown): value is DevMode {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < DM_HEADER_LENGTH) return false;
  const size  = bytes.readUInt16LE(DM_SIZE_OFFSET);
  const extra = bytes.readUInt16LE(DM_SIZE_OFFSET + 2);
  return bytes.length === size + extra;
}

// ── Applying settings for the length of a print ───────────────

/** Reads and writes a printer's per-user default settings. */
export interface DefaultsStore {
  read(printer: string): Promise<DevMode>;
  write(printer: string, devMode: DevMode): Promise<void>;
}

/** Settings still to be put back, so a run that dies mid-print can finish the job. */
export interface PendingRestore { printer: string; devMode: DevMode }

export interface RestoreJournal {
  save(pending: PendingRestore): void;
  clear(): void;
  load(): PendingRestore | null;
}

/** A journal kept in a file, written beside the target and renamed over it. */
export function fileJournal(file: string): RestoreJournal {
  return {
    save(pending) {
      const tmp = `${file}.tmp`;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(pending), 'utf8');
      fs.renameSync(tmp, file);
    },
    clear() {
      fs.rmSync(file, { force: true });
    },
    load() {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<PendingRestore>;
        return typeof parsed.printer === 'string' && isDevMode(parsed.devMode)
          ? { printer: parsed.printer, devMode: parsed.devMode }
          : null;
      } catch {
        return null;
      }
    },
  };
}

export class PrinterDefaults {
  /** Ends when the print holding the printer's defaults lets go of them. */
  private tail: Promise<void> = Promise.resolve();

  constructor(private store: DefaultsStore, private journal: RestoreJournal) {}

  /**
   * Take the printer's defaults for one print: wait for any print before this
   * one to finish with them, then make `devMode` the default (when there is
   * one — a print with no chosen settings just uses what the printer has).
   *
   * Resolves with a function that puts the previous defaults back and lets the
   * next print in. It must be called once the printer has taken what it needs
   * from the defaults, success or not; if it can't restore them it leaves a
   * note for recover() rather than throwing, since by then the print is done.
   */
  async acquire(printer: string, devMode: DevMode | null): Promise<() => Promise<void>> {
    const previous = this.tail;
    let unlock!: () => void;
    this.tail = new Promise<void>(resolve => { unlock = resolve; });
    await previous;

    let original: DevMode | null = null;
    try {
      if (devMode !== null) {
        original = await this.store.read(printer);
        this.journal.save({ printer, devMode: original });
        await this.store.write(printer, devMode);
      }
    } catch (err) {
      await this.putBack(printer, original);
      unlock();
      throw err;
    }

    let released = false;
    return async () => {
      if (released) return;
      released = true;
      try {
        await this.putBack(printer, original);
      } finally {
        unlock();
      }
    };
  }

  /** Finish restoring the defaults of a run that ended before it could. */
  async recover(): Promise<void> {
    const pending = this.journal.load();
    if (!pending) return;
    await this.store.write(pending.printer, pending.devMode);
    this.journal.clear();
  }

  private async putBack(printer: string, original: DevMode | null): Promise<void> {
    if (original === null) return;
    try {
      await this.store.write(printer, original);
      this.journal.clear();
    } catch (err) {
      console.error(`Could not restore the defaults of printer "${printer}"; will retry at next start.`, err);
    }
  }
}

// ── The Windows side ──────────────────────────────────────────

// Run in PowerShell, which can compile and call winspool without anything to
// install or ship. Reads its operation, the printer and (for prompt/set)
// the settings from the environment and stdin, so nothing user-provided is
// ever part of a command line.
//
//   get     print the printer's current settings
//   prompt  show the driver's preferences dialog, starting from the settings on
//           stdin if any, and print what the user chose (exit 2 if they cancel);
//           nothing is saved
//   set     make the settings on stdin the printer's default for this user
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class ReamletDevMode
{
    const int DM_OUT_BUFFER = 2, DM_IN_PROMPT = 4, DM_IN_BUFFER = 8;
    const int IDOK = 1;

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv", SetLastError = true)]
    static extern bool ClosePrinter(IntPtr handle);
    [DllImport("winspool.drv", EntryPoint = "DocumentPropertiesW", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern int DocumentProperties(IntPtr hwnd, IntPtr printer, string name, IntPtr output, IntPtr input, int mode);
    [DllImport("winspool.drv", EntryPoint = "SetPrinterW", SetLastError = true)]
    static extern bool SetPrinter(IntPtr printer, int level, IntPtr info, int command);

    static IntPtr Open(string name)
    {
        IntPtr handle;
        if (!OpenPrinter(name, out handle, IntPtr.Zero)) throw new Win32Exception();
        return handle;
    }

    // The printer's settings for this user, optionally starting from \`input\` and put in
    // front of the user to edit. Returns null if they cancel the dialog.
    public static byte[] Read(string name, byte[] input, bool prompt)
    {
        IntPtr printer = Open(name), inBuf = IntPtr.Zero, outBuf = IntPtr.Zero;
        try
        {
            int size = DocumentProperties(IntPtr.Zero, printer, name, IntPtr.Zero, IntPtr.Zero, 0);
            if (size <= 0) throw new Win32Exception();
            outBuf = Marshal.AllocHGlobal(size);
            int mode = DM_OUT_BUFFER;
            if (input != null)
            {
                inBuf = Marshal.AllocHGlobal(Math.Max(size, input.Length));
                Marshal.Copy(input, 0, inBuf, input.Length);
                mode |= DM_IN_BUFFER;
            }
            if (prompt) mode |= DM_IN_PROMPT;
            int result = DocumentProperties(IntPtr.Zero, printer, name, outBuf, inBuf, mode);
            if (result < 0) throw new Win32Exception();
            if (prompt && result != IDOK) return null;
            byte[] output = new byte[size];
            Marshal.Copy(outBuf, output, 0, size);
            return output;
        }
        finally
        {
            if (inBuf != IntPtr.Zero) Marshal.FreeHGlobal(inBuf);
            if (outBuf != IntPtr.Zero) Marshal.FreeHGlobal(outBuf);
            ClosePrinter(printer);
        }
    }

    // Replace this user's default settings for the printer (PRINTER_INFO_9).
    public static void Write(string name, byte[] devMode)
    {
        IntPtr printer = Open(name), dm = Marshal.AllocHGlobal(devMode.Length), info = Marshal.AllocHGlobal(IntPtr.Size);
        try
        {
            Marshal.Copy(devMode, 0, dm, devMode.Length);
            Marshal.WriteIntPtr(info, dm);
            if (!SetPrinter(printer, 9, info, 0)) throw new Win32Exception();
        }
        finally
        {
            Marshal.FreeHGlobal(info);
            Marshal.FreeHGlobal(dm);
            ClosePrinter(printer);
        }
    }
}
'@

$op      = $env:REAMLET_OP
$printer = $env:REAMLET_PRINTER
$stdin   = [Console]::In.ReadToEnd() -replace '[^A-Za-z0-9+/=]', ''
$devMode = if ($stdin) { [Convert]::FromBase64String($stdin) } else { $null }

try {
    switch ($op) {
        'get'    { [Console]::Out.Write([Convert]::ToBase64String([ReamletDevMode]::Read($printer, $null, $false))) }
        'prompt' {
            $chosen = [ReamletDevMode]::Read($printer, $devMode, $true)
            if ($chosen) { [Console]::Out.Write([Convert]::ToBase64String($chosen)) } else { exit 2 }
        }
        'set'    { [ReamletDevMode]::Write($printer, $devMode) }
        default  { throw "Unknown operation '$op'" }
    }
} catch {
    [Console]::Error.Write($_.Exception.Message)
    exit 1
}
`;

const ENCODED_SCRIPT = Buffer.from(SCRIPT, 'utf16le').toString('base64');

/** How long to wait on a driver that never answers; the dialog has no limit. */
const TOOL_TIMEOUT_MS = 30_000;

const EXIT_CANCELLED = 2;

type ToolResult = { code: number; stdout: string; stderr: string };

function runTool(op: 'get' | 'prompt' | 'set', printer: string, devMode: DevMode | null): Promise<ToolResult> {
  // windowsHide starts the process with its windows hidden, and the first one a
  // driver's preferences dialog shows inherits that: Microsoft's own come up
  // invisible, leaving the print window waiting on a dialog nobody can see. So the
  // dialog's process starts normally and PowerShell hides its own console instead
  // (at the cost of that console flashing up briefly); the rest show nothing.
  const showsDialog = op === 'prompt';
  return new Promise(resolve => {
    const child = execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', ENCODED_SCRIPT],
      {
        env:         { ...process.env, REAMLET_OP: op, REAMLET_PRINTER: printer },
        windowsHide: !showsDialog,
        timeout:     showsDialog ? 0 : TOOL_TIMEOUT_MS,
        maxBuffer:   16 * 1024 * 1024,
      },
      (error: ExecFileException | null, stdout: string, stderr: string) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({ code, stdout: stdout.trim(), stderr: (stderr || error?.message || '').trim() });
      },
    );
    child.stdin?.on('error', () => { /* the callback reports a process that exited early */ });
    child.stdin?.end(devMode ?? '');
  });
}

/** The printer's per-user default settings, read and written through winspool. */
export const windowsDefaultsStore: DefaultsStore = {
  async read(printer) {
    const r = await runTool('get', printer, null);
    if (r.code !== 0 || !isDevMode(r.stdout)) throw new Error(r.stderr || 'Could not read the printer settings.');
    return r.stdout;
  },
  async write(printer, devMode) {
    const r = await runTool('set', printer, devMode);
    if (r.code !== 0) throw new Error(r.stderr || 'Could not apply the printer settings.');
  },
};

export type PreferencesResult =
  | { ok: true; devMode: DevMode }
  | { ok: true; cancelled: true }
  | { ok: false; error: string };

/**
 * Show the driver's preferences dialog for `printer`, starting from `current`
 * (an earlier pick) when there is one. Resolves when it closes, with the
 * settings chosen. Nothing is saved to the printer.
 */
export async function askPrinterPreferences(printer: string, current: DevMode | null): Promise<PreferencesResult> {
  const r = await runTool('prompt', printer, current);
  if (r.code === EXIT_CANCELLED) return { ok: true, cancelled: true };
  if (r.code !== 0 || !isDevMode(r.stdout)) return { ok: false, error: r.stderr || 'Could not open the printer preferences.' };
  return { ok: true, devMode: r.stdout };
}
