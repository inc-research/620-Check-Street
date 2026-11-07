#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Validate every report file, and that the report archive and the snapshot
// archive describe the same months (3F D-18).
//
// The per-document checks live in packages/core. What is added here is what one
// document cannot know about itself: that its filename agrees with its contents,
// and that every snapshot has its report and the reverse, on the same date and
// against the same benchmarks. The page fetches both, so a gap between the two
// archives would be a broken page.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { validateReport } from '../packages/core/src/report/validate.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(root, 'data');
const REPORTS = join(DATA, '_reports');

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

for (const { ticker } of registry.tickers) {
  const reports = months(join(REPORTS, ticker));
  const snapshots = months(join(DATA, ticker));
  for (const month of snapshots) {
    if (!reports.includes(month)) fail(`data/${ticker}/${month}.json`, 'has no report file');
  }

  for (const month of reports) {
    const where = `data/_reports/${ticker}/${month}.json`;
    files++;
    if (!snapshots.includes(month)) {
      fail(where, 'has no snapshot for the same month');
      continue;
    }
    const doc = JSON.parse(readFileSync(join(REPORTS, ticker, `${month}.json`), 'utf8'));
    for (const p of validateReport(doc)) fail(where, `${p.path}: ${p.message}`);
    if (doc.ticker !== ticker) fail(where, `carries ticker ${doc.ticker}`);
    if (String(doc.as_of).slice(0, 7) !== month) fail(where, `is dated ${doc.as_of}`);

    const snapshot = JSON.parse(readFileSync(join(DATA, ticker, `${month}.json`), 'utf8'));
    if (doc.as_of !== snapshot.as_of) {
      fail(where, `as_of ${doc.as_of} differs from its snapshot's ${snapshot.as_of}`);
    }
    const a = Object.keys(doc.benchmarks).sort().join();
    const b = Object.keys(snapshot.benchmarks).sort().join();
    if (a !== b) fail(where, `benchmarks ${a} differ from its snapshot's ${b}`);
  }
}

if (problems > 0) {
  console.error(`validate-reports: ${problems} problem(s).`);
  process.exit(1);
}
console.log(`validate-reports: ${files} report(s) across ${registry.tickers.length} ticker(s), all valid.`);
