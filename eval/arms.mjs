/**
 * The six conditions.
 *
 * Every arm gets an identical task instruction and an identical brief. They differ only in what
 * design-system context is attached, and whether the linter runs.
 *
 *   A none         the control
 *   B prose        a written style guide — what most design systems actually are
 *   C tokens       the DTCG token file, no rules
 *   D components   a built stylesheet and its markup contract
 *   E rules-read   tokens plus the disclosed rules, stated precisely
 *   F rules-run    the same as E, plus the linter in a repair loop
 *
 * B and E carry the same information and differ only in how precisely it is written, so B→E
 * isolates the value of precision. E and F carry identical context and differ only in the loop, so
 * E→F isolates the value of executable feedback. That second comparison is the study's reason to
 * exist: if E ≈ F, the linter earns nothing that the written rules had not already earned.
 *
 * B is synthesised from the same disclosed rules rather than being a real third-party guide. That
 * keeps it information-equivalent to E, which is what the comparison needs, but it does mean B is a
 * fair-minded reconstruction of the incumbent rather than a sample of one. Stated as a limitation.
 */
import { readFileSync } from 'node:fs';
import { RULES } from '../src/lib/rules/registry.mjs';
import { split, disclosedRuleText, WITHHELD_GROUPS } from './split.mjs';

export const ARMS = ['none', 'prose', 'tokens', 'components', 'rules-read', 'rules-compiled', 'rules-run', 'rules-run-primed'];

/**
 * The constraint budget, and why two more arms exist.
 *
 * Arm E hands a model forty-six rules as text. The instruction-following literature — the same
 * work the sister programme's schema v0.4 is built on — measures follow rate falling from about
 * 96% at one instruction to between 20% and 60% at twenty, non-linearly. Forty-six is well past
 * that. So a win for arm F over arm E would be partly a measurement of prompt length: the loop
 * beating a context we had overloaded, rather than the loop beating the rules.
 *
 * `rules-compiled` is arm E with that fixed: the same rules, compiled to a core of at most twenty
 * statements, clustered by category, with the floors stated at both ends because compliance is
 * measurably highest at the edges of a prompt. If F still beats *that*, the loop is earning
 * something the written rules cannot buy at any length. If it does not, the honest conclusion is
 * that the executable half was competing with a badly written prompt.
 *
 * `rules-run-primed` is arm F with the brief and the register's intent restated in every repair
 * round. A loop repairs toward the thing it is told about, and a loop told only about violations
 * optimises the page away from the design. The literature's caution about iterative refinement
 * degrading quality is precisely this, and the two arms measure it rather than assuming either way.
 */
export const CONSTRAINT_BUDGET = 20;

export const TASK = `You are producing one self-contained HTML page.

Requirements that apply to every page you produce here:
- A single HTML file. Inline all CSS in one <style> element. No external requests of any kind — no
  webfonts, no CDN scripts, no remote images. Use inline SVG if you need a figure.
- Real content. Write the actual copy the brief calls for; do not use lorem ipsum or leave
  placeholders.
- Output the HTML file and nothing else. No commentary before or after, no markdown fences.`;

/** The disclosed rules restated as a written guide, the way a design system's documentation reads. */
export function proseGuide(withheld = WITHHELD_GROUPS) {
  const shown = new Set(split(withheld).disclosed);
  const byGroup = new Map();
  for (const r of RULES) {
    if (!shown.has(r.id)) continue;
    if (!byGroup.has(r.group)) byGroup.set(r.group, []);
    byGroup.get(r.group).push(r);
  }
  const sections = [...byGroup].map(([group, rules]) => {
    const body = rules.map((r) => {
      const s = r.summary.replace(/\.$/, '');
      // Guidance voice: a sentence a designer would read, with the reasoning attached, and no
      // machine-checkable identifier to anchor on.
      return `${s[0].toUpperCase()}${s.slice(1)}. ${r.why}`;
    }).join(' ');
    return `### ${group[0].toUpperCase()}${group.slice(1)}\n\n${body}`;
  });
  return `# The design guide\n\nThis is how our work should look and behave. Follow it as closely as you can.\n\n${sections.join('\n\n')}`;
}

/** The token file, trimmed to what a page author needs and rendered as the DTCG source. */
export function tokenContext(tokenFile) {
  const t = JSON.parse(readFileSync(tokenFile, 'utf8'));
  const keep = ['color', 'spacing', 'font', 'type', 'display', 'grid', 'motion', 'register', 'chart', 'focus', 'opacity', 'state'];
  const trimmed = Object.fromEntries(Object.entries(t).filter(([k]) => keep.includes(k)));
  return `# Design tokens (DTCG)\n\nThese are the only colours, sizes, spacing steps, and type settings you may use.\n\n\`\`\`json\n${JSON.stringify(trimmed, null, 2)}\n\`\`\``;
}

export function componentContext(cssFile, tokensCssFile) {
  const css = readFileSync(cssFile, 'utf8');
  const vars = readFileSync(tokensCssFile, 'utf8');
  const classes = [...new Set([...css.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]))].sort();
  return `# The component stylesheet\n\nInclude this stylesheet verbatim in your page and build the page from its classes.\n\n\`\`\`css\n${vars}\n${css}\n\`\`\`\n\nAvailable classes: ${classes.join(', ')}`;
}

export function ruleContext(withheld = WITHHELD_GROUPS) {
  return `# The rules\n\nEvery page is checked against these rules. A page that breaks one is rejected.\n\n${disclosedRuleText(withheld)}`;
}

/**
 * The same rules, compiled to the constraint budget: the floors first, then at most twenty
 * statements clustered by the thing they govern, then the floors again.
 *
 * Selection is by group rather than by cherry-picking, so which rules survive is a property of
 * the rule set rather than of whoever wrote this. The floors are repeated deliberately; that is
 * one set of rules stated twice, not two, and it is the position where compliance is highest.
 */
export function compiledRuleContext(withheld = WITHHELD_GROUPS, budget = CONSTRAINT_BUDGET) {
  const { disclosed } = split(withheld);
  const shown = new Set(disclosed);
  const rules = RULES.filter((r) => shown.has(r.id) && r.severity === 'error');

  // The floors are the statements that never vary and never yield. They are named rather than
  // detected, because "which of these is a floor" is a design decision, not a property of the id.
  const FLOOR_IDS = ['contrast', 'text-too-small', 'body-too-small', 'measure', 'focus-hidden', 'status-colour-only'];
  const floorRules = rules.filter((r) => FLOOR_IDS.includes(r.id));
  const rest = rules.filter((r) => !FLOOR_IDS.includes(r.id));

  const byGroup = new Map();
  for (const r of rest) {
    if (!byGroup.has(r.group)) byGroup.set(r.group, []);
    byGroup.get(r.group).push(r);
  }
  // One statement per rule, taken group by group in turn, so no single group fills the budget.
  const chosen = [];
  const queues = [...byGroup.values()];
  while (chosen.length < budget - floorRules.length && queues.some((q) => q.length)) {
    for (const q of queues) {
      if (!q.length || chosen.length >= budget - floorRules.length) continue;
      chosen.push(q.shift());
    }
  }

  const floorsText = floorRules.map((r) => `- ${r.summary}`).join('\n');
  const grouped = [...new Set(chosen.map((r) => r.group))]
    .map((g) => `**${g[0].toUpperCase()}${g.slice(1)}.** ${chosen.filter((r) => r.group === g).map((r) => r.summary).join(' ')}`)
    .join('\n\n');

  return [
    '# The rules',
    '',
    'These never vary, whatever else you do:',
    floorsText,
    '',
    grouped,
    '',
    'Before you produce the page, check these again — they are the ones that never vary:',
    floorsText,
  ].join('\n');
}

/** Assemble the context for an arm. `assets` carries the file paths the arms read from. */
export function contextFor(arm, assets) {
  switch (arm) {
    case 'none': return '';
    case 'prose': return proseGuide();
    case 'tokens': return tokenContext(assets.tokenFile);
    case 'components': return componentContext(assets.componentsCss, assets.tokensCss);
    case 'rules-read':
    case 'rules-run':
    case 'rules-run-primed': return `${tokenContext(assets.tokenFile)}\n\n${ruleContext()}`;
    case 'rules-compiled': return `${tokenContext(assets.tokenFile)}\n\n${compiledRuleContext()}`;
    default: throw new Error(`unknown arm: ${arm}`);
  }
}

export function promptFor(brief, arm, assets) {
  const context = contextFor(arm, assets);
  const register = brief.register === 'i'
    ? 'This page is brand-facing: expressive, and it is the first thing a reader meets.'
    : 'This page is a working document: it is relied on, read closely, and returned to.';
  return [TASK, context, `# The brief\n\n${brief.brief}\n\n${register}`].filter(Boolean).join('\n\n---\n\n');
}

/** What arm F is told after a failing lint. Richness of this text is itself an ablation. */
/** The arms that run the linter and repair. Everything else is one shot. */
export const REPAIR_ARMS = new Set(['rules-run', 'rules-run-primed']);

export function repairPrompt(violations, richness = 'full', intent = null) {
  if (!violations.length) return null;
  if (richness === 'exit') return 'The page failed the check. Fix it and return the corrected page.';
  if (richness === 'id') {
    const ids = [...new Set(violations.map((v) => v.rule))];
    return `The page failed these rules: ${ids.join(', ')}. Fix them and return the corrected page.`;
  }
  // The remedy travels with the failure. A loop is only worth as much as the feedback it
  // returns: a model told "measure must be =<66ch" has to infer what to change, and one told
  // "cap the block at the measure, or give it fewer columns" does not. Which of those is worth
  // more is an ablation the protocol names, and this is the arm it needs.
  const fixOf = Object.fromEntries(RULES.map((r) => [r.id, r.fix]));
  const lines = violations.map((v) => {
    const sample = v.text?.sample ? ` [${v.text.sample}]` : '';
    const fix = fixOf[v.rule] ? ` Fix: ${fixOf[v.rule]}` : '';
    return `- ${v.rule}: ${v.message}${sample}${fix}`;
  });
  // Arm G restates what the page is *for* in every round. A loop repairs toward what it is told
  // about, so a loop told only about violations optimises the page away from the brief.
  const head = intent ? `You are still producing this page:\n\n${intent}\n\n` : '';
  return `${head}The page failed the check:\n\n${lines.join('\n')}\n\nFix every one and return the corrected page in full, keeping the design you intended.`;
}
