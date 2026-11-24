# SPDX-License-Identifier: MIT
"""The command-line run: which months it asks for and what it reads first."""

from __future__ import annotations

import contextlib
import json
import io
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from thirdfloor import package


def run_main(*argv: str):
    """Run main() against a stub Run; return the stub and its constructor call."""
    with mock.patch.object(package, "Run") as stub:
        stub.return_value.failures = {}
        code = package.main(["--today", "2026-11-06", *argv])
    assert code == 0
    return stub


class CatchUpRun(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.archive = str(Path(self.dir.name) / "data")
        Path(self.archive).mkdir()
        self.out = str(Path(self.dir.name) / "run")

    def common(self):
        return ("--archive", self.archive, "--out", self.out)

    def test_a_routine_run_is_the_last_completed_month(self):
        stub = run_main(*self.common())
        dates, depth = stub.return_value.build.call_args.args
        self.assertEqual(dates, [date(2026, 10, 31)])
        self.assertEqual(depth, package.DEFAULT_SNAPSHOT_COUNT)

    def test_months_adds_the_missed_months_and_keeps_the_recorded_depth(self):
        stub = run_main(*self.common(), "--months", "3")
        dates, depth = stub.return_value.build.call_args.args
        self.assertEqual(
            dates, [date(2026, 8, 31), date(2026, 9, 30), date(2026, 10, 31)]
        )
        self.assertEqual(depth, package.DEFAULT_SNAPSHOT_COUNT)

    def test_a_reports_only_run_says_so_to_the_run(self):
        stub = run_main(*self.common(), "--months", "22", "--reports-only")
        self.assertTrue(stub.call_args.kwargs["reports_only"])
        dates, _ = stub.return_value.build.call_args.args
        self.assertEqual(len(dates), 22)
        self.assertEqual(dates[0], date(2025, 1, 31))

    def test_a_routine_run_writes_snapshots_as_well(self):
        stub = run_main(*self.common())
        self.assertFalse(stub.call_args.kwargs["reports_only"])

    def test_the_published_archive_reaches_the_run(self):
        # Without it the coverage block describes this run alone and reports the
        # fetch boundary as the fund's inception, as the August run did.
        stub = run_main(*self.common())
        self.assertEqual(stub.call_args.kwargs["archive_dir"], self.archive)

    def test_a_missing_archive_is_refused(self):
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            run_main("--archive", self.archive + "-absent", "--out", self.out)

    def test_backfill_and_months_cannot_be_combined(self):
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            run_main(*self.common(), "--backfill", "--months", "3")


class CarryFeesForward(unittest.TestCase):
    """A fund EDGAR will not answer for gets last month's published fee table, marked (2026-11-24)."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        root = Path(self.dir.name)
        self.archive = root / "data"
        (self.archive / "_fees" / "BUFC").mkdir(parents=True)
        self.prior = {
            "app": "Third Floor", "fees_schema_version": "1.0", "ticker": "BUFC", "role": "fund",
            "month": "2026-10", "as_of": "2026-10-30", "generated_at": "2026-11-08T14:16:45Z",
            "already_in_returns": True, "effective_date_note": "n",
            "fees": {"management": 0.0069, "distribution_12b1": 0.0, "other": 0.0, "acquired_funds": None,
                     "gross": 0.0069, "waiver": 0.0, "net": 0.0069,
                     "source": {"kind": "sec_xbrl", "form": "485BPOS", "filed": "2026-03-27", "accession": "a",
                                "url": "https://www.sec.gov/x", "series_id": "S", "class_id": "C", "note": None}},
            "blockers": [],
        }
        (self.archive / "_fees" / "BUFC" / "2026-10.json").write_text(json.dumps(self.prior))
        registry = Path(__file__).resolve().parents[2] / "tickers.json"
        self.run = package.Run(registry, root / "run", verbose=False, archive_dir=self.archive)

    def fetch(self, months, error=OSError("HTTP Error 503: Service Unavailable (after 4 attempts)")):
        with mock.patch.object(package, "fee_history", side_effect=error):
            self.run.fetch_fees(months)

    def test_the_last_published_table_is_carried_and_marked(self):
        self.fetch({"BUFC": {"2026-11": date(2026, 11, 30)}})
        doc = self.run.fees["BUFC"]["2026-11"]
        self.assertEqual(doc["month"], "2026-11")
        self.assertEqual(doc["as_of"], "2026-11-30")
        self.assertEqual(doc["fees"]["net"], 0.0069)
        self.assertIn("Carried forward from the 2026-10 fee file", doc["fees"]["source"]["note"])
        self.assertEqual(self.run.fee_carried, {"BUFC": {"2026-11": "2026-10"}})
        self.assertIn("BUFC", self.run.fee_failures)
        self.assertTrue(any("CARRIED FORWARD" in line for line in self.run.lines))

    def test_a_published_month_is_never_written_again(self):
        self.fetch({"BUFC": {"2026-10": date(2026, 10, 30)}})
        self.assertNotIn("BUFC", self.run.fees)

    def test_nothing_is_carried_from_a_file_without_a_fee_table(self):
        self.prior["fees"] = None
        (self.archive / "_fees" / "BUFC" / "2026-10.json").write_text(json.dumps(self.prior))
        self.fetch({"BUFC": {"2026-11": date(2026, 11, 30)}})
        self.assertNotIn("BUFC", self.run.fees)
        self.assertEqual(self.run.fee_carried, {})

    def test_an_answer_on_a_second_try_replaces_the_carried_file(self):
        self.fetch({"BUFC": {"2026-11": date(2026, 11, 30)}})
        with mock.patch.object(package, "fee_history", return_value=[]):
            self.run.fetch_fees({"BUFC": {"2026-11": date(2026, 11, 30)}})
        self.assertIsNone(self.run.fees["BUFC"]["2026-11"]["fees"])
        self.assertEqual(self.run.fee_carried, {})
        self.assertNotIn("BUFC", self.run.fee_failures)


if __name__ == "__main__":
    unittest.main()
