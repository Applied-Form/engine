# Contributing

Issues and pull requests are welcome. Contributions are accepted under the Apache-2.0 licence that
covers the repository: by opening a pull request you agree your change is licensed under it.

## How this repository is made

This tree is exported from Applied Form's own repository, where the engine is developed beside the
design system it was built for. A pull request here is reviewed here. When it is accepted, a
maintainer carries the change into the source repository with you credited as a co-author, and it
arrives in this repository with the next export. A change merged only here would be overwritten by
that export, which is why it is carried across rather than merged directly.

## Before you open a pull request

```sh
npm install
npx playwright install chromium
npm run check
```

`npm run check` builds the CSS, runs the unit suite and lints the clean fixture in a real browser.
It must exit 0. CI runs the same command on every push and pull request.

Tests use `node:test` and nothing else. Do not add a dependency without saying why in the pull
request.

## Adding or changing a rule

1. If the rule needs a number or a colour, put it in the token file. A rule never names a colour, a
   typeface or a hex value; it reads the system it is given.
2. Add the check to a module under `src/lib/rules/`, with a stable id.
3. Register it in `src/lib/rules/registry.mjs` with a summary, a reason, a one-sentence fix and its
   WCAG criteria. An empty list is the honest answer for most rules.
4. Add a failing case and a passing case to `test/rules.test.mjs`.

## Changing the evaluation harness

The protocol in `docs/evaluation-protocol.md` was written before the runs it governs. A change to
`eval/` that would change what a run measures is a protocol amendment and has to be stated as one,
with its date, before any run that uses it.

## Reporting a security problem

Do not open an issue. See `SECURITY.md`.
