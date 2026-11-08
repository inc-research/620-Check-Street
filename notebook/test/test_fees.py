# SPDX-License-Identifier: MIT
"""Fee tables read from prospectus XBRL (3F D-22). Offline, on a committed instance."""

import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from thirdfloor.fees import (  # noqa: E402
    FeeRecord,
    FeeRefused,
    InstanceCache,
    build_fee_file,
    fee_history,
    fee_in_force,
    guard,
    manual_record,
    parse_instance,
    record_from_facts,
    series_filings,
)

FIXTURE = (Path(__file__).resolve().parents[1] / "fixtures" / "fee_instance.xml").read_bytes()


def record(net: float, filed: date, gross: float | None = None, waiver: float = 0.0) -> FeeRecord:
    g = gross if gross is not None else net + waiver
    return FeeRecord("X", None, None, g, 0.0, 0.0, 0.0, g, waiver, net, "485BPOS", filed, None, "u", "sec_xbrl")


class TestParse(unittest.TestCase):
    def test_a_class_is_found_by_its_identifier(self):
        facts = parse_instance(FIXTURE, "BUFR", "C000219511")
        self.assertEqual(facts["management"], 0.0020)
        self.assertEqual(facts["acquired_funds"], 0.0085)
        self.assertEqual(facts["gross"], 0.0105)

    def test_a_narrowing_dimension_is_not_read_as_the_class_table(self):
        # The 0.04 sits in a context with a further axis and must not win.
        self.assertEqual(parse_instance(FIXTURE, "BUFR", "C000219511")["management"], 0.0020)

    def test_the_prospectus_document_axis_is_allowed(self):
        facts = parse_instance(FIXTURE, "VOO", "C000092055")
        self.assertEqual(facts["gross"], 0.0003)

    def test_the_older_taxonomy_class_axis_is_read_too(self):
        # Vanguard's filings before April 2026 put the class on rr:ProspectusShareClassAxis.
        self.assertEqual(parse_instance(FIXTURE, "VOO", "C000092099")["gross"], 0.0003)

    def test_a_trading_symbol_finds_a_class_the_identifier_does_not(self):
        facts = parse_instance(FIXTURE, "SFLR", None)
        self.assertEqual(facts["gross"], 0.0089)

    def test_a_class_not_in_the_filing_reads_as_absent(self):
        self.assertIsNone(parse_instance(FIXTURE, "ZZZZ", "C999999999"))

    def test_an_html_page_is_refused_not_parsed(self):
        with self.assertRaises(FeeRefused):
            parse_instance(b"<!DOCTYPE html><html><body>Request rate exceeded</body></html>", "BUFR", "C1")


class TestRecord(unittest.TestCase):
    def test_a_waiver_is_a_reduction_whatever_its_sign(self):
        facts = parse_instance(FIXTURE, "BUFR", "C000219511")
        r = record_from_facts(facts, "BUFR", "S", "C", "485BPOS", date(2024, 12, 30), "a", "u")
        self.assertEqual(r.waiver, 0.0010)
        self.assertEqual(r.net, 0.0095)

    def test_lines_that_do_not_add_up_are_refused(self):
        with self.assertRaises(FeeRefused):
            guard(FeeRecord("X", None, None, 0.005, 0.0, 0.0, 0.0, 0.0095, 0.0, 0.0095, "f", date(2026, 1, 1), None, "u", "sec_xbrl"))

    def test_net_must_be_gross_less_waiver(self):
        with self.assertRaises(FeeRefused):
            guard(record(0.0050, date(2026, 1, 1), gross=0.0068, waiver=0.0))

    def test_an_implausible_fee_is_refused(self):
        with self.assertRaises(FeeRefused):
            guard(record(0.5, date(2026, 1, 1)))


class TestInForce(unittest.TestCase):
    history = [record(0.0095, date(2024, 12, 30)), record(0.0090, date(2025, 12, 29))]

    def test_the_latest_filing_on_or_before_the_month(self):
        self.assertEqual(fee_in_force(self.history, date(2025, 12, 31)).net, 0.0090)
        self.assertEqual(fee_in_force(self.history, date(2025, 11, 28)).net, 0.0095)
        self.assertEqual(fee_in_force(self.history, date(2025, 12, 29)).net, 0.0090)

    def test_a_month_before_any_filing_has_none_rather_than_a_later_one(self):
        self.assertIsNone(fee_in_force(self.history, date(2024, 6, 28)))

    def test_a_month_with_none_says_why(self):
        doc = build_fee_file("X", "fund", "2024-06", date(2024, 6, 28), None, "t")
        self.assertIsNone(doc["fees"])
        self.assertEqual(doc["blockers"][0]["code"], "no_fee_table_on_record")
        self.assertTrue(doc["blockers"][0]["remedy"])
        self.assertTrue(doc["already_in_returns"])

    def test_a_manual_period_carries_its_source(self):
        r = manual_record("QQQ", {"from": "2024-01-26", "gross": 0.002, "url": "https://x", "note": "n"})
        self.assertEqual(r.net, 0.002)
        self.assertEqual(r.to_json()["source"]["kind"], "manual")


class TestHistory(unittest.TestCase):
    """The EDGAR walk, against a fake network."""

    def fake(self):
        atom = (
            "<filing-date>2026-01-05</filing-date><filing-href>https://sec/A-index.htm</filing-href><filing-type>497</filing-type>"
            "<filing-date>2025-12-29</filing-date><filing-href>https://sec/B-index.htm</filing-href><filing-type>485BPOS</filing-type>"
            "<filing-date>2025-12-29</filing-date><filing-href>https://sec/B-index.htm</filing-href><filing-type>485BPOS</filing-type>"
            "<filing-date>2024-12-30</filing-date><filing-href>https://sec/C-index.htm</filing-href><filing-type>485BPOS</filing-type>"
            "<filing-date>2023-12-30</filing-date><filing-href>https://sec/D-index.htm</filing-href><filing-type>485BPOS</filing-type>"
        ).encode()
        calls = []

        def get(url: str) -> bytes:
            calls.append(url)
            if "browse-edgar" in url:
                return atom
            if url.endswith("A-index.htm"):
                return b"no instance in a plain supplement"
            if url.endswith("-index.htm"):
                return f'<a href="/Archives/x/{url[-11]}_htm.xml">'.encode()
            return FIXTURE

        return get, calls

    def test_duplicates_are_listed_once(self):
        get, _ = self.fake()
        self.assertEqual(len(series_filings("S000068605", get)), 4)

    def test_the_walk_stops_at_the_first_filing_in_force_for_the_earliest_month(self):
        get, calls = self.fake()
        history = fee_history("BUFR", "S000068605", "C000219511", date(2025, 1, 31), InstanceCache(get))
        self.assertEqual([r.filed for r in history], [date(2024, 12, 30), date(2025, 12, 29)])
        self.assertFalse(any(c.endswith("D-index.htm") for c in calls))


if __name__ == "__main__":
    unittest.main()
