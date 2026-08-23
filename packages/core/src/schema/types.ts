// SPDX-License-Identifier: MIT
//
// Hand-mirrored from schemas/snapshot.schema.json. Kept by hand rather than
// generated so the file reads as documentation of what a snapshot is; the
// round-trip test in test/schema.test.ts is what keeps the two in step.

/** Bumped on any change to the document's shape. Checked on MAJOR (SF-14). */
export const SCHEMA_VERSION = '4.0';

/**
 * Column order of the report table, left to right.
 *
 * A `4wk` column was computed in the first build and removed by 3F D-10: four
 * weeks is about twenty trading days, and split across four sign quadrants that
 * leaves roughly four days in each, so no 4wk cell in a full archive run ever
 * cleared the observation floor. A column whose every cell carries the same
 * warning is not disclosure.
 */
export const HORIZONS = ['12mo', '6mo', '13wk'] as const;
export type HorizonName = (typeof HORIZONS)[number];

/**
 * The four sign quadrants, in the report table's row order. The first two are
 * grouped under Participation, the last two under Resilience.
 */
export const STATES = [
  'fund_up_bench_up',
  'fund_down_bench_down',
  'fund_up_bench_down',
  'fund_down_bench_up',
] as const;
export type StateName = (typeof STATES)[number];

export type DataSufficiency = 'ok' | 'thin' | 'blocked';
export type PriceBasis = 'close_adjusted' | 'close_unadjusted';
export type PriceSource = 'yfinance' | 'stooq' | 'yahoo_chart';
export type Category = 'options_integrated' | 'managed_futures';
export type BenchmarkRole = 'universal_anchor' | 'named_benchmark';
export type BenchmarkSource =
  | 'prospectus_index'
  | 'marketing_language'
  | 'default_no_named_benchmark';

/**
 * INV-2: a missing input blocks its metric and names a remedy. `remedy` is
 * required, not optional — a blocker with no remedy is a dead end, and "what
 * would make this different" is the half a non-specialist needs.
 */
export interface Blocker {
  code: string;
  message: string;
  remedy: string;
  subjects?: string[];
}

export interface Cell {
  /**
   * Stored alongside `score` so the display transform can be changed and the
   * whole archive regenerated with no network call (3F D-04). Null when
   * blocked — never a number standing in for one.
   */
  raw_semibeta: number | null;
  score: number | null;
  observation_count: number;
  quadrant_cov: number | null;
  quadrant_var_bench: number | null;
  data_sufficiency: DataSufficiency;
  blockers: Blocker[];
}

export interface Horizon {
  horizon: HorizonName;
  window_start: string | null;
  window_end: string | null;
  observations_total: number;
  observations_classified: number;
  /**
   * Paired days where either return was exactly zero. The four quadrants do not
   * partition the sample, and flat days are real in thinly traded buffered
   * ETFs — so total must equal classified plus this, and that identity is
   * checked rather than assumed.
   */
  observations_unclassified: number;
  states: Record<StateName, Cell> | null;
  blockers: Blocker[];
}

export interface BenchmarkBlock {
  roles: BenchmarkRole[];
  benchmark_source: BenchmarkSource | null;
  benchmark_note?: string;
  /** An array because its order is the report table's column order. */
  horizons: Horizon[];
}

export interface Coverage {
  inception: string;
  earliest_available_snapshot: string;
  /**
   * The oldest month whose 12mo horizon is computable, or null if none is.
   * Exists because 3F D-09 writes a snapshot when any horizon is computable, so
   * a file can carry a blocked baseline — and the shift marker, defined as
   * distance from that baseline, then has nothing to measure from.
   */
  earliest_full_baseline_snapshot: string | null;
  requested_backfill_depth_months: number;
  history_limited_by_inception: boolean;
}

export interface Methodology {
  /** What the report puts on the page: the ratio itself (3F D-12). */
  reported_value: string;
  score_normalization: string;
  score_normalization_formula: string;
  shift_threshold: number | null;
  shift_threshold_note?: string;
  min_observations_per_cell: number;
  price_basis: PriceBasis;
  price_source: PriceSource;
  return_frequency: 'daily';
  defined_outcome_caveat: boolean;
}

export interface Snapshot {
  app: 'Third Floor';
  schema_version: string;
  ticker: string;
  name: string;
  issuer: string;
  category: Category;
  as_of: string;
  generated_at: string;
  coverage: Coverage;
  methodology: Methodology;
  /** Keyed by benchmark ticker. VOO is always present. */
  benchmarks: Record<string, BenchmarkBlock>;
}

/**
 * The display transform, mirrored from thirdfloor/semibeta.py so a committed
 * score can be rechecked against its own raw value. `Math.round` is
 * floor(x + 0.5), which is what the Python side computes explicitly rather than
 * using round() — Python's round() is banker's rounding and would disagree.
 */
export function normaliseScore(raw: number | null): number | null {
  if (raw === null) return null;
  return Math.max(0, Math.min(100, Math.round(50 * raw)));
}
