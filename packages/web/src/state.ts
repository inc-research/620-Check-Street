// SPDX-License-Identifier: MIT

/**
 * App state, held in memory for the length of a visit and nowhere else.
 *
 * The only network calls this app makes are same-origin reads of its own
 * committed archive (3F D-02). Nothing about the reader is sent anywhere, there
 * is no account, and there is nothing to upload — everything being read was
 * published in this repository before the page loaded.
 */

import { isSnapshot, validateSnapshot, type Snapshot } from './shim.ts';

/** One fund, as the index describes it. Enough to list and route without a fetch. */
export interface IndexFund {
  ticker: string;
  name: string;
  issuer: string;
  category: 'options_integrated' | 'managed_futures';
  defined_outcome_caveat: boolean;
  named_benchmark: string | null;
  benchmark_source: string;
  benchmark_note?: string;
  months: string[];
  latest: string | null;
  benchmarks: string[];
  coverage: Snapshot['coverage'] | null;
}

export interface ArchiveIndex {
  app: 'Third Floor';
  schema_version: string;
  anchors: string[];
  universal_anchor: string;
  funds: IndexFund[];
  totals: { tracked: number; with_snapshots: number; snapshots: number };
}

export interface State {
  index: ArchiveIndex | null;
  /** Snapshots already fetched this visit, keyed `TICKER/YYYY-MM`. */
  readonly loaded: Map<string, Snapshot>;
  ticker: string | null;
  month: string | null;
  benchmark: string | null;
}

export const state: State = {
  index: null,
  loaded: new Map(),
  ticker: null,
  month: null,
  benchmark: null,
};

export function snapshotKey(ticker: string, month: string): string {
  return `${ticker}/${month}`;
}

/**
 * Read the archive index.
 *
 * A static site cannot list a directory, so this is what the page reads first
 * and everything else follows from.
 */
export async function loadIndex(): Promise<ArchiveIndex> {
  if (state.index) return state.index;

  const response = await fetch('./data/index.json');
  if (!response.ok) {
    throw new Error('The list of funds could not be read. The site may still be publishing.');
  }
  const parsed = (await response.json()) as ArchiveIndex;
  if (!parsed || !Array.isArray(parsed.funds)) {
    throw new Error('The list of funds could not be read.');
  }
  state.index = parsed;
  return parsed;
}

export function findFund(ticker: string): IndexFund | null {
  return state.index?.funds.find((f) => f.ticker === ticker.toUpperCase()) ?? null;
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
