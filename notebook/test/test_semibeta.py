# SPDX-License-Identifier: MIT
"""Properties over frozen numbers, following the family's method (FAMILY_DOCTRINE §6).

A conventional statistic is better checked by algebra than by a golden value:
these hold for inputs nobody has written down, which a frozen number cannot do.
One frozen golden case is kept as well, against an independently computed result.
"""

import math
import random
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from thirdfloor.semibeta import (  # noqa: E402
    HORIZONS,
    STATES,
    Cell,
    classify,
    compute_four_horizon_table,
    compute_horizon,
    daily_returns,
    horizon_start,
    normalise_score,
    pair_returns,
    quadrant_semibeta,
)


def synthetic_pairs(n=400, seed=7, start=date(2025, 1, 1)):
    """Paired returns with both signs well represented in all four quadrants."""
    rng = random.Random(seed)
    out = []
    d = start
    for _ in range(n):
        d += timedelta(days=1)
        rb = rng.gauss(0.0004, 0.011)
        rf = 0.62 * rb + rng.gauss(0.0, 0.004)
        if rb == 0.0 or rf == 0.0:
            continue
        out.append((d, rf, rb))
    return out


class TestQuadrantAlgebra(unittest.TestCase):
    def setUp(self):
        self.pairs = synthetic_pairs()

    def test_scaling_fund_scales_every_semibeta(self):
        c = 3.5
        scaled = [(d, rf * c, rb) for d, rf, rb in self.pairs]
        for s in STATES:
            base = quadrant_semibeta(self.pairs, s).raw_semibeta
            after = quadrant_semibeta(scaled, s).raw_semibeta
            self.assertIsNotNone(base, s)
            self.assertAlmostEqual(after, base * c, places=10, msg=s)

    def test_scaling_benchmark_scales_every_semibeta_inversely(self):
        c = 4.0
        scaled = [(d, rf, rb * c) for d, rf, rb in self.pairs]
        for s in STATES:
            base = quadrant_semibeta(self.pairs, s).raw_semibeta
            after = quadrant_semibeta(scaled, s).raw_semibeta
            self.assertAlmostEqual(after, base / c, places=10, msg=s)

    def test_permuting_row_order_changes_nothing(self):
        shuffled = list(self.pairs)
        random.Random(99).shuffle(shuffled)
        for s in STATES:
            a = quadrant_semibeta(self.pairs, s)
            b = quadrant_semibeta(shuffled, s)
            self.assertEqual(a.observation_count, b.observation_count, s)
            self.assertAlmostEqual(a.raw_semibeta, b.raw_semibeta, places=12, msg=s)

    def test_identical_series_gives_unit_participation_and_empty_resilience(self):
        same = [(d, rb, rb) for d, _, rb in self.pairs]
        for s in ("fund_up_bench_up", "fund_down_bench_down"):
            self.assertAlmostEqual(quadrant_semibeta(same, s).raw_semibeta, 1.0, places=12, msg=s)
        for s in ("fund_up_bench_down", "fund_down_bench_up"):
            cell = quadrant_semibeta(same, s)
            self.assertIsNone(cell.raw_semibeta, s)
            self.assertEqual(cell.observation_count, 0, s)
            self.assertEqual(cell.data_sufficiency, "blocked", s)
            self.assertTrue(cell.blockers, s)

    def test_a_quadrant_under_two_observations_is_blocked_not_a_float(self):
        tiny = [
            (date(2026, 1, 2), 0.01, 0.01),
            (date(2026, 1, 5), -0.01, 0.01),
        ]
        cell = quadrant_semibeta(tiny, "fund_down_bench_up")
        self.assertIsNone(cell.raw_semibeta)
        self.assertEqual(cell.observation_count, 1)
        self.assertEqual(cell.data_sufficiency, "blocked")
        self.assertEqual(cell.blockers[0].code, "quadrant_too_few_observations")

    def test_a_flat_benchmark_is_blocked_not_divided_by(self):
        flat = [(date(2026, 1, 1) + timedelta(days=i), 0.002 * (i + 1), 0.01) for i in range(30)]
        cell = quadrant_semibeta(flat, "fund_up_bench_up")
        self.assertIsNone(cell.raw_semibeta)
        self.assertEqual(cell.data_sufficiency, "blocked")
        self.assertEqual(cell.blockers[0].code, "benchmark_no_variation")

    def test_every_blocker_names_a_remedy(self):
        """INV-2: a blocker with no remedy is a dead end."""
        for cell in (
            quadrant_semibeta([], "fund_up_bench_up"),
            quadrant_semibeta(
                [(date(2026, 1, 1) + timedelta(days=i), 0.002 * (i + 1), 0.01) for i in range(30)],
                "fund_up_bench_up",
            ),
        ):
            for b in cell.blockers:
                self.assertTrue(b.remedy.strip())
                self.assertTrue(b.message.strip())

    def test_thin_flag_tracks_the_observation_floor(self):
        pairs = synthetic_pairs(n=60, seed=3)
        for s in STATES:
            cell = quadrant_semibeta(pairs, s, min_observations=1000)
            if cell.raw_semibeta is not None:
                self.assertEqual(cell.data_sufficiency, "thin", s)


class TestObservationIdentity(unittest.TestCase):
    """This app's form of INV-3: every paired day is used or counted with a reason."""

    def test_identity_holds_with_flat_days_on_both_sides(self):
        pairs = synthetic_pairs(n=380)
        flat_dates = [pairs[i][0] for i in range(0, 40)]
        with_flats = []
        for d, rf, rb in pairs:
            if d in flat_dates[:20]:
                with_flats.append((d, 0.0, rb))     # fund flat
            elif d in flat_dates[20:]:
                with_flats.append((d, rf, 0.0))     # benchmark flat
            else:
                with_flats.append((d, rf, rb))

        as_of = with_flats[-1][0]
        h = compute_horizon(with_flats, "12mo", as_of, earliest_pair=with_flats[0][0])
        self.assertEqual(
            h.observations_total, h.observations_classified + h.observations_unclassified
        )

        # The unclassified count is exactly the flat days inside the window,
        # derived from the data rather than assumed — the point is that they are
        # counted somewhere and not quietly dropped.
        start = horizon_start(as_of, "12mo")
        flats_in_window = sum(
            1 for d, rf, rb in with_flats if start <= d <= as_of and (rf == 0.0 or rb == 0.0)
        )
        self.assertGreater(flats_in_window, 0)
        self.assertEqual(h.observations_unclassified, flats_in_window)
        self.assertEqual(
            h.observations_classified,
            sum(h.states[s].observation_count for s in STATES),
        )

    def test_a_zero_return_day_belongs_to_no_quadrant(self):
        self.assertIsNone(classify(0.0, 0.01))
        self.assertIsNone(classify(0.01, 0.0))
        self.assertIsNone(classify(0.0, 0.0))
        self.assertEqual(classify(0.01, 0.01), "fund_up_bench_up")
        self.assertEqual(classify(-0.01, -0.01), "fund_down_bench_down")
        self.assertEqual(classify(0.01, -0.01), "fund_up_bench_down")
        self.assertEqual(classify(-0.01, 0.01), "fund_down_bench_up")


class TestHorizons(unittest.TestCase):
    def test_a_window_the_data_does_not_reach_back_to_is_blocked(self):
        pairs = synthetic_pairs(n=40, start=date(2026, 6, 1))
        as_of = pairs[-1][0]
        table = compute_four_horizon_table(pairs, as_of)
        by_h = {h.horizon: h for h in table}
        for h in ("12mo", "6mo", "13wk"):
            self.assertIsNone(by_h[h].states, h)
            self.assertEqual(by_h[h].blockers[0].code, "window_shorter_than_horizon", h)
            self.assertTrue(by_h[h].blockers[0].remedy)
        self.assertIsNotNone(by_h["4wk"].states)

    def test_table_is_in_report_column_order(self):
        pairs = synthetic_pairs()
        table = compute_four_horizon_table(pairs, pairs[-1][0])
        self.assertEqual([h.horizon for h in table], list(HORIZONS))

    def test_month_arithmetic_survives_short_months(self):
        """31 August minus six months is 28 February, not a ValueError."""
        self.assertEqual(horizon_start(date(2026, 3, 31), "12mo"), date(2025, 3, 31))
        self.assertEqual(horizon_start(date(2025, 8, 31), "6mo"), date(2025, 2, 28))
        self.assertEqual(horizon_start(date(2024, 8, 31), "6mo"), date(2024, 2, 29))
        self.assertEqual(horizon_start(date(2026, 1, 15), "13wk"), date(2025, 10, 16))
        self.assertEqual(horizon_start(date(2026, 1, 29), "4wk"), date(2026, 1, 1))


class TestReturns(unittest.TestCase):
    def test_returns_are_one_shorter_than_prices(self):
        series = [(date(2026, 1, 1) + timedelta(days=i), 100.0 + i) for i in range(10)]
        self.assertEqual(len(daily_returns(series)), 9)

    def test_a_non_positive_price_drops_the_pair_rather_than_dividing_by_it(self):
        series = [
            (date(2026, 1, 1), 100.0),
            (date(2026, 1, 2), 0.0),
            (date(2026, 1, 3), 101.0),
        ]
        out = daily_returns(series)
        self.assertEqual([d for d, _ in out], [])

    def test_pairing_is_an_inner_join_and_never_fills(self):
        fund = [(date(2026, 1, 2), 0.01), (date(2026, 1, 3), 0.02), (date(2026, 1, 6), 0.03)]
        bench = [(date(2026, 1, 2), 0.005), (date(2026, 1, 6), 0.004)]
        paired = pair_returns(fund, bench)
        self.assertEqual([d for d, _, _ in paired], [date(2026, 1, 2), date(2026, 1, 6)])


class TestScore(unittest.TestCase):
    def test_anchor_points(self):
        self.assertEqual(normalise_score(0.0), 0)
        self.assertEqual(normalise_score(1.0), 50)
        self.assertEqual(normalise_score(2.0), 100)

    def test_clamps_both_ends(self):
        self.assertEqual(normalise_score(-5.0), 0)
        self.assertEqual(normalise_score(9.0), 100)

    def test_blocked_stays_none_and_never_becomes_zero(self):
        """A zero and an unknown are opposite claims (INV-2)."""
        self.assertIsNone(normalise_score(None))


class TestGoldenVector(unittest.TestCase):
    """One frozen case against an independently computed result (FF D-14)."""

    def test_hand_built_series(self):
        import json

        path = Path(__file__).resolve().parents[1] / "fixtures" / "golden_semibeta.json"
        fixture = json.loads(path.read_text())
        pairs = [
            (date.fromisoformat(r["date"]), r["r_fund"], r["r_bench"])
            for r in fixture["pairs"]
        ]
        for state, expected in fixture["expected"].items():
            cell = quadrant_semibeta(pairs, state, min_observations=1)
            if expected is None:
                self.assertIsNone(cell.raw_semibeta, state)
            else:
                self.assertAlmostEqual(cell.raw_semibeta, expected, places=12, msg=state)


if __name__ == "__main__":
    unittest.main()
