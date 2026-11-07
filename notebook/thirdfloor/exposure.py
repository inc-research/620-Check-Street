# SPDX-License-Identifier: MIT
"""What happened to the money, and how much of the market the fund carried.

Pure: no I/O, no network, no pandas. This is what the report leads with
(3F D-17). The semibeta in `semibeta.py` is still computed and archived; this
module answers the question it was never able to: a slope about a quadrant's own
means says how a fund's move varied with the market's on those days, not how far
the fund moved, and it adds up to nothing a reader's money did.

Capture here is the plain ratio of summed daily returns over every day the
market moved that way, so a day the fund went against the market counts against
it. It is deliberately not compounded. Compounding a year of up days takes the
market to about +130% and its down days to about -51%, and because that
curvature applies to the market and much less to a fund carrying a fraction of
it, a fund holding exactly 40% of every move reads about 0.30 up and 0.42 down:
an asymmetry that does not exist. The sum has a second virtue: it is exactly the
ratio of the two average days, so the sentence on the page and the dollars beside
it are the same fact.

`math.fsum` throughout, for the reason given in `semibeta.py`.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date
from typing import Any, Sequence

from .diagnostics import Blocker, market_side_too_few, no_fit_variation, window_not_covered
from .semibeta import HORIZONS, MIN_OBSERVATIONS_TO_REPORT, horizon_start

Pair = tuple[date, float, float]

# Below this share of daily movement lining up with the benchmark, the ratio does
# not describe the fund, and the report says so in place of the per-1% sentence.
# The money rows stay. Set in the gap the coverage set actually has: DBMF reads
# 0.00 to 0.05 and the next lowest fund 0.37.
LOW_FIT_R_SQUARED = 0.25

_VARIANCE_FLOOR = 1e-18


def capture_prose() -> str:
    return (
        "capture_up is the fund's summed daily return over the benchmark's, across "
        "every day the benchmark rose; capture_down likewise for every day it fell. "
        "Not compounded, and equal to the ratio of the two average days. growth is "
        "the compounded return on all paired days, so 1.094 is $100 becoming $109.40."
    )


@dataclass(frozen=True)
class Fall:
    """The deepest peak-to-trough fall on one path. A depth of 0.0 is measured."""

    depth: float
    peak_date: date | None
    trough_date: date | None

    def to_json(self) -> dict[str, Any]:
        return {
            "depth": self.depth,
            "peak_date": self.peak_date.isoformat() if self.peak_date else None,
            "trough_date": self.trough_date.isoformat() if self.trough_date else None,
        }


def worst_fall(days: Sequence[tuple[date, float]], base: date) -> Fall:
    """Deepest fall from a running high, starting from the close before the window.

    Reported as a negative fraction: -0.12 is $100 at its high becoming $88.
    """
    level = high = 1.0
    high_date = base
    worst = 0.0
    peak: date | None = None
    trough: date | None = None
    for d, r in days:
        level *= 1.0 + r
        if level > high:
            high, high_date = level, d
        fall = level / high - 1.0
        if fall < worst:
            worst, peak, trough = fall, high_date, d
    return Fall(worst, peak, trough)


@dataclass(frozen=True)
class Side:
    """Every day the market moved one way, whatever the fund did."""

    days: int
    sum_fund: float
    sum_benchmark: float
    capture: float | None
    average_fund: float | None
    average_benchmark: float | None
    against_days: int
    against_share: float | None
    blockers: tuple[Blocker, ...] = ()

    def to_json(self) -> dict[str, Any]:
        return {
            "days": self.days,
            "sum_fund": self.sum_fund,
            "sum_benchmark": self.sum_benchmark,
            "capture": self.capture,
            "average_fund": self.average_fund,
            "average_benchmark": self.average_benchmark,
            "against_days": self.against_days,
            "against_share": self.against_share,
            "blockers": [b.to_json() for b in self.blockers],
        }


def market_side(window: Sequence[Pair], up: bool) -> Side:
    rows = [(rf, rb) for _, rf, rb in window if (rb > 0.0 if up else rb < 0.0)]
    n = len(rows)
    sum_fund = math.fsum(rf for rf, _ in rows)
    sum_bench = math.fsum(rb for _, rb in rows)
    against = sum(1 for rf, _ in rows if (rf < 0.0 if up else rf > 0.0))
    if n < MIN_OBSERVATIONS_TO_REPORT:
        blocker = market_side_too_few("up" if up else "down", n, MIN_OBSERVATIONS_TO_REPORT)
        return Side(n, sum_fund, sum_bench, None, None, None, against, None, (blocker,))
    return Side(
        n, sum_fund, sum_bench, sum_fund / sum_bench,
        sum_fund / n, sum_bench / n, against, against / n,
    )


@dataclass(frozen=True)
class Fit:
    r_squared: float | None
    beta: float | None
    blockers: tuple[Blocker, ...] = ()

    def to_json(self) -> dict[str, Any]:
        return {
            "r_squared": self.r_squared,
            "beta": self.beta,
            "blockers": [b.to_json() for b in self.blockers],
        }


def benchmark_fit(window: Sequence[Pair]) -> Fit:
    """Share of daily movement lining up with the benchmark, over every paired day."""
    n = len(window)
    if n >= 2:
        mean_f = math.fsum(rf for _, rf, _ in window) / n
        mean_b = math.fsum(rb for _, _, rb in window) / n
        cov = math.fsum((rf - mean_f) * (rb - mean_b) for _, rf, rb in window) / (n - 1)
        var_f = math.fsum((rf - mean_f) ** 2 for _, rf, _ in window) / (n - 1)
        var_b = math.fsum((rb - mean_b) ** 2 for _, _, rb in window) / (n - 1)
        if var_f > _VARIANCE_FLOOR and var_b > _VARIANCE_FLOOR:
            return Fit(cov * cov / (var_f * var_b), cov / var_b)
    return Fit(None, None, (no_fit_variation(),))


@dataclass(frozen=True)
class Reading:
    """One column of the report."""

    horizon: str
    window_start: date
    window_end: date
    first_day: date | None
    days_total: int
    market_flat_days: int
    growth_fund: float | None
    growth_benchmark: float | None
    up: Side | None
    down: Side | None
    fall_fund: Fall | None
    fall_benchmark: Fall | None
    fit: Fit | None
    blockers: tuple[Blocker, ...] = ()

    def to_json(self) -> dict[str, Any]:
        computed = self.up is not None
        return {
            "horizon": self.horizon,
            "window_start": self.window_start.isoformat(),
            "window_end": self.window_end.isoformat(),
            "first_day": self.first_day.isoformat() if self.first_day else None,
            "days_total": self.days_total,
            "market_up_days": self.up.days if self.up else 0,
            "market_down_days": self.down.days if self.down else 0,
            "market_flat_days": self.market_flat_days,
            "growth": (
                {"fund": self.growth_fund, "benchmark": self.growth_benchmark}
                if computed else None
            ),
            "up": self.up.to_json() if self.up else None,
            "down": self.down.to_json() if self.down else None,
            "worst_fall": (
                {"fund": self.fall_fund.to_json(), "benchmark": self.fall_benchmark.to_json()}
                if computed and self.fall_fund and self.fall_benchmark else None
            ),
            "fit": self.fit.to_json() if self.fit else None,
            "blockers": [b.to_json() for b in self.blockers],
        }


def compute_reading(pairs: Sequence[Pair], horizon: str, as_of: date) -> Reading:
    """One window. Blocked rather than shortened where history does not reach it (3F D-09)."""
    start = horizon_start(as_of, horizon)
    earliest = pairs[0][0] if pairs else None
    if earliest is None or earliest > start:
        return Reading(
            horizon, start, as_of, None, 0, 0, None, None, None, None, None, None, None,
            (window_not_covered(horizon, start, earliest),),
        )

    window = [p for p in pairs if start <= p[0] <= as_of]
    before = [p[0] for p in pairs if p[0] < start]
    first = window[0][0]
    base = before[-1] if before else first

    up, down = market_side(window, True), market_side(window, False)
    flat = sum(1 for _, _, rb in window if rb == 0.0)
    # INV-3's form here: every paired day sits on exactly one side.
    assert len(window) == up.days + down.days + flat

    return Reading(
        horizon, start, as_of, first, len(window), flat,
        math.prod(1.0 + rf for _, rf, _ in window),
        math.prod(1.0 + rb for _, _, rb in window),
        up, down,
        worst_fall([(d, rf) for d, rf, _ in window], base),
        worst_fall([(d, rb) for d, _, rb in window], base),
        benchmark_fit(window),
    )


def compute_readings(pairs: Sequence[Pair], as_of: date) -> list[Reading]:
    """Every column, in the report's left-to-right order."""
    in_scope = [p for p in pairs if p[0] <= as_of]
    return [compute_reading(in_scope, h, as_of) for h in HORIZONS]
