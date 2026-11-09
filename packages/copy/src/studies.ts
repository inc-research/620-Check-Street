// SPDX-License-Identifier: MIT
//
// Selected reports (3F D-25). Every sentence the Gain Exposure page shows, so the
// lint walks it like the rest of the deck (INV-7). Figures go in through
// {placeholders}; the view fills them and never writes a sentence of its own.

/** The front page’s list of selected reports. */
export const SELECTED = {
  heading: 'Selected reports',
  caption: 'One-off studies across the funds, each dated and fixed as of the day it was published. The fund pages below are updated every month.',
} as const;

export const STUDY_LABELS = {
  groups: {
    equity_sleeve: 'Equity sleeve with a hedge',
    synthetic_long: 'Synthetic long',
    reference_only: 'Not options-based, shown for reference',
  },
  subgroups: {
    direct_stocks: 'Stocks held directly',
    index_etf_sleeve: 'Stocks held through an index ETF',
    direct_flex: 'Held directly',
    ladder_of_synthetic_long_rungs: 'Ladder of funds',
    reference_only: 'Reference',
  },
  /** In the bands table, where the group row above names the group. */
  bandRows: {
    'group:equity_sleeve': 'Equity sleeve, all',
    'subgroup:direct_stocks': '· stocks held directly',
    'subgroup:index_etf_sleeve': '· stocks held through an index ETF',
    'group:synthetic_long': 'Synthetic long, all',
    'subgroup:direct_flex': '· held directly',
    'subgroup:ladder_of_synthetic_long_rungs': '· ladder of funds',
  },
  settled: { above_1: 'Above 1', below_1: 'Below 1', not_settled: 'Not settled' },
  /** Kinds of holding in an N-PORT filing, as the grouping table names them. Anything else is “other”. */
  blocks: {
    stocks: 'stocks',
    funds: 'other funds',
    purchased_call: 'calls bought',
    purchased_put: 'puts bought',
    written_call: 'calls written',
    written_put: 'puts written',
    cash_bills: 'cash and bills',
    other: 'other',
  },
} as const;

export const GAIN_EXPOSURE = {
  card: {
    kicker: 'Selected report',
    title: 'Gain Exposure: With a Special Focus on November 4th and 5th, 2026',
    blurb:
      'How much of the market’s rises and falls thirty Options-Integrated ETFs carried this year, synthetic longs beside equity sleeves, and what the largest fall of the year did to each.',
    open: 'Read the report',
  },

  kicker: 'Selected report · published {published}',
  standfirst:
    'How much of the market’s rises each fund kept, and how much of its falls each fund avoided, from 2 January to 3 November 2026, and then on two unusual days: Wednesday 4 November, when the market rose, and Thursday 5 November, when it fell harder than on any other day this year.',
  back: 'Back to the list of funds',

  hero: {
    heading: 'Five figures from the study, each against the fund’s own benchmark',
    fall: { label: '5 November', sub: 'VOO’s fall, the largest of its {days} trading days this year. QQQ fell {qqq}.' },
    direct: {
      label: 'Median Gain Exposure, stocks held directly',
      sub: '{n} funds. Rises kept plus falls avoided came to less than 1 for {below} of them.',
    },
    syn: { label: 'Median Gain Exposure, synthetic long', sub: '{n} funds. Below 1 beyond the noise for {settled}.' },
    index: {
      label: 'Median Gain Exposure, stocks held through an index ETF',
      sub: '{n} funds, from quarterly ladders keeping {max} of the rises to Max Buffer funds keeping {min}.',
    },
    giveBack: {
      label: 'Median Gain Exposure on 5 Nov, synthetic long',
      sub: 'The share of its summed rises the middle synthetic long gave back that day, over the market’s share. Equity sleeve {eq}.',
    },
  },

  basis: {
    label: 'Measure each fund against',
    named: 'its own benchmark',
    voo: 'VOO, for every fund',
    caption:
      'Applies to every chart and table below except the two group panels, which are always against VOO so that the market drawn behind the funds is one market.',
  },

  k: {
    title: 'The Exposure K',
    caption: 'The upper leg adds up every day the market rose. The lower leg adds up every day it fell.',
    fund: 'Fund',
    key: {
      marketUp: 'Market’s rises, added up',
      fundUp: 'What the fund did on those days',
      marketDown: 'Market’s falls, added up',
      fundDown: 'What the fund did on those days',
    },
    aria: 'K chart for {ticker} against {bench}',
    marker: '4–5 Nov',
    labels: { benchUp: '{bench} rises {value}', fundUp: '{ticker} rises {value}', fundDown: '{ticker} falls {value}', benchDown: '{bench} falls {value}' },
    lead:
      '{ticker}, {name}. From {first} to 3 November, on the {upDays} days {bench} rose, {ticker} kept {u} of the rise. On the {downDays} days it fell, {ticker} avoided {b} of the fall. Gain Exposure E = {taken} ÷ {u} = {E}. {range} {bench}’s rises outweighed its falls {gl} to 1, {versus} E, so {ticker}’s days added up to {net} against {bench}’s {bnet}.',
    rangeOpen: 'The range runs {lo} to {hi}, so the direction is not settled.',
    rangeAbove: 'The range runs {lo} to {hi}, above 1 throughout.',
    rangeBelow: 'The range runs {lo} to {hi}, below 1 throughout.',
    noE: '{ticker}, {name}. It kept none of the market’s rises this year, so its Gain Exposure has no meaning.',
    moreThan: 'more than',
    lessThan: 'less than',
    special:
      '4 November: {bench} {m4}, {ticker} {f4}, keeping {kept} against {u} over the year. 5 November: {bench} {m5}, {rank}. {ticker} {f5}, a buffer of {avoided} against {b} over the year. That one day took back {gbf} of {ticker}’s summed rises and {gbm} of {bench}’s, {ratio} times the market’s share: 5 November’s E.',
    rankFirst: 'its largest move of the year',
    rankNth: 'its {nth} largest move of the year',
    tip: {
      day: '{date}',
      special: '{date} · special day',
      benchUp: '{bench} rises {value}',
      fundUp: '{ticker} kept {value} · {share}',
      benchDown: '{bench} falls {value}',
      fundDown: '{ticker} took {value} · buffer {share}',
    },
    explain: [
      'Read it like the letter K. The upright on the left is 1 January. The leg that climbs to the right adds up the market’s daily rises, one rising day after another. The leg that falls to the right adds up its daily falls. The pale fill is the market. The bold line inside it is the fund, on the same days.',
      'Where the fund line sits close to the edge of the fill, the fund moved almost as much as the market. Where it sits close to the middle, it moved much less. On the upper leg, how far up the fund line ends, as a share of the fill, is the share of the rises it kept. On the lower leg, the gap between the fund line and the bottom of the fill is the share of the falls it avoided, which this site calls the loss buffer.',
      'These are sums of daily price moves, not what an amount invested grew to. Compounding a year of rising days alone would carry the market far above where it actually ended, and it would bend the two legs differently for a fund that carries only part of each move. Sums keep the two legs comparable. What an investor’s money actually did is the two legs taken together, day by day, and the fund’s own report on this site shows that.',
      'The last step on each leg, past the dotted line, is a special day: 4 November on the upper leg and 5 November on the lower.',
    ],
  },

  exposure: {
    title: 'Gain Exposure',
    caption:
      'When a fund keeps less of the rises than it avoids of the falls, its gains are more exposed to losses than the market’s.',
    intro:
      'Gain Exposure, written E, answers one question: for each part of the market’s gains a fund holds on to, how much of the market’s losses does it take? The market itself scores exactly 1. A fund below 1 took less loss for each unit of gain it kept than the market did. A fund above 1 took more.',
    parts:
      'Two figures go into it. U is the upside capture, the share of the market’s rises the fund kept. B is the loss buffer, the share of the market’s falls the fund avoided, so the fund took 1 − B of the falls. Gain Exposure divides the falls taken by the rises kept:',
    formula: 'Gain Exposure  E = (1 − B) ÷ U        the market itself reads exactly 1',
    example:
      'E is above 1 exactly when U + B is below 1. For example, a fund that keeps 0.65 of the rises and avoids 0.24 of the falls has E = 0.76 ÷ 0.65 = 1.17. Its gains are 17% more exposed to the market’s falls than the market’s own gains are. A fund’s summed result stays above zero only while the market’s rises outweigh its falls by more than E. This year VOO’s rises outweighed its falls by {gl} to 1.',
    upb:
      'Across the {n} Options-Integrated ETFs (OI-ETFs), U + B runs only from {lo} to {hi}. They trade rises for falls almost one for one. What separates them is mostly where they sit on that trade, and E measures the small gap left over.',
    nov5:
      '5 November’s E puts that one day’s fall in place of the year’s falls: the share of the fall the fund took, over the share of the year’s rises it kept. It is the same number as the give-back: the share of its summed rises the fund lost that day, over the share the market lost.',
    key: {
      syn: 'Synthetic long',
      eq: 'Equity sleeve',
      range: '95% range, the year',
      day5: '5 November’s E',
      one: 'E = 1, the market',
    },
    toggle: 'Show 5 November’s E',
    aria: 'Gain Exposure for each fund with its 95% range',
    less: '← less exposed than the market',
    more: 'more exposed →',
    tip: {
      head: '{ticker} · {held}, against {bench}',
      shares: 'kept {u} of rises · avoided {b} of falls',
      e: 'E {E}, range {range}',
      day: '5 Nov: avoided {avoided} · E {E5}',
    },
    explain: [
      'One row per fund. The filled mark is E over the year to 3 November, and the bar through it is its 95% range. Left of the dashed line, the fund’s gains were less exposed to the market’s falls than the market’s own gains. Right of it, more. A bar that crosses the line means the year’s data cannot say which side the fund is on.',
      'The open orange ring is 5 November’s E. It is one day and estimates nothing. Where it sits right of the filled mark, the fund gave up more on that day, against what it had kept all year, than its year-long habit would suggest.',
    ],
    table: {
      fund: 'Fund', held: 'Held', against: 'Against', u: 'U', b: 'B', upb: 'U + B', e: 'E', range: '95% range', vs: 'E vs 1',
    },
    indexNote:
      'Stocks held through an index ETF covers a wide range of designs: {list} of the rises. The quarterly ladders sit near the funds holding stocks directly, and the Max Buffer funds give up most of the rises for a deep buffer. Each fund’s own literature describes its design.',
    indexItem: '{ticker} keeps {u}',
    flagNote: '* {ticker}: {flag}',
    days: {
      title: '4 and 5 November, against each fund’s year',
      caption:
        'Each special day beside the year-to-date figure it compares with: what the fund kept on 4 November against its U, what it avoided on 5 November against its B, and 5 November’s E against the year’s.',
      kept: 'Rises kept', avoided: 'Falls avoided', exposure: 'Gain Exposure',
      nov4: '4 Nov', uYear: 'U, year', nov5: '5 Nov', bYear: 'B, year', e5: '5 Nov E', eYear: 'E, year',
    },
    noise: {
      summary: 'What “beyond the noise” means here',
      body:
        'Daily fund returns bounce: a fund that lags on Monday often catches up on Tuesday. So the range is built by resampling whole weeks, not single days, 4,000 times, and keeping the middle 95% of the E values that come out. Where that range includes 1, the table says the direction is not settled. An earlier survey of this archive found that the gap between up and down capture often does not hold up as a fact about a fund. That is why each E carries its range.',
    },
  },

  groups: {
    title: 'The two groups, side by side',
    voo:
      'Both panels measure every fund against VOO, not against its own benchmark. That puts the two groups in front of the same market, so any difference between them belongs to the funds and not to the yardstick. The pale fill is VOO in both panels.',
    caption: '{n} funds. Middle fund kept {u} of the rises and avoided {b} of the falls; E {E}.',
    aria: 'K chart, {group}, every fund against VOO',
    tip: { head: '{ticker} · {held}', kept: 'kept {u} of VOO’s rises', avoided: 'avoided {b} of its falls', e: 'E {E}' },
    hover: 'Hover a line to name the fund. LADM began trading on 26 June, so its legs start late.',
  },

  bands: {
    title: 'Big days and ordinary days',
    caption: 'This year’s market days split by the size of the move, then the two special days on their own.',
    refresh:
      'As before, U is the upside capture, the share of the market’s rises a fund kept, and B is the loss buffer, the share of its falls the fund avoided.',
    edges:
      'For VOO, small days moved less than {t1} either way, large days more than {t2}, and the top tenth more than {d9}. 4 November ({m4}) falls in the top tenth, and 5 November ({m5}) is beyond every day before it. Each figure is the middle fund of its group.',
    finding:
      'In both groups the share of rises kept hardly changes with the size of the move, while the share of falls avoided shrinks as the falls get larger: for the synthetic longs from {synSmall} on small days to {synLarge} on large ones, for the equity sleeves from {eqSmall} to {eqLarge}.',
    lessAgain: 'On 5 November both groups avoided less again: {syn} and {eq}.',
    nov5: 'On 5 November the groups avoided {syn} and {eq}.',
    head: {
      group: 'Group', n: 'n', against: 'Against', small: 'Small days', medium: 'Medium', large: 'Large', top: 'Top tenth',
      nov4: '4 Nov', nov5: '5 Nov', u: 'U', b: 'B',
    },
    explain: [
      'Every trading day from 2 January to 3 November is put in one of three equal-sized groups by how far the benchmark moved, whichever way. The top tenth of days is shown again on its own. In each group, U is the share of the rises kept and B the share of the falls avoided, worked out exactly as on the rest of the page. Each figure is the middle fund of its group. The last two columns are single days: what the fund kept on 4 November, and what it avoided on 5 November.',
      'The question is whether funds behave differently when the market moves a lot. Read across a row. If the large-day and top-tenth columns sit close to the small-day column, the fund’s share of each move did not depend on the size of the move.',
    ],
    every: 'Every fund, by size of move',
  },

  limits: {
    title: 'Limits',
    items: [
      'Market prices with distributions reinvested, from yfinance, the same source and basis as the rest of the site. Fund costs are already inside every return and are not taken off again. Taxes are not counted.',
      'The groups come from each fund’s latest public SEC holdings report, which is as of 31 July or 31 August 2026. A fund’s structure can change between reports.',
      'Nearly every fund here works over a fixed outcome period with a cap and a floor that reset. Where a fund sat inside that period on 5 November shapes what it did that day as much as its design does.',
      'A fund’s Gain Exposure moves from one quarter to the next. Read each fund’s figure here as this year’s reading, not a fixed trait.',
      'Two days are two observations. They describe what happened, and they estimate nothing.',
      'Sums of daily price moves, not compounded growth, on every leg. They are not the value of an amount invested.',
      'Funds are set side by side to compare two designs. Rows are ordered by group, and the order is not a ranking.',
      'Past periods only. Nothing here says what any fund does next.',
    ],
  },

  quad: {
    summary: 'Days the fund and the market moved the same way',
    body:
      'The same two shares, counting only days when the fund moved the same way as the market. This drops the days a fund went the other way, so it mostly measures how large the fund’s moves were. It is a second way of looking at the same days and does not confirm the figures above.',
    head: {
      fund: 'Fund', against: 'Against', uAll: 'U, all rising days', uBoth: 'U, both rose', days: 'days',
      bAll: 'B, all falling days', bBoth: 'B, both fell',
    },
  },

  grouping: {
    summary: 'How each fund was grouped',
    body:
      'From each fund’s latest public N-PORT holdings report at the SEC, the fund’s value is added up by kind of holding. The group comes from the largest kind, not the largest single line: an equity sleeve’s largest line is one stock. Where the largest kind is other funds, one of those funds is looked through. Every grouping was checked by hand on {approved}.',
    head: { fund: 'Fund', held: 'Held', report: 'Report', kinds: 'Largest kinds of holding', look: 'Looked through' },
  },

  footer:
    'Prices fetched {fetched}. Holdings from SEC N-PORT. Published {published}. The figures are fixed as of that date and are not updated monthly.',

  notFound: {
    message: 'There is no selected report called {id}.',
    remedy: 'Go back to the list of funds, where every selected report is listed.',
  },
} as const;
