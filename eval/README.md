# The evaluation harness

Machinery for `docs/evaluation-protocol.md`. Read the protocol first: it says what is being tested
and why the design is shaped this way. This file says how to run it.

    eval/
      briefs.json      12 pilot briefs, held out from examples/
      split.mjs        which rules are disclosed to the arms, and which are scored
      arms.mjs         the eight conditions, the compiled core, and the repair prompt
      providers.mjs    generation, one function per provider, plus an offline stub
      score.mjs        held-out lint + axe-core + palette and spacing drift
      run.mjs          brief × arm × model × sample → JSONL
      analyse.mjs      pooled rates, cluster-bootstrap rate ratios, consistency
      fixtures/        the study brand: a palette no model has seen

## Run it

```sh
node eval/run.mjs --models stub --out eval/runs/dryrun.jsonl          # offline, free, no keys
node eval/run.mjs --models stub-flaky --out eval/runs/flaky.jsonl     # offline, with failure modes
node eval/run.mjs --models haiku-4-5 --briefs b01,b07 --samples 1     # a scoped shakedown, ~40c
node eval/run.mjs --models opus-5,sonnet-5,haiku-4-5 --samples 2 --out eval/runs/pilot.jsonl
node eval/analyse.mjs eval/runs/pilot.jsonl
```

Two named runs exist so nobody has to remember the flags. `npm run eval:shakedown` is the cheap first
run on Haiku; `npm run eval:pilot` is the full four-model pilot. Both write under `eval/results/`,
which is committed — the container is ephemeral, and the record of what was generated is the
evidence. `eval/runs/` stays git-ignored for scratch.

`--briefs` scopes a run to named briefs, `--arms` and `--models` to those; `--samples` sets repeats
per cell and `--repairs` caps arm F's loop. Runs are resumable: a cell already in the output file is
skipped, so an interrupted run continues rather than paying twice. `--concurrency` sets how many
cells run at once (default 4). `eval/runs/` is git-ignored — pages and JSONL are outputs. Pages are
named `<brief>-<arm>-<model>-s<sample>-r<round>.html`.

`node eval/tables.mjs <run.jsonl …>` sets runs side by side: every arm against the control, the
pre-registered pairs, the disclosed-rule rate the loop is shown, axe-core, palette drift, cost and
failures, each interval a seeded cluster bootstrap over briefs. The pilot's tables in
`docs/pilot-results.md` are its output over `eval/results/pilot-*.jsonl`.

## The two stub providers

`stub` always succeeds, and proves the plumbing. `stub-flaky` emits what real models actually do —
truncation at the token cap, markup that never closes, a refusal, an unwanted code fence — and
exists because a provider that always succeeds cannot show whether the failure accounting works.
Running it measured the bias rather than assuming it: **15 of 19 failed pages scored zero
violations**, a perfect score each, because a page too short to contain anything is too short to
break anything. Every one would have been counted as clean before that path existed.

## Routes

A *route* is who is paid and which protocol is spoken; a *model* is what answers. A model key is
either a name from the table in `providers.mjs` or `route:id`, where the id is whatever that route
calls the model:

| Route | Key it reads | Reaches |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) | Claude, direct, through the SDK |
| `foundry` | `ANTHROPIC_FOUNDRY_API_KEY` + `ANTHROPIC_FOUNDRY_RESOURCE` | Claude on Microsoft Foundry, billed through Azure: `foundry:claude-haiku-5-5` |
| `openai` | `OPENAI_API_KEY`, optionally `OPENAI_BASE_URL` | GPT, direct, or any OpenAI-compatible gateway |
| `openrouter` | `OPENROUTER_API_KEY` | Every family through one prepaid balance: `openrouter:anthropic/claude-sonnet-5` |
| `azure` | `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` | A deployment on an Azure OpenAI resource: `azure:<deployment-name>` |
| `google` | `GOOGLE_API_KEY` | Gemini, direct |

Every record carries `route` and `id` beside `model`, because a result nobody can tell the route of
is a result nobody can reproduce. The slugs an aggregator or a cloud deployment uses are theirs and
are not written into this repository; whoever holds the account supplies them on the command line.
No route uses a server-side refusal fallback: the model is the independent variable, and a refusal
is recorded as a failure. A run refuses to start if a requested model's route has no key, rather
than failing 300 calls in.

The table carries both the 5 / 4.5 generation the protocol named and the 5.5 generation beside it,
at one pinned effort per tier. `haiku-5-5` is the cheap weak tier the headline prediction needs.

## Running it where there is network

The cloud session that develops this repository cannot reach any model host. `.github/workflows/eval.yml`
can: dispatch it with a run name, the model keys and the scope, with the keys as repository
secrets, and it runs the study on a runner, commits the JSONL and the analysis under `eval/results/`
on the branch it was dispatched from, and keeps the generated pages as a 90-day artifact for the
judging round. `.github/workflows/drift.yml` does the same for `af drift` over the public design
systems listed in `drift/targets.json`, committing the surveys under `eval/drift/`.

## The judging round

`judge-run.mjs` is the part of H4 that was missing: it puts two screenshots in front of a judge
and writes the answer down. `judge.mjs` had already fixed everything else — the five pairs, the
one question, both orders, the floor anchor that can fail the round, interleaved attention checks,
exclusion, and the pre-registered reading of the correlation.

```sh
node eval/judge-run.mjs eval/runs/pilot/pilot.jsonl --judges haiku-5-5,openrouter:google/gemini-3-pro
node eval/judge-run.mjs eval/runs/dry/dry.jsonl --judges stub      # offline: proves the round's instruments
```

The floor anchor is each brief's strongest page with every `<style>`, stylesheet link and
`style=` attribute removed, so it is that brief's content and nothing else. There is no
human-designed page for these briefs, so the ceiling anchor is reported absent rather than faked.
An attention check is a truncated copy of a strongest page against the intact one. Screenshots
are one width, not full page, so a long page is not an advantage. An answer that is not `a`, `b`
or `tie` is kept with its text and excluded from the count, never coerced. A panel drawn entirely
from the generators' own family is refused, because the protocol forbids it. Model judges are a
screen; the human panel is the guard, and nothing here replaces it. The Evaluation workflow runs
the round when `judges` is given, and commits `<name>.judging.json` beside the analysis. To judge
a run that already exists, dispatch its name with `judges` and no `models`: the pages come back
from the run's artifact and nothing is generated, so a run stays judgeable after the harness that
produced it has changed.

## Beside instruments we did not write

`npm run eval:compare` runs `af lint`, axe-core and stylelint (with the config this repository
generates) on the same pages and prints the three side by side. `test/compare.test.mjs` holds the
shape of the result on the planted-defect fixtures. The first run of it found two things about the
static tier that nobody had seen because nobody had run it: the generated config flags every token
definition in `dist/tokens.css` as a literal, and it reads `calc()` over a token as a literal too.
Both are fixed in `scripts/build-stylelint.mjs`, and the comparison is why they were found.

## The three things that keep it honest

**The holdout.** Arms are shown the disclosed rules and scored on 10 they were never shown.
`hidden-interactive` joined the set when the research report's fourth attack was closed; it needs no
attribute of ours to fire and is named in no arm's context. `content-not-dom`, which closed the
canvas attack, is deliberately *not* in it: it sits in the disclosed imagery group, and a rule an arm
has been shown cannot measure whether the system generalises. `test/eval.test.mjs`
asserts that no arm's prompt names any scoreable rule, by id or by summary. If that test fails, the
study is void, not merely inaccurate.

**The repair loop is filtered.** Arm F is shown *disclosed* failures only — `disclosedOnly()` in
`run.mjs`. If the loop reported withheld violations, arm F would be optimising directly against the
metric it is scored on and the holdout would be gone. It is the most load-bearing line in the
harness.

**Opportunity, not counts.** Rates are per link, per image, per focusable target, per hundred
elements. A page cannot score well by containing nothing.

**Failures are counted before they are excluded.** `classifyFailure()` in `run.mjs` labels a page
the model refused, truncated, or left unclosed, in that order — a refusal is a sentence with no
markup, so a completeness test reaches it first and would file "the model declined" as "the model
produced garbage". Failure rate is printed beside every arm's violation rate; failed pages leave the
rates only after being counted, because a page that could not be produced is not a clean one.

## The study brand

`fixtures/meridian.tokens.json` is derived by `af brand --hue 148 --paper "#F2F6F3"` and merged over
the base tree. No colour in it is Applied Form's: the four values the derivation does not produce
(two status tints, two chart-scale steps) are derived from Meridian's own palette (protocol
amendment of 2026-10-08), and the open export refuses a tree that carries any base value. A model cannot
pattern-match a palette generated after its training cutoff, which is the only defence available
against the possibility that a model has read this repository.

## Two dependencies this adds

`axe-core`, because an instrument we wrote cannot be the only evidence that what we wrote works.
`@anthropic-ai/sdk`, because the harness has to call an API, and `@anthropic-ai/foundry-sdk`, so the
same calls can bill to Azure. `stylelint` and
`stylelint-declaration-strict-value`, because the static tier this repository generates had never
been executed against anything, and `eval/compare.mjs` is where it is. All are dev-only and none
is reachable from `src/`.

`test/harness.test.mjs` runs one cell of the study end to end on the stub, through a real browser.
It exists because the scorer was broken from 3.1.0 until 2026-10-08 — a re-export where an import
was needed — and the unit suite never noticed, because it imported the function and never called
`score()`. The documented dry run would have caught it on the first cell; the test is that dry run.
