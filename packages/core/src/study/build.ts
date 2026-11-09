// SPDX-License-Identifier: MIT
//
// Everything a selected report's page needs that is a choice about the document
// rather than a layout: the order of rows, which figure leads each card, the range
// a sub-group spans. Selections and orderings only; every number is read from the
// document as published (INV-5).

import type { Basis, BandKey, GroupKey, StudyDocument, StudyFund, StudyReading, SubgroupKey } from './types.ts';
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
  marketFall: number;
  marketDays: number;
  marketRank: number;
  qqqFall: number | null;
  directE: number; directCount: number; directBelowOne: number;
  synE: number; synCount: number; synSettledBelow: number;
  indexE: number; indexCount: number; indexUMax: number; indexUMin: number;
  synGiveBack: number; eqGiveBack: number;
}

/** The five cards, always on each fund's own benchmark, as published. */
export function studyHero(doc: StudyDocument): StudyHero {
  const s = doc.summaries.named;
  const nov5 = doc.special_days[1];
  const anyVoo = doc.funds.find((f) => f.readings['VOO'])!.readings['VOO']!;
  const direct = s['subgroup:direct_stocks']!, syn = s['group:synthetic_long']!, eq = s['group:equity_sleeve']!;
  const index = s['subgroup:index_etf_sleeve']!;
  const rowsOf = (tickers: string[]) =>
    doc.funds.filter((f) => tickers.includes(f.ticker)).map((f) => readingFor(f, 'named').reading);
  const indexU = rowsOf(index.tickers).map((r) => r.u);
  return {
    marketFall: doc.benchmarks['VOO']!.moves[nov5]!,
    marketDays: anyVoo.nov5.of,
    marketRank: anyVoo.nov5.rank,
    qqqFall: doc.benchmarks['QQQ']?.moves[nov5] ?? null,
    directE: direct.E!.median, directCount: direct.E!.n,
    directBelowOne: rowsOf(direct.tickers).filter((r) => r.u_plus_b < 1).length,
    synE: syn.E!.median, synCount: syn.E!.n, synSettledBelow: syn.E_settled_below_1,
    indexE: index.E!.median, indexCount: index.E!.n, indexUMax: Math.max(...indexU), indexUMin: Math.min(...indexU),
    synGiveBack: syn.nov5_takeback_ratio!.median, eqGiveBack: eq.nov5_takeback_ratio!.median,
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
  synSmall: number; synLarge: number; synNov5: number;
  eqSmall: number; eqLarge: number; eqNov5: number;
  /** Both groups avoided less on 5 November than on large days generally. */
  lessAgain: boolean;
}

export function bandFinding(doc: StudyDocument, basis: Basis): BandFinding {
  const s = doc.summaries[basis];
  const syn = s['group:synthetic_long']!, eq = s['group:equity_sleeve']!;
  const f = {
    synSmall: syn.bands.small.b!.median, synLarge: syn.bands.large.b!.median, synNov5: syn.nov5_day_buffer!.median,
    eqSmall: eq.bands.small.b!.median, eqLarge: eq.bands.large.b!.median, eqNov5: eq.nov5_day_buffer!.median,
  };
  return { ...f, lessAgain: f.synNov5 < f.synLarge && f.eqNov5 < f.eqLarge };
}
