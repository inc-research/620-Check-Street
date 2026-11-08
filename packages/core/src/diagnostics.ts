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

  noReportThatFarBack: (ticker: string, month: string, earliest: string): Blocker => ({
    code: 'no_report_that_far_back',
    message: `There is no report for ${ticker} covering ${month}, so there is nothing from back then to set beside the current one. The oldest report on record for it is from ${earliest}.`,
    remedy: 'Read the current report on its own, or pick a more recent month to compare from.',
    subjects: [ticker, month],
  }),

  benchmarkNotInBothReports: (ticker: string, benchmark: string, month: string): Blocker => ({
    code: 'benchmark_not_in_both_reports',
    message: `The report for ${ticker} from ${month} does not measure against ${benchmark}, so the two reports would be answering different questions.`,
    remedy: 'Compare on the US large-cap anchor, which every report here measures against.',
    subjects: [ticker, benchmark, month],
  }),

  reportVersionMismatch: (older: string, newer: string): Blocker => ({
    code: 'report_version_mismatch',
    message: `These two reports were worked out in different ways — one is version ${older} and the other version ${newer} — so putting their numbers side by side would compare two different methods rather than two different periods.`,
    remedy: 'Compare two reports of the same version. The version is recorded in every report.',
    subjects: [older, newer],
  }),

  trendMonthMissing: (ticker: string, month: string): Blocker => ({
    code: 'trend_month_missing',
    message: `There is no report for ${ticker} from ${month} to read this against. The fund may be too new, or that report could not be loaded.`,
    remedy: 'Read the months that are shown, or the report on its own.',
    subjects: [ticker, month],
  }),

  trendLowFit: (month: string, benchmark: string): Blocker => ({
    code: 'trend_low_fit',
    message: `In ${month}, ${benchmark} explained too little of this fund’s daily movement for this figure to describe the fund.`,
    remedy: 'Read a month where the fund followed this benchmark more closely, or try another benchmark.',
    subjects: [month, benchmark],
  }),

  trendWindowBlocked: (month: string, why: string): Blocker => ({
    code: 'trend_window_blocked',
    message: `This window could not be worked out for ${month}. ${why}`,
    remedy: 'Pick a shorter window.',
    subjects: [month],
  }),

  periodNotComparable: (month: string, why: string): Blocker => ({
    code: 'period_not_comparable',
    message: `The reading for the earlier period could not be worked out. ${why}`,
    remedy: 'Read the current report on its own, or pick a different period to compare against.',
    subjects: [month],
  }),

  sameFundTwice: (ticker: string): Blocker => ({
    code: 'same_fund_twice',
    message: `${ticker} would be set beside itself, which can only ever show that a fund behaves exactly like itself.`,
    remedy: 'Pick a different fund for the other side of the comparison.',
    subjects: [ticker],
  }),

  readingsFromDifferentMonths: (a: string, monthA: string, b: string, monthB: string): Blocker => ({
    code: 'readings_from_different_months',
    message: `The report for ${a} covers ${monthA} and the one for ${b} covers ${monthB}. Set side by side, the difference between them would be partly the two funds and partly the two stretches of market, with no way to tell which.`,
    remedy: 'Compare the two funds in a month both of them have a report for.',
    subjects: [a, monthA, b, monthB],
  }),

  noMonthInCommon: (a: string, b: string): Blocker => ({
    code: 'no_month_in_common',
    message: `${a} and ${b} have no month with a published report for both, so there is no point in time at which the two can be set side by side.`,
    remedy: 'Compare one of them against a fund that has been running over the same months.',
    subjects: [a, b],
  }),

  readingNotComparable: (ticker: string, why: string): Blocker => ({
    code: 'reading_not_comparable',
    message: `The reading for ${ticker} over this period could not be worked out. ${why}`,
    remedy: 'Pick a longer period, which rests on more days, or read each fund’s own report on its own.',
    subjects: [ticker],
  }),

  tickerNotTracked: (ticker: string): Blocker => ({
    code: 'ticker_not_tracked',
    message: `${ticker} is not one of the funds this site follows.`,
    remedy: 'This site follows a fixed list of options-based funds, shown on the front page. Pick one from that list.',
    subjects: [ticker],
  }),

  ratesNotCovered: (start: string, end: string): Blocker => ({
    code: 'rates_not_covered',
    message: `The published figures for consumer prices and Treasury bill rates do not reach back over ${start} to ${end}, so this period cannot be shown in today’s money.`,
    remedy: 'Read the figures before inflation in the rows above, or pick a shorter period.',
  }),
} as const;
