// SPDX-License-Identifier: MIT
//
// Net capture, month by month: how each side of it has moved (3F D-20).
//
// Reads one window length across real month-end reports, so the only thing that
// differs between two readings is the date. The same days can sit in both
// readings: a thirteen-week window a month apart shares about two thirds of them.
// That is why a month's change is shown as a size beside its two levels, and only
// the longer lookbacks are given a direction.
//
// Each side, never the gap between them. Changes in up-minus-down could not be
// told from the same days dealt out at random, while each side's change can, and
// the two sides mostly move together (analysis/capture_trend.py).
//
// No dot, as in Lens B (3F D-17), and nothing here says why a reading moved: two
// months are different stretches of market, so the market's own result travels
// with the row.
//
// Pure. No I/O; the caller fetches the documents, and a month it could not fetch
// is simply missing from the map.

import { BLOCKERS } from './diagnostics.ts';
import { major, monthsBack } from './lensB.ts';
import { blockersFor, columnOf, daysBehind, isThin, readMeasure } from './report/measures.ts';
import type { ReportDocument, ReportHorizon } from './report/types.ts';
import type { Blocker, HorizonName } from './schema/types.ts';

/** The window the section opens on: closest to the current market, and still readable. */
export const DEFAULT_TREND_COLUMN: HorizonName = '13wk';

/** How the chooser lists them, shortest first because that is what it opens on. */
export const TREND_COLUMNS: readonly HorizonName[] = ['13wk', '6mo', '12mo'];

export type TrendLookback = 3 | 6;
export const TREND_LOOKBACKS: readonly TrendLookback[] = [3, 6];

/** How many months the month-by-month run shows. Each needs the one before it. */
export const TREND_RUN_MONTHS = 6;

/**
 * Inside this, two readings are "about the same".
 *
 * The median, across fund-months, of the 95th percentile of the change when the
 * same days are dealt into the two windows at random by the week, rounded up to
 * the two decimals the page prints (analysis/capture_trend.py, 3F D-20). A flat
 * figure is a blunt instrument, and beyond it a reading can still be chance: 27%
 * to 41% of real changes clear these and 5% to 18% of shuffled ones do.
 */
export const TREND_BANDS: Record<HorizonName, Record<TrendLookback, number>> = {
  '12mo': { 3: 0.04, 6: 0.06 },
  '6mo': { 3: 0.08, 6: 0.11 },
  '13wk': { 3: 0.13, 6: 0.14 },
};

/** Below this, a percentage is a large number made from a small denominator. */
export const TREND_SMALL_BASE = 0.1;

export type TrendSide = 'up' | 'down';
export type TrendDirection = 'higher' | 'lower' | 'about_the_same';
/** Why a change that exists is not given as a percentage. */
export type PercentAbsence = 'small_base' | 'sign_changed';

export interface TrendReading {
  value: number | null;
  thin: boolean;
  days: number;
  blockers: readonly Blocker[];
}

export interface TrendPoint {
  month: string;
  up: TrendReading;
  down: TrendReading;
  /** What $100 in the market became over this same window. */
  market: number | null;
  windowStart: string | null;
  windowEnd: string | null;
}

export interface TrendStep {
  month: string;
  then: TrendReading;
  /** Null where either side is missing, never a zero (INV-2). */
  change: number | null;
  /** Percent of the earlier reading's size, so its sign is the change's sign. */
  percent: number | null;
  percentAbsence: PercentAbsence | null;
}

export interface TrendComparison extends TrendStep {
  lookback: TrendLookback;
  band: number;
  direction: TrendDirection | null;
}

export interface TrendLeg {
  side: TrendSide;
  now: TrendReading;
  previous: TrendStep;
  back: TrendComparison[];
}

export interface TrendRunRow {
  month: string;
  up: TrendReading;
  upPercent: TrendStep;
  down: TrendReading;
  downPercent: TrendStep;
  market: number | null;
}

export interface CaptureTrend {
  ticker: string;
  benchmark: string;
  column: HorizonName;
  month: string;
  previousMonth: string;
  legs: TrendLeg[];
  market: {
    now: number | null;
    previous: number | null;
    back: { lookback: TrendLookback; month: string; value: number | null }[];
  };
  /** Newest first. */
  run: TrendRunRow[];
  /** Set when the benchmark explains too little for these figures to describe the fund. */
  lowFit: { share: number | null } | null;
  /** Non-empty means the current month itself cannot be read: nothing else is drawn. */
  refusals: readonly Blocker[];
}

/** The months this month's section wants beside it, newest first. */
export function trendMonths(month: string): string[] {
  return Array.from({ length: TREND_RUN_MONTHS }, (_, i) => monthsBack(month, i + 1));
}

/** The windows worth offering for this report: a chooser leading nowhere is no choice. */
export function trendColumns(report: ReportDocument, benchmark: string): HorizonName[] {
  const block = report.benchmarks[benchmark];
  if (!block) return [];
  return TREND_COLUMNS.filter((h) => columnOf(block, h)?.growth != null);
}

const NOTHING: TrendReading = { value: null, thin: false, days: 0, blockers: [] };

function isLowFit(column: ReportHorizon, floor: number): boolean {
  const r2 = column.fit?.r_squared ?? null;
  return r2 === null || r2 < floor;
}

function pointFor(
  month: string,
  doc: ReportDocument | undefined,
  current: ReportDocument,
  benchmark: string,
  columnName: HorizonName,
): TrendPoint {
  const missing = (blocker: Blocker): TrendPoint => {
    const blocked = { ...NOTHING, blockers: [blocker] };
    return { month, up: blocked, down: blocked, market: null, windowStart: null, windowEnd: null };
  };

  if (!doc) return missing(BLOCKERS.trendMonthMissing(current.ticker, month));
  if (major(doc.report_schema_version) !== major(current.report_schema_version)) {
    return missing(
      BLOCKERS.reportVersionMismatch(doc.report_schema_version, current.report_schema_version),
    );
  }
  const block = doc.benchmarks[benchmark];
  if (!block) return missing(BLOCKERS.benchmarkNotInBothReports(doc.ticker, benchmark, month));
  const column = columnOf(block, columnName);
  if (!column || column.growth === null) {
    return missing(
      BLOCKERS.periodNotComparable(month, column?.blockers[0]?.message ?? ''),
    );
  }
  if (isLowFit(column, doc.methodology.low_fit_r_squared)) {
    return missing(BLOCKERS.trendLowFit(month, benchmark));
  }

  const reading = (measure: 'capture_up' | 'capture_down'): TrendReading => {
    const value = readMeasure(column, measure);
    return {
      value,
      thin: value !== null && isThin(column, measure),
      days: daysBehind(column, measure),
      blockers: value === null ? blockersFor(column, measure) : [],
    };
  };

  return {
    month,
    up: reading('capture_up'),
    down: reading('capture_down'),
    market: readMeasure(column, 'growth_benchmark'),
    windowStart: column.window_start,
    windowEnd: column.window_end,
  };
}

function stepFrom(now: TrendReading, then: TrendReading, month: string): TrendStep {
  if (now.value === null || then.value === null) {
    return { month, then, change: null, percent: null, percentAbsence: null };
  }
  const change = now.value - then.value;
  if (Math.abs(then.value) < TREND_SMALL_BASE) {
    return { month, then, change, percent: null, percentAbsence: 'small_base' };
  }
  if (now.value * then.value < 0) {
    return { month, then, change, percent: null, percentAbsence: 'sign_changed' };
  }
  // Over the earlier reading's size: dividing by a negative one would print a
  // fall as a rise, against the direction word in the next cell.
  return {
    month,
    then,
    change,
    percent: (100 * change) / Math.abs(then.value),
    percentAbsence: null,
  };
}

function compare(
  now: TrendReading,
  then: TrendReading,
  month: string,
  lookback: TrendLookback,
  band: number,
): TrendComparison {
  const step = stepFrom(now, then, month);
  const direction: TrendDirection | null =
    step.change === null
      ? null
      : step.change > band
        ? 'higher'
        : step.change < -band
          ? 'lower'
          : 'about_the_same';
  return { ...step, lookback, band, direction };
}

/**
 * Read a fund's capture across its recent reports.
 *
 * Only exact calendar months count. A month that is missing or cannot be read
 * leaves a dash with its reason; the nearest other month is not put in its place,
 * because the row would then say a span it does not cover.
 */
export function buildCaptureTrend(
  current: ReportDocument,
  earlier: ReadonlyMap<string, ReportDocument>,
  benchmark: string,
  column: HorizonName,
): CaptureTrend {
  const month = current.as_of.slice(0, 7);
  const previousMonth = monthsBack(month, 1);
  const point = (m: string, doc: ReportDocument | undefined) =>
    pointFor(m, doc, current, benchmark, column);

  const empty: CaptureTrend = {
    ticker: current.ticker,
    benchmark,
    column,
    month,
    previousMonth,
    legs: [],
    market: { now: null, previous: null, back: [] },
    run: [],
    lowFit: null,
    refusals: [],
  };

  const block = current.benchmarks[benchmark];
  if (!block) {
    return {
      ...empty,
      refusals: [BLOCKERS.benchmarkNotInBothReports(current.ticker, benchmark, month)],
    };
  }
  const col = columnOf(block, column);
  if (!col || col.growth === null) {
    return {
      ...empty,
      refusals: [BLOCKERS.trendWindowBlocked(month, col?.blockers[0]?.message ?? '')],
    };
  }
  if (isLowFit(col, current.methodology.low_fit_r_squared)) {
    return { ...empty, lowFit: { share: col.fit?.r_squared ?? null } };
  }

  const now = point(month, current);
  const previous = point(previousMonth, earlier.get(previousMonth));
  const backPoints = TREND_LOOKBACKS.map((lookback) => {
    const m = monthsBack(month, lookback);
    return { lookback, month: m, point: point(m, earlier.get(m)) };
  });

  const leg = (side: TrendSide): TrendLeg => ({
    side,
    now: now[side],
    previous: stepFrom(now[side], previous[side], previousMonth),
    back: backPoints.map((b) =>
      compare(now[side], b.point[side], b.month, b.lookback, TREND_BANDS[column][b.lookback]),
    ),
  });

  // Every row keeps its own percentage, so the run needs one month more than it
  // shows.
  const points = [month, ...trendMonths(month)].map((m) =>
    m === month ? now : point(m, earlier.get(m)),
  );
  const run: TrendRunRow[] = points.slice(0, TREND_RUN_MONTHS).map((p, i) => {
    const before = points[i + 1]!;
    return {
      month: p.month,
      up: p.up,
      upPercent: stepFrom(p.up, before.up, before.month),
      down: p.down,
      downPercent: stepFrom(p.down, before.down, before.month),
      market: p.market,
    };
  });

  return {
    ...empty,
    legs: [leg('up'), leg('down')],
    market: {
      now: now.market,
      previous: previous.market,
      back: backPoints.map((b) => ({ lookback: b.lookback, month: b.month, value: b.point.market })),
    },
    run,
  };
}
