/**
 * The account of a set of pages: what `af audit` writes. One entry per page, built from the lint
 * results before and (with the fixer) after, then an aggregate across the set. No browser and no
 * I/O beyond reading the scope document: scripts/audit-pages.mjs renders the pages and hands the
 * results here, and audit-html.mjs turns the account into a page.
 *
 * Two units are counted, and they are kept apart on purpose:
 *
 *   a violation  one rule failing on one element at one width, as `af lint` and `af fix` count it
 *   a finding    one rule failing on one element, at however many widths it failed
 *
 * A finding is what a person fixes, so the report leads with findings. Violations are kept so the
 * numbers can be checked against `af fix --json` for the same page.
 *
 * A page that did not load is in the account, named, with the reason. It is never counted clean: a
 * page nobody measured has not passed anything.
 */
import { readFileSync } from 'node:fs';
import { RULES, appliesToPack } from './rules/registry.mjs';
import { selectorsOf, NOT_CHECKED } from './fix/page.mjs';
import { pack } from './tokens.mjs';

const ENGINE_ROOT = new URL('../../', import.meta.url);
export const SCOPE_DOC = NOT_CHECKED.doc;
const RULE = Object.fromEntries(RULES.map((r) => [r.id, r]));

/** What a clean report does and does not claim. Every report carries it, in the HTML and the JSON. */
export const CLAIM = 'This report is not a WCAG conformance claim and not a European Accessibility Act (EAA) conformance claim. A page that passes has passed the rules listed here, at the widths listed here, and nothing else. It does not replace an accessibility audit with assistive-technology testing.';

/**
 * docs/accessibility-scope.md, read as data: the criteria it says the rules test, with how far, and
 * the list of what is not tested at all. The document is the source; the report quotes it, so the
 * two cannot disagree.
 */
export function parseScope(md) {
  const section = (title) => {
    const at = md.search(new RegExp(`^## ${title}`, 'm'));
    if (at < 0) return null;
    const rest = md.slice(at).split('\n').slice(1).join('\n');
    const end = rest.search(/^## /m);
    return end < 0 ? rest : rest.slice(0, end);
  };
  const tested = section('WCAG 2\\.2 success criteria this linter tests');
  const not = section('What this linter does NOT test at all');
  if (!tested || !not) throw new Error(`the scope document (${SCOPE_DOC}) has lost one of its two sections: "WCAG 2.2 success criteria this linter tests" and "What this linter does NOT test at all"`);
  // A bullet runs until the next bullet or a blank line; continuation lines are indented.
  const bullets = (text) => text.split(/\n(?=- )/).map((b) => b.trim()).filter((b) => b.startsWith('- ')).map((b) => b.slice(2).split(/\n\s*\n/)[0].replace(/\s*\n\s*/g, ' ').trim());
  const criteria = bullets(tested).map((b) => {
    const m = /^\*\*(\d+\.\d+\.\d+) ([^*]+)\*\*\s*[—-]\s*(.*)$/.exec(b);
    if (!m) return null;
    const partial = /^partially\b|^barely\b/i.test(m[3]);
    return { sc: m[1], name: m[2].trim(), extent: partial ? 'partial' : 'tested', note: m[3].replace(/^partially\.\s*/i, '').trim() };
  }).filter(Boolean);
  const notTested = bullets(not);
  if (!criteria.length || !notTested.length) throw new Error(`the scope document (${SCOPE_DOC}) has no criteria or no list of what is not tested`);
  return { criteria, notTested };
}

let scopeCache = null;
export function loadScope() {
  scopeCache ??= parseScope(readFileSync(new URL(SCOPE_DOC, ENGINE_ROOT), 'utf8'));
  return scopeCache;
}

const px = (n) => `${n}px`;

/** The value that broke the rule, as a reader would quote it, or null when the rule is about the page having or lacking something. */
export function offendingValue(v) {
  const t = v.text;
  switch (v.rule) {
    case 'contrast': return t && v.ratio != null ? `${v.ratio.toFixed(2)}:1, ${t.color} on ${t.background} (floor ${v.need}:1)` : null;
    case 'label-apca': return v.lc != null ? `Lc ${Math.round(v.lc)}` : null;
    case 'caution-as-text': case 'accent-non-interactive-ii': return t?.color ?? null;
    case 'font-off-system': case 'display-voice-in-ii': case 'data-not-mono': return t?.family ?? null;
    case 'heading-voice-ii': return t ? `${t.family} ${t.weight}` : null;
    case 'measure': return t?.measureCh != null ? `${t.measureCh}ch` : null;
    case 'text-too-small': case 'body-too-small': case 'display-weight': return t?.sizePx != null ? px(t.sizePx) : null;
    case 'target-size': return v.target ? `${v.target.width}×${v.target.height}px` : null;
    case 'link-not-underlined': return 'no underline';
    case 'link-colour-ii': return v.link?.color ?? null;
    case 'print-link-url': return typeof v.link === 'string' ? v.link : null;
    case 'spacing': return v.value != null ? px(v.value) : null;
    case 'aspect-ratio': return v.value != null ? String(v.value) : null;
    case 'horizontal-overflow': return v.overflow != null ? `${v.overflow}px wider than the viewport` : null;
    case 'print-overflow': return v.print?.overflowX != null ? `${v.print.overflowX}px wider than the page` : null;
    case 'heading-order': {
      const m = /from h(\d) to h(\d)/.exec(v.message ?? '');
      return m ? `h${m[1]} to h${m[2]}` : v.heading?.level != null ? `starts at h${v.heading.level}` : null;
    }
    case 'motion-not-reduced': return v.motion ? `${v.motion.underReducedMotion} running` : null;
    case 'series-contrast': case 'series-indistinct': return v.ratio != null ? `${v.ratio.toFixed(2)}:1` : null;
    default: break;
  }
  if (v.absence?.value != null) return typeof v.absence.value === 'number' ? px(v.absence.value) : String(v.absence.value);
  if (v.color) return v.color;
  const item = v.item;
  if (item) {
    if (item.ms != null) return `${item.ms}ms`;
    if (item.rotation != null) return `${item.rotation}°`;
    if (item.zIndex != null) return `z-index ${item.zIndex}`;
    if (item.measured) return `${item.measured}, declared ${item.declared}`;
    if (item.left != null && item.right != null) return `${item.left}–${item.right}px`;
  }
  const got = /\bgot ([^;]+?)(?: on an? [a-z0-9-]+)?\.?$/.exec(v.message ?? '');
  return got ? got[1] : null;
}

/**
 * Rules about the whole page that fail at most once per width, with a message whose detail moves
 * with the width: horizontal-overflow names what sticks out, and that list differs at 320 and 672.
 * Each is one finding per page, however the message reads.
 */
const WHOLE_PAGE = new Set(['horizontal-overflow']);

/** One finding's identity: the rule and the element, or for a rule about the whole page, the rule and its message with the numbers taken out. */
export const findingKey = (f) => `${f.rule}|${f.selectors.length ? f.selectors.join(',') : WHOLE_PAGE.has(f.rule) ? 'the page' : f.message.replace(/\d+(\.\d+)?/g, '#')}`;

/**
 * Lint results (one per width) folded into findings: one per rule and element, with the widths and
 * the values seen. A spacing or ratio violation is one value at one width, carried by however many
 * elements have it; it is split into a finding for each element, because each is fixed, or not, on
 * its own, and the set of elements carrying a value can change from one width to the next.
 */
export function findingsOf(results = []) {
  const out = new Map();
  for (const r of results) {
    for (const v of r.violations) {
      const on = selectorsOf(v, r.spec ?? {});
      const value = offendingValue(v);
      for (const selectors of on.length ? on.map((s) => [s]) : [[]]) {
        const draft = { rule: v.rule, selectors, value, values: [], message: v.message, widths: [], wcag: [...(RULE[v.rule]?.wcag ?? [])], fixed: null };
        const key = findingKey(draft);
        const f = out.get(key) ?? draft;
        if (!f.widths.includes(r.viewport)) f.widths.push(r.viewport);
        if (value != null && !f.values.includes(value)) f.values.push(value);
        out.set(key, f);
      }
    }
  }
  for (const f of out.values()) f.widths.sort((a, b) => a - b);
  return [...out.values()].sort((a, b) => a.rule.localeCompare(b.rule) || a.selectors.join(',').localeCompare(b.selectors.join(',')));
}

const tally = (results) => {
  const c = {};
  for (const r of results) for (const v of r.violations) c[v.rule] = (c[v.rule] ?? 0) + 1;
  return Object.fromEntries(Object.entries(c).sort(([a], [b]) => a.localeCompare(b)));
};
const sum = (c) => Object.values(c).reduce((a, b) => a + b, 0);

/**
 * Rules that cannot fire on every register, so a page in another is not said to have been checked
 * against them. GATED_ON_II are the checks in rules/ that run only when the register is II
 * (`isII` in rules.mjs; under a pack the register is the pack's, never II). PRINTED_IN_II are read
 * from the print pass, which page-lint.mjs makes only for a page in Register II. OFF_II runs only
 * when the register is not II: a Register II page is held to ground-in-ii instead.
 */
export const GATED_ON_II = Object.freeze(['ground-in-ii', 'accent-non-interactive-ii', 'display-voice-in-ii', 'heading-voice-ii', 'body-too-small', 'link-colour-ii', 'decorative-imagery', 'mark-once-ii', 'spread-in-ii', 'provenance-required']);
export const PRINTED_IN_II = Object.freeze(['print-overflow', 'print-link-url']);
export const OFF_II = Object.freeze(['ground-off-palette']);

/**
 * The rules a page is judged by. An advisory never gates, so it is not listed. Under a Standards
 * pack, the rules that hold for any page and the ones the pack states; with no system and no
 * register, the universal ones; otherwise every error rule. Given the page's register, the rules
 * that cannot fire in it are left out.
 */
export function rulesChecked(scope, declares = pack?.declares ?? [], register = null) {
  const errors = RULES.filter((r) => r.severity === 'error');
  let ids = scope === 'universal' ? errors.filter((r) => r.scope === 'universal').map((r) => r.id)
    : scope === 'pack' ? errors.filter((r) => appliesToPack(r.id, declares)).map((r) => r.id)
      : errors.map((r) => r.id);
  if (register != null) {
    const printsII = String(register).startsWith('ii');
    const judgedII = printsII && scope !== 'pack';
    const out = new Set([...(judgedII ? OFF_II : GATED_ON_II), ...(printsII ? [] : PRINTED_IN_II)]);
    ids = ids.filter((id) => !out.has(id));
  }
  return ids;
}

/**
 * The resource types a page is not measured as it renders without: its styles, its scripts (which
 * may write its text) and its fonts. A page that asked for one of these and did not get it is
 * measured incomplete. An image, a data file or anything else that failed is listed, and the page
 * is counted on its findings.
 */
export const NEEDED = Object.freeze(['stylesheet', 'script', 'font']);
/** Requests whose loss can change what a page renders: content, data a script draws, media. */
export const RENDERED = Object.freeze(['document', 'stylesheet', 'script', 'font', 'image', 'media', 'texttrack', 'xhr', 'fetch', 'eventsource', 'websocket']);

/** What a failed request's `why` reads when it was refused rather than failed. */
export const REFUSED = Object.freeze({ file: 'refused: outside what the page may read', network: 'refused: --offline' });

/**
 * One page's entry. `initial` and `after` are lint results, one per width; `after` and `fix` (the
 * fixer's report, `fixReport` in fix/page.mjs) are given only when the fixer ran. `error` says why a
 * page could not be measured, and makes it an entry with nothing measured; `fixerRan` says whether
 * the run it failed in was a fixing one, so its "after" is false rather than absent.
 *
 * `failed` lists every request the page made that did not load or was refused: { resource, type,
 * why }, the resource shown without the auditor's directories. A page with a failed stylesheet,
 * script or font (NEEDED) is `incomplete`: its findings stand as measured, and it is never counted
 * clean, as found or with the fixes. `failed` is heard on the page as found, so the fixer cannot make
 * a page incomplete or complete.
 *
 * `after` is the page rendered as found was, at its own address, with the fixer's CSS added, and
 * `afterFailed` lists the requests that render failed, as `failed` does; `afterError` says why the
 * page could not be rendered with the fixes. The two renders are compared only when the second
 * loaded everything the first did that can change what renders (RENDERED: stylesheets, scripts,
 * fonts, images and media, and the data a script fetches; `fixedRender.comparable`). A page that
 * lost one, or could not be rendered with the fixes, is not compared: no finding on it is judged
 * fixed or still failing (`fixed` is null), nothing on it is counted as introduced, and it is not
 * counted clean with the fixes. A fixer that applied nothing has cured nothing, whatever `after`
 * says: the page with the fixes is the page as found.
 *
 * `command` measures this page alone as the run measured it (pageCommand).
 */
export function pageEntry({ input, name = input, error = null, initial = null, after = null, fix = null, fixerRan = !!(after || fix), failed = [], afterFailed = [], afterError = null, command = null }) {
  if (error != null || !initial) {
    return { input, name, loaded: false, error: String(error ?? 'nothing was measured'), incomplete: false, failed, register: null, assumedRegister: false, scope: null, rulesChecked: [], clean: { before: false, after: fixerRan ? false : null }, violations: { before: null, after: null }, byRule: { before: {}, after: null }, findings: [], remaining: null, fixer: null, fixedRender: null, command };
  }
  const first = initial[0]?.spec ?? {};
  const scope = initial.some((r) => r.scope === 'universal') ? 'universal' : pack ? 'pack' : 'system';
  const findings = findingsOf(initial);
  let fixedRender = null;
  if (fixerRan) {
    if (fix && !fix.applied?.length) [after, afterFailed, afterError] = [initial, failed, null];
    const lost = afterError == null ? afterFailed.filter((f) => RENDERED.includes(f.type) && !failed.some((g) => g.resource === f.resource && g.type === f.type)) : [];
    fixedRender = { comparable: afterError == null && !!after && !lost.length, error: afterError == null ? null : String(afterError), failed: afterFailed, lost };
    if (!fixedRender.comparable) after = null;
  }
  const remaining = after ? findingsOf(after) : null;
  if (remaining) {
    const left = new Set(remaining.map(findingKey));
    for (const f of findings) f.fixed = !left.has(findingKey(f));
  }
  const before = tally(initial), afterTally = after ? tally(after) : null;
  const incomplete = failed.some((f) => NEEDED.includes(f.type));
  const cleared = remaining ? [...new Set(findings.filter((f) => f.fixed).map((f) => f.rule))].filter((r) => !remaining.some((f) => f.rule === r)) : [];
  return {
    input, name, loaded: true, error: null,
    incomplete,
    failed,
    register: first.register ?? null,
    assumedRegister: first.assumedRegister ?? false,
    scope,
    rulesChecked: rulesChecked(scope, undefined, first.register ?? null),
    clean: { before: !incomplete && sum(before) === 0, after: afterTally ? !incomplete && sum(afterTally) === 0 : fixerRan ? false : null },
    violations: { before: sum(before), after: afterTally ? sum(afterTally) : null },
    byRule: { before, after: afterTally },
    findings,
    remaining,
    // The rules cleared are read from the two renders compared, never from the fixer's own copy.
    fixer: fix ? { applied: fix.applied ?? [], refused: fix.refused ?? [], rulesFixed: cleared.sort() } : null,
    fixedRender,
    command,
  };
}

/** The findings a page has with the fixes: as found, when the two renders were not compared. */
export const findingsIfFixed = (p) => (p.loaded ? p.remaining ?? p.findings : []);

/** A word for a POSIX shell: as it is when it needs no quoting, in single quotes otherwise. */
export const quote = (s) => (/^[\w./:@,=-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`);

/**
 * The command that measures one page as the run measured it: the same widths, system, register,
 * fixer and network, and with `--root` each directory beyond its own the page could read. `page`
 * is the page as it can be typed from the working directory, or `<page>` for any page. `system` is
 * the system as it was typed.
 */
export function pageCommand({ page = '<page>', roots = [], widths = [], system = null, register = null, fix = false, offline = false }) {
  return ['npx af audit', page === '<page>' ? page : quote(page), ...roots.flatMap((r) => ['--root', quote(r)]),
    '--widths', widths.join(','), ...(system ? ['--system', quote(system)] : []), ...(register ? ['--register', register] : []),
    ...(fix ? ['--fix'] : []), ...(offline ? ['--offline'] : [])].join(' ');
}

/**
 * What the set was judged against, for the heading and the provenance. With no system loaded, a
 * page that declares a register is judged by every house rule and one that declares none by the
 * universal rules alone; a set holding both is described as both, not as either.
 */
export function systemOf(pages, { label = null, arg = null, version = null } = {}) {
  const loaded = pages.filter((p) => p.loaded);
  const universal = loaded.filter((p) => p.scope === 'universal').length;
  const scope = universal && universal === loaded.length ? 'universal' : pack ? 'pack' : 'system';
  const base = label ?? (scope === 'universal' ? 'the universal rules (no system loaded)' : `the engine's own tokens`);
  const also = universal && scope !== 'universal' ? `, and the universal rules for ${universal === 1 ? 'the page that declares' : `the ${universal} pages that declare`} no register` : '';
  return { label: `${base}${also}`, arg, version, scope };
}

const round3 = (n) => Math.round(n * 1000) / 1000;

/**
 * The set, counted. An "after" figure is null when the fixer did not run. A page measured incomplete
 * is not clean. A page not compared with the fixes (pageEntry) is counted as found in every "after"
 * figure, with nothing fixed and nothing introduced, and is named in `notComparable`.
 */
export function aggregate(pages) {
  const loaded = pages.filter((p) => p.loaded);
  const fixed = loaded.some((p) => p.remaining || p.fixedRender) || pages.some((p) => p.clean.after != null);
  const count = (pick) => loaded.reduce((n, p) => n + (pick(p) ?? 0), 0);
  const before = count((p) => p.findings.length);
  const after = fixed ? count((p) => findingsIfFixed(p).length) : null;
  const cured = fixed ? count((p) => p.findings.filter((f) => f.fixed === true).length) : null;
  // Findings on pages not compared with the fixes: counted as found, never judged fixed or not.
  const unjudged = fixed ? count((p) => (p.fixedRender?.comparable === false ? p.findings.length : 0)) : 0;
  const introduced = fixed ? count((p) => {
    const was = new Set(p.findings.map(findingKey));
    return (p.remaining ?? []).filter((f) => !was.has(findingKey(f))).length;
  }) : null;

  const rules = new Map();
  const row = (id) => {
    if (!rules.has(id)) rules.set(id, { rule: id, group: RULE[id]?.group ?? null, wcag: [...(RULE[id]?.wcag ?? [])], summary: RULE[id]?.summary ?? null, fix: RULE[id]?.fix ?? null, pages: { before: 0, after: fixed ? 0 : null }, findings: { before: 0, after: fixed ? 0 : null } });
    return rules.get(id);
  };
  for (const p of loaded) {
    const seen = new Set(), left = new Set();
    for (const f of p.findings) { const r = row(f.rule); r.findings.before += 1; if (!seen.has(f.rule)) { r.pages.before += 1; seen.add(f.rule); } }
    for (const f of fixed ? findingsIfFixed(p) : []) { const r = row(f.rule); r.findings.after += 1; if (!left.has(f.rule)) { r.pages.after += 1; left.add(f.rule); } }
  }
  return {
    pages: pages.length,
    loaded: loaded.length,
    notLoaded: pages.filter((p) => !p.loaded).map((p) => ({ input: p.input, error: p.error })),
    // Measured, but without a stylesheet, script or font it asked for: never counted clean.
    incomplete: loaded.filter((p) => p.incomplete).map((p) => ({ input: p.input, failed: p.failed.filter((f) => NEEDED.includes(f.type)) })),
    // Rendered with the fixes, but without a stylesheet, script or font it loaded as found, or not at all.
    notComparable: loaded.filter((p) => p.fixedRender?.comparable === false).map((p) => ({ input: p.input, lost: p.fixedRender.lost, error: p.fixedRender.error })),
    clean: { before: loaded.filter((p) => p.clean.before).length, after: fixed ? loaded.filter((p) => p.clean.after).length : null },
    violations: { before: count((p) => p.violations.before), after: fixed ? count((p) => p.violations.after ?? p.violations.before) : null },
    findings: { before, after, fixed: cured, introduced, ...(unjudged ? { notCompared: unjudged } : {}) },
    fixedWithoutModel: fixed ? { findings: cured, of: before, share: before ? round3(cured / before) : 0 } : null,
    byRule: [...rules.values()].sort((a, b) => b.findings.before - a.findings.before || a.rule.localeCompare(b.rule)),
  };
}

/**
 * The whole account. `meta` says what was run and how: the system, the engine, the widths, whether
 * the fixer ran, whether the network was refused (`offline`), when, and the command that repeats
 * it. `pageCommand` measures any one page the same way, with `roots` (the --root directories, as
 * typed); a page that could read a directory named above its own, or read a file in another one
 * named, carries its own `command`. The report lists the --root directories as `rootsShown` gives
 * them, without the auditor's directories. `policy` records that the rule overrides in
 * af.config.json were not applied, and which they were: every rule listed is checked at its default
 * severity, so the report reads the same whoever runs it.
 */
export function buildReport({ pages, system, engine, register = null, widths, sampled = [], seed = null, fix = false, offline = false, roots = [], rootsShown = roots, generated, command, policy = { applied: false, overrides: {} } }) {
  const scope = loadScope();
  const agg = aggregate(pages);
  const checked = [...new Set(pages.flatMap((p) => p.rulesChecked))];
  const ordered = RULES.map((r) => r.id).filter((id) => checked.includes(id));
  const findingsFor = (sc, of) => pages.reduce((n, p) => n + of(p).filter((f) => f.wcag.includes(sc)).length, 0);
  const wcag = scope.criteria.map((c) => {
    const rules = RULES.filter((r) => r.wcag.includes(c.sc)).map((r) => r.id);
    return { ...c, rules, checked: rules.filter((id) => ordered.includes(id)), findings: { before: findingsFor(c.sc, (p) => p.findings), after: fix ? findingsFor(c.sc, findingsIfFixed) : null } };
  });
  return {
    schema: 'af-audit/1',
    generated,
    engine,
    system,
    register,
    widths,
    sampled,
    seed,
    fix,
    offline,
    roots: rootsShown,
    written: false,
    command,
    pageCommand: pageCommand({ roots, widths, system: system?.arg ?? null, register, fix, offline }),
    policy,
    claim: CLAIM,
    rulesChecked: ordered,
    pages,
    aggregate: agg,
    wcag,
    notChecked: { doc: SCOPE_DOC, note: NOT_CHECKED.note, items: scope.notTested },
  };
}
