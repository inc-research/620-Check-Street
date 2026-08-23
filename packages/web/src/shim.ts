// SPDX-License-Identifier: MIT

/**
 * Everything the views take from the two packages, in one place.
 *
 * The views import from here rather than reaching across into
 * `@third-floor/core` and `@third-floor/copy` individually, so what the page is
 * allowed to touch is a list somebody can read, and so a view cannot quietly
 * start computing something the core should own (INV-5). The page renders the
 * document; it never recomputes it.
 */

export {
  BLOCKERS,
  HORIZONS,
  SCHEMA_VERSION,
  STATES,
  explain,
  isSnapshot,
  normaliseScore,
  validateSnapshot,
  type BenchmarkBlock,
  type Blocker,
  type Cell,
  type Coverage,
  type Horizon,
  type HorizonName,
  type Methodology,
  type Problem,
  type Snapshot,
  type StateName,
} from '@third-floor/core';

export { PLAIN, type Deck, type Section, type SectionKey } from '@third-floor/copy';

export { el, append, clear, table, copyText, download } from './dom.ts';
