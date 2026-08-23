// SPDX-License-Identifier: MIT
//
// The page's one job in this build: read a snapshot from the site's own
// archive, refuse anything that does not validate, and render the shell.

import { ok, rejects, strictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, test } from 'node:test';

import { installDom } from './dom-shim.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fixture = JSON.parse(
  readFileSync(join(root, 'fixtures', 'snapshot_computed.json'), 'utf8'),
) as Record<string, unknown>;

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(handler: (url: string) => { ok: boolean; body?: unknown }): string[] {
  const seen: string[] = [];
  globalThis.fetch = ((url: string) => {
    seen.push(String(url));
    const { ok: isOk, body } = handler(String(url));
    return Promise.resolve({
      ok: isOk,
      json: () => Promise.resolve(body),
    } as Response);
  }) as typeof fetch;
  return seen;
}

test('a snapshot is read by a relative path, never an absolute one', async () => {
  const { loadSnapshot, state } = await import('../src/state.ts');
  state.loaded.clear();

  const seen = stubFetch(() => ({ ok: true, body: fixture }));
  const snapshot = await loadSnapshot('XMPL', '2026-07');

  strictEqual(snapshot.ticker, 'XMPL');
  strictEqual(seen.length, 1);
  strictEqual(seen[0], './data/XMPL/2026-07.json');

  // 3F D-02 permits a same-origin read and nothing more. A path that reaches
  // off this origin would defeat the whole reason INV-6 exists.
  ok(!/^https?:|^\/\//.test(seen[0]!));
});

test('a second read of the same month does not fetch again', async () => {
  const { loadSnapshot, state } = await import('../src/state.ts');
  state.loaded.clear();

  const seen = stubFetch(() => ({ ok: true, body: fixture }));
  await loadSnapshot('XMPL', '2026-07');
  await loadSnapshot('XMPL', '2026-07');
  strictEqual(seen.length, 1);
});

test('a month with no published report says so rather than rendering nothing', async () => {
  const { loadSnapshot, state } = await import('../src/state.ts');
  state.loaded.clear();

  stubFetch(() => ({ ok: false }));
  await rejects(loadSnapshot('XMPL', '1999-01'), /No report was published/);
});

test('a document that does not validate is refused, not half-rendered', async () => {
  const { loadSnapshot, state } = await import('../src/state.ts');
  state.loaded.clear();

  // Half a report is harder to read than none, and this reader has no way to
  // tell which half was wrong.
  const broken = structuredClone(fixture) as Record<string, unknown>;
  delete broken['benchmarks'];
  stubFetch(() => ({ ok: true, body: broken }));

  await rejects(loadSnapshot('XMPL', '2026-07'), /could not be read/);
  strictEqual(state.loaded.size, 0);
});

test('the front page frames the site in plain English, not a technical label', async () => {
  const dom = installDom();
  try {
    const { renderFunds } = await import('../src/views/funds.ts');
    const { PLAIN } = await import('@third-floor/copy');

    const node = renderFunds(
      {
        app: 'Third Floor',
        schema_version: '1.0',
        anchors: ['VOO'],
        universal_anchor: 'VOO',
        funds: [],
        totals: { tracked: 31, with_snapshots: 30, snapshots: 523 },
      },
      { onOpen: () => {} },
    );
    const text = node.textContent as string;

    ok(text.includes(PLAIN.overview.title), 'the overview heading is missing');
    ok(text.includes(PLAIN.benchmark_choice.mechanism), 'the benchmark explanation is missing');
    ok(!/semibeta|quadrant|covariance/i.test(text), `jargon leaked into the shell: ${text}`);
  } finally {
    dom.uninstall();
  }
});

test('a fund with no reports is offered as too new, not as untracked', async () => {
  // LADM is exactly this in the live archive. The two states are different
  // facts and the page must not substitute one for the other.
  const dom = installDom();
  try {
    const { renderFunds } = await import('../src/views/funds.ts');
    const node = renderFunds(
      {
        app: 'Third Floor',
        schema_version: '1.0',
        anchors: ['VOO'],
        universal_anchor: 'VOO',
        funds: [
          {
            ticker: 'LADM', name: 'A Recent Launch', issuer: 'Somebody',
            category: 'options_integrated', defined_outcome_caveat: true,
            named_benchmark: 'VOO', benchmark_source: 'prospectus_index',
            months: [], latest: null, benchmarks: [], coverage: null,
          },
        ],
        totals: { tracked: 1, with_snapshots: 0, snapshots: 0 },
      },
      { onOpen: () => { throw new Error('an empty fund must not be openable'); } },
    );
    const text = node.textContent as string;
    ok(text.includes('Too new'), 'the empty fund is not explained');
    ok(!text.includes('not one of the funds'), 'it was reported as untracked instead');
  } finally {
    dom.uninstall();
  }
});

test('the two dead ends say different things', async () => {
  const dom = installDom();
  try {
    const { renderNotTracked, renderTooNew } = await import('../src/views/states.ts');

    const untracked = renderNotTracked('ZZZZ', { onBack: () => {} }).textContent as string;
    ok(untracked.includes('is not one of the funds followed here'));
    ok(untracked.includes('Pick a fund from the list'));

    const young = renderTooNew(
      {
        ticker: 'LADM', name: 'A Recent Launch', issuer: 'Somebody',
        category: 'options_integrated', defined_outcome_caveat: true,
        named_benchmark: 'VOO', benchmark_source: 'prospectus_index',
        months: [], latest: null, benchmarks: [], coverage: null,
      },
      { onBack: () => {} },
    ).textContent as string;
    ok(young.includes('has not been trading long enough'));
    ok(young.includes('thirteen weeks'));
    ok(!young.includes('is not one of the funds followed here'));
  } finally {
    dom.uninstall();
  }
});
