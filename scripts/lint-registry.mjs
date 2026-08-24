// SPDX-License-Identifier: MIT
//
// The registry's reader-facing prose is copy, and copy passes the lint (INV-7).
//
// `benchmark_note_plain` is rendered on a fund's report exactly like a line from
// the deck, but it lives in a data file rather than in `packages/copy`, so the
// deck's own test never sees it. It shipped for a while as engineering prose —
// field names, a decision citation, and an unanswered question addressed to the
// builder — because nothing checked it (3F D-15). This is that check.
//
// The provenance note beside it is deliberately NOT linted. It names prospectus
// and marketing sources and does not simplify them; that is what makes it worth
// keeping, and it never reaches a reader.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { lintTextExtended } from '../packages/copy/dist/lint3f.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const registry = JSON.parse(readFileSync(join(ROOT, 'tickers.json'), 'utf8'));

/** Vocabulary the reader was never handed: the registry's own field names, and citations. */
const INTERNAL = [
  [/\b(?:3F|SF|FF)[- ]?D?-?\d/, 'a decision citation, which is an address in a file the reader has never seen'],
  [/defined_outcome_caveat|named_benchmark|benchmark_note|benchmark_source|schema_version/, 'a field name from this file'],
  [/\bmay be worth\b|\bTBD\b|\bTODO\b|\bto be decided\b/i, 'a question left open, addressed to whoever maintains this file'],
  [/\bprospectus\b|\bproxy\b|\bpath-dependent\b/i, 'vocabulary from the fund’s legal paperwork rather than the reader’s'],
];

let findings = 0;

for (const entry of registry.tickers) {
  const note = entry.benchmark_note_plain;
  if (!note) {
    if (entry.benchmark_note) {
      console.error(`${entry.ticker}: has a provenance note but no reader-facing one.`);
      findings++;
    }
    continue;
  }

  for (const f of lintTextExtended(`${entry.ticker}.benchmark_note_plain`, note)) {
    console.error(`${f.location}: ${f.word} — ${f.excerpt}`);
    findings++;
  }

  for (const [pattern, why] of INTERNAL) {
    const m = pattern.exec(note);
    if (m) {
      console.error(`${entry.ticker}.benchmark_note_plain: ${why} — “${m[0]}”`);
      findings++;
    }
  }
}

const checked = registry.tickers.filter((t) => t.benchmark_note_plain).length;

if (findings > 0) {
  console.error(`\nlint-registry: ${findings} finding(s) across ${checked} note(s).`);
  process.exit(1);
}

console.log(`lint-registry: ${checked} reader-facing note(s), clean.`);
