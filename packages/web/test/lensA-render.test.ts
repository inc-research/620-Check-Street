// SPDX-License-Identifier: MIT
//
// What the report table actually puts on the page, rendered through the shim.

import { ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';

import { installDom } from './dom-shim.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const load = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(root, 'fixtures', name), 'utf8')) as Record<string, unknown>;

const computed = load('snapshot_computed.json');
const noBaseline = load('snapshot_blocked.json');

let installed: { root: unknown; uninstall: () => void } | null = null;
afterEach(() => {
  installed?.uninstall();
  installed = null;
});

async function render(
  snapshot: unknown,
  benchmark: string,
  months: string[] = ['2026-07'],
  history: ('6mo' | '13wk')[] = [],
) {
  installed = installDom();
  const { renderReport } = await import('../src/views/report.ts');
  const node = renderReport(
    { snapshot: snapshot as never, benchmark, months, history },
    { onBenchmark: () => {}, onMonth: () => {}, onHistory: () => {}, onBack: () => {} },
  );
  return { node, text: node.textContent as string };
}

test('the table names every row and column in the reader’s words', async () => {
  const { text } = await render(computed, 'VOO');
  for (const label of ['Both went up', 'Both went down', 'Fund up, market down', 'Fund down, market up']) {
    ok(text.includes(label), `missing row: ${label}`);
  }
  for (const column of ['12 mo', '6 mo', '13 wk']) {
    ok(text.includes(column), `missing column: ${column}`);
  }
  ok(text.includes('When they moved the same way'));
  ok(text.includes('When they moved in opposite directions'));
});

test('no spec vocabulary reaches the page', async () => {
  const { text } = await render(computed, 'VOO');
  for (const jargon of ['semibeta', 'quadrant', 'Participation', 'Resilience', 'covariance', 'horizon']) {
    ok(!text.includes(jargon), `jargon leaked onto the page: ${jargon}`);
  }
});

test('the caveat appears for a defined-outcome fund', async () => {
  const { text } = await render(computed, 'VOO');
  ok(text.includes('Why the reading depends on when you look'));
});

test('the caveat is absent where the fund does not work that way', async () => {
  const plain = structuredClone(computed) as never as {
    methodology: { defined_outcome_caveat: boolean };
  };
  plain.methodology.defined_outcome_caveat = false;
  const { text } = await render(plain, 'VOO');
  ok(!text.includes('Why the reading depends on when you look'));
});

test('the legend explains the dot only where a dot can appear', async () => {
  const withBaseline = await render(computed, 'VOO');
  ok(withBaseline.text.includes('An amber dot marks'));

  // A legend entry for a marker the reader cannot find is a puzzle with no
  // answer, so it is omitted where no cell can carry one.
  const without = await render(noBaseline, 'VOO');
  ok(!without.text.includes('An amber dot marks'));
});

test('a fund with no twelve-month reading says so once, above the table', async () => {
  const { text } = await render(noBaseline, 'VOO');
  ok(text.includes('has not been trading for a full year'));
  ok(text.includes('Nothing in this table is marked as a shift'));
});

test('the legend always says a dash is not a zero', async () => {
  for (const doc of [computed, noBaseline]) {
    const { text } = await render(doc, 'VOO');
    ok(/does not mean zero/.test(text), 'the dash is unexplained');
  }
});

test('a blocked column is explained with its remedy, not left blank', async () => {
  const { text } = await render(noBaseline, 'VOO');
  ok(text.includes('12 mo:'), 'the blocked column is not named');
  ok(text.includes('Read the shorter windows'), 'the remedy is missing');
});

test('the benchmark chooser appears only when there is a choice', async () => {
  const two = await render(computed, 'EFA');
  ok(two.text.includes('Compared against'));

  const one = structuredClone(computed) as never as { benchmarks: Record<string, unknown> };
  delete one.benchmarks['EFA'];
  const single = await render(one, 'VOO');
  ok(!single.text.includes('Compared against'), 'a chooser with one option looks like it does something');
});

test('the month chooser appears only when more than one report exists', async () => {
  const many = await render(computed, 'VOO', ['2026-06', '2026-07']);
  ok(many.text.includes('Report from'));
  const one = await render(computed, 'VOO', ['2026-07']);
  ok(!one.text.includes('Report from'));
});

test('the as-of date and benchmark travel with the numbers (INV-1)', async () => {
  const { text } = await render(computed, 'VOO');
  ok(text.includes('Worked out from daily closing prices up to'));
  ok(text.includes(String(computed['as_of'])));
});

test('a benchmark note from the registry is shown, not dropped', async () => {
  const { text } = await render(computed, 'EFA');
  ok(text.includes('A synthetic fund'), 'the benchmark note is missing');
});

test('the way through to the history view is offered only where the archive can answer', async () => {
  // A button leading to "there is no report from that far back" is a promise
  // the page cannot keep, and the reader cannot tell in advance which it is.
  const none = await render(computed, 'VOO', ['2026-07'], []);
  ok(none.text.includes('This fund is too new for this comparison'));
  ok(!none.text.includes('Against six months ago'));

  const both = await render(computed, 'VOO', ['2026-01', '2026-04', '2026-07'], ['6mo', '13wk']);
  ok(both.text.includes('Against six months ago'));
  ok(both.text.includes('Against thirteen weeks ago'));
});
