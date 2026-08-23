// SPDX-License-Identifier: MIT
//
// The marker rules, tested without a DOM. If a dot appears on the page, the
// reason is here.

import { deepStrictEqual, ok, strictEqual, throws } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { BASELINE, buildLensA, defaultBenchmark } from '../src/lensA.ts';
import { HORIZONS, STATES, type Snapshot } from '../src/schema/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const load = (name: string): Snapshot =>
  JSON.parse(readFileSync(join(root, 'fixtures', name), 'utf8')) as Snapshot;

const computed = load('snapshot_computed.json');
const noBaseline = load('snapshot_blocked.json');

test('every row and column is present, in the report’s order', () => {
  const table = buildLensA(computed, 'VOO');
  deepStrictEqual(table.rows.map((r) => r.state), [...STATES]);
  for (const row of table.rows) {
    deepStrictEqual(row.cells.map((c) => c.horizon), [...HORIZONS]);
  }
});

test('rows are grouped the way the table draws them', () => {
  const table = buildLensA(computed, 'VOO');
  const groups = Object.fromEntries(table.rows.map((r) => [r.state, r.group]));
  strictEqual(groups['fund_up_bench_up'], 'participation');
  strictEqual(groups['fund_down_bench_down'], 'participation');
  strictEqual(groups['fund_up_bench_down'], 'resilience');
  strictEqual(groups['fund_down_bench_up'], 'resilience');
});

test('the baseline column is never marked as shifted from itself', () => {
  const table = buildLensA(computed, 'VOO');
  for (const row of table.rows) {
    const baseline = row.cells.find((c) => c.horizon === BASELINE);
    strictEqual(baseline?.shifted, false);
    strictEqual(baseline?.distanceFromBaseline, null);
  }
});

test('the table reads the ratio, not the bounded score', () => {
  // The score clamps every negative to zero, so two opposite readings would sit
  // at the same distance from each other (3F D-12).
  const table = buildLensA(computed, 'VOO');
  for (const row of table.rows) {
    for (const cell of row.cells) {
      if (cell.ratio === null) continue;
      strictEqual(typeof cell.ratio, 'number');
    }
  }
});

test('a negative reading survives to the table instead of clamping to zero', () => {
  const doc = structuredClone(computed);
  const block = doc.benchmarks['VOO']!;
  const base = block.horizons.find((h) => h.horizon === '12mo')!.states!['fund_up_bench_down']!;
  base.raw_semibeta = -0.42;
  base.score = 0;
  const row = buildLensA(doc, 'VOO').rows.find((r) => r.state === 'fund_up_bench_down')!;
  const cell = row.cells.find((c) => c.horizon === '12mo')!;
  strictEqual(cell.ratio, -0.42);
  strictEqual(cell.score, 0, 'the bounded score still clamps — which is why it is not shown');
});

test('the shift distance is measured on ratios, so two negatives are not equal', () => {
  const doc = structuredClone(computed);
  const block = doc.benchmarks['VOO']!;
  const base = block.horizons.find((h) => h.horizon === '12mo')!.states!['fund_up_bench_down']!;
  const short = block.horizons.find((h) => h.horizon === '13wk')!.states!['fund_up_bench_down']!;
  // Both clamp to score 0, so on the old scale this gap was invisible.
  base.raw_semibeta = -0.10;
  base.score = 0;
  short.raw_semibeta = -0.90;
  short.score = 0;
  const row = buildLensA(doc, 'VOO').rows.find((r) => r.state === 'fund_up_bench_down')!;
  const cell = row.cells.find((c) => c.horizon === '13wk')!;
  ok(cell.distanceFromBaseline !== null);
  ok(Math.abs(cell.distanceFromBaseline - 0.8) < 1e-9);
  strictEqual(cell.shifted, true);
});

test('a cell is marked shifted exactly when it reaches the threshold', () => {
  const table = buildLensA(computed, 'VOO');
  const threshold = table.shiftThreshold;
  ok(threshold !== null);

  let checked = 0;
  for (const row of table.rows) {
    for (const cell of row.cells) {
      if (cell.distanceFromBaseline === null) {
        strictEqual(cell.shifted, false);
        continue;
      }
      strictEqual(cell.shifted, cell.distanceFromBaseline >= threshold);
      checked++;
    }
  }
  ok(checked > 0, 'no cell had a baseline to compare against');
});

test('the threshold boundary is inclusive, and one point below is not', () => {
  const tweak = (delta: number): boolean => {
    const doc = structuredClone(computed);
    const block = doc.benchmarks['VOO']!;
    const base = block.horizons.find((h) => h.horizon === '12mo')!.states!['fund_up_bench_up']!;
    const short = block.horizons.find((h) => h.horizon === '13wk')!.states!['fund_up_bench_up']!;
    base.raw_semibeta = 1.0;
    base.score = 50;
    short.raw_semibeta = 1.0 + delta;
    short.score = Math.max(0, Math.min(100, Math.round(50 * (1.0 + delta))));
    const row = buildLensA(doc, 'VOO').rows.find((r) => r.state === 'fund_up_bench_up')!;
    return row.cells.find((c) => c.horizon === '13wk')!.shifted;
  };
  strictEqual(tweak(0.30), true);
  strictEqual(tweak(0.29), false);
  strictEqual(tweak(-0.30), true, 'a shift downward counts the same as one upward');
  strictEqual(tweak(-0.29), false);
});

test('with no 12-month reading, nothing is marked and the table says so', () => {
  // 3F-O-02. About a fifth of the archive is in this state, so it is not an
  // edge case the page can leave to chance.
  const table = buildLensA(noBaseline, 'VOO');
  ok(table.baselineAbsent);
  for (const row of table.rows) {
    for (const cell of row.cells) {
      strictEqual(cell.shifted, false, `${row.state}/${cell.horizon} was marked without a baseline`);
      strictEqual(cell.distanceFromBaseline, null);
    }
  }
});

test('a blocked horizon still yields a cell, carrying its reason', () => {
  const table = buildLensA(noBaseline, 'VOO');
  const cell = table.rows[0]!.cells.find((c) => c.horizon === BASELINE)!;
  strictEqual(cell.ratio, null);
  ok(cell.blockers.length > 0);
  ok(cell.blockers[0]!.remedy.length > 0, 'a blocker with no remedy is a dead end (INV-2)');
});

test('a blocked score stays null and never becomes zero', () => {
  const table = buildLensA(noBaseline, 'VOO');
  for (const row of table.rows) {
    for (const cell of row.cells) {
      if (cell.blockers.length > 0 && cell.observations === 0) strictEqual(cell.ratio, null);
    }
  }
});

test('the thin flag is carried through from the document, not recomputed', () => {
  const table = buildLensA(computed, 'VOO');
  const floor = computed.methodology.min_observations_per_cell;
  for (const row of table.rows) {
    for (const cell of row.cells) {
      if (cell.ratio === null) continue;
      strictEqual(cell.thin, cell.observations < floor, `${row.state}/${cell.horizon}`);
    }
  }
});

test('the named benchmark leads where the fund has one', () => {
  strictEqual(defaultBenchmark(computed), 'EFA');
  ok(computed.benchmarks['EFA']!.roles.includes('named_benchmark'));
});

test('the universal anchor is the fallback when the fund names none', () => {
  const doc = structuredClone(computed);
  for (const block of Object.values(doc.benchmarks)) {
    block.roles = ['universal_anchor'];
  }
  strictEqual(defaultBenchmark(doc), 'VOO');
});

test('asking for a benchmark the fund does not carry is an error, not a wrong table', () => {
  throws(() => buildLensA(computed, 'QQQ'), /has no reading against QQQ/);
});

test('blocked horizons are listed for the report to explain', () => {
  const table = buildLensA(noBaseline, 'VOO');
  ok(table.blockedHorizons.length > 0);
  for (const h of table.blockedHorizons) {
    ok(h.blockers.length > 0);
    ok(h.blockers[0]!.remedy.length > 0);
  }
});
