# SPDX-License-Identifier: MIT
"""What each fund charges, read from the fee table in its own prospectus (3F D-22).

The fee table of every open-end fund prospectus (Form N-1A: a 485BPOS, or a 497
supplement that changes it) is filed with the SEC tagged in XBRL, under the
`oef:` taxonomy, one set of facts per share class. That is the fund's own
regulatory statement of its costs, in a machine-readable form, and needs no
scraping of issuer pages.

**What this is for, and what it is not.** A fund's costs come out of its net
assets every day, so its price, and every return this project computes from
adjusted closes, is already net of them, including the fees of any funds it
holds. The figures recorded here are disclosed beside the returns. They are
never subtracted from them, which would charge the reader twice.

**The fee in force for a month** is the most recent fee-tagged filing dated on
or before that month's as-of date. Filing date stands in for effective date: a
485BPOS can take effect on filing or on a later stated date, and the tagged
facts do not say which. Recorded as an approximation on every file.

Pure parsing plus one injectable network function, so the tests run offline on
a committed instance. Standard library only.
"""

from __future__ import annotations

import json
import math
import re
import time
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import date
from typing import Any, Callable, Iterable

# SEC asks automated clients to identify themselves. A project contact, never a
# person's address.
USER_AGENT = "ThirdFloor-research admin@example.org"
SEC = "https://www.sec.gov"

# SEC's fair-access limit is ten requests a second; stay well under it.
_THROTTLE_SECONDS = 0.15

FEE_FORMS = ("485BPOS", "497", "485APOS")

_XBRLI = "{http://www.xbrl.org/2003/instance}"
_XBRLDI = "{http://xbrl.org/2006/xbrldi}"

# Tagged fee-table facts, mapped to the field names this project stores.
TAGS = {
    "ManagementFeesOverAssets": "management",
    "DistributionAndService12b1FeesOverAssets": "distribution_12b1",
    "OtherExpensesOverAssets": "other",
    "AcquiredFundFeesAndExpensesOverAssets": "acquired_funds",
    "ExpensesOverAssets": "gross",
    "FeeWaiverOrReimbursementOverAssets": "waiver",
    "NetExpensesOverAssets": "net",
}

# A fee table rounds each line to the hundredth of a percent, so a sum can be
# off by one rounding step per line.
SUM_TOLERANCE = 0.00015
MAX_PLAUSIBLE_FEE = 0.05

EFFECTIVE_DATE_NOTE = (
    "The fee in force for a month is taken from the most recent fee-tagged "
    "prospectus filing dated on or before that month's as-of date. Filing date "
    "stands in for effective date."
)


# The share class sits on `oef:ClassAxis` in current filings and on the older
# risk/return taxonomy's `rr:ProspectusShareClassAxis` in filings before the
# switch (Vanguard's to April 2025, for one).
_CLASS_AXES = {"ClassAxis", "ProspectusShareClassAxis"}
_STRUCTURAL_AXES = _CLASS_AXES | {"LegalEntityAxis", "DocumentInformationDocumentAxis"}


class FeeRefused(Exception):
    """A response that is not a usable fee table. Raised, never returned as partial data."""


Getter = Callable[[str], bytes]


def http_get(url: str) -> bytes:
    time.sleep(_THROTTLE_SECONDS)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


@dataclass(frozen=True)
class FeeRecord:
    """One share class's fee table, as one filing states it. Fractions: 0.0095 is 0.95%."""

    ticker: str
    series_id: str | None
    class_id: str | None
    management: float | None
    distribution_12b1: float | None
    other: float | None
    acquired_funds: float | None
    gross: float
    waiver: float
    net: float
    form: str
    filed: date
    accession: str | None
    url: str
    source: str  # "sec_xbrl" or "manual"
    note: str | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "management": self.management,
            "distribution_12b1": self.distribution_12b1,
            "other": self.other,
            "acquired_funds": self.acquired_funds,
            "gross": self.gross,
            "waiver": self.waiver,
            "net": self.net,
            "source": {
                "kind": self.source,
                "form": self.form,
                "filed": self.filed.isoformat(),
                "accession": self.accession,
                "url": self.url,
                "series_id": self.series_id,
                "class_id": self.class_id,
                "note": self.note,
            },
        }


def guard(record: FeeRecord) -> FeeRecord:
    """Every fee table must add up before it is used."""
    fields = {
        k: getattr(record, k)
        for k in ("management", "distribution_12b1", "other", "acquired_funds", "gross", "waiver", "net")
    }
    for name, value in fields.items():
        if value is None:
            continue
        if not math.isfinite(value) or value < 0.0 or value > MAX_PLAUSIBLE_FEE:
            raise FeeRefused(f"{record.ticker}: {name} {value!r} is not a plausible annual fee")
    parts = math.fsum(
        v or 0.0 for v in (record.management, record.distribution_12b1, record.other, record.acquired_funds)
    )
    if record.management is not None and abs(parts - record.gross) > SUM_TOLERANCE:
        raise FeeRefused(
            f"{record.ticker}: fee lines sum to {parts:.4f} but the table's total is {record.gross:.4f}"
        )
    if abs(record.gross - record.waiver - record.net) > SUM_TOLERANCE:
        raise FeeRefused(
            f"{record.ticker}: gross {record.gross:.4f} less waiver {record.waiver:.4f} "
            f"is not net {record.net:.4f}"
        )
    return record


def _looks_like_html(raw: bytes) -> bool:
    head = raw[:512].lstrip().lower()
    return head.startswith(b"<!doctype html") or head.startswith(b"<html")


def parse_instance(
    raw: bytes, ticker: str, class_id: str | None
) -> dict[str, float] | None:
    """The fee facts for one class in one XBRL instance, or None if it does not carry them.

    The class is found by its SEC class identifier inside the `oef:ClassAxis`
    member, and failing that by a `dei:TradingSymbol` fact. Some filers tag no
    trading symbol at all, so the identifier comes first.
    """
    if _looks_like_html(raw):
        raise FeeRefused(f"{ticker}: the XBRL instance came back as an HTML page")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise FeeRefused(f"{ticker}: the XBRL instance does not parse ({exc})") from exc

    contexts: dict[str, tuple[tuple[str, str], ...]] = {
        c.get("id", ""): tuple(
            ((m.get("dimension") or "").split(":")[-1], (m.text or "").strip())
            for m in c.iter(f"{_XBRLDI}explicitMember")
        )
        for c in root.findall(f"{_XBRLI}context")
    }
    members: set[str] = set()
    if class_id:
        members |= {m for mem in contexts.values() for d, m in mem if d in _CLASS_AXES and class_id in m}
    for e in root:
        if e.tag.endswith("}TradingSymbol") and (e.text or "").strip().upper() == ticker:
            members |= {
                m for d, m in contexts.get(e.get("contextRef", ""), ()) if d in _CLASS_AXES
            }
    if not members:
        return None

    facts: dict[str, float] = {}
    for e in root:
        tag = e.tag.split("}", 1)[-1]
        if tag not in TAGS or not (e.text or "").strip():
            continue
        mem = contexts.get(e.get("contextRef", ""), ())
        # Class-level facts only. The series and the prospectus document are
        # structural and allowed; any other dimension narrows the fact to
        # something other than the class's own fee table, and is skipped.
        if any(d in _CLASS_AXES and m in members for d, m in mem) and all(
            d in _STRUCTURAL_AXES for d, _ in mem
        ):
            facts.setdefault(TAGS[tag], float(e.text))
    return facts if "gross" in facts else None


def record_from_facts(
    facts: dict[str, float],
    ticker: str,
    series_id: str | None,
    class_id: str | None,
    form: str,
    filed: date,
    accession: str,
    url: str,
) -> FeeRecord:
    # Filers disagree on the sign of a waiver: some tag it negative, some
    # positive. It is always a reduction.
    waiver = abs(facts.get("waiver", 0.0))
    gross = facts["gross"]
    net = facts.get("net", gross - waiver)
    return guard(
        FeeRecord(
            ticker=ticker,
            series_id=series_id,
            class_id=class_id,
            management=facts.get("management"),
            distribution_12b1=facts.get("distribution_12b1"),
            other=facts.get("other"),
            acquired_funds=facts.get("acquired_funds"),
            gross=gross,
            waiver=waiver,
            net=net,
            form=form,
            filed=filed,
            accession=accession,
            url=url,
            source="sec_xbrl",
        )
    )


# --- EDGAR ------------------------------------------------------------------


@dataclass(frozen=True)
class Filing:
    filed: date
    form: str
    index_url: str

    @property
    def accession(self) -> str:
        return self.index_url.rsplit("/", 1)[-1].replace("-index.htm", "")


_ATOM_ROW = re.compile(
    r"<filing-date>([^<]+)</filing-date>\s*<filing-href>([^<]+)</filing-href>\s*<filing-type>([^<]+)</filing-type>"
)


def series_filings(series_id: str, get: Getter = http_get) -> list[Filing]:
    """Every fee-bearing filing EDGAR lists for one fund series, newest first."""
    out: list[Filing] = []
    seen: set[str] = set()
    for start in range(0, 1000, 100):
        url = (
            f"{SEC}/cgi-bin/browse-edgar?action=getcompany&CIK={series_id}"
            f"&type=&owner=include&count=100&start={start}&output=atom"
        )
        raw = get(url)
        if _looks_like_html(raw):
            raise FeeRefused(f"{series_id}: EDGAR returned a page, not a filing feed")
        rows = _ATOM_ROW.findall(raw.decode("utf-8", "ignore"))
        for d, h, t in rows:
            # The feed lists a filing once per series-and-form pairing, so the
            # same accession can appear twice.
            if t in FEE_FORMS and h not in seen:
                seen.add(h)
                out.append(Filing(date.fromisoformat(d), t, h))
        if len(rows) < 100:
            break
    out.sort(key=lambda f: f.filed, reverse=True)
    return out


_INSTANCE_HREF = re.compile(r'href="(/Archives/[^"]+_htm\.xml)"')


def instance_url(filing: Filing, get: Getter = http_get) -> str | None:
    index = get(filing.index_url).decode("utf-8", "ignore")
    m = _INSTANCE_HREF.search(index)
    return SEC + m.group(1) if m else None


class InstanceCache:
    """One download per filing: a trust's prospectus usually covers several funds."""

    def __init__(self, get: Getter = http_get):
        self.get = get
        self._raw: dict[str, bytes | None] = {}

    def instance(self, filing: Filing) -> bytes | None:
        if filing.index_url not in self._raw:
            url = instance_url(filing, self.get)
            self._raw[filing.index_url] = self.get(url) if url else None
        return self._raw[filing.index_url]


def fee_history(
    ticker: str,
    series_id: str,
    class_id: str | None,
    earliest_as_of: date,
    cache: InstanceCache,
    log: Callable[[str], None] = lambda _m: None,
) -> list[FeeRecord]:
    """Fee tables from newest back to the first one in force at `earliest_as_of`.

    Walks the series' filings newest first and stops once a record dated on or
    before the earliest month needed has been found, so a monthly run reads one
    or two filings and a backfill reads only as far back as it must.
    """
    records: list[FeeRecord] = []
    for filing in series_filings(series_id, cache.get):
        raw = cache.instance(filing)
        if raw is None:
            continue
        facts = parse_instance(raw, ticker, class_id)
        if facts is None:
            continue
        record = record_from_facts(
            facts, ticker, series_id, class_id, filing.form, filing.filed,
            filing.accession, filing.index_url,
        )
        records.append(record)
        log(f"  {ticker}: {filing.form} {filing.filed} net {record.net:.4f}")
        if filing.filed <= earliest_as_of:
            break
    records.sort(key=lambda r: r.filed)
    return records


def fee_in_force(history: Iterable[FeeRecord], as_of: date) -> FeeRecord | None:
    """The latest record filed on or before `as_of`. None if none had been filed yet."""
    found = None
    for record in sorted(history, key=lambda r: r.filed):
        if record.filed <= as_of:
            found = record
    return found


def manual_record(ticker: str, entry: dict[str, Any]) -> FeeRecord:
    """A fee period recorded by hand, where no tagged fee table exists (e.g. a unit
    investment trust before it became an open-end fund). Carries its source."""
    return guard(
        FeeRecord(
            ticker=ticker,
            series_id=entry.get("sec_series_id"),
            class_id=entry.get("sec_class_id"),
            management=entry.get("management"),
            distribution_12b1=entry.get("distribution_12b1"),
            other=entry.get("other"),
            acquired_funds=entry.get("acquired_funds"),
            gross=entry["gross"],
            waiver=entry.get("waiver", 0.0),
            net=entry.get("net", entry["gross"] - entry.get("waiver", 0.0)),
            form=entry.get("form", "manual"),
            filed=date.fromisoformat(entry["from"]),
            accession=None,
            url=entry["url"],
            source="manual",
            note=entry.get("note"),
        )
    )


def build_fee_file(
    ticker: str,
    role: str,
    month: str,
    as_of: date,
    record: FeeRecord | None,
    generated_at: str,
) -> dict[str, Any]:
    """`data/_fees/<TICKER>/<YYYY-MM>.json`. A month with no fee table on record
    says so rather than borrowing a later one."""
    return {
        "app": "Third Floor",
        "fees_schema_version": FEES_SCHEMA_VERSION,
        "ticker": ticker,
        "role": role,
        "month": month,
        "as_of": as_of.isoformat(),
        "generated_at": generated_at,
        "already_in_returns": True,
        "effective_date_note": EFFECTIVE_DATE_NOTE,
        "fees": record.to_json() if record else None,
        "blockers": (
            []
            if record
            else [{
                "code": "no_fee_table_on_record",
                "message": f"No fee table for {ticker} was filed on or before {as_of.isoformat()}, so its costs for this month are not shown.",
                "remedy": "Read the fund's figures, which are already after its costs, or a later month.",
            }]
        ),
    }


FEES_SCHEMA_VERSION = "1.0"


def dumps(doc: dict[str, Any]) -> str:
    return json.dumps(doc, indent=2) + "\n"
