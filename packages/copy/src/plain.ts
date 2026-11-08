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
      'This page starts with what happened to money held in this fund, set beside the same money held in the market, then shows how much of the market’s movement the fund carried and how closely it followed.',
    whatWouldChangeIt:
      'The numbers are worked out again at the start of every month, from daily closing prices. A month of unusual market movement can move them.',
    whenAbsent:
      'There is not enough price history for this fund yet to work any of this out.',
  },

  money: {
    title: 'What happened to the money',
    mechanism:
      'Each column follows $100 over that stretch of time, for this fund and for the market, with distributions reinvested. The deepest fall is the largest drop from a high along the way, which a good end result can hide.',
    whatWouldChangeIt:
      'These depend on where the stretch of time starts and ends. A different start date can give a different result for the same fund.',
    whenAbsent:
      'This fund has not been trading long enough to follow $100 over this stretch of time.',
  },

  exposure: {
    title: 'How much of the market the fund carried',
    mechanism:
      'Takes every day the market rose and adds up the fund’s moves and the market’s moves, then does the same for every day it fell. Days the fund went the other way are included and count against it. On rising days the figure is the upside capture: 1.00 would mean the fund rose as far as the market did. On falling days it is the loss buffer, the part of each 1% fall that did not show up in the fund: 0 means the fund fell as far as the market, 0.50 that it fell half as far, and 1.00 that it did not fall at all. Below 0, the fund fell further than the market; above 1.00, it rose overall while the market fell.',
    whatWouldChangeIt:
      'Funds built around options often move less than the market in both directions. Where the fund sits between its cap and its floor at the time changes how much of each it does.',
    whenAbsent:
      'The market moved in this direction on too few days in this stretch of time to work a number out from.',
  },

  follows: {
    title: 'How closely the fund follows the market',
    mechanism:
      'The first figure is the share of the fund’s day-to-day movement that lines up with the market’s. The other two count how often the fund went the other way.',
    whatWouldChangeIt:
      'A fund holding a large options position can move against the market for reasons that have nothing to do with that day’s news. The value of the options themselves changes as time passes and as the market gets calmer or choppier.',
    whenAbsent:
      'The fund or the market barely moved in this stretch of time, so there is nothing to line one up against the other with.',
  },

  participation: {
    title: 'How the fund’s move scaled with the market’s',
    mechanism:
      'This is a second way of measuring the days when the fund and the market moved the same way. It asks a narrower question: on those days, when the market’s move was bigger, how much bigger was the fund’s? So 0.60 means that each extra 1% on the market’s side went with about six tenths of 1% extra on the fund’s.',
    whatWouldChangeIt:
      'Where the fund sits between its cap and its floor at the time changes how much of each it does.',
    whenAbsent:
      'There were not enough days in this period where the fund and the market moved the same way to work a number out from.',
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
      'A number needs a reasonable number of days behind it before it means much. Where fewer than twenty days went into a figure, the number is still shown, with a small marker next to it saying how few days it rests on.',
    whatWouldChangeIt:
      'Longer periods gather more days, so a marked number in one column is often unmarked in the column to its left.',
    whenAbsent:
      'Every number in this table rests on at least twenty days.',
  },

  capture_trend: {
    title: 'How has this changed lately?',
    mechanism:
      'Each month’s report measures how much of the market’s rises and falls the fund carried. This reads those figures from one report to the next, for market-up days and market-down days separately, with the down side shown as the loss buffer: a higher loss buffer means less of the market’s falls showed up in the fund. Each figure covers the same length of time, ending at that month’s close.',
    whatWouldChangeIt:
      'A change says the fund carried more or less of the market than it did before. It does not say why. The market moved differently across these periods, a fund can read differently without anything in it having changed, and the same days can sit in both of the figures being compared.',
    whenAbsent:
      'This fund is too new for this comparison. There is no report from far enough back to set beside the current one.',
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
      'Two funds can be set side by side, figure for figure, to see how differently they came through the same market. Both sides are compared against the same US large-company anchor, so the difference between them is about the funds and not about what each one chose to measure itself against.',
    whatWouldChangeIt:
      'Both funds have to have a report for the same month. Where one of them is newer, the earliest month they share is the earliest that can be compared.',
    whenAbsent:
      'These two funds have no month in common with a published report for both.',
  },

  observer: {
    title: 'Using these figures with an AI system',
    mechanism:
      'The same figures are published as an OBSERVER Folder: a small set of files that opens with the five highest and five lowest funds on each measure, followed by every figure with the formula and the inputs behind it. Download it and add it to a conversation with any AI system, which can then recompute the figures from the folder itself.',
    whatWouldChangeIt:
      'The folder sets the funds in order on each measure, all against the same benchmark, which these pages do not do. An order describes a past period. It is not a grade, and it says nothing about what any fund does next.',
    whenAbsent:
      'The folder is published alongside each month’s reports.',
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
  groups: {
    money: {
      heading: 'What happened to $100',
      blurb: 'Followed over each stretch of time, with distributions reinvested.',
    },
    days: {
      heading: 'An average day, per $100',
      blurb: 'The average across every day the market rose, and every day it fell.',
    },
    exposure: {
      heading: 'For every 1% the market moved',
      blurb: 'Every day the market moved that way is counted, including days the fund went the other way.',
    },
    follows: {
      heading: 'How closely it follows',
      blurb: 'How much of the fund’s movement lines up with the market’s, and how often it went the other way.',
    },
  },

  measures: {
    growth_fund: { label: 'In this fund', full: '$100 held in this fund became' },
    growth_benchmark: { label: 'In the market', full: '$100 held in the market became' },
    fall_fund: { label: 'This fund’s deepest fall', full: 'The largest drop from a high in this fund, per $100 at that high' },
    fall_benchmark: { label: 'The market’s deepest fall', full: 'The largest drop from a high in the market, per $100 at that high' },
    day_up_benchmark: { label: 'Market, on its rising days', full: 'The market’s average day, across the days it rose' },
    day_up_fund: { label: 'This fund, on the market’s rising days', full: 'This fund’s average day, across the days the market rose' },
    day_down_benchmark: { label: 'Market, on its falling days', full: 'The market’s average day, across the days it fell' },
    day_down_fund: { label: 'This fund, on the market’s falling days', full: 'This fund’s average day, across the days the market fell' },
    capture_up: { label: 'Upside capture', full: 'How far this fund rose for every 1% the market gained, across the market’s rising days' },
    loss_buffer: { label: 'Loss buffer', full: 'How much of each 1% the market lost did not show up in this fund, across the market’s falling days. 0.24 means the fund lost 0.76% for every 1% the market lost' },
    fit: { label: 'Movement in line with the market', full: 'The share of this fund’s day-to-day movement that lines up with the market’s' },
    against_down: { label: 'Market fell, fund rose', full: 'The share of the market’s falling days on which this fund rose' },
    against_up: { label: 'Market rose, fund fell', full: 'The share of the market’s rising days on which this fund fell' },
  },

  perOne: {
    up: 'Over {window}, across the days the market rose, this fund gained {ratio}% for every 1% the market gained.',
    down: 'Its loss buffer was {buffer}: across the days the market fell, it lost {carried}% for every 1% the market lost.',
    upOpposite: 'Over {window}, across the days the market rose, this fund fell overall: {ratio}% for every 1% the market gained.',
    downOpposite: 'Its loss buffer was {buffer}: across the days the market fell, it rose overall, {carried}% for every 1% the market lost.',
    downDeeper: 'Its loss buffer was {buffer}: across the days the market fell, it lost {carried}% for every 1% the market lost, which is more than the market did.',
    lowFit:
      'Over {window}, only {share}% of this fund’s day-to-day movement lined up with {benchmark}. With so little in common, a figure per 1% of the market would not describe this fund, so none is offered here. The money figures are what happened. The two per-1% rows in the table are arithmetic, kept as a record.',
  },

  limits: {
    heading: 'What these figures are, and what they are not',
    items: [
      'Worked out from closing market prices, with distributions reinvested. A fund’s market price can sit a little above or below the value of what it holds.',
      'The fund’s own costs are already in its price, so every figure here is after them. They are shown below as an amount, never taken off a second time. Taxes and the cost of buying and selling are not counted.',
      'Inflation is measured by the national consumer price index, which follows the spending of an average city household rather than any one person’s.',
      'These are past stretches of time. They say nothing about what comes next.',
      'A cap or a buffer applies over the fund’s own outcome period, to someone who held from its start. These windows do not line up with that period, so these figures do not show whether a cap or a buffer delivered what it set out to.',
      'An average is not a ceiling. On a single sharp day a fund can fall further than these figures suggest.',
    ],
  },

  detail: {
    summary: 'A closer look at the days they moved together',
    intro:
      'A number close to the per-1% figures above means the two ways of measuring agree. A number far from them means the size of the fund’s moves and the way they scaled tell different stories, and the per-1% figures are the ones that tie to the money.',
    heading: 'When they moved the same way',
    firstColumn: 'On days when…',
  },

  comparison: {
    heading: 'How the two differ',
    blurb:
      'Both funds are read over the same stretch of days, against the same market. What is left between them is the difference between the two funds.',
    difference: 'Difference',
    sameEverythingElse:
      'Both columns come from reports covering the same month, worked out over the same length of time and against the same market index. The only thing that differs between them is the fund.',
    marked:
      'An amber dot marks a gap of 0.30 or more on the two per-1% rows.',
    alike:
      'A difference near nought means the two funds came through this stretch of market in much the same way.',
    unavailable:
      'A dash means one of the two funds had too few days of that kind to work a reading out from, so there is nothing to subtract. It does not mean the two were the same.',
    window:
      'The difference on its own does not say much. A gap of 0.30 could be one fund moving almost as far as the market and the other moving a little less, or one moving a little and the other hardly at all. Both readings are shown so the gap can be read against them.',
  },

  rows: {
    fund_up_bench_up: { label: 'Both went up', full: 'Days the fund rose and the market rose' },
    fund_down_bench_down: { label: 'Both went down', full: 'Days the fund fell and the market fell' },
  },

  columns: {
    '12mo': { short: '12 mo', full: 'the past twelve months' },
    '6mo': { short: '6 mo', full: 'the past six months' },
    '13wk': { short: '13 wk', full: 'the past thirteen weeks' },
  },

  hero: {
    heading: 'At a glance: {window}',
    growth: { label: '$100 became', sub: 'In the market: {market}' },
    real: {
      label: 'In today’s money',
      subAdviser: 'After a 1% adviser’s fee and {inflation}% inflation. The market: {market}',
      subPlain: 'After {inflation}% inflation, with no adviser’s fee. The market: {market}',
    },
    up: { label: 'Upside capture', sub: 'Gained for every 1% the market gained' },
    buffer: { label: 'Loss buffer', sub: 'Of every 1% the market lost, the part this fund did not lose' },
    fit: { label: 'In line with the market', sub: 'Share of daily movement matching {benchmark}' },
    lowFit: '{benchmark} explains too little of this fund’s movement for this figure to describe it.',
    none: 'Not enough history yet.',
  },

  sections: {
    figures: {
      heading: 'The figures',
      caption: 'Three stretches of time, each ending at this report’s month-end close.',
    },
    trend: { caption: 'Upside capture and loss buffer now, against earlier monthly reports.' },
    real: { caption: 'The same $100, after an adviser’s fee and inflation, beside Treasury bills.' },
    notes: { heading: 'Notes on these figures', changes: 'What would change these figures' },
  },

  explainSummary: 'How to read this',

  real: {
    heading: 'After an adviser’s fee and inflation',
    intro:
      'What the same $100 was worth at the end of each period in money of {month}, once rising prices are allowed for. Treasury bills show what lending the money to the US government three months at a time would have paid over the same period.',
    adviserToggle: 'Take off a 1% yearly adviser’s fee',
    adviserOn:
      'An adviser’s fee of 1% a year is taken off the fund, the market and the bills alike, because an adviser charges on whatever they hold for you.',
    adviserOff: 'No adviser’s fee is taken off. Someone who buys the fund for themselves pays none.',
    rows: {
      fund: { label: '$100 in this fund', full: 'What $100 in this fund was worth at the end, in money of the last month' },
      market: { label: '$100 in the market', full: 'What $100 in the market was worth at the end, in money of the last month' },
      bills: { label: '$100 in Treasury bills', full: 'What $100 in three-month Treasury bills was worth at the end, in money of the last month' },
      prices: { label: 'Inflation', full: 'Inflation: how much consumer prices rose over the period' },
    },
    costs:
      'This fund’s own costs, {total}% a year, are already inside every figure on this page: they come out of its price day by day.',
    costsWrapper:
      'This fund’s own costs, {total}% a year, are already inside every figure on this page: {manager}% to its manager and {acquired}% to the funds it holds, taken out of its price day by day.',
    costsOver: 'Over {window} they came to about ${dollars} of every $100.',
    costsWaiver: 'Its manager is currently forgoing {waiver}% of a {gross}% charge.',
    costsMarket: '{benchmark} costs {total}% a year, which is likewise already inside its figures.',
    costsMissing: 'This fund’s cost table could not be read for this month, so its costs are not shown.',
    provisional:
      'Consumer prices for {month} are not published yet, so {used} stands in until they are, and this figure moves a little when they arrive.',
    estimated:
      'Consumer prices were not collected for {month}, so a figure halfway between the months either side stands in.',
    billsProvisional:
      'Bill rates are not yet published up to the end of this period, so the last published rate stands in for the days after it.',
    legend:
      'A dotted underline in this table marks a figure that rests on a stand-in for consumer prices or bill rates. What stands in is in its tooltip.',
    dash:
      'A dash means the fund has no figure for that period, or the published price and bill-rate figures do not reach back that far. The reason is in its tooltip. It does not mean nought.',
    unavailable:
      'The consumer price and bill-rate figures could not be read, so this section is not shown. The figures above are unaffected.',
  },

  trend: {
    window: 'Measured over',
    columns: {
      now: 'Now',
      fromMonth: 'Since {month}',
      three: 'Three months back',
      six: 'Six months back',
    },
    upRow: { label: 'Upside capture', full: 'Share of the market’s rise carried, across every day the market rose' },
    downRow: { label: 'Loss buffer', full: 'How much of each 1% the market lost did not show up in this fund, across every day the market fell' },
    marketRow: { label: '$100 in the market', full: 'What $100 in the market became over the same length of time' },
    was: 'was {value}',
    then: '{value} then',
    higher: 'Higher',
    lower: 'Lower',
    same: 'About the same',
    lowFit:
      'Over {window}, {share}% of this fund’s daily movement lined up with {benchmark}. That is too little for these figures to describe the fund, so they are not shown.',
    smallBase:
      'The earlier figure was so close to nothing that a percentage would mostly be a small number divided by a smaller one, so the change is shown as a plain difference.',
    signChanged:
      'The figure went from one side of nought to the other, which a percentage cannot describe, so the change is shown as a plain difference.',
    overlap: {
      '13wk':
        'From one month to the next, these thirteen-week periods share about two thirds of their days, so a month’s change is about one month coming in and one going out. Three months back they sit end to end and share none.',
      '6mo':
        'From one month to the next, these six-month periods share about five sixths of their days, so a month’s change is about one month coming in and one going out. Three months back they share about half, and six months back none.',
      '12mo':
        'From one month to the next, these twelve-month periods share about eleven twelfths of their days, so a month’s change is about one month coming in and one going out. Three months back they share about three quarters, and six months back about half.',
    },
    bands:
      '“About the same” means within {three} of the figure three months back, or {six} of the figure six months back. Gaps that small turned up routinely when the same days were dealt out at random. Beyond that a gap is more likely to be real, but some of them are still chance.',
    dash:
      'A dash means there is no figure to read for that month, and the reason is in its tooltip. It does not mean nought.',
    runSummary: 'Month by month',
    runIntro: 'The same figures at each of the last six monthly reports, with the percentage change from the report before.',
    runColumns: {
      month: 'Report',
      up: 'Upside capture',
      down: 'Loss buffer',
      change: 'Change',
      market: '$100 in the market',
    },
  },

  observer: {
    download: 'Download the folder',
    read: 'Read its first file',
  },

  history: {
    sixMonth: 'Against six months ago',
    thirteenWeek: 'Against thirteen weeks ago',
    columns: { then: 'Before', now: 'Since', change: 'Change' },
    disjoint:
      'The two periods sit end to end and share no days, so this is a comparison of one stretch of time against the one before it — not the same days counted twice.',
    steady:
      'The market itself was different across the two periods, so a change in the money figures is often the market and not the fund. The per-1% rows are the place to look for a change in the fund.',
    unavailable:
      'A dash means one of the two periods had too few days of that kind to work a reading out from, so there is nothing to compare. It does not mean the reading was nought.',
  },

  legend: {
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
