#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""notebook/third_floor.py -> notebook/third_floor.ipynb (3F D-05).

The .py is the source of truth and the .ipynb is generated, because a notebook
diffs unreadably in git — every run rewrites execution counts and output blobs,
and a real change disappears into the noise.

Cells are separated by lines beginning `# %%`. A cell marked `# %% [markdown]`
becomes a markdown cell with its leading `# ` comment markers stripped.

Outputs are always stripped, so the committed notebook is source and never a
record of somebody's run.

  python3 scripts/build-notebook.py            write the notebook
  python3 scripts/build-notebook.py --check    fail if it would change
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "notebook" / "third_floor.py"
TARGET = ROOT / "notebook" / "third_floor.ipynb"


def split_cells(text: str) -> list[tuple[str, str]]:
    cells: list[tuple[str, str]] = []
    kind, buffer = "code", []

    for line in text.splitlines():
        if line.startswith("# %%"):
            if buffer:
                cells.append((kind, "\n".join(buffer).strip("\n")))
            kind = "markdown" if "[markdown]" in line else "code"
            buffer = []
            continue
        buffer.append(line)

    if buffer:
        cells.append((kind, "\n".join(buffer).strip("\n")))

    return [(k, body) for k, body in cells if body.strip()]


def to_notebook(cells: list[tuple[str, str]]) -> dict:
    out = []
    for kind, body in cells:
        if kind == "markdown":
            stripped = "\n".join(
                line[2:] if line.startswith("# ") else line[1:] if line == "#" else line
                for line in body.splitlines()
            )
            out.append(
                {"cell_type": "markdown", "metadata": {}, "source": stripped.splitlines(keepends=True)}
            )
        else:
            out.append(
                {
                    "cell_type": "code",
                    "execution_count": None,
                    "metadata": {},
                    "outputs": [],
                    "source": body.splitlines(keepends=True),
                }
            )

    return {
        "cells": out,
        "metadata": {
            "colab": {"provenance": [], "toc_visible": True},
            "kernelspec": {"display_name": "Python 3", "name": "python3"},
            "language_info": {"name": "python"},
        },
        "nbformat": 4,
        "nbformat_minor": 0,
    }


def render() -> str:
    if not SOURCE.exists():
        raise SystemExit(f"missing source: {SOURCE}")
    return json.dumps(to_notebook(split_cells(SOURCE.read_text(encoding="utf-8"))), indent=1) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if the notebook is stale")
    args = parser.parse_args(argv)

    rendered = render()

    if args.check:
        if not TARGET.exists():
            print(f"build-notebook: {TARGET.name} has not been generated", file=sys.stderr)
            return 1
        if TARGET.read_text(encoding="utf-8") != rendered:
            print(
                f"build-notebook: {TARGET.name} is stale — run `npm run build:notebook`",
                file=sys.stderr,
            )
            return 1
        print(f"build-notebook: {TARGET.name} is up to date")
        return 0

    TARGET.write_text(rendered, encoding="utf-8")
    cells = split_cells(SOURCE.read_text(encoding="utf-8"))
    print(f"build-notebook: wrote {TARGET.name}, {len(cells)} cells")
    return 0


if __name__ == "__main__":
    sys.exit(main())
