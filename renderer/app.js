// PDFox — renderer entry point
// Manages tabs, keyboard shortcuts, and wires together viewer + annotator + saver.
// SPDX-License-Identifier: GPL-3.0-or-later

import { PDFViewer }  from './viewer.js';
import { Annotator }  from './annotator.js';
import { embedAnnotations } from './saver.js';

// ── State ──────────────────────────────────────────────────────

const tabs      = [];  // array of TabState
let   activeTab = null;

// ── DOM refs ───────────────────────────────────────────────────

const tabBar       = document.getElementById('tab-bar');
const viewerHost   = document.getElementById('viewer-host');
const emptyState   = document.getElementById('empty-state');
const colorPicker  = document.getElementById('color-picker');
const thicknessInput = document.getElementById('thickness');
const tocPanel     = document.getElementById('toc-panel');
const tocToggle    = document.getElementById('toc-toggle');
const tocTree      = document.getElementById('toc-tree');

// ── Tab management ─────────────────────────────────────────────

function createTab(filePath, pdfData) {
  const id = Date.now();

  const pane   = document.createElement('div');
  pane.className = 'viewer-pane';
  const pages  = document.createElement('div');
  pages.className = 'pdf-pages';
  pane.appendChild(pages);
  viewerHost.appendChild(pane);

  const viewer = new PDFViewer(pages);
  // Store an independent copy — viewer.load() makes its own copy for PDF.js
  const pdfBytes = pdfData instanceof Uint8Array ? pdfData.slice() : new Uint8Array(pdfData);

  const state = {
    id,
    filePath,
    pdfBytes,
    viewer,
    annotator: null,
    outline:   null, // cached PDF outline (or null)
    pane,
    dirty: false,
    tabEl: null,
  };
  tabs.push(state);
  return state;
}

function renderTabBar() {
  tabBar.innerHTML = '';
  tabs.forEach(t => {
    const el = document.createElement('div');
    el.className = 'tab' + (t === activeTab ? ' active' : '');
    el.dataset.id = t.id;

    const name = document.createElement('span');
    name.className = 'tab-name';
    const basename = t.filePath ? t.filePath.split(/[\\/]/).pop() : 'Untitled';
    name.textContent = (t.dirty ? '*' : '') + basename;

    const close = document.createElement('button');
    close.className = 'tab-close';
    close.textContent = '\u00d7';
    close.title = 'Close tab';
    close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(t); });

    el.append(name, close);
    el.addEventListener('click', () => switchTab(t));
    tabBar.appendChild(el);
    t.tabEl = el;
  });
}

function switchTab(tab) {
  if (activeTab) activeTab.pane.classList.remove('active');
  activeTab = tab;
  tab.pane.classList.add('active');
  emptyState.style.display = 'none';
  renderTabBar();
  // Sync toolbar to this tab's annotator settings
  if (tab.annotator) {
    colorPicker.value    = tab.annotator.color;
    thicknessInput.value = tab.annotator.thickness;
    syncToolButtons(tab.annotator.tool);
  }
  // Render this tab's TOC (or hide the panel if none)
  renderToc(tab.outline);
}

function closeTab(tab) {
  const idx = tabs.indexOf(tab);
  if (idx === -1) return;
  tab.pane.remove();
  tabs.splice(idx, 1);
  if (activeTab === tab) {
    activeTab = null;
    const next = tabs[idx] || tabs[idx - 1];
    if (next) switchTab(next);
    else {
      emptyState.style.display = '';
      renderToc(null);
    }
  }
  renderTabBar();
}

function markDirty(tab) {
  tab.dirty = true;
  renderTabBar();
}

// ── Open / Save ────────────────────────────────────────────────

async function openFile() {
  const result = await window.api.openFileDialog();
  if (!result) return;
  const { filePath, buffer } = result;

  const tab = createTab(filePath, buffer);
  await tab.viewer.load(tab.pdfBytes);
  tab.annotator = new Annotator(tab.viewer.pages);
  _patchAnnotatorForDirty(tab);

  // Fetch outline — shown in TOC panel
  tab.outline = await tab.viewer.getOutline();

  switchTab(tab);
  renderTabBar();
}

async function saveTab(tab) {
  if (!tab) return;
  const bytes = await embedAnnotations(tab.pdfBytes, tab.annotator.annotations, tab.viewer);
  const res   = await window.api.saveFile(tab.filePath, bytes.buffer);
  if (res.ok) {
    tab.pdfBytes = bytes;
    tab.dirty    = false;
    renderTabBar();
  } else if (res.error && res.error !== 'cancelled') {
    alert('Save failed: ' + res.error);
  }
}

async function saveTabCopy(tab) {
  if (!tab) return;
  const bytes = await embedAnnotations(tab.pdfBytes, tab.annotator.annotations, tab.viewer);
  const res   = await window.api.saveFileCopy(bytes.buffer);
  if (res.ok) {
    const newTab = createTab(res.filePath, bytes);
    await newTab.viewer.load(newTab.pdfBytes);
    newTab.annotator = new Annotator(newTab.viewer.pages);
    _patchAnnotatorForDirty(newTab);
    newTab.outline = await newTab.viewer.getOutline();
    switchTab(newTab);
    renderTabBar();
  }
}

// Monkey-patch Annotator to mark tab dirty whenever an annotation is added/removed
function _patchAnnotatorForDirty(tab) {
  const orig  = tab.annotator.annotations;
  const proxy = new Proxy(orig, {
    set(target, prop, value) {
      target[prop] = value;
      if (typeof prop === 'string' && !isNaN(prop)) markDirty(tab);
      return true;
    },
  });
  tab.annotator.annotations = proxy;
}

// ── Zoom ───────────────────────────────────────────────────────

async function zoom(delta) {
  if (!activeTab) return;
  const v = activeTab.viewer;
  await v.setZoom(Math.round((v.scale + delta) * 100) / 100);
  activeTab.annotator.pages = v.pages;
  activeTab.annotator.redrawAll();
}

async function fitWidth() {
  if (!activeTab) return;
  const v    = activeTab.viewer;
  const pane = activeTab.pane;
  const vp   = await v.getViewport(1);
  const containerW = pane.clientWidth - 32; // 16px padding each side
  await v.setZoom(containerW / (vp.width / v.scale));
  activeTab.annotator.pages = v.pages;
  activeTab.annotator.redrawAll();
}

// ── Rotate ─────────────────────────────────────────────────────

async function rotate(singlePage) {
  if (!activeTab) return;
  const v = activeTab.viewer;
  if (singlePage) {
    const pageNum = v.getVisiblePageNum();
    await v.rotatePage(pageNum, 90);
  } else {
    await v.rotateAll(90);
  }
  activeTab.annotator.pages = v.pages;
  activeTab.annotator.redrawAll();
}

// ── Table of Contents ──────────────────────────────────────────

// Render the outline tree into the TOC panel for the given tab
function renderToc(outline) {
  tocTree.innerHTML = '';

  if (!outline || outline.length === 0) {
    // Hide the panel entirely for files without bookmarks
    tocPanel.classList.add('hidden');
    return;
  }

  tocPanel.classList.remove('hidden');
  // Auto-expand when bookmarks are present
  tocPanel.classList.remove('collapsed');

  _buildTocNodes(outline, tocTree);
}

function _buildTocNodes(items, container) {
  for (const item of items) {
    const node = document.createElement('div');

    const label = document.createElement('div');
    label.className  = 'toc-item';
    label.title      = item.title || '';
    const span = document.createElement('span');
    span.className   = 'toc-item-label';
    span.textContent = item.title || '(untitled)';
    label.appendChild(span);
    label.addEventListener('click', () => _navigateToOutlineItem(item));
    node.appendChild(label);

    if (item.items && item.items.length > 0) {
      const children = document.createElement('div');
      children.className = 'toc-children';
      _buildTocNodes(item.items, children);
      node.appendChild(children);
    }

    container.appendChild(node);
  }
}

async function _navigateToOutlineItem(item) {
  if (!activeTab) return;
  const dest    = item.dest || item.url;
  const pageNum = await activeTab.viewer.resolveOutlineDest(dest);
  if (pageNum) activeTab.viewer.scrollToPage(pageNum);
}

// ── TOC toggle ─────────────────────────────────────────────────

tocToggle.addEventListener('click', () => {
  tocPanel.classList.toggle('collapsed');
});

// ── Toolbar ────────────────────────────────────────────────────

function syncToolButtons(tool) {
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
}

document.querySelectorAll('.tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.tool;
    if (activeTab?.annotator) activeTab.annotator.setTool(tool);
    syncToolButtons(tool);
  });
});

document.getElementById('btn-open').addEventListener('click', openFile);
document.getElementById('btn-undo').addEventListener('click', () => activeTab?.annotator?.undo());
document.getElementById('btn-redo').addEventListener('click', () => activeTab?.annotator?.redo());
document.getElementById('btn-fit').addEventListener('click', fitWidth);
document.getElementById('btn-rotate').addEventListener('click', (e) => rotate(e.shiftKey));
document.getElementById('btn-print').addEventListener('click', () => window.print());

colorPicker.addEventListener('input', () => {
  if (activeTab?.annotator) activeTab.annotator.setColor(colorPicker.value);
});

thicknessInput.addEventListener('input', () => {
  if (activeTab?.annotator) activeTab.annotator.setThickness(Number(thicknessInput.value));
});

// ── Keyboard shortcuts ─────────────────────────────────────────

document.addEventListener('keydown', async (e) => {
  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && e.key === 'o') { e.preventDefault(); openFile(); return; }
  if (ctrl && e.shiftKey && e.key === 'S') { e.preventDefault(); saveTabCopy(activeTab); return; }
  if (ctrl && e.key === 's') { e.preventDefault(); saveTab(activeTab); return; }
  if (ctrl && e.key === 'w') { e.preventDefault(); closeTab(activeTab); return; }
  if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoom(0.1); return; }
  if (ctrl && e.key === '-') { e.preventDefault(); zoom(-0.1); return; }
  if (ctrl && e.key === '0') { e.preventDefault(); fitWidth(); return; }
  if (ctrl && e.key === 'z') { e.preventDefault(); activeTab?.annotator?.undo(); return; }
  if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { e.preventDefault(); activeTab?.annotator?.redo(); return; }
  if (ctrl && e.key === 'p') { e.preventDefault(); window.print(); return; }

  // Tool shortcuts (only when not typing in an input)
  if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
  const toolMap = {
    d: 'draw', h: 'highlight', t: 'text', Escape: 'select',
    l: 'line',  r: 'rect', o: 'oval', a: 'arrow', e: 'eraser',
  };
  const tool = toolMap[e.key];
  if (tool) {
    if (activeTab?.annotator) activeTab.annotator.setTool(tool);
    syncToolButtons(tool);
  }
});

// ── Menu events from main process ─────────────────────────────

window.api.onMenuEvent((event) => {
  switch (event) {
    case 'menu-open':       openFile(); break;
    case 'menu-save':       saveTab(activeTab); break;
    case 'menu-save-copy':  saveTabCopy(activeTab); break;
    case 'menu-close-tab':  if (activeTab) closeTab(activeTab); break;
  }
});

// ── Init ───────────────────────────────────────────────────────

emptyState.style.display = '';
