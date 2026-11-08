// SPDX-License-Identifier: MIT
//
// Lens B: two real reports, one reading. The refusals matter as much as the
// arithmetic — a comparison that should not be made must not be made quietly.

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  LOOKBACK_COLUMN,
  archivedMonthFor,
  buildLensB,
  canCompare,
  monthsBack,
} from '../src/lensB.ts';
import { PERIOD_MEASURES } from '../src/report/measures.ts';
import type { ReportDocument, ReportHorizon } from '../src/report/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const load = (name: string): ReportDocument =>
  JSON.parse(readFileSync(join(root, 'fixtures', name), 'utf8')) as ReportDocument;

const now = load('report_computed.json');

/** The same fixture shifted back in time, standing in for an archived report. */
function past(month: string, mutate: (s: ReportDocument) => void = () => {}): ReportDocument {
  const doc = structuredClone(now);
  doc.as_of = `${month}-31`;
  mutate(doc);
  return doc;
}

test('stepping back months crosses year boundaries', () => {
  strictEqual(monthsBack('2026-07', 6), '2026-01');
  strictEqual(monthsBack('2026-01', 6), '2025-07');
  strictEqual(monthsBack('2026-02', 3), '2025-11');
  strictEqual(monthsBack('2026-01', 1), '2025-12');
  strictEqual(monthsBack('2026-12', 12), '2025-12');
});

test('each lookback reads the column that makes its windows disjoint', () => {
  // 3F-O-03: comparing the 12-month column across a six-month gap would
  // re-measure half the same days and call the result a change.
  strictEqual(LOOKBACK_COLUMN['6mo'], '6mo');
  strictEqual(LOOKBACK_COLUMN['13wk'], '13wk');
  strictEqual(archivedMonthFor('2026-07', '6mo'), '2026-01');
  strictEqual(archivedMonthFor('2026-07', '13wk'), '2026-04');
});

const six = (doc: ReportDocument): ReportHorizon =>
  doc.benchmarks['VOO']!.horizons.find((h) => h.horizon === '6mo')!;

test('a comparable pair yields a signed change per row', () => {
  const table = buildLensB(now, past('2026-01'), 'VOO', '6mo');
  deepStrictEqual(table.refusals, []);
  deepStrictEqual(table.rows.map((r) => r.measure), [...PERIOD_MEASURES]);

  // Compared against itself, every reading holds steady.
  for (const row of table.rows) {
    ok(row.now !== null && row.then !== null);
    strictEqual(row.change, 0);
  }
});

test('the change is signed, because the direction is the finding', () => {
  // Downside capture 2.0 then is a loss buffer of -1.0: the fund lost twice the market.
  const before = past('2026-01', (s) => {
    six(s).down!.capture = 2.0;
  });
  const row = buildLensB(now, before, 'VOO', '6mo').rows.find((r) => r.measure === 'loss_buffer')!;
  strictEqual(row.then, 1 - 2.0);
  ok(row.now !== null && row.change !== null);
  strictEqual(row.change, row.now - (1 - 2.0));
  ok(row.change > 0, 'the fund now loses less of each fall than it did, so its buffer rose');
});

test('no row carries a marker: this lens draws no dot at all', () => {
  const before = past('2026-01', (s) => {
    six(s).down!.capture = 5.0;
  });
  for (const row of buildLensB(now, before, 'VOO', '6mo').rows) {
    ok(!('changed' in row), `${row.measure} carries a marker`);
  }
});

test('the market’s growth stays, and its other rows do not', () => {
  // Two periods differ first of all by what the market did, so its growth has
  // to be beside the fund’s for a change in the fund’s to be read at all.
  const measures = buildLensB(now, past('2026-01'), 'VOO', '6mo').rows.map((r) => r.measure);
  ok(measures.includes('growth_benchmark'));
  ok(!measures.includes('fall_benchmark'));
  ok(!measures.includes('day_up_benchmark'));
});

test('two reports of different schema versions are refused, not averaged', () => {
  const older = past('2026-01', (s) => {
    s.report_schema_version = '0.9';
  });
  const table = buildLensB(now, older, 'VOO', '6mo');
  strictEqual(table.refusals.length, 1);
  strictEqual(table.refusals[0]?.code, 'report_version_mismatch');
});

test('a minor version difference is not a refusal', () => {
  const older = past('2026-01', (s) => {
    s.report_schema_version = '1.7';
  });
  deepStrictEqual(buildLensB(now, older, 'VOO', '6mo').refusals, []);
});

test('a benchmark missing from either side is refused', () => {
  const table = buildLensB(now, past('2026-01'), 'EFA', '6mo');
  strictEqual(table.refusals.length, 2);
  ok(table.refusals.every((b) => b.remedy.length > 0));
});

test('a column blocked in the past takes the whole comparison with it', () => {
  const before = past('2026-01', (s) => {
    const h = six(s);
    h.growth = null;
    h.up = null;
    h.down = null;
    h.worst_fall = null;
    h.fit = null;
    h.blockers = [{ code: 'window_shorter_than_horizon', message: 'Too new.', remedy: 'Wait.' }];
  });
  const table = buildLensB(now, before, 'VOO', '6mo');
  strictEqual(table.refusals.length, 1);
  ok(table.refusals[0]?.message.includes('Too new.'));
});

test('a blocked side leaves the change null, never zero', () => {
  const before = past('2026-01', (s) => {
    const side = six(s).up!;
    side.capture = null;
    side.blockers = [{ code: 'market_side_too_few_days', message: 'Few.', remedy: 'Longer.' }];
  });
  const row = buildLensB(now, before, 'VOO', '6mo').rows.find((r) => r.measure === 'capture_up')!;
  strictEqual(row.then, null);
  strictEqual(row.change, null);
  strictEqual(row.blockers.length, 1);
});

test('the months and windows on both sides are carried, not assumed', () => {
  const table = buildLensB(now, past('2026-01'), 'VOO', '6mo');
  strictEqual(table.nowMonth, '2026-07');
  strictEqual(table.thenMonth, '2026-01');
  strictEqual(table.column, '6mo');
  ok(table.nowWindow.start !== null && table.thenWindow.start !== null);
});

test('a lookback is available only where the archive holds that month', () => {
  ok(canCompare(['2026-01', '2026-07'], '2026-07', '6mo'));
  ok(!canCompare(['2026-07'], '2026-07', '6mo'));
});

test('real adjacent reports share no days', () => {
  const read = (name: string): ReportDocument =>
    JSON.parse(readFileSync(join(root, 'data', '_reports', 'BUFR', name), 'utf8')) as ReportDocument;
  const table = buildLensB(read('2026-10.json'), read('2026-04.json'), 'VOO', '6mo');
  deepStrictEqual(table.refusals, []);
  ok(table.thenWindow.end! <= table.nowWindow.start!);
});
