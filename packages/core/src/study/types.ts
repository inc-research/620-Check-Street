// SPDX-License-Identifier: MIT
//
// A selected report (3F D-25): one dated study, computed once in analysis/ and
// committed to data/_studies/. Frozen, never rebuilt monthly. The page renders it
// and never recomputes it (INV-5).

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
  nov4: { fund: number; bench: number; kept: number | null; rank: number };
  nov5: {
    fund: number;
    bench: number;
    avoided: number | null;
    given_back_fund: number | null;
    given_back_bench: number | null;
    /** 5 November’s Gain Exposure: the day’s down capture over the year’s U. */
    E: number | null;
    rank: number;
    of: number;
  };
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
  nov4_day_capture: Stat | null;
  nov5_day_buffer: Stat | null;
  nov5_takeback_ratio: Stat | null;
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
  window: { start: string; end: string };
  special_days: [string, string];
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
  benchmarks: Record<string, { moves: Record<string, number>; band_edges: { t1: number; t2: number; d9: number } }>;
  funds: StudyFund[];
  summaries: Record<Basis, Record<string, GroupSummary>>;
}
