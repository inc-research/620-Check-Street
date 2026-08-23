#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// data/index.json — what the page reads first.
//
// A static site cannot list a directory, so without this the page has no way to
// know which funds exist or which months each one has. Generated from the
// archive rather than hand-kept, and checked in CI, so it cannot drift from
// what is actually on disk.
//
// Funds with no snapshots at all are listed too, with an empty `months`. That
// distinction is load-bearing: a fund too new for any window and a ticker this
// site does not follow are different facts, and a reader searching for one
// should not be told the other.
//
//   node scripts/build-index.mjs            write it
//   node scripts/build-index.mjs --check    fail if it is stale

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(root, 'data');
const TARGET = join(DATA, 'index.json');

export const INDEX_SCHEMA_VERSION = '1.0';

function monthsFor(ticker) {
  const dir = join(DATA, ticker);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

function build() {
  const registry = JSON.parse(readFileSync(join(root, 'tickers.json'), 'utf8'));

  const funds = registry.tickers.map((entry) => {
    const months = monthsFor(entry.ticker);
    const fund = {
      ticker: entry.ticker,
      name: entry.name,
      issuer: entry.issuer,
      category: entry.category,
      defined_outcome_caveat: entry.defined_outcome_caveat,
      named_benchmark: entry.named_benchmark,
      benchmark_source: entry.benchmark_source,
      months,
      latest: months.length > 0 ? months[months.length - 1] : null,
      benchmarks: [],
      coverage: null,
    };

    if (fund.latest) {
      const doc = JSON.parse(readFileSync(join(DATA, entry.ticker, `${fund.latest}.json`), 'utf8'));
      fund.benchmarks = Object.keys(doc.benchmarks);
      fund.coverage = doc.coverage;
    }
    if (entry.benchmark_note) fund.benchmark_note = entry.benchmark_note;
    return fund;
  });

  return {
    app: 'Third Floor',
    schema_version: INDEX_SCHEMA_VERSION,
    registry_schema_version: registry.schema_version,
    anchors: registry.benchmark_anchors.map((a) => a.ticker),
    universal_anchor: 'VOO',
    funds,
    // Totals the page shows without having to fetch anything else.
    totals: {
      tracked: funds.length,
      with_snapshots: funds.filter((f) => f.months.length > 0).length,
      snapshots: funds.reduce((n, f) => n + f.months.length, 0),
    },
  };
}

function main(argv) {
  if (!existsSync(DATA)) {
    console.error('build-index: no data/ directory');
    return 1;
  }

  // No generated_at: it would change on every run and turn a no-op regeneration
  // into a diff, which is exactly what the --check gate is here to catch. The
  // run manifests under data/_runs carry the dates.
  const rendered = JSON.stringify(build(), null, 2) + '\n';

  if (argv.includes('--check')) {
    if (!existsSync(TARGET)) {
      console.error('build-index: data/index.json has not been generated');
      return 1;
    }
    if (readFileSync(TARGET, 'utf8') !== rendered) {
      console.error('build-index: data/index.json is stale — run `npm run build:index`');
      return 1;
    }
    console.log('build-index: data/index.json is up to date');
    return 0;
  }

  writeFileSync(TARGET, rendered);
  const index = JSON.parse(rendered);
  console.log(
    `build-index: ${index.totals.tracked} tracked, ` +
      `${index.totals.with_snapshots} with snapshots, ` +
      `${index.totals.snapshots} files`,
  );
  return 0;
}

process.exit(main(process.argv.slice(2)));
