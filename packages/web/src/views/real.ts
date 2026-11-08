// SPDX-License-Identifier: MIT
//
// After an adviser's fee and inflation, beside Treasury bills (3F D-22, D-23).
//
// Renders only. Every figure comes from `realReading` in the core, and every
// sentence from the copy deck. The fund's own costs are stated as an amount
// already inside the figures, never taken off them: the price is net of them
// already, and taking them off again would charge the reader twice.
//
// No colour on any figure. Ending below $100 in today's money is a fact about the
// period, not a verdict, and the sign and the amount carry it.

import {
  HORIZONS,
  TABLE,
  append,
  el,
  explain,
  realReading,
  type FeeDocument,
  type HorizonName,
  type RateSeries,
  type RealReading,
  type RealResult,
  type ReportDocument,
} from '../shim.ts';
import { fill, monthLabel } from './report.ts';

export interface RealContext {
  report: ReportDocument;
  benchmark: string;
  rates: { cpi: RateSeries; bills: RateSeries } | null;
  fundFees: FeeDocument | null;
  marketFees: FeeDocument | null;
  adviser: boolean;
}

const columnCopy = (h: HorizonName) => TABLE.columns[h as keyof typeof TABLE.columns];

/** A yearly fraction as a percentage, to the hundredth: 0.0095 is "0.95". */
const pct = (fraction: number): string => (100 * fraction).toFixed(2);

function dollars(value: number): string {
  return `$${value.toFixed(2)}`;
}

/**
 * Why a figure rests on a stand-in, in the reader's words, or null where nothing
 * does. Every figure in the table is in today's money, so a stand-in for consumer
 * prices touches every row; one for bill rates touches the bills row only.
 */
function standIns(r: RealReading, bills: boolean): string | null {
  const notes: string[] = [];
  if (r.inflation.provisional) {
    notes.push(
      fill(TABLE.real.provisional, {
        month: monthLabel(r.inflation.endMonth),
        used: monthLabel(r.inflation.endUsed),
      }),
    );
  }
  for (const m of r.inflation.estimated) notes.push(fill(TABLE.real.estimated, { month: monthLabel(m) }));
  if (bills && r.billsProvisional) notes.push(TABLE.real.billsProvisional);
  return notes.length > 0 ? notes.join(' ') : null;
}

function figure(text: string, label: string, window: string, standIn: string | null): HTMLElement {
  return el(
    'span',
    {
      class: standIn ? 'thin-mark' : undefined,
      title: standIn ? `${label}, over ${window}: ${text}. ${standIn}` : `${label}, over ${window}: ${text}.`,
    },
    text,
  );
}

function costsLine(ctx: RealContext, results: RealResult[]): HTMLElement[] {
  // The longest window that computed, as the per-1% sentence uses (3F D-17).
  const lead = results.find((r) => r.kind === 'computed');
  const window = lead && lead.kind === 'computed' ? columnCopy(lead.reading.horizon).full : '';
  const out: HTMLElement[] = [];

  const fees = ctx.fundFees?.fees;
  if (!fees) {
    out.push(el('p', { class: 'costs' }, TABLE.real.costsMissing));
  } else {
    const wrapper = (fees.acquired_funds ?? 0) > 0 && fees.management !== null;
    const taken = lead && lead.kind === 'computed' ? lead.reading.fundCosts : null;
    let text = fill(wrapper ? TABLE.real.costsWrapper : TABLE.real.costs, {
      total: pct(fees.net),
      manager: pct((fees.management ?? 0) - fees.waiver),
      acquired: pct(fees.acquired_funds ?? 0),
    });
    if (taken !== null) text += ` ${fill(TABLE.real.costsOver, { window, dollars: taken.toFixed(2) })}`;
    if (fees.waiver > 0) {
      text += ` ${fill(TABLE.real.costsWaiver, { waiver: pct(fees.waiver), gross: pct(fees.gross) })}`;
    }
    out.push(el('p', { class: 'costs' }, text));
  }

  const market = ctx.marketFees?.fees;
  if (market) {
    out.push(
      el('p', { class: 'costs' }, fill(TABLE.real.costsMarket, { benchmark: ctx.benchmark, total: pct(market.net) })),
    );
  }
  return out;
}

export function renderReal(ctx: RealContext, onAdviser: (on: boolean) => void): HTMLElement {
  const root = el('section', { class: 'real' });
  append(root, [el('h3', {}, TABLE.real.heading)]);

  const block = ctx.report.benchmarks[ctx.benchmark];
  if (!ctx.rates || !block) {
    // The money rows above stand on their own; this section only adds to them.
    append(root, [el('p', { class: 'quiet' }, TABLE.real.unavailable)]);
    return root;
  }
  const rates = ctx.rates;

  const results: RealResult[] = block.horizons.map((h) =>
    realReading({
      horizon: h,
      cpi: rates.cpi,
      bills: rates.bills,
      fundFees: ctx.fundFees,
      marketFees: ctx.marketFees,
      adviser: ctx.adviser,
    }),
  );

  append(root, costsLine(ctx, results));

  const toggle = el('input', {
    type: 'checkbox',
    id: 'adviser',
    onchange: (e) => onAdviser((e.target as HTMLInputElement).checked),
  });
  if (ctx.adviser) {
    toggle.setAttribute('checked', 'checked');
    toggle.checked = true;
  }
  append(root, [
    el('div', { class: 'controls' }, toggle, el('label', { for: 'adviser' }, TABLE.real.adviserToggle)),
    el('p', {}, ctx.adviser ? TABLE.real.adviserOn : TABLE.real.adviserOff),
  ]);

  const computed = results.find((r) => r.kind === 'computed');
  const endMonth = computed && computed.kind === 'computed' ? computed.reading.inflation.endMonth : ctx.report.as_of.slice(0, 7);
  append(root, [el('p', {}, fill(TABLE.real.intro, { month: monthLabel(endMonth) }))]);

  const head = el(
    'tr',
    {},
    el('th', {}, ''),
    ...HORIZONS.map((h: HorizonName) => el('th', { class: 'num', title: columnCopy(h).full }, columnCopy(h).short)),
  );
  const body = el('tbody', {});
  const rows: { key: 'fund' | 'market' | 'bills' | 'prices'; read: (r: RealReading) => string }[] = [
    { key: 'fund', read: (r) => dollars(r.fund.real) },
    { key: 'market', read: (r) => dollars(r.market.real) },
    { key: 'bills', read: (r) => dollars(r.bills.real) },
    { key: 'prices', read: (r) => `${(100 * (r.inflation.ratio - 1)).toFixed(1)}%` },
  ];
  let marked = false;
  for (const row of rows) {
    const copy = TABLE.real.rows[row.key];
    const tr = el('tr', {});
    append(tr, [el('th', { class: 'row-label', scope: 'row', title: copy.full }, copy.label)]);
    for (const result of results) {
      const td = el('td', { class: 'score' });
      if (result.kind === 'blocked') {
        append(td, [el('span', { class: 'absent', title: explain(result.blockers) || undefined }, '—')]);
      } else {
        const standIn = standIns(result.reading, row.key === 'bills');
        if (standIn) marked = true;
        append(td, [figure(row.read(result.reading), copy.full, columnCopy(result.reading.horizon).full, standIn)]);
      }
      append(tr, [td]);
    }
    append(body, [tr]);
  }
  append(root, [el('div', { class: 'scroll-x' }, el('table', {}, el('thead', {}, head), body))]);

  const legend = el('div', { class: 'legend' });
  if (marked) append(legend, [el('p', {}, TABLE.real.legend)]);
  append(legend, [el('p', {}, TABLE.real.dash)]);
  append(root, [legend]);
  return root;
}
