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

import type { Deck, TableCopy } from './types.ts';

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
      'These two rows cover the days when the fund and the market both went up, or both went down. The number is how far the fund moved for every 1% the market moved on those days. So 0.60 means the fund moved about six tenths as far as the market did, and 1.00 would mean it moved just as far.',
    whatWouldChangeIt:
      'Funds built around options often move less than the market in both directions, because the options they hold give away some of the gain in exchange for softening the fall. Where the fund sits between its cap and its floor at the time changes how much of each it does.',
    whenAbsent:
      'There were not enough days in this period where the fund and the market moved the same way to work a number out from.',
  },

  resilience: {
    title: 'When the fund and the market moved in opposite directions',
    mechanism:
      'These two rows cover the days when the fund and the market went different ways. The top row is days the fund rose while the market fell. The bottom row is days the fund fell while the market rose. Days like these are less common, so these two rows usually rest on fewer of them, and the numbers in them sit closer to nought.',
    whatWouldChangeIt:
      'A fund holding a large options position can move against the market for reasons that have nothing to do with that day’s news — the value of the options themselves changes as time passes and as the market gets calmer or choppier.',
    whenAbsent:
      'There were not enough days in this period where the fund and the market moved in opposite directions to work a number out from.',
  },

  horizons: {
    title: 'Why there are three columns',
    mechanism:
      'Each column covers a different length of time, all counted back from the same date. The left-hand column looks at the past twelve months, the middle one at the past six months, and the right-hand one at the past thirteen weeks. Reading across a row shows whether the fund’s recent behaviour looks different from its own longer-run behaviour, which is the question the columns exist to answer.',
    whatWouldChangeIt:
      'The shorter the period, the fewer days sit behind the number, and the more a single unusual day moves it. Readings resting on fewer than twenty days carry a small marker saying so.',
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
    title: 'Has this fund changed?',
    mechanism:
      'A new report is published every month and every past one is kept. This sets today’s reading beside the same reading from a real report published earlier, so the two cover periods that sit end to end and share no days between them. The six months up to today, against the six months before those.',
    whatWouldChangeIt:
      'Only months that have a published report can be compared, so a fund that started recently may have nothing far enough back. The two periods are different stretches of market, and a fund can read differently across them without anything about the fund having changed.',
    whenAbsent:
      'This fund is too new for this comparison. There is no report from far enough back to set beside the current one.',
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

/**
 * The report table's own words.
 *
 * The build spec wrote these as `Participation` / `Resilience` over labels like
 * “Fund and Benchmark: Price Increase”. The structure is kept exactly and the
 * wording is not: those are terms this reader has not been given, and a heading
 * here should be the situation being described, in their words.
 */
export const TABLE: TableCopy = {
  participation: {
    heading: 'When they moved the same way',
    blurb:
      'Days when the fund and the market both went up, or both went down. The number is how far the fund moved for every 1% the market moved: 0.60 is about six tenths as far, 1.00 is just as far.',
  },
  resilience: {
    heading: 'When they moved in opposite directions',
    blurb:
      'Days when one went up and the other went down. These days are less common, so these two rows usually rest on fewer of them. A number below nought means the fund’s move ran the other way to the market’s size that day.',
  },

  comparison: {
    heading: 'How the two differ',
    blurb:
      'Both funds are read over the same stretch of days, against the same market, and sorted into the same four boxes. What is left between them is the difference between the two funds.',
    difference: 'Difference',
    sameEverythingElse:
      'Both columns come from reports covering the same month, worked out over the same length of time and against the same market index. The only thing that differs between them is the fund.',
    marked:
      'An amber dot marks a difference of 0.30 or more, the same size of move the report marks anywhere else.',
    alike:
      'A difference near nought means the two funds responded to the market in much the same way on days of that kind.',
    unavailable:
      'A dash means one of the two funds had too few days of that kind to work a reading out from, so there is nothing to subtract. It does not mean the two were the same.',
    window:
      'The difference on its own does not say much. A gap of 0.30 could be one fund moving almost as far as the market and the other moving a little less, or one moving a little and the other not at all. Both readings are shown so the gap can be read against them.',
  },

  rows: {
    fund_up_bench_up: {
      label: 'Both went up',
      full: 'Days the fund rose and the market rose',
      direction: 'sought',
    },
    fund_down_bench_down: {
      label: 'Both went down',
      full: 'Days the fund fell and the market fell',
      direction: 'avoided',
    },
    fund_up_bench_down: {
      label: 'Fund up, market down',
      full: 'Days the fund rose while the market fell',
      direction: 'sought',
    },
    fund_down_bench_up: {
      label: 'Fund down, market up',
      full: 'Days the fund fell while the market rose',
      direction: 'avoided',
    },
  },

  columns: {
    '12mo': { short: '12 mo', full: 'the past twelve months' },
    '6mo': { short: '6 mo', full: 'the past six months' },
    '13wk': { short: '13 wk', full: 'the past thirteen weeks' },
  },

  reading: {
    heading: 'How to read the numbers',
    body:
      'Each number answers the same question: for every 1% the market moved on days of that kind, how far did the fund move? A number near 1.00 means the fund kept pace. A smaller number means it moved less. A number below nought means the fund went the other way from the market’s size on those days — a bigger market move going with a smaller fund move, rather than a larger one.',
  },

  history: {
    sixMonth: 'Against six months ago',
    thirteenWeek: 'Against thirteen weeks ago',
    columns: { then: 'Before', now: 'Since', change: 'Change' },
    disjoint:
      'The two periods sit end to end and share no days, so this is a comparison of one stretch of time against the one before it — not the same days counted twice.',
    marked:
      'An amber dot marks a change of 0.30 or more, the same size of move the report marks anywhere else.',
    steady:
      'A change near nought means the fund responded to the market in much the same way across both periods.',
    unavailable:
      'A dash means one of the two periods had too few days of that kind to work a reading out from, so there is nothing to compare. It does not mean the reading was nought.',
  },

  legend: {
    tint:
      'A green row is one where a bigger number is what the fund is built to do. A red row is one where a bigger number is what it is built to avoid. The tint marks the row, not the number in it.',
    shift:
      'An amber dot marks a reading at least 0.30 away from the twelve-month reading in the same row — a sign the fund has been behaving differently lately than it did over the year.',
    thin:
      'A dotted underline marks a reading that rests on fewer than 20 days. The number is still shown, and the number of days behind it is in the cell’s tooltip.',
    blocked:
      'A dash means there were fewer than six days of that kind, which is too few to work anything out from. It does not mean zero, and it does not mean nothing happened.',
    noBaseline:
      'This fund has not been trading for a full year yet, so there is no twelve-month reading to compare the shorter ones against. Nothing in this table is marked as a shift.',
  },
};
