# SPDX-License-Identifier: MIT
"""Consumer prices and Treasury bill yields, from FRED (3F D-23).

Two series:

- **CPIAUCNS**: the consumer price index for all urban consumers, not
  seasonally adjusted. Monthly. Not seasonally adjusted because the seasonally
  adjusted series is revised every year, and a figure the page has already shown
  should not move without anything having happened. Over a whole window the
  seasonal pattern washes out of a ratio of two index levels anyway.
- **DGS3MO**: the three-month Treasury yield, constant maturity, in percent.
  Daily. A bond-equivalent yield, so it compounds directly, unlike the
  discount-basis auction rate.

The ladder is the FRED API with a key, then FRED's keyless CSV download. As
with prices (3F D-06), every source has to pass the guard before its data is
used, and a page that is not the series is refused, never parsed loosely.

The key is never written into the notebook or the repository. It is read from
the `FRED_API_KEY` environment variable, then from Colab's secrets, then from a
local file named by `FRED_API_KEY_FILE` (or `fred_opendoors.txt` at the repo
root, which is gitignored).
"""

from __future__ import annotations

import csv
import io
import json
import math
import os
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Callable

SERIES = {
    "CPIAUCNS": {
        "title": "Consumer Price Index for All Urban Consumers: All Items in U.S. City Average, not seasonally adjusted",
        "units": "index, 1982-1984 = 100",
        "frequency": "monthly",
    },
    "DGS3MO": {
        "title": "Market Yield on U.S. Treasury Securities at 3-Month Constant Maturity, Quoted on an Investment Basis",
        "units": "percent per year",
        "frequency": "daily",
    },
}

RATES_SCHEMA_VERSION = "1.0"
MIN_PLAUSIBLE_ROWS = 12

Getter = Callable[[str], bytes]


class RatesRefused(Exception):
    """A response that is not the series. Raised and fallen through, never returned short."""


def http_get(url: str) -> bytes:
    time.sleep(0.5)
    request = urllib.request.Request(url, headers={"User-Agent": "ThirdFloor-research"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def find_api_key(repo_root: str | Path | None = None) -> str | None:
    key = os.environ.get("FRED_API_KEY")
    if key:
        return key.strip()
    try:  # pragma: no cover - only inside Colab
        from google.colab import userdata  # type: ignore

        key = userdata.get("FRED_API_KEY")
        if key:
            return key.strip()
    except Exception:
        pass
    candidates = [os.environ.get("FRED_API_KEY_FILE")]
    if repo_root is not None:
        candidates.append(str(Path(repo_root) / "fred_opendoors.txt"))
    for path in candidates:
        if path and Path(path).is_file():
            key = Path(path).read_text(encoding="utf-8").strip()
            if key:
                return key
    return None


@dataclass(frozen=True)
class Series:
    series_id: str
    source: str
    observations: tuple[tuple[str, float], ...]
    missing_days: int

    def to_json(self, fetched_at: str) -> dict[str, Any]:
        meta = SERIES[self.series_id]
        return {
            "app": "Third Floor",
            "rates_schema_version": RATES_SCHEMA_VERSION,
            "series_id": self.series_id,
            "title": meta["title"],
            "units": meta["units"],
            "frequency": meta["frequency"],
            "source": self.source,
            "source_url": f"https://fred.stlouisfed.org/series/{self.series_id}",
            "fetched_at": fetched_at,
            "missing_days_dropped": self.missing_days,
            "observations": [[d, v] for d, v in self.observations],
        }


def guard(series_id: str, rows: list[tuple[str, str]], source: str) -> Series:
    """Sorted, unique, every value positive and finite; FRED's '.' for a day
    with no reading is counted and dropped rather than read as zero."""
    out: list[tuple[str, float]] = []
    missing = 0
    for d, v in rows:
        try:
            date.fromisoformat(d)
        except ValueError as exc:
            raise RatesRefused(f"{series_id} from {source}: {d!r} is not a date") from exc
        if v.strip() in (".", ""):
            missing += 1
            continue
        try:
            value = float(v)
        except ValueError as exc:
            raise RatesRefused(f"{series_id} from {source}: {v!r} is not a number") from exc
        if not math.isfinite(value) or value < 0.0 or (series_id == "CPIAUCNS" and value <= 0.0):
            raise RatesRefused(f"{series_id} from {source}: implausible value {value} on {d}")
        out.append((d, value))
    if len(out) < MIN_PLAUSIBLE_ROWS:
        raise RatesRefused(f"{series_id} from {source}: only {len(out)} usable rows")
    dates = [d for d, _ in out]
    if dates != sorted(dates) or len(set(dates)) != len(dates):
        raise RatesRefused(f"{series_id} from {source}: dates are not sorted and unique")
    return Series(series_id, source, tuple(out), missing)


def _looks_like_html(raw: bytes) -> bool:
    head = raw[:512].lstrip().lower()
    return head.startswith(b"<!doctype html") or head.startswith(b"<html")


def from_api(series_id: str, start: date, key: str, get: Getter = http_get) -> Series:
    query = urllib.parse.urlencode(
        {"series_id": series_id, "api_key": key, "file_type": "json", "observation_start": start.isoformat()}
    )
    raw = get(f"https://api.stlouisfed.org/fred/series/observations?{query}")
    if _looks_like_html(raw):
        raise RatesRefused(f"{series_id} from fred_api: a page, not the series")
    try:
        doc = json.loads(raw)
        rows = [(o["date"], o["value"]) for o in doc["observations"]]
    except (ValueError, KeyError, TypeError) as exc:
        raise RatesRefused(f"{series_id} from fred_api: not the expected JSON ({exc})") from exc
    return guard(series_id, rows, "fred_api")


def from_csv(series_id: str, start: date, get: Getter = http_get) -> Series:
    raw = get(
        f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}&cosd={start.isoformat()}"
    )
    if _looks_like_html(raw):
        raise RatesRefused(f"{series_id} from fred_csv: a page, not the series")
    reader = csv.reader(io.StringIO(raw.decode("utf-8", "ignore")))
    header = next(reader, None)
    if not header or len(header) < 2 or header[1].strip() != series_id:
        raise RatesRefused(f"{series_id} from fred_csv: unexpected header {header!r}")
    rows = [(r[0], r[1]) for r in reader if len(r) >= 2 and r[0] >= start.isoformat()]
    return guard(series_id, rows, "fred_csv")


def fetch_series(
    series_id: str,
    start: date,
    key: str | None,
    get: Getter = http_get,
    log: Callable[[str], None] = lambda _m: None,
) -> Series:
    errors = []
    if key:
        try:
            return from_api(series_id, start, key, get)
        except Exception as exc:  # fall through to the next source
            errors.append(f"fred_api: {exc}")
            log(f"  {series_id}: fred_api refused — {exc}")
    else:
        errors.append("fred_api: no key")
    try:
        return from_csv(series_id, start, get)
    except Exception as exc:
        errors.append(f"fred_csv: {exc}")
    raise RatesRefused(f"{series_id}: no source answered ({'; '.join(errors)})")


def merge_append_only(existing: dict[str, Any] | None, fresh: dict[str, Any]) -> dict[str, Any]:
    """The published series plus any later observations.

    Neither series is revised by its publisher, so an observation already
    committed that comes back different means something is wrong upstream.
    Refuse rather than rewrite history the page has already shown.
    """
    if not existing:
        return fresh
    old = {d: v for d, v in existing["observations"]}
    new = {d: v for d, v in fresh["observations"]}
    for d, v in old.items():
        if d in new and new[d] != v:
            raise RatesRefused(
                f"{fresh['series_id']}: the published value for {d} was {v}, the source now says {new[d]}"
            )
    merged = dict(old)
    merged.update({d: v for d, v in new.items() if d not in old})
    out = dict(fresh)
    out["observations"] = [[d, merged[d]] for d in sorted(merged)]
    return out
