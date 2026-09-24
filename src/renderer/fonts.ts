// Reamlet — the font text is written into saved PDFs with.
//
// Liberation Sans is metric-compatible with Helvetica and Arial, so text keeps
// the widths the on-screen overlay measured, and it covers Latin, Greek,
// Cyrillic and the common math and arrow symbols that the PDF standard fonts
// cannot encode. The files are bundled under assets/fonts/ (SIL OFL 1.1).
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** Raw TrueType bytes of the regular and bold faces. */
export interface FontFiles {
  regular: Uint8Array;
  bold: Uint8Array;
}

/** File names of the bundled faces, relative to assets/fonts/. */
export const FONT_FILE_NAMES = {
  regular: 'LiberationSans-Regular.ttf',
  bold:    'LiberationSans-Bold.ttf',
} as const;

const FONT_DIR = new URL('../../assets/fonts/', import.meta.url);

let _loading: Promise<FontFiles> | null = null;

/** Fetch the bundled font files. The first call loads them; later calls share the result. */
export function loadFontFiles(): Promise<FontFiles> {
  _loading ??= (async () => {
    const [regular, bold] = await Promise.all([
      _fetchBytes(FONT_FILE_NAMES.regular),
      _fetchBytes(FONT_FILE_NAMES.bold),
    ]);
    return { regular, bold };
  })().catch((err: unknown) => {
    _loading = null; // let the next save try again
    throw err;
  });
  return _loading;
}

async function _fetchBytes(name: string): Promise<Uint8Array> {
  const res = await fetch(new URL(name, FONT_DIR));
  if (!res.ok) throw new Error(`Could not load font ${name} (${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}
