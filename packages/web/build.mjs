#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Builds the static site into dist/ (SF-19).
//
// One self-contained directory, relative paths throughout, so it works opened
// from a file:// path and served from a project-page subpath without a rebuild.
// An absolute /assets/… works on a user site and silently breaks on a project
// one, which is the kind of thing nobody notices until it is deployed.

import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const DIST = join(here, 'dist');
const PUBLIC = join(here, 'public');
const FONTS = join(here, 'fonts');

const FONT_SLOTS = {
  __FONT_ARVO_400__: 'arvo-400-latin.woff2',
  __FONT_ARVO_700__: 'arvo-700-latin.woff2',
  __FONT_NEWSREADER__: 'newsreader-var-latin.woff2',
};

function embedFonts(css) {
  let out = css;
  for (const [slot, file] of Object.entries(FONT_SLOTS)) {
    const path = join(FONTS, file);
    if (!existsSync(path)) {
      throw new Error(
        `Font ${file} is missing. SF-18 requires the faces to be embedded rather than linked; ` +
          `see packages/web/fonts/LICENSE-FONTS.md.`,
      );
    }
    const b64 = readFileSync(path).toString('base64');
    out = out.replaceAll(slot, `data:font/woff2;base64,${b64}`);
  }
  return out;
}

/**
 * SF-18's promise, checked rather than remembered.
 *
 * Every url() in the built stylesheet must be a data: URI. A single link to a
 * font host is a network call on every open that tells that host who is reading
 * a page whose whole premise is that nobody is told anything.
 */
function assertNoExternalUrls(css) {
  // Comments are stripped first. A url() inside one is not a request, and
  // leaving them in means anyone auditing the built file with grep — which is
  // the obvious way to check this claim — gets a false positive from prose.
  const live = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const urls = [...live.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g)].map((m) => m[2]);
  const external = urls.filter((u) => !u.startsWith('data:'));
  if (external.length > 0) {
    throw new Error(
      `The built stylesheet contains ${external.length} url() that is not a data: URI ` +
        `(SF-18, INV-6): ${external.slice(0, 3).join(', ')}`,
    );
  }
  return urls.length;
}

/** No leftover template slots, which would render as a broken font silently. */
function assertNoSlots(css) {
  const left = Object.keys(FONT_SLOTS).filter((s) => css.includes(s));
  if (left.length > 0) throw new Error(`Unsubstituted font slots: ${left.join(', ')}`);
}

async function build() {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });

  // --- stylesheet ---------------------------------------------------------
  const css = embedFonts(readFileSync(join(PUBLIC, 'styles.css'), 'utf8'));
  assertNoSlots(css);
  const urlCount = assertNoExternalUrls(css);
  writeFileSync(join(DIST, 'styles.css'), css);

  // --- script -------------------------------------------------------------
  await esbuild.build({
    entryPoints: [join(here, 'src/main.ts')],
    bundle: true,
    // Classic script, not a module. Browsers block `type="module"` from a
    // file:// path — the origin is null and the module fetch fails CORS — and
    // the file:// case has to work (SF-19, FF D-42's reasoning). An IIFE loads
    // from a folder on a desktop exactly as it does from a served subpath.
    format: 'iife',
    target: 'es2022',
    outfile: join(DIST, 'main.js'),
    minify: true,
    sourcemap: false,
    legalComments: 'none',
  });

  // --- page ---------------------------------------------------------------
  cpSync(join(PUBLIC, 'index.html'), join(DIST, 'index.html'));

  // A .nojekyll file, or GitHub Pages will not serve paths beginning with an
  // underscore and will run the whole tree through Jekyll for no reason.
  writeFileSync(join(DIST, '.nojekyll'), '');

  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const absolute = [...html.matchAll(/(?:href|src)="(\/[^"]*)"/g)].map((m) => m[1]);
  if (absolute.length > 0) {
    throw new Error(
      `index.html uses absolute paths, which break on a project-page subpath (SF-19): ${absolute.join(', ')}`,
    );
  }
  const liveHtml = html.replace(/<!--[\s\S]*?-->/g, '');
  if (/https?:\/\//.test(liveHtml)) {
    throw new Error('index.html references an external origin (INV-6).');
  }

  // The file:// promise, checked rather than remembered. A module script is
  // fetched with a null origin from a file:// path and refused by CORS, so the
  // page would load its stylesheet and then do nothing at all — silently, with
  // only a console error to show for it.
  if (/<script[^>]*\btype\s*=\s*["']module["']/.test(liveHtml)) {
    throw new Error('index.html loads a module script, which browsers refuse from file:// (SF-19).');
  }
  const js = readFileSync(join(DIST, 'main.js'), 'utf8');
  if (/^\s*(?:import|export)\s/m.test(js)) {
    throw new Error('main.js is an ES module; build it as an IIFE so file:// works (SF-19).');
  }

  const cssKb = (Buffer.byteLength(css) / 1024).toFixed(0);
  const jsKb = (readFileSync(join(DIST, 'main.js')).length / 1024).toFixed(0);
  console.log(`built dist/  styles.css ${cssKb} KB (${urlCount} embedded fonts)  main.js ${jsKb} KB`);
}

build().catch((e) => {
  console.error(`build failed: ${e.message}`);
  process.exit(1);
});
