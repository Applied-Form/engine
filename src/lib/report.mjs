/**
 * Compliance aggregation and reporting. Pure functions, no I/O — see scripts/report.mjs
 * for the CLI that reads `af lint --json` output, aggregates it, and appends history.
 *
 * A "run" is one team/target's lint output: { team, target, pages: [{ url, viewport,
 * register, violations: [{rule, message}], advisories: [...] }] }.
 */

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

function cleanRateOf(clean, pages) {
  return pages === 0 ? 0 : round3(clean / pages);
}

/** Aggregate an array of runs into a steward-facing summary. */
export function summarise(runs) {
  const teams = new Set();
  const targets = new Set();
  let pages = 0, clean = 0, violations = 0, advisories = 0;

  const ruleCounts = new Map(); // rule -> { count, targets: Set }
  const byTeamMap = new Map(); // team -> { pages, clean, violations }
  const pageRows = []; // for worstPages

  for (const run of runs) {
    const team = run.team ?? 'unassigned';
    const target = run.target ?? 'unknown';
    teams.add(team);
    targets.add(target);
    if (!byTeamMap.has(team)) byTeamMap.set(team, { pages: 0, clean: 0, violations: 0 });
    const teamRow = byTeamMap.get(team);

    for (const page of run.pages ?? []) {
      pages++;
      teamRow.pages++;
      const pageViolations = page.violations ?? [];
      const pageAdvisories = page.advisories ?? [];
      violations += pageViolations.length;
      advisories += pageAdvisories.length;
      teamRow.violations += pageViolations.length;
      if (pageViolations.length === 0) {
        clean++;
        teamRow.clean++;
      }

      for (const v of pageViolations) {
        if (!ruleCounts.has(v.rule)) ruleCounts.set(v.rule, { count: 0, targets: new Set() });
        const entry = ruleCounts.get(v.rule);
        entry.count++;
        entry.targets.add(target);
      }

      if (pageViolations.length > 0) {
        pageRows.push({ url: page.url, viewport: page.viewport, violations: pageViolations.length });
      }
    }
  }

  const byRule = [...ruleCounts.entries()]
    .map(([rule, { count, targets: t }]) => ({ rule, count, targets: [...t].sort() }))
    .sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule));

  const byTeam = [...byTeamMap.entries()]
    .map(([team, row]) => ({ team, pages: row.pages, clean: row.clean, violations: row.violations, cleanRate: cleanRateOf(row.clean, row.pages) }))
    .sort((a, b) => a.cleanRate - b.cleanRate || a.team.localeCompare(b.team));

  const worstPages = pageRows
    .sort((a, b) => b.violations - a.violations || a.url.localeCompare(b.url))
    .slice(0, 10);

  return {
    totals: { teams: teams.size, targets: targets.size, pages, clean, violations, advisories },
    byRule,
    byTeam,
    worstPages,
  };
}

/** Compare a current summary against a previous one (or null, for a first run). */
export function compare(current, previous) {
  const nowViolations = current.totals.violations;
  const nowCleanRate = cleanRateOf(current.totals.clean, current.totals.pages);

  if (!previous) {
    return {
      violations: { now: nowViolations, then: null, delta: null },
      cleanRate: { now: nowCleanRate, then: null, delta: null },
      newRules: current.byRule.map((r) => r.rule),
      fixedRules: [],
      regressedTeams: [],
      improvedTeams: [],
    };
  }

  const thenViolations = previous.totals.violations;
  const thenCleanRate = cleanRateOf(previous.totals.clean, previous.totals.pages);

  const nowRules = new Set(current.byRule.map((r) => r.rule));
  const thenRules = new Set(previous.byRule.map((r) => r.rule));
  const newRules = [...nowRules].filter((r) => !thenRules.has(r)).sort();
  const fixedRules = [...thenRules].filter((r) => !nowRules.has(r)).sort();

  const prevTeamRate = new Map(previous.byTeam.map((t) => [t.team, t.cleanRate]));
  const regressedTeams = [];
  const improvedTeams = [];
  for (const t of current.byTeam) {
    const before = prevTeamRate.get(t.team);
    if (before == null) continue;
    if (t.cleanRate < before) regressedTeams.push(t.team);
    else if (t.cleanRate > before) improvedTeams.push(t.team);
  }
  regressedTeams.sort();
  improvedTeams.sort();

  return {
    violations: { now: nowViolations, then: thenViolations, delta: nowViolations - thenViolations },
    cleanRate: { now: nowCleanRate, then: thenCleanRate, delta: round3(nowCleanRate - thenCleanRate) },
    newRules,
    fixedRules,
    regressedTeams,
    improvedTeams,
  };
}

function fmtDelta(delta, { lowerIsBetter = true } = {}) {
  if (delta == null) return '';
  if (delta === 0) return ' (no change)';
  const sign = delta > 0 ? '+' : '';
  const good = lowerIsBetter ? delta < 0 : delta > 0;
  return ` (${sign}${delta}${good ? ', improved' : ', regressed'})`;
}

/** Render a short markdown status update from a summary and optional comparison. */
export function toMarkdown(summary, comparison = null) {
  const { totals, byRule, byTeam } = summary;
  const cleanRate = cleanRateOf(totals.clean, totals.pages);
  const lines = [];

  lines.push('# Compliance report');
  lines.push('');
  lines.push(`${totals.clean}/${totals.pages} pages clean (${(cleanRate * 100).toFixed(1)}%) across ${totals.teams} team(s) and ${totals.targets} target(s) — ${totals.violations} violation(s), ${totals.advisories} advisory(ies).`);
  lines.push('');

  lines.push('## Teams by clean rate');
  lines.push('');
  lines.push('| Team | Pages | Clean | Violations | Clean rate |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const t of byTeam) {
    lines.push(`| ${t.team} | ${t.pages} | ${t.clean} | ${t.violations} | ${(t.cleanRate * 100).toFixed(1)}% |`);
  }
  lines.push('');

  lines.push('## Top offending rules');
  lines.push('');
  if (byRule.length === 0) {
    lines.push('No violations.');
  } else {
    lines.push('| Rule | Count | Targets |');
    lines.push('| --- | --- | --- |');
    for (const r of byRule.slice(0, 10)) {
      lines.push(`| ${r.rule} | ${r.count} | ${r.targets.join(', ')} |`);
    }
  }
  lines.push('');

  if (comparison) {
    lines.push('## Trend');
    lines.push('');
    if (comparison.violations.then == null) {
      lines.push('No previous run to compare against.');
    } else {
      lines.push(`Violations: ${comparison.violations.now} (was ${comparison.violations.then})${fmtDelta(comparison.violations.delta)}`);
      lines.push('');
      lines.push(`Clean rate: ${(comparison.cleanRate.now * 100).toFixed(1)}% (was ${(comparison.cleanRate.then * 100).toFixed(1)}%)${fmtDelta(comparison.cleanRate.delta, { lowerIsBetter: false })}`);
      if (comparison.newRules.length) lines.push(`New rule violations: ${comparison.newRules.join(', ')}`);
      if (comparison.fixedRules.length) lines.push(`Fixed rule violations: ${comparison.fixedRules.join(', ')}`);
      if (comparison.regressedTeams.length) lines.push(`Regressed teams: ${comparison.regressedTeams.join(', ')}`);
      if (comparison.improvedTeams.length) lines.push(`Improved teams: ${comparison.improvedTeams.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}
