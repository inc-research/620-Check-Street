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
  | 'money'
  | 'exposure'
  | 'follows'
  | 'participation'
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
export type StateKey = 'fund_up_bench_up' | 'fund_down_bench_down';

export type HorizonKey = '12mo' | '6mo' | '13wk';

export interface RowLabel {
  /** What happened that day, in the reader's words. */
  label: string;
  /** The same thing spelled out, for a screen reader and the row's title. */
  full: string;
}

/** Every row the report can draw. Mirrors `Measure` in the core. */
export type MeasureKey =
  | 'growth_fund'
  | 'growth_benchmark'
  | 'fall_fund'
  | 'fall_benchmark'
  | 'day_up_benchmark'
  | 'day_up_fund'
  | 'day_down_benchmark'
  | 'day_down_fund'
  | 'capture_up'
  | 'capture_down'
  | 'fit'
  | 'against_down'
  | 'against_up';

export type GroupKey = 'money' | 'days' | 'exposure' | 'follows';

export interface TableCopy {
  /** The four groups of the main table. */
  groups: Record<GroupKey, { heading: string; blurb: string }>;
  measures: Record<MeasureKey, RowLabel>;
  /**
   * The sentence the report leads with. Written with {placeholders} rather than
   * built up in a view, so the lint reads every word of it.
   */
  perOne: {
    up: string;
    down: string;
    upOpposite: string;
    downOpposite: string;
    lowFit: string;
  };
  /** The basis of the money figures, and what they cannot say. */
  limits: { heading: string; items: readonly string[] };
  /** The collapsed section holding the same-direction readings. */
  detail: { summary: string; intro: string; heading: string; firstColumn: string };
  /** Lens B: the same reading, across two real reports. */
  history: {
    sixMonth: string;
    thirteenWeek: string;
    columns: { then: string; now: string; change: string };
    disjoint: string;
    steady: string;
    unavailable: string;
  };
  /** Lens C: two funds, one benchmark, one month, one window length. */
  comparison: {
    heading: string;
    blurb: string;
    difference: string;
    sameEverythingElse: string;
    marked: string;
    alike: string;
    unavailable: string;
    window: string;
  };
  rows: Record<StateKey, RowLabel>;
  columns: Record<HorizonKey, { short: string; full: string }>;
  legend: {
    shift: string;
    thin: string;
    blocked: string;
    noBaseline: string;
  };
}
