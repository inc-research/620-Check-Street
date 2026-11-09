// SPDX-License-Identifier: MIT
//
// INV-7: the prose passes the lint, run over the whole deck as a test.

import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict';
import { test } from 'node:test';

import { PLAIN, TABLE } from '../src/plain.ts';
import { BENCHMARK_INDEX, benchmarkIndexNote, benchmarkIndexShort } from '../src/benchmarks.ts';
import { lintDeepExtended } from '../src/lint3f.ts';
import { lintDeep } from '../src/lint.ts';
import { BANNED_WORDS } from '../src/banned.ts';
import type { HorizonKey, SectionKey, StateKey } from '../src/types.ts';

const SECTIONS: SectionKey[] = [
  'overview',
  'money',
  'exposure',
  'follows',
  'participation',
  'horizons',
  'benchmark_choice',
  'outcome_period',
  'thin_data',
  'capture_trend',
  'history',
  'observer',
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
];
const COLUMNS: HorizonKey[] = ['12mo', '6mo', '13wk'];

test('the table copy passes both lints', () => {
  deepStrictEqual(lintDeep(TABLE), []);
  deepStrictEqual(lintDeepExtended(TABLE), [], JSON.stringify(lintDeepExtended(TABLE), null, 2));
});

test('every detail row has a label and a spelled-out form', () => {
  deepStrictEqual(Object.keys(TABLE.rows).sort(), [...STATES].sort());
  for (const state of STATES) {
    ok(TABLE.rows[state].label.trim().length > 0, `${state} has no label`);
    ok(TABLE.rows[state].full.trim().length > 0, `${state} has no spelled-out form`);
  }
});

test('every measure has a label and a spelled-out form', () => {
  for (const [key, row] of Object.entries(TABLE.measures)) {
    ok(row.label.trim().length > 0, `${key} has no label`);
    ok(row.full.trim().length > 0, `${key} has no spelled-out form`);
  }
});

test('the per-1% sentences say what the number is, and name its placeholder', () => {
  // The sentence the survey found false on the semibeta table is now the
  // headline, so what it may say is pinned here (3F D-17).
  for (const key of ['up', 'upOpposite'] as const) {
    ok(TABLE.perOne[key].includes('{ratio}%'), `${key} has no ratio`);
    ok(TABLE.perOne[key].includes('1%'), `${key} does not say per 1%`);
  }
  // The down side leads with the loss buffer and still says what was carried per
  // 1%, so the buffer is never read without the loss it stands for.
  for (const key of ['down', 'downOpposite', 'downDeeper'] as const) {
    ok(TABLE.perOne[key].includes('{buffer}'), `${key} does not name the loss buffer`);
    ok(TABLE.perOne[key].includes('{carried}%'), `${key} does not say what was carried`);
    ok(TABLE.perOne[key].includes('1%'), `${key} does not say per 1%`);
  }
  ok(TABLE.perOne.lowFit.includes('{share}%'));
  ok(TABLE.perOne.lowFit.includes('{benchmark}'));
});

test('the limits say what the money figures cannot', () => {
  const blob = TABLE.limits.items.join(' ').toLowerCase();
  for (const needed of ['distributions', 'taxes', 'what comes next', 'outcome period', 'a single sharp day']) {
    ok(blob.includes(needed), `the limits do not mention ${needed}`);
  }
});

test('the detail section does not claim to confirm the capture figures', () => {
  const blob = `${TABLE.detail.intro} ${PLAIN.participation.mechanism}`.toLowerCase();
  ok(!/confirm|prove|verif/.test(blob));
});

test('nothing retired comes back: no opposite-direction section, no row tint', () => {
  ok(!('resilience' in PLAIN));
  ok(!('resilience' in TABLE));
  ok(!('tint' in TABLE.legend));
});

test('every shipping column has a heading and a spelled-out form', () => {
  deepStrictEqual(Object.keys(TABLE.columns).sort(), [...COLUMNS].sort());
  for (const c of COLUMNS) {
    ok(TABLE.columns[c].short.trim().length > 0);
    ok(TABLE.columns[c].full.trim().length > 0);
  }
});

test('the legend explains every marker the table can draw', () => {
  for (const key of ['shift', 'thin', 'blocked', 'noBaseline'] as const) {
    ok(TABLE.legend[key].length > 30, `legend.${key} is too short to explain anything`);
  }
});

test('the comparison copy explains every marker and every absence it can draw', () => {
  for (const key of ['blurb', 'sameEverythingElse', 'marked', 'alike', 'unavailable', 'window'] as const) {
    ok(
      TABLE.comparison[key].length > 30,
      `comparison.${key} is too short to explain anything`,
    );
  }
});

test('the comparison says a dash is not two funds agreeing', () => {
  // The same trap as the report's own dash, one step further along: here a
  // missing reading could be misread as the two funds having behaved alike,
  // which is a claim rather than an absence (INV-2).
  ok(/does not mean the two were the same/i.test(TABLE.comparison.unavailable));
});

test('the comparison states the constraint that makes it mean anything', () => {
  // Same month, same window length, same market on both sides. If any of those
  // moved, the gap in the table would be partly the funds and partly the
  // conditions, with nothing on the page to separate them.
  const blob = TABLE.comparison.sameEverythingElse.toLowerCase();
  ok(blob.includes('same month'));
  ok(blob.includes('same length of time'));
  ok(blob.includes('same market'));
});

test('the comparison says why both readings are shown and not only the gap', () => {
  // Measured on the archive: a gap of +0.30 turns up with the higher fund
  // anywhere from +0.04 to +0.71 (3F D-14).
  ok(TABLE.comparison.window.includes('0.30'));
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

// --- the benchmark index lines ------------------------------------------------

test('the benchmark index lines pass both lints', () => {
  deepStrictEqual(lintDeep(BENCHMARK_INDEX), [], 'vendored lint');
  deepStrictEqual(lintDeepExtended(BENCHMARK_INDEX), [], 'extended lint');
});

test('every declared anchor says which index it stands in for', () => {
  // The four in tickers.json. A fifth anchor must be written up before it can
  // be offered, which is why this list is stated and not derived.
  for (const ticker of ['VOO', 'QQQ', 'IWM', 'EFA']) {
    const entry = BENCHMARK_INDEX[ticker];
    ok(entry, `no index line for ${ticker}`);
    ok(entry.short.length > 0, `${ticker} has no short index name`);
    ok(entry.note.includes(ticker), `${ticker}'s note does not name the ticker`);
  }
});

test('a ticker with no line written returns nothing rather than a guess', () => {
  strictEqual(benchmarkIndexNote('ZZZZ'), '');
  strictEqual(benchmarkIndexShort('ZZZZ'), '');
});

// Selected reports (3F D-25): the same lint over every sentence the page can show.
import { GAIN_EXPOSURE, SELECTED, STUDY_LABELS } from '../src/studies.ts';

test('the Gain Exposure report passes the lint', () => {
  deepStrictEqual(lintDeep(GAIN_EXPOSURE), [], JSON.stringify(lintDeep(GAIN_EXPOSURE), null, 2));
  deepStrictEqual(lintDeepExtended(GAIN_EXPOSURE), [], JSON.stringify(lintDeepExtended(GAIN_EXPOSURE), null, 2));
  deepStrictEqual(lintDeepExtended(STUDY_LABELS), []);
  deepStrictEqual(lintDeepExtended(SELECTED), []);
});

test('the index-ETF sub-group reads the same everywhere it is named', () => {
  strictEqual(STUDY_LABELS.subgroups.index_etf_sleeve, 'Stocks held through an index ETF');
  ok(STUDY_LABELS.bandRows['subgroup:index_etf_sleeve'].endsWith('stocks held through an index ETF'));
  ok(!JSON.stringify({ GAIN_EXPOSURE, STUDY_LABELS }).includes('IVV'));
});
