import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarise, compare, toMarkdown } from '../src/lib/report.mjs';

function page(url, viewport, violations = [], advisories = []) {
  return { url, viewport, register: 'ii', violations, advisories };
}

const runsA = [
  {
    team: 'alpha',
    target: 'marketing-site',
    pages: [
      page('https://a.example/home', 1280, []),
      page('https://a.example/about', 1280, [{ rule: 'contrast', message: 'too low' }]),
      page('https://a.example/pricing', 1280, [
        { rule: 'contrast', message: 'too low' },
        { rule: 'spacing', message: 'off-grid' },
      ]),
    ],
  },
  {
    team: 'beta',
    target: 'docs-site',
    pages: [
      page('https://b.example/index', 672, []),
      page('https://b.example/guide', 672, []),
      page('https://b.example/faq', 672, [{ rule: 'contrast', message: 'too low' }]),
    ],
  },
];

test('summarise aggregates totals, cleanRate ordering, and byRule ordering across two teams', () => {
  const s = summarise(runsA);

  assert.equal(s.totals.teams, 2);
  assert.equal(s.totals.targets, 2);
  assert.equal(s.totals.pages, 6);
  assert.equal(s.totals.clean, 3);
  assert.equal(s.totals.violations, 4);
  assert.equal(s.totals.advisories, 0);

  // byTeam sorted by cleanRate ascending: alpha (1/3 = 0.333) before beta (2/3 = 0.667)
  assert.equal(s.byTeam.length, 2);
  assert.equal(s.byTeam[0].team, 'alpha');
  assert.equal(s.byTeam[0].cleanRate, 0.333);
  assert.equal(s.byTeam[0].pages, 3);
  assert.equal(s.byTeam[0].clean, 1);
  assert.equal(s.byTeam[0].violations, 3);
  assert.equal(s.byTeam[1].team, 'beta');
  assert.equal(s.byTeam[1].cleanRate, 0.667);

  // byRule sorted by count descending: contrast (3) before spacing (1)
  assert.equal(s.byRule.length, 2);
  assert.equal(s.byRule[0].rule, 'contrast');
  assert.equal(s.byRule[0].count, 3);
  assert.deepEqual(s.byRule[0].targets, ['docs-site', 'marketing-site']);
  assert.equal(s.byRule[1].rule, 'spacing');
  assert.equal(s.byRule[1].count, 1);

  // worstPages: pricing has 2 violations, the highest
  assert.equal(s.worstPages[0].url, 'https://a.example/pricing');
  assert.equal(s.worstPages[0].violations, 2);
});

test('summarise defaults team/target labels and handles an all-clean run', () => {
  const runs = [{ pages: [page('https://c.example/x', 320, [])] }];
  const s = summarise(runs);
  assert.equal(s.byTeam[0].team, 'unassigned');
  assert.equal(s.totals.clean, 1);
  assert.equal(s.byRule.length, 0);
  assert.equal(s.worstPages.length, 0);
});

test('compare with previous run shows an improvement and a regression', () => {
  const previous = summarise([
    {
      team: 'alpha',
      target: 'marketing-site',
      pages: [page('p1', 1280, []), page('p2', 1280, []), page('p3', 1280, [{ rule: 'contrast', message: 'x' }])],
    },
    {
      team: 'beta',
      target: 'docs-site',
      pages: [page('p4', 672, []), page('p5', 672, []), page('p6', 672, [])],
    },
  ]);
  // alpha improves from 2/3 clean to 1/3... wait construct explicit deltas below instead.
  const current = summarise(runsA);
  const c = compare(current, previous);

  assert.equal(c.violations.now, 4);
  assert.equal(c.violations.then, 1);
  assert.equal(c.violations.delta, 3);

  assert.equal(c.cleanRate.now, 0.5);
  assert.equal(c.cleanRate.then, round(5 / 6));
  assert.ok(c.cleanRate.delta < 0);

  // alpha: previous cleanRate 0.667 -> now 0.333 => regressed
  assert.ok(c.regressedTeams.includes('alpha'));
  // beta: previous cleanRate 1 -> now 0.667 => regressed
  assert.ok(c.regressedTeams.includes('beta'));
  assert.equal(c.improvedTeams.length, 0);

  // new rule 'spacing' appears in current but not previous
  assert.ok(c.newRules.includes('spacing'));
  assert.equal(c.fixedRules.length, 0);

  function round(n) { return Math.round(n * 1000) / 1000; }
});

test('compare with previous run also detects an improved team and a fixed rule', () => {
  const previous = summarise([
    {
      team: 'alpha',
      target: 'marketing-site',
      pages: [page('p1', 1280, [{ rule: 'contrast', message: 'x' }]), page('p2', 1280, [{ rule: 'layout', message: 'y' }])],
    },
  ]);
  const current = summarise([
    {
      team: 'alpha',
      target: 'marketing-site',
      pages: [page('p1', 1280, []), page('p2', 1280, [])],
    },
  ]);
  const c = compare(current, previous);
  assert.equal(c.violations.now, 0);
  assert.equal(c.violations.then, 2);
  assert.equal(c.violations.delta, -2);
  assert.equal(c.cleanRate.now, 1);
  assert.ok(c.improvedTeams.includes('alpha'));
  assert.equal(c.regressedTeams.length, 0);
  assert.deepEqual(c.fixedRules.sort(), ['contrast', 'layout']);
  assert.equal(c.newRules.length, 0);
});

test('compare with previous null returns null deltas and lists all current rules as new', () => {
  const current = summarise(runsA);
  const c = compare(current, null);
  assert.equal(c.violations.then, null);
  assert.equal(c.violations.delta, null);
  assert.equal(c.cleanRate.then, null);
  assert.deepEqual(c.newRules.sort(), ['contrast', 'spacing']);
  assert.equal(c.fixedRules.length, 0);
  assert.equal(c.regressedTeams.length, 0);
  assert.equal(c.improvedTeams.length, 0);
});

test('toMarkdown includes the headline numbers, each team name, and the trend section', () => {
  const current = summarise(runsA);
  const previous = summarise([
    { team: 'alpha', target: 'marketing-site', pages: [page('p1', 1280, [])] },
  ]);
  const c = compare(current, previous);
  const md = toMarkdown(current, c);

  assert.match(md, /# Compliance report/);
  assert.match(md, /3\/6 pages clean/);
  assert.match(md, /alpha/);
  assert.match(md, /beta/);
  assert.match(md, /contrast/);
  assert.match(md, /## Trend/);
  assert.match(md, /Violations: 4 \(was 0\)/);

  const mdNoComparison = toMarkdown(current, null);
  assert.doesNotMatch(mdNoComparison, /## Trend/);
});
