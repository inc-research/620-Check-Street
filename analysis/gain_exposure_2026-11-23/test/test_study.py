# SPDX-License-Identifier: MIT
"""Identity and property tests for the Gain Exposure study (3F D-25, D-26). Synthetic data, no network.

    PYTHONPATH=notebook python3 -m unittest discover analysis/gain_exposure_2026-11-23/test
"""
import math
import random
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "notebook"))

import study  # noqa: E402
from thirdfloor.exposure import market_side  # noqa: E402


def series(n=120, seed=1, scale=0.6, noise=0.003):
    rng = random.Random(seed)
    d0 = date(2026, 1, 2)
    out = []
    for i in range(n):
        rb = rng.gauss(0.0004, 0.01)
        if i % 37 == 0:
            rb = 0.0  # a flat market day
        out.append((d0 + timedelta(days=i), scale * rb + rng.gauss(0, noise), rb))
    return out


class StudyIdentities(unittest.TestCase):
    def test_leg_ends_equal_market_side_sums(self):
        p = series()
        lg = study.legs(p)
        self.assertTrue(math.isclose(lg["up"][-1][1], market_side(p, True).sum_fund, abs_tol=1e-12))
        self.assertTrue(math.isclose(lg["down"][-1][2], market_side(p, False).sum_benchmark, abs_tol=1e-12))

    def test_every_day_counted_once(self):
        p = series()
        c = study.capture_pair(p)
        self.assertEqual(c["up_days"] + c["down_days"] + c["flat_days"], len(p))
        lg = study.legs(p)
        self.assertEqual(len(lg["up"]) + len(lg["down"]), c["up_days"] + c["down_days"])

    def test_benchmark_against_itself_reads_one(self):
        c = study.capture_pair([(d, rb, rb) for d, _, rb in series()])
        self.assertAlmostEqual(c["u"], 1.0)
        self.assertAlmostEqual(c["b"], 0.0)
        self.assertAlmostEqual(c["E"], 1.0)

    def test_E_unchanged_by_scaling_the_fund(self):
        p = series()
        e = study.capture_pair(p)["E"]
        for k in (0.25, 3.0):
            q = [(d, k * rf, rb) for d, rf, rb in p]
            self.assertTrue(math.isclose(study.capture_pair(q)["E"], e, rel_tol=1e-12))

    def test_E_above_one_exactly_when_u_plus_b_below_one(self):
        for seed in range(30):
            c = study.capture_pair(series(seed=seed, scale=random.Random(seed).uniform(0.1, 1.2)))
            if c["E"] is not None:
                self.assertEqual(c["E"] > 1.0, c["u_plus_b"] < 1.0)

    def test_exposure_ratio_undefined_without_kept_gains(self):
        self.assertIsNone(study.exposure_ratio(0.0, 0.5))
        self.assertIsNone(study.exposure_ratio(-0.1, 0.5))
        self.assertAlmostEqual(study.exposure_ratio(0.65, 0.76), 0.76 / 0.65)

    def test_bootstrap_reproducible_from_seed(self):
        p = series(n=200)
        a = study.bootstrap(p, seed=7, n=300)
        self.assertEqual(a, study.bootstrap(p, seed=7, n=300))
        self.assertLessEqual(a["E"][0], study.capture_pair(p)["E"])
        self.assertLessEqual(study.capture_pair(p)["E"], a["E"][1])

    def test_bands_partition_moving_days(self):
        p = series(n=300)
        bands = study.by_band(p, study.band_edges(p))
        moving = sum(1 for _, _, rb in p if rb != 0.0)
        self.assertEqual(sum(bands[b]["up_days"] + bands[b]["down_days"] for b in study.BANDS), moving)


class WindowIdentities(unittest.TestCase):
    """The 4-23 November window (3F D-26)."""

    def window(self, n=14, seed=5, scale=0.6):
        rng = random.Random(seed)
        d0 = study.WINDOW[0]
        return [(d0 + timedelta(days=i), scale * (rb := rng.gauss(0.0, 0.012)) + rng.gauss(0, 0.002), rb)
                for i in range(n)]

    def test_day_entries_sum_to_window_sums(self):
        y, w = series(n=200), self.window()
        edges = study.band_edges(y)
        days = [study.day_entry(p, edges, y) for p in w]
        c = study.capture_pair(w)
        self.assertTrue(math.isclose(math.fsum(d["fund"] for d in days if d["side"] == "up"), c["sum_fund_up"], abs_tol=1e-12))
        self.assertTrue(math.isclose(math.fsum(d["bench"] for d in days if d["side"] == "down"), c["sum_bench_down"], abs_tol=1e-12))
        self.assertEqual(sum(1 for d in days if d["side"] == "flat"), c["flat_days"])

    def test_giveback_ratio_is_window_down_capture_over_year_u(self):
        y, w = series(n=200), self.window()
        yc, wc = study.capture_pair(y), study.capture_pair(w)
        g = study.giveback(yc, wc)
        want = (wc["sum_fund_down"] / wc["sum_bench_down"]) / yc["u"]
        self.assertTrue(math.isclose(g["ratio"], want, rel_tol=1e-12))

    def test_short_side_gives_null(self):
        w = self.window(n=7)
        c = study.capture_pair(w)
        if c["up_days"] < 6:
            self.assertIsNone(c["u"])
            self.assertIsNone(c["E"])
        if c["down_days"] < 6:
            self.assertIsNone(c["b"])

    def test_market_against_itself_reads_one_over_the_window(self):
        y = [(d, rb, rb) for d, _, rb in series(n=200)]
        w = [(d, rb, rb) for d, _, rb in self.window(n=30)]
        c = study.capture_pair(w)
        self.assertAlmostEqual(c["E"], 1.0)
        self.assertAlmostEqual(study.giveback(study.capture_pair(y), c)["ratio"], 1.0)

    def test_legs_span_year_and_window(self):
        y, w = series(n=200), self.window()
        lg = study.legs(y + w)
        yc, wc = study.capture_pair(y), study.capture_pair(w)
        self.assertTrue(math.isclose(lg["up"][-1][1], yc["sum_fund_up"] + wc["sum_fund_up"], abs_tol=1e-12))
        self.assertTrue(math.isclose(lg["down"][-1][2], yc["sum_bench_down"] + wc["sum_bench_down"], abs_tol=1e-12))


if __name__ == "__main__":
    unittest.main()
