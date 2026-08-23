// SPDX-License-Identifier: MIT
//
// The two states a reader reaches by asking for a fund the report cannot show.
//
// They are deliberately separate views saying different things. "This site does
// not follow that fund" and "this fund is too new to have a reading yet" are
// different facts, and telling a reader the wrong one sends them looking for
// something that is not the problem.

import { append, el } from '../shim.ts';
import type { IndexFund } from '../state.ts';

export interface StateHandlers {
  onBack: () => void;
}

function blocker(message: string, remedy: string): HTMLElement {
  return el('div', { class: 'blocker' }, el('p', {}, message), el('p', { class: 'remedy' }, remedy));
}

/** A ticker outside the followed set (3F-O-04). */
export function renderNotTracked(ticker: string, handlers: StateHandlers): HTMLElement {
  const root = el('section', {});
  append(root, [
    el('h2', {}, `${ticker} is not one of the funds followed here`),
    blocker(
      'This site follows a fixed list of funds that use options contracts to change how they respond to the market. That list is on the front page.',
      'Pick a fund from the list to see its report.',
    ),
    el('button', { onclick: () => handlers.onBack() }, '← All funds'),
  ]);
  return root;
}

/** A fund that is followed, but has no month with a computable window yet. */
export function renderTooNew(fund: IndexFund, handlers: StateHandlers): HTMLElement {
  const root = el('section', {});
  append(root, [
    el('h2', {}, `${fund.ticker} — ${fund.name}`),
    el('p', { class: 'quiet' }, fund.issuer),
    blocker(
      'This fund has not been trading long enough for any of the readings on this site to be worked out. The shortest window here looks back thirteen weeks, and there is not yet that much history behind it.',
      'Check back once the fund has been trading for a few more months. A report appears here as soon as there is enough history for one.',
    ),
    el('button', { onclick: () => handlers.onBack() }, '← All funds'),
  ]);
  return root;
}
