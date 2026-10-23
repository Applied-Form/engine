# Standards by Applied Form

A design-system conformance gate measured in a real browser. Give it a DTCG token file and a page;
it renders the page in Chromium at four fixed widths and two sampled ones, under reduced motion and
in print, and checks every computed value against the system's rules. It reports what the browser
drew, not what the stylesheet says.

Standards is open so the evidence about it can be checked. Every comparison it is quoted in can be
rerun from this repository: the gate beside axe-core and stylelint, the drift survey of public
design systems, and the model study and its judging rounds, with every record they were scored from.

## Start

```sh
npm install @appliedform/standards && npx playwright install chromium
npx standards init --pack instrument  # load a system: the free Standards pack, or your pack's tokens.json
npx standards lint page.html          # your page, judged by that system's rules, at every width
```

With no system loaded, `standards lint` judges a page by the rules that hold for any page (contrast, focus,
target size, overflow, alt text, heading order, motion) and says how to load one. For an agent,
`npx standards mcp-config` prints the server block for Claude Code or Cursor.

## Use

```sh
npx standards lint page.html https://example.com/page      # every rule, every width
npx standards lint https://example.com/ --register ii      # a page that has not declared a register
npx standards baseline https://example.com/a --out standards-baseline.json
npx standards lint https://example.com/a --baseline standards-baseline.json
npx standards fix page.html                                # apply the fixes it can make; writes page.fixed.html
npx standards audit pages/ --fix                           # every page in a folder, as found and as the fixer would leave it, as one report
npx standards drift https://example.com/ --out drift.json  # what system a site actually renders
npx standards rules                                        # every rule, its severity and what it checks
npx standards mcp                                          # the same tools for a model, over MCP
```

`standards fix` exits 0 when the fixed page passes every checked rule, 1 when violations remain, and lists
what it could not fix by rule and element. `standards audit` writes one self-contained HTML page (and `--json`)
with the findings by rule and by page, the WCAG criteria the rules touch, what is not checked, and
the command that repeats the run. `standards lint` exits 1 on any error-severity violation not
held in the baseline. `standards.config.json` sets a
rule to `error`, `warn` or `off`; `standards.config.example.json` is a starting point. The exception is a
mandatory rule: `contrast`, `text-too-small`, `target-size`, `focus-hidden`, `link-not-underlined`,
`alt-missing`, `horizontal-overflow` and `wordmark-live-text`, listed under
`$extensions["form.applied"].levels.mandatory` in the token file. A config that sets one of them to
`warn` or `off` is refused, and `standards lint` exits 2 (decision 0027 in the Applied Form repository).
A system loaded over the token file may raise the thresholds `contrast` and `text-too-small` read
(`floors.body-contrast`, `display-contrast`, `large-text-px`, `large-bold-text-px`, `text-min-px`)
and is refused if it lowers one below the token file's own value. A system that declares a pack
and states no `register.pack` is refused too: it judged every page by `register` alone and then
dropped that house rule, so no mandatory rule was measured. So is a system with a register whose
background is not a colour. Four gaps are known. On a page whose register the loaded
system does not define, with or without a system, a config that lowers `register` leaves the
mandatory rules unmeasured. A system
file that declares itself a pack is judged without `text-too-small`, `link-not-underlined` and
`wordmark-live-text`. On a page that paints no ground, `contrast` measures against the ground the
system names. The MCP tools `standards_lint` and `standards_fix` measure only the widths a caller names, so a
call without 320 never measures `horizontal-overflow` at 320px.

## Names that changed

The product was called the engine, and its command `af`, in 3.x. The old names still run in 4.x, each
says once on stderr that it is deprecated, and they are removed in Standards 5.0.0. Uninstall
`@appliedform/engine` before installing `@appliedform/standards`: both ship the `af` and `af-mcp`
bins, so a global install of one over the other fails with EEXIST.

| 3.x | Now | The old name |
|---|---|---|
| package `@appliedform/engine` | `@appliedform/standards` | Uninstall `@appliedform/engine` first |
| command `af` | `standards` | Runs the same command after one line on stderr |
| `af-mcp`, `af mcp` | `standards mcp` | Serve as before, listing the `af_*` tools |
| tools `af_lint` and the eight others | `standards_lint` and the eight others | Both names are accepted by every route |
| `af.config.json` | `standards.config.json` | Read, with one line; the new file wins if both exist |
| `af-baseline.json` | `standards-baseline.json` | Read and written at its own path, with one line |
| `.af/` | `.standards/` | A path to it in a config is a plain path and keeps working |
| `AF_BRAND`, `AF_CHROMIUM` | `STANDARDS_SYSTEM`, `STANDARDS_CHROMIUM` | Read on every use, with one line; both names of a pair set to different values exits 2 |
| `af-audit.html`, the default report file | `standards-audit.html` | None |
| the `engine` bin | none | None |

Documents recorded before the rename, such as the decision records and the evaluation protocol and
its results, use the old names, and are not rewritten.

## The token file

`tokens/applied-form.tokens.json` is the Reference system: Standards' structure (registers,
voices, spacing, floors and every rule's parameters) with a neutral palette derived by `standards brand`.
It exists so Standards can be tested and published. It is not a design to ship. Point it
at your own system by replacing the file, or by importing a Standards pack with `standards system import`.

## Evidence

| What | Where | Rerun |
|---|---|---|
| The gate beside axe-core and stylelint on planted defects | `eval/compare.mjs`, `test/compare.test.mjs` | `npm run eval:compare` |
| Drift across public design systems | `eval/drift/` | `npm run drift:batch -- all` |
| Models generating pages with and without the rules | `eval/`, `docs/evaluation-protocol.md` | `npm run eval -- --models stub` offline, then with keys |
| A judging round with anchors and attention checks | `eval/judge-run.mjs` | `npm run eval:judge` |

The protocol was written before the runs it governs, and it says what result would count against
Standards. These run from a clone of this repository: the npm package carries Standards and
nothing that needs a model SDK, axe-core or stylelint.

## Develop

```sh
npm install
npm run check    # build, unit tests, and the clean fixture linted in a real browser
```

Tests use `node:test`. Set `STANDARDS_CHROMIUM` to a Chromium executable if Playwright has not downloaded
one.

## Licence

Apache-2.0. See `LICENSE` and `NOTICE`. The name Applied Form and its marks are not licensed.
