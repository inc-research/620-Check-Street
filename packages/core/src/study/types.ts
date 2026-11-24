// SPDX-License-Identifier: MIT
//
// A selected report (3F D-25): one dated study, computed once in analysis/ and
// committed to data/_studies/. Frozen, never rebuilt monthly. The page renders it
// and never recomputes it (INV-5). Schema 2.0 (3F D-26) reads a special window of
// days beside the year, where 1.0 read two single days.

export type GroupKey = 'equity_sleeve' | 'synthetic_long' | 'reference_only';
export type SubgroupKey =
  | 'direct_stocks'
  | 'index_etf_sleeve'
  | 'direct_flex'
  | 'ladder_of_synthetic_long_rungs'
  | 'reference_only';
export type Settled = 'above_1' | 'below_1' | 'not_settled' | null;
export type BandKey = 'small' | 'medium' | 'large' | 'top_decile';

/** One leg point: the ISO date, the fund's running sum of daily returns, the benchmark's. */
export type LegPoint = [string, number, number];

export interface Band {
  u: number | null;
  b: number | null;
  up_days: number;
  down_days: number;
}

/** The special window pooled: U, B and E from its own rising and falling days. */
export interface WindowReading {
  days: number;
  up_days: number;
  down_days: number;
  flat_days: number;
  sums: { fund_up: number; bench_up: number; fund_down: number; bench_down: number };
  /** Null where the benchmark rose on fewer than six of the window's days (3F D-11). */
  u: number | null;
  /** Null where the benchmark fell on fewer than six of the window's days. */
  b: number | null;
  u_plus_b: number | null;
  E: number | null;
  fund_net_sum: number;
  bench_net_sum: number;
  growth: { fund: number; bench: number };
}

/** One day of the window on its own. */
export interface WindowDay {
  date: string;
  fund: number;
  bench: number;
  side: 'up' | 'down' | 'flat';
  /** The fund’s move over the benchmark’s; null on a flat day. */
  share: number | null;
  band: BandKey | null;
  /** 1 = larger than every day of the year to date. */
  rank: number;
  of: number;
}

export interface StudyReading {
  first_day: string;
  days: number;
  up_days: number;
  down_days: number;
  flat_days: number;
  sums: { fund_up: number; bench_up: number; fund_down: number; bench_down: number };
  u: number;
  b: number;
  u_plus_b: number;
  /** Gain Exposure, (1 − B) ÷ U. Null where the fund kept none of the rises. */
  E: number | null;
  E_range: [number, number] | null;
  E_settled: Settled;
  market_gain_loss: number;
  fund_net_sum: number;
  bench_net_sum: number;
  window: WindowReading;
  days_in_window: WindowDay[];
  /**
   * The share of the year’s summed rises the window’s falls took back, fund and
   * market. The ratio is the window’s down capture over the year’s U: the
   * window’s Gain Exposure on the year.
   */
  giveback: { fund: number | null; bench: number | null; ratio: number | null };
  bands: Record<BandKey, Band>;
  both_up: { capture: number | null; days: number };
  both_down: { capture: number | null; days: number };
  legs: { up: LegPoint[]; down: LegPoint[] };
}

export interface Holdings {
  period: string | null;
  source: string | null;
  blocks: Record<string, number> | null;
  reason: string | null;
  look_through: {
    ticker: string | null;
    title: string;
    period: string | null;
    source: string | null;
    blocks: Record<string, number> | null;
  } | null;
}

export interface StudyFund {
  ticker: string;
  name: string;
  issuer: string;
  group: GroupKey;
  subgroup: SubgroupKey;
  flag: string | null;
  named_benchmark: string | null;
  holdings: Holdings;
  readings: Record<string, StudyReading>;
}

export interface Stat {
  n: number;
  median: number;
  min: number;
  max: number;
}

export interface GroupSummary {
  tickers: string[];
  u: Stat | null;
  b: Stat | null;
  E: Stat | null;
  u_plus_b: Stat | null;
  E_settled_above_1: number;
  E_settled_below_1: number;
  E_not_settled: number;
  /** Medians over every member, or null where any member has no figure. */
  window_u: Stat | null;
  window_b: Stat | null;
  window_E: Stat | null;
  window_giveback: Stat | null;
  /** The middle fund’s share of each window day’s move. */
  day_capture: Record<string, Stat | null>;
  bands: Record<BandKey, { u: Stat | null; b: Stat | null }>;
}

export type Basis = 'named' | 'VOO';

export interface StudyDocument {
  app: 'Third Floor';
  kind: 'selected_report';
  study_schema_version: string;
  id: string;
  title: string;
  published: string;
  /** The report this one replaced on the site, where it replaced one (3F D-26). */
  supersedes?: string;
  window: { start: string; end: string };
  special_window: { start: string; end: string; days: string[] };
  provenance: {
    prices_fetched_at: string;
    price_basis: string;
    price_source: string;
    holdings_source: string;
    grouping_approved: string;
    grouping_rule: string;
    bootstrap: { block: string; resamples: number; seed: number };
    min_days_to_report: number;
    analysis: string;
  };
  benchmarks: Record<string, {
    /** Each window day’s move. */
    moves: Record<string, number>;
    window: { sum_up: number; sum_down: number; up_days: number; down_days: number; growth: number };
    band_edges: { t1: number; t2: number; d9: number };
  }>;
  funds: StudyFund[];
  summaries: Record<Basis, Record<string, GroupSummary>>;
}
