// SPDX-License-Identifier: MIT
//
// Adapted from Second Floor: packages/core/src/diagnostics.ts
//
// The Blocker / Measured<T> model is the family's, carried over unchanged in
// shape. The BLOCKERS constant is Third Floor's own, because the things that
// can go missing here are different things: Second Floor's blockers are about
// reading a holdings file, and Third Floor takes no file at all.
//
// Not byte-checked by scripts/check-vendored.mjs — under SF-17 a module that
// needed changing is a Third Floor module, and stops claiming verbatim
// provenance rather than quietly diverging under a header saying otherwise.

import type { Blocker } from './schema/types.ts';

/**
 * A quantity that is either measured or explicitly absent, never silently
 * defaulted (INV-2). A semibeta of 0.00 says the fund did not move with its
 * benchmark in that quadrant; a semibeta that could not be computed says
 * nothing at all, and printing it as 0.00 asserts the first while knowing the
 * second.
 */
export type Measured<T> =
  | { value: T; blockers: readonly [] }
  | { value: null; blockers: readonly [Blocker, ...Blocker[]] };

export function measured<T>(value: T): Measured<T> {
  return { value, blockers: [] };
}

export function blocked<T>(first: Blocker, ...rest: Blocker[]): Measured<T> {
  return { value: null, blockers: [first, ...rest] };
}

export function isMeasured<T>(m: Measured<T>): m is { value: T; blockers: readonly [] } {
  return m.value !== null;
}

/** The sentence a renderer prints in place of the figure — cause and remedy together. */
export function explain(blockers: readonly Blocker[]): string {
  return blockers.map((b) => `${b.message} ${b.remedy}`).join(' ');
}

/**
 * Blockers the site raises on its own, as distinct from the ones the notebook
 * writes into a snapshot. These are about the archive rather than the maths.
 */
export const BLOCKERS = {
  fundTooNewForHistory: (ticker: string, earliest: string): Blocker => ({
    code: 'fund_too_new_for_history',
    message: `There is no report for ${ticker} from that far back. The oldest one on record is from ${earliest}, because the fund had not been running long enough before then.`,
    remedy: 'Pick a more recent date to compare against, or read the current report on its own.',
    subjects: [ticker],
  }),

  noBaselineToCompareAgainst: (ticker: string): Blocker => ({
    code: 'no_baseline_to_compare_against',
    message: `${ticker} does not yet have a full twelve months of trading history, so there is no long-run reading to measure its recent behaviour against.`,
    remedy: 'Read the shorter windows on their own. The twelve-month reading appears once the fund has been trading that long.',
    subjects: [ticker],
  }),

  benchmarkNotShared: (a: string, b: string): Blocker => ({
    code: 'benchmark_not_shared',
    message: `${a} and ${b} do not measure themselves against the same thing, so putting their numbers side by side would compare two different questions.`,
    remedy: 'Compare them on the US large-cap anchor, which is worked out for every fund here.',
    subjects: [a, b],
  }),

  snapshotNotFound: (ticker: string, month: string): Blocker => ({
    code: 'snapshot_not_found',
    message: `No report was published for ${ticker} covering ${month}.`,
    remedy: 'Pick another month. Every month with a report is listed above.',
    subjects: [ticker, month],
  }),

  tickerNotTracked: (ticker: string): Blocker => ({
    code: 'ticker_not_tracked',
    message: `${ticker} is not one of the funds this site follows.`,
    remedy: 'This site follows a fixed list of options-based funds, shown on the front page. Pick one from that list.',
    subjects: [ticker],
  }),
} as const;
