// SPDX-License-Identifier: MIT
//
// What the history view puts on the page, and what it refuses to.

import { ok } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';

import { installDom } from './dom-shim.ts';
import type { FakeElement } from './dom-shim.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const base = JSON.parse(
  readFileSync(join(root, 'fixtures', 'report_computed.json'), 'utf8'),
) as Record<string, unknown>;

let installed: { uninstall: () => void } | null = null;
afterEach(() => {
  installed?.uninstall();
  installed = null;
});

type Column = {
  horizon: string;
  growth: unknown;
  up: { capture: number } | null;
  down: unknown;
  worst_fall: unknown;
  fit: unknown;
  days_total: number;
  blockers: unknown[];
};
function six(doc: Record<string, unknown>): Column {
  const blocks = doc['benchmarks'] as Record<string, { horizons: Column[] }>;
  return blocks['VOO']!.horizons.find((h) => h.horizon === '6mo')!;
}

function past(month: string, mutate: (s: Record<string, unknown>) => void = () => {}) {
  const doc = structuredClone(base);
  doc['as_of'] = `${month}-30`;
  mutate(doc);
  return doc;
}

async function render(
  previous: unknown,
  lookback: '6mo' | '13wk' = '6mo',
  available: ('6mo' | '13wk')[] = ['6mo', '13wk'],
) {
  installed = installDom();
  const { renderHistory } = await import('../src/views/history.ts');
  const node = renderHistory(
    { current: base as never, previous: previous as never, benchmark: 'VOO', lookback, available },
    { onLookback: () => {}, onBack: () => {} },
  );
  return { node: node as unknown as FakeElement, text: node.textContent as string };
}

test('both periods are named, and the table says they share no days', async () => {
  const { text } = await render(past('2026-01'));
  ok(text.includes('January 2026'));
  ok(text.includes('July 2026'));
  ok(text.includes('share no days'));
});

test('the exact window dates travel with the numbers (INV-1)', async () => {
  const { text } = await render(past('2026-01'));
  ok(text.includes('Earlier period:'));
  ok(text.includes('Current period:'));
  ok(text.includes('measured against VOO'));
});

test('the fund’s money and the market’s money are both on the table', async () => {
  const { text } = await render(past('2026-01'));
  ok(text.includes('In this fund'));
  ok(text.includes('In the market'));
  ok(text.includes('Upside capture'));
});

test('the two average-day rows can be told apart without the market rows above them', async () => {
  const { text } = await render(past('2026-01'));
  ok(text.includes('This fund, on the market’s rising days'));
  ok(text.includes('This fund, on the market’s falling days'));
});

test('a change is signed in the text, not only in colour', async () => {
  const { text } = await render(
    past('2026-01', (s) => {
      six(s).up!.capture = 0.1;
    }),
  );
  ok(/[+−]\d\.\d\d/.test(text), `no signed change found in: ${text.slice(0, 400)}`);
});

test('no dot is drawn, however far a reading moved', async () => {
  const { node, text } = await render(
    past('2026-01', (s) => {
      six(s).up!.capture = 3;
    }),
  );
  ok(!node.findAll('span').some((e) => e.getAttribute('class') === 'shift-dot'));
  ok(!text.includes('amber'));
});

test('the page warns that the money figures also carry the market', async () => {
  const { text } = await render(past('2026-01'));
  ok(text.includes('often the market and not the fund'));
});

test('a mismatched version is refused with a reason, and no table is drawn', async () => {
  const { text } = await render(
    past('2026-01', (s) => {
      s['report_schema_version'] = '3.0';
    }),
  );
  ok(text.includes('worked out in different ways'));
  ok(!text.includes('Before'), 'a refused comparison still drew its table');
});

test('a period that could not be worked out is refused, not half-shown', async () => {
  const { text } = await render(
    past('2026-01', (s) => {
      const column = six(s);
      column.growth = null;
      column.up = null;
      column.down = null;
      column.worst_fall = null;
      column.fit = null;
      column.days_total = 0;
      column.blockers = [{ code: 'window_shorter_than_horizon', message: 'Not enough history.', remedy: 'Wait for more.' }];
    }),
  );
  ok(text.includes('could not be worked out'));
  ok(!text.includes('Before'), 'a refused comparison still drew its table');
});

test('the legend says a dash is not a reading of nought', async () => {
  const { text } = await render(past('2026-01'));
  ok(text.includes('does not mean the reading was nought'));
});

test('the lookback chooser appears only when both are available', async () => {
  const both = await render(past('2026-01'), '6mo', ['6mo', '13wk']);
  ok(both.text.includes('Against six months ago'));
  ok(both.text.includes('Against thirteen weeks ago'));

  const one = await render(past('2026-01'), '6mo', ['6mo']);
  ok(!one.text.includes('Against thirteen weeks ago'));
});

test('no spec vocabulary reaches the page', async () => {
  const { text } = await render(past('2026-01'));
  for (const jargon of ['semibeta', 'quadrant', 'Lens', 'horizon', 'lookback']) {
    ok(!text.includes(jargon), `jargon leaked onto the page: ${jargon}`);
  }
});
