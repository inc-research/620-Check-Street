// SPDX-License-Identifier: MIT
//
// After an adviser's fee and inflation (3F D-23). Golden values worked by hand.

import { ok, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import type { FeeDocument, RateSeries } from '../src/report/real.ts';
import { billGrowth, costsTaken, inflationOver, realReading } from '../src/report/real.ts';
import type { ReportHorizon } from '../src/report/types.ts';

const close = (a: number, b: number, tol = 1e-9) =>
  ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

function series(id: 'CPIAUCNS' | 'DGS3MO', observations: [string, number][]): RateSeries {
  return {
    app: 'Third Floor',
    rates_schema_version: '1.0',
    series_id: id,
    title: id,
    units: '',
    frequency: id === 'CPIAUCNS' ? 'monthly' : 'daily',
    source: 'fred_api',
    source_url: '',
    fetched_at: '2026-11-08T00:00:00Z',
    missing_days_dropped: 0,
    observations,
  };
}

// Prices up exactly 3% from October to October, with September 2025 on the
// way and no figure at all for November 2025.
const cpi = series('CPIAUCNS', [
  ['2025-09-01', 99],
  ['2025-10-01', 100],
  ['2025-12-01', 101],
  ['2026-09-01', 102],
  ['2026-10-01', 103],
]);

// A flat 4% a year, published once at the start.
const flatBills = series('DGS3MO', [
  ['2025-10-01', 4],
  ['2026-10-30', 4],
]);

function horizon(over: Partial<ReportHorizon> = {}): ReportHorizon {
  return {
    horizon: '12mo',
    window_start: '2025-10-30',
    window_end: '2026-10-30',
    first_day: '2025-10-30',
    days_total: 252,
    market_up_days: 130,
    market_down_days: 120,
    market_flat_days: 2,
    growth: { fund: 1.1, benchmark: 1.2 },
    up: null,
    down: null,
    worst_fall: null,
    fit: null,
    blockers: [],
    ...over,
  };
}

function fees(net: number): FeeDocument {
  return {
    app: 'Third Floor',
    fees_schema_version: '1.0',
    ticker: 'X',
    role: 'fund',
    month: '2026-10',
    as_of: '2026-10-30',
    generated_at: '',
    already_in_returns: true,
    effective_date_note: '',
    fees: {
      management: net, distribution_12b1: 0, other: 0, acquired_funds: 0,
      gross: net, waiver: 0, net,
      source: { kind: 'sec_xbrl', form: '485BPOS', filed: '2026-01-01', accession: null, url: '', series_id: null, class_id: null, note: null },
    },
    blockers: [],
  };
}

const YEARS = 365 / 365.25;

test('inflation is the ratio of the two months’ price levels', () => {
  const i = inflationOver(cpi, '2025-10-30', '2026-10-30')!;
  close(i.ratio, 1.03);
  strictEqual(i.provisional, false);
  strictEqual(i.estimated.length, 0);
});

test('a month with no figure yet borrows the latest one and says so', () => {
  const i = inflationOver(cpi, '2025-10-30', '2026-11-30')!;
  strictEqual(i.endUsed, '2026-10');
  strictEqual(i.endMonth, '2026-11');
  strictEqual(i.provisional, true);
  close(i.ratio, 1.03);
});

test('a month never published sits geometrically between its neighbours', () => {
  const i = inflationOver(cpi, '2025-11-28', '2026-10-30')!;
  // Halfway in growth terms between 100 and 101.
  close(i.ratio, 103 / Math.sqrt(100 * 101));
  strictEqual(i.estimated[0], '2025-11');
});

test('a window before the first published month cannot be shown', () => {
  strictEqual(inflationOver(cpi, '2024-01-31', '2026-10-30'), null);
});

test('bills compound each published yield until the next one', () => {
  const b = billGrowth(flatBills, '2025-10-30', '2026-10-30')!;
  close(b.growth, Math.pow(1.04, 365 / 365));
  strictEqual(b.provisional, false);

  const stepped = series('DGS3MO', [
    ['2026-01-01', 5],
    ['2026-01-11', 3],
  ]);
  const g = billGrowth(stepped, '2026-01-01', '2026-01-21')!;
  close(g.growth, Math.pow(1.05, 10 / 365) * Math.pow(1.03, 10 / 365));
  strictEqual(g.provisional, true); // the last reading is ten days before the end
});

test('with no adviser fee and no inflation, nothing changes', () => {
  const flatPrices = series('CPIAUCNS', [['2025-10-01', 100], ['2026-10-01', 100]]);
  const r = realReading({ horizon: horizon(), cpi: flatPrices, bills: flatBills, fundFees: null, marketFees: null, adviser: false });
  strictEqual(r.kind, 'computed');
  if (r.kind !== 'computed') return;
  close(r.reading.fund.nominal, 110);
  close(r.reading.fund.real, 110);
  close(r.reading.market.real, 120);
  strictEqual(r.reading.fundCosts, null);
});

test('the adviser fee is charged on fund, market and bills alike, then inflation', () => {
  const r = realReading({ horizon: horizon(), cpi, bills: flatBills, fundFees: null, marketFees: null, adviser: true });
  if (r.kind !== 'computed') throw new Error('blocked');
  const keep = Math.pow(0.99, YEARS);
  close(r.reading.fund.nominal, 110 * keep);
  close(r.reading.fund.real, (110 * keep) / 1.03);
  close(r.reading.market.real, (120 * keep) / 1.03);
  close(r.reading.bills.real, (100 * 1.04 * keep) / 1.03);
  strictEqual(r.reading.adviserFee, 0.01);
});

test('the fund’s own costs are reported, never taken from the result', () => {
  const without = realReading({ horizon: horizon(), cpi, bills: flatBills, fundFees: null, marketFees: null, adviser: false });
  const withFees = realReading({ horizon: horizon(), cpi, bills: flatBills, fundFees: fees(0.0095), marketFees: fees(0.0003), adviser: false });
  if (without.kind !== 'computed' || withFees.kind !== 'computed') throw new Error('blocked');
  strictEqual(withFees.reading.fund.real, without.reading.fund.real);
  close(withFees.reading.fundCosts!, 110 * (Math.pow(1 - 0.0095, -YEARS) - 1));
  close(withFees.reading.marketCosts!, 120 * (Math.pow(1 - 0.0003, -YEARS) - 1));
  close(costsTaken(1.1, 0, 1), 0);
});

test('a blocked window stays blocked, with its own reason', () => {
  const reason = { code: 'window_not_covered', message: 'm', remedy: 'r' };
  const r = realReading({ horizon: horizon({ growth: null, blockers: [reason] }), cpi, bills: flatBills, fundFees: null, marketFees: null, adviser: true });
  strictEqual(r.kind, 'blocked');
  if (r.kind === 'blocked') strictEqual(r.blockers[0]!.code, 'window_not_covered');
});

test('a window the rate series do not reach is blocked rather than guessed', () => {
  const r = realReading({ horizon: horizon({ window_start: '2024-01-31' }), cpi, bills: flatBills, fundFees: null, marketFees: null, adviser: true });
  strictEqual(r.kind, 'blocked');
  if (r.kind === 'blocked') strictEqual(r.blockers[0]!.code, 'rates_not_covered');
});
