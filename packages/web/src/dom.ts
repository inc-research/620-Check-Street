// SPDX-License-Identifier: MIT
//
// Vendored verbatim from Second Floor: packages/web/src/dom.ts
// Do not edit in place (SF-17). Changes belong in a new Third Floor module.
// Verified byte-identical by scripts/check-vendored.mjs.
//
// ---- vendored body below; do not edit (SF-17) ----
// SPDX-License-Identifier: MIT
//
// Vendored verbatim from First Floor: packages/web/src/dom.ts
// Do not edit in place (SF-17). Changes belong in a new Second Floor module.
// Verified byte-identical by scripts/check-vendored.mjs.
//
// ---- vendored body below; do not edit (SF-17) ----
// SPDX-License-Identifier: MIT

/**
 * A very small DOM helper. No framework: the page is a handful of views with
 * direct updates, and the only thing that recomputes at interactive speed is a
 * closed-form slider that finishes well inside a frame.
 *
 * `text` is always set through `textContent`, never `innerHTML`, so a ticker or
 * a fund name typed by the user cannot become markup.
 */

type Child = Node | string | null | undefined | false;

export interface Attrs {
  class?: string;
  id?: string;
  type?: string;
  value?: string;
  min?: string;
  max?: string;
  step?: string;
  href?: string;
  title?: string;
  rows?: string;
  placeholder?: string;
  download?: string;
  spellcheck?: string;
  'aria-pressed'?: string;
  'aria-current'?: string;
  'aria-label'?: string;
  onclick?: (e: MouseEvent) => void;
  oninput?: (e: Event) => void;
  onchange?: (e: Event) => void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'function') {
      node.addEventListener(k.slice(2), v as EventListener);
    } else {
      node.setAttribute(k, String(v));
    }
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * A table from headers and already-formatted cells. Wrapped so wide tables
 * scroll rather than pushing the page sideways.
 *
 * All-blank headers mean the table is a list of label/value pairs, so the
 * header row is omitted entirely rather than rendered as an empty band.
 */
export function table(headers: string[], rows: string[][]): HTMLElement {
  const labelled = headers.some((h) => h.trim() !== '');
  return el(
    'div',
    { class: 'scroll-x' },
    el(
      'table',
      {},
      labelled ? el('thead', {}, el('tr', {}, ...headers.map((h) => el('th', {}, h)))) : null,
      el(
        'tbody',
        {},
        ...rows.map((r) => el('tr', {}, ...r.map((c, i) => el('td', { class: i === 0 ? '' : 'num' }, c)))),
      ),
    ),
  );
}

export function toast(message: string): void {
  const node = el('div', { class: 'toast' }, message);
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 2200);
}

/**
 * Offer a file for download from an in-memory string.
 *
 * Uses a blob URL rather than a server round trip, because there is no server
 * and the whole point is that the position never leaves the machine.
 */
export function download(filename: string, contents: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Copy to the clipboard, falling back to a selection when the API is unavailable. */
export function copyText(text: string): void {
  const done = () => toast('Copied to the clipboard');
  const clipboard = navigator.clipboard as { writeText?: (t: string) => Promise<void> } | undefined;
  if (clipboard?.writeText) {
    clipboard.writeText(text).then(done, () => fallback(text, done));
  } else {
    fallback(text, done);
  }
}

function fallback(text: string, done: () => void): void {
  const area = el('textarea', {}, text);
  document.body.appendChild(area);
  area.select();
  try {
    (document as unknown as { execCommand: (c: string) => boolean }).execCommand('copy');
    done();
  } catch {
    toast('Select the text and copy it');
  }
  area.remove();
}
