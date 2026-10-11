# Fonts

The fonts the site and the studio use, from Google Fonts, kept here so that
building the site never needs the network. Each is split by alphabet, as
Google serves it, and a browser downloads a part only when a page shows one
of its characters.

Everything here is written by `scripts/fonts.mjs`; don't edit it by hand.
To add, change or update a font, edit the list at the top of that script
and run `node scripts/fonts.mjs` (it needs the network).

- `files/`: the font files, one per font and alphabet.
- `geist.ts`, `site.ts`, `plugin.ts`: each font's Latin part, loaded through
  `next/font/local`, which preloads it on the pages that import the module
  and sizes a fallback font to match it while it loads.
- `alphabets.css`: the other alphabets (Latin Extended, Cyrillic, Greek,
  Vietnamese...), imported by the root layout.
- `licenses/`: the fonts' licenses (all SIL Open Font License 1.1). They're
  credited in `src/content/licenses.json`.
