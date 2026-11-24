// SPDX-License-Identifier: MIT
//
// Everything a selected report's page needs that is a choice about the document
// rather than a layout: the order of rows, which figure leads each card, the range
// a sub-group spans. Selections and orderings only; every number is read from the
// document as published (INV-5).

import type { Basis, BandKey, GroupKey, Stat, StudyDocument, StudyFund, StudyReading, SubgroupKey, WindowDay } from './types.ts';
import { benchmarkFor } from './validate.ts';

export const STUDY_GROUP_ORDER: GroupKey[] = ['equity_sleeve', 'synthetic_long', 'reference_only'];
export const STUDY_SUBGROUP_ORDER: SubgroupKey[] = [
  'direct_stocks', 'index_etf_sleeve', 'direct_flex', 'ladder_of_synthetic_long_rungs', 'reference_only',
];
export const STUDY_BANDS: BandKey[] = ['small', 'medium', 'large', 'top_decile'];

export interface StudyRow {
  fund: StudyFund;
  benchmark: string;
  reading: StudyReading;
}

export function readingFor(fund: StudyFund, basis: Basis): StudyRow {
  const benchmark = benchmarkFor(fund, basis);
  return { fund, benchmark, reading: fund.readings[benchmark]! };
}

/** Group, then sub-group, then the highest Gain Exposure first. */
export function studyRows(doc: StudyDocument, basis: Basis): StudyRow[] {
  return doc.funds
    .map((f) => readingFor(f, basis))
    .sort((a, b) =>
      STUDY_GROUP_ORDER.indexOf(a.fund.group) - STUDY_GROUP_ORDER.indexOf(b.fund.group) ||
      STUDY_SUBGROUP_ORDER.indexOf(a.fund.subgroup) - STUDY_SUBGROUP_ORDER.indexOf(b.fund.subgroup) ||
      (b.reading.E ?? 0) - (a.reading.E ?? 0));
}

export interface StudyHero {
  /** VOO compounded over the special window, as an investor saw it. */
  marketWindow: number;
  windowDays: number; upDays: number; downDays: number;
  worstDay: string; worstMove: number; worstRank: number;
  bestDay: string; bestMove: number; bestRank: number;
  qqqWindow: number | null;
  directE: number; directCount: number; directBelowOne: number;
  synE: number; synCount: number; synSettledBelow: number;
  indexE: number; indexCount: number; indexUMax: number; indexUMin: number;
  synGiveBack: number; eqGiveBack: number;
}

/** VOO's window days, each with its size against the year (from any fund read against VOO). */
function vooDays(doc: StudyDocument): WindowDay[] {
  return doc.funds.find((f) => f.readings['VOO'])!.readings['VOO']!.days_in_window;
}

/** The five cards, always on each fund's own benchmark, as published. */
export function studyHero(doc: StudyDocument): StudyHero {
  const s = doc.summaries.named;
  const voo = doc.benchmarks['VOO']!;
  const days = vooDays(doc);
  const worst = days.reduce((a, b) => (b.bench < a.bench ? b : a));
  const best = days.reduce((a, b) => (b.bench > a.bench ? b : a));
  const direct = s['subgroup:direct_stocks']!, syn = s['group:synthetic_long']!, eq = s['group:equity_sleeve']!;
  const index = s['subgroup:index_etf_sleeve']!;
  const rowsOf = (tickers: string[]) =>
    doc.funds.filter((f) => tickers.includes(f.ticker)).map((f) => readingFor(f, 'named').reading);
  const indexU = rowsOf(index.tickers).map((r) => r.u);
  return {
    marketWindow: voo.window.growth - 1,
    windowDays: days.length, upDays: voo.window.up_days, downDays: voo.window.down_days,
    worstDay: worst.date, worstMove: worst.bench, worstRank: worst.rank,
    bestDay: best.date, bestMove: best.bench, bestRank: best.rank,
    qqqWindow: doc.benchmarks['QQQ'] ? doc.benchmarks['QQQ'].window.growth - 1 : null,
    directE: direct.E!.median, directCount: direct.E!.n,
    directBelowOne: rowsOf(direct.tickers).filter((r) => r.u_plus_b < 1).length,
    synE: syn.E!.median, synCount: syn.E!.n, synSettledBelow: syn.E_settled_below_1,
    indexE: index.E!.median, indexCount: index.E!.n, indexUMax: Math.max(...indexU), indexUMin: Math.min(...indexU),
    synGiveBack: syn.window_giveback!.median, eqGiveBack: eq.window_giveback!.median,
  };
}

/** How far U + B runs across the options-based funds, on one basis. */
export function upbRange(doc: StudyDocument, basis: Basis): { n: number; lo: number; hi: number } {
  const v = doc.funds.filter((f) => f.group !== 'reference_only').map((f) => readingFor(f, basis).reading.u_plus_b);
  return { n: v.length, lo: Math.min(...v), hi: Math.max(...v) };
}

/** Each fund in the index-ETF sub-group with its U, highest first. */
export function indexEtfSpread(doc: StudyDocument, basis: Basis): { ticker: string; u: number }[] {
  return doc.funds
    .filter((f) => f.subgroup === 'index_etf_sleeve')
    .map((f) => ({ ticker: f.ticker, u: readingFor(f, basis).reading.u }))
    .sort((a, b) => b.u - a.u);
}

export interface BandFinding {
  synSmall: number; synLarge: number; synWindow: number;
  eqSmall: number; eqLarge: number; eqWindow: number;
  /** Both groups avoided less over the window than on large days generally. */
  lessAgain: boolean;
}

export function bandFinding(doc: StudyDocument, basis: Basis): BandFinding {
  const s = doc.summaries[basis];
  const syn = s['group:synthetic_long']!, eq = s['group:equity_sleeve']!;
  const f = {
    synSmall: syn.bands.small.b!.median, synLarge: syn.bands.large.b!.median, synWindow: syn.window_b!.median,
    eqSmall: eq.bands.small.b!.median, eqLarge: eq.bands.large.b!.median, eqWindow: eq.window_b!.median,
  };
  return { ...f, lessAgain: f.synWindow < f.synLarge && f.eqWindow < f.eqLarge };
}

export interface StripRow {
  day: WindowDay;
  /** The middle fund's share of the day's move in each group, on this basis. */
  eq: Stat | null;
  syn: Stat | null;
}

/**
 * Every window day against VOO, with each group's middle share. Always VOO: on
 * their own benchmarks the funds' days need not even point the same way.
 */
export function windowStrip(doc: StudyDocument): StripRow[] {
  const s = doc.summaries.VOO;
  return vooDays(doc).map((day) => ({
    day,
    eq: s['group:equity_sleeve']!.day_capture[day.date] ?? null,
    syn: s['group:synthetic_long']!.day_capture[day.date] ?? null,
  }));
}
