# Study results: the gate enforces, the rules teach, the loop teaches nothing more

@eyebrow Document type · Results · Register II

The full study the evaluation protocol commits to has run: four generators from two families, eight arms, thirty-six briefs, two samples each, 2,304 pages, and a blind preference round over every one of them. This document reads it against the hypotheses in `docs/evaluation-protocol.md` and against the pilot (`docs/pilot-results.md`), including where it contradicts both. The protocol's reporting rule applies: negative and mixed results are published with the positive ones.

:::provenance
Subject · the model study, full stage · `eval/` at main `1813109` (thirty-six briefs, amendment of 2026-10-10)
Records · `eval/results/full-haiku-4-5.jsonl`, `full-sonnet-5.jsonl`, `full-opus-5.jsonl`, `full-gpt-5-mini.jsonl`, 576 records each
Runs · Evaluation workflow runs 38058545172, 38058562902, 38058580258, 38058595673, 2026-10-10, eight cells at a time, none resumed
Judging · `eval/results/full-*.judging.jsonl` and `.json`, round `3e7a86dd`, panel `azure:gpt-5-mini,sonnet-5-5`
Tables · `node eval/tables.mjs eval/results/full-*.jsonl`, seeded, so every number below reruns exactly
Cost · about $525 at list price for the Claude generators (Haiku 4.5 $35, Sonnet 5 $123, Opus 5 $368, from the per-page table below); GPT-5-mini about $17 at an assumed $0.25 / $2.00 per million tokens
:::

## The answer

The comparison the study exists for is the repair loop (F) against the same rules read once (E). On the rules no arm was told about, the held-out rate, there is no difference: pooled across all four generators the loop's rate is 1.02 of reading's (95% interval 0.95 to 1.09), and across the three Claude models 0.99 (0.89 to 1.08), against 0.98 (0.88 to 1.11) in the pilot. Three times the briefs gave the same answer, with an interval a sixth narrower on the same three models and two fifths narrower with the fourth generator pooled. H2 is not supported, and now with enough precision that an effect of more than about ten per cent in either direction is unlikely.

The loop does beat the compiled rules, 0.85 (0.78 to 0.92), for the reason the pilot found: compiling the rules to twenty statements makes them worse than the full text (1.21, 1.14 to 1.28) on every generator but Haiku. Against the prose guide the loop is level on the Claude models (1.02, 0.93 to 1.12) and worse on GPT-5-mini (1.17, 1.04 to 1.32).

What the loop does, it does on every generator: on the rules it is shown, it leaves 0.23 of what reading leaves (0.17 to 0.30), and a third of its pages carry no disclosed violation at all, against 2% for any other arm. That is the gate's guarantee, and it is circular by design: it scores what it enforced.

## What was run

| | |
|---|---|
| Generators | Haiku 4.5, Sonnet 5, Opus 5 (Anthropic); GPT-5-mini (Azure OpenAI) |
| Arms | none, prose, tokens, components, rules-read, rules-compiled, rules-run, rules-run-primed |
| Briefs | Thirty-six, three in each of twelve strata of register, density and chart (`eval/briefs.json`); b01–b12 are the pilot's, generated afresh |
| Samples | Two per cell, 576 pages per generator |
| Repair rounds | Up to three for the loop arms |
| Judges | `azure:gpt-5-mini` and `sonnet-5-5`, attention floor 0.8, checks cut where the judge can see them (amendment of 2026-10-10) |

GPT-5-mini stands in for the pre-registered GPT-5, which had no real-time quota on the account. It is a smaller model and is read as one.

## Held-out rate: the pre-registered pairs

First arm's rate over the second's, 95% cluster bootstrap over briefs; ↓ and ↑ mark intervals that exclude 1.

| pair | Haiku 4.5 | Sonnet 5 | Opus 5 | GPT-5-mini | pooled |
|---|---|---|---|---|---|
| rules-run / rules-read | 0.94 [0.76, 1.15] | 0.97 [0.84, 1.10] | 1.02 [0.90, 1.16] | 1.04 [0.94, 1.15] | 1.02 [0.95, 1.09] |
| rules-run / rules-compiled | 1.07 [0.85, 1.35] | 0.76 [0.67, 0.84] ↓ | 0.74 [0.62, 0.87] ↓ | 0.85 [0.76, 0.94] ↓ | 0.85 [0.78, 0.92] ↓ |
| rules-run / prose | 0.92 [0.79, 1.09] | 1.03 [0.90, 1.20] | 1.09 [0.94, 1.27] | 1.17 [1.04, 1.32] ↑ | 1.09 [1.02, 1.17] ↑ |
| rules-compiled / rules-read | 0.87 [0.70, 1.10] | 1.27 [1.14, 1.45] ↑ | 1.38 [1.22, 1.58] ↑ | 1.23 [1.12, 1.35] ↑ | 1.21 [1.14, 1.28] ↑ |
| rules-run-primed / rules-run | 1.06 [0.89, 1.27] | 1.00 [0.89, 1.13] | 0.94 [0.82, 1.08] | 0.96 [0.85, 1.08] | 0.98 [0.91, 1.05] |
| components / rules-run | 0.35 [0.23, 0.48] ↓ | 0.65 [0.50, 0.82] ↓ | 0.98 [0.84, 1.15] | 0.38 [0.33, 0.43] ↓ | 0.58 [0.53, 0.64] ↓ |

Each arm against no system (the control):

| arm | Haiku 4.5 | Sonnet 5 | Opus 5 | GPT-5-mini | pooled |
|---|---|---|---|---|---|
| prose | 0.86 ↓ | 0.74 ↓ | 0.47 ↓ | 0.97 | 0.71 ↓ |
| tokens | 0.85 ↓ | 0.96 | 0.80 ↓ | 1.27 ↑ | 0.93 |
| components | 0.28 ↓ | 0.50 ↓ | 0.50 ↓ | 0.43 ↓ | 0.45 ↓ |
| rules-read | 0.85 ↓ | 0.79 ↓ | 0.50 ↓ | 1.09 | 0.76 ↓ |
| rules-compiled | 0.74 ↓ | 1.00 | 0.69 ↓ | 1.34 ↑ | 0.91 ↓ |
| rules-run | 0.79 ↓ | 0.76 ↓ | 0.51 ↓ | 1.14 ↑ | 0.77 ↓ |
| rules-run-primed | 0.84 | 0.77 ↓ | 0.48 ↓ | 1.09 | 0.75 ↓ |

Intervals for these are in `node eval/tables.mjs`.

## What each part of the system does

**The written rules teach, on the strongest model most.** Reading the rules halves Opus's held-out rate (0.50) and cuts Sonnet's by a fifth (0.79) and Haiku's by a sixth (0.85). The loop adds nothing to that on any generator. On GPT-5-mini nothing written helps: no prose, token or rules arm lowers its held-out rate, and the token file, the compiled rules and the loop raise it; only components lower it.

**The gate enforces, on every generator.** On the rules it is shown, the loop's rate is 0.23 of reading's pooled (0.14 to 0.30 by generator), 3.6 disclosed violations per hundred elements against 15.7, and 32% of its pages are clean against 2%. It is the only arm with a serious axe-core rate below one per page (0.8).

**Components generalise best.** Shipping the system as components gives the lowest held-out rate on every generator (0.45 of the control pooled) and beats the loop outright on three of four (0.58 pooled; level on Opus). It costs half to two thirds of the loop per page. On Haiku 11% of component pages are truncated at the token cap and excluded, which is a real limit on sending components to a small model.

**The token file brings the palette.** Every arm with the token file holds palette drift to 1.6 to 1.8 ΔE against 12 without it, and repeat generations agree about three times more closely.

## Preference: what judges would publish

Share of head-to-head judgements won by the loop (rules-run), ties as half, both judges pooled except where one was excluded. The interval treats judgements as independent; they are clustered by brief, so it is narrower than it should be, and a cell that only just clears 0.50 is not settled.

| Generator | vs none | vs prose | vs rules-read | vs primed | vs components |
|---|---|---|---|---|---|
| Haiku 4.5 | 0.36 (0.31–0.42) | 0.45 (0.40–0.51) | 0.39 (0.34–0.45) | 0.47 (0.42–0.53) | 0.45 (0.39–0.51) |
| Sonnet 5 | 0.43 (0.37–0.49) | 0.69 (0.64–0.74) | 0.48 (0.43–0.54) | 0.45 (0.39–0.50) | 0.66 (0.61–0.72) |
| Opus 5 | 0.35 (0.30–0.41) | 0.48 (0.42–0.53) | 0.52 (0.46–0.58) | 0.51 (0.45–0.56) | 0.39 (0.34–0.45) |
| GPT-5-mini | 0.45 (0.39–0.51) | 0.60 (0.54–0.65) | 0.43 (0.37–0.49) | 0.47 (0.41–0.52) | 0.62 (0.56–0.68) |

All four rounds are valid and the unstyled floor anchor lost in every one. The Sonnet judge was excluded from the GPT-5-mini round (attention 0.72: it preferred the truncated page in five of eighteen checks), so that row is GPT-5-mini's judgements alone. Every other round keeps both judges.

- **H4, enforcement costs appeal, is supported by model judges.** On three of four generators the judges would rather publish the page written with no design system than the loop's (0.35 to 0.43); on GPT-5-mini the interval includes 0.50. The pages the gate makes cleanest are not the pages judges prefer.
- **The loop is preferred to the prose guide on Sonnet and GPT-5-mini** (0.69, 0.60) and not on Haiku or Opus.
- **Reading against running the rules is level or favours reading** (0.39 to 0.52); nothing here prefers the loop.
- **P10:** the primed loop is not more conformant (0.98) and not preferred (0.45 to 0.51). The prediction's second half is not met.
- **Conformance and preference agree more at this size.** The rank correlation between an arm's held-out rate and its preference share is 0.37, 0.54, 0.54 and 0.94 by generator. Six arms each; descriptive, not a test.

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

**For the claim.** The study set out to show that an executable design system beats a written one. On the rules a system did not state, it does not: the loop is level with reading the rules on every generator, at a precision the pilot could not reach. What the loop adds is enforcement of the rules it checks, reliably and on every model, at three to three and a half times the cost. Model judges prefer the pages it produces less than pages written with no system at all.

**For the product.** The gate is a conformance guarantee, not a teacher, and should be sold as one: every rule it checks is a rule the output keeps. The written rules are where generalisation comes from, so they deserve the investment the loop has had. Components are the strongest single intervention on held-out rules and should be the default delivery to models that can carry them; the compiled rules form should not be offered to strong models. None of this licenses a claim that any arm makes pages people prefer; that needs human judges and a ceiling anchor.

## Threats

- **Model judges are a screen, not the guard.** No human has judged and no ceiling anchor exists. The judges are two models, one from each family that generated.
- **One other family, and a smaller model.** GPT-5-mini stands in for GPT-5. Its results differ from the Claude models' in direction on several arms, which is the reason a second family was required, and also the reason one model cannot speak for its family.
- **Synthetic briefs.** Thirty-six briefs written for the study are not client work.
- **List prices.** Cost ignores caching and batch discounts; GPT-5-mini's price is assumed.
- **The mixed-effects model the protocol specifies has not been fitted.** Intervals are a cluster bootstrap over briefs, which is honest about clustering by brief and not about clustering by generator.
