# Applied Form engine

A design-system conformance gate measured in a real browser. Give it a DTCG token file and a page;
it renders the page in Chromium at four fixed widths and two sampled ones, under reduced motion and
in print, and checks every computed value against the system's rules. It reports what the browser
drew, not what the stylesheet says.

The engine is open so the evidence about it can be checked. Every comparison it is quoted in can be
rerun from this repository: the gate beside axe-core and stylelint, the drift survey of public
design systems, and the model study and its judging round.

## Install

```sh
npm install @appliedform/engine
npx playwright install chromium
```

## Use

```sh
npx af lint page.html https://example.com/page     # every rule, every width
npx af lint https://example.com/ --register ii     # a page that has not declared a register
npx af baseline https://example.com/a --out af-baseline.json
npx af lint https://example.com/a --baseline af-baseline.json
npx af drift https://example.com/ --out drift.json # what system a site actually renders
npx af rules                                        # every rule, its severity and what it checks
npx af-mcp                                          # the same tools for a model, over MCP
```

Exit status is 1 on any error-severity violation not held in the baseline. `af.config.json` sets a
rule to `error`, `warn` or `off`; `af.config.example.json` is a starting point.

## The token file

`tokens/applied-form.tokens.json` is the Reference system: the engine's structure (registers,
voices, spacing, floors and every rule's parameters) with a neutral palette derived by `af brand`.
It exists so the engine can be tested and published. It is not a design to ship. Point the engine
at your own system by replacing the file, or by importing a Standards pack with `af system import`.

## Evidence

| What | Where | Rerun |
|---|---|---|
| The gate beside axe-core and stylelint on planted defects | `eval/compare.mjs`, `test/compare.test.mjs` | `npm run eval:compare` |
| Drift across public design systems | `eval/drift/` | `npm run drift:batch -- all` |
| Models generating pages with and without the rules | `eval/`, `docs/evaluation-protocol.md` | `npm run eval -- --models stub` offline, then with keys |
| A judging round with anchors and attention checks | `eval/judge-run.mjs` | `npm run eval:judge` |

The protocol was written before the runs it governs, and it says what result would count against
the engine. These run from a clone of this repository: the npm package carries the engine and
nothing that needs a model SDK, axe-core or stylelint.

## Develop

```sh
npm install
npm run check    # build, unit tests, and the clean fixture linted in a real browser
```

Tests use `node:test`. Set `AF_CHROMIUM` to a Chromium executable if Playwright has not downloaded
one.

## Licence

Apache-2.0. See `LICENSE` and `NOTICE`. The name Applied Form and its marks are not licensed.
