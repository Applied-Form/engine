#!/usr/bin/env node
/**
 * Run the study: every brief × arm × model × sample, scored and appended to a JSONL file.
 *
 *   node eval/run.mjs --out eval/runs/pilot.jsonl --models opus-5,sonnet-5,haiku-4-5 --samples 2
 *   node eval/run.mjs --models haiku-4-5 --briefs b01,b07 --samples 1   # a scoped shakedown
 *   --concurrency 4    cells generated at once (default 4); changes the wall clock, not the measure
 *
 * Resumable: a cell already present in the output file is skipped, so an interrupted run continues
 * where it stopped rather than paying twice.
 *
 * THE RULE THAT KEEPS THE STUDY HONEST: arm F's repair loop is shown disclosed-rule failures only.
 * If the loop reported withheld violations, arm F would be optimising directly against the metric
 * it is scored on, and the held-out split — the whole defence against circularity — would be gone.
 * `disclosedOnly()` below is that filter, and it is the single most load-bearing line in the file.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { launchBrowser, lintPages } from '../src/lib/page-lint.mjs';
import { ARMS, REPAIR_ARMS, promptFor, repairPrompt } from './arms.mjs';
import { generate, resolveModel, available, extractHtml, routeIdentity } from './providers.mjs';
import { score, paletteFrom, normalise } from './score.mjs';
import { partition } from './split.mjs';

const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

const ASSETS = {
  tokenFile: 'eval/fixtures/meridian.merged.tokens.json',
  componentsCss: 'dist/components.css',
  tokensCss: 'dist/tokens.css',
};
const MAX_REPAIRS = Number(opt('repairs', 3));

/** The filter that preserves the holdout. Arm F never learns what it is being scored on. */
const disclosedOnly = (violations) => partition(violations).disclosed;

/**
 * Why a page is unusable, or null if it is fine.
 *
 * A page the model could not finish is a result, not an absence. Truncation and unclosed markup
 * both shrink a page, and a smaller page offers fewer chances to break a rule — measured on the
 * flaky stub, 15 of 19 failed pages scored zero violations, which is a perfect score. They are
 * labelled and excluded from the rates rather than dropped or counted as clean.
 *
 * Refusal is tested before completeness: a refusal is a sentence with no markup, so a completeness
 * test catches it first and files it as broken HTML. Knowing whether a model would not do the task
 * or could not finish it are different diagnoses.
 */
export function classifyFailure({ stop, html }) {
  if (stop === 'refusal') return 'refused';
  if (stop === 'max_tokens' || stop === 'length' || stop === 'MAX_TOKENS') return 'truncated';
  if (!/<\/html\s*>/i.test(html) || !/<body/i.test(html)) return 'incomplete-html';
  return null;
}

const cellKey = (b, arm, model, sample) => `${b}|${arm}|${model}|${sample}`;

/**
 * What the experiment is, as one hash: every file of the code and data that could reach a page or
 * its score — the harness, the study system and the base tokens it is merged over, the gate, the
 * build scripts and the fonts they declare, the lockfile — and none of what a run writes or what only describes it. The
 * protocol's staging rule says data collected before a change and after it are not the same
 * experiment, so a run resumes only on the tree that started it.
 *
 * Whole directories rather than a list of files: a list was reviewed eight times and each review
 * found an input it had missed. A change to an unrelated build script now refuses a resume too,
 * which costs a new run name and never mixes two experiments.
 */
export const GENERATION = ['eval', 'fonts', 'package-lock.json', 'package.json', 'scripts', 'src', 'tokens'];
const NOT_THE_EXPERIMENT = [/^eval\/(results|runs|drift)(\/|$)/, /(^|\/)judging(\/|$)/, /(^|\/)pages(\/|$)/, /\.md$/i];

export function harnessFingerprint(root = '.', paths = GENERATION, { outputs = [] } = {}) {
  // What this run writes, wherever --out put it: a file the first invocation had not yet created
  // would otherwise change the hash under the resume that follows it.
  const skip = outputs.map((o) => resolve(o));
  const files = [];
  const walk = (p) => {
    if (NOT_THE_EXPERIMENT.some((re) => re.test(p.split('\\').join('/')))) return;
    const abs = join(root, p);
    if (skip.includes(resolve(abs))) return;
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) for (const e of readdirSync(abs).sort()) walk(join(p, e));
    else files.push(p);
  };
  for (const p of paths) walk(p);
  const h = createHash('sha256');
  for (const f of files) h.update(f.split('\\').join('/')).update('\0').update(readFileSync(join(root, f))).update('\0');
  return h.digest('hex').slice(0, 16);
}

async function generatePage(brief, arm, model, sample, browser, pageDir) {
  const messages = [{ role: 'user', content: promptFor(brief, arm, ASSETS) }];
  const usage = { input: 0, output: 0 };
  let rounds = 0, out, html, file;
  const { route, id } = resolveModel(model);

  for (;;) {
    out = await generate(messages, model);
    usage.input += out.usage.input; usage.output += out.usage.output;
    const extracted = extractHtml(out.text);
    html = normalise(extracted.html, brief.register).html;
    // The sample is in the name: two samples of one cell run at once, and one sharing a file would
    // overwrite the other's page between its write and its lint.
    file = resolve(pageDir, `${brief.id}-${arm}-${model}-s${sample}-r${rounds}.html`);
    writeFileSync(file, html);

    if (!REPAIR_ARMS.has(arm) || rounds >= MAX_REPAIRS) break;

    const [lint] = await lintPages([pathToFileURL(file).href], { viewports: [1280], browser });
    // Arm G is told what the page is for in every round; arm F is told only what is wrong. That
    // difference is the measurement, so it is the only thing that differs between them.
    const intent = arm === 'rules-run-primed' ? brief.brief : null;
    const feedback = repairPrompt(disclosedOnly(lint.violations), opt('richness', 'full'), intent);
    if (!feedback) break;                       // clean on the disclosed rules: the loop is done
    messages.push({ role: 'assistant', content: out.text }, { role: 'user', content: feedback });
    rounds += 1;
  }
  const failure = classifyFailure({ stop: out.stop, html });
  return { file, html, usage, rounds, stop: out.stop, fenced: extractHtml(out.text).fenced, failure, route, id };
}

/**
 * The gate has to measure the system the model was given. The linter reads its system at import
 * time from AF_BRAND, so a run that did not set it linted every page against Applied Form's own
 * tokens while the model held Meridian's: the repair loop told a model holding one palette to use
 * another, and the components arm was handed CSS built from the wrong one. The run now re-launches
 * itself under the study system, and builds that system's CSS before any arm reads it.
 */
const STUDY = resolve(ASSETS.tokenFile);

async function main() {
  if (process.env.AF_BRAND !== STUDY) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...argv], { stdio: 'inherit', env: { ...process.env, AF_BRAND: STUDY } });
    return r.status ?? 1;
  }
  const outFile = opt('out', 'eval/runs/pilot.jsonl');
  // De-duplicated: a repeated selector would make two cells with one key and one page file, and run
  // them at once.
  const models = [...new Set((opt('models', 'opus-5,sonnet-5,haiku-4-5') ?? '').split(',').filter(Boolean))];
  const samples = Number(opt('samples', 2));
  const arms = [...new Set((opt('arms', ARMS.join(',')) ?? '').split(',').filter(Boolean))];
  const only = [...new Set((opt('briefs', '') ?? '').split(',').filter(Boolean))];
  const all = JSON.parse(readFileSync('eval/briefs.json', 'utf8')).briefs;
  const briefs = only.length ? all.filter((b) => only.includes(b.id)) : all;
  if (!briefs.length) { console.error(`no briefs matched: ${only.join(',')}`); return 2; }
  // Checked here, not clamped. NaN concurrency starts no worker and NaN samples make no cells, and
  // a run that does nothing must not exit 0; NaN repairs never reaches its cap, so the loop is paid
  // for until the runner stops it.
  const concurrency = Number(opt('concurrency', 4));
  for (const [name, value, least] of [['concurrency', concurrency, 1], ['samples', samples, 1], ['repairs', MAX_REPAIRS, 0]]) {
    if (!Number.isInteger(value) || value < least) {
      console.error(`--${name} must be a whole number, ${least} or more: ${opt(name)}`); return 2;
    }
  }

  // Resolve before anything is paid for: an unknown key or a route with no credential stops the
  // run here rather than three hundred calls in.
  for (const m of models) { try { resolveModel(m); } catch (e) { console.error(e.message); return 2; } }
  const have = available(models);
  const missing = models.filter((m) => !have[m]);
  if (missing.length) {
    console.error(`No credentials for: ${missing.join(', ')}.`);
    console.error('Set the key for that route (ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY, AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT, GOOGLE_API_KEY), or pass --models with only the ones you have.');
    return 2;
  }

  mkdirSync(dirname(resolve(outFile)), { recursive: true });
  const pageDir = resolve(dirname(resolve(outFile)), 'pages');
  mkdirSync(pageDir, { recursive: true });

  // The settings that define the treatment, not just its size. A resume with a different repair cap,
  // feedback richness, harness, scope or endpoint would mix two treatments under one arm's name, so each record
  // carries them and a resume that disagrees with the file it continues is refused.
  // The cell set is part of it: a resume that changed the samples, briefs, arms or models would
  // leave the old cells in the file under a run that claims a different scope. Only concurrency,
  // which changes nothing measured, may differ.
  const scope = { briefs: briefs.map((b) => b.id).sort(), arms: [...arms].sort(), models: [...models].sort(), samples };
  // The browser that renders, by its own version: AF_CHROMIUM can point past the one the lockfile pins.
  const browser = await launchBrowser();
  const treatment = { repairs: MAX_REPAIRS, richness: opt('richness', 'full'), harness: harnessFingerprint('.', GENERATION, { outputs: [outFile, pageDir] }), scope, routes: routeIdentity(models), browser: browser.version() };
  const done = new Set();
  if (existsSync(outFile)) {
    for (const line of readFileSync(outFile, 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(line);
      const differs = Object.keys(treatment).filter((k) => JSON.stringify(r.treatment?.[k]) !== JSON.stringify(treatment[k]));
      if (differs.length) {
        console.error(`${outFile} was run with ${differs.map((k) => `${k} ${JSON.stringify(r.treatment?.[k] ?? 'unrecorded')}`).join(', ')}; this run has ${differs.map((k) => `${k} ${JSON.stringify(treatment[k])}`).join(', ')}. Resume with the same settings, or write to a new file.`);
        await browser.close();
        return 2;
      }
      done.add(cellKey(r.brief, r.arm, r.model, r.sample));
    }
  }

  const palette = paletteFrom(ASSETS.tokenFile);
  const { DIST } = await import('../src/lib/build-utils.mjs');
  for (const script of ['build-css.mjs', 'build-components.mjs']) execFileSync(process.execPath, [`scripts/${script}`], { stdio: 'ignore' });
  ASSETS.componentsCss = `${DIST}components.css`;
  ASSETS.tokensCss = `${DIST}tokens.css`;
  const { colors } = await import('../src/lib/tokens.mjs');
  console.log(`study system: ${STUDY} (paper ${colors.paper}); gate, repair loop and components arm all read it`);
  // Cells run a few at a time. Each is independent (its own prompt, its own pages, one shared
  // browser that opens a page per lint), records are appended whole by one process, and the
  // analysis reads them in any order, so concurrency changes how long a run takes and nothing it
  // measures. Sequential, a model's pilot took about four hours, past what one runner allows.
  const cells = [];
  for (const brief of briefs) for (const arm of arms) for (const model of models) for (let sample = 0; sample < samples; sample++) cells.push({ brief, arm, model, sample });
  const total = cells.length;
  let n = 0, next = 0, spent = { input: 0, output: 0 };

  const runCell = async ({ brief, arm, model, sample }) => {
            const key = cellKey(brief.id, arm, model, sample);
            if (done.has(key)) { n += 1; console.log(`[${n}/${total}] skip ${key}`); return; }
            try {
              const gen = await generatePage(brief, arm, model, sample, browser, pageDir);
              const s = await score(pathToFileURL(gen.file).href, { register: brief.register, palette, browser });
              spent.input += gen.usage.input; spent.output += gen.usage.output;
              const record = {
                brief: brief.id, register: brief.register, density: brief.density, chart: brief.chart,
                arm, model, route: gen.route, id: gen.id, sample, treatment, rounds: gen.rounds, fenced: gen.fenced, stop: gen.stop,
                failed: !!gen.failure, failure: gen.failure,
                file: gen.file, ...s, usage: gen.usage, at: new Date().toISOString(),
              };
              appendFileSync(outFile, JSON.stringify(record) + '\n');
              n += 1;
              console.log(`[${n}/${total}] ${key}  universal=${s.universal} axe=${s.axe.count} rounds=${gen.rounds}${gen.failure ? `  [${gen.failure}]` : ''}`);
            } catch (e) {
              appendFileSync(outFile, JSON.stringify({ brief: brief.id, register: brief.register, arm, model, sample, treatment, failed: true, failure: 'error', error: String(e.message ?? e), at: new Date().toISOString() }) + '\n');
              n += 1;
              console.error(`[${n}/${total}] ${key}  FAILED: ${e.message ?? e}`);
            }
  };

  try {
    const worker = async () => { while (next < cells.length) await runCell(cells[next++]); };
    await Promise.all(Array.from({ length: Math.min(concurrency, cells.length) }, worker));
  } finally { await browser.close(); }

  console.log(`\ntokens: ${spent.input} in, ${spent.output} out. Records in ${outFile}.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main());
