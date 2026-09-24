// Reamlet — toolbar layout: tool groups that fold into dropdowns when the
// window is too narrow to show them all.
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Keeps the tools row within the window. Groups are collapsed one at a time,
 * in the order given, until the row fits; a collapsed group shows only its
 * toggle button, which opens the group's tools as a dropdown. Elements inside
 * a group that are not in its `.group-items` never collapse.
 */
export class ToolbarLayout {
  private readonly row: HTMLElement;
  private readonly groups: HTMLElement[];

  constructor(row: HTMLElement, groupsInCollapseOrder: HTMLElement[]) {
    this.row    = row;
    this.groups = groupsInCollapseOrder;

    for (const group of this.groups) {
      group.querySelector('.group-toggle')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = !group.classList.contains('open');
        this.closeDropdowns();
        group.classList.toggle('open', open);
      });
      // Choosing a tool or an action closes the dropdown; buttons that open a
      // panel of their own (colour pickers, the shapes menu) leave it open.
      group.querySelector('.group-items')?.addEventListener('click', (e) => {
        const btn = (e.target as Element).closest('button');
        if (btn && !btn.matches('.picker-btn, .submenu-btn')) this.closeDropdowns();
      });
    }
    document.addEventListener('mousedown', (e) => {
      if (!(e.target as Element).closest?.('.tool-group.open')) this.closeDropdowns();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeDropdowns();
    });

    new ResizeObserver(() => this.fit()).observe(row);
  }

  /** Collapse just enough groups, in order, for the row to fit. */
  fit(): void {
    for (const group of this.groups) group.classList.remove('collapsed');
    for (const group of this.groups) {
      if (!this.overflowing()) break;
      group.classList.add('collapsed');
    }
    for (const group of this.groups) {
      if (!group.classList.contains('collapsed')) group.classList.remove('open');
    }
  }

  closeDropdowns(): void {
    for (const group of this.groups) group.classList.remove('open');
  }

  private overflowing(): boolean {
    return this.row.scrollWidth > this.row.clientWidth + 1;
  }
}
