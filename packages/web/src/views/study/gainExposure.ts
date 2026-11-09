// SPDX-License-Identifier: MIT
//
// The Gain Exposure selected report (3F D-25).
//
// Renders only. Every figure comes from the published document and every
// sentence from the deck; orderings and selections come from the core's study
// builders. The page is the one place on the site where funds are set side by
// side outside OBSERVER, as a dated report, never as a ranking.

import {
  GAIN_EXPOSURE as C,
  STUDY_BANDS,
  STUDY_LABELS as L,
  TABLE,
  append,
  bandFinding,
  clear,
  el,
  indexEtfSpread,
  readingFor,
  studyHero,
  studyRows,
  upbRange,
  type Basis,
  type LegPoint,
  type StudyDocument,
  type StudyFund,
  type StudyReading,
  type StudyRow,
} from '../../shim.ts';
import { fill } from '../report.ts';
import { svg, svgText } from '../svg.ts';

type Child = Node | string | null | undefined | false;

const MINUS = '−';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const fmt = (x: number | null | undefined, d = 2): string =>
  x == null ? '—' : (x < 0 ? MINUS : '') + Math.abs(x).toFixed(d);
const pct = (x: number | null | undefined, d = 1): string =>
  x == null ? '—' : (x > 0 ? '+' : x < 0 ? MINUS : '') + Math.abs(x * 100).toFixed(d) + '%';
const share = (x: number | null | undefined, d = 1): string =>
  x == null ? '—' : (x < 0 ? MINUS : '') + Math.abs(x * 100).toFixed(d) + '%';
const day = (iso: string): string => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;
const longDate = (iso: string): string =>
  `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const ordinal = (n: number): string =>
  n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
const ms = (iso: string): number => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const GCLS = { equity_sleeve: 'eq', synthetic_long: 'syn', reference_only: 'ref' } as const;

interface View {
  doc: StudyDocument;
  basis: Basis;
  ticker: string;
  showDay5: boolean;
}

/* ---- small shared pieces --------------------------------------------------- */

function section(accent: string, title: string, caption: string | null, ...children: Child[]): HTMLElement {
  const node = el('section', { class: `block accent-${accent}` },
    el('div', { class: 'section-head' }, el('h3', {}, title), caption ? el('p', { class: 'caption' }, caption) : null));
  append(node, children);
  return node;
}

function explain(summary: string, paragraphs: readonly string[]): HTMLElement {
  const node = el('details', { class: 'explain' }, el('summary', {}, summary));
  append(node, paragraphs.map((p) => el('p', {}, p)));
  return node;
}

function key(items: [string, string][]): HTMLElement {
  return el('div', { class: 'key' }, ...items.map(([cls, label]) => el('span', {}, el('i', { class: cls }), label)));
}

function tipFor(host: HTMLElement): HTMLElement {
  let tip = host.querySelector('.tip') as HTMLElement | null;
  if (!tip) {
    tip = el('div', { class: 'tip', hidden: 'hidden' });
    host.appendChild(tip);
  }
  return tip;
}

function showTip(host: HTMLElement, tip: HTMLElement, ev: PointerEvent, lines: Child[][]): void {
  clear(tip);
  lines.forEach((parts) => tip.appendChild(el('span', { class: 'line' }, ...parts)));
  tip.hidden = false;
  const box = host.getBoundingClientRect();
  const px = ev.clientX - box.left, py = ev.clientY - box.top;
  tip.style.left = `${Math.max(0, Math.min(host.clientWidth - tip.offsetWidth, px + 14))}px`;
  tip.style.top = `${Math.max(0, py - 10)}px`;
}

const sw = (cls: string): HTMLElement => el('span', { class: `sw ${cls}` });

function rowsByGroup(rows: StudyRow[], span: number, row: (r: StudyRow) => HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  let g: string | null = null;
  for (const r of rows) {
    if (r.fund.group !== g) {
      g = r.fund.group;
      out.push(el('tr', { class: `group ${GCLS[r.fund.group]}` }, el('th', { colspan: String(span) }, L.groups[r.fund.group])));
    }
    out.push(row(r));
  }
  return out;
}

const th = (text: string, cls?: string, extra: { colspan?: string; rowspan?: string } = {}) =>
  el('th', { class: cls, ...extra }, text);
const td = (text: string, cls?: string) => el('td', { class: cls }, text);

/* ---- the K frame ------------------------------------------------------------ */

interface Frame {
  root: SVGSVGElement;
  x: (iso: string) => number;
  y: (v: number) => number;
  W: number; L: number; R: number; T: number; B: number; H: number;
}

function kFrame(host: HTMLElement, doc: StudyDocument, H: number, yMin: number, yMax: number,
  opts: { aria: string; width?: number; right?: number }): Frame {
  clear(host);
  const W = opts.width ?? 900, Lm = 52, R = opts.right ?? 200, T = 18, B = 30;
  const year = doc.window.start.slice(0, 4);
  const X0 = ms(`${year}-01-01`), X1 = ms(doc.special_days[1]) + 86400000;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': opts.aria }, host) as SVGSVGElement;
  const x = (iso: string) => Lm + (ms(iso) - X0) / (X1 - X0) * (W - Lm - R);
  const y = (v: number) => T + (yMax - v) / (yMax - yMin) * (H - T - B);
  for (let k = Math.ceil(yMin / 0.2 - 1e-9); k * 0.2 <= yMax + 1e-9; k++) {
    const v = k * 0.2;
    svg('line', { x1: Lm, x2: W - R, y1: y(v), y2: y(v), class: Math.abs(v) < 1e-9 ? 'zero' : 'grid' }, root);
    svgText(root, Lm - 6, y(v) + 4, pct(v, 0), '', 'end');
  }
  const lastMonth = Number(doc.special_days[1].slice(5, 7));
  for (let m = 1; m <= lastMonth; m++) {
    const iso = `${year}-${String(m).padStart(2, '0')}-01`;
    if (m > 1) svg('line', { x1: x(iso), x2: x(iso), y1: H - B, y2: H - B + 4, class: 'zero' }, root);
    if (!opts.width || m % 2 === 1) svgText(root, x(iso) + 2, H - B + 16, MON[m - 1]!, '', 'start');
  }
  svg('line', { x1: Lm, x2: Lm, y1: y(yMax * 0.98), y2: y(yMin * 0.98), class: 'stem' }, root);
  return { root, x, y, W, L: Lm, R, T, B, H };
}

function line(points: [string, number][], F: Frame, start?: [string, number]): string {
  let d = start ? `M${F.x(start[0])},${F.y(start[1])}` : '';
  for (const [iso, v] of points) d += `${d ? 'L' : 'M'}${F.x(iso)},${F.y(v)}`;
  return d;
}

function area(points: [string, number][], F: Frame, from: string): string {
  if (!points.length) return '';
  let d = `M${F.x(from)},${F.y(0)}`;
  for (const [iso, v] of points) d += `L${F.x(iso)},${F.y(v)}`;
  return `${d}L${F.x(points[points.length - 1]![0])},${F.y(0)}Z`;
}

/** Each leg with its special day added as a last step. */
function withSpecial(doc: StudyDocument, r: StudyReading): { up: LegPoint[]; down: LegPoint[] } {
  const [d4, d5] = doc.special_days;
  const lu = r.legs.up[r.legs.up.length - 1]!, ld = r.legs.down[r.legs.down.length - 1]!;
  return {
    up: [...r.legs.up, [d4, lu[1] + r.nov4.fund, lu[2] + r.nov4.bench]],
    down: [...r.legs.down, [d5, ld[1] + r.nov5.fund, ld[2] + r.nov5.bench]],
  };
}

/* ---- sections ---------------------------------------------------------------- */

function hero(doc: StudyDocument): HTMLElement {
  const h = studyHero(doc);
  const cards: [string, string, string, string][] = [
    ['orange', C.hero.fall.label, pct(h.marketFall, 2), fill(C.hero.fall.sub, { days: String(h.marketDays), qqq: pct(h.qqqFall, 2) })],
    ['sky', C.hero.direct.label, fmt(h.directE), fill(C.hero.direct.sub, { n: String(h.directCount), below: String(h.directBelowOne) })],
    ['violet', C.hero.syn.label, fmt(h.synE), fill(C.hero.syn.sub, { n: String(h.synCount), settled: String(h.synSettledBelow) })],
    ['sky', C.hero.index.label, fmt(h.indexE), fill(C.hero.index.sub, { n: String(h.indexCount), max: fmt(h.indexUMax), min: fmt(h.indexUMin) })],
    ['gold', C.hero.giveBack.label, `${fmt(h.synGiveBack)}×`, fill(C.hero.giveBack.sub, { eq: `${fmt(h.eqGiveBack)}×` })],
  ];
  return el('section', { class: 'hero', 'aria-label': C.hero.heading },
    el('p', { class: 'hero-heading' }, C.hero.heading),
    el('div', { class: 'hero-grid' }, ...cards.map(([acc, label, value, sub]) =>
      el('div', { class: `hero-card accent-${acc}` },
        el('p', { class: 'hero-label' }, label), el('p', { class: 'hero-value' }, value), el('p', { class: 'hero-sub' }, sub)))));
}

function drawK(host: HTMLElement, v: View, f: StudyFund): void {
  const { benchmark: bn, reading: r } = readingFor(f, v.basis);
  const legs = withSpecial(v.doc, r);
  const [d4, d5] = v.doc.special_days;
  const sp4 = legs.up[legs.up.length - 1]!, sp5 = legs.down[legs.down.length - 1]!;
  const yMax = Math.max(...legs.up.map((p) => Math.max(p[1], p[2]))) * 1.06;
  const yMin = Math.min(...legs.down.map((p) => Math.min(p[1], p[2]))) * 1.06;
  const F = kFrame(host, v.doc, 520, yMin, yMax, { aria: fill(C.k.aria, { ticker: f.ticker, bench: bn }) });
  const from = v.doc.window.start;
  const bench = (pts: LegPoint[]) => pts.map((p) => [p[0], p[2]] as [string, number]);
  const fund = (pts: LegPoint[]) => pts.map((p) => [p[0], p[1]] as [string, number]);
  svg('path', { d: area(bench(legs.up), F, from), class: 'mk-up' }, F.root);
  svg('path', { d: area(bench(legs.down), F, from), class: 'mk-down' }, F.root);
  svg('path', { d: line(bench(legs.up), F, [from, 0]), class: 'mk-up-line' }, F.root);
  svg('path', { d: line(bench(legs.down), F, [from, 0]), class: 'mk-down-line' }, F.root);
  svg('line', { x1: F.x(d4) - 1, x2: F.x(d4) - 1, y1: F.y(yMax), y2: F.y(yMin), class: 'special' }, F.root);
  svg('path', { d: line(fund(r.legs.up), F, [from, 0]), class: 'fd-up' }, F.root);
  svg('path', { d: line(fund(r.legs.down), F, [from, 0]), class: 'fd-down' }, F.root);
  const lu = r.legs.up[r.legs.up.length - 1]!, ld = r.legs.down[r.legs.down.length - 1]!;
  svg('path', { d: `M${F.x(lu[0])},${F.y(lu[1])}L${F.x(d4)},${F.y(sp4[1])}`, class: 'fd-up', 'stroke-width': 4 }, F.root);
  svg('path', { d: `M${F.x(ld[0])},${F.y(ld[1])}L${F.x(d5)},${F.y(sp5[1])}`, class: 'fd-down', 'stroke-width': 4 }, F.root);
  svg('circle', { cx: F.x(d4), cy: F.y(sp4[1]), r: 5, class: 'sp-dot up' }, F.root);
  svg('circle', { cx: F.x(d5), cy: F.y(sp5[1]), r: 5, class: 'sp-dot down' }, F.root);

  // Direct labels on the right, spaced so they never collide.
  const lx = F.x(d5) + 14;
  const labels = ([
    [sp4[2], fill(C.k.labels.benchUp, { bench: bn, value: pct(sp4[2]) }), 'lab up'],
    [sp4[1], fill(C.k.labels.fundUp, { ticker: f.ticker, value: pct(sp4[1]) }), 'lab up'],
    [sp5[1], fill(C.k.labels.fundDown, { ticker: f.ticker, value: pct(sp5[1]) }), 'lab down'],
    [sp5[2], fill(C.k.labels.benchDown, { bench: bn, value: pct(sp5[2]) }), 'lab down'],
  ] as [number, string, string][]).map((l) => [F.y(l[0]) + 4, l[1], l[2]] as [number, string, string]).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < labels.length; i++) if (labels[i]![0] - labels[i - 1]![0] < 16) labels[i]![0] = labels[i - 1]![0] + 16;
  labels.forEach(([yy, text, cls]) => svgText(F.root, lx, yy, text, cls));
  svgText(F.root, F.x(d4) - 6, F.y(yMax) + 10, C.k.marker, 'lab ink', 'end');

  // Hover: a crosshair and the running figures to that date.
  const cross = svg('line', { y1: F.T, y2: F.H - F.B, class: 'cross', visibility: 'hidden' }, F.root);
  const hit = svg('rect', { x: F.L, y: F.T, width: F.W - F.L - F.R, height: F.H - F.T - F.B, fill: 'transparent' }, F.root);
  const tip = tipFor(host);
  const upTo = (arr: LegPoint[], iso: string) => { let out: LegPoint | null = null; for (const p of arr) { if (p[0] <= iso) out = p; else break; } return out; };
  const days = [...new Set([...legs.up, ...legs.down].map((p) => p[0]))].sort();
  hit.addEventListener('pointermove', (e) => {
    const ev = e as PointerEvent;
    const pt = F.root.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const loc = pt.matrixTransform(F.root.getScreenCTM()!.inverse());
    let best = days[0]!;
    for (const s of days) if (Math.abs(F.x(s) - loc.x) < Math.abs(F.x(best) - loc.x)) best = s;
    cross.setAttribute('x1', String(F.x(best))); cross.setAttribute('x2', String(F.x(best))); cross.setAttribute('visibility', 'visible');
    const u = upTo(legs.up, best), d = upTo(legs.down, best);
    const lines: Child[][] = [[el('b', {}, fill(best >= d4 ? C.k.tip.special : C.k.tip.day, { date: day(best) }))]];
    if (u) {
      lines.push([sw('k-mk-up'), fill(C.k.tip.benchUp, { bench: bn, value: pct(u[2]) })]);
      lines.push([sw('k-up'), fill(C.k.tip.fundUp, { ticker: f.ticker, value: pct(u[1]), share: fmt(u[1] / u[2]) })]);
    }
    if (d) {
      lines.push([sw('k-mk-down'), fill(C.k.tip.benchDown, { bench: bn, value: pct(d[2]) })]);
      lines.push([sw('k-down'), fill(C.k.tip.fundDown, { ticker: f.ticker, value: pct(d[1]), share: fmt(1 - d[1] / d[2]) })]);
    }
    showTip(host, tip, ev, lines);
  });
  hit.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
}

function kLead(v: View, f: StudyFund): string {
  const { benchmark: bn, reading: r } = readingFor(f, v.basis);
  if (r.E === null) return fill(C.k.noE, { ticker: f.ticker, name: f.name });
  const range = !r.E_range ? '' : fill(
    r.E_settled === 'above_1' ? C.k.rangeAbove : r.E_settled === 'below_1' ? C.k.rangeBelow : C.k.rangeOpen,
    { lo: fmt(r.E_range[0]), hi: fmt(r.E_range[1]) });
  return fill(C.k.lead, {
    ticker: f.ticker, name: f.name, first: day(r.first_day), upDays: String(r.up_days), downDays: String(r.down_days),
    bench: bn, u: fmt(r.u), b: fmt(r.b), taken: fmt(1 - r.b), E: fmt(r.E), range,
    gl: fmt(r.market_gain_loss), versus: r.E < r.market_gain_loss ? C.k.moreThan : C.k.lessThan,
    net: pct(r.fund_net_sum), bnet: pct(r.bench_net_sum),
  });
}

function kSpecial(v: View, f: StudyFund): string {
  const { benchmark: bn, reading: r } = readingFor(f, v.basis);
  return fill(C.k.special, {
    bench: bn, ticker: f.ticker, m4: pct(r.nov4.bench, 2), f4: pct(r.nov4.fund, 2), kept: fmt(r.nov4.kept), u: fmt(r.u),
    m5: pct(r.nov5.bench, 2), rank: r.nov5.rank === 1 ? C.k.rankFirst : fill(C.k.rankNth, { nth: ordinal(r.nov5.rank) }),
    f5: pct(r.nov5.fund, 2), avoided: fmt(r.nov5.avoided), b: fmt(r.b),
    gbf: share(r.nov5.given_back_fund), gbm: share(r.nov5.given_back_bench), ratio: fmt(r.nov5.E),
  });
}

function drawPlane(host: HTMLElement, v: View): void {
  clear(host);
  const rows: ({ head: string } | StudyRow)[] = [];
  let g: string | null = null;
  for (const r of studyRows(v.doc, v.basis)) {
    if (r.fund.group !== g) { g = r.fund.group; rows.push({ head: L.groups[r.fund.group] }); }
    rows.push(r);
  }
  const RH = 20, W = 900, Lm = 70, R = 24, T = 26, B = 40, H = T + rows.length * RH + B, lo = 0, hi = 1.7;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': C.exposure.aria }, host);
  const x = (val: number) => Lm + (Math.max(lo, Math.min(hi, val)) - lo) / (hi - lo) * (W - Lm - R);
  for (let k = 0; k <= Math.round(hi * 10); k++) {
    const val = k / 10, major = k % 5 === 0;
    svg('line', { x1: x(val), x2: x(val), y1: T - 6, y2: H - B, class: 'grid', opacity: major ? 1 : 0.45 }, root);
    if (major) { svgText(root, x(val), H - B + 16, val.toFixed(1), '', 'middle'); svgText(root, x(val), T - 10, val.toFixed(1), '', 'middle'); }
  }
  svg('line', { x1: x(1), x2: x(1), y1: T - 6, y2: H - B, class: 'diag' }, root);
  svgText(root, x(0.98), H - 8, C.exposure.less, 'lab ink', 'end');
  svgText(root, x(1.02), H - 8, C.exposure.more, 'lab ink', 'start');
  const tip = tipFor(host);
  rows.forEach((row, i) => {
    const cy = T + i * RH + RH / 2;
    if ('head' in row) { svgText(root, 0, cy + 4, row.head, 'ghead'); return; }
    const { fund: f, reading: r, benchmark: bn } = row;
    svgText(root, 0, cy + 4, f.ticker, 'row');
    if (r.E_range) {
      svg('line', { x1: x(r.E_range[0]), x2: x(r.E_range[1]), y1: cy, y2: cy, class: 'ci' }, root);
      if (r.E_range[0] >= lo) svg('line', { x1: x(r.E_range[0]), x2: x(r.E_range[0]), y1: cy - 4, y2: cy + 4, class: 'ci-cap' }, root);
      if (r.E_range[1] <= hi) svg('line', { x1: x(r.E_range[1]), x2: x(r.E_range[1]), y1: cy - 4, y2: cy + 4, class: 'ci-cap' }, root);
    }
    const cls = f.group === 'synthetic_long' ? 'pt-syn' : f.group === 'equity_sleeve' ? 'pt-eq' : 'pt-ref';
    if (r.E !== null) {
      if (f.group === 'equity_sleeve') svg('rect', { x: x(r.E) - 5.5, y: cy - 5.5, width: 11, height: 11, class: `ring ${cls}` }, root);
      else svg('circle', { cx: x(r.E), cy, r: 6, class: `ring ${cls}` }, root);
    }
    if (v.showDay5 && r.nov5.E !== null) svg('circle', { cx: x(r.nov5.E), cy, r: 5, class: 'day5' }, root);
    const hit = svg('rect', { x: 0, y: cy - RH / 2, width: W, height: RH, fill: 'transparent' }, root);
    hit.addEventListener('pointerenter', (e) => showTip(host, tip, e as PointerEvent, [
      [el('b', {}, fill(C.exposure.tip.head, { ticker: f.ticker, held: L.subgroups[f.subgroup], bench: bn }))],
      [fill(C.exposure.tip.shares, { u: fmt(r.u), b: fmt(r.b) })],
      [fill(C.exposure.tip.e, { E: fmt(r.E), range: r.E_range ? `${fmt(r.E_range[0])}–${fmt(r.E_range[1])}` : '—' })],
      [fill(C.exposure.tip.day, { avoided: fmt(r.nov5.avoided), E5: fmt(r.nov5.E) })],
    ]));
    hit.addEventListener('pointerleave', () => { tip.hidden = true; });
  });
}

function asymTable(v: View): HTMLElement {
  const t = C.exposure.table;
  return el('table', {},
    el('thead', {}, el('tr', {}, th(t.fund), th(t.held), th(t.against), th(t.u, 'num'), th(t.b, 'num'), th(t.upb, 'num'),
      th(t.e, 'num'), th(t.range, 'num'), th(t.vs))),
    el('tbody', {}, ...rowsByGroup(studyRows(v.doc, v.basis), 9, ({ fund: f, reading: r, benchmark: bn }) =>
      el('tr', { class: f.ticker === v.ticker ? 'hl' : undefined },
        td(f.ticker + (f.flag ? ' *' : ''), 'ticker'), el('td', {}, el('span', { class: 'tag' }, L.subgroups[f.subgroup])),
        td(bn, 'ticker'), td(fmt(r.u), 'num'), td(fmt(r.b), 'num'), td(fmt(r.u_plus_b), 'num'),
        el('td', { class: 'num' }, el('b', {}, fmt(r.E))),
        td(r.E_range ? `${fmt(r.E_range[0])}–${fmt(r.E_range[1])}` : '—', 'num dim'),
        td(r.E_settled ? L.settled[r.E_settled] : '—', `settled-${r.E_settled}`)))));
}

function daysTable(v: View): HTMLElement {
  const t = C.exposure.days;
  return el('table', {},
    el('thead', {},
      el('tr', {}, th(C.exposure.table.fund, undefined, { rowspan: '2' }), th(C.exposure.table.against, undefined, { rowspan: '2' }),
        th(t.kept, 'span', { colspan: '2' }), th(t.avoided, 'span', { colspan: '2' }), th(t.exposure, 'span', { colspan: '2' })),
      el('tr', { class: 'sub' }, ...[t.nov4, t.uYear, t.nov5, t.bYear, t.e5, t.eYear].map((s) => th(s, 'num')))),
    el('tbody', {}, ...rowsByGroup(studyRows(v.doc, v.basis), 8, ({ fund: f, reading: r, benchmark: bn }) =>
      el('tr', { class: f.ticker === v.ticker ? 'hl' : undefined },
        td(f.ticker + (f.flag ? ' *' : ''), 'ticker'), td(bn, 'ticker'),
        el('td', { class: 'num' }, el('b', {}, fmt(r.nov4.kept))), td(fmt(r.u), 'num dim'),
        el('td', { class: 'num' }, el('b', {}, fmt(r.nov5.avoided))), td(fmt(r.b), 'num dim'),
        el('td', { class: 'num' }, el('b', {}, r.nov5.E === null ? '—' : `${fmt(r.nov5.E)}×`)), td(fmt(r.E), 'num dim')))));
}

function drawGroup(host: HTMLElement, caption: HTMLElement, v: View, group: 'equity_sleeve' | 'synthetic_long'): void {
  const doc = v.doc;
  const members = doc.funds.filter((f) => f.group === group);
  // VOO's own legs: the benchmark column is the same for every fund read over the whole window.
  const full = doc.funds.map((f) => f.readings['VOO']!).reduce((a, b) => (b.days > a.days ? b : a));
  const market = withSpecial(doc, full);
  const mUp = market.up.map((p) => [p[0], p[2]] as [string, number]);
  const mDn = market.down.map((p) => [p[0], p[2]] as [string, number]);
  const yMax = mUp[mUp.length - 1]![1] * 1.06, yMin = mDn[mDn.length - 1]![1] * 1.06;
  const F = kFrame(host, doc, 400, yMin, yMax, { aria: fill(C.groups.aria, { group: L.groups[group] }), right: 40, width: 460 });
  svg('path', { d: area(mUp, F, doc.window.start), class: 'mk-up' }, F.root);
  svg('path', { d: area(mDn, F, doc.window.start), class: 'mk-down' }, F.root);
  const tip = tipFor(host);
  for (const f of members) {
    const r = f.readings['VOO']!;
    const legs = withSpecial(doc, r);
    const start: [string, number] = [r.first_day, 0];
    const drawn: SVGElement[] = [];
    for (const [pts, cls] of [[legs.up, 'thin-up'], [legs.down, 'thin-down']] as const) {
      const d = line(pts.map((p) => [p[0], p[1]] as [string, number]), F, start);
      drawn.push(svg('path', { d, class: cls }, F.root));
      const hit = svg('path', { d, class: 'hit' }, F.root);
      hit.addEventListener('pointerenter', (e) => {
        drawn.forEach((n) => n.setAttribute('class', `${n.getAttribute('class')!.split(' ')[0]} hot`));
        showTip(host, tip, e as PointerEvent, [
          [el('b', {}, fill(C.groups.tip.head, { ticker: f.ticker, held: L.subgroups[f.subgroup] }))],
          [fill(C.groups.tip.kept, { u: fmt(r.u) })], [fill(C.groups.tip.avoided, { b: fmt(r.b) })], [fill(C.groups.tip.e, { E: fmt(r.E) })],
        ]);
      });
      hit.addEventListener('pointerleave', () => {
        drawn.forEach((n) => n.setAttribute('class', n.getAttribute('class')!.split(' ')[0]!));
        tip.hidden = true;
      });
    }
  }
  const end = doc.special_days[1];
  svgText(F.root, F.x(end) + 6, F.y(mUp[mUp.length - 1]![1]) + 4, 'VOO', 'lab up');
  svgText(F.root, F.x(end) + 6, F.y(mDn[mDn.length - 1]![1]) + 4, 'VOO', 'lab down');
  const S = doc.summaries.VOO[`group:${group}`]!;
  caption.textContent = fill(C.groups.caption, { n: String(S.tickers.length), u: fmt(S.u?.median), b: fmt(S.b?.median), E: fmt(S.E?.median) });
}

function bandsText(v: View): string {
  const voo = v.doc.benchmarks['VOO']!;
  const [d4, d5] = v.doc.special_days;
  const f = bandFinding(v.doc, v.basis);
  return [
    fill(C.bands.edges, { t1: share(voo.band_edges.t1, 2), t2: share(voo.band_edges.t2, 2), d9: share(voo.band_edges.d9, 2),
      m4: pct(voo.moves[d4], 2), m5: pct(voo.moves[d5], 2) }),
    fill(C.bands.finding, { synSmall: fmt(f.synSmall), synLarge: fmt(f.synLarge), eqSmall: fmt(f.eqSmall), eqLarge: fmt(f.eqLarge) }),
    fill(f.lessAgain ? C.bands.lessAgain : C.bands.nov5, { syn: fmt(f.synNov5), eq: fmt(f.eqNov5) }),
  ].join(' ');
}

function bandsHead(first: string, second: string, secondCls?: string): HTMLElement {
  const h = C.bands.head;
  return el('thead', {},
    el('tr', {}, th(first, undefined, { rowspan: '2' }), th(second, secondCls, { rowspan: '2' }),
      th(h.small, 'span', { colspan: '2' }), th(h.medium, 'span', { colspan: '2' }), th(h.large, 'span', { colspan: '2' }),
      th(h.top, 'span', { colspan: '2' }), th(h.nov4, 'span'), th(h.nov5, 'span')),
    el('tr', { class: 'sub' }, ...[...STUDY_BANDS.flatMap(() => [h.u, h.b]), h.u, h.b].map((s) => th(s, 'num'))));
}

function bandsTable(v: View): HTMLElement {
  const S = v.doc.summaries[v.basis];
  const m = (s: { median: number } | null | undefined) => fmt(s?.median);
  return el('table', {}, bandsHead(C.bands.head.group, C.bands.head.n, 'num'),
    el('tbody', {}, ...(Object.keys(L.bandRows) as (keyof typeof L.bandRows)[]).map((k) => {
      const s = S[k]!;
      return el('tr', {}, el('th', { class: 'row-label' }, L.bandRows[k]), td(String(s.tickers.length), 'num'),
        ...STUDY_BANDS.flatMap((b) => [td(m(s.bands[b].u), 'num'), td(m(s.bands[b].b), 'num')]),
        el('td', { class: 'num' }, el('b', {}, m(s.nov4_day_capture))), el('td', { class: 'num' }, el('b', {}, m(s.nov5_day_buffer))));
    })));
}

function bandsAll(v: View): HTMLElement {
  return el('table', {}, bandsHead(C.exposure.table.fund, C.bands.head.against),
    el('tbody', {}, ...rowsByGroup(studyRows(v.doc, v.basis), 12, ({ fund: f, reading: r, benchmark: bn }) =>
      el('tr', {}, td(f.ticker, 'ticker'), td(bn, 'ticker'),
        ...STUDY_BANDS.flatMap((b) => [td(fmt(r.bands[b].u), 'num'), td(fmt(r.bands[b].b), 'num')]),
        el('td', { class: 'num' }, el('b', {}, fmt(r.nov4.kept))), el('td', { class: 'num' }, el('b', {}, fmt(r.nov5.avoided)))))));
}

function quadTable(v: View): HTMLElement {
  const h = C.quad.head;
  return el('table', {},
    el('thead', {}, el('tr', {}, ...[h.fund, h.against].map((s) => th(s)), ...[h.uAll, h.uBoth, h.days, h.bAll, h.bBoth, h.days].map((s) => th(s, 'num')))),
    el('tbody', {}, ...rowsByGroup(studyRows(v.doc, v.basis), 8, ({ fund: f, reading: r, benchmark: bn }) =>
      el('tr', {}, td(f.ticker, 'ticker'), td(bn, 'ticker'), td(fmt(r.u), 'num'), td(fmt(r.both_up.capture), 'num'),
        td(String(r.both_up.days), 'num dim'), td(fmt(r.b), 'num'),
        td(r.both_down.capture === null ? '—' : fmt(1 - r.both_down.capture), 'num'), td(String(r.both_down.days), 'num dim')))));
}

function blocks(b: Record<string, number> | null | undefined): string {
  if (!b) return '—';
  const name = (k: string) => (L.blocks as Record<string, string>)[k] ?? L.blocks.other;
  return Object.entries(b).filter(([, x]) => Math.abs(x) >= 0.5).slice(0, 4)
    .map(([k, x]) => `${name(k)} ${x.toFixed(0)}%`).join(', ');
}

function groupingTable(v: View): HTMLElement {
  const h = C.grouping.head;
  return el('table', {},
    el('thead', {}, el('tr', {}, th(h.fund), th(h.held), th(h.report, 'num'), th(h.kinds), th(h.look))),
    el('tbody', {}, ...rowsByGroup(studyRows(v.doc, 'named'), 5, ({ fund: f }) => {
      const lt = f.holdings.look_through;
      return el('tr', {},
        el('td', { class: 'ticker' }, f.holdings.source ? el('a', { href: f.holdings.source }, f.ticker) : f.ticker),
        el('td', {}, el('span', { class: 'tag' }, L.subgroups[f.subgroup])),
        td(f.holdings.period ?? '—', 'num'), td(blocks(f.holdings.blocks), 'small'),
        td(lt ? `${lt.ticker ?? lt.title}: ${blocks(lt.blocks)}` : '—', 'small'));
    })));
}

/* ---- the page ---------------------------------------------------------------- */

export interface StudyHandlers {
  onBack: () => void;
}

export function renderGainExposure(doc: StudyDocument, handlers: StudyHandlers): HTMLElement {
  const v: View = { doc, basis: 'named', ticker: 'SFLR', showDay5: true };
  if (!doc.funds.some((f) => f.ticker === v.ticker)) v.ticker = doc.funds[0]!.ticker;

  // Live parts, redrawn on a change of basis or fund.
  const kHost = el('div', { class: 'chart wide' });
  const kLeadP = el('p', { class: 'lead fund' });
  const kSpecialP = el('p', { class: 'caption small' });
  const planeHost = el('div', { class: 'chart wide' });
  const upbP = el('p', {});
  const exampleP = el('p', {});
  const asymHost = el('div', { class: 'scroll-x' });
  const indexP = el('p', { class: 'caption small' });
  const daysHost = el('div', { class: 'scroll-x' });
  const bandsP = el('p', {});
  const bandsHost = el('div', { class: 'scroll-x' });
  const bandsAllHost = el('div', { class: 'scroll-x' });
  const quadHost = el('div', { class: 'scroll-x' });

  const flagged = doc.funds.filter((f) => f.flag);
  const flagNotes = flagged.map((f) => el('p', { class: 'caption small' }, fill(C.exposure.flagNote, { ticker: f.ticker, flag: f.flag! })));

  const fundSel = el('select', { id: 'study-fund' },
    ...studyRows(doc, 'named').map(({ fund: f }) => el('option', { value: f.ticker }, `${f.ticker} · ${f.name}`)));
  fundSel.value = v.ticker;
  const basisSel = el('select', { id: 'study-basis' },
    el('option', { value: 'named' }, C.basis.named), el('option', { value: 'VOO' }, C.basis.voo));
  const day5 = el('input', { type: 'checkbox', id: 'study-day5' });
  day5.checked = true;

  const fundNow = () => doc.funds.find((f) => f.ticker === v.ticker)!;
  const drawFund = () => {
    const f = fundNow();
    kLeadP.textContent = kLead(v, f);
    kSpecialP.textContent = kSpecial(v, f);
    drawK(kHost, v, f);
  };
  const drawTables = () => {
    clear(asymHost); asymHost.appendChild(asymTable(v));
    clear(daysHost); daysHost.appendChild(daysTable(v));
  };
  const redraw = () => {
    drawFund();
    drawPlane(planeHost, v);
    drawTables();
    const range = upbRange(doc, v.basis);
    upbP.textContent = fill(C.exposure.upb, { n: String(range.n), lo: fmt(range.lo), hi: fmt(range.hi) });
    exampleP.textContent = fill(C.exposure.example, { gl: fmt(doc.funds.find((f) => f.readings['VOO'])!.readings['VOO']!.market_gain_loss) });
    indexP.textContent = fill(C.exposure.indexNote, {
      list: indexEtfSpread(doc, v.basis).map((p) => fill(C.exposure.indexItem, { ticker: p.ticker, u: fmt(p.u) })).join(', '),
    });
    bandsP.textContent = bandsText(v);
    clear(bandsHost); bandsHost.appendChild(bandsTable(v));
    clear(bandsAllHost); bandsAllHost.appendChild(bandsAll(v));
    clear(quadHost); quadHost.appendChild(quadTable(v));
  };
  basisSel.addEventListener('change', () => { v.basis = basisSel.value === 'VOO' ? 'VOO' : 'named'; redraw(); });
  fundSel.addEventListener('change', () => { v.ticker = fundSel.value; drawFund(); drawTables(); });
  day5.addEventListener('change', () => { v.showDay5 = day5.checked; drawPlane(planeHost, v); });

  const eqHost = el('div', { class: 'chart' }), synHost = el('div', { class: 'chart' });
  const eqCap = el('p', { class: 'caption small' }), synCap = el('p', { class: 'caption small' });

  const page = el('article', { class: 'study' },
    el('p', { class: 'study-back' }, el('a', { href: '#/', onclick: (e: MouseEvent) => { e.preventDefault(); handlers.onBack(); } }, C.back)),
    el('p', { class: 'kicker' }, fill(C.kicker, { published: longDate(doc.published) })),
    el('h2', {}, doc.title),
    el('p', { class: 'standfirst' }, C.standfirst),
    hero(doc),
    el('section', { class: 'block' },
      el('div', { class: 'controls' }, el('div', {}, el('label', { for: 'study-basis' }, C.basis.label), basisSel)),
      el('p', { class: 'caption small' }, C.basis.caption)),
    section('blue', C.k.title, C.k.caption,
      el('div', { class: 'controls' }, el('div', {}, el('label', { for: 'study-fund' }, C.k.fund), fundSel)),
      kLeadP,
      key([['k-mk-up', C.k.key.marketUp], ['line k-up', C.k.key.fundUp], ['k-mk-down', C.k.key.marketDown], ['line k-down', C.k.key.fundDown]]),
      kHost, kSpecialP, explain(TABLE.explainSummary, C.k.explain)),
    section('violet', C.exposure.title, C.exposure.caption,
      el('p', {}, C.exposure.intro), el('p', {}, C.exposure.parts),
      el('div', { class: 'formula' }, C.exposure.formula),
      exampleP, upbP, el('p', {}, C.exposure.nov5),
      key([['dot k-syn', C.exposure.key.syn], ['sq k-eq', C.exposure.key.eq], ['line k-quiet', C.exposure.key.range],
        ['dot k-day5', C.exposure.key.day5], ['dash k-ink', C.exposure.key.one]]),
      el('div', { class: 'toggle' }, day5, el('label', { for: 'study-day5' }, C.exposure.toggle)),
      planeHost, explain(TABLE.explainSummary, C.exposure.explain),
      asymHost, indexP, ...flagNotes,
      el('h4', {}, C.exposure.days.title), el('p', { class: 'caption small' }, C.exposure.days.caption),
      daysHost, explain(C.exposure.noise.summary, [C.exposure.noise.body])),
    section('sky', C.groups.title, null,
      el('p', { class: 'lead vs-voo' }, C.groups.voo),
      el('div', { class: 'panels' },
        el('div', {}, el('h4', {}, L.groups.equity_sleeve), eqCap, eqHost),
        el('div', {}, el('h4', {}, L.groups.synthetic_long), synCap, synHost)),
      el('p', { class: 'caption small' }, C.groups.hover)),
    section('orange', C.bands.title, C.bands.caption,
      el('p', {}, C.bands.refresh), bandsP, bandsHost, explain(TABLE.explainSummary, C.bands.explain),
      el('details', { class: 'detail' }, el('summary', {}, C.bands.every), bandsAllHost)),
    el('section', { class: 'block limits' },
      el('div', { class: 'section-head' }, el('h3', {}, C.limits.title)),
      el('ul', {}, ...C.limits.items.map((s) => el('li', {}, s)))),
    el('section', { class: 'block' },
      el('details', { class: 'detail' }, el('summary', {}, C.quad.summary), el('p', { class: 'small' }, C.quad.body), quadHost),
      el('details', { class: 'detail' }, el('summary', {}, C.grouping.summary),
        el('p', { class: 'small' }, fill(C.grouping.body, { approved: longDate(doc.provenance.grouping_approved) })),
        el('div', { class: 'scroll-x' }, groupingTable(v)))),
    el('p', { class: 'caption small' }, fill(C.footer, {
      fetched: longDate(doc.provenance.prices_fetched_at.slice(0, 10)), published: longDate(doc.published) })),
  );

  redraw();
  drawGroup(eqHost, eqCap, v, 'equity_sleeve');
  drawGroup(synHost, synCap, v, 'synthetic_long');
  return page;
}

