# SPDX-License-Identifier: MIT
"""The guard is the subject here: a challenge page must never become a snapshot."""

import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from thirdfloor import fetch  # noqa: E402
from thirdfloor.fetch import FetchRefused, _guard, _looks_like_html  # noqa: E402

STOOQ_CHALLENGE = (
    '<!DOCTYPE html><html><head><meta charset="utf-8">'
    '<meta name="robots" content="noindex,nofollow"></head><body><noscript>'
    "This site requires JavaScript to verify your browser.</noscript>"
    '<script nonce="x">(async()=>{const c="AAAA",d=4;})();</script></body></html>'
)


def good_series(n=300):
    return [(date(2025, 1, 1) + timedelta(days=i), 100.0 + i * 0.1) for i in range(n)]


class TestHtmlDetection(unittest.TestCase):
    def test_the_real_stooq_challenge_page_is_recognised(self):
        """Captured verbatim from stooq.com on 2026-08-23 (3F D-06)."""
        self.assertTrue(_looks_like_html(STOOQ_CHALLENGE))

    def test_a_leading_blank_line_does_not_hide_it(self):
        self.assertTrue(_looks_like_html("\n\n  " + STOOQ_CHALLENGE))

    def test_real_csv_is_not_mistaken_for_html(self):
        self.assertFalse(_looks_like_html("Date,Open,High,Low,Close,Volume\n2026-01-02,1,2,3,4,5\n"))


class TestGuard(unittest.TestCase):
    def test_empty_is_refused_not_returned(self):
        with self.assertRaises(FetchRefused):
            _guard([], "VOO", "test")

    def test_a_handful_of_rows_is_refused(self):
        with self.assertRaises(FetchRefused):
            _guard(good_series(5), "VOO", "test")

    def test_unsorted_dates_are_refused(self):
        s = good_series()
        s[10], s[11] = s[11], s[10]
        with self.assertRaises(FetchRefused):
            _guard(s, "VOO", "test")

    def test_duplicate_dates_are_refused(self):
        s = good_series()
        s[10] = (s[11][0], s[10][1])
        with self.assertRaises(FetchRefused):
            _guard(s, "VOO", "test")

    def test_a_non_positive_price_is_refused(self):
        s = good_series()
        s[42] = (s[42][0], 0.0)
        with self.assertRaises(FetchRefused):
            _guard(s, "VOO", "test")

    def test_a_nan_price_is_refused(self):
        s = good_series()
        s[42] = (s[42][0], float("nan"))
        with self.assertRaises(FetchRefused):
            _guard(s, "VOO", "test")

    def test_a_real_looking_series_passes(self):
        _guard(good_series(), "VOO", "test")


class TestLadder(unittest.TestCase):
    def test_it_falls_through_a_refusing_source_to_a_working_one(self):
        calls = []

        def refuses(ticker, start):
            calls.append("first")
            raise FetchRefused("challenge page")

        def works(ticker, start):
            calls.append("second")
            return good_series()

        original = fetch.SOURCES
        fetch.SOURCES = (
            ("first", refuses, "close_unadjusted"),
            ("second", works, "close_adjusted"),
        )
        try:
            series, record = fetch.fetch_daily_prices("VOO", throttle_seconds=0)
        finally:
            fetch.SOURCES = original

        self.assertEqual(calls, ["first", "second"])
        self.assertEqual(record.source, "second")
        self.assertEqual(record.price_basis, "close_adjusted")
        self.assertEqual(record.rows, 300)

    def test_when_every_source_refuses_it_raises_rather_than_returning_empty(self):
        def refuses(ticker, start):
            raise FetchRefused("no")

        original = fetch.SOURCES
        fetch.SOURCES = (("only", refuses, "close_adjusted"),)
        try:
            with self.assertRaises(FetchRefused):
                fetch.fetch_daily_prices("VOO", throttle_seconds=0)
        finally:
            fetch.SOURCES = original

    def test_a_source_that_returns_a_short_series_is_treated_as_a_failure(self):
        """A challenge page parsed into three junk rows must not look like a young fund."""

        def nearly_empty(ticker, start):
            return good_series(3)

        original = fetch.SOURCES
        fetch.SOURCES = (("only", nearly_empty, "close_adjusted"),)
        try:
            with self.assertRaises(FetchRefused):
                fetch.fetch_daily_prices("VOO", throttle_seconds=0)
        finally:
            fetch.SOURCES = original


if __name__ == "__main__":
    unittest.main()
