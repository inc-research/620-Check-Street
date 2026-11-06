#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Gain and loss capture by sign quadrant, over one fixed period.

An introductory research pass, deliberately outside the site and the archive:
Third Floor's published reports do not rank funds. It describes one stretch of
the market and claims nothing about what any fund does next.

Why capture and not only semibeta. `quadrant_semibeta` is a slope about the
quadrant's own means, so it says how a fund's move varied with the benchmark's
inside that quadrant, not how large the fund's moves were. Capture is the size
question: the fund's summed move over the benchmark's on the same days. Every
day and every floor comes from the same core the site's numbers do.

    PYTHONPATH=notebook python3 analysis/capture_quadrants.py \\
        --prices <cache.json> --out analysis/2026-02_2026-11/results.json
    ... --check-archive 2026-07        # reproduce a published 6mo column first
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Sequence

import numpy as np

from thirdfloor.fetch import fetch_daily_prices
from thirdfloor.registry import UNIVERSAL_ANCHOR, load_registry
from thirdfloor.semibeta import (
    MIN_OBSERVATIONS_PER_CELL,
    MIN_OBSERVATIONS_TO_REPORT,
    STATES,
    classify,
    daily_returns,
    pair_returns,
    quadrant_semibeta,
)

Pair = tuple[date, float, float]

RESAMPLES = 5000
SEED = 20261106

GAIN_SAME, LOSS_SAME = "fund_up_bench_up", "fund_down_bench_down"
GAIN_OPPOSITE, LOSS_OPPOSITE = "fund_up_bench_down", "fund_down_bench_up"


def ratio(top: float, bottom: float) -> float | None:
    return top / bottom if bottom > 0.0 else None


def cell(pairs: Sequence[Pair], state: str) -> dict[str, Any]:
    """One quadrant. Below the reporting floor there is a count and nothing else."""
    days = [(rf, rb) for _, rf, rb in pairs if classify(rf, rb) == state]
    n = len(days)
    semibeta = quadrant_semibeta(pairs, state)
    out: dict[str, Any] = {
        "days": n,
        "sufficiency": semibeta.data_sufficiency,
        "semibeta": semibeta.raw_semibeta,
        "capture": None,
        "mean_fund_pct": None,
        "mean_bench_pct": None,
        "days_at_scale": None,
    }
    if n >= MIN_OBSERVATIONS_TO_REPORT:
        fund = math.fsum(abs(rf) for rf, _ in days)
        bench = math.fsum(abs(rb) for _, rb in days)
        out.update(
            capture=ratio(fund, bench),
            mean_fund_pct=100.0 * math.fsum(rf for rf, _ in days) / n,
            mean_bench_pct=100.0 * math.fsum(rb for _, rb in days) / n,
            days_at_scale=sum(1 for rf, rb in days if abs(rf) >= abs(rb)),
        )
    return out


def net(pairs: Sequence[Pair], up: bool) -> float | None:
    """Conventional capture: every day the benchmark moved that way.

    Conditions on the benchmark alone, so a day the fund went against it counts
    against the fund here. The quadrants drop that day from the same-direction
    figure, which is why this sits beside them.
    """
    days = [(rf, rb) for _, rf, rb in pairs if (rb > 0.0 if up else rb < 0.0)]
    if not days:
        return None
    return math.fsum(rf for rf, _ in days) / math.fsum(rb for _, rb in days)


def measure(pairs: Sequence[Pair]) -> dict[str, Any]:
    classified = sum(1 for _, rf, rb in pairs if classify(rf, rb) is not None)
    quadrants = {s: cell(pairs, s) for s in STATES}
    # The observation identity, as in compute_horizon.
    assert classified == sum(q["days"] for q in quadrants.values())

    gain, loss = quadrants[GAIN_SAME]["capture"], quadrants[LOSS_SAME]["capture"]
    up, down = net(pairs, True), net(pairs, False)
    return {
        "observations_total": len(pairs),
        "observations_classified": classified,
        "observations_unclassified": len(pairs) - classified,
        "quadrants": quadrants,
        "gain_minus_loss": gain - loss if gain is not None and loss is not None else None,
        "net_up_capture": up,
        "net_down_capture": down,
        "net_up_minus_down": up - down if up is not None and down is not None else None,
    }


def spread_intervals(pairs: Sequence[Pair], seed: int) -> dict[str, list[float] | None]:
    """95% intervals on both gain-minus-loss spreads, resampling days.

    Added once the first results showed spreads of a few hundredths: a ranking of
    them needs to say whether they can be told from nothing. Days are resampled
    independently, which ignores any day-to-day dependence, so these lean narrow.
    A research convenience, not something the site reports.
    """
    rf = np.array([p[1] for p in pairs])
    rb = np.array([p[2] for p in pairs])
    rng = np.random.default_rng(seed)
    draw = rng.integers(0, len(rf), size=(RESAMPLES, len(rf)))
    f, b = rf[draw], rb[draw]

    def capture(mask: np.ndarray) -> np.ndarray:
        with np.errstate(invalid="ignore", divide="ignore"):
            return (np.abs(f) * mask).sum(axis=1) / (np.abs(b) * mask).sum(axis=1)

    def net_capture(mask: np.ndarray) -> np.ndarray:
        with np.errstate(invalid="ignore", divide="ignore"):
            return (f * mask).sum(axis=1) / (b * mask).sum(axis=1)

    same = capture((f > 0) & (b > 0)) - capture((f < 0) & (b < 0))
    overall = net_capture(b > 0) - net_capture(b < 0)
    bounds = lambda v: [float(x) for x in np.nanpercentile(v, [2.5, 97.5])]
    return {"gain_minus_loss": bounds(same), "net_up_minus_down": bounds(overall)}


def in_window(pairs: Sequence[Pair], start: date, end: date) -> list[Pair]:
    return [p for p in pairs if start <= p[0] <= end]


def rank(rows: list[dict[str, Any]], key, n: int = 5) -> dict[str, list[dict[str, Any]]]:
    """Highest and lowest n. Anything without a number is left out and listed."""
    scored = [(key(r), r) for r in rows]
    have = sorted(
        ((v, r) for v, r in scored if v is not None), key=lambda x: (-x[0], x[1]["ticker"])
    )
    entry = lambda v, r: {"ticker": r["ticker"], "value": v}
    return {
        "highest": [entry(v, r) for v, r in have[:n]],
        "lowest": [entry(v, r) for v, r in reversed(have[-n:])],
        "unranked": sorted(r["ticker"] for v, r in scored if v is None),
    }


def spearman(xs: Sequence[float], ys: Sequence[float]) -> float:
    def ranks(v: Sequence[float]) -> list[float]:
        order = sorted(range(len(v)), key=lambda i: v[i])
        out = [0.0] * len(v)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and v[order[j + 1]] == v[order[i]]:
                j += 1
            for k in range(i, j + 1):
                out[order[k]] = (i + j) / 2.0
            i = j + 1
        return out

    a, b = ranks(xs), ranks(ys)
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    top = sum((p - ma) * (q - mb) for p, q in zip(a, b))
    return top / math.sqrt(sum((p - ma) ** 2 for p in a) * sum((q - mb) ** 2 for q in b))


def load_prices(instruments: list[str], start: date, cache: Path | None):
    """One throttled pull per instrument, kept outside the repository if asked."""
    if cache is not None and cache.exists():
        raw = json.loads(cache.read_text())
        return (
            {t: [(date.fromisoformat(d), p) for d, p in s] for t, s in raw["prices"].items()},
            raw["sources"],
            raw["fetched_at"],
        )
    prices, sources = {}, {}
    fetched_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    for i, ticker in enumerate(instruments, 1):
        print(f"[{i}/{len(instruments)}] {ticker}", file=sys.stderr, flush=True)
        series, record = fetch_daily_prices(ticker, start)
        prices[ticker] = list(series)
        sources[ticker] = record.source
    if cache is not None:
        cache.write_text(
            json.dumps(
                {
                    "fetched_at": fetched_at,
                    "sources": sources,
                    "prices": {
                        t: [(d.isoformat(), p) for d, p in s] for t, s in prices.items()
                    },
                }
            )
        )
    return prices, sources, fetched_at


def check_archive(returns, funds, month: str, data_dir: Path) -> int:
    """Rebuild a published 6mo column from this script's own path through the data."""
    worst, cells, disagree = 0.0, 0, []
    for fund in funds:
        path = data_dir / fund.ticker / f"{month}.json"
        if not path.exists():
            continue
        doc = json.loads(path.read_text())
        for bench, block in doc["benchmarks"].items():
            horizon = next(h for h in block["horizons"] if h["horizon"] == "6mo")
            if horizon["states"] is None:
                continue
            window = in_window(
                pair_returns(returns[fund.ticker], returns[bench]),
                date.fromisoformat(horizon["window_start"]),
                date.fromisoformat(horizon["window_end"]),
            )
            for state, published in horizon["states"].items():
                mine = cell(window, state)
                cells += 1
                if mine["days"] != published["observation_count"]:
                    disagree.append((fund.ticker, bench, state, "days"))
                    continue
                a, b = mine["semibeta"], published["raw_semibeta"]
                if (a is None) != (b is None):
                    disagree.append((fund.ticker, bench, state, "blocked"))
                elif a is not None:
                    gap = abs(a - b)
                    worst = max(worst, gap)
                    if gap > 0.02:
                        disagree.append((fund.ticker, bench, state, round(gap, 4)))
    print(f"{month} 6mo: {cells} cells, worst gap {worst:.2e}, {len(disagree)} disagree")
    for row in disagree[:25]:
        print(" ", row)
    return 1 if disagree else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--registry", default="tickers.json")
    parser.add_argument("--data", default="data")
    parser.add_argument("--start", default="2026-02-01")
    parser.add_argument("--end", default="2026-11-05")
    parser.add_argument("--stress-day", default="2026-11-05")
    parser.add_argument("--fetch-from", default="2026-01-02")
    parser.add_argument("--prices", help="cache file for the pull, outside the repository")
    parser.add_argument("--out")
    parser.add_argument("--check-archive", metavar="YYYY-MM")
    args = parser.parse_args()

    registry = load_registry(args.registry)
    start, end = date.fromisoformat(args.start), date.fromisoformat(args.end)
    stress = date.fromisoformat(args.stress_day)
    prices, sources, fetched_at = load_prices(
        registry.instruments,
        date.fromisoformat(args.fetch_from),
        Path(args.prices) if args.prices else None,
    )
    returns = {t: daily_returns(s) for t, s in prices.items()}

    if args.check_archive:
        return check_archive(returns, registry.funds, args.check_archive, Path(args.data))

    # The first trading day of the period, from the anchor. A fund that does not
    # reach it is not measured over a shorter stretch (3F D-09).
    anchor_days = in_window(
        pair_returns(returns[UNIVERSAL_ANCHOR], returns[UNIVERSAL_ANCHOR]), start, end
    )
    first_day, period_days = anchor_days[0][0], len(anchor_days)

    def reading(fund_ticker: str, bench: str) -> dict[str, Any]:
        pairs = in_window(pair_returns(returns[fund_ticker], returns[bench]), start, end)
        without = [p for p in pairs if p[0] != stress]
        day = next((p for p in pairs if p[0] == stress), None)
        return {
            "benchmark": bench,
            **measure(pairs),
            "interval_95": spread_intervals(pairs, SEED),
            "without_stress_day": measure(without),
            "stress_day": (
                {"fund_pct": 100.0 * day[1], "bench_pct": 100.0 * day[2]} if day else None
            ),
        }

    rows, excluded = [], []
    for fund in registry.funds:
        pairs = in_window(
            pair_returns(returns[fund.ticker], returns[UNIVERSAL_ANCHOR]), start, end
        )
        if not pairs or pairs[0][0] > first_day:
            excluded.append(
                {
                    "ticker": fund.ticker,
                    "first_day_in_period": pairs[0][0].isoformat() if pairs else None,
                    "reason": "does not reach the start of the period (3F D-09)",
                }
            )
            continue
        named = fund.named_benchmark
        rows.append(
            {
                "ticker": fund.ticker,
                "category": fund.category,
                "named_benchmark": named,
                "benchmark_source": fund.benchmark_source,
                "defined_outcome_caveat": fund.defined_outcome_caveat,
                "price_source": sources[fund.ticker],
                "voo": reading(fund.ticker, UNIVERSAL_ANCHOR),
                "own": reading(fund.ticker, named) if named else None,
            }
        )

    def q(side: str, state: str, field: str, without: bool = False):
        def get(row):
            block = row[side]
            if block is None:
                return None
            block = block["without_stress_day"] if without else block
            return block["quadrants"][state][field]
        return get

    def top(side: str, field: str, without: bool = False):
        def get(row):
            block = row[side]
            if block is None:
                return None
            return (block["without_stress_day"] if without else block)[field]
        return get

    rankings: dict[str, Any] = {}
    agreement: dict[str, Any] = {}
    for side in ("own", "voo"):
        pool = [r for r in rows if r[side] is not None]
        lists = {
            "gain_capture": rank(pool, q(side, GAIN_SAME, "capture")),
            "loss_capture": rank(pool, q(side, LOSS_SAME, "capture")),
            "gain_minus_loss": rank(pool, top(side, "gain_minus_loss")),
            "net_up_capture": rank(pool, top(side, "net_up_capture")),
            "net_down_capture": rank(pool, top(side, "net_down_capture")),
            "net_up_minus_down": rank(pool, top(side, "net_up_minus_down")),
            "gain_capture_opposite": rank(pool, q(side, GAIN_OPPOSITE, "capture")),
            "loss_capture_opposite": rank(pool, q(side, LOSS_OPPOSITE, "capture")),
            "semibeta_loss_same": rank(pool, q(side, LOSS_SAME, "semibeta")),
            "semibeta_loss_opposite": rank(pool, q(side, LOSS_OPPOSITE, "semibeta")),
            "loss_capture_without_stress_day": rank(
                pool, q(side, LOSS_SAME, "capture", True)
            ),
            "gain_minus_loss_without_stress_day": rank(
                pool, top(side, "gain_minus_loss", True)
            ),
        }
        rankings[side] = lists

        def corr(a, b):
            both = [(a(r), b(r)) for r in pool if a(r) is not None and b(r) is not None]
            return {"n": len(both), "spearman": spearman(*zip(*both))}

        agreement[side] = {
            "semibeta_vs_capture_gain_same": corr(
                q(side, GAIN_SAME, "semibeta"), q(side, GAIN_SAME, "capture")
            ),
            "semibeta_vs_capture_loss_same": corr(
                q(side, LOSS_SAME, "semibeta"), q(side, LOSS_SAME, "capture")
            ),
            "semibeta_vs_capture_gain_opposite": corr(
                q(side, GAIN_OPPOSITE, "semibeta"), q(side, GAIN_OPPOSITE, "capture")
            ),
            "semibeta_vs_capture_loss_opposite": corr(
                q(side, LOSS_OPPOSITE, "semibeta"), q(side, LOSS_OPPOSITE, "capture")
            ),
            "loss_capture_with_vs_without_stress_day": corr(
                q(side, LOSS_SAME, "capture"), q(side, LOSS_SAME, "capture", True)
            ),
            "gain_capture_vs_loss_capture": corr(
                q(side, GAIN_SAME, "capture"), q(side, LOSS_SAME, "capture")
            ),
        }

    document = {
        "title": "Gain and loss capture by sign quadrant",
        "status": "Introductory research pass. Describes one period; predicts nothing.",
        "period": {
            "requested_start": args.start,
            "requested_end": args.end,
            "first_return": first_day.isoformat(),
            "last_return": anchor_days[-1][0].isoformat(),
            "trading_days": period_days,
            "stress_day": args.stress_day,
        },
        "floors": {
            "no_reading_below_days": MIN_OBSERVATIONS_TO_REPORT,
            "thin_below_days": MIN_OBSERVATIONS_PER_CELL,
        },
        "prices": {
            "basis": "close_adjusted",
            "fetched_at": fetched_at,
            "resamples": RESAMPLES,
            "seed": SEED,
            "note": "Adjusted closes drift as funds distribute (3F D-08), so a later "
            "pull will not reproduce these figures exactly.",
        },
        "funds": rows,
        "excluded": excluded,
        "rankings": rankings,
        "agreement": agreement,
    }
    text = json.dumps(document, indent=1, sort_keys=False) + "\n"
    if args.out:
        Path(args.out).write_text(text)
        print(f"wrote {args.out}: {len(rows)} funds, {len(excluded)} excluded")
    return 0


if __name__ == "__main__":
    sys.exit(main())
