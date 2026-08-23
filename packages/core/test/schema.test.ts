// SPDX-License-Identifier: MIT
//
// The validator, checked against synthetic snapshots built by the real pipeline
// from invented prices. Committed fixtures rather than real downloads, so a
// fresh clone runs the whole suite with nothing skipped (FF D-31).

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { validateSnapshot, isSnapshot } from '../src/schema/validate.ts';
import { HORIZONS, STATES, normaliseScore, SCHEMA_VERSION } from '../src/schema/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const load = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(root, 'fixtures', name), 'utf8')) as Record<string, unknown>;

const computed = load('snapshot_computed.json');
const blocked = load('snapshot_blocked.json');

test('a fully computed snapshot validates', () => {
  deepStrictEqual(validateSnapshot(computed), []);
  ok(isSnapshot(computed));
});

test('a snapshot whose baseline is blocked also validates (3F D-09)', () => {
  // The write rule emits a file when ANY horizon is computable, so a valid
  // document can carry a blocked 12-month row. That is the case the site has to
  // handle, so it must not be a validation error.
  deepStrictEqual(validateSnapshot(blocked), []);
  strictEqual(blocked['ticker'], 'YUNG');
  const voo = (blocked['benchmarks'] as Record<string, { horizons: { states: unknown }[] }>)['VOO'];
  strictEqual(voo?.horizons[0]?.states, null);
  strictEqual(
    (blocked['coverage'] as Record<string, unknown>)['earliest_full_baseline_snapshot'],
    null,
  );
});

test('the fixtures are on the current schema version', () => {
  strictEqual(computed['schema_version'], SCHEMA_VERSION);
});

test('horizons are in the report table’s column order', () => {
  const benchmarks = computed['benchmarks'] as Record<string, { horizons: { horizon: string }[] }>;
  for (const block of Object.values(benchmarks)) {
    deepStrictEqual(block.horizons.map((h) => h.horizon), [...HORIZONS]);
  }
});

test('a score that disagrees with its own raw value is caught', () => {
  // This is what makes 3F D-04's promise real: the transform can be changed and
  // the archive regenerated from stored raw values, and the check proves the
  // stored values are actually what the scores came from.
  const tampered = structuredClone(computed) as never as {
    benchmarks: Record<string, { horizons: { states: Record<string, { score: number }> }[] }>;
  };
  const cell = tampered.benchmarks['VOO']!.horizons[0]!.states[STATES[0]]!;
  cell.score = cell.score + 7;
  const problems = validateSnapshot(tampered);
  ok(problems.some((p) => p.message.includes('normalises to')), JSON.stringify(problems));
});

test('the observation identity is enforced, not assumed', () => {
  const tampered = structuredClone(computed) as never as {
    benchmarks: Record<string, { horizons: { observations_unclassified: number }[] }>;
  };
  tampered.benchmarks['VOO']!.horizons[0]!.observations_unclassified += 3;
  const problems = validateSnapshot(tampered);
  ok(problems.some((p) => p.message.includes('do not balance')), JSON.stringify(problems));
});

test('quadrant counts that do not sum to the classified total are caught', () => {
  const tampered = structuredClone(computed) as never as {
    benchmarks: Record<string, { horizons: { states: Record<string, { observation_count: number }> }[] }>;
  };
  tampered.benchmarks['VOO']!.horizons[0]!.states[STATES[1]]!.observation_count += 5;
  ok(validateSnapshot(tampered).some((p) => p.message.includes('quadrant counts sum to')));
});

test('a blocked cell may not carry a number, and a number may not be null', () => {
  const zeroed = structuredClone(blocked) as never as {
    benchmarks: Record<string, { horizons: { states: Record<string, unknown> | null }[] }>;
  };
  const states = zeroed.benchmarks['VOO']!.horizons[3]!.states!;
  // A zero and an unknown are opposite claims (INV-2).
  (states[STATES[0]] as { raw_semibeta: number | null; data_sufficiency: string }).raw_semibeta = null;
  ok(validateSnapshot(zeroed).some((p) => p.message.includes('not marked blocked')));
});

test('a blocker with no remedy is refused', () => {
  const tampered = structuredClone(blocked) as never as {
    benchmarks: Record<string, { horizons: { blockers: { remedy: string }[] }[] }>;
  };
  tampered.benchmarks['VOO']!.horizons[0]!.blockers[0]!.remedy = '';
  ok(validateSnapshot(tampered).some((p) => p.path.endsWith('.remedy')));
});

test('a blocked horizon must say why', () => {
  const tampered = structuredClone(blocked) as never as {
    benchmarks: Record<string, { horizons: { blockers: unknown[] }[] }>;
  };
  tampered.benchmarks['VOO']!.horizons[0]!.blockers = [];
  ok(validateSnapshot(tampered).some((p) => p.message.includes('must say why')));
});

test('a snapshot missing the universal anchor is refused', () => {
  const tampered = structuredClone(computed) as never as { benchmarks: Record<string, unknown> };
  delete tampered.benchmarks['VOO'];
  ok(validateSnapshot(tampered).some((p) => p.message.includes('universal anchor')));
});

test('an unset shift threshold must carry a note rather than a placeholder', () => {
  const tampered = structuredClone(computed) as never as {
    methodology: Record<string, unknown>;
  };
  delete tampered.methodology['shift_threshold_note'];
  ok(validateSnapshot(tampered).some((p) => p.path.endsWith('shift_threshold_note')));
});

test('a baseline older than the archive itself is refused', () => {
  const tampered = structuredClone(computed) as never as { coverage: Record<string, unknown> };
  tampered.coverage['earliest_full_baseline_snapshot'] = '2000-01';
  ok(validateSnapshot(tampered).some((p) => p.message.includes('older than the earliest')));
});

test('junk is refused rather than crashing the validator', () => {
  for (const junk of [null, 42, 'a string', [], {}]) {
    ok(validateSnapshot(junk).length > 0);
    ok(!isSnapshot(junk));
  }
});

test('the score transform matches the Python side at its anchor points', () => {
  strictEqual(normaliseScore(0), 0);
  strictEqual(normaliseScore(1), 50);
  strictEqual(normaliseScore(2), 100);
  strictEqual(normaliseScore(-3), 0);
  strictEqual(normaliseScore(9), 100);
  strictEqual(normaliseScore(null), null);
});
