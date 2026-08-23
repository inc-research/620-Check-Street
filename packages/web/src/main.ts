// SPDX-License-Identifier: MIT

/**
 * The shell and the view router.
 *
 * Routing is by hash, so a reader can link to a fund and come back to it, and
 * so the back button does what they expect — on a static site with no server
 * there is nothing else to route with. Nothing is stored between visits.
 */

import { append, buildLensA, clear, defaultBenchmark, el, type Snapshot } from './shim.ts';
import { findFund, loadIndex, loadSnapshot, state } from './state.ts';
import { renderFunds } from './views/funds.ts';
import { renderReport } from './views/report.ts';
import { renderNotTracked, renderTooNew } from './views/states.ts';

function app(): HTMLElement | null {
  return document.getElementById('app');
}

function show(node: HTMLElement): void {
  const root = app();
  if (!root) return;
  clear(root);
  root.appendChild(node);
}

function message(text: string, remedy?: string): HTMLElement {
  const root = el('div', { class: 'blocker' }, el('p', {}, text));
  if (remedy) append(root, [el('p', { class: 'remedy' }, remedy)]);
  return root;
}

function busy(): HTMLElement {
  return el('p', { class: 'quiet', 'aria-live': 'polite' }, 'Reading…');
}

/** `#/TICKER` or `#/TICKER/YYYY-MM`. Anything else is the front page. */
function parseHash(): { ticker: string | null; month: string | null } {
  const raw = location.hash.replace(/^#\/?/, '');
  if (!raw) return { ticker: null, month: null };
  const [ticker, month] = raw.split('/');
  return {
    ticker: ticker ? ticker.toUpperCase() : null,
    month: month && /^\d{4}-\d{2}$/.test(month) ? month : null,
  };
}

function goto(ticker: string | null, month?: string | null): void {
  location.hash = ticker ? (month ? `#/${ticker}/${month}` : `#/${ticker}`) : '';
}


async function renderRoute(): Promise<void> {
  const { ticker, month } = parseHash();

  let index;
  try {
    index = await loadIndex();
  } catch (e) {
    show(message((e as Error).message, 'Try reloading the page.'));
    return;
  }

  if (!ticker) {
    state.ticker = null;
    show(renderFunds(index, { onOpen: (t) => goto(t) }));
    return;
  }

  const fund = findFund(ticker);
  if (!fund) {
    show(renderNotTracked(ticker, { onBack: () => goto(null) }));
    return;
  }
  if (fund.months.length === 0 || !fund.latest) {
    show(renderTooNew(fund, { onBack: () => goto(null) }));
    return;
  }

  const wanted = month && fund.months.includes(month) ? month : fund.latest;

  // A benchmark chosen for one fund must not follow the reader to the next.
  if (state.ticker !== fund.ticker) state.benchmark = null;
  state.ticker = fund.ticker;
  state.month = wanted;

  show(busy());

  let snapshot: Snapshot;
  try {
    snapshot = await loadSnapshot(fund.ticker, wanted);
  } catch (e) {
    show(message((e as Error).message, 'Pick another month, or go back to the list of funds.'));
    return;
  }

  const available = Object.keys(snapshot.benchmarks);
  if (!state.benchmark || !available.includes(state.benchmark)) {
    state.benchmark = defaultBenchmark(snapshot);
  }

  // Fail here rather than half-render: buildLensA throws on a benchmark the
  // document does not carry, and a table showing a different benchmark than the
  // one asked for is worse than an error somebody can see.
  try {
    buildLensA(snapshot, state.benchmark);
  } catch (e) {
    show(message((e as Error).message, 'Pick another comparison from the list above.'));
    return;
  }

  show(
    renderReport(
      { snapshot, benchmark: state.benchmark, months: fund.months },
      {
        onBenchmark: (b) => {
          state.benchmark = b;
          void renderRoute();
        },
        onMonth: (m) => goto(fund.ticker, m),
        onBack: () => goto(null),
      },
    ),
  );
}

export function render(): void {
  void renderRoute();
}

if (typeof document !== 'undefined' && typeof location !== 'undefined') {
  window.addEventListener('hashchange', () => void renderRoute());
  render();
}
