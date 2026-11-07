#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Whether a change in net capture between two months can be told from noise.

The measurement behind 3F D-20, deliberately outside the site and the archive.
For every fund, benchmark, month, window and lookback the report can show, it
compares net capture at two real report dates and asks how often the change
beats the same days dealt into the two windows at random.

Days are shuffled and split in week-long blocks, not singly. A fund's residual
against its benchmark bounces from one close to the next (lag-1 autocorrelation
is printed by this script), so summing alternate days cancels part of it. On
single days that makes the shuffle too wide and an odd/even split negatively
correlated by construction, and the result would describe the bounce.

The same pass sets the band inside which the page says "about the same": the
median, across fund-months, of the 95th percentile of the shuffled change.

    PYTHONPATH=notebook python3 analysis/capture_trend.py \\
        --prices <cache.json> --out analysis/capture_trend_2025-01_2026-10/results.json
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from capture_quadrants import load_prices  # noqa: E402

from thirdfloor.exposure import LOW_FIT_R_SQUARED, benchmark_fit, market_side  # noqa: E402
from thirdfloor.registry import load_registry  # noqa: E402
from thirdfloor.semibeta import (  # noqa: E402
    HORIZONS,
    MIN_OBSERVATIONS_TO_REPORT,
    daily_returns,
    horizon_start,
    pair_returns,
)

LOOKBACKS = (1, 3, 6)
SIDES = ("up", "down", "spread")
RESAMPLES = 200
BLOCK = 5
SEED = 20261107
SMALL_BASE = 0.10


def months_back(month: str, n: int) -> str:
    total = int(month[:4]) * 12 + int(month[5:7]) - 1 - n
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def rank(v: np.ndarray) -> np.ndarray:
    return v.argsort().argsort().astype(float)


def rank_corr(a: np.ndarray, b: np.ndarray) -> float | None:
    return round(float(np.corrcoef(rank(a), rank(b))[0, 1]), 3) if len(a) > 2 else None


def captures(f: np.ndarray, b: np.ndarray, floor: int) -> tuple[float, float]:
    """Net capture each way, as `market_side` works it, or nan under the floor."""
    up, down = b > 0, b < 0
    return (
        f[up].sum() / b[up].sum() if up.sum() >= floor else math.nan,
        f[down].sum() / b[down].sum() if down.sum() >= floor else math.nan,
    )


def shuffled(f: np.ndarray, b: np.ndarray, now: np.ndarray, then: np.ndarray, rng) -> np.ndarray:
    """Null changes in (up, down, spread), RESAMPLES by 3, shuffled by week."""
    n = len(f)
    block = np.arange(n) // BLOCK
    order = rng.random((RESAMPLES, block[-1] + 1)).argsort(1).argsort(1)
    perm = (order[:, block] * BLOCK + np.arange(n) % BLOCK).argsort(1)
    ff, bb = f[perm], b[perm]

    def net(mask: np.ndarray, up: bool) -> np.ndarray:
        side = (bb > 0 if up else bb < 0) & mask
        with np.errstate(divide="ignore", invalid="ignore"):
            return (ff * side).sum(1) / (bb * side).sum(1)

    u0, d0 = net(then, True), net(then, False)
    u1, d1 = net(now, True), net(now, False)
    return np.stack([u1 - u0, d1 - d0, (u1 - d1) - (u0 - d0)], 1)


def measure(pairs, as_of: dict[str, date], rng) -> list[dict[str, Any]]:
    """Every comparison one fund and benchmark can make."""
    days = [p[0] for p in pairs]
    f = np.array([p[1] for p in pairs])
    b = np.array([p[2] for p in pairs])
    stamp = np.array([d.toordinal() for d in days])

    def window(month: str, h: str) -> np.ndarray | None:
        end = as_of[month]
        start = horizon_start(end, h)
        if not days or days[0] > start:
            return None  # blocked rather than shortened (3F D-09)
        return (stamp >= start.toordinal()) & (stamp <= end.toordinal())

    def fit_ok(mask: np.ndarray) -> bool:
        r2 = benchmark_fit([pairs[i] for i in np.flatnonzero(mask)]).r_squared
        return r2 is not None and r2 >= LOW_FIT_R_SQUARED

    out = []
    for month in as_of:
        for h in HORIZONS:
            now = window(month, h)
            if now is None or not fit_ok(now):
                continue
            for lag in LOOKBACKS:
                earlier = months_back(month, lag)
                if earlier not in as_of:
                    continue
                then = window(earlier, h)
                if then is None or not fit_ok(then):
                    continue
                union = now | then
                F, B, n, t = f[union], b[union], now[union], then[union]
                u1, d1 = captures(F[n], B[n], MIN_OBSERVATIONS_TO_REPORT)
                u0, d0 = captures(F[t], B[t], MIN_OBSERVATIONS_TO_REPORT)
                if any(math.isnan(v) for v in (u1, d1, u0, d0)):
                    continue
                real = np.array([u1 - u0, d1 - d0, (u1 - d1) - (u0 - d0)])
                null = shuffled(F, B, n, t, rng)
                ceiling = np.nanquantile(np.abs(null), 0.95, axis=0)

                odd = (np.arange(len(F)) // BLOCK) % 2 == 0
                halves = []
                for part in (odd, ~odd):
                    a = captures(F[n & part], B[n & part], 2)
                    c = captures(F[t & part], B[t & part], 2)
                    halves.append((a[0] - c[0], a[1] - c[1], (a[0] - a[1]) - (c[0] - c[1])))
                out.append({
                    "h": h, "lag": lag, "real": real, "ceiling": ceiling,
                    "draw": null[0], "halves": np.array(halves),
                    "prior": (u0, d0), "now": (u1, d1),
                })
    return out


def summarise(rows: list[dict[str, Any]]) -> dict[str, Any]:
    real = np.array([r["real"] for r in rows])
    ceiling = np.array([r["ceiling"] for r in rows])
    draw = np.array([r["draw"] for r in rows])
    halves = np.array([r["halves"] for r in rows])
    whole = ~np.isnan(halves).any(axis=(1, 2))
    prior = np.array([r["prior"] for r in rows])
    now = np.array([r["now"] for r in rows])

    legs = np.concatenate([ceiling[:, 0], ceiling[:, 1]])
    band = float(np.nanmedian(legs))
    # A legend figure rounded to the two decimals the page prints, upward.
    shown = math.ceil(band * 100 - 1e-9) / 100

    within = np.abs(real[:, :2]) <= shown
    return {
        "comparisons": len(rows),
        "band_exact": round(band, 4),
        "band": shown,
        "beats_shuffle": {s: round(float(np.mean(np.abs(real[:, i]) > ceiling[:, i])), 3) for i, s in enumerate(SIDES)},
        "week_split_rank_r": {s: rank_corr(halves[whole, 0, i], halves[whole, 1, i]) for i, s in enumerate(SIDES)},
        "legs_move_together_rank_r": rank_corr(real[:, 0], real[:, 1]),
        "beyond_band_real": {s: round(float(np.mean(np.abs(real[:, i]) > shown)), 3) for i, s in enumerate(SIDES[:2])},
        "beyond_band_shuffled": {s: round(float(np.nanmean(np.abs(draw[:, i]) > shown)), 3) for i, s in enumerate(SIDES[:2])},
        "states": {
            "about_the_same": round(float(within.mean()), 3),
            "higher": round(float((real[:, :2] > shown).mean()), 3),
            "lower": round(float((real[:, :2] < -shown).mean()), 3),
        },
        "median_abs_change": {s: round(float(np.median(np.abs(real[:, i]))), 3) for i, s in enumerate(SIDES)},
        "percent": {
            "small_base_share": round(float(np.mean(np.abs(prior) < SMALL_BASE)), 3),
            "sign_flip_share": round(float(np.mean(prior * now < 0)), 3),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--registry", default="tickers.json")
    parser.add_argument("--data", default="data")
    parser.add_argument("--fetch-from", default="2023-12-01")
    parser.add_argument("--prices", help="cache file for the pull, outside the repository")
    parser.add_argument("--out")
    args = parser.parse_args()

    registry = load_registry(args.registry)
    prices, sources, fetched_at = load_prices(
        registry.instruments, date.fromisoformat(args.fetch_from),
        Path(args.prices) if args.prices else None,
    )
    returns = {t: daily_returns(s) for t, s in prices.items()}
    rng = np.random.default_rng(SEED)

    rows: dict[tuple[str, int], list] = defaultdict(list)
    gaps: list[float] = []
    bounce: list[float] = []
    for fund in registry.funds:
        folder = Path(args.data) / "_reports" / fund.ticker
        reports = {p.stem: json.loads(p.read_text()) for p in sorted(folder.glob("*.json"))}
        if not reports:
            continue
        for benchmark in fund.benchmarks:
            as_of = {
                m: date.fromisoformat(r["as_of"]) for m, r in reports.items()
                if benchmark in r["benchmarks"]
            }
            pairs = pair_returns(returns[fund.ticker], returns[benchmark])

            # The cross-check on the pull: the figures below are only about the
            # archive if this reproduces it.
            for month, r in reports.items():
                for col in r["benchmarks"].get(benchmark, {"horizons": []})["horizons"]:
                    if col["up"] and col["up"]["capture"] is not None:
                        start, end = date.fromisoformat(col["window_start"]), date.fromisoformat(col["window_end"])
                        side = market_side([p for p in pairs if start <= p[0] <= end], True)
                        if side.capture is not None:
                            gaps.append(abs(side.capture - col["up"]["capture"]))

            f = np.array([p[1] for p in pairs])
            g = np.array([p[2] for p in pairs])
            if len(f) > 20:
                slope, level = np.polyfit(g, f, 1)
                e = f - (slope * g + level)
                bounce.append(float(np.corrcoef(e[1:], e[:-1])[0, 1]))

            for row in measure(pairs, as_of, rng):
                rows[row["h"], row["lag"]].append(row)

    results = {
        "app": "Third Floor",
        "analysis": "capture_trend",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "prices_fetched_at": fetched_at,
        "price_sources": sorted(set(sources.values())) if isinstance(sources, dict) else None,
        "method": {
            "resamples": RESAMPLES, "block_days": BLOCK, "seed": SEED,
            "excluded": "windows below the report's fit floor or its six-day floor, as on the page",
        },
        "reproduces_archive": {
            "cells": len(gaps),
            "median_gap": round(float(np.median(gaps)), 6),
            "max_gap": round(float(np.max(gaps)), 6),
        },
        "residual_lag1_autocorrelation": {
            "median": round(float(np.median(bounce)), 3),
            "min": round(float(np.min(bounce)), 3),
            "max": round(float(np.max(bounce)), 3),
        },
        "by_window": {
            h: {f"{lag}mo_back": summarise(rows[h, lag]) for lag in LOOKBACKS if rows[h, lag]}
            for h in HORIZONS
        },
    }
    text = json.dumps(results, indent=2) + "\n"
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(text)
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
