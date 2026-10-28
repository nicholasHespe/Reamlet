// Reamlet — keeping a flood of "open this web address" requests from swamping the app.
//
// The browser extension hands Reamlet a PDF's web address by launching it, and
// each launch is forwarded to the running app as one request. A person makes a
// handful of those in a few seconds; hundreds in a row mean something is
// replaying old links, and each one would download a file, open a tab and show
// a dialog (#108).
//
// Main-process logic with no Electron dependency: main.ts wires it to dialogs
// and the single-instance handler, and the tests exercise it directly.
//
// SPDX-License-Identifier: GPL-3.0-or-later

/** Requests let through in any `WEB_OPEN_WINDOW_MS` before the rest are skipped. */
export const WEB_OPEN_LIMIT = 20;
export const WEB_OPEN_WINDOW_MS = 30_000;
/** How long requests must stop for a flood to count as over. */
export const WEB_OPEN_QUIET_MS = 30_000;

/**
 * Decides which web-address requests get through. The first `limit` in a
 * `windowMs` do; once one is skipped, everything is skipped until requests
 * have stopped for `quietMs`, so a long drip of old links stays shut out
 * rather than sneaking `limit` more through every window.
 */
export class WebOpenGate {
  private admitted: number[] = [];
  private skipped = 0;
  private lastSkipped = 0;

  constructor(
    private readonly limit = WEB_OPEN_LIMIT,
    private readonly windowMs = WEB_OPEN_WINDOW_MS,
    private readonly quietMs = WEB_OPEN_QUIET_MS,
  ) {}

  /** Whether a request arriving at `now` should be opened. */
  admit(now = Date.now()): boolean {
    if (this.flooding(now)) return this.skip(now);
    this.admitted = this.admitted.filter(t => now - t < this.windowMs);
    if (this.admitted.length >= this.limit) return this.skip(now);
    this.admitted.push(now);
    return true;
  }

  /**
   * How many requests were skipped, once the flood that skipped them has gone
   * quiet; the count starts again from zero. 0 while requests are still
   * arriving, or when none were skipped.
   */
  takeSkipped(now = Date.now()): number {
    if (this.flooding(now)) return 0;
    const count = this.skipped;
    this.skipped = 0;
    return count;
  }

  private flooding(now: number): boolean {
    return this.skipped > 0 && now - this.lastSkipped < this.quietMs;
  }

  private skip(now: number): false {
    this.skipped++;
    this.lastSkipped = now;
    return false;
  }
}

/** Longest list of distinct reasons a failure report spells out. */
const MAX_REASONS_SHOWN = 5;

/**
 * The wording of one dialog for web addresses that could not be opened: the
 * reason itself for a single failure, else each distinct reason once with how
 * often it happened, most frequent first.
 */
export function describeFailures(reasons: string[]): { title: string; message: string } {
  if (reasons.length === 1) return { title: 'Reamlet — Could not open URL', message: reasons[0] };

  const counts = new Map<string, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);

  const lines = ranked.slice(0, MAX_REASONS_SHOWN).map(([reason, n]) => `${reason} (×${n})`);
  if (ranked.length > MAX_REASONS_SHOWN) lines.push(`…and ${ranked.length - MAX_REASONS_SHOWN} other reasons`);
  return { title: `Reamlet — Could not open ${reasons.length} URLs`, message: lines.join('\n') };
}
