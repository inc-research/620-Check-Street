// SPDX-License-Identifier: MIT
//
// Third Floor's extension to the vendored lint.
//
// `lint.ts` carries the family's matching machinery and its own word list, and
// is never edited in place (SF-17). This module reuses that matcher and adds
// Third Floor's own vocabulary and the typography checks on top, so both lists
// run over the same text without either file diverging from its origin.

import { BANNED_WORDS, TYPOGRAPHY_PATTERNS } from './banned.ts';
import { lintDeep as vendoredLintDeep, type LintFinding } from './lint.ts';

const PATTERNS: readonly (readonly [string, RegExp])[] = BANNED_WORDS.map(
  (w) => [w, new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')] as const,
);

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 40);
  return (start > 0 ? '…' : '') + text.slice(start, index + length + 40).trim();
}

/** Third Floor's own words, on top of whatever the vendored list already caught. */
export function lintTextExtended(location: string, text: string): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const [word, pattern] of PATTERNS) {
    const m = pattern.exec(text);
    if (m) {
      findings.push({ location, word, excerpt: excerptAround(text, m.index, word.length) });
    }
  }
  for (const { pattern, message } of TYPOGRAPHY_PATTERNS) {
    const m = pattern.exec(text);
    if (m) {
      findings.push({ location, word: message, excerpt: excerptAround(text, m.index, m[0].length) });
    }
  }
  return findings;
}

/** Walk a nested object, running both lists over every string in it. */
export function lintDeepExtended(root: unknown, prefix = ''): LintFinding[] {
  const findings: LintFinding[] = [...vendoredLintDeep(root, prefix)];

  const walk = (node: unknown, path: string): void => {
    if (typeof node === 'string') {
      findings.push(...lintTextExtended(path, node));
    } else if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
    } else if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(root, prefix);

  return findings;
}

export type { LintFinding };
