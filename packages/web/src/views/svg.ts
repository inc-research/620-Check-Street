// SPDX-License-Identifier: MIT
//
// The smallest SVG helper the selected reports need (3F D-25), beside the
// vendored `el`, which builds HTML only. Same promise as `el`: text goes in
// through `textContent`, never markup, so nothing a data file carries can become
// part of the page.

const NS = 'http://www.w3.org/2000/svg';

export type SvgAttrs = Record<string, string | number>;

export function svg(tag: string, attrs: SvgAttrs = {}, parent?: Element): SVGElement {
  const node = document.createElementNS(NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}

export function svgText(
  parent: Element,
  x: number,
  y: number,
  text: string,
  cls = '',
  anchor: 'start' | 'middle' | 'end' = 'start',
): SVGElement {
  const node = svg('text', { x, y, class: cls, 'text-anchor': anchor }, parent);
  node.textContent = text;
  return node;
}
