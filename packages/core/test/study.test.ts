// SPDX-License-Identifier: MIT
//
// The committed selected report checks out, and a document that has been altered
// after the fact does not (3F D-25).

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { validateStudy } from '../src/study/validate.ts';
import { bandFinding, indexEtfSpread, studyHero, studyRows, upbRange } from '../src/study/build.ts';
import type { StudyDocument } from '../src/study/types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const load = (): StudyDocument =>
  JSON.parse(readFileSync(join(root, 'data', '_studies', 'gain-exposure-2026-11.json'), 'utf8'));

test('the committed Gain Exposure report validates', () => {
  deepStrictEqual(validateStudy(load()), []);
});

test('a changed E is refused', () => {
  const doc = load();
  doc.funds[0]!.readings['VOO']!.E! += 0.05;
  ok(validateStudy(doc).some((p) => p.message.includes('(1 − B) ÷ U')));
});

test('a label that disagrees with its range is refused', () => {
  const doc = load();
  const r = doc.funds.find((f) => f.readings['VOO']!.E_settled === 'not_settled')!.readings['VOO']!;
  r.E_settled = 'below_1';
  ok(validateStudy(doc).some((p) => p.message.includes('labelled below_1')));
});

test('a missing fund is refused by the group that lists it', () => {
  const doc = load();
  doc.funds = doc.funds.filter((f) => f.ticker !== 'SFLR');
  ok(validateStudy(doc).some((p) => p.message === 'lists different funds from the rows'));
});

test('a group median that is not the middle of its rows is refused', () => {
  const doc = load();
  doc.summaries.named['group:synthetic_long']!.E!.median += 0.02;
  ok(validateStudy(doc).some((p) => p.path === 'summaries.named.group:synthetic_long.E'));
});

test('a leg that does not end at its sums is refused', () => {
  const doc = load();
  const leg = doc.funds[0]!.readings['VOO']!.legs.up;
  leg[leg.length - 1]![1] += 0.01;
  ok(validateStudy(doc).some((p) => p.message === 'the up leg does not end at its sums'));
});

test('rows run by group, then sub-group, then E from the highest', () => {
  const rows = studyRows(load(), 'named');
  strictEqual(rows[0]!.fund.group, 'equity_sleeve');
  strictEqual(rows[rows.length - 1]!.fund.group, 'reference_only');
  const direct = rows.filter((r) => r.fund.subgroup === 'direct_stocks').map((r) => r.reading.E!);
  deepStrictEqual(direct, [...direct].sort((a, b) => b - a));
});

test('VOO basis reads every fund against VOO', () => {
  ok(studyRows(load(), 'VOO').every((r) => r.benchmark === 'VOO'));
  ok(studyRows(load(), 'named').some((r) => r.benchmark === 'QQQ'));
});

test('the cards and findings read the published figures', () => {
  const doc = load();
  const h = studyHero(doc);
  strictEqual(h.marketRank, 1);
  ok(h.marketFall < -0.04);
  strictEqual(h.synE, doc.summaries.named['group:synthetic_long']!.E!.median);
  const spread = indexEtfSpread(doc, 'named');
  strictEqual(spread.length, 6);
  strictEqual(h.indexUMax, spread[0]!.u);
  const range = upbRange(doc, 'named');
  strictEqual(range.n, 30);
  ok(range.lo < 1 && range.hi > 1);
  ok(typeof bandFinding(doc, 'named').lessAgain === 'boolean');
});
