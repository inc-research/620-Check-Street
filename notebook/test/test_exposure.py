# SPDX-License-Identifier: MIT
"""The money figures and net capture, by algebra with one frozen golden case."""

import math
import random
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from thirdfloor.exposure import (  # noqa: E402
    benchmark_fit,
    compute_reading,
    compute_readings,
    market_side,
    worst_fall,
)
from thirdfloor.semibeta import daily_returns, pair_returns  # noqa: E402


def market(n=300, seed=3, vol=0.011, drift=0.0005, start=date(2025, 1, 1)):
    rng = random.Random(seed)
    d, out = start, []
    for _ in range(n):
        d += timedelta(days=1)
        out.append((d, rng.gauss(drift, vol)))
    return out


def pairs_from(days, fund):
    return [(d, fund(i, rb), rb) for i, (d, rb) in enumerate(days)]


class Capture(unittest.TestCase):
    def test_a_constant_share_reads_the_same_both_ways(self):
        """The regression compounding fails: 0.40 of every move is 0.40 up and down."""
        pairs = pairs_from(market(), lambda _, rb: 0.40 * rb)
        self.assertAlmostEqual(market_side(pairs, True).capture, 0.40, places=12)
        self.assertAlmostEqual(market_side(pairs, False).capture, 0.40, places=12)

    def test_an_uncorrelated_fund_reads_near_nothing_not_its_volatility_ratio(self):
        rng = random.Random(11)
        pairs = pairs_from(market(2000), lambda *_: rng.gauss(0.0, 0.008))
        self.assertLess(abs(market_side(pairs, True).capture), 0.05)
        self.assertLess(abs(market_side(pairs, False).capture), 0.05)

    def test_capture_is_the_ratio_of_the_two_average_days(self):
        pairs = pairs_from(market(), lambda i, rb: 0.5 * rb + 0.002 * math.sin(i))
        for up in (True, False):
            side = market_side(pairs, up)
            self.assertAlmostEqual(
                side.capture, side.average_fund / side.average_benchmark, places=12
            )

    def test_a_day_against_the_market_counts_against_the_fund(self):
        d = date(2026, 1, 1)
        rows = [(d + timedelta(days=i), 0.01, 0.01) for i in range(9)]
        rows.append((d + timedelta(days=9), -0.09, 0.01))
        side = market_side(rows, True)
        self.assertEqual(side.against_days, 1)
        self.assertAlmostEqual(side.against_share, 0.1)
        self.assertAlmostEqual(side.capture, 0.0, places=12)

    def test_too_few_days_blocks_and_keeps_the_count(self):
        d = date(2026, 1, 1)
        rows = [(d + timedelta(days=i), 0.01, 0.01) for i in range(5)]
        side = market_side(rows, True)
        self.assertIsNone(side.capture)
        self.assertIsNone(side.average_fund)
        self.assertEqual(side.days, 5)
        self.assertEqual(side.blockers[0].code, "market_side_too_few_days")


class Money(unittest.TestCase):
    def test_growth_ties_to_the_price_ratio(self):
        d = date(2025, 1, 1)
        rng = random.Random(5)
        fund, bench = [(d, 50.0)], [(d, 400.0)]
        for i in range(1, 500):
            day = d + timedelta(days=i)
            fund.append((day, fund[-1][1] * (1 + rng.gauss(0.0003, 0.006))))
            bench.append((day, bench[-1][1] * (1 + rng.gauss(0.0004, 0.01))))
        pairs = pair_returns(daily_returns(fund), daily_returns(bench))
        as_of = fund[-1][0]
        reading = compute_reading(pairs, "12mo", as_of)
        by_date = dict(fund)
        opening = by_date[reading.first_day - timedelta(days=1)]
        self.assertAlmostEqual(reading.growth_fund, fund[-1][1] / opening, places=10)

    def test_a_year_of_rises_has_no_fall(self):
        d = date(2026, 1, 1)
        fall = worst_fall([(d + timedelta(days=i), 0.01) for i in range(5)], d)
        self.assertEqual(fall.depth, 0.0)
        self.assertIsNone(fall.peak_date)

    def test_worst_fall_finds_the_deepest_not_the_last(self):
        d = [date(2026, 1, i) for i in range(1, 7)]
        fall = worst_fall(
            list(zip(d[1:], [0.10, -0.20, 0.05, 0.30, -0.05])), d[0]
        )
        self.assertAlmostEqual(fall.depth, -0.20)
        self.assertEqual(fall.peak_date, d[1])
        self.assertEqual(fall.trough_date, d[2])

    def test_a_fall_from_the_opening_close_is_dated_there(self):
        d = [date(2026, 1, i) for i in range(1, 4)]
        fall = worst_fall([(d[1], -0.10), (d[2], 0.01)], d[0])
        self.assertEqual(fall.peak_date, d[0])


class Windows(unittest.TestCase):
    def test_every_paired_day_sits_on_one_side(self):
        days = market(400)
        days[100] = (days[100][0], 0.0)
        pairs = pairs_from(days, lambda _, rb: 0.3 * rb)
        for r in compute_readings(pairs, days[-1][0]):
            self.assertEqual(r.days_total, r.up.days + r.down.days + r.market_flat_days)

    def test_a_young_fund_is_blocked_not_shortened(self):
        days = market(120)
        pairs = pairs_from(days, lambda _, rb: 0.3 * rb)
        twelve, six, thirteen = compute_readings(pairs, days[-1][0])
        self.assertIsNone(twelve.growth_fund)
        self.assertEqual(twelve.blockers[0].code, "window_shorter_than_horizon")
        self.assertEqual(twelve.to_json()["days_total"], 0)
        self.assertIsNone(twelve.to_json()["worst_fall"])
        self.assertIsNone(six.growth_fund)
        self.assertIsNotNone(thirteen.growth_fund)


class Golden(unittest.TestCase):
    """Computed independently with numpy on these exact returns."""

    RF = (0.012, -0.004, 0.003, -0.011, 0.007, -0.002, 0.001, 0.006, -0.009, 0.004,
          -0.003, 0.002, -0.005)
    RB = (0.018, -0.009, 0.006, -0.016, 0.011, -0.007, 0.004, 0.012, -0.013, -0.001,
          0.002, 0.003, -0.004)

    def test_frozen(self):
        d = date(2026, 1, 1)
        pairs = [(d + timedelta(days=i), f, b) for i, (f, b) in enumerate(zip(self.RF, self.RB))]
        up, down = market_side(pairs, True), market_side(pairs, False)
        fit = benchmark_fit(pairs)
        self.assertEqual((up.days, down.days), (7, 6))
        self.assertAlmostEqual(up.capture, 0.4999999999999999, places=10)
        self.assertAlmostEqual(down.capture, 0.54, places=10)
        self.assertAlmostEqual(fit.beta, 0.6094830838888191, places=10)
        self.assertAlmostEqual(fit.r_squared, 0.882448468636157, places=10)


if __name__ == "__main__":
    unittest.main()
