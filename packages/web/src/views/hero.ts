// SPDX-License-Identifier: MIT
//
// The headline figures at the top of a fund's report (620 Check Street).
//
// Renders only. Each card is one figure already on the page below it, for the
// longest window that computed, set large with the least context that makes it
// readable. Nothing here is a new measure: the cards repeat the table, the loss
// buffer is the table's, and today's money comes from `realReading` as the
// section further down does.

import {
  TABLE,
  append,
  el,
  realReading,
  type FeeDocument,
  type RateSeries,
  type ReportDocument,
  type ReportTable,
} from '../shim.ts';
import { fill, formatMeasure } from './report.ts';

export interface HeroContext {
  report: ReportDocument;
  model: ReportTable;
  rates: { cpi: RateSeries; bills: RateSeries } | null;
  fundFees: FeeDocument | null;
  marketFees: FeeDocument | null;
  adviser: boolean;
}

function card(accent: string, label: string, value: string | null, sub: string): HTMLElement {
  return el(
    'div',
    { class: `hero-card accent-${accent}` },
    el('p', { class: 'hero-label' }, label),
    el('p', { class: value === null ? 'hero-value absent' : 'hero-value' }, value ?? '—'),
    el('p', { class: 'hero-sub' }, sub),
  );
}

export function renderHero(ctx: HeroContext): HTMLElement {
  const lead = ctx.model.lead;
  const root = el('section', { class: 'hero' });
  if (!lead) {
    append(root, [el('p', { class: 'quiet' }, TABLE.hero.none)]);
    return root;
  }
  const column = TABLE.columns[lead.horizon as keyof typeof TABLE.columns];
  append(root, [el('h3', { class: 'hero-heading' }, fill(TABLE.hero.heading, { window: column.full }))]);

  const value = (measure: string): number | null =>
    ctx.model.rows.find((r) => r.measure === measure)?.cells.find((c) => c.horizon === lead.horizon)?.value ?? null;
  const money = (v: number | null) => (v === null ? null : formatMeasure(v, 'money'));
  const ratio = (v: number | null) => (v === null ? null : formatMeasure(v, 'ratio'));
  const benchmark = ctx.model.benchmark;

  const grid = el('div', { class: 'hero-grid' });
  append(grid, [
    card('blue', TABLE.hero.growth.label, money(value('growth_fund')),
      fill(TABLE.hero.growth.sub, { market: money(value('growth_benchmark')) ?? '—' })),
  ]);

  const horizon = ctx.report.benchmarks[benchmark]?.horizons.find((h) => h.horizon === lead.horizon);
  if (ctx.rates && horizon) {
    const real = realReading({
      horizon,
      cpi: ctx.rates.cpi,
      bills: ctx.rates.bills,
      fundFees: ctx.fundFees,
      marketFees: ctx.marketFees,
      adviser: ctx.adviser,
    });
    if (real.kind === 'computed') {
      const r = real.reading;
      const inflation = (100 * (r.inflation.ratio - 1)).toFixed(1);
      append(grid, [
        card('violet', TABLE.hero.real.label, `$${r.fund.real.toFixed(2)}`,
          fill(ctx.adviser ? TABLE.hero.real.subAdviser : TABLE.hero.real.subPlain, {
            inflation,
            market: `$${r.market.real.toFixed(2)}`,
          })),
      ]);
    }
  }

  const lowFit = lead.lowFit ? fill(TABLE.hero.lowFit, { benchmark }) : null;
  append(grid, [
    card('orange', TABLE.hero.up.label, lowFit ? null : ratio(lead.captureUp), lowFit ?? TABLE.hero.up.sub),
    card('gold', TABLE.hero.buffer.label, lowFit ? null : ratio(lead.lossBuffer), lowFit ?? TABLE.hero.buffer.sub),
    card('sky', TABLE.hero.fit.label, lead.fit === null ? null : `${Math.round(100 * lead.fit)}%`,
      fill(TABLE.hero.fit.sub, { benchmark })),
  ]);
  append(root, [grid]);
  return root;
}
