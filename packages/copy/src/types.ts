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
