/**
 * The held-out rule split.
 *
 * Scoring our own approach with our own linter guarantees a win, so the rules the model is *told*
 * about and the rules it is *scored* on must be disjoint. The split is by group rather than by
 * individual rule: rules inside a group correlate heavily, so a random split would leak most of
 * the withheld set through its disclosed neighbours.
 *
 * Which groups are withheld is not arbitrary. Arms C-F all receive the token file, and the token
 * file already teaches colour and type by construction — a palette is a list of the colours you may
 * use. Withholding those would measure whether the model can read JSON, not whether the system
 * induces conformance. The withheld groups are the ones a token file cannot express: how a page is
 * laid out, how it behaves under interaction, what it must not do, and what it owes a reader who
 * cannot see it. A gain there is generalisation rather than transcription.
 */
import { RULES } from '../src/lib/rules/registry.mjs';

/** Groups whose rules are never shown to any arm, and on which the primary metric is computed. */
export const WITHHELD_GROUPS = ['layout', 'interaction', 'accessibility', 'absence', 'composition'];

/**
 * Not every withheld rule can be scored fairly across arms.
 *
 * Nine of them only fire on elements carrying the system's own attributes — `grid-off-column` needs
 * a `[data-grid]` container, `status-colour-only` needs `[data-status]`, and the composition rules
 * need a declared spread, panel or layer. An arm that was never told those attributes exist emits a
 * page that is never *eligible* to break them, and scores a perfect zero for it. Absence of
 * opportunity is not compliance, and counting it as compliance would flatter exactly the arm we
 * expect to be worst.
 *
 * There is a second, subtler exclusion. Arms C-F receive the token file, and a token file teaches
 * some of these rules outright: it lists the 8px spacing scale, the motion durations, the focus
 * colour and the register link colours. Scoring `spacing` as held-out would measure whether the
 * model can read a JSON array, not whether the system induces conformance — the same reason colour
 * and type were excluded from the withheld groups in the first place.
 *
 * What survives both exclusions is the set below: rules that apply to any HTML page, and that
 * nothing in any arm's context states. It began as nine, which was a smaller primary metric than we
 * started with and the only one that could carry a claim. `hidden-interactive` joined it when the
 * research report's fourth attack was closed: aria-hidden on a focusable control needs no attribute
 * of ours to fire, is named in no arm's context, and is exactly the kind of thing a model does when
 * it is optimising for a checker rather than for a reader.
 *
 * `content-not-dom`, which closed the same report's canvas attack, is *not* here: it lives in the
 * imagery group, which is disclosed, so arms E and above are told about it. That is the honest
 * placement — a rule an arm has been shown cannot measure whether the system generalises.
 */
export const UNIVERSAL_WITHHELD = [
  'aspect-ratio', 'horizontal-overflow',
  'focus-hidden', 'link-not-underlined',
  'target-size', 'alt-missing', 'hidden-interactive',
  'shadow-present', 'gradient-fill', 'radius-present',
];

/** Withheld rules excluded from the primary metric because an arm's own context teaches them. */
export const TAUGHT_BY_TOKENS = ['spacing', 'motion-off-scale', 'focus-restyled', 'link-colour-ii'];

export function split(withheld = WITHHELD_GROUPS) {
  const groups = [...new Set(RULES.map((r) => r.group))];
  const unknown = withheld.filter((g) => !groups.includes(g));
  if (unknown.length) throw new Error(`unknown rule group(s): ${unknown.join(', ')}`);

  const isWithheld = (r) => withheld.includes(r.group);
  const held = RULES.filter(isWithheld);
  const shown = RULES.filter((r) => !isWithheld(r));
  return {
    withheldGroups: [...withheld].sort(),
    disclosedGroups: groups.filter((g) => !withheld.includes(g)).sort(),
    withheld: held.map((r) => r.id).sort(),
    disclosed: shown.map((r) => r.id).sort(),
    universal: held.map((r) => r.id).filter((id) => UNIVERSAL_WITHHELD.includes(id)).sort(),
    gated: held.map((r) => r.id).filter((id) => !UNIVERSAL_WITHHELD.includes(id)).sort(),
  };
}

/** The rule text arms E and F are given: disclosed rules only, in the linter's own words. */
export function disclosedRuleText(withheld = WITHHELD_GROUPS) {
  const { disclosed } = split(withheld);
  const set = new Set(disclosed);
  const byGroup = new Map();
  for (const r of RULES) {
    if (!set.has(r.id)) continue;
    if (!byGroup.has(r.group)) byGroup.set(r.group, []);
    byGroup.get(r.group).push(r);
  }
  return [...byGroup]
    .map(([group, rules]) => `## ${group}\n${rules.map((r) => `- **${r.id}** — ${r.summary} ${r.why}`).join('\n')}`)
    .join('\n\n');
}

/**
 * Split a set of violations three ways. `universal` is the primary metric; `gated` is reported but
 * never compared across arms; anything unregistered counts as disclosed.
 */
export function partition(violations, withheld = WITHHELD_GROUPS) {
  const { withheld: held, universal } = split(withheld);
  const heldSet = new Set(held);
  const universalSet = new Set(universal);
  return {
    universal: violations.filter((v) => universalSet.has(v.rule)),
    gated: violations.filter((v) => heldSet.has(v.rule) && !universalSet.has(v.rule)),
    disclosed: violations.filter((v) => !heldSet.has(v.rule)),
  };
}
