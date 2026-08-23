// SPDX-License-Identifier: MIT
//
// Hand-written validators returning Problem[]. No `ajv` (SF-16): an app whose
// premise is that it does nothing behind your back should be readable end to
// end, and a schema validator is exactly the kind of thing a reader would
// otherwise have to take on trust.
//
// These check the document's shape. The identities that a JSON Schema cannot
// express — the observation identity, a score matching its own raw value —
// are checked here too, because those are the promises the document makes.

import {
  HORIZONS,
  STATES,
  normaliseScore,
  type Blocker,
  type Cell,
  type Horizon,
  type Snapshot,
} from './types.ts';

export interface Problem {
  path: string;
  message: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
const TICKER = /^[A-Z.]{1,6}$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(
  problems: Problem[],
  value: unknown,
  path: string,
  pattern?: RegExp,
): void {
  if (typeof value !== 'string' || value.length === 0) {
    problems.push({ path, message: 'must be a non-empty string' });
    return;
  }
  if (pattern && !pattern.test(value)) {
    problems.push({ path, message: `does not match ${String(pattern)}` });
  }
}

function requireInteger(problems: Problem[], value: unknown, path: string, min = 0): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
    problems.push({ path, message: `must be an integer of at least ${min}` });
  }
}

function validateBlocker(problems: Problem[], value: unknown, path: string): void {
  if (!isObject(value)) {
    problems.push({ path, message: 'must be an object' });
    return;
  }
  requireString(problems, value['code'], `${path}.code`);
  requireString(problems, value['message'], `${path}.message`);
  // INV-2: required, not optional. A blocker with no remedy is a dead end.
  requireString(problems, value['remedy'], `${path}.remedy`);
}

function validateCell(problems: Problem[], value: unknown, path: string): void {
  if (!isObject(value)) {
    problems.push({ path, message: 'must be an object' });
    return;
  }

  const raw = value['raw_semibeta'];
  const score = value['score'];
  const sufficiency = value['data_sufficiency'];

  if (raw !== null && typeof raw !== 'number') {
    problems.push({ path: `${path}.raw_semibeta`, message: 'must be a number or null' });
  }
  if (score !== null && (typeof score !== 'number' || !Number.isInteger(score))) {
    problems.push({ path: `${path}.score`, message: 'must be an integer or null' });
  }
  requireInteger(problems, value['observation_count'], `${path}.observation_count`);

  if (sufficiency !== 'ok' && sufficiency !== 'thin' && sufficiency !== 'blocked') {
    problems.push({ path: `${path}.data_sufficiency`, message: 'must be ok, thin or blocked' });
  }

  // 3F D-04's promise, made checkable: every committed score is exactly the
  // stated transform of its own raw value, so the transform can be changed and
  // the archive regenerated without refetching a single price.
  if (typeof raw === 'number' || raw === null) {
    const expected = normaliseScore(raw as number | null);
    if (score !== expected) {
      problems.push({
        path: `${path}.score`,
        message: `is ${String(score)} but its raw_semibeta normalises to ${String(expected)}`,
      });
    }
  }

  // A zero and an unknown are opposite claims (INV-2).
  if (sufficiency === 'blocked') {
    if (raw !== null) {
      problems.push({ path: `${path}.raw_semibeta`, message: 'a blocked cell must be null' });
    }
    if (!Array.isArray(value['blockers']) || value['blockers'].length === 0) {
      problems.push({ path: `${path}.blockers`, message: 'a blocked cell must say why' });
    }
  } else if (raw === null) {
    problems.push({
      path: `${path}.raw_semibeta`,
      message: 'is null but the cell is not marked blocked',
    });
  }

  const blockers = value['blockers'];
  if (!Array.isArray(blockers)) {
    problems.push({ path: `${path}.blockers`, message: 'must be an array' });
  } else {
    blockers.forEach((b, i) => validateBlocker(problems, b, `${path}.blockers[${i}]`));
  }
}

function validateHorizon(problems: Problem[], value: unknown, path: string, index: number): void {
  if (!isObject(value)) {
    problems.push({ path, message: 'must be an object' });
    return;
  }

  const expected = HORIZONS[index];
  if (value['horizon'] !== expected) {
    problems.push({
      path: `${path}.horizon`,
      message: `must be ${String(expected)} — the array's order is the report table's column order`,
    });
  }

  const total = value['observations_total'];
  const classified = value['observations_classified'];
  const unclassified = value['observations_unclassified'];
  requireInteger(problems, total, `${path}.observations_total`);
  requireInteger(problems, classified, `${path}.observations_classified`);
  requireInteger(problems, unclassified, `${path}.observations_unclassified`);

  // This app's form of INV-3: every paired day is used or counted with a
  // reason. The four quadrants do not partition the sample, so the days in none
  // of them have to show up somewhere.
  if (
    typeof total === 'number' &&
    typeof classified === 'number' &&
    typeof unclassified === 'number' &&
    total !== classified + unclassified
  ) {
    problems.push({
      path,
      message: `observations do not balance: ${total} total, ${classified} classified, ${unclassified} unclassified`,
    });
  }

  const states = value['states'];
  const blockers = value['blockers'];

  if (states === null) {
    if (!Array.isArray(blockers) || blockers.length === 0) {
      problems.push({ path: `${path}.blockers`, message: 'a blocked horizon must say why' });
    }
  } else if (!isObject(states)) {
    problems.push({ path: `${path}.states`, message: 'must be an object or null' });
  } else {
    let counted = 0;
    for (const state of STATES) {
      if (!(state in states)) {
        problems.push({ path: `${path}.states.${state}`, message: 'is missing' });
        continue;
      }
      validateCell(problems, states[state], `${path}.states.${state}`);
      const cell = states[state];
      if (isObject(cell) && typeof cell['observation_count'] === 'number') {
        counted += cell['observation_count'];
      }
    }
    if (typeof classified === 'number' && counted !== classified) {
      problems.push({
        path: `${path}.states`,
        message: `quadrant counts sum to ${counted} but ${classified} days were classified`,
      });
    }
  }

  if (Array.isArray(blockers)) {
    blockers.forEach((b, i) => validateBlocker(problems, b, `${path}.blockers[${i}]`));
  } else {
    problems.push({ path: `${path}.blockers`, message: 'must be an array' });
  }
}

/** Validate one snapshot document. An empty array means it is well formed. */
export function validateSnapshot(value: unknown): Problem[] {
  const problems: Problem[] = [];

  if (!isObject(value)) {
    return [{ path: '', message: 'must be an object' }];
  }

  if (value['app'] !== 'Third Floor') {
    problems.push({ path: 'app', message: "must be 'Third Floor'" });
  }
  requireString(problems, value['schema_version'], 'schema_version', /^\d+\.\d+$/);
  requireString(problems, value['ticker'], 'ticker', TICKER);
  requireString(problems, value['name'], 'name');
  requireString(problems, value['issuer'], 'issuer');
  requireString(problems, value['as_of'], 'as_of', DATE);
  requireString(problems, value['generated_at'], 'generated_at');

  if (value['category'] !== 'options_integrated' && value['category'] !== 'managed_futures') {
    problems.push({ path: 'category', message: 'must be options_integrated or managed_futures' });
  }

  const coverage = value['coverage'];
  if (!isObject(coverage)) {
    problems.push({ path: 'coverage', message: 'must be an object' });
  } else {
    requireString(problems, coverage['inception'], 'coverage.inception', DATE);
    requireString(
      problems,
      coverage['earliest_available_snapshot'],
      'coverage.earliest_available_snapshot',
      MONTH,
    );
    const baseline = coverage['earliest_full_baseline_snapshot'];
    if (baseline !== null) {
      requireString(problems, baseline, 'coverage.earliest_full_baseline_snapshot', MONTH);
      if (
        typeof baseline === 'string' &&
        typeof coverage['earliest_available_snapshot'] === 'string' &&
        baseline < coverage['earliest_available_snapshot']
      ) {
        problems.push({
          path: 'coverage.earliest_full_baseline_snapshot',
          message: 'cannot be older than the earliest snapshot on record',
        });
      }
    }
    requireInteger(
      problems,
      coverage['requested_backfill_depth_months'],
      'coverage.requested_backfill_depth_months',
      1,
    );
    if (typeof coverage['history_limited_by_inception'] !== 'boolean') {
      problems.push({
        path: 'coverage.history_limited_by_inception',
        message: 'must be a boolean',
      });
    }
  }

  const methodology = value['methodology'];
  if (!isObject(methodology)) {
    problems.push({ path: 'methodology', message: 'must be an object' });
  } else {
    requireString(problems, methodology['score_normalization'], 'methodology.score_normalization');
    requireString(
      problems,
      methodology['score_normalization_formula'],
      'methodology.score_normalization_formula',
    );
    requireInteger(
      problems,
      methodology['min_observations_per_cell'],
      'methodology.min_observations_per_cell',
      1,
    );
    const basis = methodology['price_basis'];
    if (basis !== 'close_adjusted' && basis !== 'close_unadjusted') {
      problems.push({ path: 'methodology.price_basis', message: 'must be a known price basis' });
    }
    const source = methodology['price_source'];
    if (source !== 'yfinance' && source !== 'stooq' && source !== 'yahoo_chart') {
      problems.push({ path: 'methodology.price_source', message: 'must be a known price source' });
    }
    if (methodology['return_frequency'] !== 'daily') {
      problems.push({ path: 'methodology.return_frequency', message: "must be 'daily'" });
    }
    if (typeof methodology['defined_outcome_caveat'] !== 'boolean') {
      problems.push({ path: 'methodology.defined_outcome_caveat', message: 'must be a boolean' });
    }
    const threshold = methodology['shift_threshold'];
    if (threshold !== null && typeof threshold !== 'number') {
      problems.push({ path: 'methodology.shift_threshold', message: 'must be a number or null' });
    }
    // Where a value is genuinely unresolved it is null plus a note, never a
    // placeholder string standing in a committed file.
    if (threshold === null && typeof methodology['shift_threshold_note'] !== 'string') {
      problems.push({
        path: 'methodology.shift_threshold_note',
        message: 'an unset threshold must carry a note saying so',
      });
    }
  }

  const benchmarks = value['benchmarks'];
  if (!isObject(benchmarks)) {
    problems.push({ path: 'benchmarks', message: 'must be an object' });
    return problems;
  }

  // The universal anchor is what keeps cross-fund comparison usable across the
  // whole coverage set, so it is present on every fund without exception.
  if (!('VOO' in benchmarks)) {
    problems.push({ path: 'benchmarks', message: 'must carry the VOO universal anchor' });
  }

  for (const [ticker, block] of Object.entries(benchmarks)) {
    const path = `benchmarks.${ticker}`;
    if (!TICKER.test(ticker)) {
      problems.push({ path, message: 'is not a plausible ticker' });
    }
    if (!isObject(block)) {
      problems.push({ path, message: 'must be an object' });
      continue;
    }

    const roles = block['roles'];
    if (!Array.isArray(roles) || roles.length === 0) {
      problems.push({ path: `${path}.roles`, message: 'must be a non-empty array' });
    } else {
      for (const role of roles) {
        if (role !== 'universal_anchor' && role !== 'named_benchmark') {
          problems.push({ path: `${path}.roles`, message: `unknown role ${String(role)}` });
        }
      }
    }

    const horizons = block['horizons'];
    if (!Array.isArray(horizons) || horizons.length !== HORIZONS.length) {
      problems.push({
        path: `${path}.horizons`,
        message: `must hold exactly ${HORIZONS.length} entries`,
      });
      continue;
    }
    horizons.forEach((h, i) => validateHorizon(problems, h, `${path}.horizons[${i}]`, i));
  }

  return problems;
}

/** Narrowing helper for callers that only care whether it is usable. */
export function isSnapshot(value: unknown): value is Snapshot {
  return validateSnapshot(value).length === 0;
}

export type { Blocker, Cell, Horizon, Snapshot };
