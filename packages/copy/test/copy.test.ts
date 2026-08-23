// SPDX-License-Identifier: MIT
//
// INV-7: the prose passes the lint, run over the whole deck as a test.

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { PLAIN, TABLE } from '../src/plain.ts';
import { lintDeepExtended } from '../src/lint3f.ts';
import { lintDeep } from '../src/lint.ts';
import { BANNED_WORDS } from '../src/banned.ts';
import type { HorizonKey, SectionKey, StateKey } from '../src/types.ts';

const SECTIONS: SectionKey[] = [
  'overview',
  'participation',
  'resilience',
  'horizons',
  'benchmark_choice',
  'outcome_period',
  'thin_data',
  'history',
  'comparing_funds',
];

test('the whole deck passes the vendored lint', () => {
  const findings = lintDeep(PLAIN);
  deepStrictEqual(findings, [], JSON.stringify(findings, null, 2));
});

test('the whole deck passes Third Floor’s extended lint', () => {
  const findings = lintDeepExtended(PLAIN);
  deepStrictEqual(findings, [], JSON.stringify(findings, null, 2));
});

test('every section has all four required strings', () => {
  for (const key of SECTIONS) {
    const section = PLAIN[key];
    ok(section, `${key} is missing`);
    for (const field of ['title', 'mechanism', 'whatWouldChangeIt', 'whenAbsent'] as const) {
      ok(section[field].trim().length > 0, `${key}.${field} is empty`);
    }
  }
});

test('whenAbsent is what makes INV-2 honourable in the interface', () => {
  // A blocker with no sentence to print in place of the figure is a blank on
  // the page, which is the one thing this reader cannot interpret.
  for (const key of SECTIONS) {
    ok(PLAIN[key].whenAbsent.length > 20, `${key}.whenAbsent is too short to be a sentence`);
  }
});

test('the deck covers exactly the declared section keys', () => {
  deepStrictEqual(Object.keys(PLAIN).sort(), [...SECTIONS].sort());
});

test('the extended list catches a word the vendored one does not', () => {
  const findings = lintDeepExtended({ s: 'This fund is defensive.' });
  strictEqual(findings.length, 1);
  strictEqual(findings[0]?.word, 'defensive');
  deepStrictEqual(lintDeep({ s: 'This fund is defensive.' }), []);
});

test('the extended list still catches the family words through the vendored matcher', () => {
  const findings = lintDeepExtended({ s: 'This fund protects your money.' });
  ok(findings.some((f) => f.word === 'protect' || f.word === 'protects'));
});

test('typographic quotes are enforced, not merely preferred', () => {
  const findings = lintDeepExtended({ s: 'The fund holds a "floor".' });
  ok(findings.some((f) => f.word.includes('straight double quote')));
});

test('the banned list keeps the family words and drops the holdings verdicts', () => {
  ok(BANNED_WORDS.includes('protect'));
  ok(BANNED_WORDS.includes('defensive'));
  // Second Floor's weighting verdicts are about how much of a holding a fund
  // owns, and this app never looks at holdings at all.
  ok(!BANNED_WORDS.includes('overweight'));
});

const STATES: StateKey[] = [
  'fund_up_bench_up',
  'fund_down_bench_down',
  'fund_up_bench_down',
  'fund_down_bench_up',
];
const COLUMNS: HorizonKey[] = ['12mo', '6mo', '13wk'];

test('the table copy passes both lints', () => {
  deepStrictEqual(lintDeep(TABLE), []);
  deepStrictEqual(lintDeepExtended(TABLE), [], JSON.stringify(lintDeepExtended(TABLE), null, 2));
});

test('every row has a label, a spelled-out form and a direction', () => {
  for (const state of STATES) {
    const row = TABLE.rows[state];
    ok(row.label.trim().length > 0, `${state} has no label`);
    ok(row.full.trim().length > 0, `${state} has no spelled-out form`);
    ok(row.direction === 'sought' || row.direction === 'avoided', `${state} has no direction`);
  }
});

test('the two rows in each group carry opposite directions', () => {
  // Otherwise the tint would say the same thing about both rows of a pair,
  // which is the one thing it exists to distinguish.
  strictEqual(TABLE.rows.fund_up_bench_up.direction, 'sought');
  strictEqual(TABLE.rows.fund_down_bench_down.direction, 'avoided');
  strictEqual(TABLE.rows.fund_up_bench_down.direction, 'sought');
  strictEqual(TABLE.rows.fund_down_bench_up.direction, 'avoided');
});

test('every shipping column has a heading and a spelled-out form', () => {
  deepStrictEqual(Object.keys(TABLE.columns).sort(), [...COLUMNS].sort());
  for (const c of COLUMNS) {
    ok(TABLE.columns[c].short.trim().length > 0);
    ok(TABLE.columns[c].full.trim().length > 0);
  }
});

test('the legend explains every marker the table can draw', () => {
  for (const key of ['tint', 'shift', 'thin', 'blocked', 'noBaseline'] as const) {
    ok(TABLE.legend[key].length > 30, `legend.${key} is too short to explain anything`);
  }
});

test('the legend says what a dash means, because a dash is not a zero', () => {
  // A zero and an unknown are opposite claims (INV-2), and on a page of numbers
  // an unexplained dash is the easiest of the two to misread.
  ok(/not mean zero|does not mean zero/i.test(TABLE.legend.blocked));
});

test('the row labels avoid the spec’s own vocabulary', () => {
  const blob = JSON.stringify(TABLE.rows).toLowerCase();
  for (const jargon of ['participation', 'resilience', 'benchmark:', 'semibeta']) {
    ok(!blob.includes(jargon), `row labels still say “${jargon}”`);
  }
});
