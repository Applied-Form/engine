#!/usr/bin/env node
/**
 * The pilot's tables, from committed records, so every number in docs/pilot-results.md can be rerun.
 *
 *   node eval/tables.mjs eval/results/pilot-haiku-4-5.jsonl eval/results/pilot-sonnet-5.jsonl eval/results/pilot-opus-5.jsonl
 *
 * `analyse.mjs` reports one run. This sets runs side by side and adds the measure the analysis
 * leaves out: violations of the *disclosed* rules, the ones arm F's loop is shown. That number is
 * circular by construction (the gate scores what the gate enforced), so it says what the gate
 * guarantees and nothing about whether the system generalises; the held-out rate says that. Both
 * are printed, beside the third-party instrument (axe-core) and the cost, so neither is read alone.
 *
 * Every interval is a 95% cluster bootstrap over briefs with a fixed seed: the same records give
 * the same table.
 */
import { pathToFileURL } from 'node:url';
import { load, rateRatio, scoreable } from './analyse.mjs';

export const ARMS = ['none', 'prose', 'tokens', 'components', 'rules-read', 'rules-compiled', 'rules-run', 'rules-run-primed'];

/** List prices per million tokens (input, output), as of the pilot. Cost is reported, never scored. */
export const PRICE = { 'haiku-4-5': [1, 5], 'sonnet-5': [2, 10], 'opus-5': [5, 25] };

const mulberry = (seed) => () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Disclosed-rule violations per 100 rendered elements. */
export function disclosedPer100(rows) {
  const v = rows.reduce((s, r) => s + r.disclosed, 0);
  const e = rows.reduce((s, r) => s + (r.opportunity?.elements ?? 0), 0);
  return e ? (100 * v) / e : null;
}

/** Ratio of disclosed rates, first arm over second, with a brief-cluster bootstrap interval. */
export function disclosedRatio(rows, a, b, { iterations = 2000, seed = 7 } = {}) {
  const usable = rows.filter((r) => !r.failed && Number.isFinite(r.disclosed));
  const briefs = [...new Set(usable.map((r) => r.brief))].sort();
  const of = (rs, arm) => disclosedPer100(rs.filter((r) => r.arm === arm));
  const pa = of(usable, a), pb = of(usable, b);
  if (pa == null || !pb) return null;   // an arm the run did not include, or one with no usable page
  const rng = mulberry(seed), draws = [];
  for (let i = 0; i < iterations; i++) {
    const sample = briefs.map(() => briefs[Math.floor(rng() * briefs.length)]).flatMap((x) => usable.filter((r) => r.brief === x));
    const da = of(sample, a), db = of(sample, b);
    if (da != null && db) draws.push(da / db);
  }
  if (!draws.length) return null;
  draws.sort((x, y) => x - y);
  const at = (q) => draws[Math.min(draws.length - 1, Math.floor(q * draws.length))];
  return { ratio: pa / pb, lo: at(0.025), hi: at(0.975) };
}

const fmt = (rr) => (rr ? `${rr.ratio.toFixed(2)} [${rr.lo.toFixed(2)}, ${rr.hi.toFixed(2)}]${rr.hi < 1 ? ' ↓' : rr.lo > 1 ? ' ↑' : ''}` : '—');
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export function tables(rows) {
  const models = [...new Set(rows.map((r) => r.model))];
  const by = (m) => rows.filter((r) => r.model === m);
  const cols = [...models, 'pooled'];
  const sets = [...models.map(by), rows];
  const out = [];
  const table = (title, head, body) => out.push(`\n### ${title}\n`, `| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...body.map((r) => `| ${r.join(' | ')} |`));

  table('Held-out rate, each arm against the control (ratio, 95% CI; ↓ excludes 1)', ['arm', ...cols],
    ARMS.slice(1).map((a) => [a, ...sets.map((s) => fmt(rateRatio(s, a, 'none', { iterations: 2000 })))]));
  // In the protocol's order: F against the compiled rules is the comparison the study exists for
  // (amendment of 2026-09-04), then P2, P3, P9's other half, P10, and the component arm.
  table('Held-out rate, the pre-registered pairs (first arm over second)', ['pair', ...cols],
    [['rules-run', 'rules-compiled'], ['rules-run', 'prose'], ['rules-run', 'rules-read'], ['rules-compiled', 'rules-read'], ['rules-run-primed', 'rules-run'], ['components', 'rules-run']]
      .map(([a, b]) => [`${a} / ${b}`, ...sets.map((s) => fmt(rateRatio(s, a, b, { iterations: 2000 })))]));
  table('Disclosed-rule violations per 100 elements (what the gate enforces; circular by design)', ['arm', ...cols],
    ARMS.map((a) => [a, ...sets.map((s) => disclosedPer100(s.filter((r) => r.arm === a && !r.failed && Number.isFinite(r.disclosed)))?.toFixed(2) ?? '—')]));
  table('Disclosed-rule rate, the loop against each alternative', ['pair', ...cols],
    [['rules-run', 'rules-compiled'], ['rules-run', 'rules-read'], ['rules-run', 'prose'], ['rules-run', 'none']].map(([a, b]) => [`${a} / ${b}`, ...sets.map((s) => fmt(disclosedRatio(s, a, b)))]));
  table('Pages with no disclosed violation; axe-core violations per page (pooled)', ['arm', 'clean on disclosed', 'axe', 'axe serious'],
    ARMS.map((a) => {
      const rs = rows.filter((r) => r.arm === a && !r.failed);
      return [a, `${Math.round((100 * rs.filter((r) => r.disclosed === 0).length) / (rs.length || 1))}%`, mean(rs.map((r) => r.axe?.count ?? 0))?.toFixed(1), mean(rs.map((r) => r.axe?.serious ?? 0))?.toFixed(1)];
    }));
  table('Palette drift (mean ΔE to the nearest study colour) and its spread between repeat generations', ['arm', ...cols.map((c) => `${c} drift`), 'pooled SD within cell'],
    ARMS.map((a) => {
      const ok = scoreable(rows.filter((r) => r.arm === a));
      const drift = sets.map((s) => mean(scoreable(s.filter((r) => r.arm === a)).map((r) => r.drift?.palette).filter(Number.isFinite))?.toFixed(2) ?? '—');
      const cells = new Map();
      for (const r of ok) if (Number.isFinite(r.drift?.palette)) { const k = `${r.brief}|${r.model}`; cells.set(k, [...(cells.get(k) ?? []), r.drift.palette]); }
      const sds = [...cells.values()].filter((xs) => xs.length > 1).map((xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); });
      return [a, ...drift, mean(sds)?.toFixed(2) ?? '—'];
    }));
  table('Cost per page at list price, US dollars', ['arm', ...models],
    ARMS.map((a) => [a, ...models.map((m) => {
      const rs = by(m).filter((r) => r.arm === a && r.usage), p = PRICE[m];
      return p && rs.length ? `$${(rs.reduce((s, r) => s + r.usage.input * p[0] + r.usage.output * p[1], 0) / 1e6 / rs.length).toFixed(3)}` : '—';
    })]));
  table('Failures (excluded from every rate, never counted clean)', ['arm', ...models],
    ARMS.map((a) => [a, ...models.map((m) => { const rs = by(m).filter((r) => r.arm === a); const f = rs.filter((r) => r.failed); return f.length ? `${f.length}/${rs.length} ${[...new Set(f.map((r) => r.failure))].join(', ')}` : `0/${rs.length}`; })]));
  return out.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: node eval/tables.mjs run.jsonl [run.jsonl …]'); process.exit(2); }
  console.log(tables(files.flatMap((f) => load(f))));
}
