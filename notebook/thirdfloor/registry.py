# SPDX-License-Identifier: MIT
"""Reads tickers.json — the permanent source of truth, read every monthly run.

Validates the two rules the notebook actually depends on, rather than trusting
the file: a named benchmark must be an anchor the run will fetch, and a fund
with no named benchmark must say why. The second is INV-2 applied to the
registry — a fund that declares no benchmark and a fund whose benchmark is not
tracked are different facts, and must not be allowed to look identical.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

UNIVERSAL_ANCHOR = "VOO"


class RegistryError(Exception):
    pass


@dataclass(frozen=True)
class Fund:
    ticker: str
    name: str
    issuer: str
    category: str
    defined_outcome_caveat: bool
    named_benchmark: str | None
    benchmark_source: str
    #: Provenance, in the register of whoever maintains the registry. Never
    #: shown to a reader — it names prospectus and marketing sources and does
    #: not simplify them, which is exactly what makes it useful here and unfit
    #: for the page.
    benchmark_note: str | None
    #: The same fact in the reader's voice. This is the one the site renders,
    #: and it is linted against the copy deck's own rules (3F D-15).
    benchmark_note_plain: str | None
    #: Where the fund's own fee table is filed (3F D-22). Optional here so a
    #: fund built by hand in a test needs none; the registry schema requires both.
    sec_series_id: str | None = None
    sec_class_id: str | None = None

    @property
    def benchmarks(self) -> list[str]:
        """Every benchmark this fund is computed against, anchor first.

        VOO is always present. A fund whose named benchmark IS VOO gets one
        entry carrying both roles, never a duplicated table.
        """
        if self.named_benchmark and self.named_benchmark != UNIVERSAL_ANCHOR:
            return [UNIVERSAL_ANCHOR, self.named_benchmark]
        return [UNIVERSAL_ANCHOR]

    def roles_for(self, benchmark: str) -> list[str]:
        roles = []
        if benchmark == UNIVERSAL_ANCHOR:
            roles.append("universal_anchor")
        if benchmark == self.named_benchmark:
            roles.append("named_benchmark")
        return roles


@dataclass(frozen=True)
class Anchor:
    ticker: str
    sec_series_id: str | None
    sec_class_id: str | None
    #: Fee periods recorded by hand where no tagged fee table exists.
    manual_fees: tuple[dict[str, Any], ...] = ()


@dataclass(frozen=True)
class Registry:
    schema_version: str
    locked_at: str
    anchors: tuple[str, ...]
    funds: tuple[Fund, ...]
    anchor_records: tuple[Anchor, ...] = ()

    @property
    def instruments(self) -> list[str]:
        """Every instrument the run fetches: anchors plus funds, deduplicated."""
        seen, out = set(), []
        for t in list(self.anchors) + [f.ticker for f in self.funds]:
            if t not in seen:
                seen.add(t)
                out.append(t)
        return out

    def fund(self, ticker: str) -> Fund:
        for f in self.funds:
            if f.ticker == ticker:
                return f
        raise RegistryError(f"{ticker} is not in the registry")


def load_registry(path: str | Path) -> Registry:
    raw: dict[str, Any] = json.loads(Path(path).read_text(encoding="utf-8"))

    anchors = tuple(a["ticker"] for a in raw["benchmark_anchors"])
    if UNIVERSAL_ANCHOR not in anchors:
        raise RegistryError(
            f"{UNIVERSAL_ANCHOR} is the universal anchor and must be in benchmark_anchors"
        )

    funds = []
    for entry in raw["tickers"]:
        named = entry.get("named_benchmark")
        note = entry.get("benchmark_note")
        plain = entry.get("benchmark_note_plain")

        if named is not None and named not in anchors:
            raise RegistryError(
                f"{entry['ticker']} names {named} as its benchmark, which is not in "
                "benchmark_anchors. A benchmark that is not fetched cannot be computed "
                "against; add it as an anchor or record why it is absent."
            )
        if note and not plain:
            raise RegistryError(
                f"{entry['ticker']} has a benchmark_note but no benchmark_note_plain. "
                "The provenance note is written for whoever maintains this file and "
                "is not shown to a reader; a fund whose anchor is not an exact match "
                "must still say so on its own report, in words the reader was given "
                "(3F D-15)."
            )
        if named is None and not note:
            raise RegistryError(
                f"{entry['ticker']} has no named benchmark and no benchmark_note. "
                "A fund that declares no benchmark and a fund whose benchmark is "
                "untracked are different facts and must not look identical (INV-2)."
            )

        funds.append(
            Fund(
                ticker=entry["ticker"],
                name=entry["name"],
                issuer=entry["issuer"],
                category=entry["category"],
                defined_outcome_caveat=bool(entry["defined_outcome_caveat"]),
                named_benchmark=named,
                benchmark_source=entry["benchmark_source"],
                benchmark_note=note,
                benchmark_note_plain=plain,
                sec_series_id=entry.get("sec_series_id"),
                sec_class_id=entry.get("sec_class_id"),
            )
        )

    return Registry(
        schema_version=raw["schema_version"],
        locked_at=raw["locked_at"],
        anchors=anchors,
        funds=tuple(funds),
        anchor_records=tuple(
            Anchor(
                a["ticker"],
                a.get("sec_series_id"),
                a.get("sec_class_id"),
                tuple(a.get("manual_fees", ())),
            )
            for a in raw["benchmark_anchors"]
        ),
    )
