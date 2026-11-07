// SPDX-License-Identifier: MIT
//
// The report document: its promises, and what the table takes from it.

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { MEASURES, buildReportTable, readMeasure } from '../src/report/measures.ts';
import type { ReportDocument, ReportHorizon } from '../src/report/types.ts';
import { validateReport } from '../src/report/validate.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const load = (name: string): ReportDocument =>
  JSON.parse(readFileSync(join(root, 'fixtures', name), 'utf8')) as ReportDocument;

const computed = load('report_computed.json');
const blocked = load('report_blocked.json');
const lowFit = load('report_low_fit.json');

function tampered(mutate: (h: ReportHorizon) => void): ReportDocument {
  const doc = structuredClone(computed);
  mutate(doc.benchmarks['VOO']!.horizons[0]!);
  return doc;
}

const says = (doc: unknown, fragment: string) =>
  validateReport(doc).some((p) => `${p.path} ${p.message}`.includes(fragment));

test('real reports validate', () => {
  deepStrictEqual(validateReport(computed), []);
  deepStrictEqual(validateReport(blocked), []);
  deepStrictEqual(validateReport(lowFit), []);
});

test('the days have to balance (INV-3)', () => {
  ok(says(tampered((h) => { h.days_total += 1; }), 'do not balance'));
});

test('capture has to be the ratio of its own stored sums', () => {
  ok(says(tampered((h) => { h.up!.capture = h.up!.capture! + 0.01; }), 'not the ratio'));
});

test('the sentence and the dollars are the same fact', () => {
  const h = computed.benchmarks['VOO']!.horizons[0]!;
  const ratio = h.up!.average_fund! / h.up!.average_benchmark!;
  ok(Math.abs(ratio - h.up!.capture!) < 1e-12);
});

test('an average has to be its sum over its days', () => {
  ok(says(tampered((h) => { h.down!.average_fund = 0; }), 'average_fund'));
});

test('a fall above zero is refused', () => {
  ok(says(tampered((h) => { h.worst_fall!.fund.depth = 0.1; }), 'worst_fall.fund'));
});

test('a side with no figure has to say why (INV-2)', () => {
  ok(says(tampered((h) => { h.up!.capture = null; }), 'must say why'));
});

test('a blocked window publishes no day count and says why', () => {
  const doc = structuredClone(blocked);
  const h = doc.benchmarks['VOO']!.horizons[0]!;
  strictEqual(h.growth, null);
  h.blockers = [];
  ok(says(doc, 'must say why'));
});

test('junk is refused rather than crashing the validator', () => {
  for (const junk of [null, 3, 'x', [], {}]) ok(validateReport(junk).length > 0);
});

test('a missing universal anchor is refused', () => {
  const doc = structuredClone(computed);
  delete doc.benchmarks['VOO'];
  ok(says(doc, 'universal anchor'));
});

test('every measure reaches the table, in every column', () => {
  const table = buildReportTable(computed, 'IWM');
  deepStrictEqual(table.rows.map((r) => r.measure), [...MEASURES]);
  for (const row of table.rows) strictEqual(row.cells.length, 3);
});

test('dollar readings are per $100, shares are out of 100, ratios are left alone', () => {
  const h = computed.benchmarks['VOO']!.horizons[0]!;
  strictEqual(readMeasure(h, 'growth_fund'), 100 * h.growth!.fund);
  strictEqual(readMeasure(h, 'fall_fund'), 100 * h.worst_fall!.fund.depth);
  strictEqual(readMeasure(h, 'day_up_fund'), 100 * h.up!.average_fund!);
  strictEqual(readMeasure(h, 'fit'), 100 * h.fit!.r_squared!);
  strictEqual(readMeasure(h, 'capture_down'), h.down!.capture);
});

test('the sentence speaks about the longest window that computed', () => {
  strictEqual(buildReportTable(computed, 'VOO').lead?.horizon, '12mo');
  strictEqual(buildReportTable(blocked, 'VOO').lead?.horizon, '13wk');
});

test('a blocked window is named, and its cells are null rather than zero', () => {
  const table = buildReportTable(blocked, 'VOO');
  deepStrictEqual(table.blockedHorizons.map((b) => b.horizon), ['12mo', '6mo']);
  const cell = table.rows[0]!.cells[0]!;
  strictEqual(cell.value, null);
  ok(cell.blockers.length > 0);
});

test('a fund barely tied to the benchmark loses the sentence', () => {
  ok(buildReportTable(lowFit, 'VOO').lead?.lowFit);
  strictEqual(buildReportTable(computed, 'IWM').lead?.lowFit, false);
});

test('a reading against a benchmark the fund does not carry throws', () => {
  let threw = false;
  try {
    buildReportTable(computed, 'EFA');
  } catch {
    threw = true;
  }
  ok(threw);
});
