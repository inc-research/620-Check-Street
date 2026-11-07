// SPDX-License-Identifier: MIT
//
// Lens C: two funds, one reading. The refusals matter as much as the subtraction.

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  COMPARISON_HORIZON,
  DIFFERENCE_MARK,
  buildLensC,
  comparableHorizons,
  sharedBenchmarks,
  sharedMonths,
} from '../src/lensC.ts';
import { FUND_MEASURES } from '../src/report/measures.ts';
import type { ReportDocument, ReportHorizon } from '../src/report/types.ts';
import type { HorizonName } from '../src/schema/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const base = JSON.parse(
  readFileSync(join(root, 'fixtures', 'report_computed.json'), 'utf8'),
) as ReportDocument;

function other(ticker: string, mutate: (s: ReportDocument) => void = () => {}): ReportDocument {
  const doc = structuredClone(base);
  doc.ticker = ticker;
  doc.name = `${ticker} Test Fund`;
  mutate(doc);
  return doc;
}

const column = (doc: ReportDocument, h: HorizonName = '12mo'): ReportHorizon =>
  doc.benchmarks['VOO']!.horizons.find((x) => x.horizon === h)!;

function block(h: ReportHorizon): void {
  h.growth = null;
  h.up = null;
  h.down = null;
  h.worst_fall = null;
  h.fit = null;
  h.blockers = [{ code: 'window_shorter_than_horizon', message: 'Too new.', remedy: 'Wait.' }];
}

test('two funds read the same way yield a signed difference per row', () => {
  const table = buildLensC(base, other('OTHR'), 'VOO', '12mo');
  deepStrictEqual(table.refusals, []);
  deepStrictEqual(table.rows.map((r) => r.measure), [...FUND_MEASURES]);
  for (const row of table.rows) strictEqual(row.difference, 0);
});

test('the benchmark’s own rows are left out, being the same on both sides', () => {
  const measures = buildLensC(base, other('OTHR'), 'VOO', '12mo').rows.map((r) => r.measure);
  ok(!measures.some((m) => m.endsWith('_benchmark')));
});

test('the difference is signed, because which fund moved further is the finding', () => {
  const b = other('OTHR', (s) => {
    column(s).down!.capture = 2.0;
  });
  const row = buildLensC(base, b, 'VOO', '12mo').rows.find((r) => r.measure === 'capture_down')!;
  ok(row.a !== null && row.difference !== null);
  strictEqual(row.difference, row.a - 2.0);
  ok(row.difference < 0);
});

test('both readings survive into the row, not only the gap between them', () => {
  const b = other('OTHR', (s) => {
    column(s).up!.capture = 0.11;
  });
  const row = buildLensC(base, b, 'VOO', '12mo').rows.find((r) => r.measure === 'capture_up')!;
  strictEqual(row.b, 0.11);
  strictEqual(row.a, column(base).up!.capture);
});

test('a missing reading on either side leaves a null difference, never a zero', () => {
  const b = other('OTHR', (s) => {
    const side = column(s).up!;
    side.capture = null;
    side.blockers = [{ code: 'market_side_too_few_days', message: 'Few.', remedy: 'Longer.' }];
  });
  const row = buildLensC(base, b, 'VOO', '12mo').rows.find((r) => r.measure === 'capture_up')!;
  strictEqual(row.b, null);
  strictEqual(row.difference, null);
  strictEqual(row.differs, false);
  strictEqual(row.blockers.length, 1);
});

test('a per-1% gap is marked only once it reaches the mark', () => {
  const marked = (delta: number): boolean => {
    const b = other('OTHR', (s) => {
      const side = column(s).up!;
      side.capture = side.capture! + delta;
    });
    return buildLensC(base, b, 'VOO', '12mo').rows.find((r) => r.measure === 'capture_up')!.differs;
  };
  strictEqual(marked(DIFFERENCE_MARK + 0.01), true);
  strictEqual(marked(-(DIFFERENCE_MARK + 0.01)), true);
  strictEqual(marked(DIFFERENCE_MARK - 0.01), false);
});

test('the dot is for the per-1% rows and no others', () => {
  const b = other('OTHR', (s) => {
    const h = column(s);
    h.growth = { fund: h.growth!.fund + 1, benchmark: h.growth!.benchmark };
    h.fit!.r_squared = 0;
  });
  const table = buildLensC(base, b, 'VOO', '12mo');
  strictEqual(table.rows.find((r) => r.measure === 'growth_fund')!.differs, false);
  strictEqual(table.rows.find((r) => r.measure === 'fit')!.differs, false);
});

test('two months apart is refused, not averaged over', () => {
  const b = other('OTHR', (s) => {
    s.as_of = '2026-06-30';
  });
  strictEqual(buildLensC(base, b, 'VOO', '12mo').refusals[0]?.code, 'readings_from_different_months');
});

test('a benchmark missing from either report is refused', () => {
  const table = buildLensC(base, other('OTHR'), 'EFA', '12mo');
  strictEqual(table.refusals.length, 2);
  ok(table.refusals.every((r) => r.remedy.length > 0));
});

test('a fund set beside itself is refused', () => {
  strictEqual(buildLensC(base, base, 'VOO', '12mo').refusals[0]?.code, 'same_fund_twice');
});

test('two schema majors are refused, as in Lens B and for the same reason', () => {
  const b = other('OTHR', (s) => {
    s.report_schema_version = '0.9';
  });
  strictEqual(buildLensC(base, b, 'VOO', '12mo').refusals[0]?.code, 'report_version_mismatch');
});

test('a window blocked on either side takes the whole comparison with it', () => {
  const b = other('OTHR', (s) => block(column(s)));
  const table = buildLensC(base, b, 'VOO', '12mo');
  strictEqual(table.refusals.length, 1);
  ok(table.refusals[0]?.message.includes('Too new.'));
});

test('only windows computable on both sides are offered', () => {
  const b = other('OTHR', (s) => block(column(s)));
  deepStrictEqual(comparableHorizons(base, b, 'VOO'), ['6mo', '13wk']);
  deepStrictEqual(comparableHorizons(base, b, 'EFA'), []);
});

test('the universal anchor leads the benchmarks two funds share', () => {
  deepStrictEqual(sharedBenchmarks(base, other('OTHR'), 'VOO'), ['VOO', 'IWM']);
});

test('months both funds reported are the only months offered', () => {
  deepStrictEqual(sharedMonths(['2026-05', '2026-06'], ['2026-06', '2026-07']), ['2026-06']);
});

test('the comparison starts on the longest window', () => {
  strictEqual(COMPARISON_HORIZON, '12mo');
});
