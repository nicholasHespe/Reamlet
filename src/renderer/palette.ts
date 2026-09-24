// Reamlet — the colour swatches offered for annotations.
// SPDX-License-Identifier: GPL-3.0-or-later

export const SWATCHES: readonly { color: string; name: string }[] = [
  // Reds / warm
  { color: '#ff3333', name: 'Red' },
  { color: '#ff6644', name: 'Coral' },
  { color: '#ff8c00', name: 'Orange' },
  { color: '#ffb300', name: 'Amber' },
  { color: '#f5c518', name: 'Yellow' },
  // Greens
  { color: '#aacc00', name: 'Lime' },
  { color: '#33bb55', name: 'Green' },
  { color: '#00cc88', name: 'Teal' },
  { color: '#00bbbb', name: 'Cyan' },
  { color: '#0099cc', name: 'Sky' },
  // Blues / purples
  { color: '#3388ff', name: 'Blue' },
  { color: '#0055cc', name: 'Dark Blue' },
  { color: '#6644cc', name: 'Indigo' },
  { color: '#cc44ff', name: 'Purple' },
  { color: '#ff44aa', name: 'Pink' },
  // Neutrals
  { color: '#884400', name: 'Brown' },
  { color: '#111111', name: 'Black' },
  { color: '#555555', name: 'Dark Gray' },
  { color: '#aaaaaa', name: 'Gray' },
  { color: '#ffffff', name: 'White' },
];

/** Value a swatch panel reports for its "no fill" swatch. */
export const NO_FILL = 'none';

/**
 * Fill `panel` with a button per swatch (plus a leading "no fill" swatch when
 * `withNone` is set). Each button carries its colour in `data-color`.
 */
export function buildSwatchPanel(panel: HTMLElement, { withNone = false } = {}): void {
  panel.replaceChildren();
  if (withNone) {
    const none = document.createElement('button');
    none.className = 'swatch fill-none';
    none.dataset.color = NO_FILL;
    none.title = 'No fill';
    panel.appendChild(none);
  }
  for (const { color, name } of SWATCHES) {
    const btn = document.createElement('button');
    btn.className = 'swatch';
    btn.dataset.color = color;
    btn.style.background = color;
    btn.title = name;
    panel.appendChild(btn);
  }
}

/** Mark the swatch for `color` (or "no fill" for null) as the active one. */
export function markActiveSwatch(panel: HTMLElement, color: string | null): void {
  const value = color ?? NO_FILL;
  panel.querySelectorAll<HTMLElement>('.swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.color === value);
  });
}
