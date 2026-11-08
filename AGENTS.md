# AGENTS.md — Third Floor (consolidated build spec)

## Project overview

**Third Floor** is a semibeta analysis tool focused on a specific, emerging
corner of the ETF market: **Options-Integrated (OI) funds** — ETFs that use
options contracts (synthetic longs, equity sleeves, FLEX options, buffers,
floors, hedged overlays) to reshape their exposure to an underlying
benchmark. It is the third app in a family (predecessors: **First Floor**,
**Second Floor**; a sibling app in this same family evaluates the options
collar on OI funds from user-uploaded daily holdings files and stores no
ticker data itself — Third Floor is complementary, not overlapping).

**Governing philosophy**: OI funds represent a real step-change in the
complexity of instrumentation available through ETFs, and the average
passive investor has no tools to check the claims these funds make about
themselves. Third Floor runs rigorous, asymmetric risk math on a schedule
the app's architect controls, and presents only what a non-quant investor
needs to act on. It is a **descriptive reporting tool**, not a research
instrument — see "Scope boundary" below, a hard line, not a style
preference. It is also, deliberately, a tool that checks a fund's own
marketing and prospectus language against what its actual behavior
suggests — see "Benchmark model" below, which exists specifically to
surface gaps between the two.

## Architecture

Computation and serving are split into two components:

1. **A Python notebook, run manually in Google Colab**, on a monthly
   cadence, by the app's owner. It fetches price data, computes semibeta
   vectors for the fixed 31-ticker OI coverage set, and produces dated
   JSON snapshots.
2. **A static site, served via GitHub Pages**, with no server-side runtime
   and no live computation. It reads whatever JSON already exists in the
   repo and renders it. It never fetches price data itself.

This split exists because a browser cannot fetch price data cross-origin —
CORS is a browser-only restriction; a Python process making an HTTP
request is not subject to it. Monthly cadence matches the actual use case:
this app serves buy-and-hold investors doing periodic checks on
increasingly complex instruments, not people trading on intraday signals.

**End-to-end workflow, once running:**

```
Colab notebook (manual, monthly)
  → fetches raw daily prices for all 31 tracked tickers + benchmark anchors
    (VOO, QQQ, IWM — one bulk pull per instrument, shared across all funds
    that reference it)
  → computes the horizon table for each fund against (a) the universal
    VOO anchor and (b) its own named benchmark, where one exists
  → backfills historical snapshots as needed (see "Backfill" below)
  → packages everything into one zip, one-click download
  → owner unzips into the repo's /data structure, commits, pushes
  → GitHub Pages serves the updated static site
```

## Data fetch

**Settled by 3F D-06, against what this section originally specified.**
The original plan was a plain CSV pull (`pandas.read_csv()` against
Stooq), with `yfinance` kept as a documented fallback only — the
reasoning being that `yfinance` scrapes an endpoint requiring a
cookie/crumb handshake and breaks whenever Yahoo changes its site.

That reasoning has not stopped being true. It was simply outweighed:
checked 2026-08-23, Stooq's CSV endpoint serves a JavaScript
proof-of-work browser challenge rather than CSV, with and without a
browser User-Agent and with and without a date range, so
`pandas.read_csv()` against it yields no usable data at all. On the same
day `yfinance` returned full history for all 35 instruments, and is the
only candidate source that hands back a dividend-adjusted close (which
3F D-08 needs).

So the ladder is **yfinance, then Stooq, then the Yahoo chart JSON** —
first to clear the guard wins, and the winner is recorded per ticker in
every snapshot and in the run manifest. Stooq stays in the ladder so
this self-heals if it drops the challenge.

What makes the order safe is the guard rather than the ranking. Every
source must clear it before its data is used: not HTML, expected columns
present, plausible row count, dates sorted and unique, every price
positive and finite. A challenge page, a rate-limit page and an error
page all arrive as HTTP 200, and any of them parsed loosely looks like a
fund with very little history. The guard raises and falls through; it
never returns a short or empty series.

**Why Colab, not a browser:** a Python process fetching data is not
subject to CORS at all — this is the actual reason a client-side GitHub
Pages fetch design was a dead end, and why moving computation into a
notebook resolves the problem rather than working around it.

**On request-volume risk:** what protects this workflow from being
blocked is *request volume and burst rate*, not simply "manual vs.
automated." With EFA added as a fourth anchor (3F D-01) the run makes
**exactly 35 pulls** — 31 tracked tickers plus 4 anchors — and throttles
between them. Backfilling adds none: one bulk pull per instrument is
sliced in memory at every snapshot date. This is a hard ceiling worth
respecting deliberately: don't scale the tracked universe up materially
without re-examining this.

Fees and rates go to other hosts and leave that count unchanged. SEC EDGAR gets a
feed and one or two filings per instrument each month, throttled under its
fair-access limit, and identifies itself with a project contact, never a person's
address. FRED gets two requests. The FRED key comes from Colab secrets or
`FRED_API_KEY` and is never committed.

## Benchmark model — universal anchor + fund-specific named benchmark

Every tracked fund gets computed against **VOO**, a universal anchor,
always — this is what keeps Lens C (cross-fund comparison, below) usable
across the whole coverage set regardless of what each individual fund
actually claims to track.

**In addition**, each fund gets computed against its own **named
benchmark** — whichever instrument its own prospectus or marketing
literature points to — when that benchmark is one Third Floor tracks
(currently VOO, QQQ, IWM). This is the higher-fidelity comparison: it
answers "does this fund actually behave the way its own literature claims
it should," which is the app's core value proposition for OI funds
specifically.

**`benchmark_source` is recorded per ticker, not assumed uniform:**
- `prospectus_index` — the fund's legal/regulatory reference document
  names this benchmark directly.
- `marketing_language` — the fund's own marketing materials reference this
  benchmark for illustrative comparison, even if the prospectus specifies
  a different underlying index. (Example: RFLR's prospectus references the
  Solactive United States 2000 Index, but Innovator's own launch materials
  describe it in Russell 2000 terms — IWM is used as the practical
  benchmark, with `benchmark_source: "marketing_language"` recorded so the
  site can show *how* confident the match is, not just what it is.)
- `default_no_named_benchmark` — no benchmark identified in either source;
  computed against VOO only.

**Closed by 3F D-01.** Three tracked funds (HOLA, BUFY, BUFI) explicitly
name MSCI EAFE as their reference, which was outside the original anchor
set (VOO/QQQ/IWM). These were never default cases — they do name a
benchmark, it simply was not fetched. **EFA is now a fourth anchor**, and
all three carry `named_benchmark: "EFA"`. The registry note records that
EFA is a fee-bearing proxy for the index rather than the index its
prospectus names.

## Coverage model — locked at 31 tickers, OI-focused

Third Floor's coverage set is **fixed, not organically grown** — a
deliberate pivot from earlier "grow one request at a time" design toward
a curated, verified set targeting the Options-Integrated ETF sector
specifically. Target was 40-50; 31 individually-verified tickers were
confirmed and the set was locked there rather than padding toward the
target with unverified additions.

**Verification methodology used to build this set:**
- Every ticker's issuer, structure, and (where possible) named benchmark
  was checked against real sources before inclusion — no ticker was added
  on the strength of a plausible-sounding name.
- **Wrapper-over-rungs heuristic**: several issuers (Innovator, First
  Trust, Calamos, Pacer Swan) sell the same underlying strategy as many
  monthly-dated single-ticker "rungs" (e.g. twelve separate January-
  through-December buffer ETFs) alongside a laddered "fund-of-funds"
  wrapper that holds a basket of those rungs. Third Floor tracks the
  wrapper, not each individual rung — the wrapper is the actual
  investable instrument, and the rungs mostly just measure reset-timing
  offsets of the same strategy against each other. This single heuristic
  is what kept a set that could plausibly have been 100+ tickers down to
  a tractable, meaningfully distinct 31.
- Some issuers (Allianz's ~49-fund lineup, specifically) have no wrapper
  vehicle collapsing them into one ticker. Rather than pick an arbitrary
  representative fund, Allianz was **excluded entirely** from this locked
  set. Revisit only with a deliberate, defensible selection method, not by
  picking one fund informally.

**Category field, not a single undifferentiated list:** the coverage set
includes one ticker (**DBMF**) that isn't options-based at all — it's a
managed-futures/CTA-replication strategy trading futures across asset
classes. It's tagged `category: "managed_futures"`, distinct from
`category: "options_integrated"` for the other 30, so the site and any
future analysis can tell the two mechanisms apart rather than treating
"OI" as a label that no longer means what it says. DBMF's own factsheet
explicitly states it is not managed against any benchmark; Bloomberg US
Aggregate appears only as one of two illustrative comparison lines in its
materials (alongside an SG CTA index), not a declared reference — recorded
accordingly with `named_benchmark: null`.

**Ticker registry — the permanent source of truth**, separate from any
future request/expansion queue. Kept separate deliberately: a request
queue is transient (review once, then accept or reject), while the
registry is what the notebook reads every single monthly run, for the
life of the project. See `tickers.json` for the full, locked list —
ticker, issuer, category, named benchmark, benchmark source, and the
options-caveat flag.

**Methodology note carried by nearly this entire coverage set:** the vast
majority of these 31 tickers are options-based, capped/buffered "defined
outcome" products (FLEX options, fixed caps, periodic resets). Their
relationship to a benchmark is deliberately nonlinear and path-dependent —
behavior can swing sharply depending on where price sits relative to that
period's cap or floor at any given moment, which is different from a
genuine change in the fund's underlying risk profile. The report should
carry this caveat prominently for any ticker with `defined_outcome_caveat:
true` in the registry (which is nearly all of them) — its semibeta reading
reflects "where we are in this fund's current outcome period" as much as
"how this fund behaves relative to the market."

**Untracked-ticker search behavior (still open):** what the site shows if
a user searches a ticker outside this locked 31 is not yet decided — a
plain "not tracked" state is a reasonable default, but confirm the wording
before building it.

## Backfill

The notebook backfills **any requested depth**, parameterized rather than
hardcoded — every tracked ticker gets the same retroactive history depth
regardless of when it was added to the registry.

**Cost:** not a meaningful computational burden. The network fetch is the
expensive part of this pipeline; backfilling adds zero additional fetch
calls — one bulk historical pull per ticker (and per benchmark anchor),
sized to cover every snapshot's window, then sliced in memory at each
snapshot date. A regression over a few hundred rows of daily returns is
microseconds of CPU time regardless of how many snapshots are sliced from
it.

```python
def build_ticker_history(ticker, snapshot_count=7):
    fetch_months = snapshot_count + 12  # N monthly snapshots + one full 12mo
                                          # horizon behind the oldest snapshot
    raw = fetch_daily_prices(ticker, months_back=fetch_months)
    snapshot_dates = monthly_dates(end=today, count=snapshot_count)

    schemas = {}
    for as_of in snapshot_dates:
        window = raw[raw.index <= as_of]
        schemas[as_of] = compute_horizon_table(window, as_of)
    return schemas
```

**Graceful degradation for young funds:** if a ticker's actual inception
date is more recent than the requested backfill depth,
`compute_horizon_table` produces whatever the available data
genuinely supports and skips — never fabricates — earlier snapshot dates.
A window the fund's history does not reach back to is **blocked with a
remedy**, never computed over a shortened period: a reading built from
four months of data and labelled "12 months" is a different statistic
wearing the same name. See 3F D-09, and the `earliest_full_baseline_snapshot`
field it forced into the coverage block.

**Inception dates, corrected against the source on 2026-08-23.** This
section previously named HEQQ, HOLA and HELO as 2023 launches and QFLR,
FHDG, DHDG and SQMX as 2024. Three of those were wrong:

| Ticker | previously stated | actual first trading day |
|---|---|---|
| HEQQ | 2023 | **2025-03-27** |
| HOLA | 2023 | **2025-07-14** |
| SQMX | 2024 | **2025-01-10** |

The coverage set is substantially younger than this document assumed.
Over 19 snapshots only 14 of 31 tickers support a 12-month baseline at
every one of them, and **LADM** (first traded 2026-06-26) supports none
at any of them.

**Coverage flag, recorded per ticker (not per snapshot):**

```json
"coverage": {
  "inception": "2026-06-26",
  "earliest_available_snapshot": "2026-07",
  "earliest_full_baseline_snapshot": null,
  "requested_backfill_depth_months": 19,
  "history_limited_by_inception": true
}
```

The site's rule: if a historical-comparison target date falls before
`earliest_available_snapshot`, show **"Check Fund is too new for
historical analysis"** and stop — no attempt to render anything for that
comparison.

`earliest_full_baseline_snapshot` was added by 3F D-09 and is not
interchangeable with the field above it. Because a snapshot is written
whenever *any* horizon is computable, a file can exist whose 12-month row
is blocked — and the shift marker, defined as distance from that row,
then has nothing to measure from. `null` means no snapshot for that fund
has a baseline at all. LADM is exactly this case.

## Storage convention — the archive doubles as the historical record

One directory per ticker, one file per monthly snapshot, zero-padded
`YYYY-MM` naming (not month names — they don't sort in calendar order):

```
/data/<TICKER>/2026-02.json
/data/<TICKER>/2026-05.json
/data/<TICKER>/2026-08.json
```

Because every monthly run is committed to git under a dated filename, the
archive of past reports already exists the moment the files are
committed — no user-supplied file needed for historical comparison; the
static site fetches an older snapshot directly from the repo's own file
history.

**A second archive sits beside it (3F D-18).** `/data/_reports/<TICKER>/<YYYY-MM>.json`
holds what the page leads with: growth, net capture, worst fall, fit. Those need
full-window returns, which a snapshot does not store, and a committed snapshot is
not rewritten. Same months, one for one, also append-only. The snapshot archive
goes on being written and is what the semibeta detail section reads.

**Costs and rates (3F D-22, D-23).** `/data/_fees/<TICKER>/<YYYY-MM>.json` holds the
fee table in force for each report month, for every fund and every anchor its
report reads. It is append-only and read from the prospectus XBRL the SEC holds.
These costs are already inside every return, so they are disclosed and never
subtracted. `/data/_rates/CPIAUCNS.json` and `DGS3MO.json` are whole FRED series:
a run may add observations but never change one. The page works out "after an
adviser's fee and inflation" from these when it loads, so a stand-in for this
month's consumer prices gives way by itself once they are published.

## Three lenses — keep these distinct

**Lens A — within one snapshot, across trailing-window lengths.** The
horizon table (12 mo / 6 mo / 13 wk), all computed as of the *same*
current date. Answers "does this fund's recent behavior look different
from its own longer-run baseline, right now."

**Lens B — across actual archived snapshots, at one comparable reading.**
Current snapshot vs. the archived snapshot closest to 6 months ago, and
vs. the one closest to 13 weeks ago — real past instances of the report,
not different window lengths at one point in time. Sourced entirely from
files already in `/data`.

**Settled by 3F D-13, against this section's own guess.** The column is
**matched to the lookback**, not fixed at the 12-month baseline: the
six-month lookback reads the `6mo` column on both sides, the thirteen-week
lookback reads `13wk`. The two windows are then exactly adjacent and share
no days — the six months to July against the six months before those.

Fixing the column at `12mo` was the guess here, on robustness grounds. It
would have compared windows overlapping by half at a six-month lookback and
by three quarters at thirteen weeks, so most of the "change" would have
been the same days measured twice. Measured on the archive, that version's
thirteen-week comparison barely moved at all — a median change of 0.045
against 0.117 for the matched column.

The cost is real and accepted: matched columns lose cells, because the
shorter columns block more often. 33% of the six-month comparison's cells
and 43% of the thirteen-week one's are not comparable, against roughly 10%
had the baseline been used.

**Lens C — across two tracked funds, at the same reading.** Pick two
funds and see, per state per horizon, the delta between their scores —
answers "how differently do these two funds actually behave," useful for
comparing similar OI products directly against each other. Requires no
new computation, just a client-side subtraction between two already-
fetched snapshot files.

**Settled by 3F D-14, against this section's own shape.** The table is not a
grid of differences. It shows the first fund's reading, the second fund's
reading and the difference, over one window length at a time, with a chooser
for the other two.

Measured on the archive, a difference of +0.30 turns up with the higher fund
anywhere from +0.04 to +0.71. The same gap is one fund nearly keeping pace and
the other slightly behind, or one moving a little and the other not at all —
different findings, which the delta alone cannot separate. Losing the levels
would repeat the mistake the bounded score made (3F D-12).

Availability is the best of the three lenses: every one of the 435 possible
pairs can answer all three windows at their latest shared month, and 3.3% of
cells are not comparable, against Lens B's 33% and 43%. Both sides are read at
the same date over the same window, so only a genuinely empty quadrant blocks a
cell.

**Lenses A, B and C now read `data/_reports` (3F D-17).** Lens B draws no dot, and
Lens C draws one only on the two per-1% rows. The figures quoted above were
measured on the semibeta rows and are kept as the record of how those decisions
were reached.

**Two constraints Lens C must enforce, not just support:**
- **Same benchmark context on both sides.** With the universal VOO anchor
  now always present on every fund, Lens C should default to comparing
  funds on the VOO anchor (guaranteed present for all 31) rather than each
  fund's named benchmark (which varies, and for HOLA/BUFY/BUFI doesn't
  currently exist at all).
- **Same snapshot date on both sides**, for the initial build — combining
  Lens C with Lens B is a reasonable future extension, out of scope for
  v1.

## OBSERVER Folder (3F D-21)

`OBSERVER/` is generated by `scripts/build_observer.py` from `data/` and is never
edited by hand. Change the generator and rebuild. It holds one report date: 22
months of report sums and quadrant moments in the raw table, eight metrics, and
the five highest and five lowest funds on each against VOO in the top layer. A
monthly run rebuilds it, and `1.1_LOG.md` keeps the history. Any change to a
formula, a relative observation or the elevation rule needs a `**Contract**` entry
in that log. Target the kit and specification in the OBSERVER standard, not an
older copy of the skill.

## Calculation methodology

For a given trailing window, take paired daily returns of the Check Fund
(`r_fund`) and Benchmark (`r_bench`). Partition observation-days into four
sign quadrants, and compute a semicovariance-based beta within each
quadrant (quadrant covariance of `r_fund`/`r_bench`, normalized by
benchmark variance within that same quadrant):

| State (internal id) | Condition | Group |
|---|---|---|
| `fund_up_bench_up` | `r_fund > 0` and `r_bench > 0` | Participation |
| `fund_down_bench_down` | `r_fund < 0` and `r_bench < 0` | Participation |
| `fund_up_bench_down` | `r_fund > 0` and `r_bench < 0` | Resilience |
| `fund_down_bench_up` | `r_fund < 0` and `r_bench > 0` | Resilience |

**Horizons per snapshot:** `12mo`, `6mo`, `13wk`, all trailing from that
snapshot's as-of date, daily-return frequency.

A `4wk` horizon was specified and built, then **removed by 3F D-10** once the
first full archive run showed what it produced. Four weeks is about twenty
trading days; split across four sign quadrants that is a median of four days
each, against an observation floor of twenty — so zero of 2,672 cells in that
column were ever trustworthy. The three that remain span a year down to a
quarter, which is the range this reader can act on.

**Data sufficiency:** each horizon/state cell needs a minimum observation
count in its quadrant to be considered reliable; flag any cell below that
minimum as `thin`. Distinct from — and in addition to — the ticker-level
`history_limited_by_inception` flag. Across the three shipping columns the
flag discriminates: roughly a third of `12mo` cells are thin, half of
`13wk`. A column where it would have been on for every cell without
exception was removed instead of shipped (3F D-10).

**What the table prints — settled by 3F D-12.** The ratio itself, to two
decimals, signed. Read as: for every 1% the benchmark moved on days of this
kind, the fund moved this much. The bounded score below is retained in the
document and is not shown.

**Score normalization — settled by 3F D-04, superseded for display by 3F D-12.**
`clamp(floor(50 * raw_semibeta + 0.5), 0, 100)`. Moving one-for-one with
the benchmark shows as 50, twice as much as 100, not at all as 0. Linear
and plainly explainable, which matters more for this reader than never
clipping.

The decision that actually de-risks this: every cell stores its
`raw_semibeta` and both quadrant moments **alongside** the score, so the
transform can be changed and the whole archive regenerated with no
network call at all. `scripts/validate-snapshots.mjs` rechecks every
committed score against its own raw value, so the claim is tested rather
than asserted.

`floor(x + 0.5)` rather than a language `round()`: Python's is banker's
rounding and would disagree with JavaScript's `Math.round` on exact
halves, making the validator fail on scattered cells for no visible
reason.

**Data sufficiency — settled by 3F D-07.** `min_observations_per_cell` is
**20**. When that was set, the expected consequence was that "nearly the
entire `4wk` column" would carry the marker, and that was accepted as
disclosure. The first full run showed it was worse than that — *zero* 4wk
cells cleared the bar — and the answer was to remove the column rather
than lower the bar (3F D-10). A flag that is on for every cell in a column
distinguishes nothing.

> **Open decision — shift threshold (3F-O-01).** Whether the amber
> "shifted" marker should be statistically scaled to sample size rather
> than a flat constant, and whether it works consistently across all three
> lenses. Render-time and costless to defer: every snapshot already
> carries the raw semibeta and the observation counts either answer needs,
> and `methodology.shift_threshold` is `null` with a note saying so.

> **Open decision — a marker with no baseline (3F-O-02).** 3F D-09 lets a
> file exist whose `12mo` row is blocked, and the marker is defined as
> distance from that row. Decide what it does there. The data layer
> already hands the site `earliest_full_baseline_snapshot` so the case can
> be detected rather than rendered from nothing.

## Report table — UI spec

**Rebuilt by 3F D-17, and restyled as 620 Check Street by 3F D-24.** Read both
before changing any of this. Where the bullets below and 3F D-24 disagree, 3F D-24
wins: the site is titled 620 CHECK STREET, the page is white with Arsenal headings,
Newsreader body and JetBrains Mono figures, five headline cards lead each report,
every long explanation sits in a closed "How to read this", downside capture is
shown as the **loss buffer** (one minus it), and colour marks a section or the
direction of a change, never green or red.

- **Columns**, left to right: `12 mo`, `6 mo`, `13 wk` (3F D-10 removed `4 wk`).
- **Rows**, grouped under four headers:
  - **What happened to $100:** what it became in the fund and in the market, and
    each one's deepest fall from a high inside the window.
  - **An average day, per $100:** market and fund, across every day the market
    rose, and every day it fell.
  - **For every 1% the market moved:** net capture up and down.
  - **How closely it follows:** the share of daily movement in line with the
    benchmark, and how often the fund went the other way.
- **The sentence above the table** states net capture for the longest window that
  computed. It is summed, never compounded. Where R² is below 0.25 it is replaced
  by a sentence saying the benchmark explains too little to describe the fund, and
  the money rows stay.
- **Limits box:** market prices with distributions reinvested, costs and taxes,
  past periods, windows are not outcome periods, an average is not a ceiling.
- **Detail section, closed by default:** the two same-direction semibeta rows, as
  a second way of measuring those days. Never the per-1% claim, and never a claim
  that it confirms the capture figures.
- **Not on the page:** the opposite-direction rows, any up-minus-down figure, the
  bounded score, row tint.
- **Capture over time (3F D-20):** after the limits box, for one window at a time
  (`13 wk` by default, with a chooser): up and down capture now, the percentage
  change since last month's report beside the earlier level, and higher, lower or
  about the same against three and six months back, each with its level. The
  market's own result sits in the same table. A closed section gives the last six
  reports. Each side on its own: changes in the gap between them could not be told
  from noise. The percentage is over the earlier reading's size and is withheld
  below 0.10 or across a change of sign. Direction uses the per-window bands in
  `packages/core/src/captureTrend.ts`. No dot, no cause, no list across funds. The
  down side reads as the loss buffer, and changes are coloured blue for up and
  orange for down (3F D-24).
- **Shift marker:** small amber dot, no text badge, only in the detail section:
  at least `0.30` from the row's `12 mo` reading. Where that row is blocked no cell
  is marked and the section says so once (3F-O-02, closed). Lens C carries a dot on
  the per-1% rows. Lens B has none.
- **Thin-data marker:** dotted underline on figures resting on fewer than 20 days,
  with the count in the tooltip. Below **six** days a figure produces no number
  and shows a dash (3F D-11), because a ratio from fewer points is not a weak
  estimate but not an estimate.
- **Options-caveat banner:** for any ticker with `defined_outcome_caveat:
  true` (nearly the entire coverage set), a visible note that the reading
  reflects current position within the fund's outcome period. The premise is
  untested (3F-O-07).
- **Costs, adviser's fee and inflation (3F D-22, D-23):** after the money rows, a
  line stating the fund's own costs as an amount already inside every figure, with
  acquired-fund fees named for a fund of funds and the anchor's cost beside it.
  Then $100 in the fund, the market and three-month Treasury bills in money of the
  last month, and how much prices rose. A 1% yearly adviser's fee is a checkbox,
  on by default, charged to all three alike. A stand-in for unpublished consumer
  prices or bill rates gets the dotted underline, with the stand-in named in the
  tooltip. The fund's costs are never taken off. Taxes are not counted yet.
- A short legend explaining each marker the page can actually draw.

A static reference implementation of this layout was produced during
design review — use it as the source of truth for spacing, type scale,
and color values.

## JSON schema (per snapshot file)

```json
{
  "app": "Third Floor",
  "schema_version": "4.0",
  "ticker": "RFLR",
  "category": "options_integrated",
  "as_of": "2026-08-01",
  "generated_at": "2026-08-01T00:00:00Z",
  "coverage": {
    "inception": "2024-09-17",
    "earliest_available_snapshot": "2025-01",
    "earliest_full_baseline_snapshot": "2025-10",
    "requested_backfill_depth_months": 19,
    "history_limited_by_inception": false
  },
  "methodology": {
    "score_normalization": "A raw semibeta of 1.0 … is shown as 50. …",
    "score_normalization_formula": "clamp(floor(50 * raw_semibeta + 0.5), 0, 100)",
    "shift_threshold": null,
    "shift_threshold_note": "Not yet set — see 3F-O-01.",
    "min_observations_per_cell": 20,
    "price_basis": "close_adjusted",
    "price_source": "yfinance",
    "return_frequency": "daily",
    "defined_outcome_caveat": true
  },
  "benchmarks": {
    "VOO": { "roles": ["universal_anchor"], "benchmark_source": null, "horizons": [] },
    "IWM": {
      "roles": ["named_benchmark"],
      "benchmark_source": "marketing_language",
      "horizons": []
    }
  }
}
```

Each `horizons` array holds the three `{12mo, 6mo, 13wk}` entries **in
that order** — the array's order is the report table's column order, and
`schemas/snapshot.schema.json` enforces it. Each entry carries its window
dates, three observation counts, and either a `states` object of four
cells or `null` plus a blocker (3F D-09). Each cell carries
`raw_semibeta`, `score`, `observation_count`, `quadrant_cov`,
`quadrant_var_bench`, `data_sufficiency` and its own blockers.

**The observation counts must balance**, and this is Third Floor's form of
INV-3: `observations_total == observations_classified +
observations_unclassified`. The four sign quadrants do *not* partition the
sample — a day where either return is exactly zero belongs to none of
them, and flat days are real in thinly traded buffered ETFs. Those days
are counted rather than quietly dropped, and both the Python core and the
TypeScript validator assert the identity.

After 3F D-01, only **DBMF** carries the `VOO` entry alone — its factsheet
declares no benchmark at all, which is a different fact from an untracked
one. HOLA, BUFY and BUFI now carry an `EFA` entry as well.

File location: `/data/<ticker>/<YYYY-MM>.json`.

## Notebook packaging — one-or-two-touch download

```python
import zipfile

with zipfile.ZipFile('third_floor_package.zip', 'w') as zf:
    for path in output_paths:   # every JSON snapshot, manifest, log, etc.
        zf.write(path)

from google.colab import files
files.download('third_floor_package.zip')
```

One click after the run finishes: a single zip, unzipped locally into the
repo's `/data` structure, then committed and pushed.

## Scope boundary — descriptive tool, not a research instrument

Deliberate, not a current limitation to be patched later. **Amended by 3F D-21:**
the site's pages stay one fund at a time, and `OBSERVER/` orders funds on each
measure, with every number and its derivation shown. Grades, verdicts and any
statement about predicted performance stay forbidden everywhere.

- No uncertainty quantification beyond the thin-data flag.
- Survivorship bias is structural — a live snapshot only sees funds that
  currently exist.
- Multiple-comparisons risk if the (small, fixed) tracked set is ever
  scanned for "biggest movers" as a research claim rather than a
  per-fund report.
- No backtested predictive validity.

The archive this notebook produces is the right raw material for a
separate research effort later, with its own defined hypotheses and
statistical treatment. Don't build that module now; keep this JSON output
clean and consistent.

## Inherited invariants, and the one amendment

The family invariants in `floor_foundations/FAMILY_DOCTRINE.md` §2 carry
over unrenumbered. Two need a word about how they land here, since Third
Floor takes no user file at all:

- **INV-3** ("every row of every input file is accounted for") has no
  holdings file to apply to. Its form here is the observation identity:
  every paired trading day is used or counted with a reason, and the four
  sign quadrants do not partition the sample.
- **INV-6** ("no network call after page load") is **amended in scope by
  3F D-02**, not dropped. Third Floor's page reads its own committed
  archive same-origin. No third-party origin, no telemetry, no beacon, no
  socket, and still no secret. What INV-6 protects — that nothing about
  the reader is disclosed to anyone — is untouched, because the files
  being read were published before the reader arrived.

## Build order

Each step has a gate. Run the gate; do not assume the step.

**Done in this pass:**

1. ✅ Repository, workspaces, vendored modules with provenance headers and
   a drift check pointed at `floor_foundations/`.
2. ✅ Benchmark gap closed — EFA added as a fourth anchor (3F D-01).
   *Gate:* 31 tickers, 4 anchors, every non-null `named_benchmark` is an
   anchor, every null one carries a note.
3. ✅ Fetch ladder with the content guard, proven against all 35
   instruments. *Gate:* every source refusal falls through rather than
   returning a short series; the real Stooq challenge page is a committed
   test fixture.
4. ✅ The semibeta core, over three horizons (3F D-10). *Gate:* property
   tests over algebra — scaling
   either side, permuting row order, identical series giving unit
   participation — plus one frozen golden vector computed independently
   with `numpy.cov`.
5. ✅ Backfill with graceful degradation. *Gate:* a 40-day fund yields
   snapshots with three horizons blocked and no fabricated months.
6. ✅ Emit, packaging, manifest and log.
7. ✅ `/data/<ticker>/<YYYY-MM>.json`, backfilled 19 months — 523 snapshots
   across 30 tickers, with LADM then too new for any window. Extended to
   2026-10 on 2026-11-06 (3F D-16): 615 snapshots across all 31, LADM's first
   two among them, on the thirteen-week window only. *Gate:* every committed
   snapshot validates, and the append-only ingest refuses a second pass.
8. ✅ Methodology decisions closed (3F D-04, D-07, D-08, D-09, D-10).

**Still to build:**

9. ✅ Static site: Lens A, with a benchmark toggle where more than one
   benchmark exists per fund, the options caveat, the thin marker and the
   shift marker. *Gate:* no spec vocabulary reaches the page; every marker
   the table can draw is explained in the legend; both `fetch` calls in the
   shipped bundle are relative.
10. ✅ Static site: Lens B historical comparison, offered only for the
    lookbacks the archive can answer. *Gate:* the two windows are adjacent
    and disjoint; a version-mismatched or uncomputable pair is refused with
    a remedy rather than half-drawn.
11. ✅ Static site: Lens C two-fund comparison, defaulting to the VOO anchor.
    *Gate:* the same month, the same benchmark and the same window length on
    both sides, each enforced by a refusal rather than a convention; both
    funds' readings on the page beside the difference, not the difference
    alone (3F D-14).
12. ✅ `data/index.json` is generated and CI-checked — a static site cannot list
    a directory. Done alongside step 9. It also carries the reader-facing
    benchmark note, which is what the report renders (3F D-15).

13. ✅ The report rebuilt around the money, exposure and fit (3F D-17, D-18).
    *Gate:* capture reliability and persistence measured on the committed report
    files before any page work; the 615 snapshots byte-identical; every report
    validates against its snapshot's month, date and benchmarks.

14. ✅ Capture over time on the report (3F D-20). *Gate:* each side's change clears
    week-shuffled days on the archive's own windows, and the spread's is shown not
    to; no archive file touched; every report month is read exactly, never bridged.

15. ✅ The OBSERVER Folder (3F D-21). *Gate:* the kit's validator passes, and
    `references/replicate.py` recomputes every value and rank from a copy of the
    folder outside the repository; the build refuses a published formula that
    disagrees with the archive; no archive file touched.

16. ✅ Fund costs, the adviser's fee and inflation (3F D-22, D-23). *Gate:* all
    31 funds and 4 anchors have a fee file for every report month, each tying out
    line by line; no snapshot or report file touched; the rate series append-only
    in the ingest; the FRED key gitignored and absent from every written file.

**All sixteen steps are built.** The two open questions the site was waiting on
are closed: 3F-O-05 no (the archive contradicts the caveat's premise) and
3F-O-06 yes, LADM stays.
