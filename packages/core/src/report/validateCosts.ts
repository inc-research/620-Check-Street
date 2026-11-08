// SPDX-License-Identifier: MIT
//
// The fee and rate files (3F D-22, D-23). Hand-written, as the other validators
// are: what is worth checking is that a fee table adds up and a series is in
// order, which a JSON Schema cannot state.

import type { Problem } from '../schema/validate.ts';
import type { FeeDocument, RateSeries } from './real.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const TICKER = /^[A-Z.]{1,6}$/;
/** A fee table rounds each line to a hundredth of a percent. */
const SUM_TOLERANCE = 0.00015;
const MAX_FEE = 0.05;

type Bag = Record<string, unknown>;
const isObject = (v: unknown): v is Bag => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function fraction(problems: Problem[], value: unknown, path: string, nullable: boolean): number {
  if (value === null && nullable) return 0;
  if (!isNum(value) || value < 0 || value > MAX_FEE) {
    problems.push({ path, message: `must be a yearly fraction between 0 and ${MAX_FEE}` });
    return 0;
  }
  return value;
}

export function validateFeeDocument(value: unknown): Problem[] {
  const problems: Problem[] = [];
  if (!isObject(value)) return [{ path: '', message: 'must be an object' }];
  if (value['app'] !== 'Third Floor') problems.push({ path: 'app', message: 'must be "Third Floor"' });
  if (typeof value['fees_schema_version'] !== 'string') problems.push({ path: 'fees_schema_version', message: 'must be a string' });
  if (typeof value['ticker'] !== 'string' || !TICKER.test(value['ticker'])) problems.push({ path: 'ticker', message: 'must be a ticker' });
  if (value['role'] !== 'fund' && value['role'] !== 'benchmark') problems.push({ path: 'role', message: 'must be fund or benchmark' });
  if (typeof value['month'] !== 'string' || !MONTH.test(value['month'])) problems.push({ path: 'month', message: 'must be YYYY-MM' });
  if (typeof value['as_of'] !== 'string' || !DATE.test(value['as_of'])) problems.push({ path: 'as_of', message: 'must be a date' });
  else if (value['as_of'].slice(0, 7) !== value['month']) problems.push({ path: 'as_of', message: 'must fall in its month' });
  // The whole point of the file: these costs are inside the returns, never to be taken off again.
  if (value['already_in_returns'] !== true) problems.push({ path: 'already_in_returns', message: 'must be true' });
  if (!Array.isArray(value['blockers'])) problems.push({ path: 'blockers', message: 'must be an array' });

  const fees = value['fees'];
  if (fees === null) {
    if (!Array.isArray(value['blockers']) || value['blockers'].length === 0) {
      problems.push({ path: 'fees', message: 'may be null only with a blocker saying why' });
    }
    return problems;
  }
  if (!isObject(fees)) return [...problems, { path: 'fees', message: 'must be an object or null' }];

  const management = fraction(problems, fees['management'], 'fees.management', true);
  const lines =
    management +
    fraction(problems, fees['distribution_12b1'], 'fees.distribution_12b1', true) +
    fraction(problems, fees['other'], 'fees.other', true) +
    fraction(problems, fees['acquired_funds'], 'fees.acquired_funds', true);
  const gross = fraction(problems, fees['gross'], 'fees.gross', false);
  const waiver = fraction(problems, fees['waiver'], 'fees.waiver', false);
  const net = fraction(problems, fees['net'], 'fees.net', false);
  if (fees['management'] !== null && Math.abs(lines - gross) > SUM_TOLERANCE) {
    problems.push({ path: 'fees.gross', message: `is ${gross} but the lines sum to ${lines}` });
  }
  if (Math.abs(gross - waiver - net) > SUM_TOLERANCE) {
    problems.push({ path: 'fees.net', message: `is ${net}, not gross ${gross} less waiver ${waiver}` });
  }
  const source = fees['source'];
  if (!isObject(source) || typeof source['url'] !== 'string' || typeof source['filed'] !== 'string') {
    problems.push({ path: 'fees.source', message: 'must name the filing, with its date and address' });
  } else if (typeof value['as_of'] === 'string' && source['filed'] > value['as_of']) {
    problems.push({ path: 'fees.source.filed', message: 'is after the month it is used for' });
  }
  return problems;
}

export function isFeeDocument(value: unknown): value is FeeDocument {
  return validateFeeDocument(value).length === 0;
}

export function validateRateSeries(value: unknown): Problem[] {
  const problems: Problem[] = [];
  if (!isObject(value)) return [{ path: '', message: 'must be an object' }];
  if (value['app'] !== 'Third Floor') problems.push({ path: 'app', message: 'must be "Third Floor"' });
  if (value['series_id'] !== 'CPIAUCNS' && value['series_id'] !== 'DGS3MO') {
    problems.push({ path: 'series_id', message: 'must be CPIAUCNS or DGS3MO' });
  }
  const obs = value['observations'];
  if (!Array.isArray(obs) || obs.length === 0) return [...problems, { path: 'observations', message: 'must be a non-empty array' }];
  let previous = '';
  obs.forEach((o, i) => {
    const path = `observations[${i}]`;
    if (!Array.isArray(o) || o.length !== 2 || typeof o[0] !== 'string' || !DATE.test(o[0]) || !isNum(o[1])) {
      problems.push({ path, message: 'must be [date, number]' });
      return;
    }
    if (o[0] <= previous) problems.push({ path, message: 'dates must be sorted and unique' });
    if (o[1] < 0 || (value['series_id'] === 'CPIAUCNS' && o[1] <= 0)) problems.push({ path, message: 'implausible value' });
    previous = o[0];
  });
  return problems;
}

export function isRateSeries(value: unknown): value is RateSeries {
  return validateRateSeries(value).length === 0;
}
