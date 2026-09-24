// Reamlet — the formatting bar that sits above a text box while it is edited:
// font size, bold, underline, text and fill colour, and delete. Whatever is
// set here is also kept for the next new text box (see Annotator.textStyle).
// SPDX-License-Identifier: GPL-3.0-or-later

import type { TextEditSession, TextStyle } from './annotator.js';
import { buildSwatchPanel, markActiveSwatch, NO_FILL } from './palette.js';

/** Font sizes the − / + buttons step through, in points. */
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72, 96];

/** Gap between the bar and the text box, in CSS pixels. */
const GAP = 6;

const TRASH_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>`;

/** The next size in FONT_SIZES after `size` in direction `dir`, or `size` at either end. */
export function stepFontSize(size: number, dir: 1 | -1): number {
  const next = dir > 0
    ? FONT_SIZES.find(s => s > size)
    : [...FONT_SIZES].reverse().find(s => s < size);
  return next ?? size;
}

export class TextBar {
  readonly el: HTMLDivElement;
  private session: TextEditSession | null = null;
  private readonly sizeLabel: HTMLSpanElement;
  private readonly boldBtn: HTMLButtonElement;
  private readonly underlineBtn: HTMLButtonElement;
  private readonly colorDot: HTMLSpanElement;
  private readonly fillDot: HTMLSpanElement;
  private readonly colorPanel: HTMLDivElement;
  private readonly fillPanel: HTMLDivElement;
  private readonly resizeObserver = new ResizeObserver(() => this.place());

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'text-bar';
    this.el.innerHTML = `
      <button data-act="smaller" title="Smaller text">&minus;</button>
      <span class="text-bar-size" title="Font size (pt)"></span>
      <button data-act="larger" title="Larger text">+</button>
      <span class="text-bar-sep"></span>
      <button data-act="bold" class="text-bar-bold" title="Bold">B</button>
      <button data-act="underline" class="text-bar-underline" title="Underline">U</button>
      <span class="text-bar-sep"></span>
      <div class="picker-wrap">
        <button data-act="color" class="picker-btn" title="Text colour"><span class="picker-dot"></span></button>
        <div class="swatch-panel hidden" data-panel="color"></div>
      </div>
      <div class="picker-wrap">
        <button data-act="fill" class="picker-btn" title="Fill colour"><span class="picker-dot"></span></button>
        <div class="swatch-panel hidden" data-panel="fill"></div>
      </div>
      <span class="text-bar-sep"></span>
      <button data-act="delete" class="text-bar-delete" title="Delete text box">${TRASH_ICON}</button>
    `;
    const q = <T extends Element>(sel: string) => this.el.querySelector(sel) as T;
    this.sizeLabel    = q('.text-bar-size');
    this.boldBtn      = q('[data-act="bold"]');
    this.underlineBtn = q('[data-act="underline"]');
    this.colorDot     = q('[data-act="color"] .picker-dot');
    this.fillDot      = q('[data-act="fill"] .picker-dot');
    this.colorPanel   = q('[data-panel="color"]');
    this.fillPanel    = q('[data-panel="fill"]');
    buildSwatchPanel(this.colorPanel);
    buildSwatchPanel(this.fillPanel, { withNone: true });

    // Clicking the bar must not take focus from the text box: its blur is what
    // commits the text.
    this.el.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.addEventListener('click', (e) => this.onClick(e));
  }

  /** Attach the bar to the text box of `session`. */
  show(session: TextEditSession): void {
    this.session = session;
    session.textarea.parentElement?.appendChild(this.el);
    this.resizeObserver.observe(session.textarea);
    this.closePanels();
    this.sync();
    this.place();
  }

  hide(): void {
    if (this.session) this.resizeObserver.unobserve(this.session.textarea);
    this.session = null;
    this.closePanels();
    this.el.remove();
  }

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const swatch = target.closest<HTMLElement>('.swatch');
    if (swatch) {
      const color = swatch.dataset.color!;
      if (swatch.closest('[data-panel="fill"]')) this.update({ fillColor: color === NO_FILL ? null : color });
      else                                        this.update({ color });
      this.closePanels();
      return;
    }
    const style = this.session?.style;
    if (!style) return;
    switch (target.closest<HTMLElement>('[data-act]')?.dataset.act) {
      case 'smaller':   this.update({ fontSize: stepFontSize(style.fontSize, -1) }); break;
      case 'larger':    this.update({ fontSize: stepFontSize(style.fontSize, 1) });  break;
      case 'bold':      this.update({ bold: !style.bold });           break;
      case 'underline': this.update({ underline: !style.underline }); break;
      case 'color':     this.togglePanel(this.colorPanel); break;
      case 'fill':      this.togglePanel(this.fillPanel);  break;
      case 'delete':    this.session?.remove(); break;
    }
  }

  private update(changes: Partial<TextStyle>): void {
    this.session?.setStyle(changes);
    this.sync();
    this.place();
  }

  private togglePanel(panel: HTMLElement): void {
    const open = panel.classList.contains('hidden');
    this.closePanels();
    panel.classList.toggle('hidden', !open);
  }

  private closePanels(): void {
    this.colorPanel.classList.add('hidden');
    this.fillPanel.classList.add('hidden');
  }

  /** Show the session's current style on the controls. */
  private sync(): void {
    const style = this.session?.style;
    if (!style) return;
    this.sizeLabel.textContent = String(style.fontSize);
    this.boldBtn.classList.toggle('active', style.bold);
    this.underlineBtn.classList.toggle('active', style.underline);
    this.colorDot.style.background = style.color;
    this.fillDot.style.background  = style.fillColor ?? '';
    this.fillDot.classList.toggle('fill-none', style.fillColor === null);
    markActiveSwatch(this.colorPanel, style.color);
    markActiveSwatch(this.fillPanel, style.fillColor);
  }

  /** Sit just above the text box, or below it when there is no room above. */
  private place(): void {
    const ta = this.session?.textarea;
    const wrapper = ta?.parentElement;
    if (!ta || !wrapper) return;
    const above = ta.offsetTop - this.el.offsetHeight - GAP;
    const top   = above >= 0 ? above : ta.offsetTop + ta.offsetHeight + GAP;
    const left  = Math.max(0, Math.min(ta.offsetLeft, wrapper.clientWidth - this.el.offsetWidth));
    this.el.style.top  = `${top}px`;
    this.el.style.left = `${left}px`;
  }
}
