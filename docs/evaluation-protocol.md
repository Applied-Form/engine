# Evaluation protocol

Written before any run, so the hypotheses cannot be fitted to the results afterwards. Nothing in
this document has been executed yet.

## The problem with the evidence we have

Every number in this repository was produced by measuring pages we wrote with a linter we wrote.
That establishes internal consistency and nothing else. It cannot distinguish "the system works"
from "the system agrees with itself". Three specific circularities have to be broken before any
result means anything:

1. **The instrument is ours.** Scoring our approach with our own linter guarantees we win.
2. **The pages are ours.** The seven reference pages were written against the rules; a fair test
   needs briefs neither the rules nor the pages anticipated.
3. **The palette may be memorised.** Applied Form's terracotta and Fraunces are in the training
   data of any model that has seen this repository or its ancestors.

## Hypotheses

**H1.** An executable design system produces measurably more conformant output than a prose style
guide containing the same rules.

**H2 (the one that matters).** Most of that gain comes from the *feedback loop*, not the written
rules. A model that can run the linter and repair will beat a model that has merely read the rules,
by a wide margin.

**H3.** The system reduces variance between independent generations of the same brief more than it
raises the mean quality of any single one. Consistency is what a design system actually sells.

**H4 (the guard, stated as a risk we expect to find).** Enforcement costs something. Linter-driven
output will be measurably less varied and may be judged less appealing than unconstrained output.
We predict this and want it measured, not hidden.

## Conditions

Six arms, identical briefs, identical model, temperature and token budget:

| Arm | Context given | Loop |
|---|---|---|
| A · none | Brief only | — |
| B · prose | Brief + the Field Guide as markdown | — |
| C · tokens | Brief + the DTCG token file | — |
| D · components | Brief + built `components.css` and its markup contract | — |
| E · rules-read | Brief + tokens + the full rule list as text (`af rules`) | — |
| F · rules-run | Brief + tokens + the linter, run after each draft | up to N repairs |

B is the honest incumbent: it is what nearly every design system actually is. E versus F isolates
H2 and is the reason the study is worth running — if E ≈ F, the linter is expensive theatre and the
rules alone were the whole contribution.

## Breaking the circularity

**Held-out rules.** The registry has 73 rules in 13 groups. Split by *group*, not by individual
rule, because rules within a group correlate and a random split leaks. Arms E and F are given the
rules in the disclosed groups only; the score is computed on rules they were never shown.

Building this cut the scoreable set from 23 rules to 9, twice, for reasons worth recording because
both would have inflated our result:

- **Attribute-gated rules cannot be scored across arms.** Ten withheld rules only fire on elements
  carrying the system's own attributes — `grid-off-column` needs a `[data-grid]` container, the
  composition rules need a declared spread or panel. An arm never told those attributes exist emits
  a page that is never *eligible* to break them and scores a perfect zero. Absence of opportunity is
  not compliance, and counting it as compliance flatters precisely the arm we expect to be worst.
- **A token file teaches some rules outright.** Arms C–F receive the tokens, which state the 8px
  spacing scale, the motion durations, the focus colour and the register link colours. Scoring
  `spacing` as held-out would measure whether a model can read a JSON array. Those four rules stay
  withheld from the arms but are excluded from the metric.

What survives is nine rules that apply to any HTML page and that nothing in any arm's context
states: `horizontal-overflow`, `aspect-ratio`, `focus-hidden`, `link-not-underlined`, `target-size`,
`alt-missing`, `shadow-present`, `gradient-fill`, `radius-present`. A smaller primary metric than we
started with, and the only one that can carry a claim. A test asserts that no arm's prompt names any
of the nine, so the holdout cannot rot silently as the rules change.

**Arm D is not like the others.** A component stylesheet demonstrates correct aspect ratios and
contains no shadows, gradients or rounded corners, so it conveys several scoreable rules by example.
That is what a component library *is*, not a flaw to be fixed. Arm D's result therefore answers
"what does a component library hand you" rather than "did the model generalise", and must be read
that way. This is asserted in a test rather than left as a footnote.

**Rates, not counts.** A violation count rewards a page for being empty: no links, no link
violations. The primary metric is the mean, over the nine rules, of each rule's pooled rate
(Σ violations / Σ opportunities across pages). Every rule weighs the same, so the three per-element
rules cannot swamp the per-link ones; a page offering no chance to break a rule is excluded from
that rule's mean rather than counted as passing it; and tiny pages are not over-weighted the way a
mean of per-page rates would be.

## Two attacks that succeeded, and what they changed

Before any paid run, the harness was attacked with pages built to game it. Both attacks landed.

**An unstyled page nearly wins.** Bare HTML with no CSS scored one violation out of nine rules —
default link underlines, no shadows, no radius, visible focus, all for free. The primary metric
cannot tell "well designed" from "not designed", and an arm that learned to do less would score
better. Two responses. A styling covariate (CSS declarations, distinct font families) is now
reported beside every arm's rate, so a low rate with near-zero styling reads as what it is. And the
real guard remains the blind preference judging under H4, which needs API access: until it runs,
**the primary metric alone must not be quoted as evidence of design quality**, only of conformance.

**A desktop-only score misses reflow.** Three fixed-width cards that overflow every phone passed
clean at 1280px. Pages are now scored at 320px and 1280px, with violations and opportunities summed
across both — an element present at two widths is two chances to break a rule.

The honest lesson is that both were found by trying to cheat the instrument rather than by reading
its code, and both would have inflated a result in our favour. The attack pages are not kept; the
tests that encode what they taught are.

**Independent instruments.** Metrics we did not write and cannot tune:
- `axe-core` violations (third-party accessibility engine).
- WCAG 2 contrast computed by an independent implementation, not `src/lib/rules/`.
- Raw CSS property entropy, computed from the stylesheet, not from our extractor.

**A brand the model has never seen.** Derive a fresh palette with `af brand --hue <random>` and
give arms C–F only that. Applied Form's own colours are excluded from the study. A model cannot
pattern-match a palette generated after its training cutoff.

**Novel briefs.** 30–40 briefs written without reference to `examples/`, stratified by register
(I brand / II product), by density, and by whether the brief requires a chart. Held in a file that
the generation prompt never sees in full — one brief per call.

## Amendments, 2026-09-04

Everything above was written before any run. This section is what changed afterwards and why, kept
separate so the original design can still be read as it stood.

### Four more attacks on the instrument, all of which landed

An external research report proposed four bypasses. Every one worked against the linter as it was,
and each is now a rule with a fixture built to use it (`test/fixtures/attacks.html`).

1. **Content painted rather than marked up.** A page drawing its interface onto a canvas broke no
   rule, because every rule reads rendered elements and there were none. It scored clean while
   being empty to any reader not using their eyes. Rule `content-not-dom`.
2. **Placement outside a declared grid.** The offset check required a `[data-grid]` ancestor, so an
   arm never told that attribute exists could place anything anywhere at hand-written pixel values
   and never be judged for it. This one mattered most to the study: it flattered exactly the arms
   that know least. Placement is now judged with or without a grid.
3. **Widths that were never measured.** Four named viewports are four numbers a page can be built
   to satisfy. The linter now samples two widths from between them, prints them with the seed, and
   moves them between runs. The first run found the attack succeeding in our own reference pages —
   prose at 84ch against a ceiling of 66, at a width nobody had measured.
4. **Hiding instead of describing.** `aria-hidden` on a focusable control satisfied the linter while
   leaving the control reachable by keyboard and unannounced; an SVG full of sentences passed as a
   figure with nothing to describe it. Rules `hidden-interactive` and a narrowed `alt-missing`.

Attack 4's rule joins the scored set: `hidden-interactive` needs no attribute of ours to fire and is
named in no arm's context. Attack 1's does not — `content-not-dom` sits in the disclosed imagery
group, and a rule an arm has been shown cannot measure whether the system generalises. The primary
metric is therefore ten rules rather than nine. Attack 2 changes the metric's meaning for the weakest arms and is the reason to
treat any pre-amendment number as void rather than merely old.

### Two arms added, and why the study needed them

**`rules-compiled`.** Arm E hands the model forty-six rules as text. The instruction-following
literature measures follow rate falling from about 96% at one instruction to between 20% and 60% at
twenty, non-linearly, and forty-six is well past that. A win for arm F over arm E would therefore be
partly a measurement of prompt length: the loop beating a context we had overloaded, rather than the
loop beating the rules. `rules-compiled` is the same rules compiled to a core of at most twenty
statements, clustered by category, with the floors stated at both ends because compliance is
measurably highest at the edges of a prompt. **F against this arm, not against E, is now the
comparison the study exists for.** If F still wins, the loop earns something no prompt buys at any
length. If it does not, the executable half was competing with a badly written one.

**`rules-run-primed`.** Arm F is told only what is wrong. A loop repairs toward what it is told
about, so a loop told only about violations optimises the page away from the brief — which is the
mechanism behind the literature's caution that iterative refinement can degrade design quality. This
arm restates the brief and the register's intent in every repair round. F against G measures that
directly instead of assuming it either way.

### The feedback itself is now a variable worth measuring

Every rule carries a `fix`: one sentence saying what to change, which the repair prompt appends to
each violation. The ablation the protocol already named — exit code, versus rule id, versus the full
message — gains a fourth level, message-with-fix, and it is the level the loop ships with. This is
the most directly actionable finding available, because we write those sentences.

### Two predictions added, at the same confidence as the rest

| # | Prediction | Confidence |
|---|---|---|
| P9 | Arm F's advantage over `rules-compiled` is smaller than its advantage over `rules-read`, because part of the latter is prompt length rather than the loop. | moderate |
| P10 | Arm G (primed) is not measurably more conformant than F, and is preferred by blind judges more often. Conformance and design quality come apart here, which is the point of measuring both. | deliberately uncertain |

P9 is the uncomfortable one and is recorded for the same reason P3 was: so the outcome cannot later
be framed as expected all along.

### What this means for anything already measured

Nothing had been run against a model when these amendments were made, so no result is invalidated.
Had there been one, attacks 2 and 3 alone would have voided it: both changed which pages count as
clean, and both changed it in the direction that had been flattering us.

## Amendment, 2026-10-06 — H4 operationalised

H4 has been specified since the first draft: blind pairwise preference, judges from more than one
model family, validated against a human-labelled subset, inter-rater agreement reported, and a
standing ban on a judge from the generator's own family being the only judge. What it did not have
was any of the decisions that make a round reproducible rather than improvised. Those are now fixed
in `eval/judge.mjs`, in code, before any judgement exists — which is the only time they can be
fixed honestly.

**Why this is not a nice-to-have.** The primary metric is *proven* not to track quality: an
unstyled page scored one violation out of nine rules, better than most designed pages. So a
successful result on conformance establishes only that the gate enforces its own rules. Everything
commercial rests on the next question, and until this runs the answer is a shrug.

### The floor anchor, which can fail the whole round

Every round smuggles in two pages whose standing is already known. The **floor anchor** is an
unstyled page — high conformance, and nothing anyone would ship. The **ceiling anchor** is a page a
person designed. Both are judged against the strongest arm present.

The floor anchor must lose. If it does not, the panel is not judging design, and no arm comparison
from that round means anything: `summarise()` returns `valid: false` and the round is rerun rather
than reported. This is the same move as attacking our own linter — give the instrument a question
whose answer is already known, and find out whether it can answer it.

### Decisions now fixed

| | |
|---|---|
| **Pairs** | Five, pre-registered in `PAIRS`, each naming the hypothesis it serves. Not all 28 combinations: a judge asked twenty-eight questions answers none of them well |
| **Within-brief only** | A page is never compared with one for a different brief. Across briefs the content differs, so a judge rates subject matter as much as execution |
| **Both orders** | Every pair is shown left-right and right-left, so a judge who favours one side cancels out instead of becoming a result |
| **One question** | "Which would you be more comfortable publishing under your own organisation's name?" — the deployability question, which is the commercial claim. Ties allowed, because forcing a choice a judge cannot make manufactures data |
| **Attention checks** | A page truncated mid-tag, interleaved at a fixed rate rather than blocked at the end. A judge preferring it is excluded at below 0.8, and every exclusion is reported: a round that threw out half its panel is a round to rerun |
| **Reproducible** | The item set is deterministic from its seed, so it can be published before the judging and checked after |

### The correlation, with its sign pre-registered

The output that matters is the rank correlation between each arm's conformance rate and its
preference share. Three outcomes, all publishable, written down now:

- **Positive** — conformance tracks preference, and the rate is a usable proxy for quality.
- **Flat** — the gate enforces conformance and nothing more. That is the honest ceiling on every
  claim made from the primary metric, and it is a finding, not a failure to find one.
- **Negative** — the system makes pages worse. This is the outcome to publish *first*, and it is
  the one nobody commits to in advance.

At eight arms the interval around any such correlation is far too wide to reject anything, so it is
reported as descriptive with its caveat attached and never as a test. The decision-relevant outputs
of a pilot round are the floor-anchor check and the sign.

### What preference still cannot settle

It is not fitness for purpose. A panel of strangers is not the client's brand steward. And a
verdict on one page says nothing about consistency across fifty, which is what a design system
actually sells — that is H3, measured separately, and no preference result substitutes for it.

Judging needs humans or model access and has not run. Item construction, exclusion and analysis are
implemented and tested against inputs whose answers are known by construction, including the case
where the floor anchor wins and the round is invalidated.

### Amendment, 2026-10-08 — the round can be run

`eval/judge-run.mjs` runs a round with model judges over a study's pages. Four decisions it adds,
fixed before any judgement exists: the floor anchor is each brief's own strongest page with its
styling stripped, so the within-brief rule holds for anchors too; the ceiling anchor is reported
absent, because no human-designed page exists for these briefs and one will not be faked; an
attention check is a truncated strongest page against the intact one; and an answer that is not
one of the three permitted words is recorded and excluded, never read as a vote. A panel in which
every judge shares a family with every generator is refused, which operationalises the standing
ban above. Screenshots are taken once per page at one width, not full page, so a long page is not
an advantage, and the width is recorded. The stub judge prefers the larger screenshot — wrong in a
known way — and the test asserts that such a judge loses the floor anchor and passes the check, so
the round's own instruments are exercised without a model. Model judges remain a screen.

### Amendment, 2026-10-08 — the study brand carried four of Applied Form's values

The held-out system was the base tree with Meridian's derived colours merged over it, and four
values the derivation does not produce fell through from the base: the two light status tints and
the two literal middle steps of the sequential chart scale. A model handed the tokens arm saw them,
so the claim that none of Applied Form's palette appears in the study was false, and the chart
scale ran from Meridian's sand to Meridian's terra deep through two of Applied Form's colours.
Found while preparing the open export, which refuses to publish base values. All four are now
derived from Meridian's own palette: the tints mixed toward white until they clear 4.6:1 on its
espresso, the scale steps the midpoints of its own sand, clay and terra deep. Nothing had been run
against a model, so no result is invalidated, and the system a run uses is the one every run will
use.

### Amendment, 2026-10-08 — what the first real run found in the harness

The first run against a model (`eval/results/shakedown-test.*`: one brief, eight arms, Haiku 5.5,
one sample) did what a shakedown is for. It found three defects in the harness, none visible to
the stub:

- **The gate measured the wrong system.** The linter reads its system from `AF_BRAND` at import
  time and the run never set it, so every page was linted against Applied Form's own tokens while
  the model held Meridian's. The held-out primary metric is unaffected, because its rules apply to
  any page and name no colour. But the repair loop's feedback on disclosed rules told a model
  holding one palette to use another, and the components arm was handed CSS built from Applied
  Form's tokens. `run.mjs` now re-launches itself under the study system and builds that system's
  CSS before any arm reads it.
- **Cost was not recorded.** The scorer returned a field named `usage` that overwrote the model's
  token usage in every record. It is now `computed`, and the record keeps the model's usage.
- **Palette drift was never computed.** The study palette was read only from the string form of a
  colour, and the 2025.10 file writes objects, so the palette was empty and drift was null.

The shakedown's numbers are therefore a record of the defects, not a result: arms E to G were
steered toward the wrong palette, and arm D was shown it. No pilot had run. `test/harness.test.mjs`
now drives one stub cell through the real entry point and asserts the system, the cost and the
drift, so the next defect of this kind fails a test rather than a run.

### Amendment, 2026-10-08 — cells run concurrently, and four things that assumed they did not

Sequential, one model's pilot took about four hours, past what a hosted runner allows, so cells now
run a few at a time. That changes how long a run takes and nothing it measures, once four
things that assumed it ran in order were fixed, all found in review before any pilot ran:

- **Judging pairs within a sample.** The round grouped pages by brief and model and kept one row
  per arm, the last one read. In sequence that was always the highest sample; run concurrently, it
  was whichever finished last. A group is now one sample of one brief from one model, and sample
  *s* of one arm is judged against sample *s* of the other, so every sample is judged and the item
  set does not depend on which call returned first.
- **A busy provider is not a failed model.** A 429 or a 5xx was recorded as a failed cell, and a
  resumed run never retries a recorded cell, so the run's concurrency could have entered a model's
  failure rate. The REST routes now wait and retry up to four times (honouring `Retry-After`), and
  the Claude clients retry four times rather than the SDK's default two. A refusal, truncation or a
  page that does not close is unchanged: those are the model's answer.
- **The interval does not depend on arrival order.** The bootstrap drew briefs by position in the
  order they were first seen, so the same seed named different briefs when records arrived in a
  different order. The briefs are now sorted before drawing.
- **One arm, one treatment.** Each record now carries its repair cap, its feedback richness and a
  fingerprint of the code and data tree (`eval/`, `src/`, `scripts/`, `tokens/` and the package
  files, less what a run writes and what only describes it), and the cell set it was asked for. A
  resumed run that differs in any of them is refused rather than appending a second experiment
  under the same arm's name; only concurrency may change. This is the staging rule above, applied
  to a resume. A judging round is held to the same: its answers carry the panel, the same tree
  fingerprint, the judges' endpoints, the seed and the viewport, and a resume under any other is
  refused. The workflow commits results from a worktree of their own, so the checkout a round runs
  in is never pulled into mid-run.

### Amendment, 2026-10-10 — an attention check the judge cannot see is not a check

Written after the first model-judged rounds, and said so: this change follows results. The first
rounds over the four pilots (panel `azure:gpt-5-mini,sonnet-5-5`) excluded gpt-5-mini from the
Haiku round and both judges from the Opus round, which made it invalid, all on the attention
check. No judge preferred a truncated page in any round; every failure was a tie. The check cut
each page at six tenths of its HTML, and a judge sees one 1280 by 1600 screenshot from the top, so
on a long page the cut fell below what was shown. Two of the six Opus checks gave the judge two
byte-identical images, and every tie the Sonnet judge gave in that round was on one of them. "Tie"
was the attentive answer, and the check scored it as inattention.

The check is now cut where it can be seen: six tenths where that ends inside the screenshot, and
otherwise a tenth less at a time until it does (`visibleCut` in `eval/judge-run.mjs`). On the Opus
pages that gives cuts of 0.4 to 0.6 and no identical pair. Nothing else moves: the exclusion floor
stays 0.8, the pairs, question, anchors and panel are as registered. Because the fix changes the
instrument, all four rounds are judged again under it, not only the invalid one; re-judging only
the round that failed would select on the result. The first rounds stay in `eval/results/` as
`*.judging-v1-cb1fb2ad.*`, and the earlier partial ones as `*.judging-partial-3c563c7e.*`.

### Amendment, 2026-10-10 — the full study's thirty-six briefs

Recorded before any page for the new briefs exists. The pilot's twelve briefs covered seven of the
twelve strata the design names (register, density, chart): no dense or charted sparse brief in
register I, no sparse brief in register II. Twenty-four briefs, `b13` to `b36` in
`eval/briefs.json`, fill every stratum to three, for thirty-six, inside the 30–40 above. They were
written the way the first twelve were, without reference to `examples/`, and none was run, shown
to a judge or revised after any generation. `test/eval.test.mjs` holds the design: thirty-six ids,
three per stratum, and a chart flag that matches what the brief asks for.

Why thirty-six and not forty. The pilot's intervals are a bootstrap over briefs, so the brief count
sets their width. Synthetic studies drawn from the pilot's own records put the half-width of the
loop against reading the rules, on Haiku, at 0.39 on the log scale with twelve briefs, 0.22 with
thirty-six and 0.18 with forty-eight; pooled across models, 0.08, 0.05 and 0.04. Thirty-six takes
most of what more briefs can give and divides evenly into the strata; forty-eight would cost a
third more in pages for a tenth narrower intervals. The estimate reuses the pilot's briefs, so it assumes new briefs vary as much as
those did; that is its limit.

The pilot's twelve stay in the set. The full study generates every brief afresh, under new run
names, and is not pooled with the pilot.

### Amendment, 2026-10-11 — the engine's first measurement, registered before it runs

The engine (spec `docs/superpowers/specs/2026-10-11-guaranteed-design-engine-design.md`) is measured
with two opt-in arms on the frozen thirty-six briefs, two samples, against each model's rules-read
records from the full study. `pipeline` is the product: it may fix any rule the fixer knows and shows
the model every violation. `pipeline-blind` may fix only rules outside the held-out set and shows the
model only disclosed violations, so the held-out rate stays a measure of generalisation. Bars:
`pipeline` passes every checked rule on at least 99% of pages, failed generations counted as failures;
its cost per page is at most 1.5 times rules-read on the same model and route; `pipeline-blind`'s
held-out rate is reported against rules-read with a brief-cluster interval and is not expected to
move in this phase (it changes how a page is finished, not what the model knows). Claude models run on
the `anthropic` route and GPT models on `azure`, the routes of the records they are compared with.

### Amendment, 2026-10-12 — what changed in the engine, registered before it is measured again

Five changes land together. Under the staging rule above, each one discards rather than pools the
earlier pipeline records, so they are measured in one run rather than four, and the phase-1 figures
they supersede are withdrawn rather than compared against.

1. **The blind holdout is derived by group.** `BLIND_FIXABLE` and `blindJudge` come from
   `split().withheld`, not from the ten scored rules. Excluding only the scored rules left
   `focus-restyled` fixable; it shares an element with `focus-hidden` whenever a focus style is
   declared `outline: none`, and fixing the first cured the second. The held-out figures that
   produced — 0.60 on GPT-5 and 0.84 on GPT-5-mini — are **withdrawn, not restated**. A rule that is
   disclosed but whose fix moves a scored rule is excluded by name (`BLIND_EXCLUDED`).
2. **The fixer gains `measure`**, applied to the block that set the line length and skipped where a
   width cap would change layout instead. Disclosed, and excluded from the blind arm by (1).
3. **The repair returns an edit list**, keyed by the element id the checker stamped, and restates
   the brief. A repair needing different markup returns the page instead.
4. **The pipeline arms are told the markup contract** — only attributes gating disclosed rules — and
   `data-figure="plot"` is honoured only on an SVG that draws geometry. This is a **product change**:
   it alters what the engine's arms are given, so the previous pipeline records are not comparable,
   on the same footing as the 1280px gate defect. The study arms are byte-identical and unaffected.
5. **The cost instrument is corrected.** GPT models had no price, so published ratios were token
   counts; 2.36× and 2.13× are withdrawn and replaced by 2.09× and 1.85× on the same records.

**What is predicted, with a magnitude bound.** The cost bar is the one in reach: `pipeline` on GPT-5
is expected at or below **1.5×** rules-read, from 1.85×. The pass rate is expected to rise but
**not to meet the 99% bar**, which at 72 pages per model asks for 72 of 72; the ceiling analysis
(`eval/ceiling.mjs`) shows that needs 15 rules on GPT-5 and 16 on GPT-5-mini solved perfectly. The
held-out rate of `pipeline-blind` is predicted **not to move by more than 0.10 in either direction**
from 1.00; a move beyond that is a finding to investigate, not a result to report, because nothing
in these five changes should teach a model anything.

**Two integrity checks reported with the run, not after it.** A *declaration audit*: every
`data-figure` the checker did not corroborate is counted, and the pass rate is published with and
without pages that lean on one — disclosing a contract must not become a way past the gate. A
*fallback audit*: the share of repairs that returned a page rather than an edit list is published
beside the cost ratio, so a cost saving cannot be claimed from a path that was rarely taken.

**Not changed, and still missed:** the 99% pass bar and the 1.5× cost bar stand exactly as
registered on 2026-10-11. Whether to register a reachable pass bar is a separate decision, to be
taken before a later run and never after seeing one.

### Amendment, 2026-10-12 (second) — one change, registered before it is measured

The `engine3` run met one of three registered predictions. The held-out premise held on both models;
the cost bar was missed but improved; the pass rate **fell** (38.9% → 11.1% on GPT-5, 16.7% → 9.7%
on GPT-5-mini) rather than rising. The cause was identified in the committed records: the edit-list
repair applied the model's edits without the rollback discipline the deterministic fixer applies to
its own, and 64 of the 72 `horizontal-overflow` failures fell on pages it had repaired.

**The single change.** A model patch is rejected outright if it worsens any judged rule, recorded as
`repairKind: 'patch-rejected'`. For the `pipeline` arm the judge is every rule, so each rule that
regressed is inside the test. Nothing else changes. Under the staging rule this discards rather than
pools the `engine3` pipeline records; the `engine3` figures it supersedes are withdrawn, not
compared against, and remain published as the record of a defect found and fixed.

**What is predicted, with a magnitude bound.** Registered before the run, and deliberately bounded
on both sides so that an over-recovery is as falsifying as an under-recovery:

1. **The pass rate recovers but does not exceed `engine2`.** Predicted **above 20% on GPT-5 and
   above 14% on GPT-5-mini**, and **at or below 38.9% and 16.7%** respectively. The gate is
   otherwise unchanged, so a figure above the `engine2` pass rate would mean the fix is doing
   something beyond rejecting bad patches, and is a finding to investigate rather than a result.
2. **Cost rises slightly and still misses 1.5×.** A rejected patch wastes the tokens that bought it,
   so the ratio should move **up, by no more than 0.15×**, from 1.80× and 1.67×.
3. **The held-out rate does not move more than 0.10 from 1.00**, as before. This change touches only
   the repair path and must teach a model nothing. A move beyond the bound invalidates the run.
4. **`horizontal-overflow`, `ground-off-palette`, `ground-in-ii` and `contrast` each fall**, and
   Register II's pass rate rises above its 1.4% collapse. If the Register II collapse does *not*
   recover, the cause is not patch damage and the stratum needs its own investigation.

**Reported with the run:** the same declaration and fallback audits, plus the **rejection rate** —
of the repairs that computed a patch, the share the guard discarded (`rejected / (applied +
rejected)`), published beside the four repair-path counts. A rejection rate near zero would mean the
guard never fired and the pass-rate movement has another cause; near one would mean the edit-list
repair is worthless and should be removed rather than guarded. `eval/pipeline-report.mjs` prints
these, so the figure cannot be assembled by hand after seeing the pass rate.

**Cost and authority.** Two models, both arms, 36 briefs, 2 samples: ~$32 of Azure credits at list
price, on the `azure:` route. Credit-funded, not paid Anthropic API, and so inside the standing
authorisation. The `anthropic` route remains barred until explicitly approved.

**Not changed, and still missed:** the 99% pass bar and the 1.5× cost bar stand exactly as
registered on 2026-10-11.

### Amendment, 2026-10-12 (third) — repair routing, registered before it is measured

`engine4` falsified its own prediction and, in doing so, refuted the attribution that produced it.
The patch guard fired on 14.9% and 20.3% of computed patches and `horizontal-overflow` did not move.
The earlier claim that patches *damaged* pages was base-rate confounded: 81% of pages were
patch-repaired, so most failures of any kind landed on one, and six `engine4` overflow failures fell
on pages whose patch was rejected and which therefore shipped pre-patch markup.

**The mechanism, from the arm comparison across three runs.** `horizontal-overflow` is not in
`FIXABLE` and the blind arm is never told about it, so the blind arm is the control for "nothing
addresses this rule". Pipeline against blind: `engine2` 5/72 vs 30/72 (GPT-5) and 20/72 vs 55/72
(mini); `engine3` 23 vs 26 and 49 vs 49; `engine4` 20 vs 30 and 48 vs 53. Whole-page repair cured
overflow; the edit list does not. The patches do not break it, they fail to fix it.

**The single change.** The repair routes by remedy. When any remaining failure needs markup or
layout rather than a declaration on an element that already exists — `PAGE_ONLY`:
`horizontal-overflow`, `print-overflow`, `content-not-dom`, `decorative-imagery`,
`figure-hand-drawn`, `mark-not-svg`, `recipe-mismatch` — the model is asked for the complete page
and the edit list is not offered. Nothing else changes. Under the staging rule this discards rather
than pools the `engine4` records.

**What is predicted, bounded on both sides.** Registered before the run. Two consecutive rounds have
now falsified a confident mechanism, so these are deliberately falsifiable rather than safe:

1. **The pipeline-vs-blind overflow gap reopens.** It is the direct test of the mechanism. Predicted
   at least **half of `engine2`'s gap**: at least 13 pages on GPT-5 (`engine2` 25) and at least 18
   on GPT-5-mini (`engine2` 35). A gap that stays near `engine4`'s 10 and 5 falsifies the
   explanation above, and the overflow failures are then not about the repair path at all.
2. **The pass rate rises into 20–35% on GPT-5 and 11–22% on GPT-5-mini**, from 15.3% and 8.3%.
   Below the floor means the routing did not pay; above the ceiling means something other than
   overflow moved and the result needs investigating before it is reported as a win.
3. **Cost rises, and still misses 1.5×.** The routing deliberately spends back the edit list's
   saving. Predicted **above** 1.74× and 1.64× and **no more than 0.40× above** them. A cost that
   falls would mean the routing is not firing.
4. **The held-out rate stays within 0.10 of 1.00**, as in all three prior rounds. This change
   touches only which prompt the repair sends and must teach a model nothing.
5. **The whole-page share of repairs rises** above `engine4`'s 20/72 and 11/72 — the mechanical
   check that the routing fired at all, reported beside the rejection rate.

**Register II is excluded from these predictions.** It did not recover under `engine4` and was
registered then as needing its own investigation; `ground-off-palette` and `ground-in-ii` are not in
`PAGE_ONLY` and nothing here targets them. If Register II moves, that is an unexplained result, not
a success.

**Cost and authority.** Two models, both arms, 36 briefs, 2 samples: ~$31 of Azure credits at list
price on the `azure:` route, bringing this phase's evaluation spend to ~$94. Credit-funded, inside
the standing authorisation; the paid `anthropic` route remains barred.

### Amendment, 2026-10-12 (fourth) — a scorer defect, corrected; all pipeline figures superseded

This one is not an engine change. **The scorer was wrong**, and it was wrong in the direction that
made the engine look worse than it is.

CSS propagates `<body>`'s background to the canvas when the element above it declares none, so
`body{background:X}` paints the same pixels as `html,body{background:X}`. The extractor read the
background off the register root only (`src/lib/page-spec.mjs`), saw `transparent`, and so the
exclusion "a ground is a wide surface *other than* the register's background" could never match.
`<body>` was then reported as a full-bleed ground of an unexpected colour. Pages were failing for
their selector list rather than their design, and in Register II, where any ground is forbidden,
failing outright.

**Measured on the committed `engine4` pages**, re-linted at the scoring widths under the study
system, with the corrected extractor:

| | recorded | corrected |
|---|---|---|
| `ground-off-palette` (pooled pages) | 28 | **5** |
| `ground-in-ii` (pooled pages) | 28 | **3** |
| GPT-5 pass rate | 15.3% | **34.7%** |
| GPT-5-mini pass rate | 8.3% | **9.7%** |
| Register II pass rate | 2.8% | **9.7%** |
| Register II **with a chart** | 0 of 36 | **0 of 36** |

So 48 of 56 ground failures were the instrument, not the models. The Register II "collapse"
registered on 2026-10-12 as needing its own investigation is **substantially explained by this** and
is withdrawn as a finding about Register II. The 0-of-36 chart hole survives the correction
unchanged and remains real; it is `decorative-imagery`, which fires only in Register II.

**Consequences, stated rather than buried.** This changes the scorer, so under the staging rule it
discards rather than pools every earlier pipeline record. All pass rates published for `engine2`,
`engine3`, `engine4` and `engine5` are superseded and were **understated**. Because the defect is
long-standing and affected every arm and run identically in kind, *relative* comparisons between
runs remain usable, and the held-out ratio — which divides one arm by another on the same scorer —
is unaffected in expectation. Absolute pass rates are not usable and are reported as superseded.

**No prediction is registered here**, because this is a correction to the instrument rather than a
change to the thing measured, and a prediction about a number I have already computed from committed
records would be hindsight dressed as registration. The next engine change registers its own, and
its baseline is the corrected scorer.

**A standing check this implies.** The defect existed because no test asserted that two spellings of
the same paint get the same verdict. `test/root-background.test.mjs` now does, including that a
genuine off-palette full-bleed ground is still caught, so the rule is corrected rather than
disabled.

### Amendment, 2026-10-12 (fifth) — the correction's own figures, a second ground defect, and the scoring environment

Again not an engine change. Three faults in how the fourth amendment's correction was measured and
in what it corrected, each found by investigating a registered lead rather than by inspecting a
result.

**1. The re-scoring tool scored one width.** `lintPages` returns one result per viewport;
`eval/rescore.mjs` kept the first, so it judged every page at 320px alone while printing "at 320 and
1280px". The gate counts a violation at either width. The fourth amendment's table was produced with
it: its 34.7% (GPT-5) and 9.7% (Register II) were 320-only and are **withdrawn**. Fixed in `7728a87`
with a test that a violation raised only at 1280px is counted.

**2. The ground rule had a second defect.** A ground was any surface at least 90% of the viewport
wide. At 320px that is 288px — a card inside the ordinary 16px margin — so the same card was a card at
1280px and a full-bleed ground at 320px. Translucent paint was judged by its raw colour, so a 10% tint
of a declared ground passed as that ground. A ground must now reach both viewport edges (within 1px)
and is judged composited over the nearest opaque surface beneath it
(`test/full-bleed-ground.test.mjs`, RED on the previous extractor at both assertions). All 17 `engine5`
pipeline pages still failing a ground rule after the fourth correction were inspected element by
element: every one was an inset card, button or callout; none was a real ground. The ground rules
are in the disclosed `colour` group, so the held-out metric cannot move; `gradient-fill`, which is
scored, keeps its own width test and is untouched.

**3. Re-scoring is environment-dependent.** The runs were scored on the Ubuntu runner; every re-score
so far ran on a Mac. The pages load no web fonts, so fallback fonts set the text metrics, and on rules
neither correction touches, local scoring adds failures on 11–13 of 72 pages per run that the runner
never recorded — never the reverse. Until the saved pages are re-scored on the runner, two corrected
figures are reported: **local** (both widths, Mac; pessimistic) and a **runner estimate** (the
runner's recorded verdicts with the colour-only ground rules replaced by the corrected scorer's).

| scored arm, both corrections | local (Mac) | runner estimate | **re-scored on the runner** |
|---|---|---|---|
| `engine4` GPT-5 | 25.0% (18/72) | 33.3% (24/72) | **33.3% (24/72)** |
| `engine4` GPT-5-mini | 9.7% (7/72) | 15.3% (11/72) | **13.9% (10/72)** |
| `engine5` GPT-5 | 27.8% (20/72) | 30.6% (22/72) | **30.6% (22/72)** |
| `engine5` GPT-5-mini | 16.7% (12/72) | 22.2% (16/72) | **20.8% (15/72)** |
| `engine5` Register II with a chart, pooled | 1 of 36 | 1 of 36 | **1 of 36** |

**Resolved the same day.** The saved pages were re-scored on the runner (`eval.yml`, `rescore` input,
run 38239718434 at `fc6b550`). There they agree with the runner's recorded verdicts on every rule
neither correction touched on 285 of 288 pages, which confirms the environment as the cause of the
Mac discrepancy. The runner column is the corrected figure; the other two are withdrawn.

**What this withdraws.** The fourth amendment's figures, and the results document's statements that
GPT-5 fell under the repair routing and, later, that it rose. On the runner GPT-5 went 33.3% → 30.6%
and mini 13.9% → 20.8%; neither is distinguishable from noise at 72 pages (Fisher p = 0.86, 0.38).
**Standing rule from here: re-score only on the runner.**

**No prediction is registered here**, for the fourth amendment's reason: these are corrections to the
instrument, computed from committed pages.

**Noted, not registered.** The diagnosis that found defect 2 also found that `decorative-imagery` is
mostly a mismatch between the contract wording ("`data-figure` on a figure", read by both models as
the HTML `<figure>`) and the extractor (which reads the `<svg>`), and that the registered declaration
audit reads only `svg[data-figure]` and so was vacuous for GPT-5. A retroactive inheritance fix was
verified to gain GPT-5 three pages and cost mini three, so it is **not** adopted as a correction. The
contract wording is a product change and will be registered, with a prediction, before the run that
measures it.

### Amendment, 2026-10-12 (sixth) — engine6: three changes, each aimed at one rule, registered before it is measured

The diagnosis of 2026-10-12 found, for each of the three largest remaining blockers, a cause that is
not a model limitation, and a change that addresses it. They act on different rules through
different mechanisms, so they are registered together with **one prediction per rule** — the
`engine3` lesson was not "never change two things" but "never attribute a pooled number to one of
them". Each prediction below can fail on its own.

**Two instrument changes ship with them**, both corrections rather than engine changes:
`horizontal-overflow` is measured with root clipping lifted (`html,body{overflow-x:hidden}` hid up
to 488px at 320 on eight `engine5` pages; 0 of 143 measured rules-read baseline pages and no blind
page clip this way, so the held-out ratio is not moved by it), and an `aria-labelledby` that resolves
to text counts as a figure svg's name for `alt-missing`. **The baseline for every prediction is
`engine5` re-scored on the runner with this scorer** (run 38243130827): GPT-5 22/72 (30.6%),
GPT-5-mini 14/72 (19.4%); overflow 9 and 31 (blind 25 and 56); `decorative-imagery` 19 and 24;
`contrast` 13 and 17; `figure-hand-drawn` 0 and 5.

**The changes.**
1. **The markup contract says where `data-figure` goes** — on the `<svg>` itself, not a wrapping
   `<figure>` — and that `data-generated` names its generator. Both models read "on a figure" as the
   HTML element; the extractor reads the drawing.
2. **The fixer has a fallback colour for `contrast`** when the brand's fallback lists have none: the
   register's text colour, else its on-accent colour, the first that passes on the element's measured
   ground at every scored width; `fill` for SVG text; `opacity:1` on translucent text. Register II
   links and text whose measured ground is doubtful are left alone. It writes only `color`, `fill`
   and `opacity`.
3. **The overflow violation names what sticks out** — up to three boxes, with width, right edge and
   a text sample. Only the pipeline arm sees this rule's message.

**What is predicted, bounded on both sides.** Registered before the run, against the baseline above.

1. **`decorative-imagery` falls to at most 6 pages on GPT-5 and at most 14 on GPT-5-mini** (from 19
   and 24). Mini's floor is higher because 11 of its offending figures on 8 pages are genuinely
   undeclared logos and icons, which no wording fixes. Above the bound means the models did not move
   the attribute, and the declaration audit will say which.
2. **`figure-hand-drawn` does not rise above 3 on GPT-5 or 8 on GPT-5-mini** — the guard against
   the contract trading one imagery failure for another, as retroactive inheritance did (0 → 15).
3. **`contrast` falls to at most 7 on GPT-5 and 10 on GPT-5-mini** (from 13 and 17).
4. **`horizontal-overflow` on GPT-5-mini falls to at most 24** (from 31), and the pipeline-vs-blind
   gap widens. GPT-5 stays at or below 12. A mini figure near 31 means naming the element does not
   help, and the remedy is a fixer or nothing.
5. **The pass rate rises into 38–60% on GPT-5 and 24–45% on GPT-5-mini** (from 30.6% and 19.4%).
   Below the floor means the per-rule gains did not convert, again, because pages fail several rules.
   Above the ceiling means something unpredicted moved, investigated before it is reported.
6. **Cost does not rise by more than 0.15×** over `engine5` (1.95× and 1.98×); fewer
   `decorative-imagery` failures route fewer repairs to a whole page, so it is expected to fall.
7. **The held-out rate stays within 0.10 of 1.00.** The blind arm receives the same contract, and
   the contrast fallback is blind-fixable (disclosed `colour` group) but writes nothing a scored rule
   reads.
8. **Mechanical checks, reported beside the results:** at least 80% of `data-figure` declarations
   sit on an `<svg>` (the contract took), and the in-repo declaration audit finds no more than 2
   uncorroborated plot declarations per model.

**The pass bar is not re-registered here.** The 99% bar stands as registered and will be reported
missed; whether to replace it with a reachable one is a separate decision, taken before a run and
not after one.

**Cost and authority.** Two models, both pipeline arms, 36 briefs, 2 samples, 1 repair: ~$31 of
Azure credits at list price, bringing this phase to ~$125. Credit-funded, inside the standing
authorisation; the paid `anthropic` route remains barred.

### Amendment, 2026-10-12 (seventh) — the bars, re-registered as two tiers, from `engine7`

**Registered while `engine6` is running and before any of its results have been read**, so that the
bars cannot be fitted to it. They apply from `engine7`. `engine6` is judged by the bars and
predictions it was registered with (sixth amendment); it may be shown against these as exploratory.

**Why the 99% page bar is replaced.** It required every page to pass all ~20 applicable rules, so it
measured the weakest rule rather than the engine; `engine5` showed that removing most of the largest
blocker moved the clean rate by about two points, because failing pages fail several rules. It was
also undemonstrable at this sample size: 72 of 72 clean bounds the failure rate below 4.2% (95%,
rule of three), 144 of 144 below 2.1%; a 99% claim needs about 300 consecutive clean pages. And it
is not the promise a product can make. "This page conforms" is a probability; "the engine never
ships a rounded corner" is a guarantee.

**Tier 1 — guaranteed rules.** The rules whose remedy in `src/lib/fix/plan.mjs` is
**unconditional**: whenever the rule fires on a located element, a fix is planned, and the final fix
pass runs after the model's last repair. Thirteen rules: `radius-present`, `shadow-present`,
`link-not-underlined`, `target-size`, `focus-hidden`, `focus-restyled`, `text-too-small`,
`body-too-small`, `accent-non-interactive-ii`, `aspect-ratio`, `font-off-system`, `data-not-mono`,
`spacing`. Membership is defined by that mechanism, not by which rules came out clean: `contrast`
and `measure` are fixable but their remedies are conditional (no passing colour, a doubtful ground;
a flex or grid block), so they are tier 2.

- **Bar: zero failures per rule, per model, on every scored `pipeline` page**, at both widths. Each
  rule is reported separately as held or broken; a single failure breaks that rule's guarantee and
  names the page. Pooled across both models, 0 of 144 bounds a rule's failure rate below 2.1%.
- **Baseline** (`engine5`, re-scored on the runner with the `engine6` scorer): 9 of 13 rules hold on
  GPT-5 (broken: `spacing` 6 pages, `link-not-underlined` 2, `target-size` 2, `body-too-small` 1)
  and 6 of 13 on GPT-5-mini (`text-too-small` 5, `link-not-underlined` 4, `spacing` 4,
  `aspect-ratio` 4, `body-too-small` 4, `accent-non-interactive-ii` 1, `font-off-system` 1). Where a
  deterministic remedy exists and the rule still fails, the element was not located, the fix was
  rolled back, or it lost on specificity — engineering defects, each to be found and closed.
- **Membership changes only by amendment, before a run**: a rule joins when its remedy becomes
  unconditional, with a test. A tier 1 rule that fails is reported broken; it is never moved to
  tier 2 after the run that broke it.

**Tier 2 — model-dependent rules.** Every other scored rule. The remedy depends on what the model
writes — figures, layout and overflow, composition, colour where the fixer may decline.

- **Bar: a page clean on every tier 2 rule, at least 50% of pages on GPT-5 and at least 35% on
  GPT-5-mini** by the end of phase 2. Baseline 34.7% (25/72) and 23.6% (17/72); the bar is about
  fifteen points above each, chosen as reachable within the phase but not by one change.

**Unchanged.** The held-out rate stays within 0.10 of 1.00, measured as before on the blind arm.
Cost stays at 1.5× of rules-read, stated as a phase 2 target: `engine5` showed that correct repairs
cost more, so it is met by needing fewer repairs, not cheaper ones.

**Reported, no longer a bar.** The share of pages clean on every checked rule, so the series from
`engine2` stays continuous.

### Amendment, 2026-10-12 (eighth) — the held-out falsification explained: no leak, three defects, an underpowered bound

`engine6` read **0.88 [0.76, 1.01]** on GPT-5, outside the registered ±0.10, the first time the
premise metric has moved. Four hypotheses were tested, each adversarially verified by a second
reader instructed to refute. Findings, in order of how much they should change what anyone believes.

**1. It is not a leak, and this time the test had power.** No disclosed fix moves a scored rule.
Across all 72 blind pages at both widths, stripping the fixer's **913 `font-size` and 93
`font-family`** declarations moves `target-size` by 1 opportunity in 732 and nothing else; stripping
the contrast fixer's 49 colour declarations moves nothing. The earlier "no leak" rested on 6 and 5
testable pages and was underpowered rather than negative; this does not. The apparent signal — blind
pages where contrast was fixed read `focus-hidden` 0.531 against 0.747 elsewhere — is **page
selection, not causation**: the same 18 brief|sample cells already read 0.552 on `engine5`, when only
6 of them had a contrast fix, and the cells the fixer never touched fell *further* than the ones it
did (0.850 → 0.785 against 0.552 → 0.531). Label permutation inside `engine6` gives p = 0.30.

**2. The verdict stands as registered: falsified.** The movement is not separable from run-to-run
noise — permutation over briefs gives p = 0.24 on GPT-5 and 0.96 on mini, and `engine3`'s own two
sample halves read 1.015 and 0.872, so `engine6`'s whole-run 0.879 sits inside the spread of half a
run in which nothing changed. **That is not grounds to relabel it.** Retroactively softening a
pre-registered breach because the post-hoc noise estimate is wide is the one move here that could
manufacture a false result, and it is refused. `engine6` is reported falsified.

**3. The bound was underpowered, and that is a defect in the registration, not the result.** With a
GPT-5 centre of ~0.956 and a per-run sd of ~0.05, the probability that some run in a four-run series
breaches ±0.10 on a single point estimate is **0.57** — more likely than not. A single 72-page run
cannot resolve ±0.10; the bootstrap CI half-width is ~0.13. **Registered prospectively, from
`engine7`:** the held-out bar is judged on **two runs' pooled estimate**, not one, and the bound stays
±0.10. Buying the precision with samples is the fix; widening the bound after seeing a breach is not,
and switching to a "CI contains 1.00" rule is rejected outright — every run from `engine3` to
`engine6` satisfies it, so it is a test that cannot fire.

**4. Three measurement defects, found while explaining the movement.**

- **The baseline is scored by an older instrument.** The held-out ratio divides an `engine6`-scorer
  numerator by `full-gpt-5.jsonl`, frozen before `98d1725` and the ground corrections. Re-derived with
  the same scorer on both sides the ratio reads **0.8839** (envelope 0.872–0.892) — the defect is real
  and its effect here is small, but a metric whose two halves are measured differently is not sound.
  Fix before `engine7`: re-score the rules-read baseline with the current scorer, or record the ratio
  as same-scorer only.
- **`aspect-ratio` counted distinct ratios over raw elements.** The numerator was deduplicated
  (`[...new Set(ratios)]`) while the denominator is the raw imagery count, so drawing more figures
  mechanically lowered the rate. GPT-5 blind opportunities rose 118 → 134 while violations fell 70 →
  66. **Fixed 2026-10-12**: one entry per figure, so both sides count elements
  (`test/aspect-ratio-per-figure.test.mjs`). `grounds` stays deduplicated on purpose — its rule is
  about which colours appear, not how many surfaces carry them.

  **What it does to the held-out ratio is undetermined, and a reported estimate of ≈0.859 is
  withdrawn.** That figure came from a diagnosis agent and this author could not reproduce its
  direction. Measured directly on the `engine6` GPT-5 blind pages with the corrected scorer, the
  numerator rises 66 → 68 against an unchanged 134 opportunities (0.4925 → 0.5075) — which on its own
  moves the ratio *up*, not down. The net depends on the rules-read baseline, which has the same
  defect and cannot be re-scored because its pages were not kept. So the corrected ratio is
  **unknown until a same-scorer baseline exists**, which is the defect below, and no corrected figure
  is published here.

  The defect also *masks a real improvement*: `engine5` drew 118 figures of which 87 were off-scale
  (73.7%), `engine6` 134 of which 68 (50.7%), so the engine got materially better at aspect ratios
  and the deduplicated metric understated it.
- **The markup contract names an attribute that gates a withheld rule.** `alt-missing` is scored and
  held out, and fires only on an svg whose `kind` is `plot`/`form`
  (`src/lib/rules/accessibility.mjs:28`) — read from `data-figure`, which `markupContract()` instructs
  the pipeline arms to write on the svg, and which the study arms never see. On `engine5` nothing
  declared it there and the rule could not fire; on `engine6`, 124 of 134 figures became eligible.
  The comment in `eval/arms.mjs` asserting the contract "names only attributes that gate *disclosed*
  rules" was therefore **false**, and is corrected in place. The channel pushes the ratio **up**
  (`alt-missing` is 0/126 in rules-read, so eligibility can only add blind violations), so it masked
  rather than caused the 0.88 — but it is a disclosed instruction reaching a scored result, which is
  exactly what the held-out design forbids.
  `test/contract-discloses-nothing-withheld.test.mjs` encodes the invariant behaviourally and is
  `todo`, not skipped, so it reports an unexpected pass the day it is closed.

**Decided and closed, 2026-10-12, approved by Jordan before `engine7` and before any `engine7`
result exists.** Of the two options — dropping `data-figure` from the contract, which would regress
`decorative-imagery` from 0/3 back toward 19/24 and give up `engine6`'s largest win, or changing
`alt-missing` to decide "is this a figure" without reading the declaration — the second was taken, as
the principled one: an svg that carries content needs a name whether or not it was declared.

`alt-missing` no longer reads `img.kind`. An svg is judged on what it is: unnamed and unhidden is a
graphic only the eye can read, and `aria-hidden` remains the answer for one carrying no information,
unless its content is words. No size threshold was introduced — a census of all 341 svgs across the
`engine6` pages found every one of them draws geometry, so geometry discriminates nothing, and the
rule's existing `aria-hidden` escape already excuses the decorative case without one.

**This is a scorer change, so under the staging rule it discards rather than pools every earlier
pipeline record.** Its measured effect is small: over the 288 `engine6` pages, dropping the gate
moves **one page** (GPT-5-mini `pipeline`, 0 → 1 page, 0 → 2 violations) and leaves the other three
model|arm cells identical. The channel it closes is structural rather than large, and it is closed
because a disclosed instruction must not be able to switch a scored rule on, not because it was
moving the number much.

The invariant is now enforced rather than asserted: `test/contract-discloses-nothing-withheld.test.mjs`
builds one page twice, differing only by `data-figure`, and fails if any withheld rule can tell them
apart. It was landed `todo` while the breach stood and is now a passing test. Any future contract
addition that reaches a withheld rule fails the suite.

### Amendment, 2026-10-12 (ninth) — a same-scorer baseline, and the first sight of Goal A

The held-out ratio had been dividing a current-scorer numerator by `full-gpt-5.jsonl`, frozen before
four corrections. The study's baseline pages survive as an unexpired artifact, so both sides were
re-scored **by the same code on the same runner** (run 38277120968, arms `rules-read` and
`pipeline-blind`, 320 and 1280px; one baseline page, `b30`, will not load and is excluded and named).

**Exploratory result, GPT-5, `engine6` pages:**

| | ratio | 95% interval |
|---|---|---|
| as published (mismatched baseline) | 0.879 | [0.759, 1.012] |
| **same scorer both sides** | **0.823** | **[0.689, 0.975]** |

The interval excludes 1. **That is the shape Goal A asks for** — "pipeline held-out rate below
rules-read, 95% interval excluding 1" — and it is the first time this project has seen it.

**It is not claimed, for four reasons, and none of them is a formality.**

1. **One model.** The bar is pooled over models. GPT-5-mini read 1.02 against the mismatched
   baseline and its same-scorer figure is not yet computed.
2. **Post-hoc.** This analysis was specified *after* seeing `engine6` and after two scorer changes.
   The project's own history is that favourable post-hoc numbers do not survive.
3. **Superseded records.** The scorer changes discard `engine6` under the staging rule. This is a
   re-analysis of data the protocol has already set aside.
4. **The baseline is re-scored, not re-generated.** Current rules judging pages written under the
   old study prompt corrects the instrument, not any difference in what was generated.

**Robustness, run before reporting it.** Leave-one-out over all ten scored rules: the interval still
excludes 1 without any single rule except `target-size` (0.836 [0.683, 1.007], marginal). Removing
`alt-missing` — the rule changed hours earlier, which mechanically worsens a baseline that never
declared figures — leaves 0.855 [0.738, 0.991], so the result is not an artefact of that change. No
single rule carries it: `focus-hidden` ~29% of the gap, `alt-missing` ~22%, `aspect-ratio` ~20%,
`target-size` ~19%, `horizontal-overflow` ~15%, offset by `link-not-underlined` going the other way.
`target-size` remains the standing lead flagged at 0.67/0.70/0.73; the strip test (913 `font-size`
and 93 `font-family` declarations removed, moving it by 1 opportunity in 732) is the evidence that it
is not leak-driven, and that evidence is load-bearing here.

**Both models, and the reason this is still not claimed.** With mini re-scored the same way:

| | ratio | 95% interval | |
|---|---|---|---|
| GPT-5 | 0.823 | [0.689, 0.975] | excludes 1 |
| GPT-5-mini | 0.978 | [0.877, 1.083] | includes 1 |
| **pooled** | **0.899** | **[0.816, 0.989]** | **excludes 1** |

Pooled, that is the bar's shape. **It is not robust, and the way it fails points at this author.**
Pooled leave-one-out removes one rule at a time: every removal keeps the interval below 1 except
`alt-missing`, which flips it to **0.934 [0.857, 1.016] — containing 1**.

`alt-missing` is the most extreme per-rule ratio in the set: 0.134 on GPT-5 (14/126 against 2/134)
and 0.356 on mini (34/210 against 12/208). **That contribution exists because the rule was widened
hours earlier**, in this same session. Before the change it fired only on figures declaring
`data-figure`; the baseline arm never saw the markup contract and so never declares, so the rule
contributed almost nothing to the ratio. Widening it to judge every svg made the baseline fail a
rule the engine's arms largely pass, and that single edit is what carries the pooled result past 1.

The widening was correct on its own terms — it closed a disclosed instruction's channel into a
scored rule — but a correctness fix must not be allowed to become a favourable result by the back
door. Whether the engine's arms name their figures better *because* the contract made them write
careful figure markup is a real generalisation or a disclosure artefact is **not resolved here**.

**Registered prospectively, before `engine7` runs and before its records exist, and deliberately
harder than the bar it replaces.** Goal A is judged on `engine7`, on **both models pooled**, with
numerator and denominator scored by the same code on the runner and the baseline re-scored in the
same job. The ratio must be below 1 with the 95% interval excluding 1 — **and the interval must
still exclude 1 under leave-one-out across all ten scored rules.** The figures above would fail that
second condition today. They are exploratory, are reported as such wherever they appear, and are
withdrawn rather than averaged in if `engine7` does not replicate them.

### Amendment, 2026-10-12 (tenth) — `engine7`: no engine change, registered before it runs

**What is in it: nothing new.** `engine7` carries no engine feature. It re-runs the current engine
under the corrected scorer — `alt-missing` judged on the svg rather than the declaration,
`aspect-ratio` counted per figure, plus the earlier ground and root-clip corrections. Adding a
feature here would confound the one thing this run exists to settle, so the open leads (`contrast`
3/8, `offset-off-grid`, mini's overflow at 30/72) are deliberately **held back for `engine8`**.

**Why it is worth $31 anyway.** The Goal A sighting of 0.899 pooled came from re-analysing
`engine6`'s pages. `engine7` generates new pages from the same engine, so it is an independent
replication rather than a re-reading of the same data, and it is the first run whose numerator and
denominator are produced by one scorer by construction rather than by repair.

**Predictions, bounded both ways, registered before any `engine7` record exists.**

1. **Pass rate falls**, because the scorer is strictly stricter on two rules. Predicted **35–55% on
   GPT-5** and **25–45% on mini**, from 52.8% and 43.1%. Above those bands means the corrections did
   less than they should; below means something else moved and must be found before the run is read.
2. **Cost is unchanged within ±0.15×** — no engine change touches the repair path. Predicted
   1.46–1.76× (GPT-5) and 1.73–2.03× (mini).
3. **The held-out ratio replicates within ±0.08 of 0.899 pooled**, i.e. 0.82–0.98, and **excludes 1**.
4. **It fails the leave-one-out condition on `alt-missing`.** This is a prediction against the
   result this author would prefer: nothing in `engine7` changes why the baseline fails that rule and
   the engine's arms pass it, so the dependency should persist. If the pooled interval *does* survive
   leave-one-out, that is a stronger result than expected and must be investigated before it is
   believed, not reported as a win.
5. **Tier 1** holds on **8–11 of 13** rules (GPT-5) and **3–6 of 13** (mini); **tier 2** at or above
   **50% / 35%** on GPT-5 only.

**Goal A is judged exactly as the ninth amendment registered it** — pooled over both models, same
scorer both sides, interval excluding 1, and still excluding 1 under leave-one-out. The baseline is
re-scored at the same commit on the same runner; the generate and re-score jobs are separate
dispatches of the same workflow at that commit, which is what "same code" requires.

### Amendment, 2026-10-13 (eleventh) — measure is the length of a line, not of its box

An instrument correction, found while judging Standards packs' own fixtures under each pack
(readiness milestone M1). `measure` reported the width of a text's block in characters, so a
three-word heading in a 1,100px column read as 150ch. A line is never longer than its text: the
reported measure is now the lesser of the two. Every golden spec was regenerated and checked: of
5,170 changed values in 124 files, all are `measureCh` — 5,109 lower, 61 higher by exactly the
existing tolerance of 1 (decision 0014), none otherwise. `measure` is disclosed and outside `UNIVERSAL_WITHHELD`, so the
held-out ratio cannot move; pass rates can only rise. Under the staging rule earlier pipeline records
are superseded for `measure`; `engine8` is the first run scored with it.

### Amendment, 2026-10-14 (twelfth) — `engine8`: the tier 1 fixer defects, a centred-margin correction, the bootstrap's cluster pinned; registered before it runs

**What is in it: two changes and a pin.** `engine8` exists to test whether the seventh amendment's
tier 1 guarantee holds once the defects `engine7` exposed are closed. Nothing aimed at a tier 2 rule
goes in, so the open leads (`contrast`; `offset-off-grid`, GPT-5's most frequent failure on `engine7`
at 14 of 72 pipeline pages; mini's `horizontal-overflow` at 20 of 72) are **held back again, for
`engine9`**.

1. **The fixer** (`src/lib/fix/`, PR #50). On `engine7` every failing element had been located
   except text drawn by `::before` and `::after`. The main cause was whole-group rollback: one patch
   that made a rule worse dropped every patch in its group, the harmless ones included. Rollback now
   bisects a dropped group, bounded at 24 trials a pass, and keeps what does not make a rule worse.
   Six remedies changed: an svg takes the nearest permitted ratio no wider than its drawing's own and
   is released from `max-height`, stretch, flex basis and automatic min-width; an underline covers
   the link's subtree; font sizes merge to the larger of the two widths, with 2% headroom; runs drawn
   by pseudo-elements are located and patched there; a Register II font fix carries the body floor;
   svg accent text is recoloured through `fill`. All of it is model-free. An adversarial review found
   the scorer identical on 24 `engine7` pages under both trees and no page, of the 29 whose gate failed
   a tier 1 rule, ending worse on any rule than the page the fixer started from.
2. **A scorer correction.** The extractor recognised a block centred by `margin: 0 auto` by exact
   equality of its two margins. Layout works in 1/64px units, so when the free space is an odd number
   of them one margin gets the extra unit (286.625px against 286.641px on `engine7` GPT-5 b03-s0) and
   the auto margin was counted as 287px of spacing. A block is now centred when its margins differ by
   less than half a pixel (`src/lib/page-spec.mjs`; `test/centred-margin.test.mjs` fails on the old
   test with those exact margins). Re-scoring the 144 `engine7` pipeline pages locally with the scorer
   before and after: `spacing` leaves four GPT-5 pages and one mini page, three of them become clean,
   and no other rule moves on any page. `spacing` is disclosed and outside `UNIVERSAL_WITHHELD`, so the
   held-out ratio cannot move and pass rates can only rise. Under the staging rule earlier pipeline
   records are superseded for `spacing`, as they are for `measure` (eleventh amendment). Together with
   the fixer, local replay of every `engine7` page whose gate failed `spacing` clears all five on
   GPT-5 and three of four on mini; b11-s0 remains, where snapping an 18px wrapper margin to 16px
   trips `print-overflow` and the fixer refuses it.
3. **The pooled interval's cluster is pinned.** Goal A's pooled bootstrap resamples the 72
   brief×model cells (`eval/heldout.mjs --cluster cell`, the default), the unit the ninth amendment's
   figures used. The 36-brief clustering is reported beside it and decides nothing. `engine7`'s
   verdict is the same under both.

**Baseline.** `engine7` re-scored on the runner with `engine8`'s scorer: both models' pipeline and
pipeline-blind arms, and the rules-read arm of `full-gpt-5` and `full-gpt-5-mini`, in one rescore
dispatch at the `engine8` commit before `engine8` generates. The `engine7` figures quoted below are
the recorded ones; the re-score may move them by the few pages the two corrections clear, and the
predictions are judged against the re-score.

**Predictions, bounded both ways, registered before any `engine8` record exists.**

1. **Tier 1 holds on 11–13 of 13 rules on GPT-5, expected 12, and on 7–10 of 13 on mini, expected
   9** (`engine7`: 11 and 6). Local replay holds all 13 on GPT-5; on mini it leaves `body-too-small`
   (three pages) and `font-off-system` (three) broken by one conflict the fixer refuses by design,
   15px controls in rows or tables that cannot hold 19px at 320px, plus `text-too-small` (one page,
   chart labels at a scale near 0.1) and `spacing` (b11-s0). The expected values are one below the
   replay because 72 fresh pages bring failure modes 144 replayed ones did not, and the runner fails
   pages local replay clears.
2. **Pass rate rises: 52–65% on GPT-5 and 36–51% on mini** (`engine7`: 55.6% and 34.7%). On the
   records, four GPT-5 pages failed only tier 1 rules, and eleven mini pages failed only tier 1 rules
   and one only `measure`; replay clears all four and about seven of the twelve. Below a band means
   something else moved and must be found before the run is read; above it means run-to-run variance
   or the corrections did more than they should.
3. **Tier 2 stays above its bars**: page-clean on every tier 2 rule at 53–69% on GPT-5 and 42–58% on
   mini (`engine7`: 61.1% and 50.0%; bars 50% and 35%). No change aims at a tier 2 rule; the bisected
   rollback keeps more patches but never leaves a rule worse than the fixer's start.
4. **Cost is unchanged within ±0.15×**: 1.54–1.84× (GPT-5) and 1.72–2.02× (mini). The fixer calls no
   model; its extra lints cost wall-clock time, not tokens.
5. **The held-out ratio replicates within ±0.08 of `engine7`'s 0.911 pooled**, i.e. 0.83–0.99. The
   blind arm's fixer applies disclosed rules only; the new remedies can reach a held-out rule only by
   a side effect of the kind the eighth amendment measured (a font-size fix growing a control past
   24px, 1 in 732). **Goal A is predicted not met**: it is judged exactly as the ninth amendment
   registered it, with the cell clustering above, and the leave-one-out condition failed on nine of
   ten rules on `engine7`; nothing here changes why.
6. **The eighth amendment's two-run bound** — the held-out ratio within 0.10 of 1.00, judged on
   `engine7` and `engine8` pooled — **holds on mini and breaks on GPT-5, below the bound** (0.827 on
   `engine7`, outside it a second run running). A breach below 1 is the engine's arms doing better
   than reading the rules on rules no arm was told; it is reported as a breach of a no-harm bound,
   not as Goal A.

**The run.** As `engine7`: `azure:gpt-5` and `azure:gpt-5-mini`, arms `pipeline` and
`pipeline-blind`, the thirty-six frozen briefs, two samples each, about $31 of Azure credit for both.

## Measures

Primary:
- **Held-out violation rate** — violations per element of opportunity, on the withheld rule groups.

Secondary:
- **Independent accessibility** — axe-core violation count; WCAG contrast failures.
- **Token adherence** — distance in CIE Lab from the nearest palette colour; deviation of spacing
  values from the 8px scale. Measures drift, not pass/fail, so partial compliance is visible.
- **Cross-generation variance (H3)** — generate k samples per brief per arm; measure dispersion of
  colour, type and spacing usage across them. A design system should collapse this.
- **Cost** — input and output tokens, wall-clock, and for arm F the number of repair rounds to
  green. An approach that wins at ten times the cost has not obviously won.

Guard (H4):
- **Blind pairwise preference** on rendered screenshots, judges shown two pages and not told the
  arm. Use both human raters and multiple LLM judges from different families; validate the judges
  against a small human-labelled subset and report inter-rater agreement. A judge from the same
  family as the generator is a known bias and must not be the only judge.
- **Output diversity** — structural and visual distance between pages from *different* briefs
  within one arm. If enforcement collapses this, the system is producing sludge and we should say
  so plainly.

## Models

Run every arm across at least three capability tiers, because an effect that only appears on weak
models is a crutch and an effect that only appears on strong models is a curiosity. Use
`claude-opus-5`, `claude-sonnet-5` and `claude-haiku-4-5` at minimum, at fixed effort. Include at
least one model from another provider for external validity: if the effect is real it is a property
of the method, not of one family.

A specific prediction worth recording now: the *gap between arms* should be widest on the weakest
model. If the linter loop lifts Haiku close to unaided Opus, that is the single most useful result
this study can produce, and it is the one a deploying organisation cares about.

## Staging, and the rule that stops staging becoming cherry-picking

The four models do not cost the same. Haiku is roughly a twentieth of the study's budget, so running
it first is cheap insurance: real model output produces failure modes a stub cannot — truncation at
the token cap, fenced or partial markup, refusals, pages that do not load — and it calibrates how
much repeat generations vary, which is what says whether two samples per cell is enough.

That is a legitimate reason to stage. "Run the arm most likely to confirm our hypothesis, look, and
then decide whether to continue" is not, and the two are separated only by rules fixed in advance:

1. **The Haiku run is a shakedown, not a result.** Its rate ratios are not reported as evidence for
   or against any hypothesis, and not quoted outside this repository.
2. **Every model runs regardless of what the shakedown shows.** A disappointing shakedown is not
   grounds for stopping, and a flattering one is not grounds for declaring victory.
3. **Touching the harness invalidates the shakedown.** If looking at those pages leads to any change
   in prompts, arms, briefs or the metric — which it legitimately might, since that is what a
   shakedown is for — the shakedown data is discarded rather than pooled into the pilot. Data
   collected before a change and data collected after it are not the same experiment.
4. **A single tier cannot test the headline prediction.** "The gap is widest on the weakest model"
   needs at least two tiers by construction, so nothing about it is knowable until the pilot runs.

## Predictions, recorded before any run

Written down now so the result can contradict us. Direction and rough magnitude, on the primary
metric (violations per 100 elements on the nine scoreable rules):

| # | Prediction | Confidence |
|---|---|---|
| P1 | Every arm beats the control (A). | high |
| P2 | Arm F beats arm B (prose) by a wide margin — a rate ratio below 0.6. | moderate |
| P3 | **Arm F beats arm E (rules read) by less than people expect — ratio between 0.7 and 1.0, and plausibly indistinguishable from 1 on the strongest model.** | deliberately uncertain |
| P4 | The F-over-E advantage is largest on Haiku and smallest on Opus. | moderate |
| P5 | Arm C (tokens alone) barely beats A on these nine rules, because the token file says nothing about any of them. | high |
| P6 | Arm D (components) scores well but for the uninteresting reason — it is handed the answers. | high |
| P7 | Cross-generation variance falls monotonically from A to F: the consistency claim is the one most likely to hold. | moderate |
| P8 | Arm F costs 2–4× arm E in tokens, because of repair rounds. | high |

P3 is the one to watch. It is the prediction that, if it lands, says the executable half of this
project is worth much less than the written half — and it is recorded here at the same confidence as
the others precisely so that outcome cannot later be framed as expected all along.

**The pilot ran on 2026-10-08: P3 landed and P9 did not.** Every prediction is read against its result in
`docs/pilot-results.md`, which is written against this table and leaves it as it was.

## Analysis

Counts, so Poisson or negative-binomial regression, not t-tests on means:

    violations ~ arm + (1 | brief) + (1 | model)

Random intercepts for brief and model; arm as the fixed effect; report incidence rate ratios with
confidence intervals and effect sizes, not bare p-values. Holm correction across the arm
comparisons. Pre-specify the comparisons that matter (B vs F, E vs F) as primary and treat the rest
as exploratory.

`eval/analyse.mjs` does **not** implement that model. It reports a cluster bootstrap over briefs —
non-parametric, honest about its assumptions, adequate for sizing an effect in a pilot — and leaves
the mixed model to R or Python against the same JSONL. Reimplementing a negative-binomial mixed
model badly in JavaScript would produce numbers that look authoritative and are not. Bootstrapping
over *briefs* rather than pages is the part that matters: pages from one brief are not independent,
and resampling pages would narrow the intervals in our favour.

Ablations, once the main result is in:
- Repair budget: 1, 2, 3, 5 rounds. Where is the knee?
- Feedback richness: exit code only, versus rule id, versus the full message with the offending
  sample. This measures what our *error messages* are worth, and is directly actionable — we write
  those messages.
- Format of the same information: DTCG JSON versus CSS custom properties versus prose.

## Threats we cannot fully remove

- **Contamination.** If a model has seen this repository, arms C–F are advantaged in a way that has
  nothing to do with the method. The novel derived brand mitigates but does not eliminate this.
  Report it.
- **The linter only sees what it measures.** A page can be clean and still bad. This is precisely
  why the blind preference arm exists, and why a clean-but-disliked result must be published rather
  than buried.
- **Brief realism.** Synthetic briefs are not client work. State it.
- **The prose arm is a reconstruction.** Arm B is synthesised from the same disclosed rules rather
  than sampled from a real company's guide. That is what makes B and E information-equivalent, which
  the comparison needs, but it means B is a fair-minded model of the incumbent and not a sample of
  one. A real guide would be worse written and less complete, so this biases *against* our result.
- **The pilot is a sizing exercise.** Twelve briefs will not settle anything; it estimates the
  effect and tells us whether the full study is worth running.

## Reporting

Publish the negative and mixed results in the same document as the positive ones, including H4 if
it lands against us. A design system that can only be justified by favourable measurement is not
justified. The point of building the measuring apparatus was to be able to be wrong in public.
