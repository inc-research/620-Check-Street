// SPDX-License-Identifier: MIT
//
// The one list of what the report measures, shared by all three lenses, so a
// figure cannot mean one thing on the report and another in a comparison.
//
// Pure. Reads a document and decides what is on the table; words and formatting
// belong to the copy deck and the views (INV-5).

import type { Blocker, HorizonName } from '../schema/types.ts';
import { HORIZONS, MIN_OBSERVATIONS_PER_CELL } from '../schema/types.ts';
import type { ReportBenchmark, ReportDocument, ReportHorizon, Side } from './types.ts';

export const MEASURES = [
  'growth_fund',
  'growth_benchmark',
  'fall_fund',
  'fall_benchmark',
  'day_up_benchmark',
  'day_up_fund',
  'day_down_benchmark',
  'day_down_fund',
  'capture_up',
  'loss_buffer',
  'fit',
  'against_down',
  'against_up',
] as const;
export type Measure = (typeof MEASURES)[number];

/** How a value reads: `money` per $100 held, `day` signed per $100, a `ratio`, a `share`. */
export type MeasureKind = 'money' | 'fall' | 'day' | 'ratio' | 'share';
export type MeasureGroup = 'money' | 'days' | 'exposure' | 'follows';

export const MEASURE_KIND: Record<Measure, MeasureKind> = {
  growth_fund: 'money',
  growth_benchmark: 'money',
  fall_fund: 'fall',
  fall_benchmark: 'fall',
  day_up_benchmark: 'day',
  day_up_fund: 'day',
  day_down_benchmark: 'day',
  day_down_fund: 'day',
  capture_up: 'ratio',
  loss_buffer: 'ratio',
  fit: 'share',
  against_down: 'share',
  against_up: 'share',
};

export const MEASURE_GROUP: Record<Measure, MeasureGroup> = {
  growth_fund: 'money',
  growth_benchmark: 'money',
  fall_fund: 'money',
  fall_benchmark: 'money',
  day_up_benchmark: 'days',
  day_up_fund: 'days',
  day_down_benchmark: 'days',
  day_down_fund: 'days',
  capture_up: 'exposure',
  loss_buffer: 'exposure',
  fit: 'follows',
  against_down: 'follows',
  against_up: 'follows',
};

/** Lens C: the benchmark rows are the same on both sides, so they say nothing. */
export const FUND_MEASURES: readonly Measure[] = MEASURES.filter((m) => !m.endsWith('_benchmark'));

/** Lens B keeps the market's growth: two periods differ first of all by what the market did. */
export const PERIOD_MEASURES: readonly Measure[] = MEASURES.filter(
  (m) => m === 'growth_benchmark' || !m.endsWith('_benchmark'),
);

function sideOf(h: ReportHorizon, m: Measure): Side | null {
  if (m === 'day_up_benchmark' || m === 'day_up_fund' || m === 'capture_up' || m === 'against_up') {
    return h.up;
  }
  if (m === 'day_down_benchmark' || m === 'day_down_fund' || m === 'loss_buffer' || m === 'against_down') {
    return h.down;
  }
  return null;
}

/** One minus downside capture. Null stays null. */
export function lossBuffer(downCapture: number | null): number | null {
  return downCapture === null ? null : 1 - downCapture;
}

/** One figure, as stored scaled for reading: dollars per $100, or 0 to 100 for a share. */
export function readMeasure(h: ReportHorizon, m: Measure): number | null {
  const side = sideOf(h, m);
  const hundred = (v: number | null | undefined) => (v === null || v === undefined ? null : 100 * v);
  switch (m) {
    case 'growth_fund': return hundred(h.growth?.fund);
    case 'growth_benchmark': return hundred(h.growth?.benchmark);
    case 'fall_fund': return hundred(h.worst_fall?.fund.depth);
    case 'fall_benchmark': return hundred(h.worst_fall?.benchmark.depth);
    case 'day_up_benchmark':
    case 'day_down_benchmark': return hundred(side?.average_benchmark);
    case 'day_up_fund':
    case 'day_down_fund': return hundred(side?.average_fund);
    case 'capture_up': return side?.capture ?? null;
    // The share of the market's falls the fund did not carry (the 620 Check
    // Street redesign): a downside capture of 0.76 reads as a buffer of 0.24.
    // Above 1 means the fund rose overall on the market's falling days; below 0,
    // that it fell further than the market did.
    case 'loss_buffer': return lossBuffer(side?.capture ?? null);
    case 'fit': return hundred(h.fit?.r_squared);
    case 'against_up':
    case 'against_down': return hundred(side?.against_share);
  }
}

/** Resting on fewer days than the report asks for (3F D-07). Only one-sided figures can be. */
export function isThin(h: ReportHorizon, m: Measure): boolean {
  const side = sideOf(h, m);
  return side !== null && side.days < MIN_OBSERVATIONS_PER_CELL;
}

export function daysBehind(h: ReportHorizon, m: Measure): number {
  return sideOf(h, m)?.days ?? h.days_total;
}

export function blockersFor(h: ReportHorizon, m: Measure): readonly Blocker[] {
  if (m === 'fit') return h.fit?.blockers ?? h.blockers;
  return sideOf(h, m)?.blockers ?? h.blockers;
}

export interface ReportCell {
  horizon: HorizonName;
  value: number | null;
  thin: boolean;
  days: number;
  blockers: readonly Blocker[];
}

export interface ReportRow {
  measure: Measure;
  group: MeasureGroup;
  kind: MeasureKind;
  cells: ReportCell[];
}

export interface ReportTable {
  ticker: string;
  benchmark: string;
  asOf: string;
  rows: ReportRow[];
  /** The longest window that computed: what the per-1% sentence speaks about. */
  lead: {
    horizon: HorizonName;
    captureUp: number | null;
    /** One minus downside capture (see `lossBuffer`). */
    lossBuffer: number | null;
    fit: number | null;
    /** Below the document's floor, the sentence is replaced rather than qualified. */
    lowFit: boolean;
  } | null;
  blockedHorizons: { horizon: HorizonName; blockers: readonly Blocker[] }[];
}

export function columnOf(block: ReportBenchmark, horizon: HorizonName): ReportHorizon | undefined {
  return block.horizons.find((h) => h.horizon === horizon);
}

export function buildReportTable(report: ReportDocument, benchmark: string): ReportTable {
  const block = report.benchmarks[benchmark];
  if (!block) throw new Error(`${report.ticker} carries no reading against ${benchmark}.`);

  const rows: ReportRow[] = MEASURES.map((measure) => ({
    measure,
    group: MEASURE_GROUP[measure],
    kind: MEASURE_KIND[measure],
    cells: HORIZONS.map((horizon) => {
      const h = columnOf(block, horizon);
      return {
        horizon,
        value: h ? readMeasure(h, measure) : null,
        thin: h ? isThin(h, measure) : false,
        days: h ? daysBehind(h, measure) : 0,
        blockers: h ? blockersFor(h, measure) : [],
      };
    }),
  }));

  const led = block.horizons.find((h) => h.growth !== null);
  const r2 = led?.fit?.r_squared ?? null;

  return {
    ticker: report.ticker,
    benchmark,
    asOf: report.as_of,
    rows,
    lead: led
      ? {
          horizon: led.horizon,
          captureUp: led.up?.capture ?? null,
          lossBuffer: lossBuffer(led.down?.capture ?? null),
          fit: r2,
          lowFit: r2 === null || r2 < report.methodology.low_fit_r_squared,
        }
      : null,
    blockedHorizons: block.horizons
      .filter((h) => h.growth === null)
      .map((h) => ({ horizon: h.horizon, blockers: h.blockers })),
  };
}
