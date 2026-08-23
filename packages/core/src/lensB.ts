// SPDX-License-Identifier: MIT
//
// Lens B: one reading, read across two real reports.
//
// Distinct from Lens A, and the distinction is the point. Lens A varies the
// window length at a single date. Lens B holds the window length fixed and
// varies the date — it sets today's report beside an actual past instance of
// the same report, pulled from the archive, not a different window of today's.
//
// The column is matched to the lookback (3F-O-03, settled), so the two windows
// are exactly adjacent and share no days: the six months to July against the six
// months before that. Comparing the 12-month column across a six-month gap would
// have re-measured half the same days and called the result a change.
//
// Pure. No I/O; the caller fetches both documents.

import { BLOCKERS } from './diagnostics.ts';
import type { Blocker, BenchmarkBlock, HorizonName, Snapshot, StateName } from './schema/types.ts';
import { STATES } from './schema/types.ts';

/** How far back the comparison reaches, and which column it therefore reads. */
export type Lookback = '6mo' | '13wk';

/**
 * Calendar months to step back for each lookback. Thirteen weeks is three
 * months: reports are monthly, so the nearest one to thirteen weeks ago is the
 * one three months back, and the comparison names the actual months rather than
 * claiming a precision the archive does not have.
 */
export const LOOKBACK_MONTHS: Record<Lookback, number> = { '6mo': 6, '13wk': 3 };

/** The column read on both sides. Matched to the lookback so the windows are disjoint. */
export const LOOKBACK_COLUMN: Record<Lookback, HorizonName> = { '6mo': '6mo', '13wk': '13wk' };

export interface LensBRow {
  state: StateName;
  group: 'participation' | 'resilience';
  /** The reading in the earlier period, or null where it could not be worked out. */
  then: number | null;
  /** The reading in the current period. */
  now: number | null;
  /**
   * Signed: how much the reading moved. Positive means the fund now moves more
   * for the same market move than it did. Null where either side is missing —
   * never a zero, which would say the reading held steady (INV-2).
   */
  change: number | null;
  /** At least the threshold's worth of movement, in either direction. */
  changed: boolean;
  thenThin: boolean;
  nowThin: boolean;
  blockers: readonly Blocker[];
}

export interface LensBTable {
  ticker: string;
  benchmark: string;
  lookback: Lookback;
  /** The column read on both sides. */
  column: HorizonName;
  nowMonth: string;
  thenMonth: string;
  nowWindow: { start: string | null; end: string | null };
  thenWindow: { start: string | null; end: string | null };
  rows: LensBRow[];
  threshold: number | null;
  /**
   * Reasons the whole comparison could not be made. Non-empty means `rows`
   * carries nothing worth showing, and the report says why instead.
   */
  refusals: readonly Blocker[];
}

const GROUP: Record<StateName, 'participation' | 'resilience'> = {
  fund_up_bench_up: 'participation',
  fund_down_bench_down: 'participation',
  fund_up_bench_down: 'resilience',
  fund_down_bench_up: 'resilience',
};

/** Step back `n` calendar months from a `YYYY-MM` key. */
export function monthsBack(month: string, n: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  const total = year * 12 + (index - 1) - n;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** The archived month a lookback points at. */
export function archivedMonthFor(month: string, lookback: Lookback): string {
  return monthsBack(month, LOOKBACK_MONTHS[lookback]);
}

/** The major component. Below 1.0 the family checks on MINOR (SF-14); this document is past it. */
function major(version: string): string {
  return version.split('.')[0] ?? version;
}

function columnOf(block: BenchmarkBlock, column: HorizonName) {
  return block.horizons.find((h) => h.horizon === column);
}

/**
 * Set two real reports side by side.
 *
 * Refuses rather than approximates. Two reports of different schema versions
 * were worked out differently, and putting their numbers together would compare
 * two methods while claiming to compare two periods.
 */
export function buildLensB(
  current: Snapshot,
  previous: Snapshot,
  benchmark: string,
  lookback: Lookback,
): LensBTable {
  const column = LOOKBACK_COLUMN[lookback];
  const nowMonth = current.as_of.slice(0, 7);
  const thenMonth = previous.as_of.slice(0, 7);
  const threshold = current.methodology.shift_threshold;

  const refusals: Blocker[] = [];

  if (major(current.schema_version) !== major(previous.schema_version)) {
    refusals.push(
      BLOCKERS.reportVersionMismatch(previous.schema_version, current.schema_version),
    );
  }

  const nowBlock = current.benchmarks[benchmark];
  const thenBlock = previous.benchmarks[benchmark];

  if (!nowBlock) {
    refusals.push(BLOCKERS.benchmarkNotInBothReports(current.ticker, benchmark, nowMonth));
  }
  if (!thenBlock) {
    refusals.push(BLOCKERS.benchmarkNotInBothReports(previous.ticker, benchmark, thenMonth));
  }

  const nowColumn = nowBlock ? columnOf(nowBlock, column) : undefined;
  const thenColumn = thenBlock ? columnOf(thenBlock, column) : undefined;

  // A column blocked on either side takes the whole comparison with it: there
  // is no half of this worth showing, and four dashes in a row explain nothing.
  if (thenColumn && thenColumn.states === null) {
    const why = thenColumn.blockers[0]?.message ?? '';
    refusals.push(BLOCKERS.periodNotComparable(thenMonth, why));
  }
  if (nowColumn && nowColumn.states === null) {
    const why = nowColumn.blockers[0]?.message ?? '';
    refusals.push(BLOCKERS.periodNotComparable(nowMonth, why));
  }

  const rows: LensBRow[] = STATES.map((state) => {
    const nowCell = nowColumn?.states?.[state] ?? null;
    const thenCell = thenColumn?.states?.[state] ?? null;

    const now = nowCell?.raw_semibeta ?? null;
    const then = thenCell?.raw_semibeta ?? null;
    const change = now !== null && then !== null ? now - then : null;

    const blockers: Blocker[] = [];
    if (thenCell && thenCell.raw_semibeta === null) blockers.push(...thenCell.blockers);
    if (nowCell && nowCell.raw_semibeta === null) blockers.push(...nowCell.blockers);

    return {
      state,
      group: GROUP[state],
      then,
      now,
      change,
      changed: threshold !== null && change !== null && Math.abs(change) >= threshold,
      thenThin: thenCell?.data_sufficiency === 'thin',
      nowThin: nowCell?.data_sufficiency === 'thin',
      blockers,
    };
  });

  return {
    ticker: current.ticker,
    benchmark,
    lookback,
    column,
    nowMonth,
    thenMonth,
    nowWindow: { start: nowColumn?.window_start ?? null, end: nowColumn?.window_end ?? null },
    thenWindow: { start: thenColumn?.window_start ?? null, end: thenColumn?.window_end ?? null },
    rows,
    threshold,
    refusals,
  };
}

/** Whether an archive holding these months can answer this lookback at all. */
export function canCompare(months: readonly string[], month: string, lookback: Lookback): boolean {
  return months.includes(archivedMonthFor(month, lookback));
}

export { STATES };
