# Fonts vendored here

Both faces are licensed under the SIL Open Font License 1.1, which permits
bundling and redistribution — including embedding into a stylesheet as a
`data:` URI, which is what this build does (SF-18).

| File | Family | Weight | Subset | Source |
|---|---|---|---|---|
| `arvo-400-latin.woff2` | Arvo | 400 | latin | Google Fonts, Arvo v23 |
| `arvo-700-latin.woff2` | Arvo | 700 | latin | Google Fonts, Arvo v23 |
| `newsreader-var-latin.woff2` | Newsreader | 200–800 variable | latin | Google Fonts, Newsreader v26 |

Newsreader is a variable font: one file covers every weight the page uses, which
is why there is one of it and two of Arvo.

Only the **latin** subsets are vendored. Google serves latin-ext, Vietnamese and
Cyrillic cuts as separate files, and the whole set would roughly double the page
for coverage this app's copy does not use. If the interface is ever translated,
the matching subsets are vendored then and the stylesheet gains `unicode-range`
descriptors — which is the point of keeping this note.

## Why they are here rather than linked

Downloaded once, committed, and base64'd into `dist/styles.css` at build time.
A `<link>` to a font host is a network call on every open that tells that host
who is reading a page whose entire premise is that nobody is told anything
(SF-03, SF-18, inherited from FF D-42).

Separate `.woff2` files sitting beside the stylesheet would keep the page
smaller, and would break the moment someone moves `index.html` without the
folder. The `file://` case has to work.

The build asserts the stylesheet contains no `url()` that is not a `data:` URI,
so the promise is checked rather than remembered.

## SIL Open Font License 1.1

Arvo © Anton Koovit. Newsreader © Production Type.

The full licence text is at <https://openfontlicense.org>. Its substance, for
this use: the fonts may be bundled and redistributed with or without
modification, they may not be sold on their own, and the copyright notice and
licence must travel with them — which is what this file is.
