/**
 * H4, operationalised: does conformance mean quality?
 *
 * The protocol has specified blind pairwise preference since the start — judges from more than one
 * model family, validated against a human-labelled subset, inter-rater agreement reported, and a
 * standing ban on a judge from the generator's own family being the only judge. What it did not
 * have was any of the operational decisions that make a judging round reproducible rather than
 * improvised: how items are built, how many, what the judge is actually asked, which judges are
 * thrown out, and how the result is related to the conformance rate. Those are here, in code, so
 * they are fixed before any judgement exists rather than chosen after seeing some.
 *
 * Why this matters more than it sounds. The conformance rate is *proven* not to track quality: a
 * page with no CSS at all scored one violation out of nine rules, better than most designed pages
 * (`docs/evaluation-protocol.md`, the two attacks that succeeded). So a successful study — arm
 * `rules-run` beating arm `prose` on conformance — establishes only that the gate enforces its own
 * rules. The first question any reader asks next is whether the pages are *better*, and without
 * this the answer is a shrug.
 *
 * Three decisions carry the design.
 *
 * **Anchors, not just arms.** Every judging round smuggles in two pages whose standing is already
 * known: an unstyled page, which conformance scores near-perfectly and which no designer would
 * ship, and a human-designed page. If the unstyled floor anchor does not lose, the preference
 * instrument is not measuring design and nothing else in the round can be trusted. That check runs
 * before any arm comparison is reported, and it can fail the whole round. It is the same move as
 * attacking our own linter: give the instrument a question whose answer we already know.
 *
 * **Within-brief only.** A page for one brief is never compared with a page for another. Across
 * briefs the content differs, so a judge rates subject matter as much as execution, and arm is
 * confounded with whatever the brief happened to be about.
 *
 * **The correlation is pre-registered with its sign.** Positive, and conformance is a usable proxy
 * for quality. Flat, and the gate enforces conformance and nothing more — publishable, and the
 * honest ceiling on every claim this project makes. Negative, and the system makes pages worse,
 * which is the outcome that must be published most loudly of the three and is the one nobody
 * commits to in advance. Written down here before any data exists.
 *
 * What preference cannot settle, because a measurement that hides its limits is a claim: it is not
 * fitness for purpose, a panel of strangers is not the client's brand steward, and a verdict on one
 * page says nothing about consistency across fifty — which is what a design system actually sells
 * and which H3 measures separately. At pilot scale the correlation across eight arms is descriptive
 * with a wide interval, not a hypothesis test, and `summarise()` refuses to present it as one.
 */

/** The pairs worth a judge's time, and the hypothesis each one is for. Pre-registered. */
export const PAIRS = [
  { a: 'none', b: 'rules-run', asks: 'whether the system helps at all' },
  { a: 'prose', b: 'rules-run', asks: 'H1: executable against the same rules written down' },
  { a: 'rules-read', b: 'rules-run', asks: 'H2, the comparison the study exists for' },
  { a: 'rules-run', b: 'rules-run-primed', asks: 'P10: where conformance and quality come apart' },
  { a: 'components', b: 'rules-run', asks: 'against the thing teams actually buy instead' },
];

/** What a judge is asked. One question, because a judge asked five is answering none of them well. */
export const QUESTION =
  'Which of these two pages would you be more comfortable publishing under your own organisation\'s '
  + 'name? Answer "a", "b", or "tie" if you genuinely cannot separate them. Do not explain.';

/**
 * The anchors. `floor` is a page conformance rates highly and no one would ship; `ceiling` is one a
 * person designed. Both are compared against the arm pages, and the floor must lose.
 */
export const ANCHOR_KINDS = ['floor', 'ceiling'];

/** Deterministic PRNG, so an item set is reproducible from its seed and can be pre-registered. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const keyOf = (r) => `${r.brief}|${r.model}|${r.arm}|${r.sample ?? 0}`;

/**
 * Build the item set.
 *
 * Every pair appears in both left/right orders across the set, so a judge who always picks the
 * right-hand side cancels out instead of becoming a result. Attention checks are interleaved at a
 * fixed rate rather than appended, because a block of them at the end is a block a judge can learn
 * to recognise.
 */
export function buildItems(records, { seed = 1, anchors = [], broken = [], attentionEvery = 8 } = {}) {
  const usable = records.filter((r) => !r.failed && r.file);
  const byBrief = new Map();
  // A group is one sample of one brief from one model: sample s of one arm meets sample s of the
  // other. Keyed by brief and model alone, the group kept whichever row came last for each arm,
  // and once cells ran concurrently that was decided by how fast a model answered.
  for (const r of usable) {
    const k = `${r.brief}|${r.model}|${r.sample ?? 0}`;
    if (!byBrief.has(k)) byBrief.set(k, new Map());
    byBrief.get(k).set(r.arm, r);
  }

  const items = [];
  const pick = rng(seed);
  for (const [group, arms] of [...byBrief].sort(([x], [y]) => x.localeCompare(y))) {
    const [brief, model, sample] = group.split('|');
    const add = (left, right, meta) => {
      // Both orders, so position cannot become the finding.
      for (const flip of [false, true]) {
        items.push({
          id: `${group}|${meta.kind}|${meta.asks ?? meta.anchor}|${flip ? 'ba' : 'ab'}`,
          brief, model, ...meta,
          left: flip ? right : left,
          right: flip ? left : right,
        });
      }
    };

    for (const p of PAIRS) {
      const [x, y] = [arms.get(p.a), arms.get(p.b)];
      if (x && y) add(keyOf(x), keyOf(y), { kind: 'arm', a: p.a, b: p.b, asks: p.asks });
    }
    // Anchors go against the strongest arm present, which is the comparison that can embarrass us.
    // They may be given per group — a function of the brief, the model and the strongest page —
    // because the within-brief rule applies to anchors too: an unstyled page is only a fair floor
    // for a brief if it is that brief's content with the styling removed.
    // By a fixed order, never by which row arrived first: the anchor and the attention check are
    // both cut from this page.
    const strongest = arms.get('rules-run') ?? arms.get('rules-compiled') ?? arms.get([...arms.keys()].sort()[0]);
    if (strongest) {
      const groupAnchors = typeof anchors === 'function' ? anchors({ brief, model, sample, strongest }) : anchors;
      for (const anchor of groupAnchors) {
        add(anchor.key, keyOf(strongest), { kind: 'anchor', anchor: anchor.kind, anchorKey: anchor.key, against: strongest.arm });
      }
    }
  }

  // Interleave the attention checks. A judge who prefers a page truncated mid-tag is not judging.
  const out = [];
  let since = 0;
  const checks = [...broken];
  for (const item of items.sort(() => pick() - 0.5)) {
    out.push(item);
    since += 1;
    if (since >= attentionEvery && checks.length) {
      const c = checks.shift();
      out.push({ id: `check|${c.key}`, kind: 'check', brief: null, model: null, left: c.key, right: c.against, expect: 'right' });
      since = 0;
    }
  }
  return out;
}

/** Spearman rank correlation. Ties take the mean rank, which matters at eight arms. */
export function spearman(xs, ys) {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const rank = (v) => {
    const order = v.map((value, i) => ({ value, i })).sort((p, q) => p.value - q.value);
    const r = new Array(v.length);
    for (let i = 0; i < order.length;) {
      let j = i;
      while (j + 1 < order.length && order[j + 1].value === order[i].value) j += 1;
      const mean = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[order[k].i] = mean;
      i = j + 1;
    }
    return r;
  };
  const [rx, ry] = [rank(xs), rank(ys)];
  const n = xs.length;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / n;
  const [mx, my] = [mean(rx), mean(ry)];
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx === 0 || dy === 0 ? null : Number((num / Math.sqrt(dx * dy)).toFixed(4));
}

/**
 * The three pre-registered outcomes, as a function of the correlation's sign.
 *
 * Separate from `summarise` so each branch can be tested on its own, and so the interpretation is
 * one readable function rather than a ternary nobody checks. The thresholds are deliberately wide:
 * at eight arms the interval around any correlation is far too broad to treat a number near zero
 * as anything but "unrelated here".
 */
export function readCorrelation(correlation) {
  if (correlation === null) return 'not computable: fewer than three arms carry both numbers';
  if (correlation > 0.4) return 'conformance tracks preference here, so the rate is a usable proxy';
  if (correlation < -0.4) return 'conformance runs against preference: the system is making pages worse, and this is the result to publish first';
  return 'conformance and preference are unrelated here. The gate enforces conformance and nothing '
    + 'more, which is the ceiling on every claim made from the primary metric';
}

/**
 * Judgements in, result out.
 *
 * `judgements` are `{ item, judge, choice }` with choice 'a' | 'b' | 'tie', where 'a' means the
 * left-hand page. Judges below the attention threshold are dropped before anything is counted, and
 * the drop is reported: a round that excluded half its panel is a round to rerun, not to publish.
 */
export function summarise(items, judgements, { conformance = {}, attentionFloor = 0.8 } = {}) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const judges = new Map();
  for (const j of judgements) {
    const item = byId.get(j.item);
    if (!item) continue;
    if (!judges.has(j.judge)) judges.set(j.judge, { checks: 0, passed: 0, votes: [] });
    const rec = judges.get(j.judge);
    if (item.kind === 'check') {
      rec.checks += 1;
      if (j.choice === (item.expect === 'right' ? 'b' : 'a')) rec.passed += 1;
    } else {
      rec.votes.push({ item, choice: j.choice });
    }
  }

  const excluded = [];
  const kept = new Map();
  for (const [name, rec] of judges) {
    const rate = rec.checks ? rec.passed / rec.checks : null;
    if (rate !== null && rate < attentionFloor) excluded.push({ judge: name, attention: Number(rate.toFixed(3)) });
    else kept.set(name, rec);
  }

  // Win counts per arm, and per anchor. A tie is half to each side, which is what a tie means.
  const wins = new Map();
  const bump = (arm, amount) => wins.set(arm, (wins.get(arm) ?? 0) + amount);
  const anchors = new Map();
  for (const rec of kept.values()) {
    for (const { item, choice } of rec.votes) {
      // A tie is half to each side, which is what a tie means.
      const share = choice === 'tie' ? [0.5, 0.5] : choice === 'a' ? [1, 0] : [0, 1];
      if (item.kind === 'anchor') {
        const k = `${item.anchor} vs ${item.against}`;
        if (!anchors.has(k)) anchors.set(k, { anchorWins: 0, armWins: 0 });
        const row = anchors.get(k);
        // Which side the anchor landed on is recorded on the item, not inferred from its key:
        // an anchor key is a filename and may contain anything.
        const [anchorShare, armShare] = item.left === item.anchorKey ? share : [share[1], share[0]];
        row.anchorWins += anchorShare;
        row.armWins += armShare;
      } else {
        // A page key is `brief|model|arm|sample`, so the arm is the third field.
        bump(item.left.split('|')[2], share[0]);
        bump(item.right.split('|')[2], share[1]);
      }
    }
  }

  const armRows = [...wins].map(([arm, w]) => ({ arm, wins: Number(w.toFixed(2)) })).sort((a, b) => b.wins - a.wins);
  const total = armRows.reduce((s, r) => s + r.wins, 0);
  for (const r of armRows) r.share = total ? Number((r.wins / total).toFixed(4)) : null;

  // The floor anchor must lose. If it does not, the panel is not judging design and no arm result
  // from this round means anything.
  const floorRows = [...anchors].filter(([k]) => k.startsWith('floor'));
  const floorLost = floorRows.length === 0 ? null
    : floorRows.every(([, row]) => row.anchorWins < row.armWins);

  const armsWithBoth = armRows.filter((r) => Number.isFinite(conformance[r.arm]));
  const correlation = armsWithBoth.length >= 3
    ? spearman(armsWithBoth.map((r) => conformance[r.arm]), armsWithBoth.map((r) => r.share))
    : null;

  return {
    judges: { kept: [...kept.keys()], excluded, attentionFloor },
    arms: armRows,
    anchors: [...anchors].map(([pair, row]) => ({ pair, anchorWins: Number(row.anchorWins.toFixed(2)), armWins: Number(row.armWins.toFixed(2)) })),
    floorAnchorLost: floorLost,
    conformanceVsPreference: {
      spearman: correlation,
      arms: armsWithBoth.length,
      reading: readCorrelation(correlation),
      caveat: 'Descriptive, not a test. Eight arms give a correlation with an interval too wide to '
        + 'reject anything; the decision-relevant output of this round is the floor-anchor check and '
        + 'the sign.',
    },
    valid: floorLost !== false && kept.size > 0,
  };
}
