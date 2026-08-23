# Third Floor — decisions

Every entry records the reasoning **and the condition that would reverse it**.
That second half is what lets the next agent — or you in six months — tell a
load-bearing decision from a coin flip, and it is why *reverses if: never* is a
meaningful thing to write down.

Amended by appending, never by editing in place. Third Floor's own decisions are
numbered **3F D-nn**. Inherited ones keep their original prefix, so an inherited
decision is visibly inherited and two numbering schemes cannot collide:
**SF-nn** is Second Floor (`floor_foundations/DECISIONS.md`), **FF D-nn** is
First Floor (`floor_foundations/export_fund_profiler/DECISIONS.md`), **INV-n**
are the family invariants (`floor_foundations/FAMILY_DOCTRINE.md` §2).

---

## 3F D-01 · EFA joins the anchor set, closing the EAFE gap

HOLA, BUFY and BUFI each name MSCI EAFE as the thing they measure themselves
against. No EAFE-tracking instrument was in `benchmark_anchors`, so all three
were computed against VOO alone — a comparison that does not match their claimed
exposure, and one which would have quietly misrepresented three of thirty-one
funds in exactly the way this app exists to catch.

These were never `default_no_named_benchmark` cases. A benchmark *is* named; it
simply was not fetched. Adding EFA takes the run from 34 instruments to 35,
comfortably inside the volume ceiling, and turns a missing comparison into a real
one.

EFA is the iShares MSCI EAFE ETF, not the index. It carries a fee and tracks with
some error, and the registry note says so rather than implying the fund is being
compared against the index its prospectus names.

*Reverses if:* an EAFE instrument with materially better fidelity becomes
fetchable, or these funds change the reference they name.

## 3F D-02 · INV-6 is amended in scope, not dropped

INV-6 as inherited reads: no network call after page load, and no secret in the
bundle. Third Floor's whole architecture is a page that reads a JSON archive
committed in its own repository, so the first half cannot hold as written.

The amendment is narrow and the reasoning behind INV-6 survives it intact. What
that invariant protects is the reader: nothing about them is disclosed to anyone,
and nothing the page does can be a channel for telling a third party who is
reading. A same-origin read of a file that was published before the reader
arrived discloses nothing that serving the page did not already disclose.

So: same-origin `fetch` of this site's own committed archive is permitted. No
third-party origin, no telemetry, no beacon, no socket, and still no secret —
a static site has nowhere to keep one, and anything the page can read a reader
can read.

The CI gate changes accordingly, from "no network primitive appears in the
bundle" to "no external origin appears in the bundle": `fetch(` is allowed only
with a relative argument, while `XMLHttpRequest`, `WebSocket` and `sendBeacon`
remain outright failures, because none of them has a legitimate use here.

*Reverses if:* never. The architecture requires it, and the reader-facing promise
is unchanged.

## 3F D-03 · Backfill depth is 19 monthly snapshots

Deep enough that Lens B has both a real six-month and a real thirteen-week
archived comparison from the first day, without waiting nineteen months to
accumulate them. Parameterised rather than hardcoded, so a deeper archive is a
flag and not a rewrite.

Backfilling costs nothing in fetch calls. The network is the expensive part of
this pipeline, and one bulk pull per instrument is sliced in memory at every
snapshot date.

*Reverses if:* enough of the coverage set accumulates history that a deeper
archive would actually be populated rather than mostly skipped.

## 3F D-04 · Snapshots store the raw semibeta and both quadrant moments

Every cell carries `raw_semibeta`, `quadrant_cov`, `quadrant_var_bench` and
`observation_count` alongside the 0–100 display `score`. The transform is
`clamp(floor(50 * raw_semibeta + 0.5), 0, 100)` — one-for-one with the benchmark
shows as 50, twice as much as 100 — and it is written into every file's
`methodology` block in both prose and formula.

This is the decision that makes the display transform cheap to get wrong. Because
the raw number is in the file, the transform can be changed and the entire
archive regenerated **with no network call at all**. `validate-snapshots.mjs`
rechecks every committed score against its own raw value, so the promise is
tested rather than asserted.

The floor-plus-half form is deliberate: Python's `round()` is banker's rounding
and would disagree with JavaScript's `Math.round` on exact halves, which would
make the validator fail on a handful of cells for no reason anybody could see.

*Reverses if:* a transform is chosen that needs a statistic not currently stored,
at which point store it — a field cannot be added retroactively to files already
committed.

## 3F D-05 · The notebook's source of truth is `.py`; the `.ipynb` is generated

A notebook diffs unreadably. Every execution rewrites counts and output blobs, so
a real change disappears into noise and a review becomes impossible.

`notebook/third_floor.py` is percent-cell format and is the file that gets
edited. `scripts/build-notebook.py` renders it to `third_floor.ipynb` with
outputs always stripped, and `--check` fails CI when the two drift — the same
generated-file pattern the family already uses for benchmark and mapping
modules.

The notebook itself is thin. Its first cell clones the repository and puts
`notebook/` on `sys.path`, so **the code that runs in Colab is the code the test
suite covers**, rather than a copy pasted into cells that drifts from it.

*Reverses if:* never.

## 3F D-06 · yfinance is the primary source; Stooq is the documented fallback

This inverts what the build spec says, on evidence gathered before writing any
of it.

Checked 2026-08-23: `https://stooq.com/q/d/l/?s=voo.us&i=d` returned an HTML
proof-of-work browser challenge rather than CSV — with and without a browser
User-Agent, with and without a date range. `pandas.read_csv()` against it yields
no usable data at all. On the same run, yfinance 1.2.0 returned full daily
history for **all 35 instruments** in the coverage set, and is the only source of
the three that hands back a dividend-adjusted close.

The spec's original reasoning against yfinance — that it scrapes an endpoint
needing a cookie handshake and breaks when Yahoo changes its site — is sound and
has not stopped being true. It is simply outweighed by the fact that the
preferred alternative does not currently work at all. Stooq stays first in the
ladder's *documentation* and second in its order, so if it drops the challenge
this self-heals with no code change.

What makes the inversion safe is the guard rather than the ordering. Every source
must clear it before its data is returned: not HTML, expected columns present, a
plausible row count, dates sorted and unique, every price positive and finite. A
challenge page, a rate-limit page and an error page all arrive as HTTP 200, and
any of them parsed loosely would look like a fund with very little history. The
guard raises and falls through instead — it never returns a short or empty
series, because a snapshot built from a challenge page would be committed to a
permanent archive.

*Reverses if:* Stooq drops the challenge, or yfinance's scraping breaks again as
it has historically. The ladder is built for both.

## 3F D-07 · A cell needs 20 observations before it is read without a marker

Below that, the cell still shows its number and carries a marker saying how few
days it rests on. The number is not withheld — a reader who can see the count can
judge it — but it is never presented as though it were as solid as the column to
its left.

When this was written the consequence was recorded as "nearly the whole 4wk
column carries the marker", and treated as acceptable disclosure. The first full
archive run showed that was too generous: **zero** of 2,672 4wk cells cleared the
bar, and 3F D-10 removed the column rather than the threshold.

Across the three columns that remain, the marker discriminates properly — about
a third of 12mo cells are thin, half of 13wk — which is what a flag is for.

*Reverses if:* evidence that a lower floor still reads honestly to a
non-specialist.

## 3F D-08 · Returns come from adjusted closes, and the archive is append-only

Two halves of one decision.

**Adjusted closes.** Several of these funds distribute. On an unadjusted series
every ex-distribution day is a sharp negative return for the fund and not for its
benchmark, which lands squarely in `fund_down_bench_up` and `fund_down_bench_down`
— and the first of those is the resilience quadrant this app most wants to read
correctly. Roughly four to twelve such days a year per fund, against about 250
observations at the twelve-month horizon, is enough to move a reading.

**Append-only.** The cost of adjusted closes is that adjustment factors move: a
month regenerated a year from now does not reproduce the month that was
published. So a committed snapshot is never rewritten from refetched prices. A
routine run adds new files and rewrites none, and
`scripts/ingest-snapshots.mjs` refuses to overwrite without `--force` — the rule
is mechanical, not a note somebody has to remember.

This does not constrain 3F D-04. Regenerating a `score` from a stored
`raw_semibeta` is exact, needs no network, and changes no measurement.

*Reverses if:* a total-return source appears whose factors are frozen per as-of
date, which would give both honesty and reproducibility at once.

## 3F D-09 · A snapshot is written when any horizon is computable

A fund is not required to have twelve months of history before it appears at all.
Where a window reaches back further than the fund's own prices go, that window is
blocked — with a sentence naming where the history begins and what to read
instead — and the windows that do fit are computed and published.

The window is never computed over a shortened period. A reading built from four
months of data and labelled *12 months* is a different statistic wearing the same
name, and every column of the table would then mean something different for a
young fund than for an old one.

A blocked horizon publishes no observation counts either: reporting the days that
happen to fall inside a window the app refused to compute over would put a number
on the page that nothing rests on.

**The consequence, which needed a new field.** Because a file can exist whose
twelve-month row is blocked, and the shift marker is defined as distance from
that row, the marker sometimes has no baseline to measure from. So the coverage
block carries `earliest_full_baseline_snapshot` — the oldest month whose 12mo
horizon is computable, or `null` where no snapshot for that fund has one. The
data layer cannot decide what the site does about that case, but it can hand the
site enough to detect it rather than rendering a marker measured from nothing.

*Reverses if:* the site finds a blocked baseline unrenderable in practice, at
which point the write rule tightens to require one.

## 3F D-10 · The 4wk horizon is removed; three columns ship

The report table was specified with four columns — 12 mo, 6 mo, 13 wk, 4 wk. The
first full archive run over all 31 tickers made the fourth indefensible.

A four-week window holds about twenty trading days. Split across four sign
quadrants that leaves a median of **four days per quadrant**, and the observation
floor is twenty (3F D-07). So across 2,672 cells in that column, the number that
cleared the bar was **zero** — 69% thin, 31% blocked outright. The threshold was
unreachable by construction: a 4wk cell could only have been marked reliable if
every single day in the window had landed in one quadrant.

Two fixes were considered and both rejected. Scaling the floor per horizon would
have made the marker discriminate within the column, but a semibeta from four
observations is not more trustworthy for being called acceptable — that is
relabelling the problem. Keeping the flat floor and moving the disclosure to the
column header would have been honest, but it amounts to printing a column and
telling the reader not to rely on any of it.

Removing it costs little and the remaining three still answer the question the
column set exists for: whether a fund's recent behaviour looks different from its
own longer-run behaviour. 12 mo, 6 mo and 13 wk span a year down to a quarter,
which is the range a buy-and-hold investor checking on a fund periodically can
actually act on.

**What it cost.** 22 of 545 snapshots lost their only computable horizon and were
removed, leaving 523. **LADM** (first traded 2026-06-26) lost every snapshot it
had and now carries none at all — it cannot reach even a thirteen-week window,
and the site's "too new for historical analysis" state is the correct thing to
show for it.

**How the archive was migrated.** In place, from files already on disk: the 4wk
entry dropped from each horizons array, snapshots left with nothing computable
removed, coverage blocks recomputed. Every surviving number is byte-identical to
what was measured. Nothing was refetched, so 3F D-08's append-only rule is
untouched — this was a schema change, not a re-measurement, and the distinction
is the whole reason 3F D-04 stores raw values.

*Reverses if:* the observation floor is lowered enough that a four-week window
can produce a cell somebody should act on — which, at four days per quadrant,
would mean lowering it past the point where the statistic means anything.

---

## Open

| # | Question | Blocking |
|---|---|---|
| 3F-O-01 | Shift threshold — a flat number of points from the 12-month baseline, or scaled to the observation count behind each reading? | Site, Lens A |
| 3F-O-02 | What the shift marker does in a file whose 12mo baseline is blocked (3F D-09's consequence). | Site, Lens A |
| 3F-O-03 | Which archived column Lens B compares against. The 12-month baseline is the likely answer, as the most statistically robust column. | Site, Lens B |
| 3F-O-04 | The wording shown when someone searches a ticker outside the tracked set. | Site |
| 3F-O-05 | Whether FGSI wants its own income-overlay caveat, distinct from `defined_outcome_caveat`. It writes calls for income rather than running a capped-and-buffered outcome period, so the existing caveat does not describe it. | Site |
| 3F-O-06 | Whether LADM stays in the registry while it supports so little, or waits for history. | Next monthly run |

All six are render-time or cosmetic, and every snapshot already carries the raw
numbers any answer would need.
