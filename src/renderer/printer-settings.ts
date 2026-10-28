// Reamlet — Settings dialog: which printer to use for which page size
//
// Each rule says "documents whose pages are this size print on that printer"; the
// print window picks the printer of the rule a document's first page matches
// (see printer-rules.ts in the main process for how sizes are matched).
//
// SPDX-License-Identifier: GPL-3.0-or-later

import {
  describeSize, normalizeSize, sameSize, sizeFromInput, sizeOfPage,
  type PageSizeMm, type Unit,
} from './page-size.js';

interface PrinterInfo { name: string; isDefault: boolean }

/** The size, in PDF points, of the page the user is looking at — null when no document is open. */
export type CurrentPageSize = () => Promise<{ widthPt: number; heightPt: number } | null>;

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/**
 * Wire the dialog in index.html up. Returns the function that opens it, which
 * resolves once the dialog is showing.
 */
export function initPrinterSettings(currentPageSize: CurrentPageSize): () => Promise<void> {
  const modal          = byId('settings-modal');
  const list           = byId('printer-rules-list');
  const currentSize    = byId('rule-current-size');
  const currentPrinter = byId<HTMLSelectElement>('rule-current-printer');
  const currentAdd     = byId<HTMLButtonElement>('rule-current-add');
  const widthInput     = byId<HTMLInputElement>('rule-width');
  const heightInput    = byId<HTMLInputElement>('rule-height');
  const unitSelect     = byId<HTMLSelectElement>('rule-unit');
  const customPrinter  = byId<HTMLSelectElement>('rule-custom-printer');
  const customAdd      = byId<HTMLButtonElement>('rule-custom-add');
  const errorText      = byId('rule-error');
  const saveButton     = byId<HTMLButtonElement>('settings-save');

  /** The rules being edited: only saved when the dialog is. */
  let rules: PrinterRuleData[] = [];
  let printers: PrinterInfo[] = [];
  let pageSize: PageSizeMm | null = null;

  /** Fill a printer menu, with `selected` chosen — shown even when it is no longer installed. */
  function fillPrinters(select: HTMLSelectElement, selected: string | null) {
    select.innerHTML = '';
    const add = (name: string, label = name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = label;
      select.appendChild(option);
    };
    if (selected && !printers.some(p => p.name === selected)) add(selected, `${selected} (not installed)`);
    printers.forEach(p => add(p.name));
    select.disabled = printers.length === 0 && !selected;
    if (printers.length === 0 && !selected) add('', 'No printers found');
    select.value = selected ?? printers.find(p => p.isDefault)?.name ?? printers[0]?.name ?? '';
  }

  /** Add a rule, replacing the one already set for that size. */
  function setRule(size: PageSizeMm, printer: string) {
    const rule = { ...normalizeSize(size.widthMm, size.heightMm), printer };
    const existing = rules.findIndex(r => sameSize(r, rule));
    if (existing >= 0) rules[existing] = rule;
    else rules.push(rule);
    renderRules();
  }

  function renderRules() {
    list.innerHTML = '';
    if (rules.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'rule-empty';
      empty.textContent = 'No rules yet. Documents print on whichever printer is selected in the print window.';
      list.appendChild(empty);
      return;
    }
    rules.forEach((rule, index) => {
      const row = document.createElement('div');
      row.className = 'rule-row';

      const size = document.createElement('span');
      size.className = 'rule-size';
      size.textContent = describeSize(rule);

      const printer = document.createElement('select');
      printer.setAttribute('aria-label', `Printer for ${describeSize(rule)}`);
      fillPrinters(printer, rule.printer);
      printer.addEventListener('change', () => { rules[index].printer = printer.value; });

      const remove = document.createElement('button');
      remove.className = 'rule-remove';
      remove.textContent = '×';
      remove.title = 'Remove this rule';
      remove.setAttribute('aria-label', `Remove the rule for ${describeSize(rule)}`);
      remove.addEventListener('click', () => { rules.splice(index, 1); renderRules(); });

      row.append(size, printer, remove);
      list.appendChild(row);
    });
  }

  function close() {
    modal.classList.add('hidden');
  }

  currentAdd.addEventListener('click', () => {
    if (pageSize && currentPrinter.value) setRule(pageSize, currentPrinter.value);
  });

  function addCustom() {
    const size = sizeFromInput(widthInput.value, heightInput.value, unitSelect.value as Unit);
    if ('error' in size) { errorText.textContent = size.error; return; }
    if (!customPrinter.value) { errorText.textContent = 'Choose a printer.'; return; }
    errorText.textContent = '';
    setRule(size, customPrinter.value);
    widthInput.value = heightInput.value = '';
    widthInput.focus();
  }
  customAdd.addEventListener('click', addCustom);
  [widthInput, heightInput].forEach(input => {
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } });
    input.addEventListener('input', () => { errorText.textContent = ''; });
  });

  byId('settings-cancel').addEventListener('click', close);
  modal.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  saveButton.addEventListener('click', async () => {
    saveButton.disabled = true;
    try {
      await window.api.setPrinterRules(rules);
      close();
    } catch (err) {
      errorText.textContent = `Could not save: ${(err as Error).message}`;
    } finally {
      saveButton.disabled = false;
    }
  });

  return async function open() {
    errorText.textContent = '';
    [rules, printers] = await Promise.all([
      window.api.getPrinterRules(),
      window.api.getPrinters().catch(() => [] as PrinterInfo[]),
    ]);

    const page = await currentPageSize().catch(() => null);
    pageSize = page ? sizeOfPage(page.widthPt, page.heightPt) : null;
    currentSize.textContent = pageSize ? describeSize(pageSize) : 'Open a document to use its page size.';
    currentAdd.disabled = pageSize === null || printers.length === 0;

    fillPrinters(currentPrinter, null);
    fillPrinters(customPrinter, null);
    customAdd.disabled = printers.length === 0;
    widthInput.value = heightInput.value = '';
    renderRules();

    modal.classList.remove('hidden');
    (pageSize ? currentPrinter : widthInput).focus();
  };
}
