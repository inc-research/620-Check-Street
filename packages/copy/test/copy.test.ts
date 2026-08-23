// SPDX-License-Identifier: MIT
//
// INV-7: the prose passes the lint, run over the whole deck as a test.

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { PLAIN } from '../src/plain.ts';
import { lintDeepExtended } from '../src/lint3f.ts';
import { lintDeep } from '../src/lint.ts';
import { BANNED_WORDS } from '../src/banned.ts';
import type { SectionKey } from '../src/types.ts';

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
