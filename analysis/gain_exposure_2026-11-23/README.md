# Gain Exposure: YTD 2026, with 4 to 23 November (3F D-25, D-26)

The analysis behind the first selected report. The site reads only
`data/_studies/gain-exposure-2026-11-23.json`, which `export.py` writes from
`results.json` here. Figures are fixed as of 2026-11-24 and are not rebuilt monthly. It replaced the
first edition (`analysis/gain_exposure_2026-11/`, 4 and 5 November alone) on the site.

## Rerun, from the repository root

```
python3 analysis/gain_exposure_2026-11-23/pull_holdings.py                    # SEC, throttled  -> grouping_draft.json
PYTHONPATH=notebook python3 analysis/gain_exposure_2026-11-23/pull_prices.py --out <cache.json>   # 35 pulls
PYTHONPATH=notebook python3 analysis/gain_exposure_2026-11-23/study.py --prices <cache.json>      # -> results.json
python3 analysis/gain_exposure_2026-11-23/export.py                           # -> data/_studies/…json
python3 analysis/gain_exposure_2026-11-23/export.py --check                   # CI: committed file is current
python3 -m unittest discover analysis/gain_exposure_2026-11-23/test           # synthetic, no network
```

The price cache is not committed (yfinance data, as with `analysis/capture_trend.py`).
Rerunning `study.py` on the 2026-11-24 cache reproduces `results.json` exactly apart
from its timestamp. `grouping.json` and `lookthrough_manual.json` are the first
edition's, unchanged: holdings were not pulled again.

## Files

| file | what |
|---|---|
| `pull_holdings.py` | sums each fund's latest public NPORT-P by kind of holding and drafts a group; looks through a held fund one level |
| `lookthrough_manual.json` | BUFF's rung (PNOV) and CPSL's rung (Calamos September), found by EDGAR full-text search because neither has a ticker on EDGAR |
| `grouping.json` | the grouping the owner approved on 2026-11-09 |
| `study.py` | every figure: legs, U, B, E, week-block bootstrap, size bands, the 4–23 November window |
| `export.py` | the compact document the page reads, with provenance |

## Definitions

- Days: every day the benchmark rose or fell, the site's net capture (`exposure.market_side`). Summed, never compounded (3F D-17).
- U = upside capture; B = loss buffer = 1 − down capture (3F D-24); E = (1 − B) ÷ U.
- Range: ISO-week block bootstrap, 4,000 draws, seed 20261109. Settled only where the whole 95% range is on one side of 1.
- Window = 4 to 23 November 2026, 14 trading days. Its own U, B and E pool its rising and falling days, and a side with fewer than six days gives none (3F D-11): VOO rose on five. Group medians of window U, B and E only where every member has one.
- Window give-back = the window's summed falls over the year's summed rises, fund over market = the window's down capture over the year's U. Defined for every fund. No range: three weeks are too few blocks.
- Each window day on its own: move, share, size band against the year's days, rank against them.
- Groups: equity sleeve with a hedge (stocks held directly; stocks held through an index ETF) and synthetic long (held directly; ladder of funds). DBMF is shown for reference only.

## Checks run

- First edition: all 76 thirteen-week capture cells in `data/_reports/*/2026-10.json` reproduced from its pull, worst gap 9.9e-07.
- This edition: every fund's YTD U, B and E reproduce the first edition's `results.json` from the 2026-11-24 pull, worst gap 1.4e-06; no settled label changed; VOO's 4 and 5 November moves match.
- 13 property tests (`test/`), five of them on the window.
- `packages/core/src/study/validate.ts` proves E, U + B, leg ends, the window's days, sums, U, B, E and give-back, labels and every group median from the committed document.
