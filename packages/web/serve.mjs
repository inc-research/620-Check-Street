#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// A local static server for dist/, for looking at the page while working on it.
//
// It serves the built directory under /second-floor/ as well as at the root, so
// the project-page subpath case (SF-19) can be seen rather than assumed. It is
// a development tool and is not part of the deployed site — the deployed site
// has no server at all.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

const DIST = join(dirname(fileURLToPath(import.meta.url)), 'dist');
const PORT = Number(process.env['PORT'] ?? 8080);
const SUBPATH = '/third-floor';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

createServer(async (req, res) => {
  let path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (path.startsWith(`${SUBPATH}/`) || path === SUBPATH) path = path.slice(SUBPATH.length) || '/';
  if (path.endsWith('/')) path += 'index.html';

  // Normalise before joining, so `..` cannot walk out of dist.
  const file = join(DIST, normalize(path));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end('No');
    return;
  }

  try {
    const body = await readFile(file);
    const ext = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}).listen(PORT, () => {
  console.log(`  root path     http://localhost:${PORT}/`);
  console.log(`  project path  http://localhost:${PORT}${SUBPATH}/`);
  console.log(`  file path     file://${join(DIST, 'index.html')}`);
});
