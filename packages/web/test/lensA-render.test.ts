// SPDX-License-Identifier: MIT
//
// What the fund report actually puts on the page, rendered through the shim.

import { ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';

import { installDom } from './dom-shim.ts';
import type { FakeElement } from './dom-shim.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...path: string[]): Record<string, unknown> =>
  JSON.parse(readFileSync(join(root, ...path), 'utf8')) as Record<string, unknown>;

const computed = read('fixtures', 'report_computed.json');
const computedSnapshot = read('data', 'RFLR', '2026-07.json');
const young = read('fixtures', 'report_blocked.json');
const youngSnapshot = read('data', 'LADM', '2026-10.json');
const lowFit = read('fixtures', 'report_low_fit.json');
const lowFitSnapshot = read('data', 'DBMF', '2026-10.json');

let installed: { root: unknown; uninstall: () => void } | null = null;
afterEach(() => {
  installed?.uninstall();
  installed = null;
});

async function render(
  report: unknown,
  snapshot: unknown,
  benchmark: string,
  months: string[] = ['2026-07'],
  history: ('6mo' | '13wk')[] = [],
  companions: { ticker: string; name: string }[] = [],
  benchmarkNote?: string,
) {
  installed = installDom();
  const { renderReport } = await import('../src/views/report.ts');
  const node = renderReport(
    {
      report: report as never,
      snapshot: snapshot as never,
      benchmark,
      months,
      earlier: new Map(),
      trendColumn: '13wk',
      history,
      companions,
      benchmarkNote,
    },
    {
      onBenchmark: () => {},
      onMonth: () => {},
      onHistory: () => {},
      onTrendColumn: () => {},
      onCompare: () => {},
      onBack: () => {},
    },
  );
  return { node: node as unknown as FakeElement, text: node.textContent as string };
}

test('the page leads with the money, and every group and column reaches it', async () => {
  const { text } = await render(computed, computedSnapshot, 'VOO');
  for (const heading of [
    'What happened to $100',
    'An average day, per $100',
    'For every 1% the market moved',
    'How closely it follows',
  ]) {
    ok(text.includes(heading), `missing group: ${heading}`);
  }
  for (const column of ['12 mo', '6 mo', '13 wk']) ok(text.includes(column), `missing: ${column}`);
  ok(text.indexOf('What happened to $100') < text.indexOf('For every 1% the market moved'));
});

test('the figures are dollars per $100, and the fall carries its sign in the text', async () => {
  const { text } = await render(computed, computedSnapshot, 'VOO');
  ok(/\$\d{2,3}\.\d\d/.test(text), 'no growth of $100 on the page');
  ok(/−\$\d+\.\d\d/.test(text), 'no signed fall on the page');
  ok(/\+\$\d\.\d\d/.test(text), 'no signed average day on the page');
  ok(/\d+%/.test(text), 'no share on the page');
});

test('the per-1% sentence reads the stored capture and says which window', async () => {
  const { node } = await render(computed, computedSnapshot, 'IWM');
  const lead = node.findAll('p').find((p) => p.getAttribute('class') === 'lead')!;
  const h = (computed['benchmarks'] as Record<string, { horizons: { up: { capture: number }; down: { capture: number } }[] }>)['IWM']!.horizons[0]!;
  const text = lead.textContent as string;
  ok(text.includes('Over the past twelve months'));
  ok(text.includes(`gained ${h.up.capture.toFixed(2)}% for every 1%`), text);
  ok(text.includes(`lost ${h.down.capture.toFixed(2)}% for every 1%`), text);
});

test('where the fund is barely tied to the market the sentence is replaced', async () => {
  const { node, text } = await render(lowFit, lowFitSnapshot, 'VOO', ['2026-10']);
  const lead = node.findAll('p').find((p) => p.getAttribute('class') === 'lead')!;
  ok((lead.textContent as string).includes('would not describe this fund'));
  ok(!(lead.textContent as string).includes('for every 1% the market gained'));
  ok(text.includes('What happened to $100'), 'the money rows have to stay');
});

test('the benchmark toggle moves capture and fit but not the fund’s own money', async () => {
  const read = (t: string, label: string) => t.slice(t.indexOf(label) + label.length, t.indexOf(label) + label.length + 24);
  const voo = (await render(computed, computedSnapshot, 'VOO')).text;
  const iwm = (await render(computed, computedSnapshot, 'IWM')).text;
  strictEqual(read(voo, 'In this fund'), read(iwm, 'In this fund'));
  strictEqual(read(voo, 'This fund’s deepest fall'), read(iwm, 'This fund’s deepest fall'));
  ok(read(voo, 'When the market rose') !== read(iwm, 'When the market rose'));
  ok(read(voo, 'Movement in line with the market') !== read(iwm, 'Movement in line with the market'));
});

test('nothing retired comes back', async () => {
  const { text, node } = await render(computed, computedSnapshot, 'VOO');
  ok(!text.includes('Fund up, market down'));
  ok(!text.includes('Fund down, market up'));
  ok(!text.includes('opposite directions'));
  ok(!text.includes('green row'));
  ok(!node.findAll('tr').some((r) => ['sought', 'avoided'].includes(r.getAttribute('class') ?? '')));
});

test('the detail section is closed, and holds only the two same-direction rows', async () => {
  const { node } = await render(computed, computedSnapshot, 'VOO');
  const details = node.findAll('details');
  for (const d of details) strictEqual(d.getAttribute('open'), null);
  const closer = details.filter((d) => (d.textContent as string).includes('A closer look'));
  strictEqual(closer.length, 1);
  const text = closer[0]!.textContent as string;
  ok(text.includes('Both went up'));
  ok(text.includes('Both went down'));
  ok(text.includes('A closer look'));
  ok(!text.includes('for every 1% the market moved, this fund moved'), 'the old claim came back');
});

test('a fund that does not use options is not told it does', async () => {
  const { text } = await render(lowFit, lowFitSnapshot, 'VOO', ['2026-10']);
  ok(!text.includes('uses options'), 'DBMF trades futures');
});

test('figures format as the reader would say them', async () => {
  installed = installDom();
  const { formatGap, formatMeasure } = await import('../src/views/report.ts');
  strictEqual(formatMeasure(0.001, 'day'), '$0.00');
  strictEqual(formatMeasure(-0.001, 'day'), '$0.00');
  strictEqual(formatMeasure(0.25, 'day'), '+$0.25');
  strictEqual(formatMeasure(-0.21, 'day'), '−$0.21');
  strictEqual(formatMeasure(108.9, 'money'), '$108.90');
  strictEqual(formatMeasure(-3.51, 'fall'), '−$3.51');
  strictEqual(formatGap(-1.2, 'share'), '−1 pt');
  strictEqual(formatGap(2.4, 'share'), '+2 pts');
  strictEqual(formatGap(0.2, 'share'), '0 pts');
  strictEqual(formatGap(-0.08, 'ratio'), '−0.08');
  strictEqual(formatGap(2.81, 'money'), '+$2.81');
});

test('the limits travel with the money', async () => {
  const { text } = await render(computed, computedSnapshot, 'VOO');
  for (const needed of ['distributions reinvested', 'Taxes', 'what comes next', 'outcome period', 'single sharp day']) {
    ok(text.includes(needed), `missing: ${needed}`);
  }
});

test('the benchmark ticker is told what it stands in for', async () => {
  const { text } = await render(computed, computedSnapshot, 'VOO');
  ok(text.includes('S&P 500'), 'the index VOO tracks never reaches the page');
  ok(text.includes('VOO is used here as a proxy for'), 'the ticker is not tied to its index');
});

test('no spec vocabulary reaches the page', async () => {
  const { text } = await render(computed, computedSnapshot, 'VOO');
  for (const jargon of ['semibeta', 'quadrant', 'Participation', 'Resilience', 'covariance', 'horizon', 'capture', 'R²']) {
    ok(!text.includes(jargon), `jargon leaked onto the page: ${jargon}`);
  }
});

test('the caveat appears for a defined-outcome fund', async () => {
  const { text } = await render(computed, computedSnapshot, 'VOO');
  ok(text.includes('Why the reading depends on when you look'));
});

test('the caveat is absent where the fund does not work that way', async () => {
  const plain = structuredClone(computed) as never as {
    methodology: { defined_outcome_caveat: boolean };
  };
  plain.methodology.defined_outcome_caveat = false;
  const { text } = await render(plain, computedSnapshot, 'VOO');
  ok(!text.includes('Why the reading depends on when you look'));
});

test('the detail legend explains the dot only where a dot can appear', async () => {
  const withBaseline = await render(computed, computedSnapshot, 'VOO');
  ok(withBaseline.text.includes('An amber dot marks'));
  const without = await render(young, youngSnapshot, 'VOO', ['2026-10']);
  ok(!without.text.includes('An amber dot marks'));
});

test('a fund with no twelve-month reading says so once, in the detail section', async () => {
  const { text } = await render(young, youngSnapshot, 'VOO', ['2026-10']);
  ok(text.includes('has not been trading for a full year'));
  ok(text.includes('Nothing in this table is marked as a shift'));
});

test('the legend always says a dash is not a zero', async () => {
  for (const [doc, snap] of [[computed, computedSnapshot], [young, youngSnapshot]]) {
    const { text } = await render(doc, snap, 'VOO');
    ok(/does not mean zero/.test(text), 'the dash is unexplained');
  }
});

test('a blocked column is explained with its remedy, not left blank', async () => {
  const { text } = await render(young, youngSnapshot, 'VOO', ['2026-10']);
  ok(text.includes('12 mo:'), 'the blocked column is not named');
  ok(text.includes('Read the shorter windows'), 'the remedy is missing');
});

test('the benchmark chooser appears only when there is a choice', async () => {
  const two = await render(computed, computedSnapshot, 'IWM');
  ok(two.text.includes('Compared against'));

  const one = structuredClone(computed) as never as { benchmarks: Record<string, unknown> };
  delete one.benchmarks['IWM'];
  const single = await render(one, computedSnapshot, 'VOO');
  ok(!single.text.includes('Compared against'), 'a chooser with one option looks like it does something');
});

test('the month chooser appears only when more than one report exists', async () => {
  const many = await render(computed, computedSnapshot, 'VOO', ['2026-06', '2026-07']);
  ok(many.text.includes('Report from'));
  const one = await render(computed, computedSnapshot, 'VOO', ['2026-07']);
  ok(!one.text.includes('Report from'));
});

test('the as-of date and benchmark travel with the numbers (INV-1)', async () => {
  const { text } = await render(computed, computedSnapshot, 'VOO');
  ok(text.includes('Worked out from daily closing prices up to'));
  ok(text.includes(String(computed['as_of'])));
  ok(text.includes('“The market” here means VOO'));
});

test('the benchmark note shown is the reader’s one, not the registry’s own', async () => {
  const plain = 'The comparison here is a near match rather than an exact one.';
  const { text } = await render(computed, computedSnapshot, 'IWM', ['2026-07'], [], [], plain);
  ok(text.includes(plain), 'the reader-facing note is missing');

  const provenance = (
    (computedSnapshot['benchmarks'] as Record<string, { benchmark_note?: string }>)['IWM'] ?? {}
  ).benchmark_note;
  ok(provenance, 'the snapshot no longer carries a provenance note to be kept off the page');
  ok(!text.includes(provenance), 'the registry’s own note reached the page');
});

test('the way through to the history view is offered only where the archive can answer', async () => {
  const none = await render(computed, computedSnapshot, 'VOO', ['2026-07'], []);
  ok(none.text.includes('This fund is too new for this comparison'));
  ok(!none.text.includes('Against six months ago'));

  const both = await render(computed, computedSnapshot, 'VOO', ['2026-01', '2026-04', '2026-07'], ['6mo', '13wk']);
  ok(both.text.includes('Against six months ago'));
  ok(both.text.includes('Against thirteen weeks ago'));
});
