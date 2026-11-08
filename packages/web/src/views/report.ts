// SPDX-License-Identifier: MIT
//
// Lens A: one fund, one benchmark, one month, read across window lengths.
//
// Leads with what happened to the money, then how much of the market the fund
// carried and how closely it followed (3F D-17). The same-direction semibeta sits
// in a collapsed section below that, read from the snapshot archive.
//
// This file renders and computes nothing (INV-5). Every marker it draws was
// decided in the core, and every sentence it prints came from the copy deck,
// which the lint runs over as a test. Text is set through `textContent`
// throughout, so nothing a data file carries can become markup.

import {
  HORIZONS,
  PLAIN,
  TABLE,
  append,
  benchmarkIndexNote,
  benchmarkIndexShort,
  buildLensA,
  buildReportTable,
  el,
  explain,
  type HorizonName,
  type LensATable,
  type Lookback,
  type MeasureGroup,
  type MeasureKind,
  type ReportCell,
  type ReportDocument,
  type ReportTable,
  type Snapshot,
  type TableCell,
} from '../shim.ts';
import { renderReal, type RealContext } from './real.ts';
import { renderTrend } from './trend.ts';

export interface ReportHandlers {
  onBenchmark: (benchmark: string) => void;
  onMonth: (month: string) => void;
  onHistory: (lookback: Lookback) => void;
  onTrendColumn: (column: HorizonName) => void;
  onCompare: (ticker: string) => void;
  onBack: () => void;
  onAdviser: (on: boolean) => void;
}

export interface ReportContext {
  report: ReportDocument;
  /** The same month's snapshot, for the detail section. */
  snapshot: Snapshot;
  benchmark: string;
  months: readonly string[];
  /** Earlier reports for the capture-over-time section. A month not here shows a dash. */
  earlier: ReadonlyMap<string, ReportDocument>;
  trendColumn: HorizonName;
  /** Lookbacks the archive can answer for this month. Empty is common and fine. */
  history: readonly Lookback[];
  /** Every other fund with a report for this same month. */
  companions: readonly { ticker: string; name: string }[];
  /**
   * Why this fund's anchor is not an exact match, in the reader's words.
   *
   * Comes from the index rather than from the snapshot. The snapshot carries a
   * provenance note naming prospectus and marketing sources, which is the right
   * thing for an archive and the wrong thing for a page — it was written for
   * whoever maintains the registry, and one of them ended by asking the builder
   * an open question (3F D-15).
   */
  benchmarkNote?: string | undefined;
  /** Costs, rates and the adviser setting, for the section after the money rows (3F D-23). */
  real: Omit<RealContext, 'report' | 'benchmark'>;
}

/** A month key as something a person says out loud. */
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function monthLabel(month: string): string {
  const [year, index] = month.split('-');
  const name = MONTH_NAMES[Number(index) - 1];
  return name && year ? `${name} ${year}` : month;
}

/**
 * The ratio, as the tables print it.
 *
 * Two decimals and an explicit sign on negatives. A minus sign is the whole
 * difference between "the fund moved a little the same way" and "the fund moved
 * the other way".
 */
export function formatRatio(value: number): string {
  const text = Math.abs(value).toFixed(2);
  // U+2212 minus, not a hyphen: it aligns with the digits at this size.
  return value < 0 ? `\u2212${text}` : text;
}

/** A sign for what is printed, so a value that rounds to nothing reads as nothing. */
export function signOf(value: number, decimals: number): string {
  if (Number(Math.abs(value).toFixed(decimals)) === 0) return '';
  return value > 0 ? '+' : '\u2212';
}

/** A reading, as its kind reads: dollars per $100, a ratio, or a percentage. */
export function formatMeasure(value: number, kind: MeasureKind): string {
  const dollars = `$${Math.abs(value).toFixed(2)}`;
  switch (kind) {
    case 'money': return dollars;
    case 'fall': return value < 0 ? `\u2212${dollars}` : dollars;
    case 'day': return `${signOf(value, 2)}${dollars}`;
    case 'ratio': return formatRatio(value);
    case 'share': return `${Math.round(value)}%`;
  }
}

/** A signed gap between two readings, with the sign in the text and not only in colour (SF-21). */
export function formatGap(value: number, kind: MeasureKind): string {
  const size = Math.abs(value);
  if (kind === 'share') {
    const points = Math.round(size);
    return `${signOf(value, 0)}${points} ${points === 1 ? 'pt' : 'pts'}`;
  }
  if (kind === 'ratio') return `${signOf(value, 2)}${size.toFixed(2)}`;
  return `${signOf(value, 2)}$${size.toFixed(2)}`;
}

/** Fill a {placeholder} sentence from the deck. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
}

export function groupHeadingRow(group: MeasureGroup, span: number): HTMLElement {
  const copy = TABLE.groups[group];
  return el(
    'tr',
    { class: 'group' },
    el('th', { colspan: String(span), title: copy.blurb }, copy.heading),
  );
}

/** A blocked figure shows a dash and nothing else, and the legend says a dash is not a zero (INV-2). */
function measureCell(cell: ReportCell, kind: MeasureKind, label: string): HTMLElement {
  const td = el('td', { class: 'score' });
  if (cell.value === null) {
    const reason = cell.blockers.length > 0 ? explain(cell.blockers) : '';
    append(td, [el('span', { class: 'absent', title: reason || undefined }, '—')]);
    return td;
  }
  const column = TABLE.columns[cell.horizon as keyof typeof TABLE.columns];
  const value = formatMeasure(cell.value, kind);
  append(td, [
    el(
      'span',
      {
        class: cell.thin ? 'thin-mark' : undefined,
        title: cell.thin
          ? `${label}, over ${column.full}: ${value}. Rests on ${cell.days} days, fewer than the 20 the report asks for.`
          : `${label}, over ${column.full}: ${value}. ${cell.days} days.`,
      },
      value,
    ),
  ]);
  return td;
}

function mainTable(model: ReportTable): HTMLElement {
  const head = el(
    'tr',
    {},
    el('th', {}, ''),
    ...HORIZONS.map((h: HorizonName) =>
      el('th', { class: 'num', title: TABLE.columns[h as keyof typeof TABLE.columns].full },
         TABLE.columns[h as keyof typeof TABLE.columns].short),
    ),
  );

  const body = el('tbody', {});
  let group: string | null = null;
  for (const row of model.rows) {
    if (row.group !== group) {
      group = row.group;
      append(body, [groupHeadingRow(row.group, 1 + HORIZONS.length)]);
    }
    const label = TABLE.measures[row.measure];
    const tr = el('tr', {});
    append(tr, [el('th', { class: 'row-label', scope: 'row', title: label.full }, label.label)]);
    append(tr, row.cells.map((c) => measureCell(c, row.kind, label.full)));
    append(body, [tr]);
  }

  return el('div', { class: 'scroll-x' }, el('table', {}, el('thead', {}, head), body));
}

/** The sentence the report leads with, or what stands in for it (3F D-17). */
function perOneSentences(model: ReportTable): HTMLElement | null {
  const lead = model.lead;
  if (!lead) return null;
  const window = TABLE.columns[lead.horizon as keyof typeof TABLE.columns].full;

  if (lead.lowFit) {
    return el(
      'p',
      { class: 'lead' },
      fill(TABLE.perOne.lowFit, {
        window,
        share: lead.fit === null ? '0' : String(Math.round(100 * lead.fit)),
        benchmark: model.benchmark,
      }),
    );
  }

  const sentences: string[] = [];
  if (lead.captureUp !== null) {
    sentences.push(
      fill(lead.captureUp < 0 ? TABLE.perOne.upOpposite : TABLE.perOne.up, {
        window,
        ratio: Math.abs(lead.captureUp).toFixed(2),
      }),
    );
  }
  if (lead.captureDown !== null) {
    sentences.push(
      fill(lead.captureDown < 0 ? TABLE.perOne.downOpposite : TABLE.perOne.down, {
        window,
        ratio: Math.abs(lead.captureDown).toFixed(2),
      }),
    );
  }
  return sentences.length > 0 ? el('p', { class: 'lead' }, sentences.join(' ')) : null;
}

function legend(model: ReportTable): HTMLElement {
  const root = el('div', { class: 'legend' });
  append(root, [
    el('p', {}, PLAIN.money.mechanism),
    el('p', {}, PLAIN.exposure.mechanism),
    el('p', {}, PLAIN.follows.mechanism),
  ]);
  const thin = model.rows.some((r) => r.cells.some((c) => c.thin && c.value !== null));
  if (thin) append(root, [el('p', {}, TABLE.legend.thin)]);
  append(root, [el('p', {}, TABLE.legend.blocked)]);
  return root;
}

function limits(): HTMLElement {
  const list = el('ul', {});
  for (const item of TABLE.limits.items) append(list, [el('li', {}, item)]);
  return el('div', { class: 'limits' }, el('h3', {}, TABLE.limits.heading), list);
}

// --- the detail section ------------------------------------------------------

function detailCell(cell: TableCell, rowLabel: string): HTMLElement {
  const column = TABLE.columns[cell.horizon as keyof typeof TABLE.columns];
  const td = el('td', { class: 'score' });

  if (cell.ratio === null) {
    const reason = cell.blockers.length > 0 ? explain(cell.blockers) : '';
    append(td, [el('span', { class: 'absent', title: reason || undefined }, '—')]);
    return td;
  }

  const parts: (HTMLElement | string)[] = [
    el(
      'span',
      {
        class: cell.thin ? 'thin-mark' : undefined,
        title: cell.thin
          ? `${rowLabel}, over ${column.full}. Rests on ${cell.observations} days, fewer than the 20 the report asks for.`
          : `${rowLabel}, over ${column.full}. ${cell.observations} days.`,
      },
      formatRatio(cell.ratio),
    ),
  ];

  if (cell.shifted && cell.distanceFromBaseline !== null) {
    parts.push(
      el('span', {
        class: 'shift-dot',
        title: `${cell.distanceFromBaseline.toFixed(2)} away from the twelve-month reading in this row.`,
        'aria-label': `shifted by ${cell.distanceFromBaseline.toFixed(2)} from the twelve-month reading`,
      }),
    );
  }

  append(td, parts);
  return td;
}

/** Only the two same-direction rows. The other two are not on this page (3F D-17). */
function detailTable(model: LensATable): HTMLElement {
  const head = el(
    'tr',
    {},
    el('th', {}, TABLE.detail.firstColumn),
    ...HORIZONS.map((h: HorizonName) =>
      el('th', { class: 'num', title: TABLE.columns[h as keyof typeof TABLE.columns].full },
         TABLE.columns[h as keyof typeof TABLE.columns].short),
    ),
  );

  const body = el('tbody', {});
  for (const row of model.rows) {
    if (row.state !== 'fund_up_bench_up' && row.state !== 'fund_down_bench_down') continue;
    const label = TABLE.rows[row.state];
    const tr = el('tr', {});
    append(tr, [el('th', { class: 'row-label', scope: 'row', title: label.full }, label.label)]);
    append(tr, row.cells.map((c) => detailCell(c, label.full)));
    append(body, [tr]);
  }

  return el('div', { class: 'scroll-x' }, el('table', {}, el('thead', {}, head), body));
}

function detailLegend(model: LensATable): HTMLElement {
  const root = el('div', { class: 'legend' });
  const shown = model.rows.filter(
    (r) => r.state === 'fund_up_bench_up' || r.state === 'fund_down_bench_down',
  );
  // The dot is only explained where one can actually appear. A legend entry for
  // a marker the reader cannot find is a small puzzle with no answer.
  if (!model.baselineAbsent && model.shiftThreshold !== null) {
    append(root, [
      el(
        'p',
        {},
        el('span', { class: 'shift-dot', 'aria-hidden': 'true' }),
        ' ' + TABLE.legend.shift,
      ),
    ]);
  }
  if (shown.some((r) => r.cells.some((c) => c.thin))) {
    append(root, [el('p', {}, TABLE.legend.thin)]);
  }
  append(root, [el('p', {}, TABLE.legend.blocked)]);
  return root;
}

function detailSection(snapshot: Snapshot, benchmark: string): HTMLElement {
  const model = buildLensA(snapshot, benchmark);
  const body: (HTMLElement | null)[] = [
    el('p', {}, PLAIN.participation.mechanism),
    el('p', {}, TABLE.detail.intro),
    model.baselineAbsent
      ? el('div', { class: 'blocker' }, el('p', {}, TABLE.legend.noBaseline))
      : null,
    detailTable(model),
    detailLegend(model),
  ];
  return el(
    'details',
    { class: 'detail' },
    el('summary', {}, TABLE.detail.summary),
    ...body,
  );
}

/** The caveat nearly every fund in the coverage set carries. */
function outcomeCaveat(report: ReportDocument): HTMLElement | null {
  if (!report.methodology.defined_outcome_caveat) return null;
  return el(
    'div',
    { class: 'caveat' },
    el('h3', {}, PLAIN.outcome_period.title),
    el('p', {}, PLAIN.outcome_period.mechanism),
  );
}

function blockedNotes(model: ReportTable): HTMLElement | null {
  if (model.blockedHorizons.length === 0) return null;
  const root = el('div', { class: 'blocker' });
  for (const { horizon, blockers } of model.blockedHorizons) {
    const column = TABLE.columns[horizon as keyof typeof TABLE.columns];
    for (const b of blockers) {
      append(root, [
        el('p', {}, `${column.short}: ${b.message}`),
        el('p', { class: 'remedy' }, b.remedy),
      ]);
    }
  }
  return root;
}

/**
 * The way through to Lens B.
 *
 * Offered only for the lookbacks the archive can actually answer. A button that
 * leads to "there is no report from that far back" is a promise the page cannot
 * keep, and this reader has no way to know in advance which it is.
 */
function historyOffer(ctx: ReportContext, handlers: ReportHandlers): HTMLElement {
  const root = el('section', {});
  append(root, [el('h3', {}, PLAIN.history.title)]);

  if (ctx.history.length === 0) {
    append(root, [el('p', { class: 'quiet' }, PLAIN.history.whenAbsent)]);
    return root;
  }

  append(root, [el('p', {}, PLAIN.history.mechanism)]);
  const buttons = el('div', { class: 'controls' });
  const group = el('div', {});
  for (const l of ctx.history) {
    group.appendChild(
      el(
        'button',
        { onclick: () => handlers.onHistory(l) },
        l === '6mo' ? TABLE.history.sixMonth : TABLE.history.thirteenWeek,
      ),
    );
  }
  append(buttons, [group]);
  append(root, [buttons]);
  return root;
}

/**
 * The way through to Lens C.
 *
 * Only funds with a report for this same month are offered. Reading two funds a
 * month apart would put the difference between two stretches of market into a
 * table that says it is showing the difference between two funds, and nothing
 * on the page would separate the two.
 */
function compareOffer(ctx: ReportContext, handlers: ReportHandlers): HTMLElement {
  const root = el('section', {});
  append(root, [el('h3', {}, PLAIN.comparing_funds.title)]);

  if (ctx.companions.length === 0) {
    append(root, [el('p', { class: 'quiet' }, PLAIN.comparing_funds.whenAbsent)]);
    return root;
  }

  append(root, [el('p', {}, PLAIN.comparing_funds.mechanism)]);

  const select = el('select', {
    id: 'compare-with',
    onchange: (e) => {
      const picked = (e.target as HTMLSelectElement).value;
      if (picked) handlers.onCompare(picked);
    },
  });
  append(select, [el('option', { value: '' }, 'Pick a fund…')]);
  for (const other of ctx.companions) {
    append(select, [el('option', { value: other.ticker }, `${other.ticker} — ${other.name}`)]);
  }

  append(root, [
    el(
      'div',
      { class: 'controls' },
      el('div', {}, el('label', { for: 'compare-with' }, 'Set beside'), select),
    ),
  ]);
  return root;
}

function controls(ctx: ReportContext, handlers: ReportHandlers): HTMLElement {
  const root = el('div', { class: 'controls' });
  const benchmarks = Object.keys(ctx.report.benchmarks);

  // Only offered where there is a choice. A select with one option is a control
  // that looks like it does something.
  if (benchmarks.length > 1) {
    const select = el('select', {
      id: 'benchmark',
      onchange: (e) => handlers.onBenchmark((e.target as HTMLSelectElement).value),
    });
    for (const b of benchmarks) {
      const block = ctx.report.benchmarks[b]!;
      const named = block.roles.includes('named_benchmark');
      // The ticker alone does not say what it tracks, so the index travels
      // with it in the option the reader is choosing between.
      const index = benchmarkIndexShort(b);
      const label = index ? `${b} (${index})` : b;
      const option = el('option', { value: b }, named ? `${label} — the fund’s own choice` : `${label} — the shared yardstick`);
      if (b === ctx.benchmark) option.setAttribute('selected', 'selected');
      append(select, [option]);
    }
    append(root, [el('div', {}, el('label', { for: 'benchmark' }, 'Compared against'), select)]);
  }

  if (ctx.months.length > 1) {
    const select = el('select', {
      id: 'month',
      onchange: (e) => handlers.onMonth((e.target as HTMLSelectElement).value),
    });
    for (const m of [...ctx.months].reverse()) {
      const option = el('option', { value: m }, monthLabel(m));
      if (m === ctx.report.as_of.slice(0, 7)) option.setAttribute('selected', 'selected');
      append(select, [option]);
    }
    append(root, [el('div', {}, el('label', { for: 'month' }, 'Report from'), select)]);
  }

  return root;
}

export function renderReport(ctx: ReportContext, handlers: ReportHandlers): HTMLElement {
  const model = buildReportTable(ctx.report, ctx.benchmark);
  const root = el('section', {});

  append(root, [
    el('button', { class: 'back', onclick: () => handlers.onBack() }, '← All funds'),
    el('h2', {}, ctx.report.name),
    el('p', { class: 'quiet' }, `${ctx.report.ticker} · ${ctx.report.issuer}`),
    controls(ctx, handlers),
  ]);

  // Shown whether or not a chooser was drawn: a fund with one benchmark still
  // has its reading taken against a ticker the reader has to recognise.
  const indexNote = benchmarkIndexNote(ctx.benchmark);
  if (indexNote) {
    append(root, [el('p', { class: 'benchmark-index' }, indexNote)]);
  }

  if (ctx.benchmarkNote) {
    append(root, [el('p', { class: 'benchmark-note' }, ctx.benchmarkNote)]);
  }

  append(root, [el('h3', {}, PLAIN.money.title), el('p', {}, PLAIN.overview.mechanism)]);

  const lead = perOneSentences(model);
  if (lead) append(root, [lead]);

  append(root, [mainTable(model)]);
  append(root, [
    el(
      'p',
      { class: 'assumption' },
      `Worked out from daily closing prices up to ${model.asOf}, against ${model.benchmark}. “The market” here means ${model.benchmark}.`,
    ),
  ]);

  append(root, [legend(model)]);

  const blocked = blockedNotes(model);
  if (blocked) append(root, [blocked]);

  append(root, [
    renderReal({ ...ctx.real, report: ctx.report, benchmark: ctx.benchmark }, handlers.onAdviser),
  ]);

  append(root, [limits()]);
  append(root, [
    renderTrend(
      { report: ctx.report, earlier: ctx.earlier, benchmark: ctx.benchmark, column: ctx.trendColumn },
      handlers.onTrendColumn,
    ),
  ]);
  append(root, [detailSection(ctx.snapshot, ctx.benchmark)]);
  append(root, [historyOffer(ctx, handlers)]);
  append(root, [compareOffer(ctx, handlers)]);

  const caveat = outcomeCaveat(ctx.report);
  if (caveat) append(root, [caveat]);

  append(root, [
    el('p', { class: 'assumption' }, `What would change this: ${PLAIN.money.whatWouldChangeIt}`),
  ]);

  return root;
}
