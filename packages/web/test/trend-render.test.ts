// SPDX-License-Identifier: MIT
//
// The capture-over-time section as a reader sees it, built from committed reports.

import { ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';

import { installDom } from './dom-shim.ts';
import type { FakeElement } from './dom-shim.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const report = (ticker: string, month: string) =>
  JSON.parse(readFileSync(join(root, 'data', '_reports', ticker, `${month}.json`), 'utf8'));

const MONTHS = ['2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04'];
const earlierFor = (ticker: string, months = MONTHS) =>
  new Map(months.map((m) => [m, report(ticker, m)]));

let installed: { uninstall: () => void } | null = null;
let lastNode: FakeElement | null = null;
afterEach(() => {
  installed?.uninstall();
  installed = null;
});

async function render(
  ticker: string,
  benchmark: string,
  column: '13wk' | '6mo' | '12mo',
  earlier: Map<string, unknown>,
) {
  installed = installDom();
  const { renderTrend } = await import('../src/views/trend.ts');
  const node = renderTrend(
    { report: report(ticker, '2026-10'), earlier: earlier as never, benchmark, column },
    () => {},
  );
  lastNode = node as unknown as FakeElement;
  return node.textContent as string;
}

test('a normal fund shows its levels, its changes and the market', async () => {
  const text = await render('RFLR', 'IWM', '13wk', earlierFor('RFLR'));
  ok(text.includes('Market-up days'));
  ok(text.includes('Market-down days'));
  ok(text.includes('$100 in the market'));
  ok(text.includes('Since September 2026'));
  ok(/[+−]\d+\.\d%/.test(text), 'the month’s percentage is printed');
  ok(/was \d\.\d\d/.test(text), 'the earlier level sits beside it');
  ok(/\d\.\d\d then/.test(text));
  ok(text.includes('within 0.13') && text.includes('0.14'));
});

test('each window states its own overlap and bands', async () => {
  const text = await render('RFLR', 'IWM', '12mo', earlierFor('RFLR'));
  ok(text.includes('eleven twelfths'));
  ok(text.includes('within 0.04'));
});

test('nothing on the section sets one side against the other', async () => {
  const text = await render('RFLR', 'IWM', '13wk', earlierFor('RFLR'));
  ok(!/spread|asymmetr|up-minus-down|widen|narrow/i.test(text));
});

test('no change or direction is coloured, because more of a fall is not good news', async () => {
  await render('RFLR', 'IWM', '13wk', earlierFor('RFLR'));
  const spans = lastNode!.findAll('span');
  ok(spans.length > 0);
  for (const s of spans) {
    const cls = s.getAttribute('class') ?? '';
    ok(!/\b(above|below)\b/.test(cls), `coloured span: ${cls}`);
  }
});

test('a fund the benchmark barely describes gets the sentence, not the figures', async () => {
  const text = await render('DBMF', 'VOO', '13wk', earlierFor('DBMF'));
  ok(text.includes('too little for these figures to describe the fund'));
  ok(!text.includes('Month by month'));
});

test('a young fund reads the month it has and dashes the rest', async () => {
  const text = await render('LADM', 'VOO', '13wk', earlierFor('LADM', ['2026-09']));
  ok(text.includes('Since September 2026'));
  ok(text.includes('—'));
  ok(text.includes('does not mean nought'));
});

test('an earlier report that failed to load costs only its own cells', async () => {
  const text = await render('RFLR', 'IWM', '13wk', new Map());
  ok(text.includes('Market-up days'));
  ok(text.includes('—'));
  strictEqual(/\d\.\d\d then/.test(text), false);
});

test('a window this fund cannot answer falls back to one it can', async () => {
  const text = await render('LADM', 'VOO', '12mo', earlierFor('LADM', ['2026-09']));
  ok(text.includes('thirteen-week periods'));
  ok(!text.includes('could not be worked out'));
});
