// SPDX-License-Identifier: MIT
//
// What each benchmark ticker stands in for.
//
// A ticker is not a market. The reader is shown "VOO" and asked to read their
// own fund against it, which only means something if they are also told what
// VOO tracks. The four here are the anchors declared in tickers.json; a fifth
// anchor would need a line written here before it could be offered, which is
// the point of keeping this a record rather than a lookup with a fallback.

export interface BenchmarkIndex {
  /** The index name alone, short enough to sit inside a dropdown option. */
  short: string;
  /** The full sentence, shown beneath the control. */
  note: string;
}

export const BENCHMARK_INDEX: Record<string, BenchmarkIndex> = {
  VOO: {
    short: 'S&P 500',
    note: 'VOO is used here as a proxy for the S&P 500 — the 500 largest companies listed in the United States.',
  },
  QQQ: {
    short: 'Nasdaq-100',
    note: 'QQQ is used here as a proxy for the Nasdaq-100 — the largest non-financial companies on the Nasdaq exchange.',
  },
  IWM: {
    short: 'Russell 2000',
    note: 'IWM is used here as a proxy for the Russell 2000 — smaller companies listed in the United States.',
  },
  EFA: {
    short: 'MSCI EAFE',
    note: 'EFA is used here as a proxy for MSCI EAFE — developed markets outside the United States and Canada.',
  },
};

/** The sentence for one ticker, or an empty string where none is written. */
export function benchmarkIndexNote(ticker: string): string {
  return BENCHMARK_INDEX[ticker]?.note ?? '';
}

/** The index name alone, or an empty string where none is written. */
export function benchmarkIndexShort(ticker: string): string {
  return BENCHMARK_INDEX[ticker]?.short ?? '';
}
