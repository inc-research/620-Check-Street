// SPDX-License-Identifier: MIT
//
// A selected report proves what it can about itself (3F D-25), the way a report
// does (report/validate.ts): every ratio is what its stored sums say it is, the
// days balance, each leg ends where its sums do, the range agrees with its label,
// and every group figure is the middle of the fund rows beneath it. Figures are
// stored to five decimals, so the identities hold to a rounding tolerance.

import type { Problem } from '../schema/validate.ts';
import type { Basis, StudyDocument, StudyFund, StudyReading } from './types.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOL = 2e-4;
const GROUPS = ['equity_sleeve', 'synthetic_long', 'reference_only'];
const SUBGROUPS: Record<string, string> = {
  direct_stocks: 'equity_sleeve',
  index_etf_sleeve: 'equity_sleeve',
  direct_flex: 'synthetic_long',
  ladder_of_synthetic_long_rungs: 'synthetic_long',
  reference_only: 'reference_only',
};

type Bag = Record<string, unknown>;
const isObject = (v: unknown): v is Bag => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const near = (a: number, b: number, tol = TOL) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

/** The benchmark a fund is read against on a basis: its own where it names one, else VOO. */
export function benchmarkFor(fund: Pick<StudyFund, 'named_benchmark'>, basis: Basis): string {
  return basis === 'VOO' || !fund.named_benchmark ? 'VOO' : fund.named_benchmark;
}

export function median(xs: number[]): number | null {
  const s = xs.filter(isNum).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function reading(problems: Problem[], r: StudyReading, path: string): void {
  const p = (message: string): void => { problems.push({ path, message }); };
  if (!isObject(r) || !isObject(r.sums) || !isObject(r.legs)) return p('must carry sums and legs');
  if (r.up_days + r.down_days + r.flat_days !== r.days) p('up, down and flat days do not add up to the days read');
  const { fund_up, bench_up, fund_down, bench_down } = r.sums;
  if (!(bench_up > 0) || !(bench_down < 0)) p('the benchmark’s summed rises must be positive and its falls negative');
  if (!near(r.u, fund_up / bench_up)) p(`U ${r.u} is not the fund’s summed rises over the benchmark’s`);
  if (!near(r.b, 1 - fund_down / bench_down)) p(`B ${r.b} is not one minus the fund’s summed falls over the benchmark’s`);
  if (!near(r.u_plus_b, r.u + r.b)) p('U + B is not U plus B');
  if (r.u > 0) {
    if (r.E === null || !near(r.E, (1 - r.b) / r.u)) p(`E ${r.E} is not (1 − B) ÷ U`);
  } else if (r.E !== null) {
    p('E must be null where the fund kept none of the rises');
  }
  if (r.E_range) {
    const [lo, hi] = r.E_range;
    const want = lo > 1 ? 'above_1' : hi < 1 ? 'below_1' : 'not_settled';
    if (!(lo <= hi)) p('the range is upside down');
    if (r.E_settled !== want) p(`the range ${lo}–${hi} reads ${want}, labelled ${r.E_settled}`);
  } else if (r.E_settled !== null) {
    p('a label with no range');
  }
  if (r.legs.up.length !== r.up_days || r.legs.down.length !== r.down_days) p('one leg point per moving day');
  for (const [side, fs, bs] of [['up', fund_up, bench_up], ['down', fund_down, bench_down]] as const) {
    const leg = r.legs[side];
    const last = leg[leg.length - 1];
    if (last && (!near(last[1], fs) || !near(last[2], bs))) p(`the ${side} leg does not end at its sums`);
    for (let i = 1; i < leg.length; i++) {
      if (!(leg[i - 1]![0] < leg[i]![0]) || !DATE.test(leg[i]![0])) { p(`the ${side} leg is not in date order`); break; }
    }
  }
  const n5 = r.nov5;
  if (n5.E !== null && r.u > 0) {
    if (!near(n5.E, n5.fund / n5.bench / r.u, 1e-3)) p('5 November’s E is not the day’s share of the fall over U');
    if (n5.given_back_fund !== null && n5.given_back_bench && !near(n5.E, n5.given_back_fund / n5.given_back_bench, 1e-3)) {
      p('5 November’s E is not the fund’s give-back over the market’s');
    }
  }
}

export function validateStudy(value: unknown): Problem[] {
  if (!isObject(value)) return [{ path: '', message: 'must be an object' }];
  const problems: Problem[] = [];
  const doc = value as unknown as StudyDocument;
  if (doc.app !== 'Third Floor') problems.push({ path: 'app', message: "must be 'Third Floor'" });
  if (doc.kind !== 'selected_report') problems.push({ path: 'kind', message: "must be 'selected_report'" });
  if (!/^[a-z0-9-]+$/.test(String(doc.id))) problems.push({ path: 'id', message: 'must be lower-case words and hyphens' });
  for (const f of ['title', 'study_schema_version'] as const) {
    if (typeof doc[f] !== 'string' || doc[f] === '') problems.push({ path: f, message: 'must be a non-empty string' });
  }
  if (!DATE.test(String(doc.published))) problems.push({ path: 'published', message: 'must be a date' });
  if (!isObject(doc.window) || !DATE.test(String(doc.window.start)) || !DATE.test(String(doc.window.end))) {
    problems.push({ path: 'window', message: 'must carry a start and an end date' });
  }
  if (!Array.isArray(doc.funds) || doc.funds.length === 0) {
    problems.push({ path: 'funds', message: 'must list the funds' });
    return problems;
  }
  if (!isObject(doc.benchmarks) || !doc.benchmarks['VOO']) problems.push({ path: 'benchmarks', message: 'must carry VOO' });

  const seen = new Set<string>();
  doc.funds.forEach((f, i) => {
    const path = `funds[${i}]`;
    if (seen.has(f.ticker)) problems.push({ path, message: `${f.ticker} appears twice` });
    seen.add(f.ticker);
    if (!GROUPS.includes(f.group)) problems.push({ path, message: `unknown group ${f.group}` });
    if (SUBGROUPS[f.subgroup] !== f.group) problems.push({ path, message: `${f.subgroup} is not part of ${f.group}` });
    if (!isObject(f.readings) || !f.readings['VOO']) {
      problems.push({ path, message: 'every fund is read against VOO' });
      return;
    }
    if (f.named_benchmark && !f.readings[f.named_benchmark]) {
      problems.push({ path, message: `no reading against its own benchmark ${f.named_benchmark}` });
    }
    for (const [bn, r] of Object.entries(f.readings)) {
      if (!doc.benchmarks?.[bn]) problems.push({ path: `${path}.readings.${bn}`, message: 'benchmark not described' });
      reading(problems, r, `${path}.readings.${bn}`);
    }
  });

  // Every group figure is the middle of the fund rows beneath it.
  for (const basis of ['named', 'VOO'] as const) {
    const sums = doc.summaries?.[basis];
    if (!isObject(sums)) {
      problems.push({ path: `summaries.${basis}`, message: 'missing' });
      continue;
    }
    for (const [key, s] of Object.entries(sums)) {
      const path = `summaries.${basis}.${key}`;
      const [level, name] = key.split(':') as [string, string];
      const members = doc.funds.filter((f) => (level === 'group' ? f.group : f.subgroup) === name);
      const want = members.map((f) => f.ticker).sort().join(',');
      if ([...s.tickers].sort().join(',') !== want) {
        problems.push({ path, message: 'lists different funds from the rows' });
        continue;
      }
      const rows = members.map((f) => f.readings[benchmarkFor(f, basis)]!);
      for (const k of ['u', 'b', 'E'] as const) {
        const m = median(rows.map((r) => r[k] as number));
        const stat = s[k];
        if (m === null ? stat !== null : !stat || !near(stat.median, m)) {
          problems.push({ path: `${path}.${k}`, message: `median ${stat?.median} is not the middle of the rows (${m})` });
        }
      }
      const settled = rows.filter((r) => r.E_settled === 'below_1').length;
      if (settled !== s.E_settled_below_1) problems.push({ path, message: 'settled-below count disagrees with the rows' });
    }
  }
  return problems;
}

export function isStudy(value: unknown): value is StudyDocument {
  return validateStudy(value).length === 0;
}
