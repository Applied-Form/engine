#!/usr/bin/env node
/**
 * Run a judging round over a study's pages, with model judges.
 *
 *   node eval/judge-run.mjs eval/runs/pilot/pilot.jsonl --judges haiku-5-5,openrouter:google/gemini-3-pro --out eval/runs/pilot/judging.jsonl
 *   node eval/judge-run.mjs eval/runs/dry/dry.jsonl --judges stub            # offline, proves the round
 *
 * `eval/judge.mjs` fixed the decisions: the pairs, the question, both orders, anchors, attention
 * checks, exclusion, and the pre-registered reading of the correlation. This file is the part that
 * was missing — the thing that puts two screenshots in front of a judge and writes the answer down.
 *
 * What it adds, and why each is built the way it is:
 *
 *   The floor anchor is each brief's strongest page with its styling removed — every `<style>`,
 *   every stylesheet link, every `style=` attribute — so it is the same content and nothing else.
 *   A floor anchor from a different brief would be judged on subject matter.
 *
 *   The ceiling anchor, a page a person designed for the brief, does not exist for these briefs
 *   and is not faked. Its absence is written into the summary.
 *
 *   An attention check is a strongest page truncated at six tenths of its length, against the
 *   intact page, with the intact page expected to win. Checks are interleaved by `buildItems`.
 *   The cut must be one the judge can see: where six tenths falls below the screenshot, the cut
 *   steps back a tenth at a time until the page ends inside it (`visibleCut`).
 *
 *   Screenshots are taken once per page at one width, not full-page, so every judge sees the same
 *   pixels and a long page is not an advantage. The width is recorded.
 *
 *   An answer that is not `a`, `b` or `tie` is recorded with its text and excluded from the count,
 *   never coerced: `summarise()` reads anything that is not `a` or `tie` as `b`, so an unparsed
 *   answer passed through would be a vote for the right-hand page.
 *
 *   Resumable, like the study: an item a judge has already answered is skipped.
 *
 * Model judges are a screen, not the guard. The protocol says human preference is the guard, and
 * that a judge from the generator's own family must never be the only one. This runner enforces
 * the second: it refuses a panel whose every judge shares a route with every generator in the run,
 * unless `--allow-same-family` says the person running it knows.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser } from '../src/lib/page-lint.mjs';
import { buildItems, summarise, QUESTION } from './judge.mjs';
import { harnessFingerprint, fileSafe } from './run.mjs';  // the same tree hash: the items, question, conformance rates, transport and browser all live in it
import { judge, resolveModel, available, routeIdentity } from './providers.mjs';
import { load, summarise as analyse } from './analyse.mjs';


/** Every styling a page carries, removed. What is left is the content a floor anchor is judged on. */
export function unstyle(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi, '')
    .replace(/\sstyle=("[^"]*"|'[^']*')/gi, '');
}

/** Cut at six tenths, mid-whatever. A judge who prefers this is not looking. */
export const truncate = (html, fraction = 0.6) => html.slice(0, Math.floor(html.length * fraction));

/**
 * Write the check page cut deep enough that it ends inside the screenshot, and return the fraction.
 * At six tenths a long page is cut below the fold: the judge is shown two identical images, and
 * "tie" is then the attentive answer, which the check scores as a failure. In the pilot rounds two
 * of six Opus checks were byte-identical, and every tie the Sonnet judge gave was on one of them.
 */
export async function visibleCut(browser, intactFile, cutFile, { width, height }) {
  const html = readFileSync(intactFile, 'utf8');
  const fractions = [0.6, 0.5, 0.4, 0.3, 0.2, 0.1];
  for (const f of fractions) {
    writeFileSync(cutFile, truncate(html, f));
    const page = await browser.newPage({ viewport: { width, height } });
    try {
      await page.goto(pathToFileURL(cutFile).href, { waitUntil: 'load' });
      if (await page.evaluate(() => document.documentElement.scrollHeight) <= height) return f;
    } finally { await page.close(); }
  }
  return fractions.at(-1);
}

/** The one word a judge was asked for, or null. Never coerced. */
export function parseChoice(text) {
  const t = String(text ?? '').trim().toLowerCase().replace(/^["'*\s]+|["'*.\s]+$/g, '');
  if (t === 'a' || t === 'b' || t === 'tie') return t;
  const m = /^(?:answer\s*[:\-]?\s*)?(a|b|tie)\b/.exec(t);
  return m ? m[1] : null;
}

/** Where a record's page is now: as recorded, or beside the JSONL if the run moved as an artifact. */
function locate(record, jsonl) {
  if (record.file && existsSync(record.file)) return record.file;
  const beside = resolve(dirname(jsonl), 'pages', basename(record.file ?? ''));
  return existsSync(beside) ? beside : null;
}

const keyOf = (r) => `${r.brief}|${r.model}|${r.arm}|${r.sample ?? 0}`;

/**
 * Items and the files behind every key, from a study's records. Pure apart from writing the anchor
 * and check pages, so the item set can be built, inspected and pre-registered before any judge runs.
 */
export function prepare(jsonl, { seed = 1, checkEvery = 4 } = {}) {
  const rows = load(jsonl);
  const files = new Map();
  const usable = [];
  let missing = 0;
  for (const r of rows) {
    if (r.failed) continue;
    const f = locate(r, jsonl);
    if (!f) { missing += 1; continue; }
    files.set(keyOf(r), f);
    usable.push({ ...r, file: f });
  }
  const dir = resolve(dirname(jsonl), 'judging');
  mkdirSync(dir, { recursive: true });

  // One floor anchor per group, and a truncated check for every `checkEvery`th group. Idempotent,
  // because buildItems is called twice: the first call discovers the groups and their checks, the
  // second places the checks between the items.
  const checks = new Map();
  const anchors = ({ brief, model, sample, strongest }) => {
    const g = `${brief}|${model}|${sample}`;
    const html = readFileSync(strongest.file, 'utf8');
    const floor = resolve(dir, `${brief}-${fileSafe(model)}-s${sample}-floor.html`);
    if (!files.has(floor)) { writeFileSync(floor, unstyle(html)); files.set(floor, floor); }
    if (!checks.has(g)) {
      if (checks.size % checkEvery === 0) {
        const cut = resolve(dir, `${brief}-${fileSafe(model)}-s${sample}-truncated.html`);
        writeFileSync(cut, truncate(html));
        files.set(cut, cut);
        checks.set(g, { key: cut, against: keyOf(strongest) });
      } else checks.set(g, null);
    }
    return [{ kind: 'floor', key: floor }];
  };
  buildItems(usable, { seed, anchors });
  const broken = [...checks.values()].filter(Boolean);
  const items = buildItems(usable, { seed, anchors, broken });
  return { rows, usable, missing, items, files, conformance: Object.fromEntries(analyse(usable).perArm.map((a) => [a.arm, a.rate])) };
}

/** The route every generator in the run used, so a same-family panel can be refused. */
function generatorRoutes(rows) {
  return new Set(rows.filter((r) => !r.failed).map((r) => r.route ?? resolveModel(r.model).route));
}

export async function judgeRound(jsonl, { judges, out, seed = 1, width = 1280, height = 1600, allowSameFamily = false, browser, log = () => {} }) {
  // One vote per judge per item: a repeated key would pay twice and count twice, then count once
  // on a resume.
  judges = [...new Set(judges)];
  const prepared = prepare(jsonl, { seed });
  // A record whose page is gone cannot be judged. Said aloud, because a round over part of a run
  // reads like a round over all of it.
  if (prepared.missing) console.error(`${prepared.missing} usable record(s) have no page beside ${jsonl}; they are not judged.`);
  const { items, files, conformance } = prepared;
  if (!items.length) throw new Error('no items: the run has no usable pages, or no brief has two arms to compare');

  const judgeRoutes = new Set(judges.map((j) => resolveModel(j).route));
  const gens = generatorRoutes(prepared.usable);
  const same = [...judgeRoutes].every((r) => gens.has(r)) && judgeRoutes.size > 0 && !judgeRoutes.has('stub');
  if (same && !allowSameFamily) throw new Error(`every judge (${[...judgeRoutes].join(', ')}) shares a family with the generators (${[...gens].join(', ')}); add a judge from another family, or pass --allow-same-family`);

  // Before the round's identity is taken, because the check pages are part of it. Deterministic, so
  // a resumed attempt rewrites the same files and arrives at the same round.
  if (browser) {
    const cuts = new Map();
    for (const item of items.filter((i) => i.kind === 'check')) {
      const [cut, intact] = item.left.endsWith('-truncated.html') ? [item.left, item.right] : [item.right, item.left];
      if (!cuts.has(cut)) cuts.set(cut, await visibleCut(browser, files.get(intact), files.get(cut), { width, height }));
    }
    if (cuts.size) log(`attention checks cut at ${[...cuts.values()].join(', ')} of their length, so each ends on screen`);
  }

  // A round resumes from its own record only under the panel that started it, exactly. Every row in
  // the file is counted, so a judge dropped from the panel would still vote, and a judge added after
  // seeing part of the round would change the panel once its results were in view.
  // The same holds for the round itself: its question, its items, anchors and checks, the judge
  // transport, and the seed that orders them. Answers from two of those are two rounds.
  const panel = [...new Set(judges)].sort().join(',');
  // And the generation record it judges, and the browser that draws it: a round started on part of
  // a run and resumed on more of it would reuse answers for anchors cut from different pages.
  // The record names pages by path, so the pages themselves are hashed too: a page replaced in place
  // between attempts would otherwise be judged from two different files under one round.
  const inputHash = createHash('sha256').update(readFileSync(jsonl));
  for (const [key, file] of [...files].sort(([a], [b]) => a.localeCompare(b))) inputHash.update(key).update('\0').update(readFileSync(file)).update('\0');
  const input = inputHash.digest('hex').slice(0, 16);
  const outputs = [out, resolve(dirname(jsonl), 'judging'), out?.replace(/\.jsonl$/, '.json')].filter(Boolean);
  const round = `${harnessFingerprint('.', undefined, { outputs })}:${routeIdentity(judges)}:${input}:${browser ? browser.version() : 'no-browser'}:seed${seed}:${width}x${height}`;
  const done = new Set();
  if (out && existsSync(out)) {
    const rows = readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const before = [...new Set(rows.map((r) => r.panel ?? 'unrecorded'))];
    if (before.some((p) => p !== panel)) throw new Error(`${out} was judged by the panel ${before.join(' / ')}, and this one is ${panel}; judge with the same panel, or write to a new --out`);
    const rounds = [...new Set(rows.map((r) => r.round ?? 'unrecorded'))];
    if (rounds.some((r) => r !== round)) throw new Error(`${out} was judged under round ${rounds.join(' / ')}, and this one is ${round} (the code, the generation record, the browser, a judge's endpoint, the viewport or the seed changed); write to a new --out`);
    for (const j of rows) done.add(`${j.item}|${j.judge}`);
  }

  const shots = new Map();
  const shoot = async (key) => {
    if (shots.has(key)) return shots.get(key);
    const page = await browser.newPage({ viewport: { width, height } });
    try {
      await page.goto(pathToFileURL(files.get(key)).href, { waitUntil: 'load' });
      const png = await page.screenshot({ type: 'png', fullPage: false });
      shots.set(key, png);
      return png;
    } finally { await page.close(); }
  };

  const judgements = [];
  let unparsed = 0;
  for (const item of items) {
    for (const j of judges) {
      if (done.has(`${item.id}|${j}`)) continue;
      const [left, right] = await Promise.all([shoot(item.left), shoot(item.right)]);
      let rec;
      try {
        const r = await judge([left, right], QUESTION, j);
        const choice = parseChoice(r.text);
        if (choice === null) unparsed += 1;
        rec = { item: item.id, judge: j, panel, round, route: r.route, id: r.id, choice, raw: r.text.slice(0, 200), usage: r.usage, ms: r.ms, at: new Date().toISOString() };
      } catch (e) {
        rec = { item: item.id, judge: j, panel, round, choice: null, error: String(e.message ?? e), at: new Date().toISOString() };
      }
      judgements.push(rec);
      if (out) appendFileSync(out, JSON.stringify(rec) + '\n');
      log(`${item.kind.padEnd(6)} ${item.id}  ${j} → ${rec.choice ?? `? (${rec.error ?? rec.raw})`}`);
    }
  }
  if (out) for (const line of readFileSync(out, 'utf8').split('\n').filter(Boolean)) { const j = JSON.parse(line); if (!judgements.some((x) => x.item === j.item && x.judge === j.judge)) judgements.push(j); }

  const counted = judgements.filter((j) => j.choice !== null);
  const summary = summarise(items, counted, { conformance });
  return {
    ...summary,
    items: items.length,
    judgements: judgements.length,
    unparsed: judgements.length - counted.length,
    screenshot: { width, height, fullPage: false },
    ceilingAnchor: 'absent: no human-designed page exists for these briefs, so the ceiling check did not run',
    judges: { ...summary.judges, routes: [...judgeRoutes], generatorRoutes: [...gens], sameFamilyOnly: same },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
  const jsonl = argv.find((a) => !a.startsWith('--') && a.endsWith('.jsonl'));
  const judges = (opt('judges', '') ?? '').split(',').filter(Boolean);
  if (!jsonl || !judges.length) { console.error('usage: node eval/judge-run.mjs run.jsonl --judges model[,model] [--out judging.jsonl] [--seed 1] [--allow-same-family]'); process.exit(2); }
  const out = opt('out', resolve(dirname(jsonl), 'judging.jsonl'));
  const have = available(judges);
  const missing = judges.filter((j) => !have[j]);
  if (missing.length) { console.error(`No credentials for judges: ${missing.join(', ')}`); process.exit(2); }
  const browser = await launchBrowser();
  try {
    const summary = await judgeRound(jsonl, { judges, out, seed: Number(opt('seed', 1)), allowSameFamily: argv.includes('--allow-same-family'), browser, log: console.log });
    const file = out.replace(/\.jsonl$/, '.json');
    writeFileSync(file, JSON.stringify(summary, null, 2) + '\n');
    console.log(`\nvalid: ${summary.valid}  floor anchor lost: ${summary.floorAnchorLost}  judges kept: ${summary.judges.kept.length}, excluded: ${summary.judges.excluded.length}`);
    for (const a of summary.arms) console.log(`  ${a.arm.padEnd(18)} wins ${String(a.wins).padStart(6)}  share ${a.share}`);
    console.log(`  ${summary.conformanceVsPreference.reading}`);
    console.log(`Summary in ${file}.`);
  } finally { await browser.close(); }
}
