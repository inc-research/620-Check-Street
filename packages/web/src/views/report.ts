// SPDX-License-Identifier: MIT
//
// Lens A: one fund, one benchmark, one month, read across window lengths.
//
// This file renders and computes nothing (INV-5). Every marker it draws was
// decided in `buildLensA`, and every sentence it prints came from the copy deck,
// which the lint runs over as a test. Text is set through `textContent`
// throughout, so nothing a data file carries can become markup.

import {
  BASELINE,
  HORIZONS,
  PLAIN,
  TABLE,
  append,
  buildLensA,
  el,
  explain,
  type HorizonName,
  type LensATable,
  type Snapshot,
  type Lookback,
  type StateName,
  type TableCell,
} from '../shim.ts';

export interface ReportHandlers {
  onBenchmark: (benchmark: string) => void;
  onMonth: (month: string) => void;
  onHistory: (lookback: Lookback) => void;
  onCompare: (ticker: string) => void;
  onBack: () => void;
}

export interface ReportContext {
  snapshot: Snapshot;
  benchmark: string;
  months: readonly string[];
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
 * The ratio, as the table prints it.
 *
 * Two decimals and an explicit sign on negatives. A minus sign is the whole
 * difference between "the fund moved a little the same way" and "the fund moved
 * the other way", and about a third of the two opposite-direction rows are
 * negative (3F D-12) — losing it would be the same mistake the bounded score
 * made.
 */
export function formatRatio(value: number): string {
  const text = Math.abs(value).toFixed(2);
  // U+2212 minus, not a hyphen: it aligns with the digits at this size.
  return value < 0 ? `\u2212${text}` : text;
}

/**
 * One cell.
 *
 * A blocked cell shows a dash and nothing else. The legend says a dash is not a
 * zero, because a zero and an unknown are opposite claims and on a page of
 * numbers the dash is the easier of the two to misread (INV-2).
 */
function scoreCell(cell: TableCell, rowLabel: string): HTMLElement {
  const column = TABLE.columns[cell.horizon as keyof typeof TABLE.columns];
  const td = el('td', { class: 'score' });

  if (cell.ratio === null) {
    const reason = cell.blockers.length > 0 ? explain(cell.blockers) : '';
    append(td, [el('span', { class: 'absent', title: reason || undefined }, '—')]);
    return td;
  }

  const parts: (HTMLElement | string)[] = [];
  const number = el(
    'span',
    {
      class: cell.thin ? 'thin-mark' : undefined,
      title: cell.thin
        ? `${rowLabel}, over ${column.full}: for every 1% the market moved, this fund moved ${formatRatio(cell.ratio)}%. Rests on ${cell.observations} days, fewer than the 20 the report asks for.`
        : `${rowLabel}, over ${column.full}: for every 1% the market moved, this fund moved ${formatRatio(cell.ratio)}%. ${cell.observations} days.`,
    },
    formatRatio(cell.ratio),
  );
  parts.push(number);

  if (cell.shifted && cell.distanceFromBaseline !== null) {
    parts.push(
      el(
        'span',
        {
          class: 'shift-dot',
          title: `${cell.distanceFromBaseline.toFixed(2)} away from the twelve-month reading in this row.`,
          'aria-label': `shifted by ${cell.distanceFromBaseline.toFixed(2)} from the twelve-month reading`,
        },
      ),
    );
  }

  append(td, parts);
  return td;
}

function groupHeading(text: string, blurb: string): HTMLElement {
  const tr = el('tr', { class: 'group' });
  const th = el('th', { colspan: String(1 + HORIZONS.length), title: blurb }, text);
  append(tr, [th]);
  return tr;
}

function tableFor(model: LensATable): HTMLElement {
  const head = el(
    'tr',
    {},
    el('th', {}, 'On days when…'),
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
      const copy = group === 'participation' ? TABLE.participation : TABLE.resilience;
      append(body, [groupHeading(copy.heading, copy.blurb)]);
    }

    const label = TABLE.rows[row.state as StateName];
    const tr = el('tr', { class: label.direction });
    append(tr, [el('th', { class: 'row-label', scope: 'row', title: label.full }, label.label)]);
    append(tr, row.cells.map((c) => scoreCell(c, label.full)));
    append(body, [tr]);
  }

  return el(
    'div',
    { class: 'scroll-x' },
    el('table', {}, el('thead', {}, head), body),
  );
}

function legend(model: LensATable): HTMLElement {
  const root = el('div', { class: 'legend' });
  const lines: HTMLElement[] = [];

  const tint = el('p', {});
  append(tint, [
    el('span', { class: 'swatch-above', 'aria-hidden': 'true' }),
    el('span', { class: 'swatch-below', 'aria-hidden': 'true' }),
    ' ' + TABLE.legend.tint,
  ]);
  lines.push(tint);

  // The dot is only explained where one can actually appear. A legend entry for
  // a marker the reader cannot find is a small puzzle with no answer.
  if (!model.baselineAbsent && model.shiftThreshold !== null) {
    const shift = el('p', {});
    append(shift, [el('span', { class: 'shift-dot', 'aria-hidden': 'true' }), ' ' + TABLE.legend.shift]);
    lines.push(shift);
  }

  lines.push(el('p', {}, TABLE.legend.thin));
  lines.push(el('p', {}, TABLE.legend.blocked));

  append(root, lines);
  return root;
}

/** The caveat nearly every fund in the coverage set carries. */
function outcomeCaveat(snapshot: Snapshot): HTMLElement | null {
  if (!snapshot.methodology.defined_outcome_caveat) return null;
  return el(
    'div',
    { class: 'caveat' },
    el('h3', {}, PLAIN.outcome_period.title),
    el('p', {}, PLAIN.outcome_period.mechanism),
  );
}

/** 3F-O-02: said once, above the table, rather than left as an absence. */
function noBaselineNotice(model: LensATable): HTMLElement | null {
  if (!model.baselineAbsent) return null;
  return el('div', { class: 'blocker' }, el('p', {}, TABLE.legend.noBaseline));
}

function blockedNotes(model: LensATable): HTMLElement | null {
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
  const benchmarks = Object.keys(ctx.snapshot.benchmarks);

  // Only offered where there is a choice. A select with one option is a control
  // that looks like it does something.
  if (benchmarks.length > 1) {
    const select = el('select', {
      id: 'benchmark',
      onchange: (e) => handlers.onBenchmark((e.target as HTMLSelectElement).value),
    });
    for (const b of benchmarks) {
      const block = ctx.snapshot.benchmarks[b]!;
      const named = block.roles.includes('named_benchmark');
      const option = el('option', { value: b }, named ? `${b} — the fund’s own choice` : `${b} — the shared yardstick`);
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
      if (m === ctx.snapshot.as_of.slice(0, 7)) option.setAttribute('selected', 'selected');
      append(select, [option]);
    }
    append(root, [el('div', {}, el('label', { for: 'month' }, 'Report from'), select)]);
  }

  return root;
}

export function renderReport(ctx: ReportContext, handlers: ReportHandlers): HTMLElement {
  const model = buildLensA(ctx.snapshot, ctx.benchmark);
  const root = el('section', {});

  append(root, [
    el('button', { class: 'back', onclick: () => handlers.onBack() }, '← All funds'),
    el('h2', {}, ctx.snapshot.name),
    el('p', { class: 'quiet' }, `${ctx.snapshot.ticker} · ${ctx.snapshot.issuer}`),
    controls(ctx, handlers),
  ]);

  if (ctx.benchmarkNote) {
    append(root, [el('p', { class: 'benchmark-note' }, ctx.benchmarkNote)]);
  }

  append(root, [
    el('h3', {}, PLAIN.participation.title),
    el('p', {}, PLAIN.overview.mechanism),
    el('h4', {}, TABLE.reading.heading),
    el('p', {}, TABLE.reading.body),
  ]);

  const notice = noBaselineNotice(model);
  if (notice) append(root, [notice]);

  append(root, [tableFor(model)]);
  append(root, [
    el(
      'p',
      { class: 'assumption' },
      `Worked out from daily closing prices up to ${model.asOf}, against ${model.benchmark}.`,
    ),
  ]);

  append(root, [legend(model)]);
  append(root, [historyOffer(ctx, handlers)]);
  append(root, [compareOffer(ctx, handlers)]);

  const blocked = blockedNotes(model);
  if (blocked) append(root, [blocked]);

  const caveat = outcomeCaveat(ctx.snapshot);
  if (caveat) append(root, [caveat]);

  append(root, [
    el('p', { class: 'assumption' }, `What would change this: ${PLAIN.horizons.whatWouldChangeIt}`),
  ]);

  return root;
}
