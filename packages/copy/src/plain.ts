// SPDX-License-Identifier: MIT
//
// The deck. One voice at v1 (SF-20).
//
// The governing rule, carried through three apps unamended: replace jargon with
// mechanism, never with a verdict. Jargon is “semibeta of 0.42 in the downside
// quadrant”. A verdict is “this fund is defensive”. Mechanism is “on days the
// market fell, this fund fell about 42 pence for every pound the market lost”.
//
// The reader is not a hostile one and not an ignorant one. They are an
// intelligent adult who has not been handed the vocabulary — capable of the
// idea, never given the word for it. Every sentence here resolves toward that
// person, and every one of them came to check something they already own.

import type { Deck } from './types.ts';

export const PLAIN: Deck = {
  overview: {
    title: 'What this page is showing you',
    mechanism:
      'This fund uses options contracts to change how it responds to the wider stock market. That is meant to make it behave differently from the market on the way up than it does on the way down. This page takes every day the fund has traded, sorts those days by which direction the fund and the market each moved, and works out how big the fund’s move was compared with the market’s on each kind of day.',
    whatWouldChangeIt:
      'The numbers are worked out again at the start of every month, from the daily closing prices of the past year. A month of unusual market movement can move them.',
    whenAbsent:
      'There is not enough price history for this fund yet to work any of this out.',
  },

  participation: {
    title: 'When the fund and the market moved the same way',
    mechanism:
      'These two rows cover the days when the fund and the market both went up, or both went down. A reading of 50 means the fund moved by about the same amount as the market on those days. Below 50 means it moved less. Above 50 means it moved more. The top row is the days both went up, and the bottom row is the days both went down.',
    whatWouldChangeIt:
      'Funds built around options often move less than the market in both directions, because the options they hold give away some of the gain in exchange for softening the fall. Where the fund sits between its cap and its floor at the time changes how much of each it does.',
    whenAbsent:
      'There were not enough days in this period where the fund and the market moved the same way to work a number out from.',
  },

  resilience: {
    title: 'When the fund and the market moved in opposite directions',
    mechanism:
      'These two rows cover the days when the fund and the market went different ways. The top row is days the fund rose while the market fell. The bottom row is days the fund fell while the market rose. Days like these are less common than the ones above, so these two rows are usually worked out from fewer days.',
    whatWouldChangeIt:
      'A fund holding a large options position can move against the market for reasons that have nothing to do with that day’s news — the value of the options themselves changes as time passes and as the market gets calmer or choppier.',
    whenAbsent:
      'There were not enough days in this period where the fund and the market moved in opposite directions to work a number out from.',
  },

  horizons: {
    title: 'Why there are four columns',
    mechanism:
      'Each column covers a different length of time, all counted back from the same date. The left-hand column looks at the past twelve months, and the right-hand one at the past four weeks. Reading across the row shows whether the fund’s recent behaviour looks different from its own longer-run behaviour.',
    whatWouldChangeIt:
      'The shorter the period, the fewer days sit behind the number, and the more a single unusual day moves it. The four-week column in particular rests on about twenty days split four ways, which is why most of its readings carry the small marker for thin data.',
    whenAbsent:
      'This fund has not been trading long enough to fill this column.',
  },

  benchmark_choice: {
    title: 'What the fund is being compared against',
    mechanism:
      'Every fund on this site is compared against a US large-company index fund, so that any two funds here can be set side by side. Where a fund’s own paperwork names something else as the thing it measures itself against, and that thing is tracked here, it is shown as a second comparison. That second one answers a sharper question: does this fund behave the way its own literature says it does.',
    whatWouldChangeIt:
      'Some funds name an index in their legal paperwork and describe themselves differently in their marketing. Where those two disagree, this page says which of them the comparison came from.',
    whenAbsent:
      'This fund names no benchmark of its own, so the only comparison here is against the US large-company anchor.',
  },

  outcome_period: {
    title: 'Why the reading depends on when you look',
    mechanism:
      'Most funds on this site set a limit on how much they can gain and how much they can lose over a fixed stretch of time, often a year, and then reset. How the fund responds to the market on any given day depends on where its price sits between those two limits at that moment. Near the upper limit it tends to stop keeping up with rises. Near the lower limit it tends to stop following falls.',
    whatWouldChangeIt:
      'The reading reflects where the fund sits in its current stretch as much as how it behaves in general. Two readings taken at different points in that stretch can differ without anything about the fund having changed.',
    whenAbsent:
      'This fund does not work on fixed limits that reset, so this does not apply to it.',
  },

  thin_data: {
    title: 'The small marker on some numbers',
    mechanism:
      'A number needs a reasonable number of days behind it before it means much. Where fewer than twenty days fell into a particular box, the number is still shown, with a small marker next to it saying how few days it rests on.',
    whatWouldChangeIt:
      'Longer periods gather more days, so a marked number in one column is often unmarked in the column to its left.',
    whenAbsent:
      'Every number in this table rests on at least twenty days.',
  },

  history: {
    title: 'Comparing against an earlier report',
    mechanism:
      'A new report is published every month and every past one is kept. Setting today’s report beside one from six months ago compares two real readings taken six months apart, which is a different question from the four columns above — those all look back from today, just over different lengths of time.',
    whatWouldChangeIt:
      'Only months that have a published report can be compared. For a fund that started recently, there may not be one from far enough back.',
    whenAbsent:
      'This fund is too new for a historical comparison. The oldest report on record for it is more recent than the date asked for.',
  },

  comparing_funds: {
    title: 'Comparing two funds',
    mechanism:
      'Two funds can be set side by side, box for box, to see how differently they responded to the same market. Both sides are compared against the same US large-company anchor, so the difference between them is about the funds and not about what each one chose to measure itself against.',
    whatWouldChangeIt:
      'Both funds have to have a report for the same month. Where one of them is newer, the earliest month they share is the earliest that can be compared.',
    whenAbsent:
      'These two funds have no month in common with a published report for both.',
  },
};
