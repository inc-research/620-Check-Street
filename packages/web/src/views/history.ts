// SPDX-License-Identifier: MIT
//
// Lens B: today's reading beside the same reading from a real earlier report.
//
// Renders only. Every number, every marker and every refusal was decided in
// `buildLensB`; this file chooses none of them.

import {
  PLAIN,
  TABLE,
  append,
  buildLensB,
  el,
  type LensBRow,
  type LensBTable,
  type Lookback,
  type Snapshot,
  type StateName,
} from '../shim.ts';
import { formatRatio, monthLabel } from './report.ts';

export interface HistoryHandlers {
  onLookback: (lookback: Lookback) => void;
  onBack: () => void;
}

export interface HistoryContext {
  current: Snapshot;
  previous: Snapshot;
  benchmark: string;
  lookback: Lookback;
  /** Which lookbacks the archive can actually answer for this month. */
  available: readonly Lookback[];
}

const HEADING: Record<Lookback, keyof typeof TABLE.history> = {
  '6mo': 'sixMonth',
  '13wk': 'thirteenWeek',
};

/** A signed change, with the sign spelled out so colour is never the only channel. */
function changeText(change: number): string {
  return `${change > 0 ? '+' : change < 0 ? '−' : ''}${Math.abs(change).toFixed(2)}`;
}

function cell(value: number | null, thin: boolean, title: string): HTMLElement {
  const td = el('td', { class: 'score' });
  if (value === null) {
    append(td, [el('span', { class: 'absent' }, '—')]);
    return td;
  }
  append(td, [
    el('span', { class: thin ? 'thin-mark' : undefined, title }, formatRatio(value)),
  ]);
  return td;
}

function changeCell(row: LensBRow): HTMLElement {
  const td = el('td', { class: 'score change' });
  if (row.change === null) {
    append(td, [el('span', { class: 'absent', title: TABLE.history.unavailable }, '—')]);
    return td;
  }

  const parts: (HTMLElement | string)[] = [
    // The sign is in the text, so the reading survives greyscale and readers
    // who do not separate red from green (SF-21).
    el(
      'span',
      { class: row.change > 0 ? 'above' : row.change < 0 ? 'below' : undefined },
      changeText(row.change),
    ),
  ];
  if (row.changed) {
    parts.push(
      el('span', {
        class: 'shift-dot',
        title: TABLE.history.marked,
        'aria-label': 'a change of 0.30 or more',
      }),
    );
  }
  append(td, parts);
  return td;
}

function tableFor(model: LensBTable): HTMLElement {
  const head = el(
    'tr',
    {},
    el('th', {}, 'On days when…'),
    el('th', { class: 'num' }, `${TABLE.history.columns.then} · ${monthLabel(model.thenMonth)}`),
    el('th', { class: 'num' }, `${TABLE.history.columns.now} · ${monthLabel(model.nowMonth)}`),
    el('th', { class: 'num' }, TABLE.history.columns.change),
  );

  const body = el('tbody', {});
  let group: string | null = null;

  for (const row of model.rows) {
    if (row.group !== group) {
      group = row.group;
      const copy = group === 'participation' ? TABLE.participation : TABLE.resilience;
      append(body, [
        el('tr', { class: 'group' }, el('th', { colspan: '4' }, copy.heading)),
      ]);
    }

    const label = TABLE.rows[row.state as StateName];
    const tr = el('tr', { class: label.direction });
    append(tr, [
      el('th', { class: 'row-label', scope: 'row', title: label.full }, label.label),
      cell(row.then, row.thenThin, `${label.full}, in the earlier period.`),
      cell(row.now, row.nowThin, `${label.full}, in the current period.`),
      changeCell(row),
    ]);
    append(body, [tr]);
  }

  return el('div', { class: 'scroll-x' }, el('table', {}, el('thead', {}, head), body));
}

function chooser(ctx: HistoryContext, handlers: HistoryHandlers): HTMLElement | null {
  if (ctx.available.length < 2) return null;
  const root = el('div', { class: 'controls' });
  const group = el('div', {});
  for (const l of ctx.available) {
    group.appendChild(
      el(
        'button',
        {
          class: l === ctx.lookback ? 'primary' : undefined,
          'aria-pressed': l === ctx.lookback ? 'true' : 'false',
          onclick: () => handlers.onLookback(l),
        },
        TABLE.history[HEADING[l]] as string,
      ),
    );
  }
  append(root, [group]);
  return root;
}

function windowLine(model: LensBTable): HTMLElement {
  const then = `${model.thenWindow.start ?? '?'} to ${model.thenWindow.end ?? '?'}`;
  const now = `${model.nowWindow.start ?? '?'} to ${model.nowWindow.end ?? '?'}`;
  return el(
    'p',
    { class: 'assumption' },
    `Earlier period: ${then}. Current period: ${now}. Both measured against ${model.benchmark}.`,
  );
}

export function renderHistory(ctx: HistoryContext, handlers: HistoryHandlers): HTMLElement {
  const model = buildLensB(ctx.current, ctx.previous, ctx.benchmark, ctx.lookback);
  const root = el('section', {});

  append(root, [
    el('button', { onclick: () => handlers.onBack() }, '← Back to the report'),
    el('h2', {}, PLAIN.history.title),
    el('p', { class: 'quiet' }, `${ctx.current.ticker} — ${ctx.current.name}`),
  ]);

  const pick = chooser(ctx, handlers);
  if (pick) append(root, [pick]);

  append(root, [el('p', {}, PLAIN.history.mechanism)]);

  // A refused comparison shows why and stops. Half of it would be worse than
  // none, and this reader has no way to tell which half was wrong.
  if (model.refusals.length > 0) {
    for (const b of model.refusals) {
      append(root, [
        el('div', { class: 'blocker' }, el('p', {}, b.message), el('p', { class: 'remedy' }, b.remedy)),
      ]);
    }
    return root;
  }

  append(root, [el('p', { class: 'quiet' }, TABLE.history.disjoint)]);
  append(root, [tableFor(model)]);
  append(root, [windowLine(model)]);

  append(root, [
    el(
      'div',
      { class: 'legend' },
      el('p', {}, TABLE.history.marked),
      el('p', {}, TABLE.history.steady),
      el('p', {}, TABLE.history.unavailable),
    ),
  ]);

  append(root, [
    el('p', { class: 'assumption' }, `What would change this: ${PLAIN.history.whatWouldChangeIt}`),
  ]);

  return root;
}
