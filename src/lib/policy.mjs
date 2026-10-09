/**
 * Rollout policy: severity and baseline.
 *
 * A design system that reports sixty-seven kinds of violation against an existing codebase reports
 * thousands on the first run, and gets switched off in the first week. Two mechanisms make adoption
 * survivable, and neither weakens the rules:
 *
 *   Severity  — a team may run a rule as `error` (fails the build), `warn` (reported, does not fail)
 *               or `off`. The default for every rule is `error`; lowering one is a local, recorded
 *               choice in af.config.json, not a change to the system.
 *   Baseline  — a snapshot of the violations a codebase already has. Everything in the baseline is
 *               reported as known and does not fail; anything beyond it is new and does. A team
 *               burns the baseline down on its own schedule while being held to the line from today.
 *
 * These are pure functions over lint results so they can be unit-tested without a browser, and so
 * lint-page and lint-site apply exactly the same policy.
 */
import { readFileSync, existsSync } from 'node:fs';
import { relative } from 'node:path';

export const SEVERITIES = ['error', 'warn', 'off'];
export const BASELINE_VERSION = 1;

/** The part of a violation that identifies *where* it is, without the measured numbers that move. */
function locate(v) {
  const candidates = [
    v.text?.sample, v.link?.sample, v.imagery?.sample, v.item?.sample, v.status?.label,
    v.item?.className, v.item?.element, v.spread?.name, v.heading?.sample,
    typeof v.heading === 'string' ? v.heading : null, v.imagery?.tag, v.focus?.element,
    v.motion?.property, v.value !== undefined ? String(v.value) : null,
    v.chart?.generated, v.link ? 'link' : null,
  ];
  for (const c of candidates) if (typeof c === 'string' && c.trim()) return c.trim().slice(0, 60);
  return '';
}

/**
 * A stable identity for a violation: the rule and where it is, never the measurement. A colour that
 * moves from 3.7:1 to 3.9:1 stays the same known violation rather than reappearing as a new one.
 */
export function fingerprint(v) {
  return `${v.rule}|${locate(v)}`;
}

/**
 * Which page a result belongs to, stable across machines and environments: a file URL becomes a
 * repo-relative path, an http URL becomes its pathname, so a baseline taken on staging still
 * applies in production.
 */
export function pageKey(url, viewport, cwd = process.cwd()) {
  let page = url;
  if (url.startsWith('file://')) {
    try { page = relative(cwd, decodeURIComponent(new URL(url).pathname)) || url; } catch { /* keep url */ }
  } else if (/^https?:/.test(url)) {
    try { const u = new URL(url); page = u.pathname + (u.search || ''); } catch { /* keep url */ }
  }
  return `${page}@${viewport}`;
}

/**
 * Read af.config.json (or an explicit path).
 *
 * A missing *implicit* file is not an error: the defaults are the system's. A missing *explicit*
 * path is, because a typo in `--config af.confg.json` would otherwise silently run every rule at
 * `error` with no baseline, and the run would pass or fail for the wrong reason without a word.
 */
export function loadConfig(pathOrCwd = process.cwd()) {
  const explicit = pathOrCwd.endsWith('.json');
  const file = explicit ? pathOrCwd : `${pathOrCwd}/af.config.json`;
  if (!existsSync(file)) {
    if (explicit) throw new Error(`config file not found: ${file}`);
    return { rules: {}, baseline: null, source: null };
  }
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  for (const [id, sev] of Object.entries(raw.rules ?? {})) {
    if (!SEVERITIES.includes(sev)) throw new Error(`${file}: rule "${id}" has severity "${sev}"; expected one of ${SEVERITIES.join(', ')}`);
  }
  return { rules: raw.rules ?? {}, baseline: raw.baseline ?? null, source: file };
}

export function severityOf(rule, config = {}) {
  return config.rules?.[rule] ?? 'error';
}

/**
 * Read a baseline file, or an empty one. `required` makes a missing file an error — used when the
 * path was given explicitly on the command line, for the same reason as loadConfig.
 */
export function loadBaseline(file, { required = false } = {}) {
  if (!file) return { version: BASELINE_VERSION, entries: {} };
  if (!existsSync(file)) {
    if (required) throw new Error(`baseline file not found: ${file}`);
    return { version: BASELINE_VERSION, entries: {} };
  }
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  if (raw.version !== BASELINE_VERSION) throw new Error(`${file}: baseline version ${raw.version}, expected ${BASELINE_VERSION}`);
  return raw;
}

/** Count every violation in a set of results, keyed by page and fingerprint. This is the baseline. */
export function buildBaseline(results, { cwd = process.cwd(), stamp = null } = {}) {
  const entries = {};
  for (const r of results) {
    const key = pageKey(r.url, r.viewport, cwd);
    for (const v of r.violations) {
      entries[key] ??= {};
      entries[key][fingerprint(v)] = (entries[key][fingerprint(v)] ?? 0) + 1;
    }
  }
  return { version: BASELINE_VERSION, recorded: stamp, entries };
}

/**
 * Split each result's violations into errors, warnings and known (baselined), and say whether the
 * run fails. Baselining is applied before severity: a known violation is known whatever its severity.
 * Counts matter — three identical violations baselined, then a fourth appears, and the fourth is new.
 */
export function applyPolicy(results, { config = {}, baseline = null, cwd = process.cwd() } = {}) {
  const remaining = new Map();
  for (const [key, fps] of Object.entries(baseline?.entries ?? {})) remaining.set(key, new Map(Object.entries(fps)));

  const out = results.map((r) => {
    const key = pageKey(r.url, r.viewport, cwd);
    const left = remaining.get(key);
    const errors = [], warnings = [], known = [];
    for (const v of r.violations) {
      const fp = fingerprint(v);
      const n = left?.get(fp) ?? 0;
      if (n > 0) { left.set(fp, n - 1); known.push(v); continue; }
      const severity = severityOf(v.rule, config);
      if (severity === 'error') errors.push(v);
      else if (severity === 'warn') warnings.push(v);
    }
    return { ...r, errors, warnings, known, key };
  });

  // Anything still owed by the baseline *on a page this run visited* was not seen: it has been
  // fixed, and the baseline can shrink. Reporting it is what makes a burn-down visible. Pages the
  // run did not visit are not counted — "not linted today" is not "fixed", and saying so would tell
  // the user to rewrite a baseline that would then forget those pages.
  const visited = new Set(out.map((r) => r.key));
  let fixed = 0;
  const fixedRules = new Set();
  for (const [key, fps] of remaining) {
    if (!visited.has(key)) continue;
    for (const [fp, n] of fps) if (n > 0) { fixed += n; fixedRules.add(fp.split('|')[0]); }
  }

  const summary = {
    errors: out.reduce((s, r) => s + r.errors.length, 0),
    warnings: out.reduce((s, r) => s + r.warnings.length, 0),
    known: out.reduce((s, r) => s + r.known.length, 0),
    fixed,
    fixedRules: [...fixedRules].sort(),
    pages: out.length,
    clean: out.filter((r) => r.errors.length === 0).length,
  };
  return { results: out, summary, failed: summary.errors > 0 };
}

/**
 * Merge a freshly recorded baseline into an existing one. Pages this run visited take the new
 * record (including an empty one: a page that is now clean loses its entries); pages it did not
 * visit keep theirs. Without this, `af baseline one-page.html` would silently discard every other
 * page's known violations, and the next full run would fail on all of them.
 */
export function mergeBaseline(previous, fresh, visitedKeys) {
  const entries = { ...(previous?.entries ?? {}) };
  for (const key of visitedKeys) delete entries[key];
  Object.assign(entries, fresh.entries);
  const kept = Object.keys(previous?.entries ?? {}).filter((k) => !visitedKeys.has(k));
  return { baseline: { ...fresh, entries }, kept };
}

/**
 * Split a lint command line into pages and options. `--baseline` takes an optional value, and the
 * only way to keep `--baseline page.html` from swallowing the page is to accept a value there only
 * when it looks like one: a path ending in .json. `--config`, `--out`, `--richness`, `--sample`
 * and `--seed` always take one — `--sample 0` turns sampling off, and a zero has to be readable
 * as a value rather than as a page nobody named.
 */
export function splitArgs(argv) {
  const files = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { files.push(a); continue; }
    const name = a.slice(2);
    const next = argv[i + 1];
    const takesValue = ['config', 'out', 'richness', 'sample', 'seed', 'register'].includes(name);
    const optionalJson = name === 'baseline' && next && next.endsWith('.json');
    if ((takesValue && next && !next.startsWith('--')) || optionalJson) { opts[name] = next; i += 1; }
    else opts[name] = true;
  }
  return { files, opts };
}

/** Rules switched off or downgraded, for the run's own report. A quiet exception is not an exception. */
export function policyNotes(config = {}) {
  return Object.entries(config.rules ?? {})
    .filter(([, sev]) => sev !== 'error')
    .map(([rule, sev]) => `${rule}: ${sev}`)
    .sort();
}
