# Third Floor

What happened to money held in funds that use options, and how much of the market
they actually carried.

Third Floor follows a fixed list of 31 Options-Integrated ETFs. Every month it
works out, for each of them, what $100 became, beside the same money in the
market; the deepest fall along the way; how far the fund moved for every 1% the
market moved, on the days it rose and the days it fell; and how closely it
follows. All over the past twelve months, six months and thirteen weeks. The
reports are published as files in this repository and the site reads them. See
3F D-17.

The same-direction semibeta readings are still computed, archived, and shown in
a closed section of each report. The opposite-direction ones are computed and
archived but not shown: they could not be told from noise.

A four-week window was computed at first and dropped: it leaves too few days in
each case to report anything anybody should act on. See 3F D-10.

It is a descriptive tool. It does not give advice, or say anything about what any
of them does next. Its pages read one fund at a time; `OBSERVER/` sets the funds in
order on each measure, with every number and its formula shown. See 3F D-21.

**This README is short by design.** The real explanations live in the app, at the
moment they are needed — the reader this is built for does not open a README.

## How it runs

Two halves, deliberately separated:

| | |
|---|---|
| **`notebook/`** | A Colab notebook, run by hand once a month. It fetches daily prices, computes the readings, and packages them for download. |
| **`packages/web/`** | A static site on GitHub Pages. No server, no live computation. It reads whatever is already in `data/` and lays it out. |

The split exists because a browser cannot fetch price data across origins, and a
Python process is not subject to that restriction at all. Monthly cadence matches
the use: this serves people checking on funds they hold, not people trading on
signals.

## The monthly run

1. Open `notebook/third_floor.ipynb` in Colab and run it. It clones this
   repository, so the code it runs is the code the tests cover.
2. Download the zip it produces.
3. ```sh
   unzip -o third_floor_package.zip -d /tmp/third-floor-run
   node scripts/ingest-snapshots.mjs /tmp/third-floor-run
   node scripts/validate-snapshots.mjs
   npm run build:index && npm run build:observer
   npm run validate:observer
   git add data OBSERVER && git commit -m 'data: monthly run' && git push
   ```

`ingest-snapshots.mjs` refuses to overwrite a month that is already published.
The archive is append-only — see 3F D-08.

If months were missed, run it locally from the repository root, with
`PYTHONPATH=notebook python3 -m thirdfloor.package --months N`, which adds the
last N completed months and nothing else. See 3F D-16.

## What the site shows

`data/index.json` lists every fund and the months it has. Each
`data/<TICKER>/<YYYY-MM>.json` is one report. The page reads them by relative
path and computes nothing of its own.

A number is only printed where at least six days went into it; below that it
shows a dash, which is not a zero. Between six and twenty days it is printed with
a dotted underline saying how few days are behind it. See 3F D-11.

There are three ways to read a report, and each one holds everything still
except the one thing it varies:

| | Varies | Holds still |
|---|---|---|
| **The report** | the length of the window | the fund, the date, the benchmark |
| **Has this fund changed?** | the date, across two real archived reports | the fund, the window length, the benchmark |
| **Comparing two funds** | the fund | the date, the window length, the benchmark |

Anything else that moved would be a second explanation for what the table shows,
with nothing on the page to separate the two — so each one refuses rather than
approximating. The two comparisons name what they could not compare, and why.
See 3F D-13 and 3F D-14.

Above the fund list sit the **selected reports**: dated studies across the funds,
fixed as of the day they were published, each read from one file in
`data/_studies/`. The first is Gain Exposure, which sets synthetic longs beside
equity sleeves for 2026 and on 4 and 5 November. See 3F D-25 and
`analysis/gain_exposure_2026-11/`.

## The OBSERVER Folder

`OBSERVER/` is this analysis in OBSERVER Format 0.1: the five highest and lowest
funds on each of eight measures first, then every value with its formula and its
inputs. It is for agents working in this repository, and the site offers it as a
zip to add to a conversation with any AI system. It is generated from `data/` by
`scripts/build_observer.py` and never edited by hand. The build refuses to write
if a published formula disagrees with the archive or the core. See 3F D-21.

`scripts/validate_observer.py` is the OBSERVER kit's checker, copied verbatim and
not edited.

## Working on it

```sh
npm install
npm run build          # typecheck every package
npm test               # the TypeScript suites
python3 -m unittest discover notebook/test    # the notebook package
npm run check:vendored # vendored modules are still verbatim
npm run check:notebook # third_floor.ipynb is not stale
npm run check:index    # data/index.json matches what is on disk
npm run validate:data  # every committed snapshot
npm run validate:reports # every report, and that it matches its snapshot
npm run check:registry # the registry's reader-facing prose passes the lint
npm run check:observer # OBSERVER/ matches the archive
npm run validate:observer # conformance, then replication from the folder alone
npm run build --workspace @third-floor/web
node packages/web/serve.mjs
```

Edit `notebook/third_floor.py`, never the `.ipynb` — the notebook is generated
(3F D-05). Run `npm run build:notebook` after changing it.

`tickers.json` carries two notes per fund where its benchmark is not an exact
match. `benchmark_note` is provenance, written for whoever maintains the file,
and never reaches a reader. `benchmark_note_plain` is what the report shows, and
it is linted like any other copy (3F D-15). Adding the first without the second
fails to load.

`floor_foundations/` is a read-only handover tree from Second Floor. It is
gitignored, not built, and not part of this repository's history; the modules
vendored out of it are committed under `packages/` with provenance headers.

## Where things are written down

- **`AGENTS.md`** — the build spec.
- **`DECISIONS.md`** — every decision, with the condition that would reverse it.
- **`schemas/`** — the snapshot and registry contracts, argued for in their own
  `description` fields.
- **`tickers.json`** — the locked coverage set. The permanent source of truth,
  read on every run.

## Licence

Code under MIT. The written explanations under CC BY 4.0 — the plain-English copy
is the actual contribution here and should be quotable and translatable.
