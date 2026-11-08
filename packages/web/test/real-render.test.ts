// SPDX-License-Identifier: MIT
//
// The section after the money rows: costs, the adviser's fee and inflation
// (3F D-22, D-23), rendered through the shim.

import { ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';

import { installDom } from './dom-shim.ts';
import type { FakeElement } from './dom-shim.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const report = JSON.parse(readFileSync(join(root, 'fixtures', 'report_computed.json'), 'utf8')) as Record<string, unknown>;

// Prices published to June 2026 only, so the July windows lean on a stand-in.
const cpi = {
  app: 'Third Floor', rates_schema_version: '1.0', series_id: 'CPIAUCNS', title: '', units: '',
  frequency: 'monthly', source: 'fred_api', source_url: '', fetched_at: '', missing_days_dropped: 0,
  observations: [['2025-07-01', 100], ['2026-01-01', 101], ['2026-05-01', 102], ['2026-06-01', 103]],
};
const bills = {
  ...cpi, series_id: 'DGS3MO', frequency: 'daily',
  observations: [['2025-07-01', 4], ['2026-07-31', 4]],
};

function fees(ticker: string, management: number, acquired: number) {
  const gross = management + acquired;
  return {
    app: 'Third Floor', fees_schema_version: '1.0', ticker, role: 'fund', month: '2026-07', as_of: '2026-07-31',
    generated_at: '', already_in_returns: true, effective_date_note: '',
    fees: {
      management, distribution_12b1: 0, other: 0, acquired_funds: acquired, gross, waiver: 0, net: gross,
      source: { kind: 'sec_xbrl', form: '485BPOS', filed: '2026-02-27', accession: null, url: 'u', series_id: null, class_id: null, note: null },
    },
    blockers: [],
  };
}

let installed: { uninstall: () => void } | null = null;
afterEach(() => {
  installed?.uninstall();
  installed = null;
});

async function render(adviser: boolean, fundFees: unknown = fees('RFLR', 0.0089, 0)) {
  installed = installDom();
  const { renderReal } = await import('../src/views/real.ts');
  let toggled: boolean | null = null;
  const node = renderReal(
    {
      report: report as never,
      benchmark: 'VOO',
      rates: { cpi: cpi as never, bills: bills as never },
      fundFees: fundFees as never,
      marketFees: fees('VOO', 0.0003, 0) as never,
      adviser,
    },
    (on) => { toggled = on; },
  );
  return { node: node as unknown as FakeElement, text: node.textContent as string, toggled: () => toggled };
}

test('the fund’s costs are stated as already inside the figures', async () => {
  const { text } = await render(true);
  ok(text.includes('0.89% a year'));
  ok(text.includes('already inside every figure'));
  ok(text.includes('VOO costs 0.03% a year'));
});

test('a fund of funds names what goes to the funds it holds', async () => {
  const { text } = await render(true, fees('RFLR', 0.001, 0.0085));
  ok(text.includes('0.10% to its manager and 0.85% to the funds it holds'));
});

test('the adviser’s fee starts on, and the box says so', async () => {
  const { node, text } = await render(true);
  const box = node.findAll('input')[0]!;
  strictEqual(box.getAttribute('checked'), 'checked');
  ok(text.includes('1% a year is taken off the fund, the market and the bills alike'));
});

test('switched off, it says no fee is taken', async () => {
  const { node, text } = await render(false);
  strictEqual(node.findAll('input')[0]!.getAttribute('checked'), null);
  ok(text.includes('No adviser’s fee is taken off'));
});

test('three rows of money and one of prices, across three columns', async () => {
  const { node, text } = await render(true);
  for (const label of ['$100 in this fund', '$100 in the market', '$100 in Treasury bills', 'Prices rose by']) {
    ok(text.includes(label), `missing: ${label}`);
  }
  strictEqual(node.findAll('tbody')[0]!.findAll('tr').length, 4);
});

test('a month whose prices are not out yet is marked, and the stand-in named', async () => {
  const { node, text } = await render(true);
  const marked = node.findByClass('thin-mark');
  ok(marked.length > 0);
  ok((marked[0]!.getAttribute('title') ?? '').includes('June 2026 stands in'));
  ok(text.includes('dotted underline'));
});

test('without the rate series the section says so and draws no table', async () => {
  installed = installDom();
  const { renderReal } = await import('../src/views/real.ts');
  const node = renderReal(
    { report: report as never, benchmark: 'VOO', rates: null, fundFees: null, marketFees: null, adviser: true },
    () => {},
  ) as unknown as FakeElement;
  strictEqual(node.findAll('table').length, 0);
  ok((node.textContent as string).includes('could not be read'));
});
