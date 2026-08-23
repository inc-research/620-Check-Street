// SPDX-License-Identifier: MIT
//
// Adapted from Second Floor: packages/copy/src/types.ts. The shape is the
// family's; the section keys are Third Floor's, because this app answers
// different questions.

/**
 * The deck typing.
 *
 * `Deck` is a record over every section, so adding a section without adding its
 * copy fails compilation rather than shipping a blank. First Floor's pattern,
 * and the reason its report never has an unexplained figure in it.
 */

/** One voice at v1 (SF-20). The type stays so a second is a data addition. */
export type Voice = 'plain';

/** Keys are stable — they appear in the rendered anchor links. */
export type SectionKey =
  | 'overview'
  | 'participation'
  | 'resilience'
  | 'horizons'
  | 'benchmark_choice'
  | 'outcome_period'
  | 'thin_data'
  | 'history'
  | 'comparing_funds';

export interface Section {
  /**
   * The heading, written as the question the reader is asking, in their words.
   * Not a technical label.
   */
  title: string;
  /**
   * What this section is and how the number was arrived at. Mechanism, never a
   * verdict — the governing rule, transferred through three apps unamended.
   */
  mechanism: string;
  /** What would make this section come out differently. */
  whatWouldChangeIt: string;
  /** Printed instead of the figures when a blocker fires. Required (INV-2). */
  whenAbsent: string;
}

export type Deck = Record<SectionKey, Section>;

/**
 * The report table's own words: the two group headings, the four row labels,
 * the three column headings, and the legend.
 *
 * A record over every state and horizon, for the same reason `Deck` is a record
 * over every section — adding a row without writing its label fails compilation
 * rather than rendering an empty cell.
 */
export type StateKey =
  | 'fund_up_bench_up'
  | 'fund_down_bench_down'
  | 'fund_up_bench_down'
  | 'fund_down_bench_up';

export type HorizonKey = '12mo' | '6mo' | '13wk';

/**
 * Whether a higher number in this row is the outcome the fund's own design is
 * aiming at. A fixed property of the row, never of the value — the tint says
 * which way to read the row, and never passes judgement on the number in it.
 */
export type RowDirection = 'sought' | 'avoided';

export interface RowLabel {
  /** What happened that day, in the reader's words. */
  label: string;
  /** The same thing spelled out, for a screen reader and the row's title. */
  full: string;
  direction: RowDirection;
}

export interface TableCopy {
  participation: { heading: string; blurb: string };
  resilience: { heading: string; blurb: string };
  /** How to read a number at all, printed once above the table. */
  reading: { heading: string; body: string };
  /** Lens B: the same reading, across two real reports. */
  history: {
    sixMonth: string;
    thirteenWeek: string;
    columns: { then: string; now: string; change: string };
    disjoint: string;
    marked: string;
    steady: string;
    unavailable: string;
  };
  rows: Record<StateKey, RowLabel>;
  columns: Record<HorizonKey, { short: string; full: string }>;
  legend: {
    tint: string;
    shift: string;
    thin: string;
    blocked: string;
    noBaseline: string;
  };
}
