// SPDX-License-Identifier: MIT
//
// Lens C: two funds, everything else held still. The refusals are the module —
// the build spec asks this lens to *enforce* two constraints rather than
// support them, and a constraint that can be talked past is not enforced.

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  COMPARISON_HORIZON,
  buildLensC,
  comparableHorizons,
  sharedBenchmarks,
  sharedMonths,
} from '../src/lensC.ts';
import { STATES, type Snapshot } from '../src/schema/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const load = (name: string): Snapshot =>
  JSON.parse(readFileSync(join(root, 'fixtures', name), 'utf8')) as Snapshot;

const base = load('snapshot_computed.json');

/** A second fund, standing in for the other side of the comparison. */
function other(ticker: string, mutate: (s: Snapshot) => void = () => {}): Snapshot {
  const doc = structuredClone(base);
  doc.ticker = ticker;
  doc.name = `${ticker} Test Fund`;
  mutate(doc);
  return doc;
}

function cellOf(doc: Snapshot, benchmark: string, horizon: string, state: string) {
  const block = doc.benchmarks[benchmark]!;
  return block.horizons.find((h) => h.horizon === horizon)!.states![
    state as keyof NonNullable<(typeof block.horizons)[number]['states']>
  ]!;
}

test('the comparison starts at the twelve-month window', () => {
  strictEqual(COMPARISON_HORIZON, '12mo');
});

test('two funds read the same way yield a signed difference per row', () => {
  const table = buildLensC(base, other('AAAA'), 'VOO', '12mo');
  deepStrictEqual(table.refusals, []);
  deepStrictEqual(table.rows.map((r) => r.state), [...STATES]);

  // The same document on both sides: every reading that exists is identical.
  for (const row of table.rows) {
    if (row.a === null || row.b === null) continue;
    strictEqual(row.difference, 0);
    strictEqual(row.differs, false);
  }
});

test('the difference is signed, because which fund moved further is the finding', () => {
  const mine = cellOf(base, 'VOO', '12mo', 'fund_down_bench_down').raw_semibeta!;
  const theirs = mine - 0.25;
  const b = other('AAAA', (s) => {
    cellOf(s, 'VOO', '12mo', 'fund_down_bench_down').raw_semibeta = theirs;
  });
  const table = buildLensC(base, b, 'VOO', '12mo');
  const row = table.rows.find((r) => r.state === 'fund_down_bench_down')!;
  strictEqual(row.a, mine);
  strictEqual(row.b, theirs);
  ok(row.difference !== null && row.difference > 0, 'the first fund moved further, so the difference is positive');

  // And the other way round, so the sign is not an artefact of which side won.
  const flipped = buildLensC(b, base, 'VOO', '12mo').rows.find(
    (r) => r.state === 'fund_down_bench_down',
  )!;
  ok(flipped.difference !== null && flipped.difference < 0);
});

test('both readings survive into the row, not only the gap between them', () => {
  // Across the archive a gap of +0.30 turns up with the higher fund anywhere
  // from +0.04 to +0.71. The delta alone does not say what was found, so the
  // levels have to reach the view (3F D-14).
  const b = other('AAAA', (s) => {
    cellOf(s, 'VOO', '12mo', 'fund_up_bench_up').raw_semibeta = 0.10;
  });
  const row = buildLensC(base, b, 'VOO', '12mo').rows.find((r) => r.state === 'fund_up_bench_up')!;
  ok(row.a !== null && row.b !== null);
  strictEqual(row.b, 0.10);
});

test('a missing reading on either side leaves a null difference, never a zero', () => {
  const b = other('AAAA', (s) => {
    const cell = cellOf(s, 'VOO', '12mo', 'fund_up_bench_down');
    cell.raw_semibeta = null;
    cell.score = null;
    cell.data_sufficiency = 'blocked';
    cell.blockers = [
      { code: 'quadrant_empty', message: 'Too few days.', remedy: 'Read a longer window.', subjects: [] },
    ];
  });
  const row = buildLensC(base, b, 'VOO', '12mo').rows.find((r) => r.state === 'fund_up_bench_down')!;
  strictEqual(row.b, null);
  strictEqual(row.difference, null);
  strictEqual(row.differs, false);
  ok(row.blockers.length > 0, 'the reason the difference is missing must travel with it');
});

test('a difference is marked only once it reaches the threshold', () => {
  const threshold = base.methodology.shift_threshold!;
  ok(threshold !== null);

  const near = other('AAAA', (s) => {
    const mine = cellOf(base, 'VOO', '12mo', 'fund_up_bench_up').raw_semibeta!;
    cellOf(s, 'VOO', '12mo', 'fund_up_bench_up').raw_semibeta = mine - threshold * 0.9;
  });
  strictEqual(
    buildLensC(base, near, 'VOO', '12mo').rows.find((r) => r.state === 'fund_up_bench_up')!.differs,
    false,
  );

  const far = other('AAAA', (s) => {
    const mine = cellOf(base, 'VOO', '12mo', 'fund_up_bench_up').raw_semibeta!;
    cellOf(s, 'VOO', '12mo', 'fund_up_bench_up').raw_semibeta = mine - threshold;
  });
  strictEqual(
    buildLensC(base, far, 'VOO', '12mo').rows.find((r) => r.state === 'fund_up_bench_up')!.differs,
    true,
  );
});

test('two documents that disagree about the threshold mark nothing', () => {
  // One number for the reader to learn. Two documents with two ideas of what
  // counts as a difference cannot mark one, and an unmarked table is honest
  // where a mismarked one is not.
  const b = other('AAAA', (s) => {
    s.methodology.shift_threshold = 0.5;
    cellOf(s, 'VOO', '12mo', 'fund_up_bench_up').raw_semibeta = -5;
  });
  const table = buildLensC(base, b, 'VOO', '12mo');
  strictEqual(table.threshold, null);
  ok(table.rows.every((r) => !r.differs));
});

// ---- the constraints the spec asks this lens to enforce ----

test('two months apart is refused, not averaged over', () => {
  const b = other('AAAA', (s) => {
    s.as_of = '2026-01-30';
  });
  const table = buildLensC(base, b, 'VOO', '12mo');
  ok(table.refusals.some((r) => r.code === 'readings_from_different_months'));
  ok(table.refusals.every((r) => r.remedy.length > 0), 'every refusal names a way out (INV-2)');
});

test('a benchmark missing from either report is refused', () => {
  const b = other('AAAA', (s) => {
    delete (s.benchmarks as Record<string, unknown>)['VOO'];
  });
  const table = buildLensC(base, b, 'VOO', '12mo');
  ok(table.refusals.some((r) => r.code === 'benchmark_not_in_both_reports'));
});

test('a fund set beside itself is refused', () => {
  const table = buildLensC(base, structuredClone(base), 'VOO', '12mo');
  ok(table.refusals.some((r) => r.code === 'same_fund_twice'));
});

test('two schema majors are refused, as in Lens B and for the same reason', () => {
  const b = other('AAAA', (s) => {
    s.schema_version = '3.2';
  });
  const table = buildLensC(base, b, 'VOO', '12mo');
  ok(table.refusals.some((r) => r.code === 'report_version_mismatch'));
});

test('a window blocked on either side takes the whole comparison with it', () => {
  const b = other('AAAA', (s) => {
    const column = s.benchmarks['VOO']!.horizons.find((h) => h.horizon === '13wk')!;
    column.states = null;
    column.blockers = [
      {
        code: 'window_not_covered',
        message: 'The fund had not started trading for all of this window.',
        remedy: 'Read a shorter window.',
        subjects: [],
      },
    ];
  });
  const table = buildLensC(base, b, 'VOO', '13wk');
  const refusal = table.refusals.find((r) => r.code === 'reading_not_comparable');
  ok(refusal, 'a blocked window must refuse the table rather than draw four dashes');
  ok(refusal.message.includes('AAAA'), 'the refusal says which fund could not be read');
  ok(refusal.message.includes('had not started trading'), 'and carries the underlying reason');
});

// ---- what the picker is allowed to offer ----

test('shared months are the intersection, in order', () => {
  deepStrictEqual(
    sharedMonths(['2025-11', '2025-12', '2026-01'], ['2025-12', '2026-01', '2026-02']),
    ['2025-12', '2026-01'],
  );
  deepStrictEqual(sharedMonths(['2025-11'], ['2026-01']), []);
});

test('the universal anchor leads the shared benchmarks', () => {
  // It is the one thing every fund on this site is measured against, and so the
  // only benchmark that makes an arbitrary pair of them comparable at all.
  const a = other('AAAA', (s) => {
    s.benchmarks['QQQ'] = structuredClone(s.benchmarks['VOO']!);
  });
  const b = other('BBBB', (s) => {
    s.benchmarks['QQQ'] = structuredClone(s.benchmarks['VOO']!);
  });
  const shared = sharedBenchmarks(a, b, 'VOO');
  strictEqual(shared[0], 'VOO');
  deepStrictEqual([...shared].sort(), [...Object.keys(a.benchmarks)].sort());
});

test('a benchmark only one side carries is not offered as shared', () => {
  const a = other('AAAA', (s) => {
    s.benchmarks['QQQ'] = structuredClone(s.benchmarks['VOO']!);
  });
  const b = other('BBBB');
  ok(!sharedBenchmarks(a, b, 'VOO').includes('QQQ'));
});

test('only windows computable on both sides are offered', () => {
  const b = other('AAAA', (s) => {
    const column = s.benchmarks['VOO']!.horizons.find((h) => h.horizon === '13wk')!;
    column.states = null;
    column.blockers = [
      { code: 'window_not_covered', message: 'Too short.', remedy: 'Read a longer window.', subjects: [] },
    ];
  });
  const offered = comparableHorizons(base, b, 'VOO');
  ok(!offered.includes('13wk'), 'a window blocked on one side must not be offered');
  ok(offered.includes('12mo'));
});

test('a benchmark absent on one side offers no windows at all', () => {
  const b = other('AAAA', (s) => {
    delete (s.benchmarks as Record<string, unknown>)['VOO'];
  });
  deepStrictEqual(comparableHorizons(base, b, 'VOO'), []);
});
