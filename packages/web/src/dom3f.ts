// SPDX-License-Identifier: MIT
//
// Third Floor's extension to the vendored DOM helper.
//
// `dom.ts` is verbatim from Second Floor and is never edited in place (SF-17).
// Its `Attrs` type lists the attributes that app needed, and a report table
// needs a few more — `colspan` and `scope` for a grouped table, `for` to bind a
// label to its control, `aria-*` for markers whose meaning is otherwise carried
// only by colour or shape.
//
// The vendored `el` already sets any attribute it is handed, skipping null and
// undefined and treating `on*` values as listeners. So this widens the type and
// changes no behaviour — and, importantly, keeps text going through
// `textContent`, so nothing a data file carries can become markup.

import { el as vendoredEl, type Attrs as VendoredAttrs } from './dom.ts';

type Child = Node | string | null | undefined | false;

export interface Attrs extends VendoredAttrs {
  colspan?: string;
  rowspan?: string;
  scope?: 'row' | 'col' | 'rowgroup' | 'colgroup';
  for?: string;
  selected?: string;
  disabled?: string;
  hidden?: string;
  'aria-hidden'?: 'true' | 'false';
  'aria-describedby'?: string;
  'aria-live'?: 'polite' | 'assertive';
}

/**
 * As the vendored `el`, with a wider attribute list and one convenience: an
 * attribute whose value is `undefined` is dropped rather than rejected by the
 * compiler, so a caller can write a conditional attribute inline instead of
 * building the object in two steps.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: { [P in keyof Attrs]?: Attrs[P] | undefined } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) cleaned[k] = v;
  }
  return vendoredEl(tag, cleaned as VendoredAttrs, ...children);
}

export { append, clear, table, copyText, download } from './dom.ts';
