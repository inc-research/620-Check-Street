// SPDX-License-Identifier: MIT
//
// Lens A: one snapshot, read across trailing-window lengths.
//
// Pure. Turns a snapshot document into the rows the report table draws, and
// decides which markers each cell carries. The view renders what this returns
// and computes nothing of its own (INV-5) — so the rules below are testable
// without a DOM, and there is one place to look for why a dot appeared.

import { HORIZONS, STATES, type HorizonName, type Snapshot, type StateName } from './schema/types.ts';
import { BLOCKERS } from './diagnostics.ts';
import type { Blocker, BenchmarkBlock, Cell } from './schema/types.ts';

/** What a single cell of the report table shows. */
export interface TableCell {
  horizon: HorizonName;
  /**
   * What the table prints: for every 1% the benchmark moved on days of this
   * kind, the fund moved this much. Null where there was nothing to work a
   * ratio out from — never a zero standing in for one (INV-2).
   */
  ratio: number | null;
  /**
   * The bounded 0-100 rendering. Retained in the document but NOT shown: it
   * cannot represent a negative reading, and about a third of the two
   * opposite-direction rows are negative (3F D-12).
   */
  score: number | null;
  observations: number;
  /** Fewer days behind this than the methodology's floor. */
  thin: boolean;
  /**
   * At least `shift_threshold` points from this row's 12-month reading. Never
   * true on the baseline column itself, and never true when there is no
   * baseline to measure from.
   */
  shifted: boolean;
  /** Points from the baseline, or null when there is no baseline. */
  distanceFromBaseline: number | null;
  blockers: readonly Blocker[];
}

export interface TableRow {
  state: StateName;
  group: 'participation' | 'resilience';
  cells: TableCell[];
}

export interface LensATable {
  ticker: string;
  benchmark: string;
  roles: readonly string[];
  asOf: string;
  rows: TableRow[];
  /**
   * True when the 12-month column could not be computed. The shift marker is
   * defined as distance from that column, so with it absent there is nothing to
   * measure against and no cell is marked (3F-O-02). The report says so once,
   * above the table, rather than leaving the reader to notice an absence.
   */
  baselineAbsent: boolean;
  /** Horizons that produced nothing, with the reason and its remedy. */
  blockedHorizons: { horizon: HorizonName; blockers: readonly Blocker[] }[];
  shiftThreshold: number | null;
}

const GROUP: Record<StateName, 'participation' | 'resilience'> = {
  fund_up_bench_up: 'participation',
  fund_down_bench_down: 'participation',
  fund_up_bench_down: 'resilience',
  fund_down_bench_up: 'resilience',
};

/** The column every other column is measured against. */
export const BASELINE: HorizonName = '12mo';

function cellFor(block: BenchmarkBlock, horizon: HorizonName, state: StateName): Cell | null {
  const entry = block.horizons.find((h) => h.horizon === horizon);
  if (!entry || entry.states === null) return null;
  return entry.states[state];
}

/**
 * Build the table for one fund against one benchmark.
 *
 * Throws rather than returning a partial table when the benchmark is not in the
 * document: a table that silently renders a different benchmark than the one
 * asked for is worse than an error somebody can see.
 */
export function buildLensA(snapshot: Snapshot, benchmark: string): LensATable {
  const block = snapshot.benchmarks[benchmark];
  if (!block) {
    throw new Error(`${snapshot.ticker} has no reading against ${benchmark}.`);
  }

  const threshold = snapshot.methodology.shift_threshold;
  const floor = snapshot.methodology.min_observations_per_cell;

  const baselineEntry = block.horizons.find((h) => h.horizon === BASELINE);
  const baselineAbsent = !baselineEntry || baselineEntry.states === null;

  const rows: TableRow[] = STATES.map((state) => {
    // The baseline is the ratio, not the bounded score: the score clamps every
    // negative to zero, which would put two opposite readings at the same
    // distance from each other (3F D-12).
    const baselineRatio = baselineAbsent
      ? null
      : (cellFor(block, BASELINE, state)?.raw_semibeta ?? null);

    const cells: TableCell[] = HORIZONS.map((horizon) => {
      const cell = cellFor(block, horizon, state);

      if (!cell) {
        const entry = block.horizons.find((h) => h.horizon === horizon);
        return {
          horizon,
          ratio: null,
          score: null,
          observations: 0,
          thin: false,
          shifted: false,
          distanceFromBaseline: null,
          blockers: entry?.blockers ?? [],
        };
      }

      const distance =
        baselineRatio !== null && cell.raw_semibeta !== null && horizon !== BASELINE
          ? Math.abs(cell.raw_semibeta - baselineRatio)
          : null;

      return {
        horizon,
        ratio: cell.raw_semibeta,
        score: cell.score,
        observations: cell.observation_count,
        thin: cell.data_sufficiency === 'thin',
        shifted: threshold !== null && distance !== null && distance >= threshold,
        distanceFromBaseline: distance,
        blockers: cell.blockers,
      };
    });

    return { state, group: GROUP[state], cells };
  });

  const blockedHorizons = block.horizons
    .filter((h) => h.states === null)
    .map((h) => ({ horizon: h.horizon, blockers: h.blockers }));

  return {
    ticker: snapshot.ticker,
    benchmark,
    roles: block.roles,
    asOf: snapshot.as_of,
    rows,
    baselineAbsent,
    blockedHorizons,
    shiftThreshold: threshold,
  };
}

/**
 * Which benchmark to show first.
 *
 * The fund's own named benchmark leads where it has one, because "does this
 * fund behave the way its own literature says" is the sharper question. The
 * universal anchor is the fallback and is always present.
 */
export function defaultBenchmark(snapshot: {
  ticker: string;
  benchmarks: Record<string, { roles: readonly string[] }>;
}): string {
  const named = Object.entries(snapshot.benchmarks).find(([, b]) =>
    b.roles.includes('named_benchmark'),
  );
  if (named) return named[0];
  const first = Object.keys(snapshot.benchmarks)[0];
  if (!first) throw new Error(`${snapshot.ticker} carries no benchmark at all.`);
  return first;
}

/** The blocker to show above a table with no baseline (3F-O-02). */
export function baselineBlocker(ticker: string): Blocker {
  return BLOCKERS.noBaselineToCompareAgainst(ticker);
}

export { HORIZONS, STATES };
export type { Blocker };
