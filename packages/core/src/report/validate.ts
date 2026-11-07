// SPDX-License-Identifier: MIT
//
// Hand-written, as schema/validate.ts is (SF-16). The promises worth checking
// are the ones a JSON Schema cannot state: the days balance, and every derived
// figure is what its stored sums say it is.

import { HORIZONS } from '../schema/types.ts';
import type { Problem } from '../schema/validate.ts';
import type { ReportDocument } from './types.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TICKER = /^[A-Z.]{1,6}$/;
const TOLERANCE = 1e-12;

type Bag = Record<string, unknown>;

function isObject(v: unknown): v is Bag {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function blockers(problems: Problem[], value: unknown, path: string): number {
  if (!Array.isArray(value)) {
    problems.push({ path, message: 'must be an array' });
    return 0;
  }
  value.forEach((b, i) => {
    // INV-2: a blocker with no remedy is a dead end.
    if (!isObject(b) || typeof b['message'] !== 'string' || typeof b['remedy'] !== 'string') {
      problems.push({ path: `${path}[${i}]`, message: 'must carry a message and a remedy' });
    }
  });
  return value.length;
}

function side(problems: Problem[], value: unknown, path: string, up: boolean): number {
  if (!isObject(value)) {
    problems.push({ path, message: 'must be an object' });
    return 0;
  }
  const { days, sum_fund: sf, sum_benchmark: sb, capture, average_fund: af } = value as Bag & {
    days: unknown; sum_fund: unknown; sum_benchmark: unknown; capture: unknown; average_fund: unknown;
  };
  const count = blockers(problems, value['blockers'], `${path}.blockers`);
  if (!isInt(days) || !isNum(sf) || !isNum(sb)) {
    problems.push({ path, message: 'days and both sums are required' });
    return 0;
  }
  if (capture === null) {
    // A zero and an unknown are opposite claims (INV-2).
    if (count === 0) problems.push({ path, message: 'a side with no figure must say why' });
    return days;
  }
  if (!isNum(capture) || !isNum(af)) {
    problems.push({ path, message: 'capture and the averages must be numbers or null' });
    return days;
  }
  if (up ? sb <= 0 : sb >= 0) {
    problems.push({ path: `${path}.sum_benchmark`, message: 'has the wrong sign for this side' });
  }
  if (Math.abs(capture - sf / sb) > TOLERANCE) {
    problems.push({ path: `${path}.capture`, message: 'is not the ratio of its stored sums' });
  }
  if (Math.abs(af - sf / days) > TOLERANCE) {
    problems.push({ path: `${path}.average_fund`, message: 'is not its sum over its days' });
  }
  const share = value['against_share'];
  if (!isNum(share) || share < 0 || share > 1) {
    problems.push({ path: `${path}.against_share`, message: 'must be between 0 and 1' });
  } else if (isInt(value['against_days']) && Math.abs(share - value['against_days'] / days) > TOLERANCE) {
    problems.push({ path: `${path}.against_share`, message: 'is not its count over its days' });
  }
  return days;
}

function fall(problems: Problem[], value: unknown, path: string): void {
  if (!isObject(value) || !isNum(value['depth']) || value['depth'] > 0) {
    problems.push({ path, message: 'must carry a depth of zero or below' });
  }
}

function horizon(problems: Problem[], value: unknown, path: string, index: number): void {
  if (!isObject(value)) {
    problems.push({ path, message: 'must be an object' });
    return;
  }
  if (value['horizon'] !== HORIZONS[index]) {
    problems.push({ path: `${path}.horizon`, message: `must be ${String(HORIZONS[index])}` });
  }
  const count = blockers(problems, value['blockers'], `${path}.blockers`);
  const total = value['days_total'];
  const flat = value['market_flat_days'];
  const growth = value['growth'];

  if (growth === null) {
    if (count === 0) problems.push({ path, message: 'a blocked window must say why' });
    if (total !== 0) problems.push({ path, message: 'a blocked window publishes no day count' });
    return;
  }
  if (!isObject(growth) || !(Number(growth['fund']) > 0) || !(Number(growth['benchmark']) > 0)) {
    problems.push({ path: `${path}.growth`, message: 'must hold two positive multipliers' });
  }
  const upDays = side(problems, value['up'], `${path}.up`, true);
  const downDays = side(problems, value['down'], `${path}.down`, false);
  // This app's form of INV-3: every paired day sits on exactly one side.
  if (!isInt(total) || !isInt(flat) || total !== upDays + downDays + flat) {
    problems.push({
      path,
      message: `days do not balance: ${String(total)} total, ${upDays} up, ${downDays} down, ${String(flat)} flat`,
    });
  }
  const worst = value['worst_fall'];
  if (!isObject(worst)) {
    problems.push({ path: `${path}.worst_fall`, message: 'must be an object' });
  } else {
    fall(problems, worst['fund'], `${path}.worst_fall.fund`);
    fall(problems, worst['benchmark'], `${path}.worst_fall.benchmark`);
  }
  const fit = value['fit'];
  if (!isObject(fit)) {
    problems.push({ path: `${path}.fit`, message: 'must be an object' });
  } else if (fit['r_squared'] === null) {
    if (blockers(problems, fit['blockers'], `${path}.fit.blockers`) === 0) {
      problems.push({ path: `${path}.fit`, message: 'a missing fit must say why' });
    }
  } else if (!isNum(fit['r_squared']) || fit['r_squared'] < 0 || fit['r_squared'] > 1 + TOLERANCE) {
    problems.push({ path: `${path}.fit.r_squared`, message: 'must be between 0 and 1' });
  }
}

/** Validate one report document. An empty array means it is well formed. */
export function validateReport(value: unknown): Problem[] {
  if (!isObject(value)) return [{ path: '', message: 'must be an object' }];
  const problems: Problem[] = [];

  if (value['app'] !== 'Third Floor') problems.push({ path: 'app', message: "must be 'Third Floor'" });
  for (const [field, pattern] of [
    ['report_schema_version', /^\d+\.\d+$/],
    ['ticker', TICKER],
    ['as_of', DATE],
  ] as const) {
    const v = value[field];
    if (typeof v !== 'string' || !pattern.test(v)) {
      problems.push({ path: field, message: `does not match ${String(pattern)}` });
    }
  }
  for (const field of ['name', 'issuer', 'generated_at']) {
    if (typeof value[field] !== 'string' || value[field] === '') {
      problems.push({ path: field, message: 'must be a non-empty string' });
    }
  }
  if (!isObject(value['coverage'])) problems.push({ path: 'coverage', message: 'must be an object' });

  const methodology = value['methodology'];
  if (!isObject(methodology)) {
    problems.push({ path: 'methodology', message: 'must be an object' });
  } else {
    if (!isNum(methodology['low_fit_r_squared'])) {
      problems.push({ path: 'methodology.low_fit_r_squared', message: 'must be a number' });
    }
    if (typeof methodology['defined_outcome_caveat'] !== 'boolean') {
      problems.push({ path: 'methodology.defined_outcome_caveat', message: 'must be a boolean' });
    }
  }

  const benchmarks = value['benchmarks'];
  if (!isObject(benchmarks)) {
    problems.push({ path: 'benchmarks', message: 'must be an object' });
    return problems;
  }
  if (!('VOO' in benchmarks)) {
    problems.push({ path: 'benchmarks', message: 'must carry the VOO universal anchor' });
  }
  for (const [ticker, block] of Object.entries(benchmarks)) {
    const path = `benchmarks.${ticker}`;
    if (!isObject(block) || !Array.isArray(block['roles']) || !Array.isArray(block['horizons'])) {
      problems.push({ path, message: 'must carry roles and horizons' });
      continue;
    }
    if (block['horizons'].length !== HORIZONS.length) {
      problems.push({ path: `${path}.horizons`, message: `must hold exactly ${HORIZONS.length} entries` });
      continue;
    }
    block['horizons'].forEach((h, i) => horizon(problems, h, `${path}.horizons[${i}]`, i));
  }
  return problems;
}

/** Narrowing helper for callers that only care whether it is usable. */
export function isReport(value: unknown): value is ReportDocument {
  return validateReport(value).length === 0;
}
