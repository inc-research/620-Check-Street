// SPDX-License-Identifier: MIT

/**
 * App state, held in memory for the length of a visit and nowhere else.
 *
 * The only network calls this app makes are same-origin reads of its own
 * committed archive (3F D-02). Nothing about the reader is sent anywhere, there
 * is no account, and there is nothing to upload — everything being read was
 * published in this repository before the page loaded.
 */

import {
  DEFAULT_TREND_COLUMN,
  isFeeDocument,
  isRateSeries,
  isReport,
  isSnapshot,
  validateReport,
  validateSnapshot,
  type FeeDocument,
  type HorizonName,
  type RateSeries,
  type ReportDocument,
  type Snapshot,
} from './shim.ts';

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
  /** Report files already fetched this visit, keyed the same way. */
  readonly reports: Map<string, ReportDocument>;
  ticker: string | null;
  month: string | null;
  benchmark: string | null;
  /** The window the capture-over-time section reads, kept across a change of month. */
  trendColumn: HorizonName;
  /** Fee files already fetched this visit, keyed `TICKER/YYYY-MM`. Null where none was published. */
  readonly fees: Map<string, FeeDocument | null>;
  /** The two rate series, read once a visit. */
  rates: { cpi: RateSeries; bills: RateSeries } | null;
  /**
   * Whether the adviser's fee is taken off (3F D-23). On by default: most people
   * reach these funds through an adviser. Kept across a change of fund or month.
   */
  adviser: boolean;
}

export const state: State = {
  index: null,
  loaded: new Map(),
  reports: new Map(),
  ticker: null,
  month: null,
  benchmark: null,
  trendColumn: DEFAULT_TREND_COLUMN,
  fees: new Map(),
  rates: null,
  adviser: true,
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

/**
 * Read one report file: what the page leads with (3F D-17).
 *
 * The same rules as a snapshot. A relative path, and a document that does not
 * validate is refused rather than rendered.
 */
export async function loadReport(ticker: string, month: string): Promise<ReportDocument> {
  const key = snapshotKey(ticker, month);
  const already = state.reports.get(key);
  if (already) return already;

  const response = await fetch(`./data/_reports/${ticker}/${month}.json`);
  if (!response.ok) {
    throw new Error(`No report was published for ${ticker} covering ${month}.`);
  }

  const parsed: unknown = await response.json();
  if (!isReport(parsed)) {
    const problems = validateReport(parsed)
      .map((p) => `${p.path}: ${p.message}`)
      .join('; ');
    throw new Error(`The report for ${ticker} ${month} could not be read — ${problems}`);
  }

  state.reports.set(key, parsed);
  return parsed;
}

/**
 * Read one month's fee file (3F D-22). A missing or unreadable one is null, not
 * an error: the returns are already after the fund's costs, so the page loses a
 * line of disclosure and nothing else.
 */
export async function loadFees(ticker: string, month: string): Promise<FeeDocument | null> {
  const key = snapshotKey(ticker, month);
  if (state.fees.has(key)) return state.fees.get(key) ?? null;
  let parsed: unknown = null;
  try {
    const response = await fetch(`./data/_fees/${ticker}/${month}.json`);
    if (response.ok) parsed = await response.json();
  } catch {
    parsed = null;
  }
  const doc = isFeeDocument(parsed) ? parsed : null;
  state.fees.set(key, doc);
  return doc;
}

/** Consumer prices and bill rates (3F D-23), read once a visit. Throws if either is unusable. */
export async function loadRates(): Promise<{ cpi: RateSeries; bills: RateSeries }> {
  if (state.rates) return state.rates;
  const [cpi, bills] = await Promise.all(
    ['CPIAUCNS', 'DGS3MO'].map(async (id) => {
      const response = await fetch(`./data/_rates/${id}.json`);
      if (!response.ok) throw new Error('The consumer price and bill-rate figures could not be read.');
      const parsed: unknown = await response.json();
      if (!isRateSeries(parsed)) throw new Error('The consumer price and bill-rate figures could not be read.');
      return parsed;
    }),
  );
  state.rates = { cpi: cpi!, bills: bills! };
  return state.rates;
}
