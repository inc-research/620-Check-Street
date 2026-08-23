# SPDX-License-Identifier: MIT
"""The monthly run: fetch, compute, write, package.

Two modes. `--backfill` produces the full requested depth and is the first run.
The default produces the current month only, which is what the monthly cadence
needs — the archive is append-only (3F D-08), so a routine run adds one file per
ticker and rewrites nothing.

The zip carries a manifest and a log alongside the snapshots. A run whose
provenance is not recoverable a year later is not auditable, and this archive is
meant to be the raw material for a separate research effort with its own
hypotheses.
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

from .backfill import (
    DEFAULT_SNAPSHOT_COUNT,
    build_ticker_slices,
    fetch_start_for,
    monthly_snapshot_dates,
)
from .emit import build_all_snapshots
from .fetch import FetchRefused, PriceSeries, SourceRecord, fetch_daily_prices
from .registry import Registry, load_registry
from .semibeta import MIN_OBSERVATIONS_PER_CELL


def most_recent_completed_month_end(today: date) -> date:
    """Snapshots end with the last month that has finished.

    A part-month reading would be labelled with a month it does not cover, and
    next month's run would produce a different number under the same filename —
    which the append-only rule would then refuse to write.
    """
    year, month = (today.year, today.month - 1) if today.month > 1 else (today.year - 1, 12)
    from calendar import monthrange

    return date(year, month, monthrange(year, month)[1])


class Run:
    def __init__(self, registry_path: str | Path, out_dir: str | Path, verbose: bool = True):
        self.registry: Registry = load_registry(registry_path)
        self.out_dir = Path(out_dir)
        self.verbose = verbose
        self.lines: list[str] = []
        self.prices: dict[str, PriceSeries] = {}
        self.sources: dict[str, SourceRecord] = {}
        self.failures: dict[str, str] = {}
        self.started = datetime.now(timezone.utc)

    def log(self, message: str) -> None:
        self.lines.append(message)
        if self.verbose:
            print(message, flush=True)

    # --- fetch --------------------------------------------------------------

    def fetch_all(self, start: date | None, only: list[str] | None = None) -> None:
        instruments = self.registry.instruments
        if only:
            wanted = set(only) | set(self.registry.anchors)
            instruments = [t for t in instruments if t in wanted]

        self.log(f"fetching {len(instruments)} instruments from {start or 'inception'}")
        for i, ticker in enumerate(instruments, 1):
            self.log(f"[{i}/{len(instruments)}] {ticker}")
            try:
                series, record = fetch_daily_prices(ticker, start, log=self.log)
            except FetchRefused as exc:
                self.failures[ticker] = str(exc)
                self.log(f"  {ticker}: NO SOURCE — {exc}")
                continue
            self.prices[ticker] = series
            self.sources[ticker] = record

    # --- compute ------------------------------------------------------------

    def build(
        self,
        snapshot_dates: list[date],
        depth: int,
        min_observations: int = MIN_OBSERVATIONS_PER_CELL,
    ) -> dict[str, dict[str, dict[str, Any]]]:
        documents: dict[str, dict[str, dict[str, Any]]] = {}

        for fund in self.registry.funds:
            if fund.ticker not in self.prices:
                self.log(f"{fund.ticker}: skipped, no price data")
                continue

            benchmark_series = {
                b: self.prices[b] for b in fund.benchmarks if b in self.prices
            }
            missing = [b for b in fund.benchmarks if b not in self.prices]
            for b in missing:
                self.log(f"{fund.ticker}: benchmark {b} unavailable this run")
            if not benchmark_series:
                self.log(f"{fund.ticker}: skipped, no benchmark data")
                continue

            fund_series = self.prices[fund.ticker]
            slices = build_ticker_slices(
                fund_series, benchmark_series, snapshot_dates, min_observations
            )
            if not slices:
                self.log(
                    f"{fund.ticker}: no month in the requested range has a computable "
                    "horizon — too new for this archive"
                )
                continue

            record = self.sources[fund.ticker]
            docs = build_all_snapshots(
                fund,
                slices,
                inception=record.first,
                requested_depth=depth,
                price_basis=record.price_basis,
                price_source=record.source,
                min_observations=min_observations,
                generated_at=self.started,
            )
            documents[fund.ticker] = docs

            blocked = sum(
                1
                for doc in docs.values()
                for block in doc["benchmarks"].values()
                for h in block["horizons"]
                if h["states"] is None
            )
            baseline = docs[max(docs)]["coverage"]["earliest_full_baseline_snapshot"]
            self.log(
                f"{fund.ticker}: {len(docs)} snapshots, {blocked} blocked horizons, "
                f"baseline from {baseline or 'never'}"
            )

        return documents

    # --- write --------------------------------------------------------------

    def write(self, documents: dict[str, dict[str, dict[str, Any]]]) -> list[Path]:
        from .emit import write_snapshot

        paths: list[Path] = []
        for ticker, months in documents.items():
            for month, doc in months.items():
                paths.append(write_snapshot(self.out_dir / "data", doc, month))
        return paths

    def manifest(
        self, documents: dict[str, dict[str, dict[str, Any]]], snapshot_dates: list[date], depth: int
    ) -> dict[str, Any]:
        return {
            "app": "Third Floor",
            "run_started_at": self.started.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "run_finished_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "registry_schema_version": self.registry.schema_version,
            "registry_locked_at": self.registry.locked_at,
            "requested_backfill_depth_months": depth,
            "snapshot_range": {
                "from": f"{snapshot_dates[0].year:04d}-{snapshot_dates[0].month:02d}",
                "to": f"{snapshot_dates[-1].year:04d}-{snapshot_dates[-1].month:02d}",
            },
            "min_observations_per_cell": MIN_OBSERVATIONS_PER_CELL,
            "instruments_fetched": len(self.sources),
            "sources": {t: r.to_json() for t, r in sorted(self.sources.items())},
            "fetch_failures": self.failures,
            "snapshot_counts": {t: len(m) for t, m in sorted(documents.items())},
            "tickers_with_no_snapshots": sorted(
                f.ticker for f in self.registry.funds if f.ticker not in documents
            ),
            "coverage": {
                t: months[max(months)]["coverage"] for t, months in sorted(documents.items())
            },
            "total_snapshot_files": sum(len(m) for m in documents.values()),
        }

    def package(self, documents, snapshot_dates, depth, zip_path: str | Path) -> Path:
        paths = self.write(documents)
        manifest = self.manifest(documents, snapshot_dates, depth)

        (self.out_dir / "MANIFEST.json").write_text(
            json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
        )
        (self.out_dir / "run.log").write_text("\n".join(self.lines) + "\n", encoding="utf-8")

        zip_path = Path(zip_path)
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for path in sorted(paths):
                zf.write(path, path.relative_to(self.out_dir))
            zf.write(self.out_dir / "MANIFEST.json", "MANIFEST.json")
            zf.write(self.out_dir / "run.log", "run.log")

        self.log(f"packaged {len(paths)} snapshots into {zip_path}")
        return zip_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Third Floor monthly run")
    parser.add_argument("--registry", default="tickers.json")
    parser.add_argument("--out", default="build/run")
    parser.add_argument("--zip", dest="zip_path", default="third_floor_package.zip")
    parser.add_argument(
        "--backfill",
        action="store_true",
        help="produce the full requested depth rather than the current month only",
    )
    parser.add_argument("--depth", type=int, default=DEFAULT_SNAPSHOT_COUNT)
    parser.add_argument(
        "--only", nargs="*", help="restrict to these tickers, for a dry run"
    )
    parser.add_argument("--today", help="override today's date, for reproducible runs")
    args = parser.parse_args(argv)

    today = date.fromisoformat(args.today) if args.today else date.today()
    end = most_recent_completed_month_end(today)
    depth = args.depth if args.backfill else 1
    snapshot_dates = monthly_snapshot_dates(end, depth)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    run = Run(args.registry, out_dir)
    run.log(
        f"Third Floor run — {'backfill' if args.backfill else 'monthly'}, "
        f"{depth} snapshot(s) ending {snapshot_dates[-1]}"
    )
    run.fetch_all(fetch_start_for(snapshot_dates), args.only)
    documents = run.build(snapshot_dates, args.depth)
    run.package(documents, snapshot_dates, args.depth, args.zip_path)
    return 0 if not run.failures else 1


if __name__ == "__main__":
    sys.exit(main())
