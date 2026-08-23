# SPDX-License-Identifier: MIT
"""Assembling the snapshot document. Renders nothing.

The document is the artifact; the page renders it (INV-5, from SF-13). This
module decides what a snapshot says and never how it looks — no rounding, no
formatting, no display strings beyond the methodology prose that has to travel
with the numbers.

It has to be sufficient on the day it ships: a field cannot be added
retroactively to files already committed. That is why every cell carries its
raw semibeta and both quadrant moments alongside the display score (3F D-04) —
the transform can then be changed and the whole archive regenerated from stored
values, with no network call at all.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from .backfill import coverage_for
from .registry import UNIVERSAL_ANCHOR, Fund
from .semibeta import (
    REPORTED_VALUE_PROSE,
    SCORE_NORMALIZATION_FORMULA,
    SCORE_NORMALIZATION_PROSE,
    SHIFT_THRESHOLD_RATIO,
    Horizon,
)

SCHEMA_VERSION = "4.0"

SHIFT_THRESHOLD_NOTE = (
    "A shorter window is marked as shifted when its ratio sits at least this far "
    "from the same row's 12-month ratio. Chosen from the archive: the typical gap "
    "is 0.06 and nine in ten are under 0.27, so 0.30 marks roughly one cell in "
    "twelve. Where a fund has no 12-month reading yet, nothing is marked and the "
    "report says why."
)


def _benchmark_block(fund: Fund, benchmark: str, horizons: list[Horizon]) -> dict[str, Any]:
    block: dict[str, Any] = {
        "roles": fund.roles_for(benchmark),
        "benchmark_source": (
            fund.benchmark_source if benchmark == fund.named_benchmark else None
        ),
        "horizons": [h.to_json() for h in horizons],
    }
    if fund.benchmark_note and benchmark == (fund.named_benchmark or UNIVERSAL_ANCHOR):
        block["benchmark_note"] = fund.benchmark_note
    elif fund.benchmark_note and fund.named_benchmark is None and benchmark == UNIVERSAL_ANCHOR:
        block["benchmark_note"] = fund.benchmark_note
    return block


def build_snapshot(
    fund: Fund,
    month: str,
    as_of: date,
    per_benchmark: dict[str, list[Horizon]],
    coverage: dict[str, Any],
    price_basis: str,
    price_source: str,
    min_observations: int,
    generated_at: datetime | None = None,
) -> dict[str, Any]:
    generated = generated_at or datetime.now(timezone.utc)
    return {
        "app": "Third Floor",
        "schema_version": SCHEMA_VERSION,
        "ticker": fund.ticker,
        "name": fund.name,
        "issuer": fund.issuer,
        "category": fund.category,
        "as_of": as_of.isoformat(),
        "generated_at": generated.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "coverage": coverage,
        "methodology": {
            "reported_value": REPORTED_VALUE_PROSE,
            "score_normalization": SCORE_NORMALIZATION_PROSE,
            "score_normalization_formula": SCORE_NORMALIZATION_FORMULA,
            "shift_threshold": SHIFT_THRESHOLD_RATIO,
            "shift_threshold_note": SHIFT_THRESHOLD_NOTE,
            "min_observations_per_cell": min_observations,
            "price_basis": price_basis,
            "price_source": price_source,
            "return_frequency": "daily",
            "defined_outcome_caveat": fund.defined_outcome_caveat,
        },
        "benchmarks": {
            b: _benchmark_block(fund, b, horizons)
            for b, horizons in per_benchmark.items()
        },
    }


def build_all_snapshots(
    fund: Fund,
    slices: dict[str, dict[str, list[Horizon]]],
    inception: date,
    requested_depth: int,
    price_basis: str,
    price_source: str,
    min_observations: int,
    generated_at: datetime | None = None,
) -> dict[str, dict[str, Any]]:
    """Every month's document for one ticker, keyed by YYYY-MM.

    Coverage is computed once across the whole archive and written identically
    into each file, so any single snapshot can answer on its own what the
    archive as a whole holds — the site fetches one file and must not have to
    read nineteen to know whether a comparison is possible.
    """
    coverage = coverage_for(slices, inception, requested_depth, UNIVERSAL_ANCHOR)
    out: dict[str, dict[str, Any]] = {}
    for month, per_benchmark in sorted(slices.items()):
        any_horizons = next(iter(per_benchmark.values()))
        as_of = any_horizons[0].window_end
        assert as_of is not None
        out[month] = build_snapshot(
            fund, month, as_of, per_benchmark, coverage,
            price_basis, price_source, min_observations, generated_at,
        )
    return out


def write_snapshot(root: str | Path, snapshot: dict[str, Any], month: str) -> Path:
    """`/data/<TICKER>/<YYYY-MM>.json` — the storage convention that doubles as
    the historical record. Because every run is committed under a dated
    filename, the archive of past reports exists the moment the files land."""
    directory = Path(root) / snapshot["ticker"]
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{month}.json"
    path.write_text(json.dumps(snapshot, indent=2) + "\n", encoding="utf-8")
    return path
