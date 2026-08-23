#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Validate every committed snapshot, and the archive as a whole.
//
// The per-document checks live in packages/core (hand-written, no ajv — SF-16).
// What is added here is everything a single document cannot know about itself:
// that its filename agrees with its contents, that the archive and the registry
// describe the same set of funds, and that the coverage block each file carries
// actually matches what is on disk.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { validateSnapshot } from '../packages/core/src/schema/validate.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(root, 'data');

let problems = 0;

function fail(where, message) {
  console.error(`FAIL ${where}: ${message}`);
  problems++;
}

function main() {
  if (!existsSync(DATA)) {
    console.log('validate-snapshots: no data/ directory yet — nothing to check.');
    return 0;
  }

  const registry = JSON.parse(readFileSync(join(root, 'tickers.json'), 'utf8'));
  const registered = new Set(registry.tickers.map((t) => t.ticker));
  const byTicker = new Map(registry.tickers.map((t) => [t.ticker, t]));

  const tickerDirs = readdirSync(DATA, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name);

  if (tickerDirs.length === 0) {
    console.log('validate-snapshots: data/ holds no snapshots yet — nothing to check.');
    return 0;
  }

  let files = 0;
  const withSnapshots = new Set();

  for (const ticker of tickerDirs) {
    if (!registered.has(ticker)) {
      fail(`data/${ticker}`, 'is not in tickers.json');
      continue;
    }
    withSnapshots.add(ticker);

    const entry = byTicker.get(ticker);
    const dir = join(DATA, ticker);
    const months = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .sort();

    let earliestWithBaseline = null;

    for (const month of months) {
      const where = `data/${ticker}/${month}.json`;
      files++;

      if (!/^\d{4}-\d{2}$/.test(month)) {
        fail(where, 'filename is not a zero-padded YYYY-MM');
        continue;
      }

      let doc;
      try {
        doc = JSON.parse(readFileSync(join(dir, `${month}.json`), 'utf8'));
      } catch (e) {
        fail(where, `is not valid JSON: ${e.message}`);
        continue;
      }

      for (const p of validateSnapshot(doc)) fail(where, `${p.path} ${p.message}`);

      // Things a document cannot check about itself.
      if (doc.ticker !== ticker) {
        fail(where, `says ticker ${doc.ticker} but sits in data/${ticker}/`);
      }
      if (typeof doc.as_of === 'string' && doc.as_of.slice(0, 7) !== month) {
        fail(where, `is named ${month} but its as_of is ${doc.as_of}`);
      }
      if (entry && doc.name !== entry.name) {
        fail(where, `names the fund "${doc.name}" where the registry says "${entry.name}"`);
      }
      if (entry && doc.methodology?.defined_outcome_caveat !== entry.defined_outcome_caveat) {
        fail(where, 'defined_outcome_caveat disagrees with the registry');
      }

      // The named benchmark the registry records must actually be present, and
      // a fund with none must not have quietly acquired one.
      if (entry) {
        const named = entry.named_benchmark;
        const blocks = doc.benchmarks ?? {};
        if (named && !(named in blocks)) {
          fail(where, `the registry names ${named} as its benchmark, but no block carries it`);
        }
        for (const [b, block] of Object.entries(blocks)) {
          if (block.roles?.includes('named_benchmark') && b !== named) {
            fail(where, `${b} is marked named_benchmark but the registry names ${named ?? 'none'}`);
          }
        }
      }

      const hasBaseline = Object.values(doc.benchmarks ?? {}).some((block) =>
        block.horizons?.some((h) => h.horizon === '12mo' && h.states !== null),
      );
      if (hasBaseline && earliestWithBaseline === null) earliestWithBaseline = month;

      if (doc.coverage?.earliest_available_snapshot !== months[0]) {
        fail(
          where,
          `records earliest_available_snapshot ${doc.coverage?.earliest_available_snapshot} ` +
            `but the oldest file on disk is ${months[0]}`,
        );
      }
    }

    // Checked once per ticker, against every file it holds.
    for (const month of months) {
      const doc = JSON.parse(readFileSync(join(dir, `${month}.json`), 'utf8'));
      if (doc.coverage?.earliest_full_baseline_snapshot !== earliestWithBaseline) {
        fail(
          `data/${ticker}/${month}.json`,
          `records earliest_full_baseline_snapshot ` +
            `${JSON.stringify(doc.coverage?.earliest_full_baseline_snapshot)} but the oldest file ` +
            `with an unblocked 12mo horizon is ${JSON.stringify(earliestWithBaseline)}`,
        );
      }
    }
  }

  const missing = [...registered].filter((t) => !withSnapshots.has(t)).sort();
  if (missing.length > 0) {
    // Not a failure. A fund too new for any computable window legitimately has
    // no files at all, and saying so is the point.
    console.log(
      `note: ${missing.length} registered ticker(s) have no snapshots: ${missing.join(', ')}`,
    );
  }

  if (problems > 0) {
    console.error(`\nvalidate-snapshots: ${problems} problem(s) across ${files} file(s).`);
    return 1;
  }
  console.log(`validate-snapshots: ${files} snapshot(s) across ${tickerDirs.length} ticker(s), all valid.`);
  return 0;
}

process.exit(main());
