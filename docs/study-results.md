# Study results: the gate enforces, the rules teach, the loop teaches nothing more

@eyebrow Document type · Results · Register II

The full study the evaluation protocol commits to has run: five generators from two families, eight arms, thirty-six briefs, two samples each, 2,880 pages, a blind preference round over every one of them, the protocol's mixed-effects model, and both of the loop's ablations. This document reads it against the hypotheses in `docs/evaluation-protocol.md` and against the pilot (`docs/pilot-results.md`), including where it contradicts both. The protocol's reporting rule applies: negative and mixed results are published with the positive ones.

:::provenance
Subject · the model study, full stage · `eval/` at main `1813109`, harness `3e7a86dd` (thirty-six briefs, amendment of 2026-10-10). GPT-5 ran at `8449103`, harness `658a2215`: between the two only `eval/analyse.mjs` (a printed header), a new `eval/drift-declared.mjs` and `src/lib/drift.mjs` changed, none of which the generation or scoring path imports
Records · `eval/results/full-haiku-4-5.jsonl`, `full-sonnet-5.jsonl`, `full-opus-5.jsonl`, `full-gpt-5-mini.jsonl`, `full-gpt-5.jsonl`, 576 records each
Runs · Evaluation workflow runs 38058545172, 38058562902, 38058580258, 38058595673 (2026-10-10, none resumed); GPT-5 38089556487, resumed by 38120807315 after the runner ran out of disk at 477 cells
Judging · `eval/results/full-*.judging.jsonl` and `.json`; round `3e7a86dd` for the first four, `e153e8a3` for GPT-5 (after the page-location fix, #42); panel `azure:gpt-5-mini,sonnet-5-5`
Tables · `node eval/tables.mjs eval/results/full-*.jsonl`, seeded, so every number below reruns exactly
Model · `eval/stats/mixed.R` on `eval/stats/to_csv.py` output; glmmTMB 1.1.15, R 4.6.1
Cost · about $525 at list price for the Claude generators (Haiku 4.5 $35, Sonnet 5 $123, Opus 5 $368); GPT-5-mini about $17 and GPT-5 about $96 at assumed list prices ($0.25 / $2.00 and $1.25 / $10.00 per million tokens)
:::

## The answer

The comparison the study exists for is the repair loop (F) against the same rules read once (E). On the rules no arm was told about, the held-out rate, there is no difference: pooled across all five generators the loop's rate is 1.01 of reading's (95% interval 0.95 to 1.07); across the three Claude models 0.99 (0.89 to 1.08), against 0.98 (0.88 to 1.11) in the pilot; and the protocol's own mixed-effects model gives 0.96 (0.87 to 1.07), Holm-adjusted p = 1. Every generator agrees, from 0.94 to 1.04. H2 is not supported, with enough precision that an effect of more than about ten per cent in either direction is unlikely.

The loop does beat the compiled rules, 0.85 (0.79 to 0.92), for the reason the pilot found: compiling the rules to twenty statements makes them worse than the full text (1.19, 1.11 to 1.27). Against the prose guide the loop is level on the Claude models (1.02, 0.93 to 1.12) and worse on both GPT models (1.17 on GPT-5-mini, 1.40 on GPT-5); the mixed model, which weights rules by how often they apply, puts the pooled comparison at 1.01 (0.91 to 1.13).

What the loop does, it does on every generator: on the rules it is shown, it leaves 0.22 of what reading leaves (0.16 to 0.28), and 38% of its pages carry no disclosed violation at all, against 3% at most for any other arm. That is the gate's guarantee, and it is circular by design: it scores what it enforced. The ablations say where it comes from: the first repair round and the full error message.

## What was run

| | |
|---|---|
| Generators | Haiku 4.5, Sonnet 5, Opus 5 (Anthropic); GPT-5-mini, GPT-5 (Azure OpenAI) |
| Arms | none, prose, tokens, components, rules-read, rules-compiled, rules-run, rules-run-primed |
| Briefs | Thirty-six, three in each of twelve strata of register, density and chart (`eval/briefs.json`); b01–b12 are the pilot's, generated afresh |
| Samples | Two per cell, 576 pages per generator |
| Repair rounds | Up to three for the loop arms (one, two and five in the ablation) |
| Judges | `azure:gpt-5-mini` and `sonnet-5-5`, attention floor 0.8, checks cut where the judge can see them (amendment of 2026-10-10) |

GPT-5 is the pre-registered second family. It ran last, when quota arrived; GPT-5-mini ran first in its place and is kept as a fifth generator.

## Held-out rate: the pre-registered pairs

First arm's rate over the second's, 95% cluster bootstrap over briefs; ↓ and ↑ mark intervals that exclude 1.

| pair | Haiku 4.5 | Sonnet 5 | Opus 5 | GPT-5-mini | GPT-5 | pooled |
|---|---|---|---|---|---|---|
| rules-run / rules-read | 0.94 [0.76, 1.15] | 0.97 [0.84, 1.10] | 1.02 [0.90, 1.16] | 1.04 [0.94, 1.15] | 1.02 [0.90, 1.16] | 1.01 [0.95, 1.07] |
| rules-run / rules-compiled | 1.07 [0.85, 1.35] | 0.76 [0.67, 0.84] ↓ | 0.74 [0.62, 0.87] ↓ | 0.85 [0.76, 0.94] ↓ | 0.92 [0.82, 1.03] | 0.85 [0.79, 0.92] ↓ |
| rules-run / prose | 0.92 [0.79, 1.09] | 1.03 [0.90, 1.20] | 1.09 [0.94, 1.27] | 1.17 [1.04, 1.32] ↑ | 1.40 [1.21, 1.64] ↑ | 1.17 [1.10, 1.25] ↑ |
| rules-compiled / rules-read | 0.87 [0.70, 1.10] | 1.27 [1.14, 1.45] ↑ | 1.38 [1.22, 1.58] ↑ | 1.23 [1.12, 1.35] ↑ | 1.11 [0.98, 1.26] | 1.19 [1.11, 1.27] ↑ |
| rules-run-primed / rules-run | 1.06 [0.89, 1.27] | 1.00 [0.89, 1.13] | 0.94 [0.82, 1.08] | 0.96 [0.85, 1.08] | 0.96 [0.85, 1.09] | 0.98 [0.92, 1.05] |
| components / rules-run | 0.35 [0.23, 0.48] ↓ | 0.65 [0.50, 0.82] ↓ | 0.98 [0.84, 1.15] | 0.38 [0.33, 0.43] ↓ | 0.41 [0.34, 0.48] ↓ | 0.53 [0.49, 0.57] ↓ |

Each arm against no system (the control):

| arm | Haiku 4.5 | Sonnet 5 | Opus 5 | GPT-5-mini | GPT-5 | pooled |
|---|---|---|---|---|---|---|
| prose | 0.86 ↓ | 0.74 ↓ | 0.47 ↓ | 0.97 | 0.73 ↓ | 0.71 ↓ |
| tokens | 0.85 ↓ | 0.96 | 0.80 ↓ | 1.27 ↑ | 1.13 | 0.98 |
| components | 0.28 ↓ | 0.50 ↓ | 0.50 ↓ | 0.43 ↓ | 0.42 ↓ | 0.44 ↓ |
| rules-read | 0.85 ↓ | 0.79 ↓ | 0.50 ↓ | 1.09 | 1.00 | 0.82 ↓ |
| rules-compiled | 0.74 ↓ | 1.00 | 0.69 ↓ | 1.34 ↑ | 1.11 | 0.97 |
| rules-run | 0.79 ↓ | 0.76 ↓ | 0.51 ↓ | 1.14 ↑ | 1.02 | 0.83 ↓ |
| rules-run-primed | 0.84 | 0.77 ↓ | 0.48 ↓ | 1.09 | 0.98 | 0.81 ↓ |

Intervals for these are in `node eval/tables.mjs`.

## The protocol's model

The protocol specifies `violations ~ arm + (1 | brief) + (1 | model)`, negative binomial, with incidence rate ratios and Holm correction across the pre-registered comparisons; the bootstrap above was the pilot's stand-in for it. Fitted on the held-out violations of all 2,864 scored pages, with log opportunities as the offset (`eval/stats/mixed.R`):

| pair | rate ratio [95% CI] | Holm p | per-rule sensitivity |
|---|---|---|---|
| rules-run / rules-read | 0.96 [0.87, 1.07] | 1 | 0.95 [0.86, 1.05] |
| rules-run / prose | 1.01 [0.91, 1.13] | 1 | 1.02 [0.92, 1.12] |
| rules-run / rules-compiled | 0.78 [0.70, 0.86] | < 0.001 | 0.79 [0.72, 0.87] |
| rules-compiled / rules-read | 1.24 [1.12, 1.38] | < 0.001 | 1.21 [1.10, 1.33] |
| rules-run-primed / rules-run | 0.95 [0.86, 1.06] | 1 | 0.95 [0.87, 1.05] |
| rules-run / none | 0.39 [0.35, 0.44] | < 0.001 | 0.35 [0.31, 0.38] |
| components / rules-run | 0.22 [0.20, 0.25] | < 0.001 | 0.35 [0.31, 0.39] |

The sensitivity fit is per rule per page with a random intercept for the rule. The model agrees with the bootstrap on every pre-registered direction. It finds larger effects against no system and for components, because counts weight rules by how often they apply while the bootstrap's rate weights all ten held-out rules equally; it finds the loop level with prose where the bootstrap finds it slightly worse, which is the one comparison that depends on how rules are weighted.

## What each part of the system does

**The written rules teach, on the strongest Claude model most.** Reading the rules halves Opus's held-out rate (0.50) and cuts Sonnet's by a fifth (0.79) and Haiku's by a sixth (0.85). The loop adds nothing to that on any generator. On the GPT models nothing written in rules form helps: reading the rules leaves GPT-5 where it started (1.00) and GPT-5-mini slightly worse (1.09); the prose guide helps GPT-5 (0.73), and components help both.

**The gate enforces, on every generator.** On the rules it is shown, the loop's rate is 0.22 of reading's pooled (0.14 to 0.30 by generator), 3.3 disclosed violations per hundred elements against 15.1, and 38% of its pages are clean against 2%. It is the only arm with a serious axe-core rate below one per page (0.8).

**Components generalise best.** Shipping the system as components gives the lowest held-out rate on every generator (0.44 of the control pooled) and beats the loop outright on four of five (0.53 pooled; level on Opus). It costs half to two thirds of the loop per page. On Haiku 11% of component pages are truncated at the token cap and excluded, which is a real limit on sending components to a small model.

**The token file brings the palette.** Every arm with the token file holds palette drift to 1.5 to 1.8 ΔE against 12 without it, and repeat generations agree about three times more closely.

## The loop's ablations

Both on Haiku, where the loop is cheapest, on the loop arm alone, thirty-six briefs and two samples each (`eval/results/ablate-*.jsonl`); the full study's Haiku loop (three rounds, full messages) is the reference.

**Repair budget.** The first round does most of the enforcing; more rounds buy clean pages, never held-out conformance.

| repair rounds | held-out rate | disclosed per 100 | clean | rounds used | cost per page |
|---|---|---|---|---|---|
| 0 (rules read, for reference) | 0.215 | 22.65 | 8% | — | $0.036 |
| 1 | 0.183 | 7.32 | 19% | 0.97 | $0.073 |
| 2 | 0.203 | 5.97 | 29% | 1.49 | $0.098 |
| 3 (study) | 0.201 | 6.24 | 32% | 2.01 | $0.128 |
| 5 | 0.221 | 3.19 | 49% | 2.54 | $0.158 |

Held-out ratios against three rounds: 0.91 [0.72, 1.14] for one, 1.01 [0.82, 1.20] for two, 1.10 [0.95, 1.27] for five.

**Feedback richness.** What the loop is told after a failing check: the full message with the offending sample (the study's), the rule id only, or only that the page failed.

| feedback | held-out rate | disclosed per 100 | clean | rounds used | cost per page |
|---|---|---|---|---|---|
| full message | 0.201 | 6.24 | 32% | 2.01 | $0.128 |
| rule id only | 0.207 | 9.97 | 21% | 2.44 | $0.145 |
| exit code only | 0.197 | 16.97 | 3% | 2.88 | $0.158 |

Against full messages, the disclosed rate is 1.60 [1.18, 2.22] times higher with rule ids and 2.72 [1.93, 4.04] times higher with the exit code alone; held-out rates are level (1.03 [0.85, 1.27] and 0.98 [0.80, 1.17]). The error messages are what the gate's enforcement is made of: told only that it failed, a model spends more rounds and fixes little. Nothing about the feedback reaches the rules it does not name.

## Preference: what judges would publish

Share of head-to-head judgements won by the loop (rules-run), ties as half, both judges pooled except where one was excluded. The interval treats judgements as independent; they are clustered by brief, so it is narrower than it should be, and a cell that only just clears 0.50 is not settled.

| Generator | vs none | vs prose | vs rules-read | vs primed | vs components |
|---|---|---|---|---|---|
| Haiku 4.5 | 0.36 (0.31–0.42) | 0.45 (0.40–0.51) | 0.39 (0.34–0.45) | 0.47 (0.42–0.53) | 0.45 (0.39–0.51) |
| Sonnet 5 | 0.43 (0.37–0.49) | 0.69 (0.64–0.74) | 0.48 (0.43–0.54) | 0.45 (0.39–0.50) | 0.66 (0.61–0.72) |
| Opus 5 | 0.35 (0.30–0.41) | 0.48 (0.42–0.53) | 0.52 (0.46–0.58) | 0.51 (0.45–0.56) | 0.39 (0.34–0.45) |
| GPT-5-mini | 0.45 (0.39–0.51) | 0.60 (0.54–0.65) | 0.43 (0.37–0.49) | 0.47 (0.41–0.52) | 0.62 (0.56–0.68) |
| GPT-5 | 0.43 (0.37–0.49) | 0.61 (0.55–0.66) | 0.45 (0.40–0.51) | 0.49 (0.44–0.55) | 0.70 (0.64–0.75) |

All five rounds are valid and the unstyled floor anchor lost in every one. The Sonnet judge was excluded from the GPT-5-mini round (attention 0.72: it preferred the truncated page in five of eighteen checks), so that row is GPT-5-mini's judgements alone. Every other round keeps both judges.

- **H4, enforcement costs appeal, is supported by model judges.** On four of five generators the judges would rather publish the page written with no design system than the loop's (0.35 to 0.43); on GPT-5-mini the interval includes 0.50. The pages the gate makes cleanest are not the pages judges prefer.
- **The loop is preferred to the prose guide on Sonnet and both GPT models** (0.60 to 0.69) and not on Haiku or Opus, the reverse of its held-out conformance on the GPT models.
- **Reading against running the rules is level or favours reading** (0.39 to 0.52); nothing here prefers the loop.
- **P10:** the primed loop is not more conformant (0.98) and not preferred (0.45 to 0.51). The prediction's second half is not met.
- **Conformance and preference agree more on the GPT models.** The rank correlation between an arm's held-out rate and its preference share is 0.37, 0.54, 0.54, 0.94 and 0.94 by generator. Six arms each; descriptive, not a test.

## Cost

Per page at list price, from recorded token usage:

| arm | Haiku 4.5 | Sonnet 5 | Opus 5 |
|---|---|---|---|
| none | $0.023 | $0.075 | $0.334 |
| rules-read | $0.036 | $0.139 | $0.393 |
| components | $0.088 | $0.238 | $0.647 |
| rules-run | $0.128 | $0.421 | $1.381 |

The loop costs three to three and a half times reading on every Claude model (3.6, 3.0, 3.5), almost all of it repair rounds.

## What this means

**For the claim.** The study set out to show that an executable design system beats a written one. On the rules a system did not state, it does not: the loop is level with reading the rules on every generator, in the bootstrap and in the protocol's model, at a precision the pilot could not reach. What the loop adds is enforcement of the rules it checks, reliably and on every model, at three to three and a half times the cost, and the ablations show that enforcement is made of the first repair round and the full error message. Model judges prefer the pages it produces less than pages written with no system at all.

**For the product.** The gate is a conformance guarantee, not a teacher, and should be sold as one: every rule it checks is a rule the output keeps, provided its messages carry the offending sample. One repair round buys most of the guarantee at half the cost of three; more rounds are for clean pages, not better ones. The written rules are where generalisation comes from on Claude models, so they deserve the investment the loop has had. Components are the strongest single intervention on held-out rules and should be the default delivery to models that can carry them; the compiled rules form should not be offered to strong models. None of this licenses a claim that any arm makes pages people prefer; that needs human judges and a ceiling anchor.

## Threats

- **Model judges are a screen, not the guard.** No human has judged and no ceiling anchor exists. The judges are two models, one from each family that generated.
- **Two models from the other family.** GPT-5 and GPT-5-mini differ from the Claude models in direction on several arms, which is why a second family was required, and also why two models cannot speak for their family.
- **Synthetic briefs.** Thirty-six briefs written for the study are not client work.
- **One resumed run.** GPT-5 ran out of disk at 477 cells; the resume dropped the one cell cut off mid-write and generated the rest under the same harness.
- **List prices.** Cost ignores caching and batch discounts; the GPT models' prices are assumed.
- **Ablations on one model.** Both ran on Haiku only, at two samples per cell.
