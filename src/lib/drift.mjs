/**
 * The Drift Report: what a site's design system actually is, and how far the site is from it.
 *
 * This is the deliverable the ingestion assessment identified as sellable on its own — the
 * stopping point after measurement and before rule induction, which is the one stage that needs
 * a language model. Nothing in this file calls one. An organisation can be handed the answer to
 * "what is our system, really" without any model having an opinion about it, and that answer is
 * arithmetic over values their own browser rendered.
 *
 * Four numbers, in the order they persuade.
 *
 * **Size.** How many values it takes to describe the site. Usually far smaller than anyone
 * expects, which is the good news and the reason the rest lands.
 *
 * **Coverage.** What share of the rendered page those values explain. High coverage on a small
 * palette is a disciplined system; the same coverage needing forty tokens is not a system.
 *
 * **Sprawl.** Distinct values divided by tokens. The multiple by which the site carries more
 * values than it uses.
 *
 * **Waste.** Values close enough to a token that nobody could see the difference. Unlike the
 * other three this needs no interpretation and admits no defence: it is not a design decision,
 * because no one decided it. It is the number to open with.
 *
 * Every finding carries the measurement that produced it. A report that says "your colour use is
 * inconsistent" is an opinion; one that says "seventeen greys sit within a just-noticeable
 * difference of #6B6B6B, together covering 4% of the page" is a fact somebody can act on.
 */
import { inferPalette, inferStep, clusterNumeric, scaleRatio, inferAbsence } from './infer.mjs';
import { JND, deltaE, srgbToLab } from './lab.mjs';

/**
 * Above this CIE Lab chroma a colour is chromatic. Whites, greys and blacks sit below it, and
 * every published palette contains them, so they match any palette (decision 0024).
 */
export const CHROMA = 10;
const chroma = (hex) => { const lab = srgbToLab(hex); return lab ? Math.hypot(lab[1], lab[2]) : 0; };

const pct = (n) => (n === null || n === undefined ? null : Math.round(n * 1000) / 10);

/**
 * One palette across text, grounds and borders rather than three.
 *
 * A design system has a palette; text and background are roles played by colours in it, not
 * separate inventories. Inferring them separately would report the same grey twice and make the
 * sprawl number look better than the site deserves. The roles are recovered afterwards, so the
 * report can still say which tokens are ever set as text.
 *
 * The three roles are normalised to equal totals before they are pooled, and this is not a
 * detail. Ground weight is area and text weight is characters: a single full-page background
 * arrives as roughly eleven thousand units against a few hundred for every word on the page.
 * Pooled raw, the paper is the palette and nothing else clears the floor — the first run of this
 * reported one token, #FFFFFF, at 96%, and found no accent at all. Normalising makes the roles
 * commensurable, so the question becomes "which colours matter within their own role", which is
 * the question a palette answers. Borders count half: they are real, and there are far fewer of
 * them than there are words or pixels of ground.
 */
const ROLE_WEIGHT = { textColor: 1, ground: 1, borderColor: 0.5 };

function palette(merged, options) {
  const all = [];
  for (const [role, factor] of Object.entries(ROLE_WEIGHT)) {
    const rows = merged[role] ?? [];
    const roleTotal = rows.reduce((sum, r) => sum + (Number(r.weight) || 0), 0);
    if (roleTotal <= 0) continue;
    for (const r of rows) all.push({ value: r.value, weight: (Number(r.weight) || 0) * (factor / roleTotal) });
  }
  const inferred = inferPalette(all, options);
  const roleOf = (bucket) => new Set((merged[bucket] ?? []).map((s) => String(s.value).toUpperCase()));
  const [asText, asGround, asBorder] = [roleOf('textColor'), roleOf('ground'), roleOf('borderColor')];
  return {
    ...inferred,
    tokens: inferred.tokens.map((t) => ({
      ...t,
      roles: [asText.has(t.value) && 'text', asGround.has(t.value) && 'ground', asBorder.has(t.value) && 'border'].filter(Boolean),
    })),
  };
}

/**
 * Build the report from a merged survey.
 *
 * `declared` is optional: a palette the organisation publishes. When it is supplied the report
 * also answers the question the ingestion assessment says comes up in every engagement — whether
 * the guideline and the site agree. They will not. That disagreement is the finding, not noise,
 * so it is measured rather than resolved in either direction.
 */
export function driftReport(merged, { tolerance = JND, maxTokens = 12, declared = null } = {}) {
  const colour = palette(merged, { tolerance, maxTokens });
  const spacing = inferStep(merged.spacing);
  const type = clusterNumeric(merged.fontSize, { tolerance: 0.5 });
  const ratio = scaleRatio(type.values.map((v) => v.value));
  const families = clusterFamilies(merged.fontFamily);
  const leading = clusterNumeric(merged.lineHeight, { tolerance: 0.02 });
  const radius = inferAbsence(merged.radius);
  const borders = clusterNumeric(merged.borderWidth, { tolerance: 0.25 });
  const shadow = clusterFamilies(merged.shadow);

  const tokenCount = colour.tokens.length + (spacing.step ? 1 : 0) + type.values.length + families.values.length;
  const distinctCount = colour.distinct + new Set((merged.spacing ?? []).map((s) => s.value)).size + type.distinct + families.distinct;

  // Both sides of this ratio have to be in the normalised units the palette was inferred in.
  // Dividing a normalised near-miss weight by the raw survey total reported 0% waste on a page
  // that demonstrably had two near-misses, which is a wrong number rather than a missing one.
  const wasteWeight = colour.nearMisses.reduce((s, n) => s + n.weight, 0);
  const colourWeight = colour.tokens.reduce((s, t) => s + t.weight, 0) + colour.tail.reduce((s, t) => s + t.weight, 0);

  const report = {
    measured: {
      pages: merged.pages ?? null,
      elements: merged.elements ?? 0,
      textElements: merged.textElements ?? 0,
    },
    system: { colour, spacing, type: { ...type, ratio }, families, leading, radius, borders, shadow },
    numbers: {
      size: tokenCount,
      coverage: pct(colour.coverage),
      spacingCoverage: pct(spacing.coverage),
      sprawl: tokenCount ? Math.round((distinctCount / tokenCount) * 10) / 10 : null,
      wasteValues: colour.nearMisses.length,
      wasteShare: pct(colourWeight ? wasteWeight / colourWeight : 0),
    },
    findings: [],
  };

  if (declared) report.declared = adherence(colour, declared, tolerance);
  report.findings = findings(report, declared);
  return report;
}

/** Font families and shadows are strings, so they cluster by identity rather than by distance. */
function clusterFamilies(samples) {
  const byValue = new Map();
  let total = 0;
  for (const { value, weight } of samples ?? []) {
    if (!value || !Number.isFinite(weight)) continue;
    byValue.set(value, (byValue.get(value) ?? 0) + weight);
    total += weight;
  }
  const values = [...byValue].map(([value, weight]) => ({ value, weight: Math.round(weight * 100) / 100, share: pct(weight / total) }))
    .sort((a, b) => b.weight - a.weight);
  return { values, distinct: byValue.size };
}

/**
 * How far the site is from the palette the organisation publishes.
 *
 * Reported in both directions on purpose. Tokens that are declared but never rendered are as much
 * a finding as colours that are rendered but never declared — the first says the guideline
 * describes a system nobody built, the second says the site outgrew its guideline, and they call
 * for opposite responses.
 */
function adherence(colour, declared, tolerance) {
  const used = colour.tokens.map((t) => t.value);
  const declaredUpper = declared.map((d) => String(d).toUpperCase());
  const isDeclared = (t) => declaredUpper.some((d) => sameColour(t.value, d, tolerance));
  const share = (tokens) => {
    const all = tokens.reduce((s, t) => s + t.weight, 0);
    return all ? pct(tokens.filter(isDeclared).reduce((s, t) => s + t.weight, 0) / all) : null;
  };
  const undeclared = colour.tokens.filter((t) => !isDeclared(t));
  const unused = declaredUpper.filter((d) => !used.some((u) => sameColour(u, d, tolerance)));
  // The same score on the chromatic tokens alone. The whole-palette figure is dominated by the
  // neutrals every palette shares, and matched the wrong palette at 46 to 80% across nine
  // flagship sites; on chromatic colours the wrong palettes matched at 0 to 18% (decision 0024).
  const chromatic = colour.tokens.filter((t) => chroma(t.value) > CHROMA);
  return {
    adherence: share(colour.tokens) ?? 0,
    undeclared: undeclared.map((t) => ({ value: t.value, share: t.share })),
    unused,
    chromatic: {
      adherence: share(chromatic),
      tokens: chromatic.length,
      undeclared: chromatic.filter((t) => !isDeclared(t)).map((t) => ({ value: t.value, share: t.share })),
    },
  };
}

function sameColour(a, b, tolerance) {
  const d = deltaE(a, b);
  return d !== null && d <= tolerance;
}

/** "an 8px step", "a 4px step" — read aloud, 8, 11 and 18 take "an". */
const article = (n) => (/^(8|11|18)/.test(String(n)) ? 'an' : 'a');

/** "1 colour sits", "3 colours sit": the sentences are the deliverable, so they agree in number. */
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** A share that rounds to nothing is still a share: waste that exists is never reported as 0%. */
const shareText = (p) => (p < 0.1 ? 'under 0.1' : String(p));

/** The report in sentences, each carrying the measurement that produced it. */
function findings(report, declared) {
  const out = [];
  const { colour, spacing, type, families, radius, shadow } = report.system;
  const n = report.numbers;

  if (colour.tokens.length) {
    out.push(`${count(colour.distinct, 'distinct colour renders', 'distinct colours render')} across the pages surveyed. ${colour.tokens.length} of them ${colour.tokens.length === 1 ? 'accounts' : 'account'} for ${n.coverage}% of the colour on the page.`);
  }
  if (colour.nearMisses.length) {
    const worst = colour.nearMisses[0];
    out.push(`${count(colour.nearMisses.length, 'colour sits', 'colours sit')} within a just-noticeable difference of a colour already in use and cannot be told apart by eye — together ${shareText(n.wasteShare)}% of the colour on the page. The heaviest is ${worst.value}, which is ${worst.distance} from ${worst.nearestToken}.`);
  }
  if (spacing.step) {
    // A 2px step is not named as a system: nearly every rendered integer is even, so it would clear
    // the target almost anywhere. When nothing coarser clears, what 2px would have explained is
    // stated so the reader can see that the fine step is the only one the site has.
    const fine = (spacing.fine ?? []).find((f) => f.step === 2);
    const fineText = fine ? ` A 2px step would explain ${pct(fine.coverage)}%, which is not a spacing system.` : '';
    out.push(spacing.onScale
      ? `Spacing follows ${article(spacing.step)} ${spacing.step}px step, which explains ${n.spacingCoverage}% of the margins, padding and gaps measured.`
      : `Spacing follows no consistent step. The closest candidate is ${spacing.step}px and it explains only ${n.spacingCoverage}%.${fineText}`);
  }
  if (spacing.offScale.length) {
    out.push(`${count(spacing.offScale.length, 'spacing value sits', 'spacing values sit')} off that step, the most frequent being ${spacing.offScale[0].value}px, which is ${spacing.offScale[0].off}px from the nearest multiple.`);
  }
  if (type.values.length) {
    const ratioText = type.ratio.ratio ? ` The sizes sit on roughly a ${type.ratio.ratio} ratio.` : '';
    out.push(`${count(type.distinct, 'distinct font size is', 'distinct font sizes are')} in use across ${count(type.values.length, 'step', 'steps')}.${ratioText}`);
  }
  if (type.incidental.length) {
    out.push(type.incidental.length === 1
      ? '1 of those sizes carries under 1% of the text, which is the signature of a one-off rather than a step.'
      : `${type.incidental.length} of those sizes carry under 1% of the text each, which is the signature of a one-off rather than a step.`);
  }
  if (families.values.length > 3) {
    out.push(`${families.values.length} font families render on the page, where a system normally has two or three.`);
  }
  out.push(radius.absent
    ? `None of the ${report.measured.elements} rendered elements has a corner radius. That is a decision, and a system built from this site should record it as one rather than leave it unstated.`
    : `${count(radius.distinct, 'corner radius is', 'corner radii are')} in use, clustering into ${count(radius.scale.length, 'step', 'steps')}.`);
  if (shadow.values.length) {
    // The remark about an elevation scale is a comparison, so it is made only when there is
    // something to compare: one or two shadows are inside the usual range.
    out.push(`${count(shadow.values.length, 'distinct shadow is', 'distinct shadows are')} in use.${shadow.values.length > 3 ? ' An elevation scale usually has two or three.' : ''}`);
  }
  if (declared && report.declared) {
    const d = report.declared, c = d.chromatic;
    out.push(c.adherence === null
      ? `Against the declared palette, ${d.adherence}% of the colour on the page matches. No chromatic colour renders, so the match rests on neutrals that any palette contains.`
      : `Against the declared palette, ${d.adherence}% of the colour on the page matches; on the ${count(c.tokens, 'chromatic colour', 'chromatic colours')}, which palettes do not share the way they share neutrals, ${c.adherence}% does.`);
  }
  return out;
}
