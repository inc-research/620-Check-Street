// SPDX-License-Identifier: MIT
//
// The two shapes every section of a report shares (620 Check Street): a heading
// with one line of context under it, and the longer explanation closed beneath
// the figures, so the numbers lead and the prose is a click away.

import { TABLE, append, el } from '../shim.ts';

type Child = HTMLElement | string | null | undefined | false;

/** Section accents. Bright and never green or red: they mark which section, not whether a figure is good. */
export type Accent = 'blue' | 'orange' | 'violet' | 'sky' | 'gold';

export function sectionHead(title: string, caption: string | null, accent: Accent): HTMLElement {
  return el(
    'header',
    { class: `section-head accent-${accent}` },
    el('h3', {}, title),
    caption ? el('p', { class: 'caption' }, caption) : null,
  );
}

/** The longer text, closed by default. */
export function explainer(...children: Child[]): HTMLElement {
  const node = el('details', { class: 'explain' }, el('summary', {}, TABLE.explainSummary));
  append(node, children);
  return node;
}
