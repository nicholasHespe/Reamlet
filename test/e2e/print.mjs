// Reamlet — end-to-end printing. Print jobs built by the app's own composer go
// through the app's own print path to a real printer, and the pages that come
// out must show what was sent: as many pages, on paper of the same shape, dark
// where the job is dark and light where it is light.
//
// It needs a printer that writes PDF files to a folder this can read:
//   REAMLET_TEST_PRINTER        the printer's name
//   REAMLET_TEST_PRINT_OUTPUT   the folder its files land in
//   REAMLET_TEST_PRINT_RESULTS  optional: a folder to keep each job and its printout in
// CI prints to CUPS-PDF on Linux and to Microsoft Print to PDF on Windows; see
// .github/workflows/ci.yml. Locally: set the variables, then `pnpm test:print`.
// SPDX-License-Identifier: GPL-3.0-or-later

import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { printPdf } from '../../out/print-job.js';

const PRINTER = process.env.REAMLET_TEST_PRINTER;
const OUTPUT  = process.env.REAMLET_TEST_PRINT_OUTPUT;
const RESULTS = process.env.REAMLET_TEST_PRINT_RESULTS;

const A4 = [595.28, 841.89];
const MICRONS_PER_POINT = 25400 / 72;
const NUM_PAGES = 4;

const LAYOUTS = [
  { name: 'one page per sheet, portrait',  pps: 1, isBooklet: false, paperW: A4[0],     paperH: A4[1] },
  { name: 'one page per sheet, landscape', pps: 1, isBooklet: false, paperW: A4[1],     paperH: A4[0] },
  { name: '4 pages per sheet, portrait',   pps: 4, isBooklet: false, paperW: A4[0],     paperH: A4[1] },
  { name: '2 pages per sheet, landscape',  pps: 2, isBooklet: false, paperW: A4[1],     paperH: A4[0] },
  { name: 'booklet',                       pps: 1, isBooklet: true,  paperW: A4[1] / 2, paperH: A4[0] },
];

// A grid cell the job fills almost entirely must come out at least half dark;
// one the job leaves white must come out at most half dark. The margins
// allow for a printer that shrinks the page a little to fit its paper.
const SOLID = 0.9, INKED = 0.5;
const WHITE = 0.0, STRAY = 0.5;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function pdfsIn(dir) {
  return fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.pdf'));
}

/** The next file the printer writes, once it has stopped growing; removed from the folder. */
async function nextPrintout(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    await sleep(1000);
    const [name] = pdfsIn(OUTPUT);
    if (!name) continue;
    const file = path.join(OUTPUT, name);
    try {
      const { size } = fs.statSync(file);
      if (last && last.file === file && last.size === size && size > 0) {
        const bytes = fs.readFileSync(file);
        fs.rmSync(file);
        return bytes;
      }
      last = { file, size };
    } catch { /* the printer still has it open */ }
  }
  throw new Error(`the printer wrote nothing to ${OUTPUT} within ${timeoutMs / 1000}s`);
}

/** How the printout differs from the job, as a list of problems; empty when it matches. */
function compare(sent, printed) {
  const problems = [];
  if (printed.length !== sent.length) problems.push(`${printed.length} page(s) printed, ${sent.length} sent`);
  sent.forEach((page, i) => {
    const got = printed[i];
    if (!got) return;
    const label = `page ${i + 1}`;
    const shape = (size) => size[0] / size[1];
    if (Math.abs(shape(got.size) - shape(page.size)) > 0.02) {
      problems.push(`${label}: printed ${got.size.map(Math.round).join(' × ')} pt, sent ${page.size.map(Math.round).join(' × ')} pt`);
    }
    if (got.cells.every(c => c < 0.01)) {
      problems.push(`${label}: blank`);
      return;
    }
    const solid   = page.cells.flatMap((c, j) => c >= SOLID ? [j] : []);
    const missing = solid.filter(j => got.cells[j] < INKED);
    const stray   = page.cells.flatMap((c, j) => c <= WHITE && got.cells[j] > STRAY ? [j] : []);
    if (missing.length) problems.push(`${label}: ${missing.length} of ${solid.length} solid areas did not print`);
    if (stray.length)   problems.push(`${label}: ${stray.length} areas that should be white printed dark`);
  });
  return problems;
}

async function openChecker() {
  const win = new BrowserWindow({ show: false });
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) console.error(`[check page] ${message}`); });
  await win.loadFile(fileURLToPath(new URL('print-check.html', import.meta.url)));
  for (let i = 0; i < 60 && win.webContents.getTitle() !== 'ready'; i++) await sleep(500);
  if (win.webContents.getTitle() !== 'ready') throw new Error('the check page did not load');
  return win;
}

async function run() {
  if (!PRINTER || !OUTPUT) throw new Error('set REAMLET_TEST_PRINTER and REAMLET_TEST_PRINT_OUTPUT');
  fs.mkdirSync(OUTPUT, { recursive: true });
  for (const name of pdfsIn(OUTPUT)) fs.rmSync(path.join(OUTPUT, name));
  if (RESULTS) fs.mkdirSync(RESULTS, { recursive: true });

  const checker = await openChecker();
  const page = (call) => checker.webContents.executeJavaScript(`printCheck.${call}`);

  let failed = 0;
  for (const layout of LAYOUTS) {
    let problems;
    try {
      const job = await page(`job(${JSON.stringify(layout)}, ${NUM_PAGES})`);
      const sentBytes = Buffer.from(job.pdf, 'base64');
      const result = await printPdf(sentBytes, {
        deviceName: PRINTER, copies: 1, color: true, collate: true, duplexMode: 'simplex',
        scaleFactor: 100, landscape: false,
        pageSize: { width: Math.round(job.mediaWpt * MICRONS_PER_POINT), height: Math.round(job.mediaHpt * MICRONS_PER_POINT) },
      });
      if (!result.ok) throw new Error(`the print failed: ${result.error}`);
      const printedBytes = await nextPrintout();
      if (RESULTS) {
        const slug = layout.name.replace(/\W+/g, '-');
        fs.writeFileSync(path.join(RESULTS, `${slug}-sent.pdf`), sentBytes);
        fs.writeFileSync(path.join(RESULTS, `${slug}-printed.pdf`), printedBytes);
      }
      const [sent, printed] = await Promise.all([job.pdf, printedBytes.toString('base64')]
        .map(b64 => page(`coverage(${JSON.stringify(b64)})`)));
      const blankInJob = sent.flatMap((p, i) => p.cells.some(c => c >= SOLID) ? [] : [i + 1]);
      if (blankInJob.length) throw new Error(`the print job is already blank on page(s) ${blankInJob.join(', ')}, before it reaches the printer`);
      problems = compare(sent, printed);
    } catch (err) {
      problems = [err.message];
    }
    console.log(`${problems.length ? 'not ok' : 'ok'} - ${layout.name}`);
    for (const problem of problems) console.log(`  ${problem}`);
    if (problems.length) failed++;
  }
  console.log(`# ${LAYOUTS.length - failed} of ${LAYOUTS.length} layouts printed as sent to ${PRINTER}`);
  return failed;
}

app.on('window-all-closed', () => { /* keep running between print jobs */ });
setTimeout(() => { console.error('timed out'); app.exit(1); }, 10 * 60_000).unref();

app.whenReady()
  .then(run)
  .then(failed => app.exit(failed ? 1 : 0))
  .catch(err => { console.error(err); app.exit(1); });
