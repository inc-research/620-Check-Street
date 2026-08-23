// SPDX-License-Identifier: MIT

/**
 * App state, held in memory for the length of a visit and nowhere else.
 *
 * The one network call this app makes is a same-origin read of its own
 * committed archive (3F D-02). Nothing about the reader is sent anywhere, there
 * is no account, and there is nothing to upload — the data being read was
 * published in this repository before the page loaded.
 */

import { isSnapshot, validateSnapshot, type Snapshot } from './shim.ts';

export interface State {
  /** Snapshots already fetched this visit, keyed `TICKER/YYYY-MM`. */
  readonly loaded: Map<string, Snapshot>;
  ticker: string | null;
  month: string | null;
  benchmark: string | null;
}

export const state: State = {
  loaded: new Map(),
  ticker: null,
  month: null,
  benchmark: null,
};

export function snapshotKey(ticker: string, month: string): string {
  return `${ticker}/${month}`;
}

/**
 * Read one snapshot from the archive.
 *
 * The path is relative throughout, so the page works opened from a `file://`
 * path and served from a project-page subpath without a rebuild (SF-19). A
 * document that does not validate is refused rather than rendered: half a
 * report is harder to read than none, and this reader has no way to tell which
 * half was wrong.
 */
export async function loadSnapshot(ticker: string, month: string): Promise<Snapshot> {
  const key = snapshotKey(ticker, month);
  const already = state.loaded.get(key);
  if (already) return already;

  const response = await fetch(`./data/${ticker}/${month}.json`);
  if (!response.ok) {
    throw new Error(`No report was published for ${ticker} covering ${month}.`);
  }

  const parsed: unknown = await response.json();
  if (!isSnapshot(parsed)) {
    const problems = validateSnapshot(parsed)
      .map((p) => `${p.path}: ${p.message}`)
      .join('; ');
    throw new Error(`The report for ${ticker} ${month} could not be read — ${problems}`);
  }

  state.loaded.set(key, parsed);
  return parsed;
}
