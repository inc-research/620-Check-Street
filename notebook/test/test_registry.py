# SPDX-License-Identifier: MIT
"""The registry's own contract.

Two of the rules here exist because a fund with no benchmark, a fund whose
benchmark is not tracked, and a fund whose benchmark is a near match are three
different facts that would otherwise look identical on the page.
"""

import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from thirdfloor.registry import RegistryError, load_registry  # noqa: E402

REPO = Path(__file__).resolve().parents[2]


def write(tmp: Path, registry: dict) -> Path:
    path = tmp / "tickers.json"
    path.write_text(json.dumps(registry), encoding="utf-8")
    return path


def base(**overrides) -> dict:
    fund = {
        "ticker": "TEST",
        "name": "A Test Fund",
        "issuer": "Nobody",
        "category": "options_integrated",
        "defined_outcome_caveat": True,
        "named_benchmark": "VOO",
        "benchmark_source": "prospectus_index",
    }
    fund.update(overrides)
    return {
        "schema_version": "1.2",
        "locked_at": "2026-08-01",
        "benchmark_anchors": [{"ticker": "VOO", "role": "universal_anchor", "note": "n"}],
        "tickers": [fund],
    }


class TestBenchmarkNotes(unittest.TestCase):
    def test_a_provenance_note_without_a_plain_one_is_refused(self):
        # The provenance note names prospectus and marketing sources and does
        # not simplify them. It is written for whoever maintains the file, and
        # shipping it to a reader as if it were copy is the defect this rule
        # exists to stop (3F D-15).
        with TemporaryDirectory() as tmp:
            path = write(Path(tmp), base(benchmark_note="Prospectus references Solactive."))
            with self.assertRaises(RegistryError) as caught:
                load_registry(path)
        self.assertIn("benchmark_note_plain", str(caught.exception))

    def test_the_pair_together_is_accepted_and_both_survive(self):
        with TemporaryDirectory() as tmp:
            path = write(
                Path(tmp),
                base(
                    benchmark_note="Prospectus references Solactive.",
                    benchmark_note_plain="The comparison here is a near match rather than an exact one.",
                ),
            )
            fund = load_registry(path).funds[0]
        self.assertIn("Solactive", fund.benchmark_note)
        self.assertIn("near match", fund.benchmark_note_plain)

    def test_a_fund_with_no_named_benchmark_still_needs_a_note(self):
        with TemporaryDirectory() as tmp:
            path = write(Path(tmp), base(named_benchmark=None))
            with self.assertRaises(RegistryError):
                load_registry(path)


class TestShippedRegistry(unittest.TestCase):
    """The file this repository actually ships, not a fixture."""

    def setUp(self):
        self.registry = load_registry(REPO / "tickers.json")

    def test_every_provenance_note_has_a_reader_facing_twin(self):
        for fund in self.registry.funds:
            if fund.benchmark_note:
                self.assertTrue(
                    fund.benchmark_note_plain,
                    f"{fund.ticker} would show its provenance note to a reader",
                )

    def test_no_reader_facing_note_carries_a_decision_citation(self):
        # A citation like "3F D-01" is an address in a file the reader has
        # never seen. It belongs in the provenance note, which several of them
        # use, and nowhere near the page.
        for fund in self.registry.funds:
            if fund.benchmark_note_plain:
                self.assertNotRegex(
                    fund.benchmark_note_plain,
                    r"\b(3F|SF|FF)[- ]?D?-?\d",
                    f"{fund.ticker} cites a decision record to a reader",
                )

    def test_no_reader_facing_note_carries_the_registry_own_field_names(self):
        for fund in self.registry.funds:
            note = fund.benchmark_note_plain
            if not note:
                continue
            for term in ("defined_outcome_caveat", "named_benchmark", "benchmark_note"):
                self.assertNotIn(term, note, f"{fund.ticker} shows a field name to a reader")

    def test_no_reader_facing_note_leaves_a_question_open(self):
        # FGSI's provenance note ended "a separate income-overlay caveat may be
        # worth adding" — a note to the builder, rendered on the report as
        # though it were a caveat (3F-O-05).
        for fund in self.registry.funds:
            note = fund.benchmark_note_plain
            if not note:
                continue
            for phrase in ("may be worth", "TBD", "to be decided", "TODO"):
                self.assertNotIn(phrase, note, f"{fund.ticker} leaves a loose end on the page")


if __name__ == "__main__":
    unittest.main()
