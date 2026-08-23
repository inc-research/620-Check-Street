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

test('the shell renders the plain-English framing, not a technical label', async () => {
  const dom = installDom();
  try {
    const { render } = await import('../src/main.ts');
    render();

    const { PLAIN } = await import('@third-floor/copy');
    const text = dom.root.textContent;

    ok(text.includes(PLAIN.overview.title), 'the overview heading is missing');
    ok(text.includes(PLAIN.benchmark_choice.mechanism), 'the benchmark explanation is missing');

    // The heading is the question the reader is asking, in their words.
    ok(!/semibeta|quadrant|covariance/i.test(text), `jargon leaked into the shell: ${text}`);
  } finally {
    dom.uninstall();
  }
});
