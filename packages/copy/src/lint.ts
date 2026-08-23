// SPDX-License-Identifier: MIT
//
// Vendored verbatim from Second Floor: packages/copy/src/lint.ts
// Do not edit in place (SF-17). Changes belong in a new Third Floor module.
// Verified byte-identical by scripts/check-vendored.mjs.
//
// ---- vendored body below; do not edit (SF-17) ----
// SPDX-License-Identifier: MIT
//
// Vendored verbatim from First Floor: packages/copy/src/lint.ts
// Do not edit in place (SF-17). Changes belong in a new Second Floor module.
// Verified byte-identical by scripts/check-vendored.mjs.
//
// ---- vendored body below; do not edit (SF-17) ----
// SPDX-License-Identifier: MIT

/**
 * The banned-word lint for plain mode (D-25).
 *
 * Plain mode replaces jargon with mechanism, never with a verdict. These words
 * are the ones that turn a measurement into a forecast or a promise, which is
 * the single failure the whole project is arranged to avoid: *"at a reference
 * level of −20%, these contracts pay X"* is a measurement, *"this fund will
 * lose 12.4%"* is a forecast, and they are one careless verb apart.
 *
 * Matching is on word boundaries, so "willing" and "safety" survive while
 * "will" and "safe" do not. The rule applies to prose, not to field names — a
 * `protection_kind` key in a data structure is a label, not a claim.
 */
export const BANNED_IN_PLAIN = [
  'protect',
  'protected',
  'safe',
  'guarantee',
  'guaranteed',
  'should',
  'will',
  'ensures',
] as const;

export interface LintFinding {
  /** Where the offending text lives, e.g. `terminal_floor.mechanism`. */
  location: string;
  word: string;
  /** The sentence it appeared in, for context. */
  excerpt: string;
}

const PATTERNS = BANNED_IN_PLAIN.map(
  (w) => [w, new RegExp(`\\b${w}\\b`, 'i')] as const,
);

/** Find banned words in a single string. */
export function lintText(location: string, text: string): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const [word, pattern] of PATTERNS) {
    const m = pattern.exec(text);
    if (m) {
      const start = Math.max(0, m.index - 40);
      findings.push({
        location,
        word,
        excerpt: (start > 0 ? '…' : '') + text.slice(start, m.index + word.length + 40).trim(),
      });
    }
  }
  return findings;
}

/** Lint every string in a nested object, reporting dotted paths. */
export function lintDeep(root: unknown, prefix = ''): LintFinding[] {
  const findings: LintFinding[] = [];
  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'string') {
      findings.push(...lintText(path, node));
    } else if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
    } else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(root, prefix);
  return findings;
}

export function formatFindings(findings: readonly LintFinding[]): string {
  return findings
    .map((f) => `${f.location}: banned word "${f.word}" in "${f.excerpt}"`)
    .join('\n');
}
