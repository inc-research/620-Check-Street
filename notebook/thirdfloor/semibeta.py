# SPDX-License-Identifier: MIT
"""The four-state semibeta computation. Pure: no I/O, no network, no pandas.

`math.fsum` throughout, never the `sum()` builtin. Python 3.12 changed `sum()`
to Neumaier compensated summation, so an implementation using it produces
last-ulp-different results depending on the interpreter's minor version — a real
determinism defect First Floor found the first time it ran its gate (FF D-33).
`fsum` is exactly rounded on every version.

Operates on plain sequences of dates and floats rather than DataFrames, so the
statistic can be tested without a network or a fixture file.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Iterable, Sequence

from .diagnostics import Blocker, benchmark_flat, quadrant_empty, window_not_covered

# The four sign quadrants, in the report table's row order. Grouped under two
# headers: the first two are Participation, the last two are Resilience.
STATES: tuple[str, ...] = (
    "fund_up_bench_up",
    "fund_down_bench_down",
    "fund_up_bench_down",
    "fund_down_bench_up",
)

# Column order of the report table, left to right. The horizons array in the
# emitted document preserves exactly this order.
#
# A 4wk horizon was computed in the first build and then removed (3F D-10). A
# four-week window holds about twenty trading days, and splitting it across four
# sign quadrants leaves roughly four days in each — so no 4wk cell in a full
# archive run ever cleared the twenty-observation bar, and the marker that was
# supposed to warn about thin cells was on for every one of them. A column that
# cannot produce a trustworthy reading is not disclosure, it is noise with a
# label. The three that remain still answer the question the column set exists
# for: whether a fund's recent behaviour looks different from its longer-run
# behaviour.
HORIZONS: tuple[str, ...] = ("12mo", "6mo", "13wk")

MIN_OBSERVATIONS_PER_CELL = 20

# Below this a quadrant produces no number at all, rather than a number with a
# thin marker on it. Distinct from the floor above, which qualifies a reading
# rather than withholding it.
#
# Six, because a covariance-to-variance ratio over two points is just the slope
# of the line through them, and over three to five it is barely more. In the
# first full archive run every reading outside a plausible range — 52 of them,
# from -56 to +34 — came from a quadrant of five days or fewer, where the
# benchmark's returns happened to be nearly equal and the divisor approached
# zero. The absolute variance floor below was meant to catch that and was set
# far too low to do it.
MIN_OBSERVATIONS_TO_REPORT = 6

# How far a shorter window has to sit from the 12-month reading, in ratio units,
# before the report marks it as a shift (3F-O-01, settled).
#
# Chosen from the archive rather than guessed. Across 2,640 comparable cells the
# gap has a median of 0.06 and a 90th percentile of 0.27, so 0.30 fires on about
# one cell in twelve — often enough to be worth looking for, rare enough that a
# dot still means something.
#
# This was first settled as 15 points on the bounded 0-100 score, which is the
# same rule: that scale was 50 x ratio, so 15 points is 0.30. Re-expressed rather
# than re-decided when the table moved to showing the ratio itself (3F D-12).
#
# Deliberately flat rather than scaled to the observation count. A scaled rule is
# the more defensible statistic, but it would mark one cell and not another at
# the same visible gap, for a reason the page cannot put into words this reader
# has been given. The thin marker already says which cells rest on fewer days.
SHIFT_THRESHOLD_RATIO = 0.30

# Below this a quadrant's benchmark variance is zero as far as floating point is
# concerned. Dividing by it produces a wild finite number that looks like a
# reading, which is exactly what INV-2 forbids.
_VARIANCE_FLOOR = 1e-18


def horizon_start(as_of: date, horizon: str) -> date:
    """The first calendar day of a trailing window."""
    if horizon == "12mo":
        return _minus_months(as_of, 12)
    if horizon == "6mo":
        return _minus_months(as_of, 6)
    if horizon == "13wk":
        return as_of - timedelta(weeks=13)
    raise ValueError(f"unknown horizon: {horizon!r}")


def _minus_months(d: date, months: int) -> date:
    year, month = d.year, d.month - months
    while month <= 0:
        month += 12
        year -= 1
    day = d.day
    while True:
        try:
            return date(year, month, day)
        except ValueError:
            day -= 1  # 31 March minus one month is 28 or 29 February


def daily_returns(series: Sequence[tuple[date, float]]) -> list[tuple[date, float]]:
    """Simple daily returns from an ascending (date, price) series.

    A non-positive or missing price ends the usable run rather than producing an
    infinite or undefined return; the pair is dropped and counted nowhere.
    """
    out: list[tuple[date, float]] = []
    for i in range(1, len(series)):
        prev_price = series[i - 1][1]
        curr_date, curr_price = series[i]
        if prev_price is None or curr_price is None:
            continue
        if not (prev_price > 0.0) or not (curr_price > 0.0):
            continue
        out.append((curr_date, curr_price / prev_price - 1.0))
    return out


def pair_returns(
    fund: Sequence[tuple[date, float]],
    bench: Sequence[tuple[date, float]],
) -> list[tuple[date, float, float]]:
    """Inner join two return series on trading date.

    Inner join only. A date present in one series and missing from the other
    drops the pair — it is never forward-filled. A filled day manufactures a
    0.00% return that falls into no quadrant at all and silently deflates the
    observation counts the thin-data flag depends on.
    """
    by_date = dict(bench)
    return [(d, rf, by_date[d]) for d, rf in fund if d in by_date]


def classify(r_fund: float, r_bench: float) -> str | None:
    """The sign quadrant a paired day belongs to, or None.

    The four quadrants do NOT partition the sample. A day where either return is
    exactly zero belongs to none of them, and flat days are real in thinly
    traded buffered ETFs. Returning None rather than forcing such a day into a
    quadrant is what makes the observation identity in `compute_horizon` hold.
    """
    if r_fund > 0.0 and r_bench > 0.0:
        return "fund_up_bench_up"
    if r_fund < 0.0 and r_bench < 0.0:
        return "fund_down_bench_down"
    if r_fund > 0.0 and r_bench < 0.0:
        return "fund_up_bench_down"
    if r_fund < 0.0 and r_bench > 0.0:
        return "fund_down_bench_up"
    return None


def normalise_score(raw: float | None) -> int | None:
    """Map a raw semibeta onto the bounded 0-100 display score (3F D-04).

    clamp(round(50 * raw), 0, 100): beta 1.0 lands at 50, beta 2.0 at 100, beta
    0 and every negative at 0. Linear and plainly explainable, which matters
    more for this reader than never clipping.

    floor(x + 0.5) rather than Python's round(), which is banker's rounding and
    would disagree with the JavaScript validator that rechecks every committed
    score against this same formula.
    """
    if raw is None:
        return None
    scaled = math.floor(50.0 * raw + 0.5)
    return max(0, min(100, int(scaled)))


REPORTED_VALUE_PROSE = (
    "raw_semibeta is a slope about the quadrant's own means: how the fund's move "
    "varied with the size of the benchmark's move on days of this kind, not how far "
    "the fund moved. The report leads with the separate report archive under "
    "data/_reports and shows only the two same-direction rows of this document, as "
    "a detail section (3F D-17). A negative value means a bigger benchmark move went "
    "with a smaller fund move."
)

SCORE_NORMALIZATION_FORMULA = "clamp(floor(50 * raw_semibeta + 0.5), 0, 100)"
SCORE_NORMALIZATION_PROSE = (
    "A bounded rendering of raw_semibeta, retained for compatibility and NOT what "
    "the report shows (3F D-12). It cannot represent a negative reading — every "
    "one clamps to 0 — and about a third of the two opposite-direction rows are "
    "negative, so a score of 0 there is ambiguous by construction. Read "
    "raw_semibeta."
)


@dataclass
class Cell:
    state: str
    raw_semibeta: float | None
    observation_count: int
    quadrant_cov: float | None
    quadrant_var_bench: float | None
    data_sufficiency: str
    blockers: list[Blocker]

    def to_json(self) -> dict[str, Any]:
        return {
            "raw_semibeta": self.raw_semibeta,
            "score": normalise_score(self.raw_semibeta),
            "observation_count": self.observation_count,
            "quadrant_cov": self.quadrant_cov,
            "quadrant_var_bench": self.quadrant_var_bench,
            "data_sufficiency": self.data_sufficiency,
            "blockers": [b.to_json() for b in self.blockers],
        }


def quadrant_semibeta(
    pairs: Iterable[tuple[date, float, float]],
    state: str,
    min_observations: int = MIN_OBSERVATIONS_PER_CELL,
) -> Cell:
    """Semicovariance beta within one sign quadrant.

    cov_q(r_fund, r_bench) / var_q(r_bench), both moments taken over that
    quadrant's days only and about that quadrant's own means.
    """
    xs: list[float] = []
    ys: list[float] = []
    for _, r_fund, r_bench in pairs:
        if classify(r_fund, r_bench) == state:
            xs.append(r_fund)
            ys.append(r_bench)

    n = len(xs)
    if n < MIN_OBSERVATIONS_TO_REPORT:
        return Cell(
            state, None, n, None, None, "blocked",
            [quadrant_empty(state, n, MIN_OBSERVATIONS_TO_REPORT)],
        )

    mean_x = math.fsum(xs) / n
    mean_y = math.fsum(ys) / n
    cov = math.fsum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / (n - 1)
    var = math.fsum((y - mean_y) * (y - mean_y) for y in ys) / (n - 1)

    if not (var > _VARIANCE_FLOOR):
        return Cell(state, None, n, cov, var, "blocked", [benchmark_flat(state)])

    sufficiency = "ok" if n >= min_observations else "thin"
    return Cell(state, cov / var, n, cov, var, sufficiency, [])


@dataclass
class Horizon:
    horizon: str
    window_start: date | None
    window_end: date | None
    observations_total: int
    observations_classified: int
    observations_unclassified: int
    states: dict[str, Cell] | None
    blockers: list[Blocker]

    def to_json(self) -> dict[str, Any]:
        return {
            "horizon": self.horizon,
            "window_start": self.window_start.isoformat() if self.window_start else None,
            "window_end": self.window_end.isoformat() if self.window_end else None,
            "observations_total": self.observations_total,
            "observations_classified": self.observations_classified,
            "observations_unclassified": self.observations_unclassified,
            "states": (
                {s: self.states[s].to_json() for s in STATES}
                if self.states is not None
                else None
            ),
            "blockers": [b.to_json() for b in self.blockers],
        }


def compute_horizon(
    pairs: Sequence[tuple[date, float, float]],
    horizon: str,
    as_of: date,
    min_observations: int = MIN_OBSERVATIONS_PER_CELL,
    earliest_pair: date | None = None,
) -> Horizon:
    """One column of the report table.

    A horizon is computable only when the paired series actually reaches back to
    the start of the window. A fund whose history begins inside the window is
    blocked rather than computed over a shortened one: a "12 month" reading
    built from four months of data is a different statistic wearing the same
    label, and this app's whole premise is not doing that.
    """
    start = horizon_start(as_of, horizon)
    window = [p for p in pairs if start <= p[0] <= as_of]

    if earliest_pair is None:
        earliest_pair = pairs[0][0] if pairs else None

    if earliest_pair is None or earliest_pair > start:
        # All three counts are zero because nothing in this window was used.
        # Reporting the days that happen to fall inside a window we refused to
        # compute over would publish a count that no number here rests on, and
        # would break the observation identity besides. The blocker carries the
        # fact that is actually useful: where the fund's history begins.
        return Horizon(
            horizon, start, as_of, 0, 0, 0, None,
            [window_not_covered(horizon, start, earliest_pair)],
        )

    total = len(window)
    classified = sum(1 for _, rf, rb in window if classify(rf, rb) is not None)
    unclassified = total - classified

    states = {s: quadrant_semibeta(window, s, min_observations) for s in STATES}

    # INV-3, this app's form of it: every paired observation is used or counted
    # with a reason. Asserted rather than hoped for.
    assert total == classified + unclassified
    assert classified == sum(states[s].observation_count for s in STATES)

    return Horizon(horizon, start, as_of, total, classified, unclassified, states, [])


def compute_horizon_table(
    pairs: Sequence[tuple[date, float, float]],
    as_of: date,
    min_observations: int = MIN_OBSERVATIONS_PER_CELL,
) -> list[Horizon]:
    """Every column, in the report table's left-to-right order."""
    earliest = pairs[0][0] if pairs else None
    return [
        compute_horizon(pairs, h, as_of, min_observations, earliest) for h in HORIZONS
    ]
