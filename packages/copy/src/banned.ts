// SPDX-License-Identifier: MIT
//
// The banned-word list. Third Floor's own module; the matching machinery in
// lint.ts is vendored and is not edited (SF-17).
//
// Many entries are perfectly good technical terms, and that is precisely the
// argument for banning them. The reader came to check something they already
// own, so any evaluative adjective is read as advice to act on. The replacement
// is always the number.

/**
 * First Floor's original eight. Every one of them makes a promise about the
 * future that no reading of past prices can support.
 */
const FAMILY_WORDS = [
  'protect',
  'protects',
  'protected',
  'protection',
  'safe',
  'safely',
  'safety',
  'guarantee',
  'guarantees',
  'guaranteed',
  'should',
  'will ensure',
  'ensures',
  'ensure',
] as const;

/**
 * Third Floor's own. Second Floor's seventeen weighting verdicts are dropped:
 * they are about how much of a holding a fund owns. The fund reports never look
 * at holdings. A selected report (3F D-25) reads them only to put a fund in a
 * group, and still makes no judgement about how much of anything a fund owns.
 *
 * These are the words the funds themselves use. A fund that calls itself
 * "buffered" is making a claim, and this app exists to set that claim beside
 * what the fund's prices actually did — so repeating the claim in Third Floor's
 * own voice would quietly endorse the thing being checked.
 */
const THIRD_FLOOR_WORDS = [
  'downside protection',
  'defensive',
  'defensively',
  'cushion',
  'cushions',
  'shielded',
  'shields',
  'outperform',
  'outperforms',
  'outperformed',
  'underperform',
  'underperforms',
  'underperformed',
  'beat the market',
  'risk-free',
  'riskless',
  'de-risked',
  'superior',
  'inferior',
  'attractive',
  'unattractive',
  'sophisticated',
  'conservative',
  'aggressive',
] as const;

export const BANNED_WORDS: readonly string[] = [...FAMILY_WORDS, ...THIRD_FLOOR_WORDS];

/**
 * Straight quotes and apostrophes. The source strings are single-quoted, so a
 * straight apostrophe closes the string and breaks the build — a convention
 * with teeth. The straight double quote would not, so it is caught here.
 */
export const TYPOGRAPHY_PATTERNS: readonly { pattern: RegExp; message: string }[] = [
  { pattern: /"/, message: 'straight double quote; use “ ”' },
  { pattern: /(\w)'(\w)/, message: 'straight apostrophe; use ’' },
  { pattern: /\.\.\./, message: 'three dots; use …' },
  { pattern: / - /, message: 'hyphen used as a dash; use —' },
];
