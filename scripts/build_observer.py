#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""OBSERVER/ — the analysis as a folder any reader or agent can recompute (3F D-21).

Generated from the committed archives and nothing else: no network, and no
change to any archived file. Every value comes from running the formula string
the folder publishes, so what is printed and what ran cannot be two things.

Refuses rather than writes when an expected fund is missing, when a published
formula disagrees with the stored figures or the TypeScript core anywhere in the
archive, or when generated prose fails the copy lint.

    python3 scripts/build_observer.py            write OBSERVER/
    python3 scripts/build_observer.py --check    fail if OBSERVER/ is stale
    python3 scripts/build_observer.py --zip PATH package OBSERVER/ for the site

`generated.at` is when the build ran (OBSERVER 0.1, OKF), so it is the one thing
a rebuild changes and the one thing --check ignores. The zip takes its timestamps
from the report date, so its contents decide its bytes.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TARGET = ROOT / "OBSERVER"
RAW = "4.0_RAW_DATA.csv"
SPEC_URL = "https://observerformat.io/specification"
BUILDER = "third_floor_observer/1.0"
OBSERVER_ID = "third-floor-oi-fund-capture"
TITLE = "Third Floor: market capture of options-integrated funds"
ANCHOR = "VOO"
MIN_DAYS = 6
THIN_DAYS = 20
EDGE = 5
PLACES = 4
GATE_TOLERANCE = 1e-12

HORIZONS = ("12mo", "6mo", "13wk")
KEY = ["ticker", "benchmark", "report_month", "horizon"]

COLUMNS: list[tuple[str, str, str]] = [
    ("ticker", "string", "The fund."),
    ("benchmark", "string", "The instrument the fund is measured against."),
    ("report_month", "string", "The monthly report, YYYY-MM."),
    ("horizon", "string", "Trailing window: 12mo, 6mo or 13wk."),
    ("as_of", "date", "Last trading day in the report."),
    ("window_start", "date", "First calendar day of the window."),
    ("window_end", "date", "Last calendar day of the window."),
    ("days_total", "integer", "Paired trading days in the window."),
    ("days_market_up", "integer", "Days the benchmark rose."),
    ("days_market_down", "integer", "Days the benchmark fell."),
    ("sum_fund_up", "number", "Sum of the fund’s daily returns, as fractions, on days the benchmark rose. Input: not rebuilt in this folder."),
    ("sum_benchmark_up", "number", "Sum of the benchmark’s daily returns on the days it rose. Input."),
    ("sum_fund_down", "number", "Sum of the fund’s daily returns on days the benchmark fell. Input."),
    ("sum_benchmark_down", "number", "Sum of the benchmark’s daily returns on the days it fell. Negative. Input."),
    ("r_squared", "number", "Share of the fund’s daily movement lining up with the benchmark, 0 to 1. Input, read by the fit floor."),
    ("growth_fund", "number", "What 1.00 in the fund became over the window, distributions reinvested. Context, not ranked."),
    ("growth_benchmark", "number", "What 1.00 in the benchmark became over the window. Context, not ranked."),
    ("days_both_up", "integer", "Days fund and benchmark both rose."),
    ("quadrant_cov_up", "number", "Covariance of fund and benchmark returns across the days both rose. Input."),
    ("quadrant_var_bench_up", "number", "Variance of benchmark returns across the days both rose. Input."),
    ("days_both_down", "integer", "Days fund and benchmark both fell."),
    ("quadrant_cov_down", "number", "Covariance of fund and benchmark returns across the days both fell. Input."),
    ("quadrant_var_bench_down", "number", "Variance of benchmark returns across the days both fell. Input."),
]
COLUMN_NAMES = [c[0] for c in COLUMNS]

# --- the published formulas: this text is what runs ---------------------------


def _capture(name: str, side: str) -> str:
    return (
        f"def {name}(sum_fund_{side}, sum_benchmark_{side}):\n"
        f"    return sum_fund_{side} / sum_benchmark_{side}\n"
    )


def _semibeta(name: str, side: str) -> str:
    return (
        f"def {name}(quadrant_cov_{side}, quadrant_var_bench_{side}):\n"
        f"    return quadrant_cov_{side} / quadrant_var_bench_{side}\n"
    )


def _change(name: str, side: str) -> str:
    return (
        f"def {name}(sum_fund_now, sum_benchmark_now, sum_fund_then, sum_benchmark_then):\n"
        "    return sum_fund_now / sum_benchmark_now - sum_fund_then / sum_benchmark_then\n"
    )


REL_OB_RANK = (
    "def rel_ob_rank(value, population):\n"
    "    return 1 + sum(1 for other in population if other > value)\n"
)
REL_OB_Z = (
    "import statistics\n\n"
    "def rel_ob_z(value, population):\n"
    "    return (value - statistics.mean(population)) / statistics.stdev(population)\n"
)
RELATIVE_VALUE = "def relative_value(rel_ob_rank, rel_ob_z):\n    return abs(rel_ob_z)\n"


def define(formula: str, name: str):
    scope: dict[str, Any] = {}
    exec(formula, scope)  # noqa: S102 - our own literal, the string the folder publishes
    return scope[name]


METRICS: list[dict[str, Any]] = [
    {
        "metric": "capture_up_12mo_ratio", "kind": "capture", "side": "up", "horizon": "12mo",
        "formula": _capture("capture_up_12mo_ratio", "up"),
        "label": "Share of the market’s rises carried, past twelve months",
        "description": "Fund’s summed daily return over the benchmark’s, across every day the benchmark rose in the trailing twelve months. Summed, not compounded. 1.00 is one for one. Higher is more of the rises, which is a description and not a verdict.",
        "utility": "How much of the market’s rises a fund carried over a year, comparable across funds on one benchmark.",
        "inputs": ["sum_fund_up", "sum_benchmark_up"],
    },
    {
        "metric": "capture_down_12mo_ratio", "kind": "capture", "side": "down", "horizon": "12mo",
        "formula": _capture("capture_down_12mo_ratio", "down"),
        "label": "Share of the market’s falls carried, past twelve months",
        "description": "Fund’s summed daily return over the benchmark’s, across every day the benchmark fell in the trailing twelve months. Summed, not compounded. 1.00 is one for one. Higher means more of the falls, so a high position here is a larger share of losses.",
        "utility": "How much of the market’s falls a fund carried over a year, comparable across funds on one benchmark.",
        "inputs": ["sum_fund_down", "sum_benchmark_down"],
    },
    {
        "metric": "semibeta_up_12mo", "kind": "semibeta", "side": "up", "horizon": "12mo",
        "formula": _semibeta("semibeta_up_12mo", "up"),
        "label": "Same-direction slope on shared up days, past twelve months",
        "description": "Covariance over benchmark variance across the days fund and benchmark both rose. A slope about those days’ own means: it says how the fund’s move varied with the market’s on those days, not how far the fund moved, and it is not a per-1% figure.",
        "utility": "A second way of measuring the fund’s link to the market on up days, built differently from capture.",
        "inputs": ["quadrant_cov_up", "quadrant_var_bench_up"],
    },
    {
        "metric": "semibeta_down_12mo", "kind": "semibeta", "side": "down", "horizon": "12mo",
        "formula": _semibeta("semibeta_down_12mo", "down"),
        "label": "Same-direction slope on shared down days, past twelve months",
        "description": "Covariance over benchmark variance across the days fund and benchmark both fell. A slope about those days’ own means, not a per-1% figure.",
        "utility": "A second way of measuring the fund’s link to the market on down days, built differently from capture.",
        "inputs": ["quadrant_cov_down", "quadrant_var_bench_down"],
    },
    {
        "metric": "capture_up_change_3mo", "kind": "change", "side": "up", "horizon": "13wk", "lookback": 3,
        "formula": _change("capture_up_change_3mo", "up"),
        "label": "Change in share of rises carried, thirteen weeks against the thirteen before",
        "description": "Thirteen-week up capture at this report minus thirteen-week up capture at the report three months back, in ratio points. Positive means the fund carried more of the rises than it did.",
        "utility": "How a fund’s response to rising days moved between the latest quarter and the one before.",
        "inputs": ["sum_fund_up", "sum_benchmark_up"],
    },
    {
        "metric": "capture_down_change_3mo", "kind": "change", "side": "down", "horizon": "13wk", "lookback": 3,
        "formula": _change("capture_down_change_3mo", "down"),
        "label": "Change in share of falls carried, thirteen weeks against the thirteen before",
        "description": "Thirteen-week down capture at this report minus thirteen-week down capture at the report three months back, in ratio points. Positive means the fund carried more of the falls than it did.",
        "utility": "How a fund’s response to falling days moved between the latest quarter and the one before.",
        "inputs": ["sum_fund_down", "sum_benchmark_down"],
    },
    {
        "metric": "capture_up_change_6mo", "kind": "change", "side": "up", "horizon": "6mo", "lookback": 6,
        "formula": _change("capture_up_change_6mo", "up"),
        "label": "Change in share of rises carried, six months against the six before",
        "description": "Six-month up capture at this report minus six-month up capture at the report six months back, in ratio points. Positive means the fund carried more of the rises than it did.",
        "utility": "How a fund’s response to rising days moved between the latest half year and the one before.",
        "inputs": ["sum_fund_up", "sum_benchmark_up"],
    },
    {
        "metric": "capture_down_change_6mo", "kind": "change", "side": "down", "horizon": "6mo", "lookback": 6,
        "formula": _change("capture_down_change_6mo", "down"),
        "label": "Change in share of falls carried, six months against the six before",
        "description": "Six-month down capture at this report minus six-month down capture at the report six months back, in ratio points. Positive means the fund carried more of the falls than it did.",
        "utility": "How a fund’s response to falling days moved between the latest half year and the one before.",
        "inputs": ["sum_fund_down", "sum_benchmark_down"],
    },
]

ELEVATION_RULE = (
    f"Elevated when an object is measured against {ANCHOR}, has a value, and sits among the "
    f"{EDGE} highest or {EDGE} lowest of its metric: rel_ob_rank <= {EDGE} or rel_ob_rank >= n - {EDGE - 1}, "
    "where n is that metric’s population."
)

NOTICES = [
    "These figures describe past periods. They say nothing about what any fund does next, and they are not advice.",
    "Rank 1 is the numerically highest value and carries no judgment: a high position on a down-capture metric is a larger share of the market’s falls. No fund here is graded.",
    "Ranks are taken against one benchmark so the funds can be read together. A fund whose own benchmark is not VOO ranks partly on that mismatch, and its object names its own benchmark.",
    "Capture is summed, not compounded, and needs the window’s benchmark move to be read. Windows are trailing, and do not line up with any fund’s outcome period, so these figures do not show whether a cap or buffer delivered what it set out to.",
    "Whether these readings depend on where a fund sits in its outcome period has not been tested.",
    "A change near the top or bottom of its list is not always a real change. Each change object carries its noise band, and `within_band: true` marks one that could not be told from the same days dealt out at random. Beyond the band some changes are still chance.",
    "Eight metrics across about thirty funds is many comparisons, so some listed positions are expected by chance alone.",
    "The population is the funds that exist today, so funds that have closed are absent.",
]


# --- reading the archive ------------------------------------------------------


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def months_back(month: str, n: int) -> str:
    total = int(month[:4]) * 12 + int(month[5:7]) - 1 - n
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def read_registry() -> dict[str, dict[str, Any]]:
    registry = load_json(ROOT / "tickers.json")
    return {f["ticker"]: f for f in registry["tickers"]}


def row_from(ticker: str, benchmark: str, month: str, report: dict, col: dict, snap_col: dict | None) -> dict[str, Any]:
    up, down = col.get("up") or {}, col.get("down") or {}
    fit = col.get("fit") or {}
    growth = col.get("growth") or {}
    states = (snap_col or {}).get("states") or {}
    both_up = states.get("fund_up_bench_up") or {}
    both_down = states.get("fund_down_bench_down") or {}
    cell = lambda c, k: c.get(k) if c.get("raw_semibeta") is not None else None
    return {
        "ticker": ticker, "benchmark": benchmark, "report_month": month, "horizon": col["horizon"],
        "as_of": report["as_of"], "window_start": col["window_start"], "window_end": col["window_end"],
        "days_total": col["days_total"], "days_market_up": col["market_up_days"],
        "days_market_down": col["market_down_days"],
        # Sums below the six-day floor are not published: no reading rests on them.
        "sum_fund_up": up.get("sum_fund") if up.get("capture") is not None else None,
        "sum_benchmark_up": up.get("sum_benchmark") if up.get("capture") is not None else None,
        "sum_fund_down": down.get("sum_fund") if down.get("capture") is not None else None,
        "sum_benchmark_down": down.get("sum_benchmark") if down.get("capture") is not None else None,
        "r_squared": fit.get("r_squared"),
        "growth_fund": growth.get("fund"), "growth_benchmark": growth.get("benchmark"),
        "days_both_up": both_up.get("observation_count"),
        "quadrant_cov_up": cell(both_up, "quadrant_cov"),
        "quadrant_var_bench_up": cell(both_up, "quadrant_var_bench"),
        "days_both_down": both_down.get("observation_count"),
        "quadrant_cov_down": cell(both_down, "quadrant_cov"),
        "quadrant_var_bench_down": cell(both_down, "quadrant_var_bench"),
        # Not columns: what the gate compares the formulas against.
        "_capture_up": up.get("capture"), "_capture_down": down.get("capture"),
        "_semibeta_up": both_up.get("raw_semibeta"), "_semibeta_down": both_down.get("raw_semibeta"),
    }


def load_archive(registry: dict[str, dict[str, Any]]) -> tuple[dict, dict, str, str, float, list[str]]:
    index = load_json(DATA / "index.json")
    latest = max(f["latest"] for f in index["funds"] if f.get("latest"))
    tables: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    current: dict[str, dict[str, Any]] = {}
    floors, sources = set(), set()

    for ticker in sorted(registry):
        folder = DATA / "_reports" / ticker
        # Declared separately from what is on disk, so a fund that vanished stops
        # the build instead of quietly leaving the population (Pitfall 4).
        if not (folder / f"{latest}.json").exists():
            raise SystemExit(f"observer: {ticker} has no report for {latest}; nothing written")
        for path in sorted(folder.glob("*.json")):
            month = path.stem
            report = load_json(path)
            snapshot_path = DATA / ticker / f"{month}.json"
            if not snapshot_path.exists():
                raise SystemExit(f"observer: {ticker} {month} has a report and no snapshot; nothing written")
            snapshot = load_json(snapshot_path)
            floors.add(report["methodology"]["low_fit_r_squared"])
            sources.add(report["methodology"]["price_source"])
            for benchmark, block in report["benchmarks"].items():
                snap_block = snapshot["benchmarks"].get(benchmark, {})
                snap_by = {h["horizon"]: h for h in snap_block.get("horizons", [])}
                for col in block["horizons"]:
                    tables[ticker, benchmark, month, col["horizon"]] = row_from(
                        ticker, benchmark, month, report, col, snap_by.get(col["horizon"])
                    )
            if month == latest:
                current[ticker] = report

    if len(floors) != 1:
        raise SystemExit(f"observer: reports disagree on the fit floor: {sorted(floors)}")
    dates = {r["as_of"] for r in current.values()}
    if len(dates) != 1:
        raise SystemExit(f"observer: {latest} reports disagree on their date: {sorted(dates)}")
    return tables, current, latest, dates.pop(), floors.pop(), sorted(sources)


# --- working the values out ---------------------------------------------------


def absence(row: dict | None, side: str, kind: str, floor: float) -> str | None:
    """Why a row gives no reading, or None where it gives one."""
    if row is None:
        return "no_report"
    if row["growth_benchmark"] is None:
        return "window_not_covered"
    if row["r_squared"] is None or row["r_squared"] < floor:
        return "low_fit"
    needed = (row[f"quadrant_cov_{side}"], row[f"quadrant_var_bench_{side}"]) if kind == "semibeta" \
        else (row[f"sum_fund_{side}"], row[f"sum_benchmark_{side}"])
    if any(v is None for v in needed):
        return "too_few_days"
    return None


def capture_of(row: dict, side: str) -> float:
    return row[f"sum_fund_{side}"] / row[f"sum_benchmark_{side}"]


def gate(tables: dict, engine: dict, floor: float) -> int:
    """Every published formula against what actually ran, across the whole archive."""
    checks = 0
    published = {m["metric"]: define(m["formula"], m["metric"]) for m in METRICS}
    for m in METRICS:
        side, fn = m["side"], published[m["metric"]]
        if m["kind"] == "change":
            continue
        stored_key = f"_{m['kind']}_{side}"
        for row in tables.values():
            stored = row[stored_key]
            args = [row[a] for a in m["inputs"]]
            if stored is None:
                continue
            if any(a is None for a in args):
                raise SystemExit(f"observer: {m['metric']} has a stored value and no inputs at {row}")
            if abs(fn(*args) - stored) > GATE_TOLERANCE:
                raise SystemExit(
                    f"observer: {m['metric']} disagrees with the archive at {row['ticker']} "
                    f"{row['report_month']} {row['horizon']}: {fn(*args)} against {stored}; nothing written"
                )
            checks += 1

    expected = {}
    for r in engine["rows"]:
        expected[r["ticker"], r["benchmark"], r["month"], r["column"], r["lookback"], r["side"]] = r
    produced = set()
    for m in (x for x in METRICS if x["kind"] == "change"):
        side, h, lag, fn = m["side"], m["horizon"], m["lookback"], published[m["metric"]]
        for (ticker, benchmark, month, horizon), row in tables.items():
            if horizon != h:
                continue
            then = tables.get((ticker, benchmark, months_back(month, lag), h))
            if absence(row, side, "change", floor) or absence(then, side, "change", floor):
                continue
            value = fn(row[f"sum_fund_{side}"], row[f"sum_benchmark_{side}"],
                       then[f"sum_fund_{side}"], then[f"sum_benchmark_{side}"])
            key = (ticker, benchmark, month, h, lag, side)
            produced.add(key)
            core = expected.get(key)
            if core is None or abs(value - core["change"]) > GATE_TOLERANCE:
                raise SystemExit(f"observer: {m['metric']} disagrees with the core at {key}: "
                                 f"{value} against {core and core['change']}; nothing written")
            band = engine["bands"][h][str(lag)]
            words = "about_the_same" if abs(value) <= band else ("higher" if value > 0 else "lower")
            if words != core["direction"]:
                raise SystemExit(f"observer: the band disagrees with the core at {key}; nothing written")
            checks += 1
    missing = set(expected) - produced
    if missing:
        raise SystemExit(f"observer: the core has {len(missing)} changes the formulas do not, "
                         f"first {sorted(missing)[0]}; nothing written")
    return checks


def rounded(value: float | None) -> float | None:
    return None if value is None else round(value, PLACES)


ABSENT_NOTES = {
    "no_report": "No report exists for the month this needs, so nothing is computed. The fund may be too new.",
    "window_not_covered": "The fund’s history does not reach back over this window. It is blocked rather than computed over a shorter period.",
    "low_fit": "The benchmark explains less than the report’s fit floor of this fund’s daily movement, so the figure does not describe the fund and is not reported.",
    "too_few_days": "Fewer than six days of this kind, so no figure exists. This is not a zero.",
}


def build_objects(tables, current, registry, month, report_date, floor, engine):
    """One object per metric, fund and benchmark, from the formulas themselves."""
    objects: list[dict[str, Any]] = []
    for m in METRICS:
        kind, side, h = m["kind"], m["side"], m["horizon"]
        fn = define(m["formula"], m["metric"])
        lag = m.get("lookback")
        for ticker in sorted(current):
            own = registry[ticker].get("named_benchmark") or ANCHOR
            for benchmark in sorted(current[ticker]["benchmarks"]):
                subject = f"{ticker}.{benchmark}"
                row = tables.get((ticker, benchmark, month, h))
                then_month = months_back(month, lag) if lag else None
                then = tables.get((ticker, benchmark, then_month, h)) if lag else None

                why = absence(row, side, kind, floor) or (absence(then, side, kind, floor) if lag else None)
                value: float | None = None
                extra: dict[str, Any] = {}
                notes: list[str] = []
                if why is None:
                    if kind == "change":
                        value = fn(row[f"sum_fund_{side}"], row[f"sum_benchmark_{side}"],
                                   then[f"sum_fund_{side}"], then[f"sum_benchmark_{side}"])
                        band = engine["bands"][h][str(lag)]
                        extra = {"comparison": {
                            "now": rounded(capture_of(row, side)),
                            "then": rounded(capture_of(then, side)),
                            "window_now": [row["window_start"], row["window_end"]],
                            "window_then": [then["window_start"], then["window_end"]],
                            "band": band,
                            "within_band": abs(value) <= band,
                            "market_now": rounded(row["growth_benchmark"]),
                            "market_then": rounded(then["growth_benchmark"]),
                        }}
                        if then["window_end"] >= row["window_start"]:
                            notes.append(f"The two windows sit end to end and share only {then['window_end']}.")
                    else:
                        value = fn(*[row[a] for a in m["inputs"]])
                else:
                    notes.append(ABSENT_NOTES[why])

                days = (row or {}).get(f"days_both_{side}" if kind == "semibeta" else f"days_market_{side}")
                if why is None and days is not None and days < THIN_DAYS:
                    notes.append(f"Rests on {days} days, fewer than the 20 the report asks for.")
                if why is None and lag:
                    d = then.get(f"days_market_{side}")
                    if d is not None and d < THIN_DAYS:
                        notes.append(f"The earlier reading rests on {d} days, fewer than the 20 the report asks for.")
                if benchmark != ANCHOR:
                    notes.append(f"Measured against this fund’s own benchmark, {benchmark}. Listed, not ranked: ranks use {ANCHOR} on every fund.")
                elif own != ANCHOR:
                    notes.append(f"This fund’s own benchmark is {own}, so its position against {ANCHOR} reflects that mismatch as well as the fund.")

                months = [month] if not lag else [then_month, month]
                verify: dict[str, Any] = {
                    "source": RAW,
                    "rows": {"ticker": ticker, "benchmark": benchmark,
                             "report_month": months[0] if len(months) == 1 else months, "horizon": h},
                    "columns": list(m["inputs"]),
                }
                if lag:
                    verify["args"] = {
                        "sum_fund_now": {"column": f"sum_fund_{side}", "rows": {"report_month": month}},
                        "sum_benchmark_now": {"column": f"sum_benchmark_{side}", "rows": {"report_month": month}},
                        "sum_fund_then": {"column": f"sum_fund_{side}", "rows": {"report_month": then_month}},
                        "sum_benchmark_then": {"column": f"sum_benchmark_{side}", "rows": {"report_month": then_month}},
                    }
                if notes:
                    verify["notes"] = " ".join(notes)

                objects.append({
                    "m": m, "subject": subject, "ticker": ticker, "benchmark": benchmark,
                    "raw": value, "why": why, "extra": extra, "verify": verify,
                })

    rank_fn, z_fn = define(REL_OB_RANK, "rel_ob_rank"), define(REL_OB_Z, "rel_ob_z")
    rv_fn = define(RELATIVE_VALUE, "relative_value")
    finished: list[dict[str, Any]] = []
    populations: dict[str, list[dict[str, Any]]] = {}
    for m in METRICS:
        members = [o for o in objects if o["m"] is m and o["benchmark"] == ANCHOR and o["raw"] is not None]
        if len(members) < 2 * EDGE + 1:
            raise SystemExit(f"observer: {m['metric']} has only {len(members)} funds to rank; nothing written")
        populations[m["metric"]] = members
        values = [o["raw"] for o in members]
        for o in members:
            o["rank"] = rank_fn(o["raw"], values)
            o["z"] = z_fn(o["raw"], values)
            o["rv"] = rv_fn(o["rank"], o["z"])
            o["mean"], o["std"] = statistics.mean(values), statistics.stdev(values)
            o["n"] = len(values)

    for o in objects:
        m = o["m"]
        ranked = "rank" in o
        n = o.get("n")
        elevated = ranked and (o["rank"] <= EDGE or o["rank"] >= n - (EDGE - 1))
        o["elevated"] = bool(elevated)
        unit = "label" if o["raw"] is None else "ratio points" if m["kind"] == "change" else "ratio"
        value: Any = rounded(o["raw"]) if o["raw"] is not None else f"not_reported_{o['why']}"
        unranked = (f"Not ranked: ranks use {ANCHOR} on every fund." if o["benchmark"] != ANCHOR
                    else "Not ranked: this object has no value.")
        body = {
            "id": f"{m['metric']}/{o['subject']}/{report_date}",
            "metric": m["metric"],
            "subject": o["subject"],
            "report_date": report_date,
            "value": value,
            "unit": unit,
            "observations": [
                {"rel_ob": "rel_ob_rank", "value": o.get("rank"), "n": n,
                 "note": f"Position among {n} funds on {ANCHOR}, 1 is numerically highest." if ranked else unranked},
                {"rel_ob": "rel_ob_z", "value": rounded(o.get("z")), "n": n,
                 "mean": rounded(o.get("mean")), "std": rounded(o.get("std")),
                 "note": "Standard score against that population, sample standard deviation." if ranked else unranked},
            ],
            "relative_value": rounded(o.get("rv")),
            **o["extra"],
            "trust": {"disclosure": "open", "formula": m["formula"]},
            "verify": o["verify"],
        }
        finished.append({"o": o, "body": body})

    def weight(item: dict[str, Any]) -> tuple:
        rv = item["o"].get("rv")
        return (rv is None, -(rv or 0.0), item["body"]["id"])

    finished.sort(key=weight)
    return finished, populations


# --- writing it ---------------------------------------------------------------


class Dumper(yaml.SafeDumper):
    pass


def _text(dumper: yaml.SafeDumper, value: str) -> yaml.Node:
    style = "|" if "\n" in value else None
    return dumper.represent_scalar("tag:yaml.org,2002:str", value, style=style)


Dumper.add_representer(str, _text)
Dumper.ignore_aliases = lambda self, data: True  # type: ignore[assignment]


def dump(data: Any) -> str:
    return yaml.dump(data, Dumper=Dumper, sort_keys=False, allow_unicode=True, width=100)


def with_front(front: dict[str, Any], body: str) -> str:
    return f"---\n{dump(front)}---\n\n{body.strip()}\n"


def csv_text(tables: dict) -> tuple[str, int]:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(COLUMN_NAMES)
    count = 0
    for key in sorted(tables):
        row = tables[key]
        writer.writerow(["" if row[c] is None else repr(row[c]) if isinstance(row[c], float) else row[c]
                         for c in COLUMN_NAMES])
        count += 1
    return out.getvalue(), count


def anchor(heading: str) -> str:
    return re.sub(r"[^a-z0-9_-]", "", heading.lower())


def number(value: float) -> str:
    return f"{value:.2f}".replace("-", "−")


def signed(value: float) -> str:
    text = f"{abs(value):.2f}"
    return f"{'+' if value >= 0 else chr(0x2212)}{text}"


def leaders(populations: dict, m: dict[str, Any]) -> tuple[list[dict], list[dict]]:
    ordered = sorted(populations[m["metric"]], key=lambda o: (-o["raw"], o["ticker"]))
    return ordered[:EDGE], ordered[-EDGE:]


def table_for(m: dict[str, Any], populations: dict, report_date: str) -> str:
    high, low = leaders(populations, m)
    change = m["kind"] == "change"
    head = "| Position | Fund | Value |" + (" Then | Now | Inside the noise band |" if change else "")
    rule = "|---|---|---|" + ("---|---|---|" if change else "")
    lines = [f"### {m['label']}", "", head, rule]
    for o in (*high, *low):
        heading = f"{m['metric']}/{o['subject']}/{report_date}"
        shown = signed(o["raw"]) if change else number(o["raw"])
        row = f"| {o['rank']} of {o['n']} | [{o['ticker']}](#{anchor(heading)}) | {shown} |"
        if change:
            c = o["extra"]["comparison"]
            row += f" {number(c['then'])} | {number(c['now'])} | {'yes' if c['within_band'] else 'no'} |"
        lines.append(row)
    return "\n".join(lines)


def build_folder(out: Path, at: str, previous_log: str | None) -> dict[str, Any]:
    registry = read_registry()
    tables, current, month, report_date, floor, sources = load_archive(registry)
    engine = json.loads(subprocess.run(
        ["node", str(ROOT / "scripts" / "observer-engine.mjs")],
        check=True, capture_output=True, text=True,
    ).stdout)
    checks = gate(tables, engine, floor)
    finished, populations = build_objects(tables, current, registry, month, report_date, floor, engine)

    csv_body, rows = csv_text(tables)
    columns = len(COLUMNS)
    notice = (
        f"`{RAW}`: {rows} rows × {columns} columns. Trust verification with select columns and rows only. "
        "Full data set only intended for full reading when verification of values reported in "
        "`2.0_VALENCE.md` and/or `3.0_PERCEPTION.md` is explicitly requested by the user or "
        "programmatically mandated by the assigned workflow."
    )
    generated = {"by": BUILDER, "at": at}
    months = sorted({k[2] for k in tables})
    elevated = [f for f in finished if f["o"]["elevated"]]
    purpose = (
        f"How much of the market’s rises and falls each of {len(current)} options-integrated funds carried, "
        f"and how that moved, as of {report_date}, with the highest and lowest five funds on each of "
        f"{len(METRICS)} measures."
    )
    bands = engine["bands"]

    index_front = {
        "type": "OBSERVER Index",
        "navigation": {
            "layer": "1 of 4", "entry": "1.0_INDEX.md", "down": "2.0_VALENCE.md",
            "note": "Layer 1 of 4: the contract for this Observer: what it measures, every formula, and the rule that decides which values are elevated. The elevated results are in 2.0_VALENCE.md; report history is in 1.1_LOG.md.",
        },
        "observer_version": "0.1",
        "observer_id": OBSERVER_ID,
        "title": TITLE,
        "publisher": "Third Floor",
        "purpose": purpose,
        "report_date": report_date,
        "cadence": "monthly",
        "transparency": "open",
        "license": "CC-BY-4.0",
        "runtime": {"language": "python", "version": ">=3.10", "dependencies": ["pyyaml"]},
        "generated": generated,
        "stale_after": (datetime.fromisoformat(report_date).replace(tzinfo=timezone.utc)
                        + timedelta(days=45)).isoformat(),
        "sources": [{"name": s, "note": "Daily closing prices adjusted for distributions, for the funds and their benchmarks. The prices are not republished here."} for s in sources],
        "complexity": {
            "raw": {"n": rows, "p": columns},
            "compute": {"n": rows, "p": len({c for m in METRICS for c in m["inputs"]}) + len(METRICS) + 3},
            "perception": {"n": len(finished), "p": len(METRICS) + 3},
            "valence": {"n": len(elevated), "p": 2},
        },
        "raw_data": {
            "files": [{
                "path": RAW, "format": "csv", "rows": rows, "key": KEY,
                "columns": [{"name": n, "type": t, "description": d} for n, t, d in COLUMNS],
            }],
            "availability": "included",
            "reading_notice": notice,
        },
        "metrics": [
            {"metric": m["metric"], "description": m["description"], "formula": m["formula"],
             "disclosure": "open", "utility": m["utility"], "inputs": m["inputs"]}
            for m in METRICS
        ],
        "valence": {
            "relative_obs": [
                {"id": "rel_ob_rank", "name": "Position among the funds", "comparison": "cross_sectional",
                 "population": f"Every fund with a value for this metric against {ANCHOR} at this report date: the perception objects of that metric whose subject ends in .{ANCHOR} and whose value is a number. Funds without a value are left out and say why. Computed on unrounded values.",
                 "formula": REL_OB_RANK, "disclosure": "open"},
                {"id": "rel_ob_z", "name": "Standard score among the funds", "comparison": "cross_sectional",
                 "population": "The same population as rel_ob_rank, using its mean and sample standard deviation.",
                 "formula": REL_OB_Z, "disclosure": "open"},
            ],
            "relative_value": {
                "description": "The absolute standard score, so direction is discarded. Objects outside the population have null. It orders the objects in these files; which objects are elevated is decided by rel_ob_rank.",
                "formula": RELATIVE_VALUE, "disclosure": "open",
            },
            "elevation": {"rule": ELEVATION_RULE, "order": "descending"},
        },
    }

    band_lines = "\n".join(
        f"* {m['label']}: {bands[m['horizon']][str(m['lookback'])]:.2f}"
        for m in METRICS if m["kind"] == "change"
    )
    index_body = f"""# {TITLE}

{purpose}

Report date **{report_date}**, covering monthly reports from {months[0]} to {months[-1]}. An OBSERVER Folder, conformant with OBSERVER Format 0.1.

# Folder

* [Valence](2.0_VALENCE.md) — The highest and lowest five funds on each measure.
* [Perception](3.0_PERCEPTION.md) — Every computed value, including each fund’s own benchmark.
* [Log](1.1_LOG.md) — Report history and contract changes.
* [Raw data]({RAW}) — {rows} rows × {columns} columns; see `raw_data` above for the dictionary and the reading notice.
* [Replication](references/replicate.py) — Recomputes every value, observation and rank from this folder alone.

## Reading it

Every object carries a `trust` formula, a Python function named after its metric, and a `verify` field naming the rows and columns it reads. `references/replicate.py` does this for the whole folder.

## What this folder can and cannot show

Capture, semibeta and every change recompute here from the stored sums and quadrant moments. Those inputs themselves come from daily adjusted closes, which are not republished, so a reader can check everything from the sums onward and not how days became sums. `growth_fund`, `growth_benchmark` and `r_squared` are inputs in the same way. Adjusted closes drift as funds distribute, so a fresh pull of prices will not reproduce older months exactly.

Evolution reads matched windows: thirteen weeks against the thirteen before, and six months against the six before. Each pair sits end to end, sharing only its boundary day.

Up-minus-down figures and opposite-direction semibeta are left out on purpose: neither could be told from noise when tested.

## Noise bands

A change inside its band is one the same days, dealt into the two windows at random by the week, produced routinely:

{band_lines}

## Limits

{chr(10).join('* ' + n for n in NOTICES)}

## Gaps

A fund with no value for a metric still has an object, with a label in place of the value and the reason in `verify.notes`. Blocked windows are empty in the raw table and are never filled or shortened.
"""

    def object_block(item: dict[str, Any], valence_rank: int | None = None) -> str:
        body = dict(item["body"])
        if valence_rank is None:
            fields = list(body.items())
            spot = list(body).index("relative_value") + 1
            ordered = dict(fields[:spot] + [("elevated", item["o"]["elevated"])] + fields[spot:])
        else:
            ordered = {"rank": valence_rank, "perception_ref": body["id"], **body}
        return f"## {body['id']}\n\n```yaml\n{dump(ordered)}```"

    rule_note = "Layer 2 of 4: the five highest and five lowest funds on each measure. The rules that selected them are in 1.0_INDEX.md; every computed value is in 3.0_PERCEPTION.md."
    valence_front = {
        "type": "OBSERVER Valence",
        "navigation": {"layer": "2 of 4", "entry": "1.0_INDEX.md", "up": "1.0_INDEX.md",
                       "down": "3.0_PERCEPTION.md", "note": rule_note},
        "observer_id": OBSERVER_ID,
        "report_date": report_date,
        "elevation_rule": ELEVATION_RULE,
        "object_count": len(elevated),
        "generated": generated,
    }
    tables_md = "\n\n".join(table_for(m, populations, report_date) for m in METRICS)
    valence_lead = f"""The five highest and five lowest funds on each measure, all against {ANCHOR}, as of {report_date}. Position 1 is the numerically highest value and is not a judgment: on the down-capture measures a high position is a larger share of the market’s falls. These positions describe a past period and say nothing about what any fund does next.

On the change measures, “Inside the noise band: yes” marks a change that could not be told from the same days dealt out at random. Funds whose own benchmark is not {ANCHOR} rank partly on that mismatch, and their objects say so. The limits are in `1.0_INDEX.md`.

The tables are the whole result. The objects below them carry each value’s formula and inputs, ordered by standard score across all measures.
"""
    valence_objects = "\n\n".join(object_block(item, i) for i, item in enumerate(elevated, 1))
    valence = with_front(valence_front, f"{valence_lead}\n{tables_md}\n\n## Objects\n\n{valence_objects}")

    perception_front = {
        "type": "OBSERVER Perception",
        "navigation": {"layer": "3 of 4", "entry": "1.0_INDEX.md", "up": "2.0_VALENCE.md",
                       "down": RAW, "note": f"Layer 3 of 4: every computed value. The contract is in 1.0_INDEX.md. {notice}"},
        "observer_id": OBSERVER_ID,
        "report_date": report_date,
        "object_count": len(finished),
        "generated": generated,
    }
    perception = with_front(perception_front, "\n\n".join(object_block(i) for i in finished))

    entry_note = "This folder is an OBSERVER Folder. Its contract and folder map are in 1.0_INDEX.md. README.md, AGENTS.md and CLAUDE.md are identical copies; reading one makes the other two unnecessary."
    entry = with_front(
        {"type": "OBSERVER Entry",
         "navigation": {"layer": "entry", "entry": "1.0_INDEX.md", "down": "1.0_INDEX.md", "note": entry_note}},
        f"""# {TITLE}

This folder is an OBSERVER Folder: a quantitative analysis arranged so the most important results come first, each with its formula and its raw inputs attached. Specification: [OBSERVER Format, version 0.1]({SPEC_URL}).

{purpose}

Report date **{report_date}**. These figures describe past periods and are not advice.

## Reading order

1. `1.0_INDEX.md`: what this Observer measures and the rules that decide which results reach the top layer. Its frontmatter alone is enough to judge relevance.
2. `2.0_VALENCE.md`: the five highest and five lowest funds on each of {len(METRICS)} measures. For most tasks, the tables at its top are enough.
3. `3.0_PERCEPTION.md`: all {len(finished)} computed values, for context.
4. {notice}

`1.1_LOG.md` holds the report history and any changes to the rules. `references/replicate.py` recomputes the folder from itself.

README.md, AGENTS.md and CLAUDE.md in this folder are identical copies. Reading one makes the other two unnecessary.
""",
    )

    report_entry = (f"## {report_date}\n"
                    f"* **Report**: {len(finished)} perception objects; {len(elevated)} elevated to valence.\n"
                    f"* **Data**: {rows} rows × {columns} columns in {RAW}, reports {months[0]} to {months[-1]}.\n")
    log_head = with_front(
        {"type": "OBSERVER Log",
         "navigation": {"layer": "1.1 (history of layer 1)", "entry": "1.0_INDEX.md", "up": "1.0_INDEX.md",
                        "note": "Report history and contract changes for this Observer. The current contract is in 1.0_INDEX.md."}},
        "# Observer Log",
    )
    if previous_log and "\n## " in previous_log:
        earlier = previous_log[previous_log.index("\n## ") + 1:]
        earlier = re.sub(rf"^## {re.escape(report_date)}\n(?:(?!## ).*\n?)*", "", earlier, flags=re.M).strip()
    else:
        earlier = ""
    contract = ""
    if previous_log and f"## {report_date}" in previous_log:
        section = previous_log[previous_log.index(f"## {report_date}"):]
        section = section.split("\n## ")[0]
        contract = "".join(re.findall(r"(?m)^\* \*\*(?:Initialization|Contract|Correction)\*\*.*\n(?:  .*\n)*", section + "\n"))
    elif not previous_log:
        contract = (f"* **Initialization**: Observer published in OBSERVER Format 0.1.\n"
                    f"* **Contract**: {len(METRICS)} metrics; two cross-sectional relative observations; "
                    f"elevation of the {EDGE} highest and {EDGE} lowest funds on each metric against {ANCHOR}.\n")
    log = f"{log_head}\n{report_entry}{contract}" + (f"\n{earlier}\n" if earlier else "")

    prose = {
        "purpose": purpose, "index": re.sub(r"`[^`]*`", "", index_body),
        "valence": re.sub(r"`[^`]*`", "", valence_lead), "entry": re.sub(r"`[^`]*`", "", entry),
        **{f"metric/{m['metric']}": f"{m['label']}. {m['description']} {m['utility']}" for m in METRICS},
    }
    linted = subprocess.run(
        ["node", str(ROOT / "scripts" / "observer-engine.mjs"), "--lint"],
        input=json.dumps(prose), capture_output=True, text=True,
    )
    if linted.returncode != 0:
        raise SystemExit(f"observer: the copy lint refused the prose; nothing written\n{linted.stderr}")

    out.mkdir(parents=True, exist_ok=True)
    (out / "references").mkdir(exist_ok=True)
    files = {
        "1.0_INDEX.md": with_front(index_front, index_body),
        "1.1_LOG.md": log,
        "2.0_VALENCE.md": valence,
        "3.0_PERCEPTION.md": perception,
        RAW: csv_body,
        "README.md": entry, "AGENTS.md": entry, "CLAUDE.md": entry,
    }
    for name, text in files.items():
        (out / name).write_text(text, encoding="utf-8")
    shutil.copyfile(ROOT / "scripts" / "observer_replicate.py", out / "references" / "replicate.py")
    return {"checks": checks, "objects": len(finished), "elevated": len(elevated), "rows": rows,
            "report_date": report_date}


def without_clock(text: str) -> str:
    return re.sub(r"(?m)^(\s*)at: .*$", r"\1at: <build time>", text)


def snapshot(folder: Path) -> dict[str, str]:
    return {str(p.relative_to(folder)): without_clock(p.read_text(encoding="utf-8"))
            for p in sorted(folder.rglob("*")) if p.is_file()}


def package(path: Path) -> None:
    index = yaml.safe_load((TARGET / "1.0_INDEX.md").read_text(encoding="utf-8").split("---\n")[1])
    stamp = date.fromisoformat(str(index["report_date"])).timetuple()[:3] + (0, 0, 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        for file in sorted(p for p in TARGET.rglob("*") if p.is_file()):
            info = zipfile.ZipInfo(f"OBSERVER/{file.relative_to(TARGET).as_posix()}", stamp)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, file.read_bytes())
    print(f"build_observer: wrote {path}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--zip", type=Path)
    args = parser.parse_args()
    if args.zip:
        package(args.zip)
        return 0

    log_path = TARGET / "1.1_LOG.md"
    previous = log_path.read_text(encoding="utf-8") if log_path.exists() else None
    at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    with tempfile.TemporaryDirectory() as tmp:
        built = Path(tmp) / "OBSERVER"
        result = build_folder(built, at, previous)
        if args.check:
            if not TARGET.exists() or snapshot(built) != snapshot(TARGET):
                print("build_observer: OBSERVER/ is stale; run npm run build:observer", file=sys.stderr)
                return 1
            print(f"build_observer: OBSERVER/ is up to date, {result['checks']} gate checks")
            return 0
        if TARGET.exists():
            shutil.rmtree(TARGET)
        shutil.copytree(built, TARGET)
    print(f"build_observer: {result['objects']} objects, {result['elevated']} elevated, "
          f"{result['rows']} rows, {result['checks']} gate checks, report {result['report_date']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
