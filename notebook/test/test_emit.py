# SPDX-License-Identifier: MIT
"""The document's shape, and the promises it has to keep on its own."""

import json
import sys
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from thirdfloor.backfill import build_ticker_slices, monthly_snapshot_dates  # noqa: E402
from thirdfloor.emit import SCHEMA_VERSION, build_all_snapshots, write_snapshot  # noqa: E402
from thirdfloor.registry import Fund, RegistryError, load_registry  # noqa: E402
from thirdfloor.semibeta import MIN_OBSERVATIONS_PER_CELL, STATES, normalise_score  # noqa: E402

from test_backfill import price_series  # noqa: E402

REPO = Path(__file__).resolve().parents[2]

FUND = Fund(
    ticker="TEST",
    name="A Test Fund",
    issuer="Nobody",
    category="options_integrated",
    defined_outcome_caveat=True,
    named_benchmark="EFA",
    benchmark_source="prospectus_index",
    benchmark_note="A note about where the anchor came from.",
    benchmark_note_plain="A sentence the reader is shown.",
)


def build_documents(fund=FUND, fund_start=date(2023, 1, 2)):
    # Only the benchmarks this fund is actually computed against, exactly as
    # thirdfloor.package assembles them from Fund.benchmarks.
    available = {
        "VOO": price_series(date(2023, 1, 2), 1250),
        "EFA": price_series(date(2023, 1, 2), 1250, seed=80.0),
    }
    benchmark_series = {b: available[b] for b in fund.benchmarks}
    series = price_series(fund_start, 1250, seed=50.0)
    dates = monthly_snapshot_dates(date(2026, 7, 31), 19)
    slices = build_ticker_slices(
        series, benchmark_series, dates, MIN_OBSERVATIONS_PER_CELL
    )
    return build_all_snapshots(
        fund, slices, fund_start, 19, "close_adjusted", "yfinance",
        MIN_OBSERVATIONS_PER_CELL, datetime(2026, 8, 23, tzinfo=timezone.utc),
    )


class TestDocumentShape(unittest.TestCase):
    def setUp(self):
        self.docs = build_documents()
        self.doc = self.docs[max(self.docs)]

    def test_required_top_level_fields(self):
        for key in ("app", "schema_version", "ticker", "name", "issuer", "category",
                    "as_of", "generated_at", "coverage", "methodology", "benchmarks"):
            self.assertIn(key, self.doc)
        self.assertEqual(self.doc["app"], "Third Floor")
        self.assertEqual(self.doc["schema_version"], SCHEMA_VERSION)

    def test_horizons_are_in_report_column_order(self):
        for block in self.doc["benchmarks"].values():
            self.assertEqual([h["horizon"] for h in block["horizons"]], ["12mo", "6mo", "13wk"])

    def test_the_universal_anchor_is_always_present(self):
        for doc in self.docs.values():
            self.assertIn("VOO", doc["benchmarks"])

    def test_roles_distinguish_the_anchor_from_the_named_benchmark(self):
        self.assertEqual(self.doc["benchmarks"]["VOO"]["roles"], ["universal_anchor"])
        self.assertEqual(self.doc["benchmarks"]["EFA"]["roles"], ["named_benchmark"])

    def test_a_fund_whose_named_benchmark_is_voo_gets_one_entry_with_both_roles(self):
        fund = Fund("SFLR", "n", "i", "options_integrated", True, "VOO", "prospectus_index", None, None)
        docs = build_documents(fund)
        doc = docs[max(docs)]
        self.assertEqual(list(doc["benchmarks"]), ["VOO"])
        self.assertEqual(doc["benchmarks"]["VOO"]["roles"], ["universal_anchor", "named_benchmark"])

    def test_methodology_carries_no_placeholder_strings(self):
        """No 'TBD' reaches a committed file; unresolved means null plus a note."""
        blob = json.dumps(self.doc)
        for placeholder in ("TBD", "FIXME", "XXX"):
            self.assertNotIn(placeholder, blob)
        self.assertEqual(self.doc["methodology"]["shift_threshold"], 0.30)
        self.assertTrue(self.doc["methodology"]["shift_threshold_note"])

    def test_coverage_is_identical_across_every_month(self):
        """One fetched file must answer what the whole archive holds."""
        coverages = [json.dumps(d["coverage"], sort_keys=True) for d in self.docs.values()]
        self.assertEqual(len(set(coverages)), 1)


class TestCellsKeepTheirPromises(unittest.TestCase):
    def setUp(self):
        self.docs = build_documents()

    def test_every_score_matches_the_stated_transform(self):
        """3F D-04: the archive can be regenerated from raw values, no network."""
        checked = 0
        for doc in self.docs.values():
            for block in doc["benchmarks"].values():
                for h in block["horizons"]:
                    if h["states"] is None:
                        continue
                    for cell in h["states"].values():
                        self.assertEqual(cell["score"], normalise_score(cell["raw_semibeta"]))
                        checked += 1
        self.assertGreater(checked, 100)

    def test_a_blocked_cell_is_null_and_never_zero(self):
        for doc in self.docs.values():
            for block in doc["benchmarks"].values():
                for h in block["horizons"]:
                    if h["states"] is None:
                        continue
                    for cell in h["states"].values():
                        if cell["data_sufficiency"] == "blocked":
                            self.assertIsNone(cell["raw_semibeta"])
                            self.assertIsNone(cell["score"])
                            self.assertTrue(cell["blockers"])

    def test_the_observation_identity_holds_in_every_emitted_horizon(self):
        for doc in self.docs.values():
            for block in doc["benchmarks"].values():
                for h in block["horizons"]:
                    self.assertEqual(
                        h["observations_total"],
                        h["observations_classified"] + h["observations_unclassified"],
                    )
                    if h["states"] is not None:
                        self.assertEqual(
                            h["observations_classified"],
                            sum(h["states"][s]["observation_count"] for s in STATES),
                        )

    def test_the_identity_holds_in_a_blocked_horizon_too(self):
        """A refused window publishes no count at all, rather than a count no
        number rests on. Found by the JavaScript validator, not by reading."""
        docs = build_documents(fund_start=date(2026, 2, 1))
        blocked = 0
        for doc in docs.values():
            for block in doc["benchmarks"].values():
                for h in block["horizons"]:
                    if h["states"] is not None:
                        continue
                    blocked += 1
                    self.assertEqual(h["observations_total"], 0)
                    self.assertEqual(h["observations_classified"], 0)
                    self.assertEqual(h["observations_unclassified"], 0)
                    self.assertEqual(
                        h["observations_total"],
                        h["observations_classified"] + h["observations_unclassified"],
                    )
        self.assertGreater(blocked, 0)

    def test_every_blocker_anywhere_names_a_remedy(self):
        found = 0
        for doc in self.docs.values():
            for block in doc["benchmarks"].values():
                for h in block["horizons"]:
                    for b in h["blockers"]:
                        self.assertTrue(b["remedy"].strip())
                        found += 1
                    for cell in (h["states"] or {}).values():
                        for b in cell["blockers"]:
                            self.assertTrue(b["remedy"].strip())
                            found += 1
        self.assertGreater(found, 0)


class TestWriting(unittest.TestCase):
    def test_path_is_ticker_directory_and_zero_padded_month(self):
        docs = build_documents()
        with TemporaryDirectory() as tmp:
            for month, doc in docs.items():
                path = write_snapshot(tmp, doc, month)
                self.assertEqual(path.parent.name, "TEST")
                self.assertRegex(path.name, r"^\d{4}-\d{2}\.json$")
                reloaded = json.loads(path.read_text())
                self.assertEqual(reloaded["ticker"], "TEST")

    def test_written_months_sort_in_calendar_order(self):
        docs = build_documents()
        with TemporaryDirectory() as tmp:
            for month, doc in docs.items():
                write_snapshot(tmp, doc, month)
            names = sorted(p.stem for p in (Path(tmp) / "TEST").iterdir())
            self.assertEqual(names, sorted(docs))


class TestRegistry(unittest.TestCase):
    def test_the_shipped_registry_loads_and_holds_its_rules(self):
        r = load_registry(REPO / "tickers.json")
        self.assertEqual(len(r.funds), 31)
        self.assertEqual(r.anchors, ("VOO", "QQQ", "IWM", "EFA"))
        self.assertEqual(len(r.instruments), 35)
        for f in r.funds:
            if f.named_benchmark is None:
                self.assertTrue(f.benchmark_note, f.ticker)
            else:
                self.assertIn(f.named_benchmark, r.anchors, f.ticker)

    def test_the_eafe_funds_now_name_a_tracked_benchmark(self):
        """3F D-01 closed the gap; these three must no longer be VOO-only."""
        r = load_registry(REPO / "tickers.json")
        for t in ("HOLA", "BUFY", "BUFI"):
            self.assertEqual(r.fund(t).named_benchmark, "EFA", t)
            self.assertEqual(r.fund(t).benchmarks, ["VOO", "EFA"], t)

    def test_dbmf_declares_no_benchmark_and_says_why(self):
        """Distinct from an untracked one — the two must not look identical."""
        r = load_registry(REPO / "tickers.json")
        self.assertIsNone(r.fund("DBMF").named_benchmark)
        self.assertTrue(r.fund("DBMF").benchmark_note)
        self.assertEqual(r.fund("DBMF").benchmarks, ["VOO"])

    def test_an_untracked_named_benchmark_is_refused(self):
        with TemporaryDirectory() as tmp:
            p = Path(tmp) / "r.json"
            p.write_text(json.dumps({
                "schema_version": "1.1", "locked_at": "2026-08-23",
                "benchmark_anchors": [{"ticker": "VOO", "role": "universal_anchor", "note": "n"}],
                "tickers": [{"ticker": "X", "name": "n", "issuer": "i",
                             "category": "options_integrated", "defined_outcome_caveat": True,
                             "named_benchmark": "EFA", "benchmark_source": "prospectus_index"}],
            }))
            with self.assertRaises(RegistryError):
                load_registry(p)

    def test_a_silent_default_is_refused(self):
        """INV-2 applied to the registry: null benchmark must say why."""
        with TemporaryDirectory() as tmp:
            p = Path(tmp) / "r.json"
            p.write_text(json.dumps({
                "schema_version": "1.1", "locked_at": "2026-08-23",
                "benchmark_anchors": [{"ticker": "VOO", "role": "universal_anchor", "note": "n"}],
                "tickers": [{"ticker": "X", "name": "n", "issuer": "i",
                             "category": "options_integrated", "defined_outcome_caveat": True,
                             "named_benchmark": None, "benchmark_source": "prospectus_index"}],
            }))
            with self.assertRaises(RegistryError):
                load_registry(p)


if __name__ == "__main__":
    unittest.main()
