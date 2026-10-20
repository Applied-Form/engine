/**
 * The report as a page: one self-contained Register II document built from the house stylesheets.
 * tokens.css and components.css are inlined, with their fonts as data, so the file can be sent on
 * its own and opened anywhere. There is no script. Everything a page put in the account (selectors,
 * values, messages, file names) is escaped, because the pages audited are somebody else's.
 *
 * The page is held to the gate it reports on: test/af-audit.test.mjs lints it at every fixed width.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { RULES, GROUPS } from './rules/registry.mjs';
import { findingKey, REFUSED, quote, pageCommand } from './audit.mjs';

const DIST = new URL('../../dist/', import.meta.url);

// The parts a page is built from (escaping, the data voice, statuses with their shapes, tables that
// scroll in their own region, and the page's own styles) are exported, so another report set in the
// house style says things the way this one does.

/**
 * The report names itself in a generator tag, so a later run over the same directory knows it for a
 * report and not a page of the set.
 */
export const GENERATOR = 'af audit';
export const isReport = (html) => /<meta\s+name="generator"\s+content="af (?:audit|report)"/i.test(String(html).slice(0, 4096));

/**
 * dist/tokens.css and dist/components.css as one stylesheet, every font they name inlined as a
 * data URL so nothing is left to fetch. A font the build did not ship is left out of its @font-face
 * rather than left pointing at a path that will not exist where the report is opened.
 */
export function houseCss() {
  const read = (name) => {
    const url = new URL(name, DIST);
    if (!existsSync(url)) throw new Error(`dist/${name} is missing; run af build (npm run build) first`);
    return readFileSync(url, 'utf8');
  };
  const base = dirname(fileURLToPath(new URL('tokens.css', DIST)));
  const inline = (css) => css.replace(/@font-face\s*\{[^}]*\}/g, (block) => {
    let ok = true;
    const out = block.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/g, (_, ref) => {
      if (/^data:/.test(ref)) return `url("${ref}")`;
      const file = resolve(base, ref);
      if (!existsSync(file)) { ok = false; return 'url("")'; }
      return `url("data:font/woff2;base64,${readFileSync(file).toString('base64')}")`;
    });
    return ok ? out : '';
  });
  return `${inline(read('tokens.css'))}\n${inline(read('components.css'))}`;
}

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** A run in the data voice: numerals, units, identifiers, selectors, values. */
export const d = (s) => `<span data-voice="data">${esc(s)}</span>`;
export const plural = (n, one, many = `${one}s`) => `${d(n)} ${n === 1 ? one : many}`;
const pct = (share) => `${Math.round(share * 100)} %`;
const list = (xs, sep = ', ') => xs.map(esc).join(sep);

export const SHAPES = {
  validated: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="currentColor"/></svg>',
  critical: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" fill="currentColor"/></svg>',
  caution: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2 L14 14 L2 14 Z" fill="currentColor"/></svg>',
  'not-applicable': '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="2" fill="currentColor"/></svg>',
};
const SHAPE_NAME = { validated: 'circle', critical: 'square', caution: 'triangle', 'not-applicable': 'dash' };
/** A status carries a label and a shape as well as a colour, as the rules require. */
export const status = (kind, label) => `<span class="af-status" data-status="${kind}" data-shape="${SHAPE_NAME[kind]}">${SHAPES[kind]}${esc(label)}</span>`;
const pass = (clean) => (clean == null ? status('not-applicable', 'not run') : clean ? status('validated', 'passes') : status('critical', 'fails'));

// A table wider than a narrow screen scrolls inside its own region, so the page itself never does.
export const table = (label, head, rows) => `<div class="af-table-scroll" role="region" aria-label="${esc(label)}" tabindex="0"><table class="af-table"><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>
${rows.join('\n')}
</tbody></table></div>`;
/** A cell in the data voice. `kind` is 'num' for a figure set to the end, 'wrap' for a selector or value that may break anywhere. */
export const td = (html, kind = null) => `<td data-voice="data"${kind ? ` class="af-${kind}"` : ''}>${html}</td>`;
const where = (selectors) => (selectors.length ? list(selectors, '<br>') : 'the page');
const decls = (o) => Object.entries(o ?? {}).map(([k, v]) => `${k}: ${v}`).join('; ');

/** Page-specific styles only. Every value is a token. */
export const PAGE_CSS = `
  h1 { font: var(--af-type-heading-02-weight) var(--af-type-heading-02-size)/var(--af-type-heading-02-leading) var(--af-font-text); margin-bottom: var(--af-space-02); }
  h2 { margin-top: var(--af-space-06); margin-bottom: var(--af-space-02); }
  h3 { margin-top: var(--af-space-04); margin-bottom: var(--af-space-01); }
  p, li { margin-bottom: var(--af-space-02); }
  ul { padding-inline-start: var(--af-space-03); }
  .af-lede { margin-bottom: var(--af-space-03); }
  .af-callout, .af-toc, .af-dl, .af-code, .af-table-scroll, .af-provenance { margin-block: var(--af-space-03); }
  .af-callout p { margin: 0; }
  main { overflow-wrap: break-word; }
  .af-table td.af-wrap, .af-dl dd { min-width: 0; overflow-wrap: anywhere; }
  .af-table a { display: inline-block; min-width: var(--af-space-03); min-height: var(--af-space-03); }
  .af-code { white-space: pre-wrap; overflow-wrap: anywhere; }
  .af-provenance { grid-template-columns: 1fr; }
  .af-provenance p { margin: 0; }
  .af-sub { margin-top: var(--af-space-03); }
`;

/**
 * The report page. `css` is the house stylesheet (houseCss()); `mark` is an outlined wordmark SVG
 * for the masthead, or nothing, in which case the masthead carries its label alone.
 */
export function renderReport(report, { css, mark = null } = {}) {
  const a = report.aggregate;
  const fixed = report.fix;
  const date = String(report.generated).slice(0, 10);
  const systemLabel = report.system?.label ?? 'no system named';
  const anchors = new Map(report.pages.map((p, i) => [p, `page-${i + 1}`]));

  // The lede says the result in one sentence a person can sign under.
  const notLoaded = a.notLoaded.length;
  const incomplete = a.incomplete?.length ?? 0;
  const apart = fixed ? a.notComparable?.length ?? 0 : 0;
  const lede = [
    `Of ${plural(a.pages, 'page')} named, ${d(a.loaded)} loaded and ${d(a.clean.before)} ${a.clean.before === 1 ? 'passes' : 'pass'} every rule checked at every width measured${fixed ? `, as found; ${d(a.clean.after)} would pass with the fixes the engine can make on its own` : ''}.`,
    fixed && a.findings.before ? (() => {
      const unjudged = a.findings.notCompared ?? 0, person = a.findings.after - unjudged;
      return `The fixer would cure ${d(a.findings.fixed)} of ${plural(a.findings.before, 'finding')} (${d(pct(a.fixedWithoutModel.share))}) without a model; ${plural(person, 'finding')} ${person === 1 ? 'needs' : 'need'} a person${unjudged ? `, and ${plural(unjudged, 'finding')} on ${plural(apart, 'page')} not compared ${unjudged === 1 ? 'was' : 'were'} not judged` : ''}.`;
    })() : '',
    fixed ? 'The fixes were tried on copies and are not written to the pages.' : '',
    !fixed ? `${plural(a.findings.before, 'finding')} across the set.` : '',
    notLoaded ? `${plural(notLoaded, 'page')} could not be loaded or measured as ${notLoaded === 1 ? 'it renders and is' : 'they render and are'} not counted clean.` : '',
    incomplete ? `${plural(incomplete, 'page')} ${incomplete === 1 ? 'was' : 'were'} measured without a stylesheet, script or font ${incomplete === 1 ? 'it' : 'they'} asked for, and ${incomplete === 1 ? 'is' : 'are'} not counted clean.` : '',
    apart ? `${plural(apart, 'page')} could not be compared with the fixes, so ${apart === 1 ? 'its' : 'their'} findings are counted as found and none as fixed.` : '',
  ].filter(Boolean).join(' ');

  const toc = [['summary', 'Summary'], ['by-rule', 'Findings by rule'], ['pages', 'Pages'], ['wcag', 'WCAG 2.2 criteria'], ['not-checked', 'Not checked'], ['rules-checked', 'Rules checked'], ['provenance', 'Provenance']];

  const summary = `<dl class="af-dl">
<dt>Pages named</dt><dd>${d(a.pages)}</dd>
<dt>Loaded</dt><dd>${d(a.loaded)}${notLoaded ? `; not loaded: ${a.notLoaded.map((p) => d(p.input)).join(', ')}` : ''}</dd>
${incomplete ? `<dt>Measured incomplete</dt><dd>${a.incomplete.map((p) => d(p.input)).join(', ')}; not counted clean</dd>` : ''}
<dt>Clean as found</dt><dd>${d(a.clean.before)} of ${d(a.pages)}</dd>
${fixed ? `<dt>Clean if fixed</dt><dd>${d(a.clean.after)} of ${d(a.pages)}; the fixes are not written to the pages</dd>` : ''}
${apart ? `<dt>Not compared with the fixes</dt><dd>${a.notComparable.map((p) => d(p.input)).join(', ')}; counted as found, with nothing fixed</dd>` : ''}
<dt>Findings as found</dt><dd>${d(a.findings.before)} (${plural(a.violations.before, 'violation')} counted per width)</dd>
${fixed ? `<dt>Findings if fixed</dt><dd>${d(a.findings.after)} (${plural(a.violations.after, 'violation')} counted per width)</dd>
<dt>Fixable without a model</dt><dd>${d(a.findings.fixed)} of ${d(a.findings.before)}, ${d(pct(a.fixedWithoutModel.share))}${a.findings.introduced ? `; ${plural(a.findings.introduced, 'new finding')} after fixing` : ''}</dd>` : '<dt>Fixer</dt><dd>Not run. Run again with <code>--fix</code> to see what the engine can cure on its own.</dd>'}
<dt>Widths</dt><dd>${d(report.widths.join(', '))} px</dd>
<dt>Rules checked</dt><dd>${d(report.rulesChecked.length)}</dd>
</dl>`;

  const byRuleHead = ['Rule', 'WCAG', 'Pages as found', 'Findings as found', ...(fixed ? ['Pages if fixed', 'Findings if fixed'] : [])];
  const byRuleRows = a.byRule.map((r) => `<tr>${td(esc(r.rule))}${td(r.wcag.length ? list(r.wcag) : 'none')}${td(r.pages.before, 'num')}${td(r.findings.before, 'num')}${fixed ? `${td(r.pages.after, 'num')}${td(r.findings.after, 'num')}` : ''}</tr>`);
  const byRule = a.byRule.length
    ? `<p>A finding is one rule failing on one element, however many widths it failed at. Rules with no WCAG basis are this system's own conventions.</p>
${table('Findings by rule', byRuleHead, byRuleRows)}
<h3>What each rule requires</h3>
<dl class="af-dl">
${a.byRule.map((r) => `<dt>${esc(r.rule)}</dt><dd>${esc(r.summary ?? '')}${r.fix ? ` Fix: ${esc(r.fix)}` : ''}</dd>`).join('\n')}
</dl>`
    : '<p>No rule failed on any page that loaded.</p>';

  // A page that loaded and was not measured (it was blank) is said to be so, and one measured without
  // a stylesheet, script or font it asked for is measured incomplete, whatever it found.
  const missed = (p) => status('critical', /^not measured/.test(p.error ?? '') ? 'not measured' : 'not loaded');
  const verdict = (p, clean) => (!p.loaded ? missed(p) : p.incomplete ? status('caution', 'measured incomplete') : pass(clean));
  // A page rendered with the fixes without a stylesheet, script or font it loaded as found is not compared.
  const apartFrom = (p) => p.loaded && p.fixedRender?.comparable === false;
  const ifFixed = (p) => (apartFrom(p) ? status('caution', 'not comparable') : verdict(p, p.clean.after));
  const pageRows = report.pages.map((p) => `<tr>${td(`<a href="#${anchors.get(p)}">${esc(p.name)}</a>`)}<td>${verdict(p, p.clean.before)}</td>${td(p.loaded ? p.findings.length : '–', 'num')}${fixed ? `<td>${ifFixed(p)}</td>${td(p.loaded && p.remaining ? p.remaining.length : '–', 'num')}` : ''}</tr>`);
  const pagesHead = ['Page', 'As found', 'Findings', ...(fixed ? ['If fixed', 'Findings'] : [])];

  // Every request a page made that did not load, with what happened to it.
  const failures = (p) => {
    const failed = p.failed ?? [];
    if (!failed.length) return '';
    const hints = [
      failed.some((f) => f.why === REFUSED.file) ? "A local file outside the page's own directory, the directories named and the engine's files is refused: name the directory that holds the page's files." : '',
      failed.some((f) => f.why === REFUSED.network) ? 'The run was offline: run it without <code>--offline</code> to load what the page asks for over the network.' : '',
    ].filter(Boolean).join(' ');
    const note = !p.loaded ? 'These requests failed while it was loading.'
      : p.incomplete ? 'A stylesheet, script or font it asked for did not load, so the findings are of the page without it, and it is not counted clean.'
        : 'None of them was a stylesheet, script or font, so the page is counted on its findings.';
    return `<p>${plural(failed.length, 'request')} did not load. ${note}${hints ? ` ${hints}` : ''}</p>
${table(`Requests that did not load on ${p.name}`, ['Request', 'Type', 'What happened'], failed.map((f) => `<tr>${td(esc(f.resource), 'wrap')}${td(esc(f.type))}${td(esc(f.why), 'wrap')}</tr>`))}`;
  };

  const pageSection = (p) => {
    const id = anchors.get(p);
    if (!p.loaded) return `<h3 id="${id}">${esc(p.name)}</h3>
<p>${missed(p)} This page could not be measured, so it is not counted clean: ${d(p.error)}</p>
${failures(p)}`;
    const head = ['Rule', 'Element', 'Value', 'Widths', 'WCAG', ...(fixed ? ['If fixed'] : [])];
    const cured = (f) => (f.fixed === true ? status('validated', 'fixed') : f.fixed === false ? status('critical', 'still fails') : status('not-applicable', 'not compared'));
    const rows = p.findings.map((f) => `<tr>${td(esc(f.rule))}${td(where(f.selectors), 'wrap')}${td(f.values.length ? list(f.values, '<br>') : '–', 'wrap')}${td(esc(f.widths.join(', ')))}${td(f.wcag.length ? list(f.wcag) : 'none')}${fixed ? `<td>${cured(f)}</td>` : ''}</tr>`);
    const was = new Set(p.findings.map(findingKey));
    const introduced = fixed ? (p.remaining ?? []).filter((r) => !was.has(findingKey(r))) : [];
    const fixer = p.fixer;
    const apart = fixed && apartFrom(p);
    const verdicts = p.incomplete ? verdict(p) : `${pass(p.clean.before)}${fixed ? ` as found, ${apart ? `and ${status('caution', 'not comparable')}` : pass(p.clean.after)} if fixed.` : ''}`;
    const lost = p.fixedRender?.lost ?? [];
    const notCompared = !apart ? '' : `<p>${p.fixedRender.error ? `The page could not be rendered with the fixes added (${d(p.fixedRender.error)})` : `With the fixes added, the page did not load ${lost.length === 1 ? 'a resource' : `${d(lost.length)} resources`} it loaded as found (a stylesheet, script, font, image or the data a script fetches), listed below`}, so the two renders are not compared: its findings are counted as found, and none as fixed.</p>
${lost.length ? table(`Requests lost with the fixes on ${p.name}`, ['Request', 'Type', 'What happened'], lost.map((f) => `<tr>${td(esc(f.resource), 'wrap')}${td(esc(f.type))}${td(esc(f.why), 'wrap')}</tr>`)) : ''}`;
    return `<h3 id="${id}">${esc(p.name)}</h3>
<p>${verdicts} Register ${d((p.register ?? '?').toUpperCase())}${p.assumedRegister ? ', assumed' : ''}; ${plural(p.rulesChecked.length, 'rule')} checked${p.scope === 'universal' ? ', the universal set only, because no system was loaded and the page declares no register' : ''}.</p>
${failures(p)}
${notCompared}
${p.findings.length ? table(`Findings on ${p.name}`, head, rows) : '<p>Nothing to report on this page.</p>'}
${introduced.length ? `<p>${plural(introduced.length, 'finding')} appeared after fixing: ${introduced.map((f) => `${d(f.rule)} on ${d(f.selectors.length ? f.selectors.join(', ') : 'the page')}`).join('; ')}.</p>` : ''}
${fixer && fixer.applied.length ? `<span class="af-label af-eyebrow af-sub">Fixes the fixer would apply, not written</span>
${table(`Fixes the fixer would apply to ${p.name}`, ['Element', 'Declarations', 'Rules'], fixer.applied.map((x) => `<tr>${td(esc(`${x.selector ?? ''}${x.pseudo ?? ''}`), 'wrap')}${td(esc(decls(x.declarations)), 'wrap')}${td(list(x.rules))}</tr>`))}` : ''}
${fixer && fixer.refused.length ? `<span class="af-label af-eyebrow af-sub">Fixes refused</span>
${table(`Fixes refused on ${p.name}`, ['Element', 'Declarations', 'Rules', 'Reason'], fixer.refused.map((x) => `<tr>${td(esc(`${x.selector ?? ''}${x.pseudo ?? ''}`), 'wrap')}${td(esc(decls(x.declarations)), 'wrap')}${td(list(x.rules))}${td(esc(x.reason), 'wrap')}</tr>`))}` : ''}`;
  };

  const wcagRows = report.wcag.map((c) => `<tr>${td(esc(c.sc))}<td>${esc(c.name)}</td>${td(c.extent === 'partial' ? 'partly' : 'tested')}${td(c.checked.length ? list(c.checked, '<br>') : 'not checked in this run')}${td(c.findings.before, 'num')}${fixed ? td(c.findings.after, 'num') : ''}</tr>`);

  const groups = GROUPS.map((g) => [g, RULES.filter((r) => r.group === g && report.rulesChecked.includes(r.id)).map((r) => r.id)]).filter(([, ids]) => ids.length);

  const overrides = Object.entries(report.policy?.overrides ?? {}).map(([rule, sev]) => `${rule}: ${sev}`);
  const provenance = [
    `System: ${systemLabel}${report.system?.version ? `, tokens ${report.system.version}` : ''}`,
    `Engine: ${report.engine?.name ?? 'engine'} ${report.engine?.version ?? ''}`,
    `Generated: ${report.generated}`,
    `Widths: ${report.widths.join(', ')} px${report.sampled.length ? ` (${report.sampled.join(', ')} sampled with seed ${report.seed})` : ''}`,
    `Register: ${report.register ? `${report.register.toUpperCase()}, assumed for pages that declare none` : 'as each page declares'}`,
    `Fixer: ${fixed ? "run on copies, with no model; each page measured with the fixes at its own address, with the fixer's CSS added; nothing written to the pages" : 'not run'}`,
    `Network: ${report.offline ? 'refused (--offline); every request over it is listed with its page' : "on, as a visitor's browser has it"}`,
    `Local files: a page from a file could read its own directory and below, the directories named${report.roots?.length ? `, the --root ${report.roots.length === 1 ? 'directory' : 'directories'} ${report.roots.join(', ')}` : ''} and the engine's files; any other file it asked for was refused and is listed with it. A page from a URL reads none`,
    `Rule overrides: ${overrides.length ? `${overrides.join(', ')} in af.config.json, not applied; every rule listed is checked` : 'none applied; every rule listed is checked'}`,
  ];
  // One page at a time, as this run measured it: the same widths, system, register, fixer, network
  // and --root (af lint takes neither --widths nor --system). A page that could read a directory
  // named above its own, or read a file in another directory named, needs that directory too, so its
  // own command is given. af fix writes the fixes.
  const one = report.pageCommand ?? pageCommand({ ...report, roots: [], system: report.system?.arg ?? null });
  const roots = (c) => (String(c).match(/ --root /g) ?? []).length;
  const own = report.pages.filter((p) => p.command && roots(p.command) > roots(one));
  const writer = [`npx af fix <page>`, '--widths', report.widths.join(','),
    ...(report.system?.arg ? ['--system', quote(report.system.arg)] : []),
    ...(report.register ? ['--register', report.register] : [])].join(' ');
  const alone = [`One page at a time: ${d(one)}.`,
    own.length ? `A page that could read a directory named above its own, or read a file in another directory named, is given that directory with <code>--root</code>: ${own.map((p) => d(p.command)).join('; ')}.` : '',
    fixed ? `To write a page's fixes: ${d(writer)}.` : ''].filter(Boolean).join(' ');

  return `<!doctype html>
<html lang="en" data-register="ii">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="${GENERATOR}">
<title>Conformance report · ${esc(a.pages)} pages · ${esc(date)}</title>
<style>
${css}
</style>
<style>${PAGE_CSS}</style>
</head>
<body>
<a class="af-skip" href="#main">Skip to content</a>
<header class="af-masthead" data-masthead><div class="af-page">${mark ? `<span class="af-wordmark">${mark}</span>` : ''}<span class="af-label">Conformance report · <span class="af-value">${esc(date)}</span></span></div></header>
<main class="af-page" id="main">
  <span class="af-label af-eyebrow">Document type · Conformance report</span>
  <h1>${plural(a.pages, 'page')} checked against ${esc(systemLabel)}</h1>
  <p class="af-lede">${lede}</p>
  <div class="af-callout" data-status="caution" data-shape="triangle">${SHAPES.caution}<p>${esc(report.claim)} What is not checked is listed under <a href="#not-checked">Not checked</a>.</p></div>
  <nav class="af-toc" aria-label="Contents"><span class="af-label af-eyebrow">Contents</span><ol>${toc.map(([id, t], i) => `<li><span>${String(i + 1).padStart(2, '0')}</span><a href="#${id}">${t}</a></li>`).join('')}</ol></nav>

  <h2 id="summary">Summary</h2>
  ${summary}

  <h2 id="by-rule">Findings by rule</h2>
  ${byRule}

  <h2 id="pages">Pages</h2>
  ${table('Pages', pagesHead, pageRows)}
  ${report.pages.map(pageSection).join('\n')}

  <h2 id="wcag">WCAG 2.2 criteria</h2>
  <p>The rules below contribute to testing these success criteria, most of them in part. A criterion marked partly is tested only as far as ${d(report.notChecked.doc)} describes. No row here is a statement that a page meets the criterion.</p>
  ${table('WCAG 2.2 criteria', ['Criterion', 'Name', 'Extent', 'Rules checked', 'Findings as found', ...(fixed ? ['Findings if fixed'] : [])], wcagRows)}

  <h2 id="not-checked">Not checked</h2>
  <p>${esc(report.notChecked.note)}</p>
  <p>None of the following is tested at all:</p>
  <ul>
${report.notChecked.items.map((t) => `    <li>${esc(t.replace(/`/g, ''))}</li>`).join('\n')}
  </ul>

  <h2 id="rules-checked">Rules checked</h2>
  <p>${plural(report.rulesChecked.length, 'rule')} were in force for at least one page. Each fails a page on any violation at any width measured. Advisory readings, such as APCA, are not counted.</p>
  <dl class="af-dl">
${groups.map(([g, ids]) => `<dt>${esc(g)}</dt><dd>${ids.map(d).join(', ')}</dd>`).join('\n')}
  </dl>

  <h2 id="provenance">Provenance</h2>
  <div class="af-provenance"><div><span class="af-label af-eyebrow">Provenance</span>
${provenance.map((l) => `    <p class="af-data-02">${esc(l)}</p>`).join('\n')}
  </div></div>
  <p>To repeat this run, with the same widths:</p>
  <pre class="af-code" data-voice="data">${esc(report.command)} --out report.html
${esc(report.command)} --json</pre>
  <p>${alone}</p>

  <footer class="af-footer"><span class="af-data-02">Conformance report · ${esc(report.engine?.name ?? 'engine')} ${esc(report.engine?.version ?? '')} · ${esc(date)}</span></footer>
</main>
</body>
</html>
`;
}
