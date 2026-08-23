# SPDX-License-Identifier: MIT
"""Daily price history, from whichever source answers first.

3F D-06 inverts AGENTS.md's stated source order on evidence. Checked on
2026-08-23: Stooq's CSV endpoint served an HTML proof-of-work browser challenge
to every request, with and without a browser User-Agent and with and without a
date range, so `pandas.read_csv()` against it yields no usable data. yfinance
returned full history for all 35 instruments in the coverage set, and is the
only source of the three that hands back a dividend-adjusted close.

Stooq is kept in the ladder, not deleted: if it drops the challenge this
self-heals with no code change.

The guard below is the point of this module. A challenge page, a rate-limit
page and an error page all arrive as HTTP 200 with a body a CSV parser will
either mangle or reject confusingly. Every source must clear the guard before
its data is returned, because a snapshot built from a challenge page would be
committed to a permanent archive.
"""

from __future__ import annotations

import io
import time
import urllib.request
from dataclasses import dataclass
from datetime import date
from typing import Any, Callable

MIN_PLAUSIBLE_ROWS = 20

# A price series is a list of (date, adjusted close), ascending.
PriceSeries = list[tuple[date, float]]


class FetchRefused(Exception):
    """The response did not look like price data. Never returned as an empty frame."""


@dataclass(frozen=True)
class SourceRecord:
    ticker: str
    source: str
    rows: int
    first: date
    last: date
    price_basis: str

    def to_json(self) -> dict[str, Any]:
        return {
            "ticker": self.ticker,
            "source": self.source,
            "rows": self.rows,
            "first": self.first.isoformat(),
            "last": self.last.isoformat(),
            "price_basis": self.price_basis,
        }


def _guard(series: PriceSeries, ticker: str, source: str) -> None:
    """Refuse anything that is not plausibly a price history.

    Raises rather than returning a short or empty series, so a caller cannot
    accidentally treat a challenge page as a fund with little history.
    """
    if not series:
        raise FetchRefused(f"{source} returned no rows for {ticker}")
    if len(series) < MIN_PLAUSIBLE_ROWS:
        raise FetchRefused(
            f"{source} returned only {len(series)} rows for {ticker}; "
            f"at least {MIN_PLAUSIBLE_ROWS} are needed to be plausible"
        )
    dates = [d for d, _ in series]
    if dates != sorted(dates):
        raise FetchRefused(f"{source} returned unsorted dates for {ticker}")
    if len(set(dates)) != len(dates):
        raise FetchRefused(f"{source} returned duplicate dates for {ticker}")
    for d, price in series:
        if price is None or not (price > 0.0) or price != price:  # NaN != NaN
            raise FetchRefused(f"{source} returned a non-positive or missing price for {ticker} on {d}")


def _looks_like_html(text: str) -> bool:
    head = text.lstrip()[:400].lower()
    return head.startswith("<!doctype") or head.startswith("<html") or "<script" in head


# --- the sources ------------------------------------------------------------

def _from_yfinance(ticker: str, start: date | None) -> PriceSeries:
    import yfinance as yf

    t = yf.Ticker(ticker)
    frame = t.history(period="max", interval="1d", auto_adjust=False) if start is None \
        else t.history(start=start.isoformat(), interval="1d", auto_adjust=False)

    if frame is None or len(frame) == 0:
        raise FetchRefused(f"yfinance returned an empty frame for {ticker}")
    column = "Adj Close" if "Adj Close" in frame.columns else None
    if column is None:
        raise FetchRefused(
            f"yfinance returned no Adj Close for {ticker}; refusing to substitute "
            "the unadjusted close, which is a different statistic (3F D-08)"
        )
    return [
        (idx.date(), float(value))
        for idx, value in frame[column].items()
        if value == value and value is not None
    ]


def _from_stooq(ticker: str, start: date | None) -> PriceSeries:
    url = f"https://stooq.com/q/d/l/?s={ticker.lower()}.us&i=d"
    req = urllib.request.Request(url, headers={"User-Agent": "third-floor/0.1 (+monthly ETF report)"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8", "replace")

    if _looks_like_html(body):
        raise FetchRefused(
            f"stooq served an HTML page rather than CSV for {ticker} — most likely "
            "its browser-verification challenge (3F D-06)"
        )

    import csv as _csv

    rows = list(_csv.DictReader(io.StringIO(body)))
    if not rows or "Close" not in (rows[0].keys() if rows else {}):
        raise FetchRefused(f"stooq returned no Close column for {ticker}")

    out: PriceSeries = []
    for r in rows:
        try:
            d = date.fromisoformat(r["Date"])
        except (ValueError, KeyError, TypeError):
            continue
        if start is not None and d < start:
            continue
        try:
            out.append((d, float(r["Close"])))
        except (ValueError, TypeError):
            continue
    return out


def _from_yahoo_chart(ticker: str, start: date | None) -> PriceSeries:
    import json as _json

    rng = "max" if start is None else "10y"
    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
        f"?range={rng}&interval=1d&events=div%2Csplit"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; third-floor/0.1)"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8", "replace")

    if _looks_like_html(body):
        raise FetchRefused(f"yahoo chart served an HTML page rather than JSON for {ticker}")

    payload = _json.loads(body)
    result = (payload.get("chart") or {}).get("result") or []
    if not result:
        raise FetchRefused(f"yahoo chart returned no result for {ticker}")

    node = result[0]
    stamps = node.get("timestamp") or []
    adj = ((node.get("indicators") or {}).get("adjclose") or [{}])[0].get("adjclose") or []
    if not stamps or not adj:
        raise FetchRefused(f"yahoo chart returned no adjusted closes for {ticker}")

    from datetime import datetime, timezone

    out: PriceSeries = []
    for ts, value in zip(stamps, adj):
        if value is None or value != value:
            continue
        d = datetime.fromtimestamp(ts, tz=timezone.utc).date()
        if start is not None and d < start:
            continue
        out.append((d, float(value)))
    return out


# Ordered ladder. First source to clear the guard wins. The price basis each
# source actually provides is recorded, never assumed — Stooq's Close is split
# adjusted but not dividend adjusted, which is a different statistic.
SOURCES: tuple[tuple[str, Callable[[str, date | None], PriceSeries], str], ...] = (
    ("yfinance", _from_yfinance, "close_adjusted"),
    ("stooq", _from_stooq, "close_unadjusted"),
    ("yahoo_chart", _from_yahoo_chart, "close_adjusted"),
)


def fetch_daily_prices(
    ticker: str,
    start: date | None = None,
    throttle_seconds: float = 1.5,
    log: Callable[[str], None] = lambda _msg: None,
) -> tuple[PriceSeries, SourceRecord]:
    """Daily adjusted closes for one instrument, plus which source produced them.

    One bulk pull per instrument per run. With 31 tracked tickers and 4 anchors
    that is 36 calls a month, and the anchors are fetched once and shared across
    every fund that references them. What protects this workflow is request
    volume and burst rate, so the ladder throttles between attempts rather than
    retrying hard.
    """
    problems: list[str] = []
    for name, source, basis in SOURCES:
        try:
            series = source(ticker, start)
            _guard(series, ticker, name)
        except FetchRefused as exc:
            problems.append(f"{name}: {exc}")
            log(f"  {ticker}: {name} refused — {exc}")
            time.sleep(throttle_seconds)
            continue
        except Exception as exc:  # network, parse, import
            problems.append(f"{name}: {type(exc).__name__}: {exc}")
            log(f"  {ticker}: {name} failed — {type(exc).__name__}: {exc}")
            time.sleep(throttle_seconds)
            continue

        record = SourceRecord(ticker, name, len(series), series[0][0], series[-1][0], basis)
        log(f"  {ticker}: {name}, {len(series)} rows, {series[0][0]} to {series[-1][0]}")
        time.sleep(throttle_seconds)
        return series, record

    raise FetchRefused(
        f"no source returned usable data for {ticker}. Tried:\n    " + "\n    ".join(problems)
    )
