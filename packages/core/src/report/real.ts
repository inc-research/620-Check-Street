// SPDX-License-Identifier: MIT
//
// What $100 became after an adviser's fee and inflation, beside what Treasury
// bills would have paid (3F D-23).
//
// Pure, and computed when the page is drawn rather than stored. A month whose
// consumer price figure is not out yet borrows the latest one and says so, and
// that stand-in has to give way by itself once the real figure is published. An
// append-only archive cannot do that; a function of committed inputs can. Every
// input is already in the repository: the report's growth and window dates, the
// fee file, and the two rate series.
//
// The fund's own costs are NOT subtracted here. Its price, and so its growth, is
// already net of them (3F D-22). They are reported as an amount already taken,
// never taken again.

import type { Blocker, HorizonName } from '../schema/types.ts';
import { BLOCKERS } from '../diagnostics.ts';
import type { ReportHorizon } from './types.ts';

export const FEES_SCHEMA_VERSION = '1.0';
export const RATES_SCHEMA_VERSION = '1.0';

/** The adviser fee the page offers, a year. */
export const ADVISER_FEE = 0.01;

const DAYS_PER_YEAR = 365.25;
const MS_PER_DAY = 86_400_000;
/** A bill-rate series ending more than this many days before a window ends is a stand-in. */
const BILL_STALE_DAYS = 7;

export interface FeeTable {
  management: number | null;
  distribution_12b1: number | null;
  other: number | null;
  acquired_funds: number | null;
  gross: number;
  waiver: number;
  net: number;
  source: {
    kind: 'sec_xbrl' | 'manual';
    form: string;
    filed: string;
    accession: string | null;
    url: string;
    series_id: string | null;
    class_id: string | null;
    note: string | null;
  };
}

/** `data/_fees/<TICKER>/<YYYY-MM>.json`. */
export interface FeeDocument {
  app: 'Third Floor';
  fees_schema_version: string;
  ticker: string;
  role: 'fund' | 'benchmark';
  month: string;
  as_of: string;
  generated_at: string;
  /** Always true: the price, and every figure worked out from it, is already net of these. */
  already_in_returns: true;
  effective_date_note: string;
  fees: FeeTable | null;
  blockers: Blocker[];
}

/** `data/_rates/<SERIES>.json`. Observations are [date, value], sorted. */
export interface RateSeries {
  app: 'Third Floor';
  rates_schema_version: string;
  series_id: 'CPIAUCNS' | 'DGS3MO';
  title: string;
  units: string;
  frequency: 'monthly' | 'daily';
  source: 'fred_api' | 'fred_csv';
  source_url: string;
  fetched_at: string;
  missing_days_dropped: number;
  observations: [string, number][];
}

export interface Inflation {
  /** Price level at the end over the start. 1.03 is prices up 3%. */
  ratio: number;
  startMonth: string;
  endMonth: string;
  /** The month whose figure stood in for `endMonth`, where that one is not out yet. */
  endUsed: string;
  provisional: boolean;
  /** Months never published, filled from the months either side. */
  estimated: string[];
}

export interface Money {
  /** Per $100 at the start, before inflation. */
  nominal: number;
  /** The same, in money of the window's last month. */
  real: number;
}

export interface RealReading {
  horizon: HorizonName;
  years: number;
  adviserFee: number;
  fund: Money;
  market: Money;
  bills: Money;
  billsProvisional: boolean;
  inflation: Inflation;
  /** Dollars per $100 the fund's own costs took over the window, already inside `fund`. */
  fundCosts: number | null;
  marketCosts: number | null;
}

export type RealResult =
  | { kind: 'computed'; reading: RealReading }
  | { kind: 'blocked'; horizon: HorizonName; blockers: Blocker[] };

const monthOf = (isoDate: string): string => isoDate.slice(0, 7);

function days(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY;
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Monthly index levels keyed by YYYY-MM. */
export function cpiByMonth(cpi: RateSeries): Map<string, number> {
  return new Map(cpi.observations.map(([d, v]) => [monthOf(d), v]));
}

/**
 * One month's price level. A month inside the published range with no figure
 * (October 2025 was never collected) is the geometric midpoint of the nearest
 * published months either side, and is reported as estimated.
 */
function level(
  byMonth: Map<string, number>,
  month: string,
): { value: number; estimated: boolean } | null {
  const exact = byMonth.get(month);
  if (exact !== undefined) return { value: exact, estimated: false };
  const months = [...byMonth.keys()].sort();
  const first = months[0];
  const last = months[months.length - 1];
  if (first === undefined || last === undefined || month < first || month > last) return null;
  let before = previousMonth(month);
  while (!byMonth.has(before)) before = previousMonth(before);
  let after = nextMonth(month);
  while (!byMonth.has(after)) after = nextMonth(after);
  const gapBefore = monthsBetween(before, month);
  const gapAfter = monthsBetween(month, after);
  const a = byMonth.get(before)!;
  const b = byMonth.get(after)!;
  // Geometric interpolation: equal growth each month across the gap.
  const value = a * Math.pow(b / a, gapBefore / (gapBefore + gapAfter));
  return { value, estimated: true };
}

function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number) as [number, number];
  const [yb, mb] = b.split('-').map(Number) as [number, number];
  return (yb - ya) * 12 + (mb - ma);
}

export function inflationOver(cpi: RateSeries, start: string, end: string): Inflation | null {
  const byMonth = cpiByMonth(cpi);
  const months = [...byMonth.keys()].sort();
  const last = months[months.length - 1];
  if (last === undefined) return null;
  const startMonth = monthOf(start);
  const endMonth = monthOf(end);
  const endUsed = endMonth > last ? last : endMonth;
  const s = level(byMonth, startMonth > last ? last : startMonth);
  const e = level(byMonth, endUsed);
  if (!s || !e) return null;
  const estimated = [
    ...(s.estimated ? [startMonth] : []),
    ...(e.estimated ? [endUsed] : []),
  ];
  return {
    ratio: e.value / s.value,
    startMonth,
    endMonth,
    endUsed,
    provisional: endUsed !== endMonth,
    estimated,
  };
}

/**
 * What $1 earned in three-month bills from `start` to `end`. Each published
 * yield (percent a year, bond-equivalent) holds until the next one.
 */
export function billGrowth(
  bills: RateSeries,
  start: string,
  end: string,
): { growth: number; provisional: boolean } | null {
  const obs = bills.observations;
  // The rate in force on the first day: the last reading on or before it.
  let i = -1;
  for (let k = 0; k < obs.length; k++) {
    if (obs[k]![0] <= start) i = k;
    else break;
  }
  if (i < 0) return null;
  let logGrowth = 0;
  let cursor = start;
  for (let k = i; k < obs.length && cursor < end; k++) {
    const [, yieldPct] = obs[k]!;
    const nextDate = k + 1 < obs.length ? obs[k + 1]![0] : end;
    const until = nextDate < end ? nextDate : end;
    const span = days(cursor, until);
    if (span > 0) logGrowth += (span / 365) * Math.log1p(yieldPct / 100);
    cursor = until;
  }
  const lastDate = obs[obs.length - 1]![0];
  return { growth: Math.exp(logGrowth), provisional: days(lastDate, end) > BILL_STALE_DAYS };
}

/** Dollars per $100 that a yearly cost took over `years`, when what is left is `growth`. */
export function costsTaken(growth: number, annualCost: number, years: number): number {
  return 100 * growth * (Math.pow(1 - annualCost, -years) - 1);
}

export interface RealInputs {
  horizon: ReportHorizon;
  cpi: RateSeries;
  bills: RateSeries;
  fundFees: FeeDocument | null;
  marketFees: FeeDocument | null;
  adviser: boolean;
}

export function realReading(inputs: RealInputs): RealResult {
  const h = inputs.horizon;
  if (!h.growth) return { kind: 'blocked', horizon: h.horizon, blockers: h.blockers };

  const years = days(h.window_start, h.window_end) / DAYS_PER_YEAR;
  const inflation = inflationOver(inputs.cpi, h.window_start, h.window_end);
  const bill = billGrowth(inputs.bills, h.window_start, h.window_end);
  if (!inflation || !bill) {
    return {
      kind: 'blocked',
      horizon: h.horizon,
      blockers: [BLOCKERS.ratesNotCovered(h.window_start, h.window_end)],
    };
  }

  const adviserFee = inputs.adviser ? ADVISER_FEE : 0;
  const keep = Math.pow(1 - adviserFee, years);
  const money = (growth: number): Money => ({
    nominal: 100 * growth * keep,
    real: (100 * growth * keep) / inflation.ratio,
  });
  const fundNet = inputs.fundFees?.fees?.net;
  const marketNet = inputs.marketFees?.fees?.net;

  return {
    kind: 'computed',
    reading: {
      horizon: h.horizon,
      years,
      adviserFee,
      fund: money(h.growth.fund),
      market: money(h.growth.benchmark),
      bills: money(bill.growth),
      billsProvisional: bill.provisional,
      inflation,
      fundCosts: fundNet === undefined ? null : costsTaken(h.growth.fund, fundNet, years),
      marketCosts: marketNet === undefined ? null : costsTaken(h.growth.benchmark, marketNet, years),
    },
  };
}
