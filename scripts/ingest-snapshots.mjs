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
  const series = [];

  for (const path of snapshots) {
    const month = basename(path);
    const ticker = basename(dirname(path));
    // The rate series are whole files, merged rather than added (3F D-23).
    if (ticker === '_rates') {
      series.push(path);
      continue;
    }
    // Reports and fee files sit one level deeper and follow the same
    // append-only rule (3F D-18, D-22).
    const archive = basename(dirname(dirname(path)));
    const nested = archive === '_reports' || archive === '_fees';
    const label = nested ? `${archive}/${ticker}/${month}` : `${ticker}/${month}`;
    const destination = join(DATA, ...label.split('/'));
    if (existsSync(destination) && !force) conflicts.push(label);
    else added.push([path, destination, label]);
  }

  // A rate series may grow, never change: neither is revised by its publisher,
  // so a published observation that comes back different is refused.
  const merged = [];
  for (const path of series) {
    const label = `_rates/${basename(path)}`;
    const fresh = JSON.parse(readFileSync(path, 'utf8'));
    const destination = join(DATA, '_rates', basename(path));
    if (existsSync(destination)) {
      const published = new Map(JSON.parse(readFileSync(destination, 'utf8')).observations);
      const incoming = new Map(fresh.observations);
      const changed = [...published].filter(([d, v]) => incoming.has(d) && incoming.get(d) !== v);
      if (changed.length > 0 && !force) {
        conflicts.push(`${label} (${changed.length} published observation(s) changed, first ${changed[0][0]})`);
        continue;
      }
      for (const [d, v] of published) if (!incoming.has(d)) incoming.set(d, v);
      fresh.observations = [...incoming].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    }
    merged.push([fresh, destination, label]);
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
    console.log(`would add ${added.length} file(s) and merge ${merged.length} rate series; nothing written`);
    return 0;
  }

  for (const [from, to, label] of added) {
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
    if (process.env['VERBOSE']) console.log(`  + ${label}`);
  }
  for (const [doc, to, label] of merged) {
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, JSON.stringify(doc, null, 2) + '\n');
    console.log(`  merged ${label}: ${doc.observations.length} observations to ${doc.observations.at(-1)[0]}`);
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
