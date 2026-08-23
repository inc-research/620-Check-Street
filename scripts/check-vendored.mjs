#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// SF-17: vendored modules are copied verbatim and never edited in place.
//
// Each vendored file carries a provenance header, then a body that must stay
// byte-identical to its origin in Second Floor. This checks that, so a drift
// between the two floors is found by `diff` rather than by reading.
//
// The origin tree is a read-only reference and is gitignored, so its absence is
// reported as "skipped", not as a failure — a fresh clone has no copy of it and
// must still build. Drift is only checkable where the origin is present.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN_ROOT = join(root, 'floor_foundations');

/** destination under this repo → origin under floor_foundations/ */
export const VENDORED = {
  'packages/core/src/sum.ts': 'packages/core/src/sum.ts',
  'packages/copy/src/lint.ts': 'packages/copy/src/lint.ts',
  'packages/web/src/dom.ts': 'packages/web/src/dom.ts',
  'packages/web/test/dom-shim.ts': 'packages/web/test/dom-shim.ts',
};

const MARKER = '// ---- vendored body below; do not edit (SF-17) ----';

/** The body is everything after the marker line. */
function bodyOf(text) {
  const at = text.indexOf(MARKER);
  return at === -1 ? null : text.slice(at + MARKER.length).replace(/^\n/, '');
}

function main() {
  if (!existsSync(ORIGIN_ROOT)) {
    console.log('check-vendored: origin tree absent, drift not checkable — skipped.');
    return 0;
  }

  let failures = 0;
  for (const [dest, origin] of Object.entries(VENDORED)) {
    const destPath = join(root, dest);
    const originPath = join(ORIGIN_ROOT, origin);

    if (!existsSync(destPath)) {
      console.error(`FAIL ${dest}: missing`);
      failures++;
      continue;
    }
    if (!existsSync(originPath)) {
      console.error(`FAIL ${dest}: origin missing at ${origin}`);
      failures++;
      continue;
    }

    const destText = readFileSync(destPath, 'utf8');
    const body = bodyOf(destText);
    if (body === null) {
      console.error(`FAIL ${dest}: no provenance marker`);
      failures++;
      continue;
    }
    if (!destText.includes(origin)) {
      console.error(`FAIL ${dest}: header does not name its origin path`);
      failures++;
      continue;
    }

    const originText = readFileSync(originPath, 'utf8');
    if (body !== originText) {
      console.error(`FAIL ${dest}: body has drifted from ${origin}`);
      failures++;
      continue;
    }
    console.log(`ok   ${dest}`);
  }

  if (failures > 0) {
    console.error(`\ncheck-vendored: ${failures} file(s) drifted or missing.`);
    return 1;
  }
  console.log(`\ncheck-vendored: ${Object.keys(VENDORED).length} files verbatim.`);
  return 0;
}

process.exit(main());
