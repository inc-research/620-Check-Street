# %% [markdown]
# # Third Floor — monthly run
#
# Run this once a month. It fetches daily prices for the tracked funds and the
# benchmark anchors, works out the semibeta table for each fund over three
# trailing windows, and packages the result as a zip you download in one click.
#
# Nothing here is edited in place. The code this notebook runs lives in
# `notebook/thirdfloor/` in the repository and is covered by a test suite, so
# what runs in Colab is what the tests cover — see 3F D-05.
#
# **What to do afterwards:** unzip the download somewhere outside the repository
# — the zip is a transport format and is not tracked — then run
# `node scripts/ingest-snapshots.mjs` against it, rebuild the index, commit and
# push. The archive is append-only (3F D-08): a routine run adds new files and
# rewrites none. Section 6 has the exact sequence.

# %% [markdown]
# ## 1 · Get the code
#
# Point `REPO` at your own clone if you have forked it.

# %%
REPO = "https://github.com/inc-research/Third_Floor.git"
BRANCH = "main"

import os
import shutil
import subprocess
import sys

WORKDIR = "/content/third-floor"

if os.path.isdir(WORKDIR):
    shutil.rmtree(WORKDIR)

subprocess.run(
    ["git", "clone", "--depth", "1", "--branch", BRANCH, REPO, WORKDIR],
    check=True,
)

sys.path.insert(0, os.path.join(WORKDIR, "notebook"))
print("code at", WORKDIR)

# %%
subprocess.run(
    [sys.executable, "-m", "pip", "install", "-q", "-r",
     os.path.join(WORKDIR, "notebook", "requirements.txt")],
    check=True,
)
print("dependencies installed")

# %% [markdown]
# ## 2 · Settings
#
# `BACKFILL = True` produces the full archive and is what the very first run
# needs. Leave it `False` for the routine monthly run, which adds one file per
# fund and rewrites nothing.

# %%
BACKFILL = False
DEPTH = 19          # monthly snapshots, when backfilling (3F D-03)
ONLY = None         # e.g. ["SFLR", "QFLR"] for a quick trial run

from datetime import date

from thirdfloor.backfill import fetch_start_for, monthly_snapshot_dates
from thirdfloor.package import Run, most_recent_completed_month_end
from thirdfloor.semibeta import MIN_OBSERVATIONS_PER_CELL

REGISTRY = os.path.join(WORKDIR, "tickers.json")
ARCHIVE = os.path.join(WORKDIR, "data")   # snapshots already published
OUTPUT = "/content/third_floor_run"
ZIP_PATH = "/content/third_floor_package.zip"

end = most_recent_completed_month_end(date.today())
depth = DEPTH if BACKFILL else 1
snapshot_dates = monthly_snapshot_dates(end, depth)

print(f"{'backfill' if BACKFILL else 'monthly run'}: {depth} snapshot(s), "
      f"{snapshot_dates[0]:%Y-%m} to {snapshot_dates[-1]:%Y-%m}")
print(f"minimum observations per cell: {MIN_OBSERVATIONS_PER_CELL}")

# %% [markdown]
# ## 3 · Fetch
#
# One bulk pull per instrument — 31 funds plus 4 benchmark anchors, so 35 calls.
# The anchors are fetched once and shared by every fund that references them,
# and backfilling adds no further calls at all: the same pull is sliced in
# memory at each snapshot date.
#
# If a source refuses, the run falls through to the next one and records which
# answered. A response that does not look like price data is refused rather than
# parsed — a challenge page must never reach the archive.

# %%
os.makedirs(OUTPUT, exist_ok=True)
run = Run(REGISTRY, OUTPUT, archive_dir=ARCHIVE)
run.log(f"Third Floor run — {'backfill' if BACKFILL else 'monthly'}, "
        f"{depth} snapshot(s) ending {snapshot_dates[-1]}")
run.fetch_all(fetch_start_for(snapshot_dates), ONLY)

print()
print(f"fetched {len(run.sources)} instruments")
for ticker, record in sorted(run.sources.items()):
    print(f"  {ticker:<6} {record.source:<12} {record.rows:>5} rows  "
          f"{record.first} to {record.last}")
if run.failures:
    print()
    print("NO SOURCE ANSWERED FOR:")
    for ticker, why in run.failures.items():
        print(f"  {ticker}: {why}")

# %% [markdown]
# ## 4 · Compute
#
# Each fund is worked out against the universal anchor, always, and against its
# own named benchmark where it has one that this site tracks.
#
# A fund with less history than a window needs has that window blocked rather
# than computed over a shortened one, and the block says why in a sentence a
# reader can act on. Nothing is invented and nothing is zero-filled.

# %%
documents = run.build(snapshot_dates, DEPTH)

print()
print(f"{len(documents)} funds produced snapshots, "
      f"{sum(len(m) for m in documents.values())} files in total")

missing = [f.ticker for f in run.registry.funds if f.ticker not in documents]
if missing:
    print(f"no snapshots for: {', '.join(missing)}")

# %% [markdown]
# ## 5 · Package and download
#
# One zip: every snapshot, the manifest and the run log. The manifest records
# which source answered for each ticker and which windows were blocked, so the
# run can be audited later rather than taken on trust.

# %%
run.package(documents, snapshot_dates, DEPTH, ZIP_PATH)

try:
    from google.colab import files
    files.download(ZIP_PATH)
except ImportError:
    print(f"not running in Colab — the package is at {ZIP_PATH}")

# %% [markdown]
# ## 6 · What to do with the download
#
# ```
# unzip -o third_floor_package.zip -d /tmp/third-floor-run
# node scripts/ingest-snapshots.mjs /tmp/third-floor-run --dry-run
# node scripts/ingest-snapshots.mjs /tmp/third-floor-run
# node scripts/validate-snapshots.mjs
# npm run build:index
# git add data
# git commit -m "data: monthly run"
# git push
# ```
#
# `--dry-run` first: it names the months that would be added and writes nothing,
# so a run that carries a month already published is caught before it touches
# the tree. `git add data` is enough — the run manifest is written into
# `data/_runs/`, and there is no MANIFEST.json at the repository root to add.
# `build:index` regenerates `data/index.json`, which the page reads first and
# which `npm run check:index` will otherwise flag as stale.
#
# `ingest-snapshots.mjs` refuses to overwrite a snapshot that is already
# committed. That is the append-only rule (3F D-08) made mechanical: adjustment
# factors move as funds pay distributions, so a month regenerated later would
# not match the one already published, and the published one is the record.
