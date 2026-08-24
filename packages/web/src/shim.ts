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
  BASELINE,
  BLOCKERS,
  LOOKBACK_COLUMN,
  LOOKBACK_MONTHS,
  archivedMonthFor,
  buildLensA,
  buildLensB,
  buildLensC,
  canCompare,
  comparableHorizons,
  defaultBenchmark,
  monthsBack,
  sharedBenchmarks,
  sharedMonths,
  COMPARISON_HORIZON,
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
  type LensATable,
  type LensBRow,
  type LensBTable,
  type LensCRow,
  type LensCTable,
  type Lookback,
  type Problem,
  type Snapshot,
  type StateName,
  type TableCell,
  type TableRow,
} from '@third-floor/core';

export {
  BENCHMARK_INDEX,
  PLAIN,
  TABLE,
  benchmarkIndexNote,
  benchmarkIndexShort,
  type BenchmarkIndex,
  type Deck,
  type HorizonKey,
  type Section,
  type SectionKey,
  type StateKey,
  type TableCopy,
} from '@third-floor/copy';

// The widened `el` (see dom3f.ts). The vendored primitives come through it, so
// there is still one import surface the views are allowed to touch.
export { el, append, clear, table, copyText, download, type Attrs } from './dom3f.ts';
