#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Gain Exposure, stage 1: draft a mechanism group per fund from SEC N-PORT.

Run from the repository root:
    python3 analysis/gain_exposure_2026-11/pull_holdings.py

For each fund's series, the latest public NPORT-P is read and its book is summed by
block: stocks, other funds, purchased calls, purchased puts, written calls, written
puts, cash and other. The group is drafted from the largest *block*, not the largest
single line, because a stock sleeve's largest line is one stock.

Where the largest block is other funds, the largest held fund is looked through one
level (its own latest NPORT-P), so a ladder of buffer rungs is told apart from a fund
that simply holds an index ETF as its equity sleeve.

Output: grouping_draft.json beside this file. The owner confirms it; study.py reads
grouping.json, which is written only after that confirmation. SEC fair access:
throttled, identified with the project contact the repo already uses.
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
UA = {"User-Agent": "ThirdFloor-research admin@example.org"}  # as notebook/thirdfloor/fees.py
SEC = "https://www.sec.gov"
_cache: dict[str, str] = {}


def get(url: str) -> str:
    if url not in _cache:
        time.sleep(0.25)
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=120) as r:
            _cache[url] = r.read().decode("utf-8", "ignore")
    return _cache[url]


def latest_nport(series_id: str) -> tuple[str, str] | None:
    feed = get(f"{SEC}/cgi-bin/browse-edgar?action=getcompany&CIK={series_id}"
               f"&type=NPORT-P&owner=include&count=10&output=atom")
    rows = re.findall(r"<filing-date>([^<]+)</filing-date>\s*<filing-href>([^<]+)</filing-href>"
                      r"\s*<filing-type>NPORT-P</filing-type>", feed)
    if not rows:
        return None
    rows.sort(reverse=True)
    idx = get(rows[0][1])
    m = re.search(r'href="(/Archives/[^"x]+/primary_doc\.xml)"', idx)
    return (rows[0][1], SEC + m.group(1)) if m else None


def tag(s: str, name: str) -> str | None:
    m = re.search(rf"<{name}>([^<]*)</{name}>", s)
    return m.group(1) if m else None


def parse(doc: str) -> dict:
    out = {"period": tag(doc, "repPdDate"), "series_name": tag(doc, "seriesName"), "lines": []}
    for s in re.findall(r"<invstOrSec>.*?</invstOrSec>", doc, re.S):
        pct = float(tag(s, "pctVal") or 0)
        cat = tag(s, "assetCat") or ""
        opt = re.search(r"<putOrCall>(\w+)</putOrCall>\s*<writtenOrPur>(\w+)</writtenOrPur>", s)
        tick = re.search(r'<identifiers>\s*(?:<isin[^>]*>\s*)?<ticker value="([^"]+)"', s)
        ref = re.search(r"<descRefInstrmnt>.*?<ticker value=\"([^\"]+)\"", s, re.S)
        if opt:
            block = f"{opt.group(2).lower()}_{opt.group(1).lower()}"  # purchased_call ...
        elif cat == "RF" or (cat == "EC" and "ETF" in (tag(s, "title") or "").upper()):
            # N-PORT files ETF shares as equity; an ETF held is a fund, to look through.
            block = "funds"
        elif cat == "EC":
            block = "stocks"
        elif cat in ("STIV", "DBT") or "Treasury" in (tag(s, "title") or ""):
            block = "cash_bills"
        else:
            block = "other:" + cat
        out["lines"].append({
            "title": tag(s, "title"), "ticker": tick.group(1) if tick else None,
            "underlying": ref.group(1) if ref else None, "assetCat": cat,
            "block": block, "pct": pct, "strike": tag(s, "exercisePrice"), "expiry": tag(s, "expDt"),
        })
    return out


def blocks(lines: list[dict]) -> dict[str, float]:
    b: dict[str, float] = {}
    for l in lines:
        b[l["block"]] = b.get(l["block"], 0.0) + l["pct"]
    return dict(sorted(b.items(), key=lambda kv: -abs(kv[1])))


def mf_index() -> dict[str, str]:
    data = json.loads(get(f"{SEC}/files/company_tickers_mf.json"))
    f = data["fields"]
    return {row[f.index("symbol")]: row[f.index("seriesId")] for row in data["data"]}


def draft(b: dict[str, float], look: dict | None) -> tuple[str, str]:
    top = next(iter(b))
    if top == "purchased_call":
        return "synthetic_long", "purchased calls are the largest block"
    if top == "stocks":
        return "equity_sleeve_hedge", "stocks are the largest block, with options beside them"
    if top == "funds":
        if look is None:
            return "unresolved", "largest block is other funds; look-through not available"
        lb = look["blocks"]
        ltop = next(iter(lb))
        if ltop == "purchased_call":
            return "fund_of_funds", "holds options funds whose largest block is purchased calls (synthetic long rungs)"
        if ltop == "stocks" and not any(k.startswith(("purchased", "written")) for k in lb):
            return "equity_sleeve_hedge", "sleeve held through a plain index ETF, with options beside it"
        if ltop == "funds":
            return "fund_of_funds", "held fund itself holds funds"
        return "fund_of_funds", f"held fund's largest block is {ltop}"
    return "unresolved", f"largest block is {top}"


def main() -> int:
    reg = json.loads(Path("tickers.json").read_text())
    tick2series = mf_index()
    out = []
    for f in reg["tickers"]:
        t, sid = f["ticker"], f.get("sec_series_id")
        print(t, file=sys.stderr, flush=True)
        rec = {"ticker": t, "name": f["name"], "issuer": f["issuer"], "category": f["category"]}
        found = latest_nport(sid) if sid else None
        if found is None:
            rec.update(group="unresolved", reason="no NPORT-P found"); out.append(rec); continue
        index_url, doc_url = found
        p = parse(get(doc_url))
        b = blocks(p["lines"])
        biggest = max(p["lines"], key=lambda l: abs(l["pct"]))
        look = None
        if next(iter(b)) == "funds":
            # Largest held fund whose ticker EDGAR can resolve to a series.
            held_all = sorted((l for l in p["lines"] if l["block"] == "funds"), key=lambda l: -l["pct"])
            held = next((l for l in held_all if tick2series.get(l["ticker"] or "")), held_all[0])
            hs = tick2series.get(held["ticker"] or "")
            lf = latest_nport(hs) if hs else None
            if lf:
                lp = parse(get(lf[1]))
                look = {"ticker": held["ticker"], "title": held["title"], "pct": held["pct"],
                        "period": lp["period"], "source": lf[0],
                        "blocks": {k: round(v, 2) for k, v in blocks(lp["lines"]).items()}}
            else:
                look = None
                rec["look_through_missing"] = held["ticker"]
            n_funds = sum(1 for l in p["lines"] if l["block"] == "funds")
            rec["held_funds_count"] = n_funds
        group, reason = ("reference_only", "managed futures; outside both groups") \
            if f["category"] == "managed_futures" else draft(b, look)
        rec.update(
            period=p["period"], source=index_url, group=group, reason=reason,
            blocks={k: round(v, 2) for k, v in b.items()},
            largest_line={k: biggest[k] for k in ("title", "ticker", "underlying", "block", "pct", "strike", "expiry")},
            look_through=look,
        )
        out.append(rec)
    (HERE / "grouping_draft.json").write_text(json.dumps(out, indent=1))
    for r in out:
        print(f'{r["ticker"]:5} {r.get("period","")} {r["group"]:20} {json.dumps(r.get("blocks",{}))[:110]}')
    return 0


if __name__ == "__main__":
    sys.exit(main())
