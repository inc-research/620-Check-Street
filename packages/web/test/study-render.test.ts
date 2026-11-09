// SPDX-License-Identifier: MIT
//
// The Gain Exposure selected report as a reader sees it, built from the committed
// document (3F D-25).

import { ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';

import { installDom } from './dom-shim3f.ts';
import type { FakeElement } from './dom-shim.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const doc = () => JSON.parse(readFileSync(join(root, 'data', '_studies', 'gain-exposure-2026-11.json'), 'utf8'));

let installed: { uninstall: () => void } | null = null;
afterEach(() => {
  installed?.uninstall();
  installed = null;
});

async function render(): Promise<FakeElement> {
  installed = installDom();
  const { renderGainExposure } = await import('../src/views/study/gainExposure.ts');
  return renderGainExposure(doc(), { onBack: () => {} }) as unknown as FakeElement;
}

const tableOf = (node: FakeElement, firstHeader: string, nth = 0) =>
  node.findAll('table').filter((t) => t.findAll('th')[0]?.textContent === firstHeader)[nth]!;

test('every fund has a row in the Gain Exposure table', async () => {
  const node = await render();
  const d = doc();
  const rows = tableOf(node, 'Fund').findAll('tbody')[0]!.findAll('tr').filter((r) => !(r.getAttribute('class') ?? '').startsWith('group'));
  strictEqual(rows.length, d.funds.length);
});

test('the cards show the published medians', async () => {
  const node = await render();
  const values = node.findByClass('hero-value').map((e) => e.textContent);
  const d = doc();
  ok(values.includes(d.summaries.named['group:synthetic_long'].E.median.toFixed(2)));
  ok(values.includes(d.summaries.named['subgroup:index_etf_sleeve'].E.median.toFixed(2)));
  ok(values[0]!.startsWith('−4.37'));
});

test('the sub-group is named in words, never by the fund it holds', async () => {
  const text = (await render()).textContent;
  ok(text.includes('Stocks held through an index ETF'));
  ok(!text.includes('Held in IVV'));
});

test('switching to VOO reads every row against VOO', async () => {
  const node = await render();
  const sel = node.findAll('select').find((s) => s.getAttribute('id') === 'study-basis')!;
  sel.value = 'VOO';
  sel.dispatch('change');
  const against = tableOf(node, 'Fund').findAll('tbody')[0]!.findAll('tr')
    .filter((r) => !(r.getAttribute('class') ?? '').startsWith('group'))
    .map((r) => r.findAll('td')[2]!.textContent);
  ok(against.every((b) => b === 'VOO'));
});

test('the charts are drawn, one K and one row per fund in the exposure chart', async () => {
  const node = await render();
  ok(node.findAll('svg').length >= 4);
  ok(node.findByClass('fd-up').length >= 1);
  strictEqual(node.findByClass('ci').length, doc().funds.filter((f: { readings: Record<string, { E_range: unknown }>; named_benchmark: string | null }) =>
    f.readings[f.named_benchmark ?? 'VOO']!.E_range).length);
});

test('the limits carry the quarter-to-quarter caveat', async () => {
  ok((await render()).textContent.includes('moves from one quarter to the next'));
});
