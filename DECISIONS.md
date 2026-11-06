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

## 3F D-11 · A quadrant needs six days before it reports anything

The block threshold was `n < 2`, on the reasoning that two points are the
minimum for a covariance. Rendering the first archive showed that was not a
threshold at all.

52 cells carried readings between −56.65 and +33.57. Every one came from a
quadrant of five days or fewer where the benchmark's returns happened to be
nearly equal — variance as low as 2×10⁻¹¹ — so the ratio was a division by
almost nothing. The absolute variance floor of `1e-18` existed to catch exactly
this and was set orders of magnitude too low to do it.

The floor is now six observations, and it is a mathematical point rather than a
tuned constant: a covariance-to-variance ratio over two points is the slope of
the line through them and carries no information about whether the relationship
is real; over three to five it is barely more. Six catches all 52 blowups and
blocks 1,084 cells, 16.8% of those that previously carried a number. The
resulting range across the whole archive is −2.59 to 2.61, with nothing outside
it.

This is distinct from `min_observations_per_cell` (3F D-07), which is 20 and
*qualifies* a reading rather than withholding it. Two thresholds, two jobs:
below six there is no number, between six and twenty there is a number with a
marker saying how few days are behind it.

*Reverses if:* never below six. A ratio from fewer points is not a weak estimate,
it is not an estimate.

## 3F D-12 · The table shows the ratio itself, not the bounded score

3F D-04 set a 0–100 display score, `clamp(50 × ratio, 0, 100)`, chosen before
there was any data to check it against. The first rendered table showed what it
does to real readings: **every negative clamps to 0**, and negatives are not rare
where it matters most — 32.7% of *fund up, market down* and 40.5% of *fund down,
market up*. A ratio of −0.82 and a ratio of 0.001 printed as the same `0`.

That is the failure INV-2 exists to prevent, wearing a different costume. A zero
and an unknown are opposite claims; so are "the fund barely moved" and "the fund
moved substantially the other way", and the scale collapsed them. It landed
almost entirely in the two rows an app about downside behaviour most needs to
read honestly.

The rows were checked before being changed rather than assumed broken. Across
overlapping 12-month and 6-month windows, once 3F D-11's blowups are removed, the
opposite-direction rows track about as well as the same-direction ones —
correlations of 0.51 and 0.78 against 0.69 and 0.74. There is real signal there,
and the scale was flattening it.

So the table prints `raw_semibeta` to two decimals with an explicit sign, and it
has a reading that needs no scale at all: **for every 1% the market moved on days
of this kind, the fund moved this much.** A negative reads as "the fund's move ran
the other way".

`score` stays in the document. It is not removed, because a field cannot be added
back to files already committed and something may yet want a bounded rendering —
but `methodology.score_normalization` now states plainly that it cannot represent
a negative reading and is not what the report shows, and a new
`methodology.reported_value` says what is.

The shift threshold moved with it, and is the same rule rather than a new one:
15 points on a scale of 50 × ratio is 0.30 in ratio units. It now marks 8.2% of
comparable cells, against the 9.8% the points version marked.

*Reverses if:* a bounded scale is found that represents the negative range
honestly and reads more easily to a non-specialist than a two-decimal ratio.

## 3F D-13 · Lens B matches its column to its lookback

`AGENTS.md` guessed that Lens B would compare the 12-month column of each
archived report, as the most statistically robust one. Measured against the
archive, that guess was wrong in a way that mattered.

Fixing the column at `12mo` compares windows that overlap: by half at a
six-month lookback, by three quarters at thirteen weeks. Most of the resulting
"change" would be the same days measured twice, and the thirteen-week version
barely moved at all — a median change of 0.045, against 0.117 for the matched
column. A comparison whose answer is mostly determined by the days both sides
share is not a comparison of two periods.

So the six-month lookback reads `6mo` on both sides and the thirteen-week
lookback reads `13wk`. The two windows are then exactly adjacent and share no
days: the six months to July against the six months before those. That is a
sentence a reader can picture, and it is true.

The cost is accepted rather than hidden. Matched columns block more often, so
33% of the six-month comparison's cells and 43% of the thirteen-week one's are
not comparable, against roughly 10% had the baseline been used. A cell that
cannot be compared shows a dash and the legend says a dash is not a reading of
nought.

Three further rules, each of which refuses rather than approximating:

- **Schema versions must match on MAJOR.** Two reports worked out differently
  would compare two methods while claiming to compare two periods.
- **The benchmark must be present in both reports**, or the two sides answer
  different questions.
- **A column blocked on either side takes the whole comparison with it.** Four
  dashes in a row explain nothing; one sentence does.

The threshold is the same 0.30 used everywhere else, deliberately — one number
for the reader to learn. It marks more often here (16.7% and 14.0%, against 8.2%
in Lens A), and that is the honest result rather than a miscalibration: disjoint
periods genuinely differ more than overlapping windows within one report.

*Reverses if:* the shorter columns are found to block so often that the
comparison is unavailable more than it is available. At a third and a
two-fifths, it is not there yet.

## 3F D-14 · Lens C shows both readings, not only the gap between them

`AGENTS.md` describes Lens C as "per state per horizon, the delta between their
scores" — four rows by three columns of differences. Measured against the
archive, a difference on its own does not say what was found.

Taking every pair of tracked funds at their most recent shared month, on the
twelve-month window against the universal anchor: a difference of +0.30 turns up
with the higher fund sitting anywhere from +0.04 to +0.71, a spread of 0.67. The
same gap is one fund moving nearly as far as the market and the other moving a
little less, or one moving a little and the other not at all. Those are different
findings and the delta cannot tell them apart.

So the table is three columns — the first fund, the second fund, the difference —
over one window length at a time, with a chooser for the other two. That is the
shape Lens B already taught this reader, and it keeps INV-1: no figure without
what it was worked out from.

The cost is that all three windows are no longer on screen at once. It is small:
every one of the 435 possible pairs can answer all three windows at their latest
shared month, so the chooser never leads anywhere empty. Availability overall is
better than either other lens — 3.3% of cells are not comparable, against Lens
B's 33% and 43% — because both sides are read at the same date over the same
window, and only a genuinely empty quadrant blocks a cell. 26.1% of cells clear
the 0.30 threshold, so the marker is doing work without covering the table.

Four things are refused rather than approximated, the first two being the
constraints `AGENTS.md` asks this lens to enforce rather than support:

- **The same month on both sides.** Otherwise the gap is partly the two funds
  and partly two stretches of market, with nothing on the page separating them.
- **The same benchmark on both sides**, defaulting to the universal anchor,
  which is the only one every fund here carries and so the only one that makes
  an arbitrary pair comparable at all.
- **The same schema MAJOR**, as in Lens B and for the same reason.
- **A fund set beside itself**, which can only ever show that a fund behaves
  exactly like itself.

A fifth: where the two documents disagree about the shift threshold, nothing is
marked. One number for the reader to learn means it has to be the same number on
both sides, and an unmarked table is honest where a mismarked one is not.

*Reverses if:* readers are found to want all three windows at once more than
they want the levels — at which point the difference-only grid is a second view,
not a replacement for this one.

## 3F D-15 · The registry's provenance notes are not reader copy

`tickers.json` carries a `benchmark_note` for twelve funds, explaining why each
one's anchor is what it is. Those notes were being rendered verbatim on the
fund's report.

They were written for whoever maintains the file, and they read like it. FGSI's
ended "a separate income-overlay caveat may be worth adding" — an open question
addressed to the builder, shown to a reader as though it were a caveat. It also
printed the field name `defined_outcome_caveat`, and the phrase
"path-dependent/capped". HOLA's, BUFY's and BUFI's cited `3F D-01`, an address in
a file the reader has never seen. DBMF's said the comparison "shows
diversification benefit vs. equities" — a verdict, which is the one thing the
copy rules exist to keep off this page. Several carried straight apostrophes the
deck's own typography lint would have caught.

None of it was caught because the lint walks `packages/copy`, and this prose
lives in a data file.

So: `benchmark_note` stays exactly as it is and stops reaching the page. It
names prospectus and marketing sources and does not simplify them, which is what
makes it worth keeping in a registry and in an append-only archive. A second
field, `benchmark_note_plain`, says the same thing in the reader's voice, and is
the only one the site renders. The registry schema requires the second wherever
the first is present, `registry.py` refuses to load a file that breaks that, and
`scripts/lint-registry.mjs` runs the deck's own banned-word and typography lists
over the plain notes in CI, plus checks for the four faults above. Run against
the prose that was actually shipping, it produces six findings.

No snapshot was rewritten. The archive keeps the provenance note it was
published with, which is the right record for an audit trail; the page reads the
reader-facing note from `data/index.json`, which is regenerated from the
registry.

*Reverses if:* a way is found to write one note that serves both purposes
without losing the source names. Two readerships, two registers, is the honest
reading of why the first attempt failed.


## 3F D-16 · A missed month is added late, and adds to the archive only

The run went unexecuted after August 2026, so three months had no report. A run
could only ever produce the single most recent month, which would have left a
permanent gap at 2026-08 and 2026-09, and `--backfill` overlaps months already
published.

`--months N` produces the last N completed months and nothing else. The missed
reports were computed on 2026-11-06 at their own month-end dates, from a single
pull made that day. So they differ from what a run on time would have published
by whatever adjustment factors moved in between — the same drift 3F D-08
accepts, and small: about 1e-6 between the two runs of 2026-07. Each file's
`generated_at` shows it was produced late.

The same pass corrected two faults in the path itself. The notebook cloned a
repository URL that does not resolve, so its first cell failed. And the
command-line run never passed the published archive, repeating the coverage
fault 3d6a53f fixed only in the notebook. It now does, and refuses to start
without an archive unless this is a backfill: an absent archive reads as empty,
which would quietly report the fetch boundary as each fund's inception.

*Reverses if:* never for the rule that a late report is dated by its own
month-end. If adjusted-close drift is ever found to matter at this scale, the
disclosure belongs on the page rather than in `generated_at`.

---

## Open

| # | Question | Blocking |
|---|---|---|
| ~~3F-O-01~~ | ~~Shift threshold.~~ **Closed:** a flat 0.30 in ratio units, chosen from the archive's own distribution. See 3F D-12. | — |
| ~~3F-O-02~~ | ~~What the shift marker does with no 12-month baseline.~~ **Closed:** nothing is marked, and the report says why once above the table. About a fifth of the archive is in this state. | — |
| ~~3F-O-03~~ | ~~Which archived column Lens B compares against.~~ **Closed:** matched to the lookback, so the two windows are disjoint. See 3F D-13. | — |
| ~~3F-O-04~~ | ~~The wording shown for a ticker outside the tracked set.~~ **Closed:** a distinct view from the too-new one, because they are different facts. | — |
| ~~3F-O-05~~ | ~~Whether FGSI wants its own income-overlay caveat.~~ **Closed: no.** The caveat's premise is that writing calls for income compresses upside participation. FGSI's readings say the opposite — its up-participation runs *above* its down-participation in both months it has (+0.05 and +0.06), putting it on the un-compressed side of a set whose most compressed member sits at −0.13. A caveat asserting something the archive does not show is the failure mode this app exists to check for. What FGSI actually needed was the thing every fund with an inexact anchor needs, and that is 3F D-15. | — |
| ~~3F-O-06~~ | ~~Whether LADM stays in the registry with no snapshots.~~ **Closed: it stays.** Dropping it would make the site answer "LADM is not one of the funds followed here", which is false — it is followed, and it is too new. Those are different facts and the site already has separate views for them. Inception 2026-06-26 gives it a thirteen-week window around late September 2026, at which point it starts producing files on its own. | — |

All six are now closed. Every one was render-time or cosmetic, and every
snapshot already carried the raw numbers the answers needed — no question in
this register ever cost a refetch.

3F-O-05 is worth reading twice, because it closed the other way from the way it
was posed. The question assumed a caveat was missing; the archive said the
caveat would have been a claim. What was actually wrong was a note nobody had
thought of as prose at all (3F D-15).
