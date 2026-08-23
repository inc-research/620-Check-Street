// SPDX-License-Identifier: MIT
//
// The front page: what this site follows, and how to open one of them.

import { PLAIN, append, el } from '../shim.ts';
import type { ArchiveIndex, IndexFund } from '../state.ts';
import { monthLabel } from './report.ts';

export interface FundsHandlers {
  onOpen: (ticker: string) => void;
}

/**
 * What a fund's card says under its name.
 *
 * A fund with no reports is not the same as a ticker this site does not follow,
 * and the card says which of the two it is. That distinction is the whole reason
 * the index lists funds with no snapshots at all.
 */
function subtitle(fund: IndexFund): string {
  if (fund.months.length === 0) {
    return 'Too new — not enough trading history yet for any reading.';
  }
  const span =
    fund.months.length === 1
      ? `one report, ${monthLabel(fund.months[0]!)}`
      : `${fund.months.length} reports, ${monthLabel(fund.months[0]!)} to ${monthLabel(fund.latest!)}`;
  return `${fund.issuer} · ${span}`;
}

function card(fund: IndexFund, handlers: FundsHandlers): HTMLElement {
  const usable = fund.months.length > 0;
  const node = el(
    'button',
    {
      class: 'card',
      disabled: usable ? undefined : 'disabled',
      onclick: usable ? () => handlers.onOpen(fund.ticker) : undefined,
    },
    el('h3', {}, `${fund.ticker} — ${fund.name}`),
    el('p', {}, subtitle(fund)),
  );
  return node;
}

export function renderFunds(index: ArchiveIndex, handlers: FundsHandlers): HTMLElement {
  const root = el('section', {});

  append(root, [
    el('h2', {}, PLAIN.overview.title),
    el('p', {}, PLAIN.overview.mechanism),
    el('h3', {}, PLAIN.benchmark_choice.title),
    el('p', {}, PLAIN.benchmark_choice.mechanism),
    el(
      'p',
      { class: 'quiet' },
      `${index.totals.tracked} funds are followed here. ${index.totals.with_snapshots} have enough history to report on, across ${index.totals.snapshots} monthly reports.`,
    ),
  ]);

  const list = el('div', { class: 'cards' });
  // Funds with something to show first; the rest are listed rather than hidden,
  // so a reader looking for one is told why it is empty.
  const ordered = [...index.funds].sort((a, b) => {
    if ((a.months.length === 0) !== (b.months.length === 0)) return a.months.length === 0 ? 1 : -1;
    return a.ticker.localeCompare(b.ticker);
  });
  append(list, ordered.map((f) => card(f, handlers)));
  append(root, [list]);

  return root;
}
