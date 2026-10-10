/**
 * What a design system actually is, inferred from what a site actually renders.
 *
 * This is the measuring half of the ingestion pipeline (stage B),
 * and it is deliberately the half that needs no language model. A model is required to turn a
 * written guideline into rules; nothing is required to find out that a site renders forty-seven
 * greys where six would do. That second question is answerable by arithmetic, it is the one a
 * client can be shown an answer to on day one, and it is the strongest possible input to
 * everything after it.
 *
 * Three ideas carry the whole file.
 *
 * **Weight, not distinct count.** A colour used once in a footer and a colour used on every page
 * are not equally part of a system. Every input here is `{ value, weight }`, where weight is
 * area for a ground, characters for text, occurrences for a gap. Counting distinct values gives
 * the long tail a vote it has not earned.
 *
 * **A token is a value the site actually uses.** The cluster seed is its heaviest member, never
 * a computed centroid. A palette whose tokens appear nowhere on the site is a recommendation;
 * this is meant to be a measurement, and a client has to be able to point at the pixel.
 *
 * **The near-misses are the finding.** A value close enough to a token that no one could see the
 * difference is not a second token, it is a mistake — and the count of those is usually the most
 * persuasive number in the report, because it is waste with no design intent behind it at all.
 *
 * Every function is pure and takes plain arrays, so the interesting behaviour is unit-tested
 * without a browser anywhere near it.
 */
import { srgbToLab, deltaE, nearest, JND } from './lab.mjs';

/** Samples arrive from a browser survey, so they arrive dirty. One place to make them uniform. */
function clean(samples, valid = () => true) {
  const out = [];
  for (const s of samples ?? []) {
    const value = s?.value;
    const weight = Number(s?.weight);
    if (value === undefined || value === null) continue;
    if (!Number.isFinite(weight) || weight <= 0) continue;
    if (!valid(value)) continue;
    out.push({ value, weight });
  }
  return out;
}

const totalWeight = (rows) => rows.reduce((sum, r) => sum + r.weight, 0);
const share = (part, whole) => (whole > 0 ? part / whole : 0);
const round = (n, places = 2) => (Number.isFinite(n) ? Number(n.toFixed(places)) : null);

/**
 * The smallest palette that accounts for most of the colour on the page.
 *
 * Greedy weighted set cover in Lab: take the heaviest colour nobody has explained yet, call it a
 * token, and let it claim everything within `tolerance` of itself. Repeat until the target share
 * of weight is explained or the budget runs out.
 *
 * Greedy rather than k-means because the question is not "what are the k natural clusters" — it
 * is "how few values would have sufficed", which is a covering problem, and because greedy gives
 * a deterministic answer with no seeding and no run-to-run variation. A report a client cannot
 * reproduce is not evidence.
 *
 * One limitation, because it changes how a finding should be read. The seed is the heaviest
 * member of its cluster, so where a mistyped colour is used more heavily than the correct one,
 * the report names the mistake as the token and the correct colour as the near-miss. The pair is
 * still identified, which is the actionable half — these two are one colour and one of them
 * should go — but nothing here can know which was intended. Only the client knows that, and the
 * report should not pretend otherwise by presenting the heavier value as the right one.
 *
 * The stopping rule is a floor on significance, not a target for cumulative coverage. Stopping
 * once some share of the weight is explained sounds reasonable and is badly wrong here: a page
 * is mostly its background, so the first token alone clears 95% and the loop halts having found
 * the paper and nothing else. An accent is a rounding error by area and the most important
 * colour in the brand. So tokens are taken until the heaviest remaining colour is too slight to
 * be a decision — everything below the floor is the tail, by definition.
 */
export function inferPalette(samples, { tolerance = JND, minShare = 0.005, maxTokens = 12 } = {}) {
  const rows = clean(samples, (v) => srgbToLab(v) !== null);
  const total = totalWeight(rows);
  if (!total) return { tokens: [], coverage: 0, distinct: 0, sprawl: null, nearMisses: [], tail: [], drift: null };

  // Collapse identical hexes first: two thousand samples of #FFFFFF are one colour with a big weight.
  const byHex = new Map();
  for (const { value, weight } of rows) {
    const hex = value.toUpperCase();
    byHex.set(hex, (byHex.get(hex) ?? 0) + weight);
  }
  const distinct = [...byHex].map(([value, weight]) => ({ value, weight })).sort((a, b) => b.weight - a.weight);

  const tokens = [];
  const claimed = new Set();
  while (tokens.length < maxTokens) {
    const seed = distinct.find((d) => !claimed.has(d.value));
    if (!seed) break;
    const members = distinct.filter((d) => !claimed.has(d.value) && (deltaE(d.value, seed.value) ?? Infinity) <= tolerance);
    // The seed is the heaviest colour left, so once its cluster is too slight to matter, every
    // cluster after it is lighter still. That is the tail.
    if (share(totalWeight(members), total) < minShare) break;
    for (const m of members) claimed.add(m.value);
    tokens.push({ value: seed.value, weight: totalWeight(members), members: members.length });
  }

  const palette = tokens.map((t) => t.value);
  const covered = tokens.reduce((sum, t) => sum + t.weight, 0);
  const tail = distinct.filter((d) => !claimed.has(d.value));

  // A near-miss is a value a token already claimed that is not that token. Nobody chose it: it is
  // a hand-typed hex, a copied swatch, an opacity applied to the wrong layer. This is the waste.
  const nearMisses = distinct
    .filter((d) => claimed.has(d.value) && !palette.includes(d.value))
    .map((d) => {
      const near = nearest(d.value, palette);
      return { value: d.value, weight: d.weight, nearestToken: near.hex, distance: round(near.distance, 2) };
    })
    .sort((a, b) => b.weight - a.weight);

  const offDistances = tail.map((d) => nearest(d.value, palette)?.distance).filter(Number.isFinite);

  return {
    tokens: tokens.map((t) => ({ ...t, weight: round(t.weight, 2), share: round(share(t.weight, total), 4) })),
    coverage: round(share(covered, total), 4),
    distinct: distinct.length,
    sprawl: tokens.length ? round(distinct.length / tokens.length, 2) : null,
    nearMisses,
    tail: tail.map((d) => ({ ...d, weight: round(d.weight, 2) })),
    drift: offDistances.length ? round(offDistances.reduce((a, b) => a + b, 0) / offDistances.length, 2) : null,
  };
}

/**
 * The largest step that explains a set of measurements — a spacing base unit, in practice.
 *
 * The obvious formulation, "the step with the smallest residual", is degenerate: a step of 1px
 * explains every integer perfectly and tells you nothing. So the test is inverted. Ask what share
 * of the weight each candidate step explains to within a tolerance, and take the *largest* step
 * that clears the target. An 8px system reports 8 rather than 1, 2 or 4, because all four explain
 * the values and only one of them is the decision somebody made.
 */
export function inferStep(samples, { candidates = null, tolerance = 0.5, target = 0.9, minStep = 4 } = {}) {
  const rows = clean(samples, (v) => Number.isFinite(Number(v)) && Number(v) > 0)
    .map(({ value, weight }) => ({ value: Number(value), weight }));
  const total = totalWeight(rows);
  if (!total) return { step: null, coverage: 0, offScale: [], residual: null, considered: [], fine: [] };

  const score = (step) => {
    const off = (v) => Math.min(v % step, step - (v % step));
    const explained = rows.filter((r) => off(r.value) <= tolerance);
    return { step, coverage: share(totalWeight(explained), total) };
  };
  // A step below 4px is never named. Almost every integer a browser renders is even, so 2px clears
  // the target on nearly any site and says nothing: the first survey of nine public systems named
  // it for five of them. The fine steps are still scored and returned as `fine`, so a report can
  // say what 2px would have explained without calling it a system.
  const steps = (candidates ?? Array.from({ length: 23 }, (_, i) => i + 2)).filter((s) => s >= minStep);
  const scored = steps.map(score);
  const fine = (candidates ?? [2, 3]).filter((s) => s < minStep).map(score).map((s) => ({ step: s.step, coverage: round(s.coverage, 4) }));
  if (!scored.length) return { step: null, coverage: 0, offScale: [], residual: null, considered: [], fine };

  const clears = scored.filter((s) => s.coverage >= target);
  // Nothing clears the bar when a site has no spacing system at all. Report the best candidate and
  // its coverage rather than null, so the report can say "closest thing to a unit is 4px, and it
  // explains 61%" — which is a finding, where a null is a shrug.
  // Ties break toward the larger step in both branches. Without that, a site that clears nothing
  // reports the smallest candidate purely because it was scored first, which contradicts the rule
  // the cleared branch follows and reads as a 2px system on a site that has an 8px one.
  const pick = (rows) => rows.reduce((a, b) => (b.step > a.step ? b : a));
  const bestCoverage = Math.max(...scored.map((s) => s.coverage));
  const best = clears.length ? pick(clears) : pick(scored.filter((s) => s.coverage === bestCoverage));

  const off = (v) => Math.min(v % best.step, best.step - (v % best.step));
  // Grouped by value, not listed per sample: a 13px margin appearing on four pages is one
  // off-scale value used four times, and reporting it four times overstates the sprawl.
  const offBy = new Map();
  for (const r of rows) {
    if (off(r.value) <= tolerance) continue;
    offBy.set(r.value, (offBy.get(r.value) ?? 0) + r.weight);
  }
  const offScale = [...offBy]
    .map(([value, weight]) => ({ value, weight: round(weight, 2), off: round(off(value), 2) }))
    .sort((a, b) => b.weight - a.weight);
  const residuals = rows.map((r) => off(r.value) * r.weight);

  return {
    step: best.step,
    coverage: round(best.coverage, 4),
    onScale: clears.length > 0,
    residual: round(residuals.reduce((a, b) => a + b, 0) / total, 3),
    offScale,
    considered: scored.map((s) => ({ step: s.step, coverage: round(s.coverage, 4) })),
    fine,
  };
}

/**
 * Distinct numeric values, merged within a tolerance and ranked by weight. Used for the type
 * scale, radii and border widths — anywhere the question is "how many different values are in
 * play, and are any of them accidents".
 *
 * `minShare` marks a value that carries so little of the page it is more likely a mistake than a
 * step. It is flagged rather than dropped, because deciding it is an accident is the client's
 * call, and a measurement that quietly discards its own inconvenient rows is not a measurement.
 */
export function clusterNumeric(samples, { tolerance = 0.5, minShare = 0.01 } = {}) {
  const rows = clean(samples, (v) => Number.isFinite(Number(v)))
    .map(({ value, weight }) => ({ value: Number(value), weight }));
  const total = totalWeight(rows);
  if (!total) return { values: [], distinct: 0, incidental: [] };

  const byValue = new Map();
  for (const { value, weight } of rows) byValue.set(value, (byValue.get(value) ?? 0) + weight);
  const sorted = [...byValue].map(([value, weight]) => ({ value, weight })).sort((a, b) => b.weight - a.weight);

  const clusters = [];
  for (const row of sorted) {
    const hit = clusters.find((c) => Math.abs(c.value - row.value) <= tolerance);
    if (hit) { hit.weight += row.weight; hit.members += 1; } else clusters.push({ ...row, members: 1 });
  }
  clusters.sort((a, b) => a.value - b.value);

  const values = clusters.map((c) => ({ value: c.value, weight: round(c.weight, 2), share: round(share(c.weight, total), 4), members: c.members }));
  return {
    values,
    distinct: byValue.size,
    incidental: values.filter((v) => v.share < minShare),
  };
}

/**
 * The ratio between consecutive steps of a type scale, if there is one.
 *
 * Reported as the median of the ratios rather than a fitted exponent, because a real scale is
 * usually a clean ratio with two or three sizes hand-adjusted, and a fit is dragged around by
 * exactly those. The spread is returned beside it so the report can say "a 1.25 scale with three
 * exceptions" instead of asserting a ratio the sizes do not actually follow.
 */
export function scaleRatio(values) {
  const sizes = [...new Set(values.map(Number).filter((v) => Number.isFinite(v) && v > 0))].sort((a, b) => a - b);
  if (sizes.length < 3) return { ratio: null, spread: null, steps: sizes.length };
  const ratios = sizes.slice(1).map((v, i) => v / sizes[i]);
  const mid = [...ratios].sort((a, b) => a - b);
  const median = mid.length % 2 ? mid[(mid.length - 1) / 2] : (mid[mid.length / 2 - 1] + mid[mid.length / 2]) / 2;
  return { ratio: round(median, 3), spread: round(Math.max(...ratios) - Math.min(...ratios), 3), steps: sizes.length };
}

/**
 * A property a system may simply not use. Applied Form treats an absence as a decision rather
 * than a gap (`absent` in the token file), and a survey has to be able to report the same thing:
 * a site with no rounded corners anywhere has made a choice, and saying "0 radius tokens" would
 * describe it as missing something.
 */
export function inferAbsence(samples, { tolerance = 0.5 } = {}) {
  const used = clean(samples, (v) => Number.isFinite(Number(v)))
    .map(({ value, weight }) => ({ value: Number(value), weight }))
    .filter((r) => Math.abs(r.value) > tolerance);
  if (!used.length) return { absent: true, scale: [], distinct: 0 };
  const { values, distinct } = clusterNumeric(used, { tolerance });
  return { absent: false, scale: values, distinct };
}
