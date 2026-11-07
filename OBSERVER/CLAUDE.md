---
type: OBSERVER Entry
navigation:
  layer: entry
  entry: 1.0_INDEX.md
  down: 1.0_INDEX.md
  note: This folder is an OBSERVER Folder. Its contract and folder map are in 1.0_INDEX.md. README.md,
    AGENTS.md and CLAUDE.md are identical copies; reading one makes the other two unnecessary.
---

# Third Floor: market capture of options-integrated funds

This folder is an OBSERVER Folder: a quantitative analysis arranged so the most important results come first, each with its formula and its raw inputs attached. Specification: [OBSERVER Format, version 0.1](https://observerformat.io/specification).

How much of the market’s rises and falls each of 31 options-integrated funds carried, and how that moved, as of 2026-10-30, with the highest and lowest five funds on each of 8 measures.

Report date **2026-10-30**. These figures describe past periods and are not advice.

## Reading order

1. `1.0_INDEX.md`: what this Observer measures and the rules that decide which results reach the top layer. Its frontmatter alone is enough to judge relevance.
2. `2.0_VALENCE.md`: the five highest and five lowest funds on each of 8 measures. For most tasks, the tables at its top are enough.
3. `3.0_PERCEPTION.md`: all 304 computed values, for context.
4. `4.0_RAW_DATA.csv`: 2259 rows × 23 columns. Trust verification with select columns and rows only. Full data set only intended for full reading when verification of values reported in `2.0_VALENCE.md` and/or `3.0_PERCEPTION.md` is explicitly requested by the user or programmatically mandated by the assigned workflow.

`1.1_LOG.md` holds the report history and any changes to the rules. `references/replicate.py` recomputes the folder from itself.

README.md, AGENTS.md and CLAUDE.md in this folder are identical copies. Reading one makes the other two unnecessary.
