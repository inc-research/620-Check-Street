#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Gain Exposure, stage 4: results.json -> the selected report the site reads (3F D-25).

Run from the repository root:
    python3 analysis/gain_exposure_2026-11/export.py          # writes data/_studies/gain-exposure-2026-11.json
    python3 analysis/gain_exposure_2026-11/export.py --check  # fails if the committed file is stale

Only what the page draws, rounded to five decimals, plus where every figure came
from. The page renders this document and never recomputes it (INV-5). The
identities it carries are checked by packages/core/src/study/validate.ts.
"""
from __future__ import annotations

import argparse
import html
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
OUT = REPO / "data/_studies/gain-exposure-2026-11.json"
ID = "gain-exposure-2026-11"
DP = 5


def r(x):
    return None if x is None else round(x, DP)


def summary(s):
    return None if s is None else {k: (r(v) if isinstance(v, float) else v) for k, v in s.items()}


def holdings(g: dict) -> dict:
    lt = g.get("look_through")
    return {
        "period": g.get("period"),
        "source": g.get("source"),
        "blocks": g.get("blocks"),
        "reason": g.get("reason"),
        "look_through": None if not lt else {
            "ticker": lt.get("ticker"),
            "title": html.unescape(lt.get("title") or ""),
            "period": lt.get("period"),
            "source": lt.get("source"),
            "blocks": lt.get("blocks"),
        },
    }


def reading(x: dict) -> dict:
    c, (s4, s5) = x["capture"], x["special"]
    bs = x["bootstrap"]
    return {
        "first_day": x["ytd_first_day"],
        "days": x["ytd_days"],
        "up_days": c["up_days"], "down_days": c["down_days"], "flat_days": c["flat_days"],
        "sums": {"fund_up": r(c["sum_fund_up"]), "bench_up": r(c["sum_bench_up"]),
                 "fund_down": r(c["sum_fund_down"]), "bench_down": r(c["sum_bench_down"])},
        "u": r(c["u"]), "b": r(c["b"]), "u_plus_b": r(c["u_plus_b"]), "E": r(c["E"]),
        "E_range": [r(v) for v in bs["E"]] if bs["E"] else None,
        "E_settled": bs["E_settled"],
        "market_gain_loss": r(x["market_gain_loss_ratio"]),
        "fund_net_sum": r(x["fund_net_sum"]), "bench_net_sum": r(x["bench_net_sum"]),
        "nov4": {"fund": r(s4["fund"]), "bench": r(s4["bench"]), "kept": r(s4["day_capture"]),
                 "rank": s4["bench_move_rank_vs_ytd"]},
        "nov5": {"fund": r(s5["fund"]), "bench": r(s5["bench"]), "avoided": r(s5.get("day_buffer")),
                 "given_back_fund": r(s5.get("takeback_fund")), "given_back_bench": r(s5.get("takeback_bench")),
                 "E": r(s5.get("E_day")), "rank": s5["bench_move_rank_vs_ytd"], "of": s5["ytd_days"]},
        "bands": {k: {"u": r(v["u"]), "b": r(v["b"]), "up_days": v["up_days"], "down_days": v["down_days"]}
                  for k, v in x["bands"].items()},
        "both_up": {"capture": r(x["quadrants"]["both_up"]["capture"]), "days": x["quadrants"]["both_up"]["days"]},
        "both_down": {"capture": r(x["quadrants"]["both_down"]["capture"]), "days": x["quadrants"]["both_down"]["days"]},
        "legs": {side: [[d, r(cf), r(cb)] for d, cf, cb in pts] for side, pts in x["legs"].items()},
    }


def build() -> str:
    res = json.loads((HERE / "results.json").read_text())
    grouping = json.loads((HERE / "grouping.json").read_text())
    gby = {f["ticker"]: f for f in grouping["funds"]}
    funds = []
    for f in res["funds"]:
        funds.append({
            "ticker": f["ticker"], "name": f["name"], "issuer": f["issuer"],
            "group": f["group"], "subgroup": f["subgroup"], "flag": f["flag"],
            "named_benchmark": f["named_benchmark"],
            "holdings": holdings(gby.get(f["ticker"], {})),
            "readings": {bn: reading(x) for bn, x in f["benchmarks"].items()},
        })
    inp = res["inputs"]
    doc = {
        "app": "Third Floor",
        "kind": "selected_report",
        "study_schema_version": "1.0",
        "id": ID,
        "title": "Gain Exposure: With a Special Focus on November 4th and 5th, 2026",
        "published": "2026-11-09",
        "window": {"start": inp["ytd"][0], "end": inp["ytd"][1]},
        "special_days": inp["special"],
        "provenance": {
            "prices_fetched_at": inp["prices_fetched_at"],
            "price_basis": inp["price_basis"],
            "price_source": "yfinance",
            "holdings_source": "SEC EDGAR NPORT-P, latest public filing per fund",
            "grouping_approved": inp["grouping_approved"],
            "grouping_rule": inp["grouping_rule"],
            "bootstrap": inp["bootstrap"],
            "min_days_to_report": inp["min_days_to_report"],
            "analysis": "analysis/gain_exposure_2026-11",
        },
        "benchmarks": {bn: {"moves": {d: r(v) for d, v in b["special"].items()},
                            "band_edges": {k: r(v) for k, v in b["edges"].items()}}
                       for bn, b in res["benchmarks"].items()},
        "funds": funds,
        "summaries": {basis: {k: {kk: (summary(vv) if isinstance(vv, dict) and "median" in vv
                                       else {bk: {"u": summary(bv["u"]), "b": summary(bv["b"])} for bk, bv in vv.items()}
                                       if kk == "bands" else vv)
                                  for kk, vv in s.items()}
                              for k, s in sm.items()}
                      for basis, sm in res["summaries"].items()},
    }
    return json.dumps(doc, separators=(",", ":"), ensure_ascii=False) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    text = build()
    if ap.parse_args().check:
        if not OUT.exists() or OUT.read_text() != text:
            print(f"{OUT.relative_to(REPO)} is stale: rerun analysis/gain_exposure_2026-11/export.py", file=sys.stderr)
            return 1
        print(f"{OUT.relative_to(REPO)} is current")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(text)
    print(f"wrote {OUT.relative_to(REPO)} ({len(text) // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
