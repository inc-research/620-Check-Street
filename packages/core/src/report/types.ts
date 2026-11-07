// SPDX-License-Identifier: MIT
//
// Hand-mirrored from schemas/report.schema.json, for the reason given at the top
// of schema/types.ts. This is what the page reads first (3F D-17).

import type {
  BenchmarkRole,
  BenchmarkSource,
  Blocker,
  Category,
  Coverage,
  HorizonName,
  PriceBasis,
  PriceSource,
} from '../schema/types.ts';

/** Separate from the snapshot's version: the two archives move independently (3F D-18). */
export const REPORT_SCHEMA_VERSION = '1.0';

/** Every day the market moved one way, whatever the fund did. */
export interface Side {
  days: number;
  sum_fund: number;
  sum_benchmark: number;
  /** sum_fund / sum_benchmark. Not compounded, which would invent an asymmetry (3F D-17). */
  capture: number | null;
  average_fund: number | null;
  average_benchmark: number | null;
  against_days: number;
  against_share: number | null;
  blockers: Blocker[];
}

export interface Fall {
  /** A negative fraction. 0 is measured: nothing fell. */
  depth: number;
  peak_date: string | null;
  trough_date: string | null;
}

export interface ReportHorizon {
  horizon: HorizonName;
  window_start: string;
  window_end: string;
  first_day: string | null;
  days_total: number;
  market_up_days: number;
  market_down_days: number;
  market_flat_days: number;
  growth: { fund: number; benchmark: number } | null;
  up: Side | null;
  down: Side | null;
  worst_fall: { fund: Fall; benchmark: Fall } | null;
  fit: { r_squared: number | null; beta: number | null; blockers: Blocker[] } | null;
  blockers: Blocker[];
}

export interface ReportBenchmark {
  roles: BenchmarkRole[];
  benchmark_source: BenchmarkSource | null;
  horizons: ReportHorizon[];
}

export interface ReportMethodology {
  measures: string;
  low_fit_r_squared: number;
  price_basis: PriceBasis;
  price_source: PriceSource;
  return_frequency: 'daily';
  defined_outcome_caveat: boolean;
}

export interface ReportDocument {
  app: 'Third Floor';
  report_schema_version: string;
  ticker: string;
  name: string;
  issuer: string;
  category: Category;
  as_of: string;
  generated_at: string;
  coverage: Coverage;
  methodology: ReportMethodology;
  benchmarks: Record<string, ReportBenchmark>;
}
