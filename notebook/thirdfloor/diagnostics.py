# SPDX-License-Identifier: MIT
"""Blockers, carried over in shape from the Floor family's diagnostics model.

INV-2: a missing input blocks its metric and names a remedy. Nothing is
defaulted quietly. The rule this enforces is that a zero and an unknown are
opposite claims — a semibeta of 0.00 says "this fund did not move with its
benchmark in that quadrant"; a semibeta that could not be computed says nothing
at all, and printing it as 0.00 asserts the first while knowing the second.

`remedy` is required, not optional (SF-15). "What would make this different" is
the half a hurried implementation drops and the half a non-specialist needs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Blocker:
    code: str
    message: str
    remedy: str
    subjects: tuple[str, ...] = field(default=())

    def to_json(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "remedy": self.remedy,
        }
        if self.subjects:
            out["subjects"] = list(self.subjects)
        return out


_HORIZON_WORDS = {
    "12mo": "12 months",
    "6mo": "6 months",
    "13wk": "13 weeks",
}


def window_not_covered(horizon: str, window_start, earliest) -> Blocker:
    """The window reaches back further than the fund's own history goes.

    Deliberately not computed over a shortened window: a reading built from four
    months of data and labelled "12 months" is a different statistic wearing the
    same name, and every column of this table would then mean something
    different for a young fund than for an old one.
    """
    words = _HORIZON_WORDS.get(horizon, horizon)
    if earliest is None:
        return Blocker(
            code="window_shorter_than_horizon",
            message=(
                f"There are no days where this fund and its benchmark both have "
                f"a price, so the {words} reading cannot be worked out."
            ),
            remedy=(
                "Check back after the fund has been trading for a while. Nothing "
                "about it can be measured until it has price history."
            ),
            subjects=(horizon,),
        )
    return Blocker(
        code="window_shorter_than_horizon",
        message=(
            f"This reading covers the {words} up to this date, which means going "
            f"back to {window_start}. This fund's price history only starts on "
            f"{earliest}, so there is nothing to read for the earlier part of "
            f"that period."
        ),
        remedy=(
            f"Read the shorter windows in this same table, which fit inside the "
            f"history the fund does have. The {words} reading becomes available "
            f"once the fund has been trading that long."
        ),
        subjects=(horizon,),
    )


def quadrant_empty(state: str, count: int) -> Blocker:
    return Blocker(
        code="quadrant_too_few_observations",
        message=(
            f"There were only {count} days in this window where the fund and "
            "the benchmark moved in this particular combination of directions, "
            "which is not enough days to work a number out from."
        ),
        remedy=(
            "Read a longer window from the columns to the left, where more days "
            "have accumulated in this combination."
        ),
        subjects=(state,),
    )


def benchmark_flat(state: str) -> Blocker:
    return Blocker(
        code="benchmark_no_variation",
        message=(
            "On the days in this combination the benchmark barely moved at all, "
            "so there is nothing to measure the fund's movement against."
        ),
        remedy=(
            "Read a longer window from the columns to the left, where the "
            "benchmark has moved by varying amounts."
        ),
        subjects=(state,),
    )
