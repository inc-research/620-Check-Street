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
// No amber dot here. Across two adjacent six-month windows, changes of 0.30 turned
// up about as often with the days shuffled as without them (3.3% against 3.5%), so
// a dot would mark noise as a change (3F D-17). The sign and the size are shown.
//
// Pure. No I/O; the caller fetches both documents.

import { BLOCKERS } from './diagnostics.ts';
import {
  MEASURE_GROUP,
  MEASURE_KIND,
  PERIOD_MEASURES,
  blockersFor,
  columnOf,
  isThin,
  readMeasure,
  type Measure,
  type MeasureGroup,
  type MeasureKind,
} from './report/measures.ts';
import type { ReportDocument } from './report/types.ts';
import type { Blocker, HorizonName } from './schema/types.ts';

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
  measure: Measure;
  group: MeasureGroup;
  kind: MeasureKind;
  /** The reading in the earlier period, or null where it could not be worked out. */
  then: number | null;
  /** The reading in the current period. */
  now: number | null;
  /** Signed. Null where either side is missing, never a zero (INV-2). */
  change: number | null;
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
  /**
   * Reasons the whole comparison could not be made. Non-empty means `rows`
   * carries nothing worth showing, and the report says why instead.
   */
  refusals: readonly Blocker[];
}

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

/**
 * Set two real reports side by side.
 *
 * Refuses rather than approximates. Two reports of different schema versions
 * were worked out differently, and putting their numbers together would compare
 * two methods while claiming to compare two periods.
 */
export function buildLensB(
  current: ReportDocument,
  previous: ReportDocument,
  benchmark: string,
  lookback: Lookback,
): LensBTable {
  const column = LOOKBACK_COLUMN[lookback];
  const nowMonth = current.as_of.slice(0, 7);
  const thenMonth = previous.as_of.slice(0, 7);

  const refusals: Blocker[] = [];

  if (major(current.report_schema_version) !== major(previous.report_schema_version)) {
    refusals.push(
      BLOCKERS.reportVersionMismatch(previous.report_schema_version, current.report_schema_version),
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
  // is no half of this worth showing, and a table of dashes explains nothing.
  if (thenColumn && thenColumn.growth === null) {
    refusals.push(BLOCKERS.periodNotComparable(thenMonth, thenColumn.blockers[0]?.message ?? ''));
  }
  if (nowColumn && nowColumn.growth === null) {
    refusals.push(BLOCKERS.periodNotComparable(nowMonth, nowColumn.blockers[0]?.message ?? ''));
  }

  const rows: LensBRow[] = PERIOD_MEASURES.map((measure) => {
    const now = nowColumn ? readMeasure(nowColumn, measure) : null;
    const then = thenColumn ? readMeasure(thenColumn, measure) : null;
    return {
      measure,
      group: MEASURE_GROUP[measure],
      kind: MEASURE_KIND[measure],
      then,
      now,
      change: now !== null && then !== null ? now - then : null,
      thenThin: thenColumn ? isThin(thenColumn, measure) : false,
      nowThin: nowColumn ? isThin(nowColumn, measure) : false,
      blockers: [
        ...(then === null && thenColumn ? blockersFor(thenColumn, measure) : []),
        ...(now === null && nowColumn ? blockersFor(nowColumn, measure) : []),
      ],
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
    refusals,
  };
}

/** Whether an archive holding these months can answer this lookback at all. */
export function canCompare(months: readonly string[], month: string, lookback: Lookback): boolean {
  return months.includes(archivedMonthFor(month, lookback));
}
