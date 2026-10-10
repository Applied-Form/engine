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
