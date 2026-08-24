// SPDX-License-Identifier: MIT
//
// What the comparison view puts on the page, and what it refuses to.

import { ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';

import { installDom } from './dom-shim.ts';
import type { FakeElement } from './dom-shim.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const base = JSON.parse(
  readFileSync(join(root, 'fixtures', 'snapshot_computed.json'), 'utf8'),
) as Record<string, unknown>;

let installed: { uninstall: () => void } | null = null;
afterEach(() => {
  installed?.uninstall();
  installed = null;
});

function other(ticker: string, mutate: (s: never) => void = () => {}): Record<string, unknown> {
  const doc = structuredClone(base);
  doc['ticker'] = ticker;
  doc['name'] = `${ticker} Test Fund`;
  mutate(doc as never);
  return doc;
}

type Column = { horizon: string; states: Record<string, { raw_semibeta: number | null }> | null; blockers: unknown[] };
function column(doc: Record<string, unknown>, benchmark: string, horizon: string): Column {
  const blocks = doc['benchmarks'] as Record<string, { horizons: Column[] }>;
  return blocks[benchmark]!.horizons.find((h) => h.horizon === horizon)!;
}

async function render(
  b: Record<string, unknown>,
  horizon: '12mo' | '6mo' | '13wk' = '12mo',
  horizons: ('12mo' | '6mo' | '13wk')[] = ['12mo', '6mo', '13wk'],
  months: string[] = ['2026-07'],
  others: { ticker: string; name: string }[] = [],
) {
  installed = installDom();
  const { renderCompare } = await import('../src/views/compare.ts');
  const node = renderCompare(
    { a: base as never, b: b as never, benchmark: 'VOO', horizon, horizons, months, others },
    { onHorizon: () => {}, onMonth: () => {}, onOther: () => {}, onBack: () => {} },
  );
  return { node: node as unknown as FakeElement, text: node.textContent as string };
}

/** Every `option` under the select with this id. */
function optionsOf(node: FakeElement, id: string): FakeElement[] {
  const select = node.findAll('select').find((e) => e.getAttribute('id') === id);
  return select ? select.findAll('option') : [];
}

function hasSelect(node: FakeElement, id: string): boolean {
  return node.findAll('select').some((e) => e.getAttribute('id') === id);
}

test('both funds are named, and both readings reach the page beside the gap', async () => {
  // A gap of +0.30 turns up across the archive with the higher fund anywhere
  // from +0.04 to +0.71, so the levels are not decoration (3F D-14).
  const { text } = await render(other('AAAA'));
  ok(text.includes(base['ticker'] as string), 'the first fund is unnamed');
  ok(text.includes('AAAA'), 'the second fund is unnamed');
  ok(text.includes('Difference'));
  ok(text.includes('does not say much'), 'the reason both levels are shown is not explained');
});

test('the figures never leave the page without what they were worked out from (INV-1)', async () => {
  const { text } = await render(other('AAAA'));
  ok(text.includes('the past twelve months'), 'the window length is missing');
  ok(text.includes('against VOO'), 'the benchmark is missing');
  ok(text.includes('Window:'), 'the exact window dates are missing');
  ok(text.includes('the same month'), 'the same-month constraint is not stated');
});

test('a difference is signed in the text, not only in colour', async () => {
  // The report has to survive greyscale and readers who do not separate red
  // from green (SF-21).
  const mine = column(base, 'VOO', '12mo').states!['fund_up_bench_up']!.raw_semibeta!;
  const { text } = await render(
    other('AAAA', (s) => {
      column(s as never, 'VOO', '12mo').states!['fund_up_bench_up']!.raw_semibeta = mine - 0.4;
    }),
  );
  ok(/\+0\.40/.test(text), `no signed difference in: ${text.slice(0, 400)}`);
});

test('a refused comparison draws no table at all', async () => {
  const { node, text } = await render(
    other('AAAA', (s) => {
      (s as unknown as Record<string, unknown>)['as_of'] = '2026-01-30';
    }),
  );
  strictEqual(node.findAll('table').length, 0, 'half a comparison is worse than none');
  ok(text.includes('covers 2026-01'), 'the refusal does not say which months disagreed');
  ok(text.includes('Compare the two funds in a month'), 'the refusal names no way out (INV-2)');
});

test('a fund set beside itself is refused rather than drawn as four zeroes', async () => {
  const { node, text } = await render(structuredClone(base));
  strictEqual(node.findAll('table').length, 0);
  ok(text.includes('beside itself'));
});

test('an uncomparable cell shows a dash, and the legend says a dash is not a nought', async () => {
  const { text } = await render(
    other('AAAA', (s) => {
      const cell = column(s as never, 'VOO', '12mo').states!['fund_up_bench_down']!;
      cell.raw_semibeta = null;
      const full = cell as unknown as Record<string, unknown>;
      full['score'] = null;
      full['data_sufficiency'] = 'blocked';
      full['blockers'] = [
        { code: 'quadrant_empty', message: 'Too few days.', remedy: 'Read a longer window.', subjects: [] },
      ];
    }),
  );
  ok(text.includes('—'), 'no dash was drawn');
  ok(text.includes('does not mean the two were the same'), 'the dash is not disambiguated');
});

test('only the windows both funds can answer are offered', async () => {
  const { node } = await render(other('AAAA'), '12mo', ['12mo', '6mo']);
  const options = optionsOf(node, 'compare-window').map((o) => o.textContent);
  strictEqual(options.length, 2);
  ok(!options.some((o) => o.includes('thirteen weeks')));
});

test('a single available window offers no chooser at all', async () => {
  // A control with one option is a control that looks like it does something.
  const { node } = await render(other('AAAA'), '12mo', ['12mo']);
  strictEqual(hasSelect(node, 'compare-window'), false);
});

test('the other side of the comparison is pickable, with the current one selected', async () => {
  const { node } = await render(other('AAAA'), '12mo', ['12mo'], ['2026-07'], [
    { ticker: 'AAAA', name: 'AAAA Test Fund' },
    { ticker: 'BBBB', name: 'BBBB Test Fund' },
  ]);
  const options = optionsOf(node, 'other');
  strictEqual(options.length, 2);
  strictEqual(options[0]!.getAttribute('selected'), 'selected');
  strictEqual(options[1]!.getAttribute('selected'), null);
});

test('two real archived reports render end to end', async () => {
  // The fixtures are synthetic by design (FF D-31). The archive is committed,
  // so the view can also be run against two documents the notebook actually
  // wrote — which is what catches a shape the fixture happens not to have.
  const a = JSON.parse(readFileSync(join(root, 'data', 'BUFR', '2026-07.json'), 'utf8'));
  const b = JSON.parse(readFileSync(join(root, 'data', 'DBMF', '2026-07.json'), 'utf8'));

  installed = installDom();
  const { renderCompare } = await import('../src/views/compare.ts');
  const node = renderCompare(
    {
      a,
      b,
      benchmark: 'VOO',
      horizon: '12mo',
      horizons: ['12mo', '6mo', '13wk'],
      months: ['2026-06', '2026-07'],
      others: [{ ticker: 'DBMF', name: b.name }],
    },
    { onHorizon: () => {}, onMonth: () => {}, onOther: () => {}, onBack: () => {} },
  );
  const text = node.textContent as string;

  ok(text.includes('BUFR') && text.includes('DBMF'));
  ok(text.includes('2025-07-31') && text.includes('2026-07-31'), 'the real window dates are missing');
  strictEqual((node as unknown as FakeElement).findAll('table').length, 1);
});
