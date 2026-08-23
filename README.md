# Third Floor

How funds that use options actually responded to the market — on the days it
rose, and the days it fell.

Third Floor follows a fixed list of 31 Options-Integrated ETFs. Every month it
works out, for each of them, how big its move was compared with the market's on
each of the four combinations of directions the two can move in — over the past
twelve months, six months and thirteen weeks. The reports are published as files
in this repository and the site reads them.

A four-week window was computed at first and dropped: split across four
combinations it leaves about four days in each, which is not enough to report
anything anybody should act on. See 3F D-10.

It is a descriptive tool. It does not give advice, rank funds, or say anything
about what any of them does next.

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
   git add data && git commit -m 'data: monthly run' && git push
   ```

`ingest-snapshots.mjs` refuses to overwrite a month that is already published.
The archive is append-only — see 3F D-08.

## Working on it

```sh
npm install
npm run build          # typecheck every package
npm test               # the TypeScript suites
python3 -m unittest discover notebook/test    # the notebook package
npm run check:vendored # vendored modules are still verbatim
npm run check:notebook # third_floor.ipynb is not stale
npm run validate:data  # every committed snapshot
npm run build --workspace @third-floor/web
node packages/web/serve.mjs
```

Edit `notebook/third_floor.py`, never the `.ipynb` — the notebook is generated
(3F D-05). Run `npm run build:notebook` after changing it.

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
