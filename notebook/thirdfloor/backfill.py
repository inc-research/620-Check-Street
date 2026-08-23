# SPDX-License-Identifier: MIT
"""Slicing one bulk fetch into many monthly snapshots.

The network fetch is the expensive part of this pipeline; backfilling adds zero
additional fetch calls. One bulk historical pull per instrument, sized to cover
every snapshot's window, then sliced in memory at each snapshot date. A
regression over a few hundred rows of daily returns is microseconds of CPU time
regardless of how many snapshots are sliced from it.

Graceful degradation is the rule throughout: where a ticker's actual history is
shorter than the requested depth, this produces whatever the data genuinely
supports and skips the rest. It never fabricates an earlier snapshot.
"""

from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import date
from typing import Sequence

from .semibeta import Horizon, compute_horizon_table, daily_returns, pair_returns

DEFAULT_SNAPSHOT_COUNT = 19

# A snapshot's horizons reach back at most twelve months, so the fetch must
# cover the requested depth plus one full 12-month horizon behind the oldest
# snapshot date.
HORIZON_HEADROOM_MONTHS = 12


def month_key(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def month_end(year: int, month: int) -> date:
    return date(year, month, monthrange(year, month)[1])


def monthly_snapshot_dates(end: date, count: int = DEFAULT_SNAPSHOT_COUNT) -> list[date]:
    """`count` month-end dates, oldest first, ending with `end`'s month.

    Month ends, not month names — zero-padded YYYY-MM sorts in calendar order
    and month names do not.
    """
    year, month = end.year, end.month
    out: list[date] = []
    for _ in range(count):
        out.append(month_end(year, month))
        month -= 1
        if month == 0:
            month, year = 12, year - 1
    return list(reversed(out))


def fetch_start_for(snapshot_dates: Sequence[date]) -> date:
    """The earliest calendar date any snapshot's deepest window needs."""
    oldest = snapshot_dates[0]
    year, month = oldest.year, oldest.month - HORIZON_HEADROOM_MONTHS
    while month <= 0:
        month += 12
        year -= 1
    return month_end(year, month)


@dataclass
class SnapshotSlice:
    """One ticker, one month, one benchmark's four horizons."""

    month: str
    as_of: date
    benchmark: str
    horizons: list[Horizon]

    @property
    def any_horizon_computed(self) -> bool:
        return any(h.states is not None for h in self.horizons)

    @property
    def has_full_baseline(self) -> bool:
        return any(h.horizon == "12mo" and h.states is not None for h in self.horizons)


def last_trading_date_on_or_before(series: Sequence[tuple[date, float]], cutoff: date) -> date | None:
    """The as-of date a snapshot actually reports.

    A calendar month end that falls on a weekend is not a date any price was
    observed on, so the snapshot records the last date that was.
    """
    candidate = None
    for d, _ in series:
        if d <= cutoff:
            candidate = d
        else:
            break
    return candidate


def build_ticker_slices(
    fund_series: Sequence[tuple[date, float]],
    benchmark_series: dict[str, Sequence[tuple[date, float]]],
    snapshot_dates: Sequence[date],
    min_observations: int,
) -> dict[str, dict[str, list[Horizon]]]:
    """Every month's horizon table, for every benchmark, from one fetch.

    Returns {month: {benchmark: horizons}}, carrying only months where at least
    one horizon against at least one benchmark was computable (3F D-09).
    """
    fund_returns = daily_returns(fund_series)
    paired_by_benchmark = {
        b: pair_returns(fund_returns, daily_returns(s)) for b, s in benchmark_series.items()
    }

    out: dict[str, dict[str, list[Horizon]]] = {}
    for cutoff in snapshot_dates:
        as_of = last_trading_date_on_or_before(fund_series, cutoff)
        if as_of is None:
            continue  # the fund had not started trading yet; no file, nothing invented

        per_benchmark: dict[str, list[Horizon]] = {}
        for benchmark, pairs in paired_by_benchmark.items():
            in_scope = [p for p in pairs if p[0] <= as_of]
            if not in_scope:
                continue
            per_benchmark[benchmark] = compute_horizon_table(
                in_scope, as_of, min_observations
            )

        if not per_benchmark:
            continue
        if not any(
            h.states is not None for horizons in per_benchmark.values() for h in horizons
        ):
            # Every horizon against every benchmark is blocked. There is nothing
            # here to report, so no file is written for this month.
            continue

        out[month_key(cutoff)] = per_benchmark

    return out


def coverage_for(
    slices: dict[str, dict[str, list[Horizon]]],
    inception: date,
    requested_depth: int,
    anchor: str,
) -> dict[str, object]:
    """The ticker-level coverage block, computed once across the whole archive.

    `earliest_full_baseline_snapshot` is the field 3F D-09 forces into existence:
    because a snapshot is written when any horizon is computable, a file can
    exist whose 12-month baseline is blocked — and the shift marker, defined as
    distance from that baseline, then has nothing to measure from. Null means no
    snapshot for this ticker has a baseline at all.
    """
    months = sorted(slices)
    with_baseline = sorted(
        m
        for m, per_benchmark in slices.items()
        if any(
            h.horizon == "12mo" and h.states is not None
            for h in per_benchmark.get(anchor, [])
        )
    )
    return {
        "inception": inception.isoformat(),
        "earliest_available_snapshot": months[0] if months else None,
        "earliest_full_baseline_snapshot": with_baseline[0] if with_baseline else None,
        "requested_backfill_depth_months": requested_depth,
        "history_limited_by_inception": len(months) < requested_depth,
    }
