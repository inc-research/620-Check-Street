// SPDX-License-Identifier: MIT

/**
 * The shell and the view router.
 *
 * The report views are not written yet — this build stands up the archive, the
 * document and the spine. What is here is the frame they land in, and the
 * front page that names what the site follows.
 */

import { PLAIN, clear, el } from './shim.ts';

// Children go through `el`'s varargs rather than Element.append, which the
// vendored dom helper deliberately does not wrap — every child is appended as a
// node or set via textContent, so nothing a data file carries can become markup.
function frontPage(): HTMLElement {
  return el(
    'section',
    {},
    el('h2', {}, PLAIN.overview.title),
    el('p', {}, PLAIN.overview.mechanism),
    el('h3', {}, PLAIN.benchmark_choice.title),
    el('p', {}, PLAIN.benchmark_choice.mechanism),
    el('h3', {}, PLAIN.outcome_period.title),
    el('p', {}, PLAIN.outcome_period.mechanism),
  );
}

export function render(): void {
  const app = document.getElementById('app');
  if (!app) return;
  clear(app);
  app.appendChild(frontPage());
}

if (typeof document !== 'undefined') {
  render();
}
