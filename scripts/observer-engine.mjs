#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// The TypeScript side of the Observer build (3F D-21).
//
// The page's capture changes and direction bands live in the core, and the
// Observer's formulas are Python, so this is what lets `build_observer.py` hold
// one against the other instead of keeping a second copy of the bands. It also
// runs the copy lint over the folder's generated prose.
//
//   node scripts/observer-engine.mjs            print what the core computes
//   node scripts/observer-engine.mjs --lint     read {location: text} on stdin
//
// Reads the compiled packages, so `npm run build` comes first.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

async function lint() {
  const { lintTextExtended, formatFindings } = await import(
    join(root, 'packages/copy/dist/index.js')
  );
  const texts = JSON.parse(readFileSync(0, 'utf8'));
  const findings = Object.entries(texts).flatMap(([where, text]) => lintTextExtended(where, text));
  if (findings.length > 0) {
    console.error(formatFindings(findings));
    process.exit(1);
  }
}

async function dump() {
  const { TREND_BANDS, buildCaptureTrend, trendMonths } = await import(
    join(root, 'packages/core/dist/index.js')
  );
  const reports = join(root, 'data', '_reports');
  const read = (ticker, month) => {
    const path = join(reports, ticker, `${month}.json`);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
  };

  const rows = [];
  for (const ticker of readdirSync(reports).sort()) {
    const months = readdirSync(join(reports, ticker))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .sort();
    for (const month of months) {
      const current = read(ticker, month);
      const earlier = new Map();
      for (const m of trendMonths(month)) {
        const doc = read(ticker, m);
        if (doc) earlier.set(m, doc);
      }
      for (const benchmark of Object.keys(current.benchmarks).sort()) {
        // Each lookback reads the column that keeps its windows end to end (3F D-13).
        for (const [column, lookback] of [['13wk', 3], ['6mo', 6]]) {
          const trend = buildCaptureTrend(current, earlier, benchmark, column);
          for (const leg of trend.legs) {
            const back = leg.back.find((b) => b.lookback === lookback);
            if (back.change === null) continue;
            rows.push({
              ticker,
              benchmark,
              month,
              column,
              lookback,
              side: leg.side,
              change: back.change,
              direction: back.direction,
            });
          }
        }
      }
    }
  }
  process.stdout.write(JSON.stringify({ bands: TREND_BANDS, rows }));
}

await (process.argv.includes('--lint') ? lint() : dump());
