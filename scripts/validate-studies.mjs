#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Validate every selected report in data/_studies/ (3F D-25).
//
// The identities a document can prove about itself live in packages/core. What is
// added here is what one document cannot know: that its filename is its id, that
// the front page's list and the folder agree in both directions, and that the
// study's own prose (a fund's flag) passes the lint like the deck does (INV-7).
// Fund names quoted from filings are not linted: they are the funds' words.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { validateStudy } from '../packages/core/src/study/validate.ts';
import { lintDeepExtended } from '../packages/copy/src/lint3f.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(root, 'data', '_studies');

let problems = 0;
const fail = (where, message) => {
  console.error(`FAIL ${where}: ${message}`);
  problems++;
};

const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.json')).sort() : [];
for (const file of files) {
  const doc = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  for (const p of validateStudy(doc)) fail(`${file} ${p.path}`, p.message);
  if (`${doc.id}.json` !== file) fail(file, `id ${doc.id} does not match the filename`);
  const prose = Object.fromEntries((doc.funds ?? []).filter((f) => f.flag).map((f) => [f.ticker, f.flag]));
  for (const f of lintDeepExtended(prose)) fail(`${file} flag ${f.location}`, `${f.word}: ${f.excerpt}`);
}

// The front page links to exactly the reports that exist.
const state = readFileSync(join(root, 'packages', 'web', 'src', 'state.ts'), 'utf8');
const listed = [...(/SELECTED_REPORTS[^=]*=\s*\[([^\]]*)\]/.exec(state)?.[1] ?? '').matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
const present = files.map((f) => f.replace(/\.json$/, ''));
for (const id of listed) if (!present.includes(id)) fail('state.ts', `lists ${id}, which has no file`);
for (const id of present) if (!listed.includes(id)) fail('state.ts', `does not list ${id}`);

if (problems > 0) {
  console.error(`${problems} problem(s) in the selected reports`);
  process.exit(1);
}
console.log(`${files.length} selected report(s) check out`);
