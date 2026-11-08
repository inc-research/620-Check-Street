// SPDX-License-Identifier: MIT
//
// Lens C: two funds, read the same way, side by side.
//
// Renders only. Every number, every marker and every refusal was decided in
// `buildLensC`; this file chooses none of them.
//
// The table shows both readings and the difference, not the difference alone.
// Across the archive a gap of +0.30 turns up with the higher fund anywhere from
// +0.04 to +0.71 — a spread more than twice the gap itself — so the difference
// on its own would not tell the reader what they had found (3F D-14).

import {
  PLAIN,
  TABLE,
  append,
  buildLensC,
  el,
  type HorizonName,
  type LensCRow,
  type LensCTable,
  type MeasureKind,
  type ReportDocument,
} from '../shim.ts';
import { explainer, sectionHead } from './layout.ts';
import { formatGap, formatMeasure, groupHeadingRow, monthLabel } from './report.ts';

export interface CompareHandlers {
  onHorizon: (horizon: HorizonName) => void;
  onMonth: (month: string) => void;
  onOther: (ticker: string) => void;
  onBack: () => void;
}

export interface CompareContext {
  a: ReportDocument;
  b: ReportDocument;
  benchmark: string;
  horizon: HorizonName;
  /** Window lengths both reports could answer. */
  horizons: readonly HorizonName[];
  /** Months both funds published a report for. */
  months: readonly string[];
  /** Every other fund that can be set beside this one, for the picker. */
  others: readonly { ticker: string; name: string }[];
}

function cell(value: number | null, kind: MeasureKind, thin: boolean, title: string): HTMLElement {
  const td = el('td', { class: 'score' });
  if (value === null) {
    append(td, [el('span', { class: 'absent', title: TABLE.comparison.unavailable }, '—')]);
    return td;
  }
  append(td, [
    el('span', { class: thin ? 'thin-mark' : undefined, title }, formatMeasure(value, kind)),
  ]);
  return td;
}

function differenceCell(row: LensCRow): HTMLElement {
  const td = el('td', { class: 'score change' });
  if (row.difference === null) {
    append(td, [el('span', { class: 'absent', title: TABLE.comparison.unavailable }, '—')]);
    return td;
  }

  const parts: (HTMLElement | string)[] = [
    el(
      'span',
      { class: row.difference > 0 ? 'above' : row.difference < 0 ? 'below' : undefined },
      formatGap(row.difference, row.kind),
    ),
  ];

  if (row.differs) {
    parts.push(
      el('span', {
        class: 'shift-dot',
        title: TABLE.comparison.marked,
        'aria-label': 'a gap of 0.30 or more',
      }),
    );
  }

  append(td, parts);
  return td;
}

function tableFor(model: LensCTable): HTMLElement {
  const head = el(
    'tr',
    {},
    el('th', {}, ''),
    el('th', { class: 'num', title: model.nameA }, model.a),
    el('th', { class: 'num', title: model.nameB }, model.b),
    el('th', { class: 'num' }, TABLE.comparison.difference),
  );

  const body = el('tbody', {});
  let group: string | null = null;

  for (const row of model.rows) {
    if (row.group !== group) {
      group = row.group;
      append(body, [groupHeadingRow(row.group, 4)]);
    }

    const label = TABLE.measures[row.measure];
    const tr = el('tr', {});
    append(tr, [
      el('th', { class: 'row-label', scope: 'row', title: label.full }, label.label),
      cell(row.a, row.kind, row.aThin, `${model.a}: ${label.full}.`),
      cell(row.b, row.kind, row.bThin, `${model.b}: ${label.full}.`),
      differenceCell(row),
    ]);
    append(body, [tr]);
  }

  return el('div', { class: 'scroll-x' }, el('table', {}, el('thead', {}, head), body));
}

/**
 * The three choices, all of which change the URL rather than the table in place.
 *
 * The other fund, the month and the window length are all offered from what the
 * archive can actually answer — no control here leads to a refusal the reader
 * could not have seen coming.
 */
function controls(ctx: CompareContext, handlers: CompareHandlers): HTMLElement {
  const root = el('div', { class: 'controls' });

  if (ctx.others.length > 0) {
    const select = el('select', {
      id: 'other',
      onchange: (e) => handlers.onOther((e.target as HTMLSelectElement).value),
    });
    for (const other of ctx.others) {
      const option = el('option', { value: other.ticker }, `${other.ticker} — ${other.name}`);
      if (other.ticker === ctx.b.ticker) option.setAttribute('selected', 'selected');
      append(select, [option]);
    }
    append(root, [el('div', {}, el('label', { for: 'other' }, 'Set beside'), select)]);
  }

  if (ctx.months.length > 1) {
    const select = el('select', {
      id: 'compare-month',
      onchange: (e) => handlers.onMonth((e.target as HTMLSelectElement).value),
    });
    for (const m of [...ctx.months].reverse()) {
      const option = el('option', { value: m }, monthLabel(m));
      if (m === ctx.a.as_of.slice(0, 7)) option.setAttribute('selected', 'selected');
      append(select, [option]);
    }
    append(root, [el('div', {}, el('label', { for: 'compare-month' }, 'Report from'), select)]);
  }

  if (ctx.horizons.length > 1) {
    const select = el('select', {
      id: 'compare-window',
      onchange: (e) => handlers.onHorizon((e.target as HTMLSelectElement).value as HorizonName),
    });
    for (const h of ctx.horizons) {
      const column = TABLE.columns[h as keyof typeof TABLE.columns];
      const option = el('option', { value: h }, column.full);
      if (h === ctx.horizon) option.setAttribute('selected', 'selected');
      append(select, [option]);
    }
    append(root, [el('div', {}, el('label', { for: 'compare-window' }, 'Measured over'), select)]);
  }

  return root;
}

export function renderCompare(ctx: CompareContext, handlers: CompareHandlers): HTMLElement {
  const model = buildLensC(ctx.a, ctx.b, ctx.benchmark, ctx.horizon);
  const root = el('section', {});

  append(root, [
    el('button', { class: 'back', onclick: () => handlers.onBack() }, '← Back to the report'),
    el('h2', {}, PLAIN.comparing_funds.title),
    el('p', { class: 'meta' }, `${model.a} beside ${model.b}`),
    el('p', { class: 'caption' }, `${model.nameA} · ${model.nameB}`),
    controls(ctx, handlers),
  ]);

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

  const column = TABLE.columns[model.horizon as keyof typeof TABLE.columns];

  append(root, [
    sectionHead(TABLE.comparison.heading, TABLE.comparison.sameEverythingElse, 'blue'),
    tableFor(model),
    // INV-1: the figures never leave the page without what they were worked
    // out from — which month, which days, which market, which length of time.
    el(
      'p',
      { class: 'assumption' },
      `Both funds over ${column.full}, from daily closing prices up to ${model.asOf}, against ${model.benchmark}. Window: ${model.window.start ?? '?'} to ${model.window.end ?? '?'}.`,
    ),
  ]);

  const legend = el('div', { class: 'legend' }, el('p', {}, TABLE.comparison.window));
  append(legend, [
    el('p', {}, TABLE.comparison.marked),
    el('p', {}, TABLE.comparison.alike),
    el('p', {}, TABLE.comparison.unavailable),
  ]);
  append(root, [
    explainer(
      el('p', {}, PLAIN.comparing_funds.mechanism),
      legend,
      el('p', { class: 'assumption' }, `What would change this: ${PLAIN.comparing_funds.whatWouldChangeIt}`),
    ),
  ]);

  return root;
}
