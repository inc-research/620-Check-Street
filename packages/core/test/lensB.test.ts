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
import { STATES, type Snapshot } from '../src/schema/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const load = (name: string): Snapshot =>
  JSON.parse(readFileSync(join(root, 'fixtures', name), 'utf8')) as Snapshot;

const now = load('snapshot_computed.json');

/** The same fixture shifted back in time, standing in for an archived report. */
function past(month: string, mutate: (s: Snapshot) => void = () => {}): Snapshot {
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

test('a comparable pair yields a signed change per row', () => {
  const table = buildLensB(now, past('2026-01'), 'VOO', '6mo');
  deepStrictEqual(table.refusals, []);
  deepStrictEqual(table.rows.map((r) => r.state), [...STATES]);

  // Compared against itself, every reading holds steady.
  for (const row of table.rows) {
    if (row.now === null || row.then === null) continue;
    strictEqual(row.change, 0);
    strictEqual(row.changed, false);
  }
});

test('the change is signed, because the direction is the finding', () => {
  const before = past('2026-01', (s) => {
    const cell = s.benchmarks['VOO']!.horizons.find((h) => h.horizon === '6mo')!.states![
      'fund_down_bench_down'
    ]!;
    cell.raw_semibeta = 0.90;
  });
  const table = buildLensB(now, before, 'VOO', '6mo');
  const row = table.rows.find((r) => r.state === 'fund_down_bench_down')!;
  ok(row.now !== null);
  strictEqual(row.then, 0.90);
  ok(row.change !== null);
  strictEqual(row.change, row.now - 0.90);
  ok(row.change < 0, 'the fund now moves less than it did, so the change is negative');
});

test('a change is marked at the same threshold the rest of the site uses', () => {
  const shifted = (delta: number): boolean => {
    const before = past('2026-01', (s) => {
      const cell = s.benchmarks['VOO']!.horizons.find((h) => h.horizon === '6mo')!.states![
        'fund_up_bench_up'
      ]!;
      cell.raw_semibeta = (now.benchmarks['VOO']!.horizons.find((h) => h.horizon === '6mo')!
        .states!['fund_up_bench_up']!.raw_semibeta as number) - delta;
    });
    return buildLensB(now, before, 'VOO', '6mo').rows.find((r) => r.state === 'fund_up_bench_up')!
      .changed;
  };
  strictEqual(shifted(0.30), true);
  strictEqual(shifted(0.29), false);
  strictEqual(shifted(-0.30), true, 'a fall counts the same as a rise');
});

test('two reports of different schema versions are refused, not averaged', () => {
  // They were worked out differently; setting their numbers side by side would
  // compare two methods while claiming to compare two periods.
  const before = past('2026-01', (s) => {
    s.schema_version = '3.0';
  });
  const table = buildLensB(now, before, 'VOO', '6mo');
  ok(table.refusals.some((b) => b.code === 'report_version_mismatch'));
  ok(table.refusals.every((b) => b.remedy.length > 0), 'INV-2: every refusal names a remedy');
});

test('a minor version difference is not a refusal', () => {
  const before = past('2026-01', (s) => {
    s.schema_version = '4.1';
  });
  strictEqual(buildLensB(now, before, 'VOO', '6mo').refusals.length, 0);
});

test('a benchmark missing from either side is refused', () => {
  const before = past('2026-01', (s) => {
    delete s.benchmarks['EFA'];
  });
  const table = buildLensB(now, before, 'EFA', '6mo');
  ok(table.refusals.some((b) => b.code === 'benchmark_not_in_both_reports'));
});

test('a column blocked in the past takes the whole comparison with it', () => {
  // Four dashes in a row explain nothing; one sentence does.
  const before = past('2026-01', (s) => {
    const column = s.benchmarks['VOO']!.horizons.find((h) => h.horizon === '6mo')!;
    column.states = null;
    column.blockers = [
      { code: 'window_shorter_than_horizon', message: 'Not enough history.', remedy: 'Wait.' },
    ];
    column.observations_total = 0;
    column.observations_classified = 0;
    column.observations_unclassified = 0;
  });
  const table = buildLensB(now, before, 'VOO', '6mo');
  ok(table.refusals.some((b) => b.code === 'period_not_comparable'));
  ok(table.refusals[0]!.remedy.length > 0);
});

test('a blocked cell on one side leaves the change null, never zero', () => {
  const before = past('2026-01', (s) => {
    const cell = s.benchmarks['VOO']!.horizons.find((h) => h.horizon === '6mo')!.states![
      'fund_up_bench_down'
    ]!;
    cell.raw_semibeta = null;
    cell.score = null;
    cell.quadrant_cov = null;
    cell.quadrant_var_bench = null;
    cell.data_sufficiency = 'blocked';
    cell.blockers = [{ code: 'quadrant_too_few_observations', message: 'Too few days.', remedy: 'Wait.' }];
  });
  const row = buildLensB(now, before, 'VOO', '6mo').rows.find(
    (r) => r.state === 'fund_up_bench_down',
  )!;
  strictEqual(row.then, null);
  // A zero would say the reading held steady, which is a different claim (INV-2).
  strictEqual(row.change, null);
  strictEqual(row.changed, false);
  ok(row.blockers.length > 0);
});

test('the months and windows on both sides are carried, not assumed', () => {
  const table = buildLensB(now, past('2026-01'), 'VOO', '6mo');
  strictEqual(table.nowMonth, now.as_of.slice(0, 7));
  strictEqual(table.thenMonth, '2026-01');
  ok(table.nowWindow.start, 'the current window is unnamed');
  ok(table.thenWindow.start, 'the earlier window is unnamed');
});

test('an archive without the earlier month cannot answer the lookback', () => {
  ok(canCompare(['2026-01', '2026-07'], '2026-07', '6mo'));
  ok(!canCompare(['2026-05', '2026-07'], '2026-07', '6mo'));
  ok(canCompare(['2026-04', '2026-07'], '2026-07', '13wk'));
});
