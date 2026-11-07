#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Recompute this OBSERVER Folder from the folder alone.

Reads 1.0_INDEX.md, 2.0_VALENCE.md, 3.0_PERCEPTION.md and 4.0_RAW_DATA.csv, and
nothing else. For every object it defines the published formula, calls it with
exactly the rows and columns `verify` names, and confirms the value. It then
rebuilds each population from the raw rows and confirms both relative
observations, the relative value, the elevation rule and the rank order.

    python3 replicate.py [path/to/OBSERVER]

Exits 0 when everything agrees, 1 otherwise. Needs Python 3.10+ and PyYAML. It
runs the formulas printed in the folder, as any replication has to, so read them
first if the folder came from somewhere you do not trust.
"""

from __future__ import annotations

import csv
import re
import sys
from pathlib import Path

import yaml

TOLERANCE = 0.00005001


def front(text: str) -> dict:
    return yaml.safe_load(text.split("---\n", 2)[1])


def objects(text: str) -> list[dict]:
    return [yaml.safe_load(b) for b in re.findall(r"```yaml\n(.*?)```", text, flags=re.S)]


def define(formula: str, name: str):
    scope: dict = {}
    exec(formula, scope)
    return scope[name]


def number(cell: str):
    if cell == "":
        return None
    try:
        return float(cell)
    except ValueError:
        return cell


def main() -> int:
    folder = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
    index = front((folder / "1.0_INDEX.md").read_text(encoding="utf-8"))
    perception = objects((folder / "3.0_PERCEPTION.md").read_text(encoding="utf-8"))
    valence = objects((folder / "2.0_VALENCE.md").read_text(encoding="utf-8"))

    spec = index["raw_data"]["files"][0]
    key = spec["key"]
    with (folder / spec["path"]).open(newline="", encoding="utf-8") as f:
        table = {tuple(r[k] for k in key): r for r in csv.DictReader(f)}

    def row(selector: dict) -> dict | None:
        return table.get(tuple(selector[k] for k in key))

    failures: list[str] = []
    checks = 0

    def agree(label: str, got, want) -> None:
        nonlocal checks
        checks += 1
        same = got == want if got is None or want is None or isinstance(want, str) \
            else abs(float(got) - float(want)) <= TOLERANCE
        if not same:
            failures.append(f"{label}: recomputed {got}, published {want}")

    computed: dict[str, float] = {}
    for o in perception:
        name, verify = o["metric"], o["verify"]
        fn = define(o["trust"]["formula"], name)
        rows = verify["rows"]
        months = rows["report_month"] if isinstance(rows["report_month"], list) else [rows["report_month"]]
        selected = {m: row({**rows, "report_month": m}) for m in months}

        if isinstance(o["value"], str):
            checks += 1
            if not o["value"].startswith("not_reported_") or not verify.get("notes"):
                failures.append(f"{o['id']}: a labelled value must give its reason")
            continue

        if "args" in verify:
            args = {}
            for arg, entry in verify["args"].items():
                source = selected[entry["rows"]["report_month"]]
                args[arg] = number(source[entry["column"]])
        else:
            source = selected[months[0]]
            args = {c: number(source[c]) for c in verify["columns"]}
        result = fn(**args)
        computed[o["id"]] = result
        agree(o["id"], result, o["value"])

    anchor = index["valence"]["elevation"]["rule"].split("measured against ")[1].split(",")[0]
    rank_fn = define(index["valence"]["relative_obs"][0]["formula"], "rel_ob_rank")
    z_fn = define(index["valence"]["relative_obs"][1]["formula"], "rel_ob_z")
    rv_fn = define(index["valence"]["relative_value"]["formula"], "relative_value")
    edge = int(re.search(r"rel_ob_rank <= (\d+)", index["valence"]["elevation"]["rule"]).group(1))

    populations: dict[str, list[dict]] = {}
    for o in perception:
        if o["id"] in computed and o["subject"].endswith(f".{anchor}"):
            populations.setdefault(o["metric"], []).append(o)

    for o in perception:
        obs = {x["rel_ob"]: x for x in o["observations"]}
        members = populations.get(o["metric"], [])
        if o not in members:
            agree(f"{o['id']} relative_value", o["relative_value"], None)
            checks += 1
            if o["elevated"]:
                failures.append(f"{o['id']}: elevated outside the population")
            continue
        values = [computed[m["id"]] for m in members]
        value = computed[o["id"]]
        rank = rank_fn(value, values)
        z = z_fn(value, values)
        agree(f"{o['id']} rel_ob_rank", rank, obs["rel_ob_rank"]["value"])
        agree(f"{o['id']} rel_ob_z", z, obs["rel_ob_z"]["value"])
        agree(f"{o['id']} relative_value", rv_fn(rank, z), o["relative_value"])
        due = rank <= edge or rank >= len(values) - (edge - 1)
        checks += 1
        if bool(o["elevated"]) != due:
            failures.append(f"{o['id']}: rank {rank} of {len(values)}, elevated {o['elevated']}")

    weights = [(o["relative_value"] is None, -(o["relative_value"] or 0)) for o in perception]
    checks += 1
    if weights != sorted(weights):
        failures.append("3.0_PERCEPTION.md is not ordered by relative_value")
    chosen = [o["id"] for o in perception if o["elevated"]]
    checks += 1
    if chosen != [o["id"] for o in valence]:
        failures.append("2.0_VALENCE.md does not hold exactly the elevated objects, in order")

    for line in failures[:40]:
        print(f"FAIL {line}")
    print(f"replicate: {checks} checks, {len(failures)} failures, "
          f"{len(computed)} values recomputed, {len(valence)} elevated")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
