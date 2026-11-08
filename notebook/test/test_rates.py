# SPDX-License-Identifier: MIT
"""The FRED ladder and its guard (3F D-23). Offline, on a fake network."""

import json
import os
import sys
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from thirdfloor.rates import (  # noqa: E402
    RatesRefused,
    fetch_series,
    find_api_key,
    guard,
    merge_append_only,
)

MONTHS = [f"2025-{m:02d}-01" for m in range(1, 13)] + ["2026-01-01"]
API = json.dumps(
    {"observations": [{"date": d, "value": "." if d == "2025-10-01" else str(300 + i)} for i, d in enumerate(MONTHS)]}
).encode()
CSV = ("observation_date,CPIAUCNS\n" + "".join(f"{d},{300 + i}\n" for i, d in enumerate(MONTHS))).encode()
CHALLENGE = b"<!DOCTYPE html><html><body>Too many requests</body></html>"


class TestGuard(unittest.TestCase):
    def test_a_missing_reading_is_counted_and_dropped_not_read_as_zero(self):
        s = guard("CPIAUCNS", [(d, "." if d == "2025-10-01" else "300") for d in MONTHS], "t")
        self.assertEqual(s.missing_days, 1)
        self.assertNotIn("2025-10-01", [d for d, _ in s.observations])

    def test_too_few_rows_are_refused(self):
        with self.assertRaises(RatesRefused):
            guard("CPIAUCNS", [("2025-01-01", "300")], "t")

    def test_unsorted_dates_are_refused(self):
        with self.assertRaises(RatesRefused):
            guard("CPIAUCNS", [(d, "300") for d in reversed(MONTHS)], "t")

    def test_a_price_level_of_zero_is_refused(self):
        with self.assertRaises(RatesRefused):
            guard("CPIAUCNS", [(d, "0") for d in MONTHS], "t")


class TestLadder(unittest.TestCase):
    def test_the_api_is_used_when_there_is_a_key(self):
        s = fetch_series("CPIAUCNS", date(2025, 1, 1), "k", get=lambda url: API)
        self.assertEqual(s.source, "fred_api")
        self.assertEqual(s.missing_days, 1)

    def test_a_refused_api_falls_through_to_the_csv(self):
        get = lambda url: CHALLENGE if "api.stlouisfed" in url else CSV  # noqa: E731
        self.assertEqual(fetch_series("CPIAUCNS", date(2025, 1, 1), "k", get=get).source, "fred_csv")

    def test_no_key_goes_straight_to_the_csv(self):
        self.assertEqual(fetch_series("CPIAUCNS", date(2025, 1, 1), None, get=lambda url: CSV).source, "fred_csv")

    def test_when_every_source_refuses_the_run_is_told(self):
        with self.assertRaises(RatesRefused):
            fetch_series("CPIAUCNS", date(2025, 1, 1), "k", get=lambda url: CHALLENGE)

    def test_the_key_never_appears_in_the_written_file(self):
        s = fetch_series("CPIAUCNS", date(2025, 1, 1), "SECRETKEY", get=lambda url: API)
        self.assertNotIn("SECRETKEY", json.dumps(s.to_json("t")))


class TestAppendOnly(unittest.TestCase):
    def doc(self, obs):
        return {"series_id": "CPIAUCNS", "observations": obs}

    def test_later_observations_are_added(self):
        merged = merge_append_only(self.doc([["2025-01-01", 300]]), self.doc([["2025-01-01", 300], ["2025-02-01", 301]]))
        self.assertEqual(merged["observations"], [["2025-01-01", 300], ["2025-02-01", 301]])

    def test_a_published_observation_is_kept_when_a_shorter_pull_omits_it(self):
        merged = merge_append_only(self.doc([["2024-12-01", 299], ["2025-01-01", 300]]), self.doc([["2025-01-01", 300]]))
        self.assertEqual(merged["observations"][0], ["2024-12-01", 299])

    def test_a_changed_published_observation_is_refused(self):
        with self.assertRaises(RatesRefused):
            merge_append_only(self.doc([["2025-01-01", 300]]), self.doc([["2025-01-01", 300.5]]))


class TestKey(unittest.TestCase):
    def test_the_environment_comes_first(self):
        with mock.patch.dict(os.environ, {"FRED_API_KEY": " abc \n"}):
            self.assertEqual(find_api_key(None), "abc")

    def test_no_key_anywhere_is_none_rather_than_an_error(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(find_api_key("/nonexistent"))


if __name__ == "__main__":
    unittest.main()
