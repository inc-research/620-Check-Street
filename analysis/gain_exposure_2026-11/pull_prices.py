#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Gain Exposure, stage 2: one throttled pull per instrument, cached outside the repository.

Run from the repository root:
    PYTHONPATH=notebook python3 analysis/gain_exposure_2026-11/pull_prices.py --out <cache.json>

Uses the project's guarded fetch ladder unchanged. Writes the cache and nothing else;
it is not committed (yfinance data, as with analysis/capture_trend.py). If the cache exists it refuses to pull again (delete it to
re-pull) so the 35-pull ceiling is respected.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

from thirdfloor.fetch import fetch_daily_prices
from thirdfloor.registry import load_registry

HERE = Path(__file__).resolve().parent
START = date(2025, 12, 15)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=HERE / "prices.json")
    out = ap.parse_args().out
    if out.exists():
        print(f"{out} exists; not pulling again", file=sys.stderr)
        return 0
    reg = load_registry("tickers.json")
    instruments = reg.instruments
    fetched_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    prices, sources = {}, {}
    for i, t in enumerate(instruments, 1):
        print(f"[{i}/{len(instruments)}] {t}", file=sys.stderr, flush=True)
        series, rec = fetch_daily_prices(t, START, log=lambda m: print(m, file=sys.stderr))
        prices[t] = [(d.isoformat(), p) for d, p in series]
        sources[t] = rec.source
    out.write_text(json.dumps({"fetched_at": fetched_at, "start": START.isoformat(),
                               "sources": sources, "prices": prices}))
    print(f"wrote {out}: {len(prices)} instruments", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
