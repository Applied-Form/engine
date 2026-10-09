# Fonts

Self-hosted latin subsets, woff2. All three families are licensed under the SIL Open Font License 1.1.

| File | Family | Axes / weight | Source |
|---|---|---|---|
| `fraunces-variable.woff2`, `-italic` | Fraunces | opsz 9–144, wght 100–900 | Undercase Type, via Google Fonts |
| `libre-franklin-variable.woff2`, `-italic` | Libre Franklin | wght 100–900 | Impallari Type, via Google Fonts |
| `ibm-plex-mono-{300,400,700}.woff2`, `-italic` | IBM Plex Mono | static 300 / 400 / 700 | IBM, via Google Fonts |

`scripts/build-css.mjs` reads this directory and writes the matching `@font-face` blocks into `dist/tokens.css` with `font-display: swap`. Paths are relative to `dist/`, so serve `fonts/` beside it or rewrite the URLs at deploy time.

Each family's copyright notice and the full licence travel with the files, as the OFL requires of
anyone who redistributes them: `OFL-Fraunces.txt`, `OFL-LibreFranklin.txt`, `OFL-IBMPlexMono.txt`,
each taken unchanged from the family's upstream repository. The licence is also at
https://openfontlicense.org.
