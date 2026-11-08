#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Validate the fee archive and the two rate series (3F D-22, D-23).
//
// Per-document checks live in packages/core. What is added here is what one
// file cannot know about itself: that every report month has its fee file, for
// the fund and for every benchmark that month's report is read against; that a
// filename agrees with its contents; and that the rate series the page reads are
// present and in order.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { validateFeeDocument, validateRateSeries } from '../packages/core/src/report/validateCosts.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(root, 'data');
const REPORTS = join(DATA, '_reports');
const FEES = join(DATA, '_fees');
const RATES = join(DATA, '_rates');

let problems = 0;
function fail(where, message) {
  console.error(`FAIL ${where}: ${message}`);
  problems++;
}

const months = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''))
        .sort()
    : [];

const registry = JSON.parse(readFileSync(join(root, 'tickers.json'), 'utf8'));
let files = 0;

function checkFee(ticker, month, role, asOf) {
  const where = `data/_fees/${ticker}/${month}.json`;
  const path = join(FEES, ticker, `${month}.json`);
  if (!existsSync(path)) {
    fail(where, `is missing: the ${month} report reads ${ticker}`);
    return;
  }
  files++;
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  for (const p of validateFeeDocument(doc)) fail(where, `${p.path}: ${p.message}`);
  if (doc.ticker !== ticker) fail(where, `carries ticker ${doc.ticker}`);
  if (doc.month !== month) fail(where, `carries month ${doc.month}`);
  if (doc.role !== role) fail(where, `has role ${doc.role}, expected ${role}`);
  if (doc.as_of !== asOf) fail(where, `as_of ${doc.as_of} differs from its report's ${asOf}`);
}

const checked = new Set();
for (const { ticker } of registry.tickers) {
  for (const month of months(join(REPORTS, ticker))) {
    const report = JSON.parse(readFileSync(join(REPORTS, ticker, `${month}.json`), 'utf8'));
    checkFee(ticker, month, 'fund', report.as_of);
    for (const benchmark of Object.keys(report.benchmarks)) {
      const key = `${benchmark}/${month}`;
      if (checked.has(key)) continue;
      checked.add(key);
      checkFee(benchmark, month, 'benchmark', report.as_of);
    }
  }
}

for (const id of ['CPIAUCNS', 'DGS3MO']) {
  const where = `data/_rates/${id}.json`;
  const path = join(RATES, `${id}.json`);
  if (!existsSync(path)) {
    fail(where, 'is missing; the report reads it');
    continue;
  }
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  for (const p of validateRateSeries(doc)) fail(where, `${p.path}: ${p.message}`);
  if (doc.series_id !== id) fail(where, `carries series ${doc.series_id}`);
}

if (problems > 0) {
  console.error(`validate-fees: ${problems} problem(s).`);
  process.exit(1);
}
console.log(`validate-fees: ${files} fee file(s) and 2 rate series, all valid.`);
