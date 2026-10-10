/**
 * af drift — what a site's design system actually is, and how far the site is from it.
 *
 *   af drift <page.html|url> [...] [--out report.json] [--declared tokens.json] [--viewports 320,1280]
 *   af drift <page.html|url> [...] --save-survey survey.json     measure, and keep the measurements
 *   af drift --from-survey survey.json [--declared tokens.json]  analyse without a browser
 *
 * Takes local files by preference rather than live URLs. A report that re-scrapes cannot be
 * re-run: the site moves, the numbers move, and the client is right to ask which run was true.
 *
 * Measuring and analysing are therefore separable. `--save-survey` writes every computed value
 * the browser saw, with the urls and the date; `--from-survey` runs the inference over that file
 * and touches no network at all. Three things follow, and each of them is the difference between
 * a report and an assertion. The measurement can be taken on a machine that can reach the site
 * and analysed on one that cannot. The inference can be re-run at a different tolerance without
 * going back to a site that has moved underneath it. And the survey can be handed to the client
 * as the evidence, so the numbers are auditable rather than trusted.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { surveyPages } from '../src/lib/survey.mjs';
import { driftReport } from '../src/lib/drift.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 || i === args.length - 1 ? fallback : args[i + 1];
};
const VALUE_FLAGS = ['out', 'declared', 'viewports', 'max-tokens', 'save-survey', 'from-survey'];
const targets = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && VALUE_FLAGS.includes(args[i - 1].slice(2))));

const fromSurvey = flag('from-survey');
if (!targets.length && !fromSurvey) {
  console.error('usage: af drift <page.html|url> [...] [--out report.json] [--declared tokens.json] [--viewports 320,1280]');
  console.error('       af drift --from-survey survey.json [--declared tokens.json]');
  process.exit(2);
}

const toUrl = (t) => (/^https?:\/\//.test(t) ? t : pathToFileURL(resolve(process.cwd(), t)).href);
const viewports = (flag('viewports', '1280')).split(',').map(Number).filter(Number.isFinite);

/**
 * A declared palette, if the organisation publishes one. Accepts a DTCG token file or a plain
 * array of hexes, because the point is to compare against whatever they actually have rather
 * than to make them convert it first.
 */
function declaredPalette(path) {
  if (!path) return null;
  if (!existsSync(path)) { console.error(`--declared: no such file ${path}`); process.exit(2); }
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  if (Array.isArray(parsed)) return parsed.filter((v) => /^#[0-9a-f]{6}$/i.test(v));
  const found = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.$value === 'string' && /^#[0-9a-f]{6}$/i.test(node.$value)) found.push(node.$value);
    else if (node.$value && typeof node.$value === 'object' && /^#[0-9a-f]{6}$/i.test(node.$value.hex ?? '')) found.push(node.$value.hex);
    for (const v of Object.values(node)) if (typeof v === 'object') walk(v);
  };
  walk(parsed);
  return [...new Set(found)];
}

const declared = declaredPalette(flag('declared'));

let merged, provenance;
if (fromSurvey) {
  if (!existsSync(fromSurvey)) { console.error(`--from-survey: no such file ${fromSurvey}`); process.exit(2); }
  const saved = JSON.parse(readFileSync(fromSurvey, 'utf8'));
  ({ merged } = saved);
  provenance = saved.measured;
  if (!merged) { console.error(`--from-survey: ${fromSurvey} has no survey in it`); process.exit(2); }
} else {
  const surveyed = await surveyPages(targets.map(toUrl), { viewports });
  merged = surveyed.merged;
  merged.pages = surveyed.pages.length;
  // What each page-viewport pair settled on: a survey cut off by the settle deadline is a
  // measurement of whatever had rendered by then, and the provenance has to say so.
  provenance = { urls: targets, viewports, measuredAt: new Date().toISOString(), pages: surveyed.pages.length, settled: surveyed.pages.map((p) => ({ url: p.url, viewport: p.viewport, ...p.settled })) };
  const saveTo = flag('save-survey');
  if (saveTo) {
    writeFileSync(saveTo, `${JSON.stringify({ measured: provenance, merged }, null, 2)}\n`);
    console.log(`wrote ${saveTo}`);
  }
}

const report = driftReport(merged, { declared, maxTokens: Number(flag('max-tokens', 12)) });
report.measured = { ...report.measured, ...provenance };

const out = flag('out');
if (out) {
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`wrote ${out}`);
}

const n = report.numbers;
const when = report.measured.measuredAt ? `, measured ${report.measured.measuredAt.slice(0, 10)}` : '';
console.log(`\nSurveyed ${report.measured.pages} page-viewport pairs, ${report.measured.elements} rendered elements${when}.\n`);
console.log(`  system size      ${n.size} values describe the site`);
console.log(`  colour coverage  ${n.coverage}% of the colour on the page`);
console.log(`  spacing step     ${report.system.spacing.step}px, explaining ${n.spacingCoverage}%`);
console.log(`  sprawl           ${n.sprawl}x more distinct values than tokens`);
console.log(`  waste            ${n.wasteValues} indistinguishable colours, ${n.wasteShare}% of the page\n`);
for (const f of report.findings) console.log(`· ${f}`);
if (report.declared) {
  console.log(`\n· ${report.declared.adherence}% of the palette in use matches the declared one.`);
  if (report.declared.undeclared.length) console.log(`· Rendered but never declared: ${report.declared.undeclared.map((u) => u.value).join(', ')}`);
  if (report.declared.unused.length) console.log(`· Declared but never rendered: ${report.declared.unused.join(', ')}`);
}
console.log('');
