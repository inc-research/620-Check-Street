#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Gain Exposure, stage 3: every figure, from cached inputs, no network (3F D-25).

Run from the repository root:
    PYTHONPATH=notebook python3 analysis/gain_exposure_2026-11/study.py --prices <cache.json>

Reads the price cache (not committed, as with analysis/capture_trend.py), grouping.json beside this file, tickers.json and
data/_rates/CPIAUCNS.json from the repository (read only). Writes results.json
beside this file.

Definitions (owner's decisions, 2026-11-09):

* Days. Every day the benchmark rose (up leg) or fell (down leg), whatever the
  fund did: the site's net capture, through `thirdfloor.exposure.market_side`.
  The both-up / both-down quadrant version is computed as a secondary table.
* Legs are running sums of daily returns, never compounded (3F D-17).
* u = up capture, d = down capture, b = 1 - d = loss buffer (3F D-24).
* Gain-exposure ratio E = d / u: per unit of the market's gain the fund kept,
  the share of the market's loss it took, relative to the market. The
  benchmark reads exactly 1. E > 1 exactly when u + b < 1.
* Breakeven: over any stretch the fund's summed return beats the market's only
  if ... see `breakeven_note`; the fund's net sum is positive only while the
  market's gain-to-loss ratio G/L exceeds E.
* Uncertainty: week-block bootstrap (3F D-20: daily residuals bounce back the
  next day, so single-day resampling understates the spread).

YTD = first 2026 trading day to 3 Nov 2026. Special case = 4 Nov (market up)
and 5 Nov (market down), each shown alone and never pooled into an estimate.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import statistics
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Sequence

from thirdfloor.exposure import benchmark_fit, market_side
from thirdfloor.registry import UNIVERSAL_ANCHOR, load_registry
from thirdfloor.semibeta import MIN_OBSERVATIONS_TO_REPORT, classify, daily_returns, pair_returns

HERE = Path(__file__).resolve().parent
Pair = tuple[date, float, float]

YTD_START = date(2026, 1, 1)
YTD_END = date(2026, 11, 3)
SPECIAL = (date(2026, 11, 4), date(2026, 11, 5))
CPI_BASE_MONTH = "2025-12"
RESAMPLES = 4000
SEED = 20261109
BANDS = ("small", "medium", "large")


# ── core measures ────────────────────────────────────────────────────────────

def ytd(pairs: Sequence[Pair]) -> list[Pair]:
    return [p for p in pairs if YTD_START <= p[0] <= YTD_END]


def exposure_ratio(u: float | None, d: float | None) -> float | None:
    """E = d / u. Undefined where the fund kept nothing of the market's gains."""
    if u is None or d is None or u <= 0.0:
        return None
    return d / u


def capture_pair(pairs: Sequence[Pair]) -> dict[str, Any]:
    up, down = market_side(pairs, True), market_side(pairs, False)
    u, d = up.capture, down.capture
    return {
        "up_days": up.days, "down_days": down.days,
        "flat_days": len(pairs) - up.days - down.days,
        "sum_fund_up": up.sum_fund, "sum_bench_up": up.sum_benchmark,
        "sum_fund_down": down.sum_fund, "sum_bench_down": down.sum_benchmark,
        "u": u, "d": d, "b": None if d is None else 1.0 - d,
        "u_plus_b": None if u is None or d is None else u + 1.0 - d,
        "E": exposure_ratio(u, d),
        "against_up": up.against_days, "against_down": down.against_days,
    }


def legs(pairs: Sequence[Pair]) -> dict[str, list[list[Any]]]:
    """Running sums on market-up and market-down days, in date order."""
    out: dict[str, list[list[Any]]] = {"up": [], "down": []}
    cf = {"up": 0.0, "down": 0.0}
    cb = {"up": 0.0, "down": 0.0}
    for d, rf, rb in pairs:
        side = "up" if rb > 0.0 else "down" if rb < 0.0 else None
        if side is None:
            continue
        cf[side] += rf
        cb[side] += rb
        out[side].append([d.isoformat(), cf[side], cb[side]])
    return out


def quadrants(pairs: Sequence[Pair]) -> dict[str, Any]:
    """Both-up and both-down capture: secondary, and mostly a volatility ratio."""
    out: dict[str, Any] = {}
    for state, key in (("fund_up_bench_up", "both_up"), ("fund_down_bench_down", "both_down")):
        days = [(rf, rb) for _, rf, rb in pairs if classify(rf, rb) == state]
        sb = math.fsum(rb for _, rb in days)
        cap = math.fsum(rf for rf, _ in days) / sb if len(days) >= MIN_OBSERVATIONS_TO_REPORT and sb != 0 else None
        out[key] = {"days": len(days), "capture": cap}
    return out


def week_key(d: date) -> tuple[int, int]:
    iso = d.isocalendar()
    return (iso[0], iso[1])


def bootstrap(pairs: Sequence[Pair], seed: int = SEED, n: int = RESAMPLES) -> dict[str, Any]:
    """Week-block bootstrap of u, b and E. Returns 2.5/97.5 percentiles."""
    weeks: dict[tuple[int, int], list[Pair]] = {}
    for p in pairs:
        weeks.setdefault(week_key(p[0]), []).append(p)
    blocks = list(weeks.values())
    rng = random.Random(seed)
    us, bs, es = [], [], []
    undefined = 0
    for _ in range(n):
        sample = [p for _ in blocks for p in rng.choice(blocks)]
        up, down = market_side(sample, True), market_side(sample, False)
        if up.capture is None or down.capture is None:
            undefined += 1
            continue
        us.append(up.capture)
        bs.append(1.0 - down.capture)
        e = exposure_ratio(up.capture, down.capture)
        if e is None:
            undefined += 1
            continue
        es.append(e)

    def ci(xs: list[float]) -> list[float] | None:
        if len(xs) < n * 0.9:
            return None
        xs = sorted(xs)
        return [xs[int(0.025 * (len(xs) - 1))], xs[int(0.975 * (len(xs) - 1))]]

    e_ci = ci(es)
    share_above = sum(1 for e in es if e > 1.0) / len(es) if es else None
    return {
        "weeks": len(blocks), "resamples": n, "undefined": undefined,
        "u": ci(us), "b": ci(bs), "E": e_ci,
        "E_share_above_1": share_above,
        "E_settled": None if e_ci is None else ("above_1" if e_ci[0] > 1.0 else "below_1" if e_ci[1] < 1.0 else "not_settled"),
    }


def band_edges(pairs: Sequence[Pair]) -> dict[str, float]:
    """Tercile and top-decile cut points of |benchmark move| over the YTD days."""
    mags = sorted(abs(rb) for _, _, rb in pairs if rb != 0.0)
    q = lambda f: mags[min(len(mags) - 1, int(f * len(mags)))]
    return {"t1": q(1 / 3), "t2": q(2 / 3), "d9": q(0.9)}


def band_of(rb: float, edges: dict[str, float]) -> str:
    m = abs(rb)
    return "small" if m < edges["t1"] else "medium" if m < edges["t2"] else "large"


def by_band(pairs: Sequence[Pair], edges: dict[str, float]) -> dict[str, Any]:
    out = {}
    for name in BANDS:
        out[name] = capture_pair([p for p in pairs if p[2] != 0.0 and band_of(p[2], edges) == name])
    out["top_decile"] = capture_pair([p for p in pairs if abs(p[2]) >= edges["d9"]])
    return out


def special_day(pairs: Sequence[Pair], day: date, ytd_cap: dict[str, Any],
                ytd_pairs: Sequence[Pair]) -> dict[str, Any] | None:
    hit = [p for p in pairs if p[0] == day]
    if not hit:
        return None
    _, rf, rb = hit[0]
    ratio = rf / rb if rb != 0.0 else None
    mags = sorted(abs(x) for _, _, x in ytd_pairs)
    rank = sum(1 for m in mags if m >= abs(rb)) + 1  # 1 = larger than every YTD day
    out: dict[str, Any] = {
        "date": day.isoformat(), "fund": rf, "bench": rb,
        "side": "up" if rb > 0 else "down" if rb < 0 else "flat",
        "day_capture": ratio,
        "bench_move_rank_vs_ytd": rank, "ytd_days": len(mags),
    }
    if rb < 0.0 and ratio is not None:
        out["day_buffer"] = 1.0 - ratio
        # How much of the YTD up-leg sum this one day took back, fund and market.
        su_f, su_b = ytd_cap["sum_fund_up"], ytd_cap["sum_bench_up"]
        out["takeback_fund"] = -rf / su_f if su_f > 0 else None
        out["takeback_bench"] = -rb / su_b if su_b > 0 else None
        out["takeback_ratio"] = (out["takeback_fund"] / out["takeback_bench"]
                                 if out["takeback_fund"] is not None and out["takeback_bench"] else None)
        # The same day's down capture over the YTD up capture: E for this one day.
        out["E_day"] = exposure_ratio(ytd_cap["u"], ratio)
    return out


def growth(pairs: Sequence[Pair]) -> dict[str, float]:
    gf = gb = 1.0
    for _, rf, rb in pairs:
        gf *= 1.0 + rf
        gb *= 1.0 + rb
    return {"fund": gf, "bench": gb}


# ── CPI, the site's convention (packages/core/src/report/real.ts) ───────────

def cpi_path(path: Path, days: Sequence[date]) -> dict[str, Any]:
    """Compounding inflation since the CPI_BASE_MONTH level, for each day.

    A month's index is placed at the month's end and interpolated geometrically
    by calendar day between month ends. A month not yet published holds at the
    last published level and is marked provisional, as the site does.
    """
    doc = json.loads(path.read_text())
    by_month = {d[:7]: v for d, v in doc["observations"]}
    last = max(by_month)
    base = by_month[CPI_BASE_MONTH]

    def month_end(m: str) -> date:
        y, mo = int(m[:4]), int(m[5:])
        nxt = date(y + (mo == 12), 1 if mo == 12 else mo + 1, 1)
        return nxt - timedelta(days=1)

    def lvl(m: str) -> float:
        return by_month[m] if m <= last else by_month[last]

    out = []
    for d in days:
        m = d.strftime("%Y-%m")
        y, mo = d.year, d.month
        prev = f"{y - (mo == 1)}-{12 if mo == 1 else mo - 1:02d}"
        a, b = lvl(prev), lvl(m)
        e0, e1 = month_end(prev), month_end(m)
        frac = (d - e0).days / (e1 - e0).days
        v = a * (b / a) ** frac
        out.append([d.isoformat(), v / base - 1.0, m > last])
    return {"series": "CPIAUCNS", "base_month": CPI_BASE_MONTH, "last_published": last,
            "fetched_at": doc.get("fetched_at"), "points": out}


# ── assembly ────────────────────────────────────────────────────────────────

def summarise(values: list[float]) -> dict[str, Any] | None:
    v = [x for x in values if x is not None]
    if not v:
        return None
    return {"n": len(v), "median": statistics.median(v), "min": min(v), "max": max(v)}


def main() -> int:
    reg = load_registry("tickers.json")
    ap = argparse.ArgumentParser()
    ap.add_argument("--prices", type=Path, default=HERE / "prices.json")
    prices = json.loads(ap.parse_args().prices.read_text())
    grouping = json.loads((HERE / "grouping.json").read_text())
    groups = {f["ticker"]: f for f in grouping["funds"]}
    R = {t: daily_returns([(date.fromisoformat(d), p) for d, p in s]) for t, s in prices["prices"].items()}
    # Nothing past the special case is read, so a partial bar for today never enters.
    R = {t: [(d, r) for d, r in s if d <= SPECIAL[-1]] for t, s in R.items()}

    for t in R:
        days = {d for d, _ in R[t]}
        missing = [d for d in SPECIAL if d not in days]
        if missing:
            print(f"{t}: missing {missing}; stopping", file=sys.stderr)
            return 1

    anchors = sorted({b for f in reg.funds for b in f.benchmarks})
    bench_info = {}
    for b in anchors:
        p = ytd(pair_returns(R[b], R[b]))
        lg = legs(p)
        bench_info[b] = {
            "legs": {"up": [[d, cb] for d, _, cb in lg["up"]], "down": [[d, cb] for d, _, cb in lg["down"]]},
            "special": {d.isoformat(): dict(R[b])[d] for d in SPECIAL},
            "growth_ytd": growth(p)["bench"],
            "edges": band_edges(p),
        }

    funds_out = []
    for f in reg.funds:
        g = groups[f.ticker]
        rec: dict[str, Any] = {
            "ticker": f.ticker, "name": f.name, "issuer": f.issuer,
            "group": g["group"], "subgroup": g["subgroup"], "flag": g.get("flag"),
            "defined_outcome_caveat": f.defined_outcome_caveat,
            "named_benchmark": f.named_benchmark, "price_source": prices["sources"][f.ticker],
            "first_price": prices["prices"][f.ticker][0][0],
            "benchmarks": {},
        }
        for b in f.benchmarks:
            allp = pair_returns(R[f.ticker], R[b])
            yp = ytd(allp)
            cap = capture_pair(yp)
            fit = benchmark_fit(yp)
            rec["benchmarks"][b] = {
                "roles": f.roles_for(b),
                "ytd_first_day": yp[0][0].isoformat() if yp else None,
                "ytd_days": len(yp),
                "capture": cap,
                "market_gain_loss_ratio": (cap["sum_bench_up"] / -cap["sum_bench_down"]
                                           if cap["sum_bench_down"] < 0 else None),
                "fund_net_sum": cap["sum_fund_up"] + cap["sum_fund_down"],
                "bench_net_sum": cap["sum_bench_up"] + cap["sum_bench_down"],
                "growth_ytd": growth(yp),
                "fit": {"r_squared": fit.r_squared, "beta": fit.beta},
                "bootstrap": bootstrap(yp),
                "bands": by_band(yp, bench_info[b]["edges"]),
                "quadrants": quadrants(yp),
                "legs": legs(yp),
                "special": [special_day(allp, d, cap, yp) for d in SPECIAL],
                "special_band": {d.isoformat(): ("top_decile" if abs(dict(R[b])[d]) >= bench_info[b]["edges"]["d9"]
                                                 else band_of(dict(R[b])[d], bench_info[b]["edges"]))
                                 for d in SPECIAL},
            }
        funds_out.append(rec)

    # Group summaries, on each fund's named benchmark and on VOO.
    def bench_for(rec: dict[str, Any], basis: str) -> str:
        return UNIVERSAL_ANCHOR if basis == "VOO" or rec["named_benchmark"] is None else rec["named_benchmark"]

    summaries: dict[str, Any] = {}
    for basis in ("named", "VOO"):
        summaries[basis] = {}
        for key, sel in (("group", lambda r: r["group"]), ("subgroup", lambda r: r["subgroup"])):
            for name in sorted({sel(r) for r in funds_out}):
                members = [r for r in funds_out if sel(r) == name]
                blk = [r["benchmarks"][bench_for(r, basis)] for r in members]
                s5 = [x["special"][1] for x in blk]
                s4 = [x["special"][0] for x in blk]
                summaries[basis][f"{key}:{name}"] = {
                    "tickers": [r["ticker"] for r in members],
                    "u": summarise([x["capture"]["u"] for x in blk]),
                    "b": summarise([x["capture"]["b"] for x in blk]),
                    "E": summarise([x["capture"]["E"] for x in blk]),
                    "u_plus_b": summarise([x["capture"]["u_plus_b"] for x in blk]),
                    "E_settled_above_1": sum(1 for x in blk if x["bootstrap"]["E_settled"] == "above_1"),
                    "E_settled_below_1": sum(1 for x in blk if x["bootstrap"]["E_settled"] == "below_1"),
                    "E_not_settled": sum(1 for x in blk if x["bootstrap"]["E_settled"] == "not_settled"),
                    "nov4_day_capture": summarise([x["day_capture"] for x in s4 if x]),
                    "nov5_day_buffer": summarise([x.get("day_buffer") for x in s5 if x]),
                    "nov5_takeback_ratio": summarise([x.get("takeback_ratio") for x in s5 if x]),
                    "bands": {bn: {"u": summarise([x["bands"][bn]["u"] for x in blk]),
                                   "b": summarise([x["bands"][bn]["b"] for x in blk])}
                              for bn in (*BANDS, "top_decile")},
                }

    all_days = sorted({d for d, _ in R[UNIVERSAL_ANCHOR] if YTD_START <= d <= SPECIAL[-1]})
    out = {
        "study": "Gain Exposure, YTD 2026 and 4-5 Nov 2026",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "inputs": {
            "prices_fetched_at": prices["fetched_at"], "price_basis": "close_adjusted",
            "grouping_approved": grouping["approved"], "grouping_rule": grouping["rule"],
            "ytd": [YTD_START.isoformat(), YTD_END.isoformat()],
            "special": [d.isoformat() for d in SPECIAL],
            "bootstrap": {"block": "ISO week", "resamples": RESAMPLES, "seed": SEED},
            "min_days_to_report": MIN_OBSERVATIONS_TO_REPORT,
        },
        "groups": grouping["groups"],
        "benchmarks": bench_info,
        "cpi": cpi_path(Path("data/_rates/CPIAUCNS.json"), all_days),
        "funds": funds_out,
        "summaries": summaries,
    }
    (HERE / "results.json").write_text(json.dumps(out, indent=1, default=str))
    print(f"wrote results.json: {len(funds_out)} funds", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
