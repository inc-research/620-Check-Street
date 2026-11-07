// SPDX-License-Identifier: MIT
//
// Lens C: two funds, one benchmark, one month, one window length.
//
// Distinct from both others, and the distinctions are what the constraints
// enforce. Lens A varies the window length; Lens B varies the date; Lens C
// varies the fund and holds everything else still. Anything that moves besides
// the fund is a second explanation for the difference, and the reader has no way
// to tell the two apart — so this module refuses rather than approximates.
//
// The table shows both readings and the difference between them, not the
// difference alone. Measured across the archive, a difference of +0.30 is
// consistent with the higher fund sitting anywhere from +0.04 to +0.71: the
// delta on its own does not say whether both funds track the market closely or
// one of them barely moves (3F D-14).
//
// Pure. No I/O; the caller fetches both documents.

import { BLOCKERS } from './diagnostics.ts';
import {
  FUND_MEASURES,
  MEASURE_GROUP,
  MEASURE_KIND,
  blockersFor,
  columnOf,
  isThin,
  readMeasure,
  type Measure,
  type MeasureGroup,
  type MeasureKind,
} from './report/measures.ts';
import type { ReportDocument } from './report/types.ts';
import { HORIZONS } from './schema/types.ts';
import type { Blocker, HorizonName } from './schema/types.ts';

/**
 * The gap that earns the amber dot, on the two per-1% rows only. Measured on the
 * real report archive: every one of the 309 gaps this size, across 435 pairs and
 * both rows, sat beyond two standard errors (3F D-17). Same number as the rest of
 * the site, and the one place on the money and exposure rows a dot still means
 * something.
 */
export const DIFFERENCE_MARK = 0.3;

export interface LensCRow {
  measure: Measure;
  group: MeasureGroup;
  kind: MeasureKind;
  /** The first fund's reading. */
  a: number | null;
  /** The second fund's reading. */
  b: number | null;
  /** Signed: `a - b`. Null where either side is missing, never a zero (INV-2). */
  difference: number | null;
  /** On a per-1% row, at least `DIFFERENCE_MARK` apart. Never on any other row. */
  differs: boolean;
  aThin: boolean;
  bThin: boolean;
  blockers: readonly Blocker[];
}

export interface LensCTable {
  a: string;
  b: string;
  nameA: string;
  nameB: string;
  benchmark: string;
  /** The window length both sides are read over. */
  horizon: HorizonName;
  month: string;
  asOf: string;
  window: { start: string | null; end: string | null };
  rows: LensCRow[];
  /**
   * Reasons the comparison could not be made at all. Non-empty means `rows`
   * carries nothing worth showing, and the report says why instead.
   */
  refusals: readonly Blocker[];
}

/** Where the comparison starts, and the only benchmark guaranteed present on every fund. */
export const COMPARISON_HORIZON: HorizonName = '12mo';

/** The major component. Below 1.0 the family checks on MINOR (SF-14); this document is past it. */
function major(version: string): string {
  return version.split('.')[0] ?? version;
}

/** Months both funds published a report for, oldest first. */
export function sharedMonths(a: readonly string[], b: readonly string[]): string[] {
  const other = new Set(b);
  return a.filter((m) => other.has(m));
}

/**
 * Benchmarks both reports carry.
 *
 * The universal anchor leads where both have it, because it is the one every
 * fund on this site is measured against and so the one that makes any two of
 * them comparable. A fund's own named benchmark varies, and comparing two funds
 * across two different named benchmarks compares two questions.
 */
export function sharedBenchmarks(
  a: ReportDocument,
  b: ReportDocument,
  anchor: string,
): string[] {
  const inB = new Set(Object.keys(b.benchmarks));
  const both = Object.keys(a.benchmarks).filter((k) => inB.has(k));
  return both.sort((x, y) => (x === anchor ? -1 : y === anchor ? 1 : x.localeCompare(y)));
}

/** Window lengths that produced a reading on both sides. */
export function comparableHorizons(
  a: ReportDocument,
  b: ReportDocument,
  benchmark: string,
): HorizonName[] {
  const blockA = a.benchmarks[benchmark];
  const blockB = b.benchmarks[benchmark];
  if (!blockA || !blockB) return [];
  return HORIZONS.filter((h) => {
    const ca = columnOf(blockA, h);
    const cb = columnOf(blockB, h);
    return !!ca && ca.growth !== null && !!cb && cb.growth !== null;
  });
}

/**
 * Set two funds side by side.
 *
 * The two constraints the build spec asks this lens to enforce rather than
 * merely support are both refusals here: the same benchmark on both sides, and
 * the same month on both sides. A third — the same schema version — comes from
 * Lens B, for the same reason it does there.
 */
export function buildLensC(
  a: ReportDocument,
  b: ReportDocument,
  benchmark: string,
  horizon: HorizonName,
): LensCTable {
  const monthA = a.as_of.slice(0, 7);
  const monthB = b.as_of.slice(0, 7);

  const refusals: Blocker[] = [];

  if (a.ticker === b.ticker) {
    refusals.push(BLOCKERS.sameFundTwice(a.ticker));
  }

  // Same month on both sides. Two funds read a month apart differ partly
  // because they are different funds and partly because they were read over
  // different stretches of market, and nothing in the table separates the two.
  if (monthA !== monthB) {
    refusals.push(BLOCKERS.readingsFromDifferentMonths(a.ticker, monthA, b.ticker, monthB));
  }

  if (major(a.report_schema_version) !== major(b.report_schema_version)) {
    refusals.push(
      BLOCKERS.reportVersionMismatch(b.report_schema_version, a.report_schema_version),
    );
  }

  const blockA = a.benchmarks[benchmark];
  const blockB = b.benchmarks[benchmark];

  if (!blockA) refusals.push(BLOCKERS.benchmarkNotInBothReports(a.ticker, benchmark, monthA));
  if (!blockB) refusals.push(BLOCKERS.benchmarkNotInBothReports(b.ticker, benchmark, monthB));

  const columnA = blockA ? columnOf(blockA, horizon) : undefined;
  const columnB = blockB ? columnOf(blockB, horizon) : undefined;

  // A window blocked on either side takes the whole comparison with it, as in
  // Lens B: four dashes in a row explain nothing, and one sentence does.
  if (columnA && columnA.growth === null) {
    refusals.push(BLOCKERS.readingNotComparable(a.ticker, columnA.blockers[0]?.message ?? ''));
  }
  if (columnB && columnB.growth === null) {
    refusals.push(BLOCKERS.readingNotComparable(b.ticker, columnB.blockers[0]?.message ?? ''));
  }

  const rows: LensCRow[] = FUND_MEASURES.map((measure) => {
    const valueA = columnA ? readMeasure(columnA, measure) : null;
    const valueB = columnB ? readMeasure(columnB, measure) : null;
    const difference = valueA !== null && valueB !== null ? valueA - valueB : null;
    return {
      measure,
      group: MEASURE_GROUP[measure],
      kind: MEASURE_KIND[measure],
      a: valueA,
      b: valueB,
      difference,
      differs:
        MEASURE_KIND[measure] === 'ratio' &&
        difference !== null &&
        Math.abs(difference) >= DIFFERENCE_MARK,
      aThin: columnA ? isThin(columnA, measure) : false,
      bThin: columnB ? isThin(columnB, measure) : false,
      blockers: [
        ...(valueA === null && columnA ? blockersFor(columnA, measure) : []),
        ...(valueB === null && columnB ? blockersFor(columnB, measure) : []),
      ],
    };
  });

  return {
    a: a.ticker,
    b: b.ticker,
    nameA: a.name,
    nameB: b.name,
    benchmark,
    horizon,
    month: monthA,
    asOf: a.as_of,
    window: { start: columnA?.window_start ?? null, end: columnA?.window_end ?? null },
    rows,
    refusals,
  };
}

export { HORIZONS };
