# Pilot results: the loop beats the compiled rules, not the full ones

@eyebrow Document type · Results · Register II

The pilot the evaluation protocol commits to has run: three Claude tiers, eight arms, twelve briefs, two samples each, 576 pages. This document reads it against the hypotheses and predictions recorded in `docs/evaluation-protocol.md` before any of it existed, including the ones it contradicts. The protocol's reporting rule applies: the negative and mixed results are published here with the positive ones.

:::provenance
Subject · the model study, pilot stage · `eval/` at main `fe0692e`
Records · `eval/results/pilot-haiku-4-5.jsonl`, `pilot-sonnet-5.jsonl`, `pilot-opus-5.jsonl`, 192 records each
Runs · Evaluation workflow runs 37833276081, 37833273511, 37833270079, 2026-10-08, one runner each, four cells at a time
Tables · `node eval/tables.mjs eval/results/pilot-*.jsonl`, seeded, so every number below reruns exactly
Cost · $173.65 at list price: Haiku 4.5 $11.70, Sonnet 5 $38.59, Opus 5 $123.37
Not yet run · the judging round (H4), a model from another provider, the ablations
:::

## The answer

The protocol's amendment of 2026-09-04 named one comparison as the one the study exists for: the repair loop (F) against the same rules compiled to a core of at most twenty statements, because a win over the full forty-six-rule text might only measure prompt length. On the rules no arm was told about, the loop wins it. Pooled across the three models its rate is 0.77 of the compiled arm's (95% interval 0.64 to 0.92): 0.67 on Sonnet and 0.71 on Opus, both intervals excluding 1, and 1.17 on Haiku (0.82 to 1.86), which cannot be told from 1.

The amendment's premise did not hold, though, and the reading turns on it. Compiling the rules was meant to give the loop a stronger competitor by removing the length penalty. It gave it a weaker one: the compiled arm's rate is 1.27 of the full text's (1.08 to 1.54), and 1.37 and 1.41 on Sonnet and Opus. Against the full text, the loop's rate is 0.98 (0.88 to 1.11), and against the prose guide 0.98 (0.81 to 1.15). The loop's win over the compiled arm is the compiled arm's loss. A prompt at full length matches the loop on rules nobody was told about. P9 is not met, in the opposite direction from the one it guarded against; H1 and H2 are not supported; P3, the prediction recorded so that this outcome could not later be called expected, landed.

On the rules the gate does enforce, the loop removes 82% of the violations that remain after a model has read the rules (ratio 0.18, interval 0.06 to 0.38). That result held on every model. 44% of the loop's pages finish with no disclosed violation at all, against 4% for reading the rules and none for prose or the control. This measure is circular by construction, because the gate scores what the gate enforced. It shows what the gate guarantees. It does not show that the system teaches anything beyond itself.

Handing a model the token file brings its palette within 1.6 ΔE of the system's colours, against 11 to 12 without it: seven times closer. Serious accessibility violations, counted by axe-core, a third-party instrument, fall from 7.6 to 1.1 per page. The token file does that, not the gate. The loop adds nothing to either measure.

So the product is two things, and the evidence separates them. The written system (tokens and rules in the model's context) is what moves generation. The gate is what guarantees conformance on what it checks, at about four times the tokens. Neither claim should borrow the other's evidence.

## What was run

| | |
|---|---|
| Models | Haiku 4.5, Sonnet 5 and Opus 5, the tiers the protocol names, Sonnet and Opus at medium effort |
| Arms | A none · B prose guide · C token file · D components · E rules read · compiled rules · F rules run (repair loop, up to three rounds) · G rules run, primed with the brief |
| Briefs | Twelve, across both registers, densities and chart and no-chart pages |
| Samples | Two per cell, 192 pages per model |
| Study system | Meridian, a held-out system that none of this repository's own pages use |
| Primary metric | Violations per opportunity on the ten universal held-out rules: rules any page can break, that nothing in any arm's context states |

Failures are excluded from every rate and never counted as clean pages. There were twelve: nine truncated component pages, eight of them on Haiku (the component stylesheet plus a page exceeds Haiku's output cap); one truncated compiled-rules page; and on Opus, one errored control page and one errored prose page.

## Against the predictions

| # | Prediction (confidence) | Result | Verdict |
|---|---|---|---|
| P1 | Every arm beats the control (high) | Every arm but one does. The token file alone does not: 0.93 (0.81 to 1.07) | Not met, and consistent with P5 |
| P2 | F beats B by a wide margin, ratio below 0.6 (moderate) | 0.98 (0.81 to 1.15). On Opus the prose guide is nominally ahead, 1.15 | Not met |
| P3 | F beats E by less than expected, 0.7 to 1.0, plausibly indistinguishable from 1 on the strongest model (deliberately uncertain) | 0.98 (0.88 to 1.11) pooled; 0.99 on Opus | Met, at its pessimistic end |
| P4 | F's advantage over E is largest on Haiku, smallest on Opus (moderate) | Held out: 0.92, 0.91, 0.99, all intervals including 1. Disclosed: 0.15, 0.18, 0.21 | Direction holds; not established |
| P5 | C barely beats A on these rules (high) | 0.93, interval including 1 | Met |
| P6 | D scores well, for the uninteresting reason (high) | Best held-out arm, 0.57 of the control, almost entirely link underlining (0.05 against 0.94) and target size, which its stylesheet supplies. It is worse on missing alt text (0.43 against 0) and truncates 13% of the time | Met |
| P7 | Cross-generation variance falls monotonically from A to F (moderate) | Palette-drift spread: A 1.24, B 2.00, C 0.51, E 0.49, F 0.52. It falls once, when the token file arrives, and not again | Not met |
| P8 | F costs 2 to 4 times E in tokens (high) | 4.1 times pooled; 4.1, 3.6 and 4.7 by model | Met, at the top of the range |
| P9 | F's advantage over the compiled rules is smaller than over E, because part of the latter is prompt length (moderate) | Larger: 0.77 (0.64 to 0.92) against the compiled rules, 0.98 against E. Compiling the rules made them worse, 1.27 of E | Not met, in the opposite direction |
| P10 | G is not measurably more conformant than F, and is preferred by blind judges more often (deliberately uncertain) | Not more conformant: 1.09 of F (1.02 to 1.19), slightly less. Preference not yet measured | First half met; the second waits on judging |

| Hypothesis | Verdict on this pilot |
|---|---|
| H1 · executable beats a prose guide with the same rules | Not supported on held-out rules. Supported, by a factor of about 25, on the rules the gate enforces |
| H2 · most of the gain is the feedback loop, not the written rules | Not supported. On held-out rules the written rules carry the whole gain (E against A, 0.66) and the loop adds nothing to the full text (F against E, 0.98). It beats the compiled text (0.77) because the compiled text is worse than the full one |
| H3 · the system reduces variance more than it raises the mean | Not supported as stated. Palette drift's mean falls 5.4 times and its spread 2.4 times; both fall, and the mean falls more |
| H4 · enforcement costs quality | Not yet measured. The judging round has not run |

## What each part of the system does

### The written rules teach, on the strongest model most

| Held-out rate against the control | Haiku 4.5 | Sonnet 5 | Opus 5 | Pooled |
|---|---|---|---|---|
| B prose guide | 0.90 | 0.78 | 0.49 | 0.67 |
| E rules read | 0.90 | 0.80 | 0.57 | 0.66 |
| F rules run | 0.83 | 0.73 | 0.56 | 0.65 |

Rules in context generalise to rules not in context, and the effect grows with the model: barely visible on Haiku, a halving on Opus. Whether those rules arrive as a prose guide, as structured rules or with a linter behind them makes no difference the pilot can detect.

How they are written does. The compiled form, the same rules in at most twenty statements, does worse than the full text on the two stronger models (1.37 on Sonnet, 1.41 on Opus, both intervals above 1) and nominally better on Haiku (0.79, 0.57 to 1.17). That is the shape the instruction-following literature behind the amendment predicts for a model that loses track of a long list, and it appears only on the weakest one; the stronger models used the detail the compiled form left out. The loop's apparent advantage over the compiled arm sits on exactly the two models where compiling hurt.

### The gate enforces, on every model

| Disclosed violations per 100 elements | Haiku 4.5 | Sonnet 5 | Opus 5 |
|---|---|---|---|
| A none | 82.5 | 92.4 | 101.3 |
| B prose guide | 77.2 | 69.0 | 67.3 |
| E rules read | 31.3 | 16.6 | 10.2 |
| F rules run | 4.8 | 3.1 | 2.2 |

The loop's reduction is large and consistent across tiers. Its most useful consequence is the comparison across them: Haiku with the gate leaves 4.8 disclosed violations per hundred elements, half what Opus leaves after reading the rules (10.2), at $0.11 a page against $0.39. The protocol named this, a weak model lifted by the loop past a strong one, as the result a deploying organisation would care about most. On the enforced rules it holds. On held-out rules it does not: Haiku with the loop (0.185) is only a little better than unaided Opus (0.227) and well behind Opus reading the rules (0.129).

Repeating the brief in every repair round (arm G) does not help: 1.09 of the plain loop on held-out rules, interval 1.02 to 1.19.

### The token file brings the palette and accessibility

| | A none | B prose | C tokens | E rules read | F rules run |
|---|---|---|---|---|---|
| Palette drift, ΔE | 11.25 | 12.09 | 1.64 | 1.80 | 2.08 |
| axe-core violations per page | 15.1 | 14.4 | 5.8 | 5.4 | 5.9 |
| axe-core serious per page | 7.6 | 6.4 | 1.1 | 1.1 | 1.0 |

Every arm with the token file lands on the system's colours and cuts its accessibility violations to about a third; the prose guide, which describes the palette without its values, does neither. The palette result is taught by construction, which is why the study does not score it. The axe-core result is not taught by anything in the context and is measured by an instrument that is not ours, so it is the cleanest evidence in this pilot that the system improves pages beyond its own rules. It comes from the token file. The gate adds nothing to it.

## Cost

| Per page, list price | A none | E rules read | F rules run |
|---|---|---|---|
| Haiku 4.5 | $0.023 | $0.033 | $0.110 |
| Sonnet 5 | $0.076 | $0.139 | $0.400 |
| Opus 5 | $0.360 | $0.393 | $1.358 |

The loop costs three to four times reading the rules, almost all of it repair rounds: of its 72 pages, 3 were clean on the first attempt, 35 took one round, 6 took two and 28 took all three.

## What this means

**For the claims.** "Executable beats written" cannot be said on this evidence and must come out of anything that says it. What can be said, each with its own measure:

- Giving a model the system, tokens and rules, makes its pages closer to the system and measurably more accessible, by an instrument that is not ours; most on the strongest models.
- The gate then removes four fifths of the remaining violations of everything it checks, on every model, and lets a small model meet the enforced rules better than a large one reading them, at a quarter of the price.
- The repair loop does not teach the model anything beyond the rules it is shown. It beats a compressed statement of the rules on the stronger models, and only because the compression loses what those models use; it does not beat the rules written out in full.

**For the engineering.** The gate's value is coverage, not pedagogy: every rule it checks is a rule the output keeps. That argues for more rules in the gate, for the ablations the protocol lists (repair budget, feedback richness) to find where the loop's cost stops paying, and against expecting the loop to lift quality outside what it checks. The compiled rules form should not be offered as the cheaper option to strong models, where it is worse; on Haiku it may help, which the full study can settle. The component arm's truncation on Haiku is a real constraint on shipping components to small models.

**For the study.** The pilot is the protocol's pilot, not its full study. Two samples per cell leave the per-model intervals wide; P4 in particular cannot be settled at this size. The next runs, in order:

1. The judging round (H4), over these pages. The protocol already holds that conformance does not establish quality: an unstyled page scores well. Until preference is measured, no conformance result here says the pages are better. The panel needs a judge from outside the Claude family, which the protocol requires and the harness enforces; the repository holds only an Anthropic key, so the round waits on an OpenRouter, OpenAI, Azure or Google key.
2. A model from another provider (GPT-5 on Azure), so the result is a property of the method and not of one model family.
3. The repair-budget and feedback-richness ablations, on Haiku, where the loop is cheapest and its effect largest.

## Threats

- **Circularity.** The disclosed-rule results are scored by the instrument the loop was shown. They are reported as enforcement, never as generalisation; the held-out rate and axe-core carry every generalisation claim.
- **One family.** All three generators are Claude models.
- **Pilot size.** Twelve briefs, two samples. Intervals are a cluster bootstrap over briefs, which is honest about that and wide because of it; the mixed-effects model the protocol specifies has not been fitted.
- **The held-out metric leans on two rules.** Link underlining and aspect ratio have the highest rates in every arm, so movement on the metric is largely movement on those two.
- **List prices.** Cost is computed from recorded token usage at list price on the day; it ignores caching and batch discounts.
