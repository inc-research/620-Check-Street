// SPDX-License-Identifier: MIT
//
// What the history view puts on the page, and what it refuses to.

import { ok, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';

import { installDom } from './dom-shim.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const base = JSON.parse(
  readFileSync(join(root, 'fixtures', 'snapshot_computed.json'), 'utf8'),
) as Record<string, never>;

let installed: { uninstall: () => void } | null = null;
afterEach(() => {
  installed?.uninstall();
  installed = null;
});

function past(month: string, mutate: (s: never) => void = () => {}): Record<string, never> {
  const doc = structuredClone(base);
  (doc as Record<string, unknown>)['as_of'] = `${month}-31`;
  mutate(doc as never);
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
  return { node, text: node.textContent as string };
}

test('both periods are named, and the table says they share no days', async () => {
  const { text } = await render(past('2026-01'));
  ok(text.includes('January 2026'), 'the earlier month is unnamed');
  ok(text.includes('July 2026'), 'the current month is unnamed');
  ok(text.includes('share no days'), 'the disjoint framing is missing');
  ok(text.includes('Before'));
  ok(text.includes('Since'));
  ok(text.includes('Change'));
});

test('the exact window dates travel with the numbers (INV-1)', async () => {
  const { text } = await render(past('2026-01'));
  ok(text.includes('Earlier period:'));
  ok(text.includes('Current period:'));
  ok(text.includes('measured against VOO'));
});

test('a change is signed in the text, not only in colour', async () => {
  // The report has to survive greyscale and readers who do not separate red
  // from green (SF-21).
  const { text } = await render(
    past('2026-01', (s) => {
      const doc = s as unknown as Record<string, never>;
      const cell = (doc['benchmarks'] as never as Record<string, { horizons: { horizon: string; states: Record<string, { raw_semibeta: number }> }[] }>)['VOO']!
        .horizons.find((h) => h.horizon === '6mo')!.states['fund_up_bench_up']!;
      cell.raw_semibeta = 0.10;
    }),
  );
  ok(/[+−]\d\.\d\d/.test(text), `no signed change found in: ${text.slice(0, 400)}`);
});

test('a mismatched version is refused with a reason, and no table is drawn', async () => {
  const { text } = await render(
    past('2026-01', (s) => {
      (s as unknown as Record<string, unknown>)['schema_version'] = '3.0';
    }),
  );
  ok(text.includes('worked out in different ways'));
  ok(!text.includes('Before'), 'a refused comparison still drew its table');
});

test('a period that could not be worked out is refused, not half-shown', async () => {
  const { text } = await render(
    past('2026-01', (s) => {
      const doc = s as unknown as Record<string, never>;
      const column = (doc['benchmarks'] as never as Record<string, { horizons: { horizon: string; states: unknown; blockers: unknown[]; observations_total: number; observations_classified: number; observations_unclassified: number }[] }>)['VOO']!
        .horizons.find((h) => h.horizon === '6mo')!;
      column.states = null;
      column.blockers = [{ code: 'window_shorter_than_horizon', message: 'Not enough history.', remedy: 'Wait for more.' }];
      column.observations_total = 0;
      column.observations_classified = 0;
      column.observations_unclassified = 0;
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
