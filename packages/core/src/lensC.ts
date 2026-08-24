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
import { HORIZONS, STATES } from './schema/types.ts';
import type { Blocker, BenchmarkBlock, HorizonName, Snapshot, StateName } from './schema/types.ts';

export interface LensCRow {
  state: StateName;
  group: 'participation' | 'resilience';
  /** The first fund's reading. */
  a: number | null;
  /** The second fund's reading. */
  b: number | null;
  /**
   * Signed: `a - b`. Positive means the first fund moved further for the same
   * market move. Null where either side is missing — never a zero, which would
   * say the two funds behaved alike (INV-2).
   */
  difference: number | null;
  /** At least the threshold's worth of difference, in either direction. */
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
  threshold: number | null;
  /**
   * Reasons the comparison could not be made at all. Non-empty means `rows`
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

/** Where the comparison starts, and the only benchmark guaranteed present on every fund. */
export const COMPARISON_HORIZON: HorizonName = '12mo';

/** The major component. Below 1.0 the family checks on MINOR (SF-14); this document is past it. */
function major(version: string): string {
  return version.split('.')[0] ?? version;
}

function columnOf(block: BenchmarkBlock, horizon: HorizonName) {
  return block.horizons.find((h) => h.horizon === horizon);
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
export function sharedBenchmarks(a: Snapshot, b: Snapshot, anchor: string): string[] {
  const inB = new Set(Object.keys(b.benchmarks));
  const both = Object.keys(a.benchmarks).filter((k) => inB.has(k));
  return both.sort((x, y) => (x === anchor ? -1 : y === anchor ? 1 : x.localeCompare(y)));
}

/** Window lengths that produced a reading on both sides. */
export function comparableHorizons(
  a: Snapshot,
  b: Snapshot,
  benchmark: string,
): HorizonName[] {
  const blockA = a.benchmarks[benchmark];
  const blockB = b.benchmarks[benchmark];
  if (!blockA || !blockB) return [];
  return HORIZONS.filter((h) => {
    const ca = columnOf(blockA, h);
    const cb = columnOf(blockB, h);
    return !!ca && ca.states !== null && !!cb && cb.states !== null;
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
  a: Snapshot,
  b: Snapshot,
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

  if (major(a.schema_version) !== major(b.schema_version)) {
    refusals.push(BLOCKERS.reportVersionMismatch(b.schema_version, a.schema_version));
  }

  const blockA = a.benchmarks[benchmark];
  const blockB = b.benchmarks[benchmark];

  if (!blockA) refusals.push(BLOCKERS.benchmarkNotInBothReports(a.ticker, benchmark, monthA));
  if (!blockB) refusals.push(BLOCKERS.benchmarkNotInBothReports(b.ticker, benchmark, monthB));

  const columnA = blockA ? columnOf(blockA, horizon) : undefined;
  const columnB = blockB ? columnOf(blockB, horizon) : undefined;

  // A window blocked on either side takes the whole comparison with it, as in
  // Lens B: four dashes in a row explain nothing, and one sentence does.
  if (columnA && columnA.states === null) {
    refusals.push(BLOCKERS.readingNotComparable(a.ticker, columnA.blockers[0]?.message ?? ''));
  }
  if (columnB && columnB.states === null) {
    refusals.push(BLOCKERS.readingNotComparable(b.ticker, columnB.blockers[0]?.message ?? ''));
  }

  // One number for the reader to learn, so it has to be the same number on both
  // sides. Two documents that disagree about what counts as a difference cannot
  // mark one, and an unmarked table is honest where a mismarked one is not.
  const thresholdA = a.methodology.shift_threshold;
  const thresholdB = b.methodology.shift_threshold;
  const threshold = thresholdA !== null && thresholdA === thresholdB ? thresholdA : null;

  const rows: LensCRow[] = STATES.map((state) => {
    const cellA = columnA?.states?.[state] ?? null;
    const cellB = columnB?.states?.[state] ?? null;

    const valueA = cellA?.raw_semibeta ?? null;
    const valueB = cellB?.raw_semibeta ?? null;
    const difference = valueA !== null && valueB !== null ? valueA - valueB : null;

    const blockers: Blocker[] = [];
    if (cellA && cellA.raw_semibeta === null) blockers.push(...cellA.blockers);
    if (cellB && cellB.raw_semibeta === null) blockers.push(...cellB.blockers);

    return {
      state,
      group: GROUP[state],
      a: valueA,
      b: valueB,
      difference,
      differs: threshold !== null && difference !== null && Math.abs(difference) >= threshold,
      aThin: cellA?.data_sufficiency === 'thin',
      bThin: cellB?.data_sufficiency === 'thin',
      blockers,
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
    threshold,
    refusals,
  };
}

export { HORIZONS, STATES };
