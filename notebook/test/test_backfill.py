# SPDX-License-Identifier: MIT
"""Slicing, graceful degradation, and the coverage block."""

import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from thirdfloor.backfill import (  # noqa: E402
    build_ticker_slices,
    coverage_for,
    fetch_start_for,
    last_trading_date_on_or_before,
    month_end,
    month_key,
    monthly_snapshot_dates,
)
from thirdfloor.semibeta import MIN_OBSERVATIONS_PER_CELL  # noqa: E402


def price_series(start: date, days: int, seed: float = 100.0):
    """Weekday-only prices with enough movement for all four quadrants."""
    import random

    rng = random.Random(int(start.toordinal()))
    out, d, price = [], start, seed
    while len(out) < days:
        if d.weekday() < 5:
            price *= 1.0 + rng.gauss(0.0003, 0.011)
            out.append((d, price))
        d += timedelta(days=1)
    return out


class TestSnapshotDates(unittest.TestCase):
    def test_nineteen_month_ends_oldest_first(self):
        dates = monthly_snapshot_dates(date(2026, 7, 31), 19)
        self.assertEqual(len(dates), 19)
        self.assertEqual(dates[0], date(2025, 1, 31))
        self.assertEqual(dates[-1], date(2026, 7, 31))
        self.assertEqual(dates, sorted(dates))

    def test_month_keys_sort_in_calendar_order(self):
        keys = [month_key(d) for d in monthly_snapshot_dates(date(2026, 7, 31), 19)]
        self.assertEqual(keys, sorted(keys))
        self.assertEqual(keys[0], "2025-01")

    def test_it_crosses_a_year_boundary(self):
        dates = monthly_snapshot_dates(date(2026, 2, 28), 4)
        self.assertEqual([month_key(d) for d in dates], ["2025-11", "2025-12", "2026-01", "2026-02"])

    def test_february_lengths(self):
        self.assertEqual(month_end(2024, 2), date(2024, 2, 29))
        self.assertEqual(month_end(2025, 2), date(2025, 2, 28))

    def test_fetch_reaches_a_full_horizon_behind_the_oldest_snapshot(self):
        dates = monthly_snapshot_dates(date(2026, 7, 31), 19)
        self.assertEqual(fetch_start_for(dates), date(2024, 1, 31))


class TestAsOf(unittest.TestCase):
    def test_as_of_is_a_real_trading_date_not_the_calendar_month_end(self):
        series = price_series(date(2026, 5, 1), 60)
        as_of = last_trading_date_on_or_before(series, date(2026, 5, 31))
        self.assertIsNotNone(as_of)
        self.assertLessEqual(as_of, date(2026, 5, 31))
        self.assertLess(as_of.weekday(), 5)

    def test_before_the_first_trade_there_is_no_as_of(self):
        series = price_series(date(2026, 5, 1), 60)
        self.assertIsNone(last_trading_date_on_or_before(series, date(2026, 4, 1)))


class TestSlicing(unittest.TestCase):
    def setUp(self):
        self.bench = price_series(date(2023, 1, 2), 1250)
        self.dates = monthly_snapshot_dates(date(2026, 7, 31), 19)

    def test_a_long_history_fills_every_requested_snapshot(self):
        fund = price_series(date(2023, 1, 2), 1250, seed=50.0)
        slices = build_ticker_slices(fund, {"VOO": self.bench}, self.dates, MIN_OBSERVATIONS_PER_CELL)
        self.assertEqual(len(slices), 19)
        for per_benchmark in slices.values():
            for h in per_benchmark["VOO"]:
                self.assertIsNotNone(h.states, h.horizon)

    def test_a_young_fund_degrades_rather_than_fabricating(self):
        """Several of the tracked set are 2025 launches; none may invent a past."""
        fund = price_series(date(2026, 6, 26), 40, seed=25.0)
        slices = build_ticker_slices(fund, {"VOO": self.bench}, self.dates, MIN_OBSERVATIONS_PER_CELL)

        self.assertTrue(slices, "a fund with 40 days of history should still yield a snapshot")
        self.assertLess(len(slices), 19)
        self.assertNotIn("2025-01", slices)
        for month, per_benchmark in slices.items():
            self.assertGreaterEqual(month, "2026-06")
            computed = [h for h in per_benchmark["VOO"] if h.states is not None]
            self.assertTrue(computed, month)          # 3F D-09: any horizon is enough
            for h in per_benchmark["VOO"]:
                if h.states is None:
                    self.assertTrue(h.blockers[0].remedy)   # INV-2

    def test_a_month_before_the_fund_existed_produces_no_file_at_all(self):
        fund = price_series(date(2026, 6, 26), 40, seed=25.0)
        slices = build_ticker_slices(fund, {"VOO": self.bench}, self.dates, MIN_OBSERVATIONS_PER_CELL)
        for month in ("2025-01", "2025-06", "2026-01", "2026-05"):
            self.assertNotIn(month, slices)

    def test_two_benchmarks_are_both_carried(self):
        fund = price_series(date(2023, 1, 2), 1250, seed=50.0)
        other = price_series(date(2023, 1, 2), 1250, seed=80.0)
        slices = build_ticker_slices(
            fund, {"VOO": self.bench, "EFA": other}, self.dates, MIN_OBSERVATIONS_PER_CELL
        )
        for per_benchmark in slices.values():
            self.assertEqual(sorted(per_benchmark), ["EFA", "VOO"])


class TestCoverage(unittest.TestCase):
    def setUp(self):
        self.bench = price_series(date(2023, 1, 2), 1250)
        self.dates = monthly_snapshot_dates(date(2026, 7, 31), 19)

    def test_a_full_history_is_not_limited_by_inception(self):
        fund = price_series(date(2023, 1, 2), 1250, seed=50.0)
        slices = build_ticker_slices(fund, {"VOO": self.bench}, self.dates, MIN_OBSERVATIONS_PER_CELL)
        cov = coverage_for(slices, date(2023, 1, 2), 19, "VOO")
        self.assertFalse(cov["history_limited_by_inception"])
        self.assertEqual(cov["earliest_available_snapshot"], "2025-01")
        self.assertEqual(cov["earliest_full_baseline_snapshot"], "2025-01")

    def test_a_fund_with_no_baseline_anywhere_records_null_not_a_guess(self):
        """3F D-09's consequence: a file can exist whose 12mo row is blocked."""
        fund = price_series(date(2026, 6, 26), 40, seed=25.0)
        slices = build_ticker_slices(fund, {"VOO": self.bench}, self.dates, MIN_OBSERVATIONS_PER_CELL)
        self.assertTrue(slices)
        cov = coverage_for(slices, date(2026, 6, 26), 19, "VOO")
        self.assertTrue(cov["history_limited_by_inception"])
        self.assertIsNone(cov["earliest_full_baseline_snapshot"])
        self.assertIsNotNone(cov["earliest_available_snapshot"])

    def test_baseline_is_never_earlier_than_availability(self):
        for start in (date(2023, 1, 2), date(2024, 6, 3), date(2025, 3, 3)):
            fund = price_series(start, 1250, seed=50.0)
            slices = build_ticker_slices(
                fund, {"VOO": self.bench}, self.dates, MIN_OBSERVATIONS_PER_CELL
            )
            cov = coverage_for(slices, start, 19, "VOO")
            if cov["earliest_full_baseline_snapshot"]:
                self.assertGreaterEqual(
                    cov["earliest_full_baseline_snapshot"], cov["earliest_available_snapshot"]
                )


if __name__ == "__main__":
    unittest.main()
