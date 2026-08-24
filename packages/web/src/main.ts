// SPDX-License-Identifier: MIT

/**
 * The shell and the view router.
 *
 * Routing is by hash, so a reader can link to a fund and come back to it, and
 * so the back button does what they expect — on a static site with no server
 * there is nothing else to route with. Nothing is stored between visits.
 */

import {
  COMPARISON_HORIZON,
  append,
  archivedMonthFor,
  buildLensA,
  canCompare,
  clear,
  comparableHorizons,
  defaultBenchmark,
  el,
  sharedBenchmarks,
  sharedMonths,
  type HorizonName,
  type Lookback,
  type Snapshot,
} from './shim.ts';
import { findFund, loadIndex, loadSnapshot, state } from './state.ts';
import { renderFunds } from './views/funds.ts';
import { renderReport } from './views/report.ts';
import { renderHistory } from './views/history.ts';
import { renderCompare } from './views/compare.ts';
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

function isHorizon(value: string | undefined): value is HorizonName {
  return value === '12mo' || value === '6mo' || value === '13wk';
}

interface Route {
  ticker: string | null;
  month: string | null;
  /** Lens B: how far back to reach for the earlier report. */
  lookback: Lookback | null;
  /** Lens C: the fund to set this one beside. */
  other: string | null;
  /** Lens C: the window length both funds are read over. */
  horizon: HorizonName | null;
}

/**
 * `#/TICKER`, `#/TICKER/YYYY-MM`, `#/TICKER/YYYY-MM/vs/6mo`, or
 * `#/TICKER/YYYY-MM/with/OTHER[/over/12mo]`.
 *
 * Hash routing because a static site has nothing else to route with, and
 * because a reader should be able to link to a comparison and come back to it.
 * The month is in the Lens C path rather than implied, because both sides being
 * read in the same month is the thing that makes the comparison mean anything.
 */
function parseHash(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  const empty: Route = { ticker: null, month: null, lookback: null, other: null, horizon: null };
  if (!raw) return empty;
  const [ticker, month, verb, subject, over, horizon] = raw.split('/');
  return {
    ticker: ticker ? ticker.toUpperCase() : null,
    month: month && /^\d{4}-\d{2}$/.test(month) ? month : null,
    lookback: verb === 'vs' && isLookback(subject) ? subject : null,
    other: verb === 'with' && subject ? subject.toUpperCase() : null,
    horizon: verb === 'with' && over === 'over' && isHorizon(horizon) ? horizon : null,
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

/** Lens C's address. The window length is only in the URL once it is chosen. */
function gotoCompare(
  ticker: string,
  month: string,
  other: string,
  horizon?: HorizonName | null,
): void {
  location.hash = horizon
    ? `#/${ticker}/${month}/with/${other}/over/${horizon}`
    : `#/${ticker}/${month}/with/${other}`;
}


async function renderRoute(): Promise<void> {
  const { ticker, month, lookback, other, horizon } = parseHash();

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

  // Every other fund with a report for this same month. Worked out from the
  // index, so the picker only ever offers comparisons that can be made.
  const companions = index.funds
    .filter((f) => f.ticker !== fund.ticker && f.months.includes(wanted))
    .map((f) => ({ ticker: f.ticker, name: f.name }));

  if (other) {
    const partner = findFund(other);
    if (!partner) {
      show(renderNotTracked(other, { onBack: () => goto(fund.ticker, wanted) }));
      return;
    }

    // Same month on both sides is the constraint that makes the difference
    // mean the funds rather than the market. Enforced here by refusing to
    // route, and again in buildLensC, which never trusts its caller.
    const both = sharedMonths(fund.months, partner.months);
    if (both.length === 0) {
      show(
        message(
          `${fund.ticker} and ${partner.ticker} have no month with a published report for both, so there is no point in time at which the two can be set side by side.`,
          'Compare one of them against a fund that has been running over the same months.',
        ),
      );
      return;
    }
    if (!both.includes(wanted)) {
      gotoCompare(fund.ticker, both[both.length - 1]!, partner.ticker, horizon);
      return;
    }

    let opposite: Snapshot;
    try {
      opposite = await loadSnapshot(partner.ticker, wanted);
    } catch (e) {
      show(message((e as Error).message, 'Pick another fund to set this one beside.'));
      return;
    }

    // The universal anchor leads, because it is the one thing every fund here
    // is measured against and so the only benchmark that makes any two of them
    // comparable. A shared named benchmark is the fallback; no shared benchmark
    // at all is a refusal rather than a guess.
    const shared = sharedBenchmarks(snapshot, opposite, index.universal_anchor);
    const on = shared[0];
    if (!on) {
      show(
        message(
          `${fund.ticker} and ${partner.ticker} are not measured against the same thing, so putting their numbers side by side would compare two different questions.`,
          'Compare two funds that share a benchmark. Every fund here is measured against the US large-company anchor.',
        ),
      );
      return;
    }

    const usable = comparableHorizons(snapshot, opposite, on);
    const over = horizon && usable.includes(horizon)
      ? horizon
      : (usable.includes(COMPARISON_HORIZON) ? COMPARISON_HORIZON : usable[0] ?? COMPARISON_HORIZON);

    show(
      renderCompare(
        {
          a: snapshot,
          b: opposite,
          benchmark: on,
          horizon: over,
          horizons: usable,
          months: both,
          others: companions,
        },
        {
          onHorizon: (h) => gotoCompare(fund.ticker, wanted, partner.ticker, h),
          onMonth: (m) => gotoCompare(fund.ticker, m, partner.ticker, over),
          onOther: (t) => gotoCompare(fund.ticker, wanted, t, horizon),
          onBack: () => goto(fund.ticker, wanted),
        },
      ),
    );
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
      {
        snapshot,
        benchmark: state.benchmark,
        months: fund.months,
        history,
        companions,
        benchmarkNote: fund.benchmark_note,
      },
      {
        onBenchmark: (b) => {
          state.benchmark = b;
          void renderRoute();
        },
        onMonth: (m) => goto(fund.ticker, m),
        onHistory: (l) => goto(fund.ticker, wanted, l),
        onCompare: (t) => gotoCompare(fund.ticker, wanted, t),
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
