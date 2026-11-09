# Gain Exposure: YTD 2026, with 4 and 5 November (3F D-25)

The analysis behind the first selected report. The site reads only
`data/_studies/gain-exposure-2026-11.json`, which `export.py` writes from
`results.json` here. Figures are fixed as of 2026-11-09 and are not rebuilt monthly.

## Rerun, from the repository root

```
python3 analysis/gain_exposure_2026-11/pull_holdings.py                    # SEC, throttled  -> grouping_draft.json
PYTHONPATH=notebook python3 analysis/gain_exposure_2026-11/pull_prices.py --out <cache.json>   # 35 pulls
PYTHONPATH=notebook python3 analysis/gain_exposure_2026-11/study.py --prices <cache.json>      # -> results.json
python3 analysis/gain_exposure_2026-11/export.py                           # -> data/_studies/…json
python3 analysis/gain_exposure_2026-11/export.py --check                   # CI: committed file is current
python3 -m unittest discover analysis/gain_exposure_2026-11/test           # synthetic, no network
```

The price cache is not committed (yfinance data, as with `analysis/capture_trend.py`).
Rerunning `study.py` on the 2026-11-09 cache reproduces `results.json` exactly apart
from its timestamp.

## Files

| file | what |
|---|---|
| `pull_holdings.py` | sums each fund's latest public NPORT-P by kind of holding and drafts a group; looks through a held fund one level |
| `lookthrough_manual.json` | BUFF's rung (PNOV) and CPSL's rung (Calamos September), found by EDGAR full-text search because neither has a ticker on EDGAR |
| `grouping.json` | the grouping the owner approved on 2026-11-09 |
| `study.py` | every figure: legs, U, B, E, week-block bootstrap, size bands, 4 and 5 November |
| `export.py` | the compact document the page reads, with provenance |

## Definitions

- Days: every day the benchmark rose or fell, the site's net capture (`exposure.market_side`). Summed, never compounded (3F D-17).
- U = upside capture; B = loss buffer = 1 − down capture (3F D-24); E = (1 − B) ÷ U.
- Range: ISO-week block bootstrap, 4,000 draws, seed 20261109. Settled only where the whole 95% range is on one side of 1.
- 5 November's E = the day's down capture over the year's U, the same number as the fund's give-back over the market's.
- Groups: equity sleeve with a hedge (stocks held directly; stocks held through an index ETF) and synthetic long (held directly; ladder of funds). DBMF is shown for reference only.

## Checks run

- All 76 thirteen-week capture cells in `data/_reports/*/2026-10.json` reproduced from the same pull, worst gap 9.9e-07.
- 8 property tests (`test/`).
- `packages/core/src/study/validate.ts` proves E, U + B, leg ends, 5 November's E, labels and every group median from the committed document.
