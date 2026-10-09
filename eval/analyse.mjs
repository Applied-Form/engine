#!/usr/bin/env node
/**
 * Analysis.
 *
 *   node eval/analyse.mjs eval/runs/pilot.jsonl [--json]
 *
 * The protocol calls for a negative-binomial mixed model with random intercepts for brief and
 * model. That is not something to reimplement badly in JavaScript, so this script does not pretend
 * to: it reports a cluster bootstrap over briefs, which is non-parametric, honest about its
 * assumptions, and adequate for sizing an effect in a pilot. The JSONL is the input to the real
 * model, run in R or Python, for anything published.
 *
 * Bootstrapping over *briefs* rather than over pages is the part that matters. Pages from the same
 * brief are not independent — a brief that invites a chart invites the same problems from every
 * arm — and resampling pages would understate the intervals, in our favour.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BOOTSTRAP = 2000;

/**
 * Load every record, failures included.
 *
 * Dropping them here would be a survivorship bias pointing the wrong way: a model that cannot
 * produce a working page would simply vanish from its own denominator and look better for it. The
 * failure rate is reported per arm, and only then are failed pages excluded from the violation
 * rates — where they cannot be scored meaningfully anyway.
 */
export function load(file) {
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export const scoreable = (rows) => rows.filter((r) => !r.failed && Number.isFinite(r.universal));

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sd = (xs) => {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

/**
 * The primary metric: the mean, over scoreable rules, of each rule's pooled violation rate.
 *
 * Pooled per rule (Σ violations / Σ opportunities across pages), then averaged over rules, so that:
 * every rule counts equally rather than the three per-element rules swamping the per-link ones; a
 * page that offered no chance to break a rule contributes to neither side of that rule, so an arm
 * cannot win the link rules by emitting no links; and tiny pages do not over-weight the way a mean
 * of per-page rates would. A rule no page in the set could break is left out of the mean.
 */
export function pooledRate(rows) {
  const sums = {};
  for (const r of rows) {
    for (const [rule, { v, o }] of Object.entries(r.perRule ?? {})) {
      sums[rule] ??= { v: 0, o: 0 };
      sums[rule].v += v; sums[rule].o += o;
    }
  }
  const rates = Object.values(sums).filter((x) => x.o > 0).map((x) => x.v / x.o);
  return rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
}

function resampleBriefs(rows, rng) {
  // Sorted, so a seeded draw names the same briefs however the records were ordered; cells run
  // concurrently append in the order models answer.
  const briefs = [...new Set(rows.map((r) => r.brief))].sort();
  const picked = briefs.map(() => briefs[Math.floor(rng() * briefs.length)]);
  const byBrief = new Map();
  for (const r of rows) {
    if (!byBrief.has(r.brief)) byBrief.set(r.brief, []);
    byBrief.get(r.brief).push(r);
  }
  return picked.flatMap((b) => byBrief.get(b) ?? []);
}

const mulberry = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Rate ratio between two arms with a percentile bootstrap CI. <1 means `arm` beats `reference`. */
export function rateRatio(rows, arm, reference, { iterations = BOOTSTRAP, seed = 42 } = {}) {
  const a = scoreable(rows).filter((r) => r.arm === arm);
  const b = scoreable(rows).filter((r) => r.arm === reference);
  if (!a.length || !b.length) return null;
  const pa = pooledRate(a), pb = pooledRate(b);
  // Same guard as the bootstrap loop: a reference arm with no rate, or a rate of zero, has no ratio.
  if (pa === null || pb === null || pb === 0) return { arm, reference, ratio: null, lo: null, hi: null, n: { [arm]: a.length, [reference]: b.length }, note: 'reference arm has no violations to compare against' };
  const point = pa / pb;

  const rng = mulberry(seed);
  const draws = [];
  for (let i = 0; i < iterations; i++) {
    const sample = scoreable(resampleBriefs(rows, rng));
    const ra = pooledRate(sample.filter((r) => r.arm === arm));
    const rb = pooledRate(sample.filter((r) => r.arm === reference));
    if (ra !== null && rb !== null && rb > 0) draws.push(ra / rb);
  }
  draws.sort((x, y) => x - y);
  const at = (q) => draws[Math.min(draws.length - 1, Math.max(0, Math.floor(q * draws.length)))];
  return { arm, reference, ratio: point, lo: at(0.025), hi: at(0.975), n: { [arm]: a.length, [reference]: b.length } };
}

/**
 * H3: consistency. For each brief and arm, how much do independent generations differ from each
 * other? Reported as the mean within-cell standard deviation. A design system's actual promise is
 * that this number is small, which is not the same claim as any one page being good.
 */
export function consistency(rows, field = (r) => r.drift?.palette) {
  const cells = new Map();
  for (const r of rows) {
    const k = `${r.brief}|${r.arm}|${r.model}`;
    const v = field(r);
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(v);
  }
  const byArm = new Map();
  for (const [k, vs] of cells) {
    const arm = k.split('|')[1];
    const s = sd(vs);
    if (s === null) continue;
    if (!byArm.has(arm)) byArm.set(arm, []);
    byArm.get(arm).push(s);
  }
  return Object.fromEntries([...byArm].map(([arm, ss]) => [arm, { withinCellSd: mean(ss), cells: ss.length }]));
}

export function summarise(rows) {
  const arms = [...new Set(rows.map((r) => r.arm))];
  const models = [...new Set(rows.map((r) => r.model))];

  const perArm = arms.map((arm) => {
    const all = rows.filter((r) => r.arm === arm);
    const a = scoreable(all);
    return {
      arm, pages: a.length, attempted: all.length,
      failed: all.length - a.length,
      failureRate: all.length ? (all.length - a.length) / all.length : null,
      failures: [...new Set(all.filter((r) => r.failed).map((r) => r.failure))].sort(),
      universalPerPage: mean(a.map((r) => r.universal)),
      rate: pooledRate(a),
      styling: { declarations: mean(a.map((r) => r.styling?.declarations).filter(Number.isFinite)), fonts: mean(a.map((r) => r.styling?.fonts).filter(Number.isFinite)) },
      clean: a.length ? a.filter((r) => r.universal === 0).length / a.length : null,
      axe: mean(a.map((r) => r.axe?.count ?? 0)),
      axeSerious: mean(a.map((r) => r.axe?.serious ?? 0)),
      paletteDrift: mean(a.map((r) => r.drift?.palette).filter(Number.isFinite)),
      spacingDrift: mean(a.map((r) => r.drift?.spacing).filter(Number.isFinite)),
      outputTokens: mean(a.map((r) => r.usage?.output ?? 0)),
      totalTokens: mean(a.map((r) => (r.usage?.input ?? 0) + (r.usage?.output ?? 0))),
      repairRounds: mean(a.map((r) => r.rounds ?? 0)),
    };
  });

  // The gap by model tier: we predict it is widest on the weakest model.
  const byModel = models.map((model) => {
    const m = rows.filter((r) => r.model === model);
    return {
      model,
      arms: Object.fromEntries(arms.map((arm) => [arm, pooledRate(scoreable(m.filter((r) => r.arm === arm)))])),
    };
  });

  return {
    pages: rows.length, arms, models,
    perArm,
    byModel,
    primary: {
      'prose → rules-run': rateRatio(rows, 'rules-run', 'prose'),
      'rules-read → rules-run': rateRatio(rows, 'rules-run', 'rules-read'),
      'none → rules-run': rateRatio(rows, 'rules-run', 'none'),
      'none → prose': rateRatio(rows, 'prose', 'none'),
    },
    // Over usable pages only, like every other measure here: a truncated page's drift is a
    // measurement of a page nobody would ship, and it would count against an arm's consistency.
    consistency: { palette: consistency(scoreable(rows)), spacing: consistency(scoreable(rows), (r) => r.drift?.spacing) },
  };
}

export function toText(s) {
  const pct = (x) => (x === null || x === undefined ? '—' : (x * 100).toFixed(0) + '%');
  const num = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(d));
  const out = [`${s.pages} records · ${s.arms.length} arms · ${s.models.length} models`, ''];
  out.push('arm           pages    failed  viol/pg     rate   clean    axe  palette  spacing  cssdecl   tokens  rounds');
  for (const a of s.perArm) {
    out.push(`${a.arm.padEnd(13)}${String(a.pages).padStart(5)}${(a.failed ? `${a.failed} (${pct(a.failureRate)})` : '0').padStart(10)}${num(a.universalPerPage).padStart(9)}${num(a.rate, 3).padStart(9)}${pct(a.clean).padStart(8)}${num(a.axe, 1).padStart(7)}${num(a.paletteDrift).padStart(9)}${num(a.spacingDrift).padStart(9)}${String(Math.round(a.styling?.declarations ?? 0)).padStart(9)}${String(Math.round(a.totalTokens)).padStart(9)}${num(a.repairRounds, 1).padStart(8)}`);
  }
  out.push('', 'rate = mean over scoreable rules of (violations / opportunities). cssdecl = CSS declarations per page: a');
  out.push('low rate with near-zero cssdecl is an unstyled page, which passes most rules by default and designed nothing.');
  const anyFailed = s.perArm.some((a) => a.failed > 0);
  if (anyFailed) {
    out.push('', 'Failures are excluded from the rates above and reported here, because a page that could not');
    out.push('be produced must not be counted as a clean one:');
    for (const a of s.perArm.filter((x) => x.failed > 0)) out.push(`  ${a.arm.padEnd(13)} ${a.failed}/${a.attempted}  ${a.failures.join(', ')}`);
  }
  out.push('', 'Rate ratios (<1 favours the first-named arm; 95% cluster-bootstrap CI over briefs):');
  for (const [label, rr] of Object.entries(s.primary)) {
    if (!rr) { out.push(`  ${label}: no data`); continue; }
    if (rr.ratio === null) { out.push(`  ${label.padEnd(26)} — (${rr.note})`); continue; }
    const verdict = rr.hi < 1 ? 'lower, CI excludes 1' : rr.lo > 1 ? 'HIGHER, CI excludes 1' : 'CI includes 1 — not distinguishable';
    out.push(`  ${label.padEnd(26)} ${num(rr.ratio)}  [${num(rr.lo)}, ${num(rr.hi)}]  ${verdict}`);
  }
  out.push('', 'Consistency — within-cell SD of palette drift across repeat generations (lower is more consistent):');
  for (const [arm, c] of Object.entries(s.consistency.palette)) out.push(`  ${arm.padEnd(13)} ${num(c.withinCellSd)}  (${c.cells} cells)`);
  out.push('', 'Rate by model tier:');
  for (const m of s.byModel) out.push(`  ${m.model.padEnd(14)}${s.arms.map((a) => `${a}=${num(m.arms[a])}`).join('  ')}`);
  return out.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node eval/analyse.mjs <run.jsonl> [--json]'); process.exit(2); }
  const s = summarise(load(file));
  console.log(process.argv.includes('--json') ? JSON.stringify(s, null, 2) : toText(s));
}
