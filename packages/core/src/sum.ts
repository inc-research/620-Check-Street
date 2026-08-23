// SPDX-License-Identifier: MIT
//
// Vendored verbatim from Second Floor: packages/core/src/sum.ts
// Do not edit in place (SF-17). Changes belong in a new Third Floor module.
// Verified byte-identical by scripts/check-vendored.mjs.
//
// ---- vendored body below; do not edit (SF-17) ----
// SPDX-License-Identifier: MIT
//
// Vendored verbatim from First Floor: packages/core/src/pricing/sum.ts
// Do not edit in place (SF-17). Changes belong in a new Second Floor module.
// Verified byte-identical by scripts/check-vendored.mjs.
//
// ---- vendored body below; do not edit (SF-17) ----
// SPDX-License-Identifier: MIT

/**
 * Exact summation, matching Python's `math.fsum` bit for bit.
 *
 * This module is load-bearing and it is not an optimisation. The golden vectors
 * in `vectors/` are produced by an oracle whose every float accumulation goes
 * through `math.fsum`, so a naive left-to-right loop here reproduces neither
 * vector file. See COMPUTATIONAL_SPEC.md section 0.
 *
 * The reason the oracle uses `fsum` at all is worth knowing, because it looks
 * like fussiness and is not. Python 3.12 changed the `sum()` builtin to use
 * Neumaier compensated summation. The same oracle source therefore produced
 * results differing in the last ulp depending on the interpreter's minor
 * version — a determinism defect under invariant 6. `fsum` is exactly rounded,
 * so it has no version or platform dependence, and it gives this port a target
 * that is a mathematical fact rather than an accident of someone's runtime.
 *
 * Algorithm: Shewchuk's exact summation. Maintain a list of non-overlapping
 * partial sums whose exact total equals the exact total of the inputs, then
 * round once at the end.
 *
 * Adapted from CPython's `math_fsum` in Modules/mathmodule.c, including its
 * half-even fix-up, which is required for agreement on ties.
 */

/** Sum `values` with a single correctly-rounded result. Matches `math.fsum`. */
export function fsum(values: Iterable<number>): number {
  const partials: number[] = [];
  let n = 0;

  for (const value of values) {
    let x = value;
    let i = 0;
    for (let j = 0; j < n; j++) {
      let y = partials[j] as number;
      if (Math.abs(x) < Math.abs(y)) {
        const t = x;
        x = y;
        y = t;
      }
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo !== 0) {
        partials[i++] = lo;
      }
      x = hi;
    }
    if (!Number.isFinite(x)) {
      // CPython distinguishes two cases here and so must this, because the
      // difference is between "your data contained an infinity" and "our
      // accumulator overflowed on finite data". Only the second is a bug, and
      // silently returning Infinity for it would be a wrong number with no
      // caveat at all.
      if (Number.isFinite(value)) {
        throw new RangeError('intermediate overflow in fsum');
      }
      return x;
    }

    n = i;
    partials[n++] = x;
    partials.length = n;
  }

  if (n === 0) return 0;

  // Sum the partials from largest to smallest, stopping at the first inexact
  // addition, then apply the half-even correction so that a run of ulp/2
  // values does not round up.
  let hi = partials[--n] as number;
  let lo = 0;
  while (n > 0) {
    const x = hi;
    const y = partials[--n] as number;
    hi = x + y;
    lo = y - (hi - x);
    if (lo !== 0) break;
  }
  if (
    n > 0 &&
    ((lo < 0 && (partials[n - 1] as number) < 0) ||
      (lo > 0 && (partials[n - 1] as number) > 0))
  ) {
    const y = lo * 2;
    const x = hi + y;
    if (y === x - hi) hi = x;
  }
  return hi;
}

/** `fsum` over a mapped sequence, so call sites read like the oracle's generator expressions. */
export function fsumBy<T>(items: Iterable<T>, f: (item: T) => number): number {
  const out: number[] = [];
  for (const item of items) out.push(f(item));
  return fsum(out);
}
