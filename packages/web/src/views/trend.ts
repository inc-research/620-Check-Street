// SPDX-License-Identifier: MIT
//
// Net capture across recent month-end reports (3F D-20).
//
// Renders only. Every figure, direction and refusal was decided in
// `buildCaptureTrend`, and every sentence comes from the copy deck. Each level
// stands beside its change (3F D-14), and there is no dot (3F D-17). The two sides
// are never set against each other: that gap could not be told from noise.
//
// No colour on any change or direction. Carrying more of the market's falls is not
// good news and carrying less of its rises is not bad news, so green and red would
// say something these figures do not. The sign and the word carry the reading.

import {
  PLAIN,
  TABLE,
  TREND_BANDS,
  append,
  buildCaptureTrend,
  el,
  explain,
  trendColumns,
  type CaptureTrend,
  type HorizonName,
  type ReportDocument,
  type TrendReading,
  type TrendStep,
} from '../shim.ts';
import { explainer, sectionHead } from './layout.ts';
import { fill, formatGap, formatMeasure, monthLabel, signOf } from './report.ts';

export interface TrendContext {
  report: ReportDocument;
  earlier: ReadonlyMap<string, ReportDocument>;
  benchmark: string;
  column: HorizonName;
}

const columnCopy = (h: HorizonName) => TABLE.columns[h as keyof typeof TABLE.columns];

function dash(blockers: TrendReading['blockers'], fallback = ''): HTMLElement {
  const reason = blockers.length > 0 ? explain(blockers) : fallback;
  return el('span', { class: 'absent', title: reason || undefined }, '—');
}

/** A capture level, with the thin marker when it carries one. */
function level(r: TrendReading, label: string): HTMLElement {
  if (r.value === null) return dash(r.blockers);
  const text = formatMeasure(r.value, 'ratio');
  return el(
    'span',
    {
      class: r.thin ? 'thin-mark' : undefined,
      title: r.thin
        ? `${label}: ${text}. Rests on ${r.days} days, fewer than the 20 the report asks for.`
        : `${label}: ${text}. ${r.days} days.`,
    },
    text,
  );
}

/** The change itself: a percentage, or a plain gap where a percentage would mislead. */
function changeText(step: TrendStep): HTMLElement {
  if (step.change === null) return dash(step.then.blockers);
  // Colour marks only which way the figure moved: blue up, orange down. The
  // sign travels with it in the text (620 Check Street).
  // Judged on what is printed, so a change that rounds to nothing is not coloured.
  const shown = step.percent === null ? Math.round(step.change * 100) : Math.round(step.percent * 10);
  const way = shown > 0 ? 'change rise' : shown < 0 ? 'change fall' : 'change';
  if (step.percent === null) {
    return el(
      'span',
      {
        class: way,
        title: step.percentAbsence === 'small_base' ? TABLE.trend.smallBase : TABLE.trend.signChanged,
      },
      formatGap(step.change, 'ratio'),
    );
  }
  return el('span', { class: way }, `${signOf(step.percent, 1)}${Math.abs(step.percent).toFixed(1)}%`);
}

function stacked(top: HTMLElement, under: string | null): HTMLElement {
  const td = el('td', { class: 'score' });
  append(td, [top]);
  if (under) append(td, [el('span', { class: 'trend-then' }, under)]);
  return td;
}

const ratio = (v: number | null) => (v === null ? null : formatMeasure(v, 'ratio'));

function headRow(model: CaptureTrend): HTMLElement {
  return el(
    'tr',
    {},
    el('th', {}, ''),
    el('th', { class: 'num' }, TABLE.trend.columns.now),
    el('th', { class: 'num' }, fill(TABLE.trend.columns.fromMonth, { month: monthLabel(model.previousMonth) })),
    el('th', { class: 'num', title: monthLabel(model.market.back[0]?.month ?? '') }, TABLE.trend.columns.three),
    el('th', { class: 'num', title: monthLabel(model.market.back[1]?.month ?? '') }, TABLE.trend.columns.six),
  );
}

const DIRECTION = {
  higher: TABLE.trend.higher,
  lower: TABLE.trend.lower,
  about_the_same: TABLE.trend.same,
} as const;

function legRow(leg: CaptureTrend['legs'][number]): HTMLElement {
  const label = leg.side === 'up' ? TABLE.trend.upRow : TABLE.trend.downRow;
  const was = ratio(leg.previous.then.value);
  const tr = el('tr', {});
  append(tr, [
    el('th', { class: 'row-label', scope: 'row', title: label.full }, label.label),
    stacked(level(leg.now, label.full), null),
    stacked(changeText(leg.previous), was ? fill(TABLE.trend.was, { value: was }) : null),
    ...leg.back.map((b) => {
      const then = ratio(b.then.value);
      const said = b.direction ? DIRECTION[b.direction] : null;
      return stacked(
        said ? el('span', { class: `direction ${b.direction}` }, said) : dash(b.then.blockers),
        then ? fill(TABLE.trend.then, { value: then }) : null,
      );
    }),
  ]);
  return tr;
}

function marketRow(model: CaptureTrend): HTMLElement {
  const money = (v: number | null) => (v === null ? null : formatMeasure(v, 'money'));
  const label = TABLE.trend.marketRow;
  const was = money(model.market.previous);
  const tr = el('tr', {});
  append(tr, [
    el('th', { class: 'row-label', scope: 'row', title: label.full }, label.label),
    stacked(el('span', {}, money(model.market.now) ?? '—'), null),
    stacked(el('span', {}, was ?? '—'), null),
    ...model.market.back.map((b) => stacked(el('span', {}, money(b.value) ?? '—'), null)),
  ]);
  return tr;
}

function mainTable(model: CaptureTrend): HTMLElement {
  const body = el('tbody', {}, ...model.legs.map(legRow), marketRow(model));
  return el('div', { class: 'scroll-x' }, el('table', {}, el('thead', {}, headRow(model)), body));
}

function runTable(model: CaptureTrend): HTMLElement {
  const c = TABLE.trend.runColumns;
  const head = el(
    'tr',
    {},
    el('th', {}, c.month),
    el('th', { class: 'num' }, c.up),
    el('th', { class: 'num' }, c.change),
    el('th', { class: 'num' }, c.down),
    el('th', { class: 'num' }, c.change),
    el('th', { class: 'num' }, c.market),
  );
  const body = el('tbody', {});
  for (const row of model.run) {
    const tr = el('tr', {});
    append(tr, [
      el('th', { class: 'row-label', scope: 'row' }, monthLabel(row.month)),
      stacked(level(row.up, TABLE.trend.upRow.full), null),
      stacked(changeText(row.upPercent), null),
      stacked(level(row.down, TABLE.trend.downRow.full), null),
      stacked(changeText(row.downPercent), null),
      stacked(
        el('span', {}, row.market === null ? '—' : formatMeasure(row.market, 'money')),
        null,
      ),
    ]);
    append(body, [tr]);
  }
  return el('div', { class: 'scroll-x' }, el('table', {}, el('thead', {}, head), body));
}

function chooser(ctx: TrendContext, onColumn: (c: HorizonName) => void): HTMLElement | null {
  const available = trendColumns(ctx.report, ctx.benchmark);
  if (available.length < 2) return null;
  const select = el('select', {
    id: 'trend-window',
    onchange: (e) => onColumn((e.target as HTMLSelectElement).value as HorizonName),
  });
  for (const h of available) {
    const option = el('option', { value: h }, columnCopy(h).full);
    if (h === ctx.column) option.setAttribute('selected', 'selected');
    append(select, [option]);
  }
  return el(
    'div',
    { class: 'controls' },
    el('div', {}, el('label', { for: 'trend-window' }, TABLE.trend.window), select),
  );
}

export function renderTrend(ctx: TrendContext, onColumn: (c: HorizonName) => void): HTMLElement {
  const root = el('section', { id: 'capture-trend', class: 'block' });
  append(root, [sectionHead(PLAIN.capture_trend.title, TABLE.sections.trend.caption, 'orange')]);

  const available = trendColumns(ctx.report, ctx.benchmark);
  const first = available[0];
  if (!first) {
    append(root, [el('p', { class: 'quiet' }, PLAIN.capture_trend.whenAbsent)]);
    return root;
  }

  // A window this fund cannot answer falls back rather than refusing: the choice
  // was made on some other fund, and may not hold on this one.
  const column = available.includes(ctx.column) ? ctx.column : first;
  // The page reads the down side as a loss buffer (620 Check Street).
  const model = buildCaptureTrend(ctx.report, ctx.earlier, ctx.benchmark, column, 'loss_buffer');

  const pick = chooser({ ...ctx, column }, onColumn);
  if (pick) append(root, [pick]);

  if (model.refusals.length > 0) {
    for (const b of model.refusals) {
      append(root, [
        el('div', { class: 'blocker' }, el('p', {}, b.message), el('p', { class: 'remedy' }, b.remedy)),
      ]);
    }
    return root;
  }

  if (model.lowFit) {
    append(root, [
      el(
        'p',
        { class: 'lead' },
        fill(TABLE.trend.lowFit, {
          window: columnCopy(column).full,
          share: model.lowFit.share === null ? '0' : String(Math.round(100 * model.lowFit.share)),
          benchmark: model.benchmark,
        }),
      ),
    ]);
    return root;
  }

  append(root, [mainTable(model)]);

  const bands = TREND_BANDS[column];
  const legend = el(
    'div',
    { class: 'legend' },
    el('p', {}, PLAIN.capture_trend.mechanism),
    el('p', {}, TABLE.trend.overlap[column as keyof typeof TABLE.trend.overlap]),
    el('p', {}, fill(TABLE.trend.bands, { three: bands[3].toFixed(2), six: bands[6].toFixed(2) })),
    el('p', {}, PLAIN.capture_trend.whatWouldChangeIt),
  );
  const thin = model.run.some((r) => r.up.thin || r.down.thin);
  if (thin) append(legend, [el('p', {}, TABLE.legend.thin)]);
  append(legend, [el('p', {}, TABLE.trend.dash)]);
  append(root, [explainer(legend)]);

  append(root, [
    el(
      'details',
      { class: 'detail' },
      el('summary', {}, TABLE.trend.runSummary),
      el('p', {}, TABLE.trend.runIntro),
      runTable(model),
    ),
  ]);
  return root;
}
