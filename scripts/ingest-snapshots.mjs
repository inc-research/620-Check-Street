#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Move a run's snapshots into data/, refusing to overwrite anything already
// committed.
//
// This is 3F D-08's append-only rule made mechanical rather than left as a note
// in a README. Returns are worked out from dividend-adjusted closes, and those
// adjustment factors move every time a fund pays a distribution — so a month
// regenerated a year later does not reproduce the month that was published, and
// the published one is the record. Overwriting it silently would rewrite
// history that other things already point at.
//
// Regenerating a score from a stored raw_semibeta is a different operation
// entirely and needs no refetch (3F D-04); it is not what this guards.
//
//   node scripts/ingest-snapshots.mjs <dir-or-zip>   [--force] [--dry-run]

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(root, 'data');

function usage(message) {
  console.error(message);
  console.error('usage: node scripts/ingest-snapshots.mjs <dir> [--force] [--dry-run]');
  return 2;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

function main(argv) {
  const args = argv.filter((a) => !a.startsWith('--'));
  const force = argv.includes('--force');
  const dryRun = argv.includes('--dry-run');

  const source = args[0];
  if (!source) return usage('no run directory given');
  if (!existsSync(source)) return usage(`no such path: ${source}`);
  if (!statSync(source).isDirectory()) {
    return usage(`${source} is not a directory — unzip the package first`);
  }

  const dataDir = existsSync(join(source, 'data')) ? join(source, 'data') : source;
  const snapshots = walk(dataDir).filter((p) => p.endsWith('.json'));
  if (snapshots.length === 0) return usage(`no snapshots found under ${dataDir}`);

  const added = [];
  const conflicts = [];

  for (const path of snapshots) {
    const month = basename(path);
    const ticker = basename(dirname(path));
    // Reports sit one level deeper and follow the same append-only rule (3F D-18).
    const reports = basename(dirname(dirname(path))) === '_reports';
    const label = reports ? `_reports/${ticker}/${month}` : `${ticker}/${month}`;
    const destination = join(DATA, ...label.split('/'));
    if (existsSync(destination) && !force) conflicts.push(label);
    else added.push([path, destination, label]);
  }

  if (conflicts.length > 0) {
    console.error(
      `refusing to overwrite ${conflicts.length} file(s) already in data/:\n  ` +
        conflicts.slice(0, 12).join('\n  ') +
        (conflicts.length > 12 ? `\n  … and ${conflicts.length - 12} more` : ''),
    );
    console.error(
      '\nThe archive is append-only (3F D-08). A month that is already published is\n' +
        'the record for that month, and a rerun does not reproduce it byte for byte\n' +
        'because dividend adjustment factors move over time.\n' +
        '\nIf you genuinely mean to replace them, pass --force.',
    );
    return 1;
  }

  if (dryRun) {
    console.log(`would add ${added.length} file(s); nothing written`);
    return 0;
  }

  for (const [from, to, label] of added) {
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
    if (process.env['VERBOSE']) console.log(`  + ${label}`);
  }

  const manifestSource = join(source, 'MANIFEST.json');
  if (existsSync(manifestSource)) {
    const manifest = JSON.parse(readFileSync(manifestSource, 'utf8'));
    const stamp = String(manifest.run_started_at ?? 'unknown').slice(0, 10);
    mkdirSync(join(root, 'data', '_runs'), { recursive: true });
    // Two runs on one day are two records. The second must not replace the first.
    let name = `${stamp}.json`;
    for (let n = 2; existsSync(join(root, 'data', '_runs', name)); n++) name = `${stamp}-${n}.json`;
    writeFileSync(join(root, 'data', '_runs', name), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`recorded run manifest as data/_runs/${name}`);
  }

  console.log(`ingested ${added.length} file(s) into data/${force ? ' (forced)' : ''}`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
