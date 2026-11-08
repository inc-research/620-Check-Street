// SPDX-License-Identifier: MIT
//
// Capture across real month-end reports. As with Lens B, what must not be shown
// matters as much as the arithmetic.

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  TREND_BANDS,
  buildCaptureTrend,
  trendColumns,
  trendMonths,
} from '../src/captureTrend.ts';
import type { ReportDocument, ReportHorizon } from '../src/report/types.ts';
import type { HorizonName } from '../src/schema/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const load = (name: string): ReportDocument =>
  JSON.parse(readFileSync(join(root, 'fixtures', name), 'utf8')) as ReportDocument;

const base = load('report_computed.json'); // 2026-07, carrying VOO and IWM

const col = (doc: ReportDocument, h: HorizonName = '13wk'): ReportHorizon =>
  doc.benchmarks['VOO']!.horizons.find((x) => x.horizon === h)!;

function at(month: string, up: number, down: number, h: HorizonName = '13wk'): ReportDocument {
  const doc = structuredClone(base);
  doc.as_of = `${month}-28`;
  const c = col(doc, h);
  c.up!.capture = up;
  c.down!.capture = down;
  return doc;
}

const archive = (...docs: ReportDocument[]): Map<string, ReportDocument> =>
  new Map(docs.map((d) => [d.as_of.slice(0, 7), d]));

const full = (up: number, down: number) =>
  archive(
    at('2026-06', up, down), at('2026-05', up, down), at('2026-04', up, down),
    at('2026-03', up, down), at('2026-02', up, down), at('2026-01', up, down),
  );

test('the months wanted run back from the one before, across a year end', () => {
  deepStrictEqual(trendMonths('2026-02'), ['2026-01', '2025-12', '2025-11', '2025-10', '2025-09', '2025-08']);
});

test('the month’s change is a percentage of the earlier reading', () => {
  const t = buildCaptureTrend(at('2026-07', 0.6, 0.45), full(0.5, 0.5), 'VOO', '13wk');
  deepStrictEqual(t.refusals, []);
  const [up, down] = t.legs;
  strictEqual(up!.previous.then.value, 0.5);
  ok(Math.abs(up!.previous.percent! - 20) < 1e-9);
  ok(Math.abs(down!.previous.percent! + 10) < 1e-9);
  strictEqual(up!.previous.percentAbsence, null);
});

test('a percentage on a falling negative reading is negative, agreeing with the direction', () => {
  const t = buildCaptureTrend(at('2026-07', -0.3, 0.5), full(-0.15, 0.5), 'VOO', '13wk');
  const up = t.legs[0]!;
  ok(up.previous.percent! < 0);
  ok(Math.abs(up.previous.percent! + 100) < 1e-9);
  strictEqual(up.back[0]!.direction, 'lower');
});

test('a small base gives no percentage, but keeps the change and both levels', () => {
  const t = buildCaptureTrend(at('2026-07', 0.09, 0.5), full(0.05, 0.5), 'VOO', '13wk');
  const step = t.legs[0]!.previous;
  strictEqual(step.percent, null);
  strictEqual(step.percentAbsence, 'small_base');
  ok(Math.abs(step.change! - 0.04) < 1e-12);
  strictEqual(t.legs[0]!.now.value, 0.09);
  strictEqual(step.then.value, 0.05);
});

test('a reading exactly at the small base still gets its percentage', () => {
  const t = buildCaptureTrend(at('2026-07', 0.2, 0.5), full(0.1, 0.5), 'VOO', '13wk');
  ok(Math.abs(t.legs[0]!.previous.percent! - 100) < 1e-9);
});

test('a change of sign gives no percentage', () => {
  const t = buildCaptureTrend(at('2026-07', -0.2, 0.5), full(0.3, 0.5), 'VOO', '13wk');
  const step = t.legs[0]!.previous;
  strictEqual(step.percent, null);
  strictEqual(step.percentAbsence, 'sign_changed');
});

test('a direction needs the change to clear the band, on either side', () => {
  const band = TREND_BANDS['13wk'][3];
  const dir = (now: number, then: number) => {
    const earlier = full(then, 0.5);
    return buildCaptureTrend(at('2026-07', now, 0.5), earlier, 'VOO', '13wk').legs[0]!.back[0]!.direction;
  };
  strictEqual(dir(0.5 + band / 2, 0.5), 'about_the_same');
  strictEqual(dir(0.5 + band + 0.001, 0.5), 'higher');
  strictEqual(dir(0.5 - band - 0.001, 0.5), 'lower');
  strictEqual(dir(0.75, 0.5), 'higher');
});

test('each lookback and each window has its own band', () => {
  const t = buildCaptureTrend(at('2026-07', 0.5, 0.5, '12mo'), new Map(), 'VOO', '12mo');
  deepStrictEqual(t.legs[0]!.back.map((b) => b.band), [TREND_BANDS['12mo'][3], TREND_BANDS['12mo'][6]]);
  ok(TREND_BANDS['13wk'][6] > TREND_BANDS['12mo'][6]);
});

test('a missing month is a dash with a reason, and no other month stands in', () => {
  const earlier = full(0.5, 0.5);
  earlier.delete('2026-04');
  const t = buildCaptureTrend(at('2026-07', 0.5, 0.5), earlier, 'VOO', '13wk');
  const three = t.legs[0]!.back[0]!;
  strictEqual(three.month, '2026-04');
  strictEqual(three.then.value, null);
  strictEqual(three.change, null);
  strictEqual(three.direction, null);
  strictEqual(three.then.blockers[0]!.code, 'trend_month_missing');
  // The rest of the section is untouched.
  strictEqual(t.legs[0]!.back[1]!.direction, 'about_the_same');
  strictEqual(t.market.back[0]!.value, null);
});

test('a young fund reads its one month and has nothing further back', () => {
  const t = buildCaptureTrend(at('2026-07', 0.6, 0.5), archive(at('2026-06', 0.5, 0.5)), 'VOO', '13wk');
  ok(t.legs[0]!.previous.percent !== null);
  deepStrictEqual(t.legs[0]!.back.map((b) => b.direction), [null, null]);
});

test('a report of another major version is refused for that month', () => {
  const old = at('2026-06', 0.5, 0.5);
  old.report_schema_version = '0.9';
  const t = buildCaptureTrend(at('2026-07', 0.6, 0.5), archive(old), 'VOO', '13wk');
  strictEqual(t.legs[0]!.previous.percent, null);
  strictEqual(t.legs[0]!.previous.then.blockers[0]!.code, 'report_version_mismatch');
});

test('an earlier month below the fit floor is not used', () => {
  const low = at('2026-06', 0.5, 0.5);
  col(low).fit!.r_squared = 0.1;
  const t = buildCaptureTrend(at('2026-07', 0.6, 0.5), archive(low), 'VOO', '13wk');
  strictEqual(t.legs[0]!.previous.then.value, null);
  strictEqual(t.legs[0]!.previous.then.blockers[0]!.code, 'trend_low_fit');
});

test('the current month below the fit floor replaces the section', () => {
  const low = at('2026-07', 0.5, 0.5);
  col(low).fit!.r_squared = 0.1;
  const t = buildCaptureTrend(low, full(0.5, 0.5), 'VOO', '13wk');
  strictEqual(t.lowFit?.share, 0.1);
  deepStrictEqual(t.legs, []);
  deepStrictEqual(t.run, []);
});

test('a blocked window is refused, not drawn as noughts', () => {
  const t = buildCaptureTrend(load('report_blocked.json'), new Map(), 'VOO', '12mo');
  strictEqual(t.refusals[0]!.code, 'trend_window_blocked');
  deepStrictEqual(t.legs, []);
});

test('a side with too few days is null, never zero', () => {
  const doc = at('2026-07', 0.5, 0.5);
  col(doc).up!.capture = null;
  col(doc).up!.blockers = [{ code: 'x', message: 'm', remedy: 'r', subjects: [] }];
  const t = buildCaptureTrend(doc, full(0.5, 0.5), 'VOO', '13wk');
  strictEqual(t.legs[0]!.now.value, null);
  strictEqual(t.legs[0]!.previous.percent, null);
  strictEqual(t.legs[0]!.now.blockers[0]!.code, 'x');
});

test('the thin marker carries through with its day count', () => {
  const doc = at('2026-07', 0.5, 0.5);
  col(doc).up!.days = 12;
  const now = buildCaptureTrend(doc, full(0.5, 0.5), 'VOO', '13wk').legs[0]!.now;
  strictEqual(now.thin, true);
  strictEqual(now.days, 12);
});

test('the run shows six months, each with a percentage from the month before', () => {
  const t = buildCaptureTrend(at('2026-07', 0.6, 0.5), full(0.5, 0.5), 'VOO', '13wk');
  deepStrictEqual(t.run.map((r) => r.month), [
    '2026-07', '2026-06', '2026-05', '2026-04', '2026-03', '2026-02',
  ]);
  ok(Math.abs(t.run[0]!.upPercent.percent! - 20) < 1e-9);
  strictEqual(t.run[5]!.upPercent.percent, 0);
  strictEqual(t.run[5]!.upPercent.month, '2026-01');
});

test('the market’s own result comes with every reading', () => {
  const t = buildCaptureTrend(at('2026-07', 0.5, 0.5), full(0.5, 0.5), 'VOO', '13wk');
  const expected = 100 * col(base).growth!.benchmark;
  strictEqual(t.market.now, expected);
  strictEqual(t.market.previous, expected);
});

test('only windows that computed are offered', () => {
  deepStrictEqual(trendColumns(base, 'VOO'), ['13wk', '6mo', '12mo']);
  const blocked = load('report_blocked.json');
  deepStrictEqual(trendColumns(blocked, Object.keys(blocked.benchmarks)[0]!), ['13wk']);
  deepStrictEqual(trendColumns(base, 'NOPE'), []);
});

test('the archive engine reads downside capture; the page asks for the loss buffer', () => {
  const months = full(0.5, 0.7);
  const asCapture = buildCaptureTrend(at('2026-07', 0.5, 0.7), months, 'VOO', '13wk');
  const asBuffer = buildCaptureTrend(at('2026-07', 0.5, 0.7), months, 'VOO', '13wk', 'loss_buffer');
  const down = (t: typeof asCapture) => t.legs.find((l) => l.side === 'down')!;
  ok(Math.abs(down(asCapture).now.value! - 0.7) < 1e-12);
  ok(Math.abs(down(asBuffer).now.value! - 0.3) < 1e-12);
  // The up side is the same either way.
  strictEqual(asBuffer.legs[0]!.now.value, asCapture.legs[0]!.now.value);
});
