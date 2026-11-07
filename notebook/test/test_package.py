# SPDX-License-Identifier: MIT
"""The command-line run: which months it asks for and what it reads first."""

from __future__ import annotations

import contextlib
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


if __name__ == "__main__":
    unittest.main()
