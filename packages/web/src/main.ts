// SPDX-License-Identifier: MIT

/**
 * The shell and the view router.
 *
 * Routing is by hash, so a reader can link to a fund and come back to it, and
 * so the back button does what they expect — on a static site with no server
 * there is nothing else to route with. Nothing is stored between visits.
 */

import {
  append,
  archivedMonthFor,
  buildLensA,
  canCompare,
  clear,
  defaultBenchmark,
  el,
  type Lookback,
  type Snapshot,
} from './shim.ts';
import { findFund, loadIndex, loadSnapshot, state } from './state.ts';
import { renderFunds } from './views/funds.ts';
import { renderReport } from './views/report.ts';
import { renderHistory } from './views/history.ts';
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

const LOOKBACKS: Lookback[] = ['6mo', '13wk'];

function isLookback(value: string | undefined): value is Lookback {
  return value === '6mo' || value === '13wk';
}

/**
 * `#/TICKER`, `#/TICKER/YYYY-MM`, or `#/TICKER/YYYY-MM/vs/6mo`.
 *
 * Hash routing because a static site has nothing else to route with, and
 * because a reader should be able to link to a comparison and come back to it.
 */
function parseHash(): { ticker: string | null; month: string | null; lookback: Lookback | null } {
  const raw = location.hash.replace(/^#\/?/, '');
  if (!raw) return { ticker: null, month: null, lookback: null };
  const [ticker, month, vs, lookback] = raw.split('/');
  return {
    ticker: ticker ? ticker.toUpperCase() : null,
    month: month && /^\d{4}-\d{2}$/.test(month) ? month : null,
    lookback: vs === 'vs' && isLookback(lookback) ? lookback : null,
  };
}

function goto(ticker: string | null, month?: string | null, lookback?: Lookback | null): void {
  if (!ticker) {
    location.hash = '';
    return;
  }
  if (month && lookback) {
    location.hash = `#/${ticker}/${month}/vs/${lookback}`;
    return;
  }
  location.hash = month ? `#/${ticker}/${month}` : `#/${ticker}`;
}


async function renderRoute(): Promise<void> {
  const { ticker, month, lookback } = parseHash();

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

  // Which lookbacks this month can actually answer, worked out from the index
  // rather than by trying the fetch and handling the failure.
  const history = LOOKBACKS.filter((l) => canCompare(fund.months, wanted, l));

  if (lookback) {
    if (!history.includes(lookback)) {
      show(
        message(
          `There is no report for ${fund.ticker} from that far back to set beside this one. The oldest one on record is from ${fund.months[0]}.`,
          'Read the current report on its own, or pick a more recent month to compare from.',
        ),
      );
      return;
    }

    const earlier = archivedMonthFor(wanted, lookback);
    let previous: Snapshot;
    try {
      previous = await loadSnapshot(fund.ticker, earlier);
    } catch (e) {
      show(message((e as Error).message, 'Read the current report on its own.'));
      return;
    }

    show(
      renderHistory(
        { current: snapshot, previous, benchmark: state.benchmark, lookback, available: history },
        {
          onLookback: (l) => goto(fund.ticker, wanted, l),
          onBack: () => goto(fund.ticker, wanted),
        },
      ),
    );
    return;
  }

  show(
    renderReport(
      { snapshot, benchmark: state.benchmark, months: fund.months, history },
      {
        onBenchmark: (b) => {
          state.benchmark = b;
          void renderRoute();
        },
        onMonth: (m) => goto(fund.ticker, m),
        onHistory: (l) => goto(fund.ticker, wanted, l),
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
