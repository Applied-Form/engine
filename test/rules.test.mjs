import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { lint, advise, registerFor, typeTokensFor, ARTEFACT_REGISTER } from '../src/lib/rules.mjs';
import { colors as c } from '../src/lib/tokens.mjs';
import { RULES } from '../src/lib/rules/registry.mjs';

const rules = (spec) => lint(spec).map((v) => v.rule);

const root = fileURLToPath(new URL('../', import.meta.url));

test('a clean Register II document lints clean', () => {
  const spec = {
    register: 'ii',
    background: c.white,
    text: [
      { voice: 'text', role: 'body', sizePx: 19, weight: 400, color: c['text-ii'], measureCh: 64 },
      { voice: 'text', role: 'heading', sizePx: 32, weight: 700, color: c['text-ii'] },
      { voice: 'data', role: 'label', sizePx: 11.5, color: c.muted, isData: true },

    ],
    spacing: [8, 16, 32, 96, 128],
    aspectRatios: ['16:9', '3:2'],
    statuses: [{ label: 'validated', shape: 'circle', color: c.positive }],
    focusStyle: { visible: true, color: c.focus },
    links: [{ color: c['terra-deep'], underlined: true }],
    imagery: [{ kind: 'plot', generated: 'bar@1' }, { kind: 'form', tag: 'svg', sizePx: 64 }],
  };
  assert.deepEqual(lint(spec), []);
});

test('a clean Register I spread lints clean', () => {
  const spec = {
    register: 'i',
    background: c.paper,
    grounds: [c.espresso, c.terracotta],
    text: [
      { voice: 'display', sizePx: 160, weight: 420, color: c.paper, background: c.espresso, measureCh: 40 },
      { voice: 'text', role: 'body', sizePx: 17, color: c.ink, measureCh: 66 },
      { voice: 'data', sizePx: 64, weight: 300, color: c.terracotta, isData: true },
    ],
    spacing: [24, 48, 80],
    aspectRatios: ['16:9'],
  };
  assert.deepEqual(lint(spec), []);
});

test('unknown register is reported and nothing else runs; ii-dark is a register', () => {
  assert.deepEqual(rules({ register: 'iii' }), ['register']);
  assert.deepEqual(rules({ register: 'ii-dark', background: c.ink }), []);
  assert.deepEqual(rules({ register: 'ii-dark', text: [{ voice: 'display', sizePx: 32 }] }), ['display-voice-in-ii'], 'Register II rules apply on the dark surface');
  assert.deepEqual(rules({ register: 'ii-dark', links: [{ color: c['terracotta-light'], underlined: true }] }), []);
});

test('long-form: heading order, provenance on long documents, print checks', () => {
  assert.deepEqual(rules({ register: 'ii', headings: [{ level: 1, sample: 'A' }, { level: 3, sample: 'C' }] }), ['heading-order']);
  assert.deepEqual(rules({ register: 'ii', headings: [{ level: 2, sample: 'B' }] }), ['heading-order']);
  assert.deepEqual(rules({ register: 'ii', headings: [{ level: 1, sample: 'A' }, { level: 2, sample: 'B' }, { level: 3, sample: 'C' }, { level: 2, sample: 'D' }] }), []);
  assert.deepEqual(rules({ register: 'ii', wordCount: 1200, hasProvenance: false }), ['provenance-required']);
  assert.deepEqual(rules({ register: 'ii', wordCount: 1200, hasProvenance: true }), []);
  assert.deepEqual(rules({ register: 'ii', wordCount: 300, hasProvenance: false }), []);
  assert.deepEqual(rules({ register: 'ii', print: { overflowX: 12 } }), ['print-overflow']);
  assert.deepEqual(rules({ register: 'ii', print: { overflowX: 0, linksWithoutHref: ['Read more'], orphanHeadings: ['Scope'] } }), ['print-link-url']);
  assert.deepEqual(advise({ register: 'ii', print: { orphanHeadings: ['Scope'] } }).map((a) => a.rule), ['print-orphan-heading'], 'orphan headings are advisory');
  assert.deepEqual(rules({ register: 'ii', print: { overflowX: 0, linksWithoutHref: [], orphanHeadings: [] } }), []);
});

test('a document that switches register mid-page is flagged', () => {
  assert.deepEqual(rules({ register: 'ii', mixedRegisters: true }), ['register-mixed']);
  assert.deepEqual(rules({ register: 'ii', mixedRegisters: false }), []);
});

test('a font outside the three voices is flagged', () => {
  assert.deepEqual(rules({ register: 'ii', text: [{ voice: 'unknown', family: 'Georgia', sizePx: 19 }] }), ['font-off-system']);
  assert.deepEqual(rules({ register: 'ii', text: [{ voice: 'text', family: 'Libre Franklin', sizePx: 19 }] }), []);
});

test('wrong background per register', () => {
  assert.deepEqual(rules({ register: 'ii', background: c.paper }), ['background']);
  assert.deepEqual(rules({ register: 'i', background: c.white }), ['background']);
});

test('Fraunces is forbidden in Register II, and the wordmark is never live text in either register', () => {
  assert.deepEqual(rules({ register: 'ii', text: [{ voice: 'display', sizePx: 32 }] }), ['display-voice-in-ii']);
  assert.deepEqual(rules({ register: 'ii', text: [{ voice: 'display', sizePx: 32, isWordmark: true }] }), ['wordmark-live-text']);
  assert.deepEqual(rules({ register: 'i', text: [{ voice: 'display', sizePx: 32, isWordmark: true }] }), ['wordmark-live-text']);
  assert.deepEqual(rules({ register: 'i', text: [{ voice: 'display', sizePx: 32 }] }), []);
});

test('Register II headings are Franklin 700; terracotta only on interactive elements', () => {
  assert.deepEqual(rules({ register: 'ii', text: [{ voice: 'text', role: 'heading', sizePx: 32, weight: 400 }] }), ['heading-voice-ii']);
  assert.deepEqual(rules({ register: 'ii', text: [{ voice: 'data', role: 'heading', sizePx: 32, weight: 700 }] }), ['heading-voice-ii']);
  assert.deepEqual(rules({ register: 'ii', text: [{ voice: 'text', role: 'heading', sizePx: 32, weight: 700 }] }), []);
  assert.deepEqual(rules({ register: 'ii', text: [{ voice: 'text', role: 'other', sizePx: 19, color: c.terracotta }] }), ['accent-non-interactive-ii']);
  assert.deepEqual(rules({ register: 'ii', text: [{ voice: 'text', role: 'other', sizePx: 19, color: c.terracotta, isInteractive: true }] }), []);
  assert.deepEqual(rules({ register: 'i', text: [{ voice: 'text', role: 'other', sizePx: 17, color: c.terracotta }] }), []);
});

test('imagery: the mark is SVG only, at least 48px, and once in Register II; pages never overflow', () => {
  assert.deepEqual(rules({ register: 'ii', imagery: [{ kind: 'form', tag: 'img', sizePx: 64 }] }), ['mark-not-svg']);
  assert.deepEqual(rules({ register: 'ii', imagery: [{ kind: 'form', tag: 'svg', sizePx: 24 }] }), ['mark-too-small']);
  assert.deepEqual(rules({ register: 'ii', imagery: [{ kind: 'form', tag: 'svg', sizePx: 64 }, { kind: 'form', tag: 'svg', sizePx: 64 }] }), ['mark-once-ii']);
  assert.deepEqual(rules({ register: 'i', imagery: [{ kind: 'form', tag: 'svg', sizePx: 64 }, { kind: 'form', tag: 'svg', sizePx: 640 }] }), []);
  assert.deepEqual(rules({ register: 'ii', overflowX: 48, viewport: 320 }), ['horizontal-overflow']);
  assert.deepEqual(rules({ register: 'ii', overflowX: 0 }), []);
});

test('full-bleed grounds: forbidden in II, teal forbidden everywhere, off-palette flagged in I', () => {
  assert.deepEqual(rules({ register: 'ii', grounds: [c.espresso] }), ['ground-in-ii']);
  assert.deepEqual(rules({ register: 'i', grounds: [c.teal] }), ['support-as-ground']);
  assert.deepEqual(rules({ register: 'ii', grounds: [c.teal] }), ['support-as-ground']);
  assert.deepEqual(rules({ register: 'i', grounds: [c.clay] }), ['ground-off-palette']);
  assert.deepEqual(rules({ register: 'i', grounds: [c.ink, c.espresso, c.terracotta] }), []);
});

test('label-size text must clear APCA 60: clay light on espresso fails (Lc 57), tint passes; body text keeps the WCAG gate only', () => {
  assert.deepEqual(rules({ register: 'i', text: [{ voice: 'data', sizePx: 11.5, color: c['clay-light'], background: c.espresso, isData: true }] }), ['label-apca']);
  assert.deepEqual(rules({ register: 'i', text: [{ voice: 'data', sizePx: 11.5, color: c.tint, background: c.espresso, isData: true }] }), []);
  assert.deepEqual(rules({ register: 'i', text: [{ voice: 'data', sizePx: 11.5, color: c.terracotta, background: c.paper, isData: true }] }), [], 'terracotta on paper is Lc 68');
  assert.deepEqual(rules({ register: 'i', text: [{ voice: 'text', sizePx: 17, color: c['clay-light'], background: c.espresso }] }), []);
});

test('nothing renders below label-01 size in any voice or register', () => {
  assert.deepEqual(rules({ register: 'i', text: [{ voice: 'data', sizePx: 9, isData: true }] }), ['text-too-small']);
  assert.deepEqual(rules({ register: 'ii', text: [{ voice: 'data', sizePx: 6.1, isData: true }] }), ['text-too-small']);
  assert.deepEqual(rules({ register: 'i', text: [{ voice: 'data', sizePx: 11.5, isData: true }] }), []);
});

test('Register II text below 19px is flagged whatever its tag; data runs at data-02 size are exempt', () => {
  assert.deepEqual(rules({ register: 'ii', text: [{ voice: 'text', role: 'body', sizePx: 17 }] }), ['body-too-small']);
  assert.deepEqual(rules({ register: 'ii', text: [{ voice: 'text', role: 'other', sizePx: 14 }] }), ['body-too-small']);
  assert.deepEqual(rules({ register: 'ii', text: [{ voice: 'text', role: 'other', sizePx: 19 }] }), []);
  assert.deepEqual(rules({ register: 'ii', text: [{ voice: 'data', role: 'body', sizePx: 15, isData: true }] }), []);
  assert.deepEqual(rules({ register: 'i', text: [{ voice: 'text', role: 'body', sizePx: 17 }] }), []);
});

test('measure beyond 66ch is flagged in both registers, but not for data runs', () => {
  for (const register of ['i', 'ii']) {
    assert.deepEqual(rules({ register, text: [{ voice: 'text', sizePx: 100, measureCh: 67 }] }), ['measure']);
    assert.deepEqual(rules({ register, text: [{ voice: 'data', sizePx: 15, measureCh: 99, isData: true }] }), []);
  }
});

test('data set in a non-mono voice is flagged', () => {
  assert.deepEqual(rules({ register: 'i', text: [{ voice: 'display', sizePx: 120, isData: true }] }), ['data-not-mono']);
  assert.deepEqual(rules({ register: 'ii', text: [{ voice: 'text', sizePx: 19, isData: true }] }), ['data-not-mono']);
});

test('caution as small text is flagged on light grounds, where it fails, and allowed on ink, where it passes', () => {
  assert.deepEqual(rules({ register: 'i', text: [{ voice: 'data', sizePx: 15, color: c.caution, background: c.paper, isData: true }] }).sort(), ['caution-as-text', 'contrast']);
  assert.deepEqual(rules({ register: 'ii-dark', text: [{ voice: 'data', sizePx: 15, color: c.caution, background: c.ink, isData: true }] }), []);
});

test('contrast is checked against the register background by default', () => {
  const v = lint({ register: 'ii', text: [{ voice: 'text', role: 'body', sizePx: 19, color: c.caution }] });
  assert.deepEqual(v.map((x) => x.rule).sort(), ['caution-as-text', 'contrast']);
  assert.ok(v.find((x) => x.rule === 'contrast').ratio < 4.5);
});

test('large display text only needs 3:1', () => {
  assert.deepEqual(rules({ register: 'i', text: [{ voice: 'display', sizePx: 48, color: c.terracotta, background: c.sand }] }), []);
  assert.deepEqual(rules({ register: 'i', text: [{ voice: 'text', sizePx: 17, color: c.terracotta, background: c.sand }] }), ['contrast']);
});

test('white on clay is flagged explicitly as well as by contrast', () => {
  assert.deepEqual(rules({ register: 'i', text: [{ voice: 'text', sizePx: 17, color: c.white, background: c.clay }] }).sort(), ['contrast', 'forbidden-pairing']);
});

test('Fraunces weight outside 380–470 is flagged', () => {
  assert.deepEqual(rules({ register: 'i', text: [{ voice: 'display', sizePx: 60, weight: 700 }] }), ['display-weight']);
  assert.deepEqual(rules({ register: 'i', text: [{ voice: 'display', sizePx: 60, weight: 380 }] }), []);
});

test('spacing off the 8px scale is flagged; multiples above 96 are allowed', () => {
  assert.deepEqual(rules({ register: 'i', spacing: [12] }), ['spacing']);
  assert.deepEqual(rules({ register: 'i', spacing: [40] }), ['spacing'], '40 is on-unit but off-scale');
  assert.deepEqual(rules({ register: 'i', spacing: [0, 8, 96, 128, 160] }), []);
});

test('aspect ratios outside the permitted six are flagged', () => {
  assert.deepEqual(rules({ register: 'ii', aspectRatios: ['21:9'] }), ['aspect-ratio']);
  assert.deepEqual(rules({ register: 'ii', aspectRatios: ['4:3', '2:3'] }), []);
});

test('status needs label and shape, not colour alone', () => {
  assert.deepEqual(rules({ register: 'ii', statuses: [{ color: c.positive }] }), ['status-colour-only']);
  assert.deepEqual(rules({ register: 'ii', statuses: [{ color: c.positive, label: 'ok' }] }), ['status-colour-only']);
  assert.deepEqual(rules({ register: 'ii', statuses: [{ color: c.positive, label: 'ok', shape: 'tick' }] }), []);
});

test('focus may never be hidden or restyled, on any tab stop', () => {
  assert.deepEqual(rules({ register: 'ii', focusStyle: { visible: false } }), ['focus-hidden']);
  assert.deepEqual(rules({ register: 'i', focusStyle: { visible: true, color: c.terracotta } }), ['focus-restyled']);
  assert.deepEqual(rules({ register: 'i', focusStyles: [{ visible: true, color: c.focus }, { visible: false, element: 'button' }] }), ['focus-hidden']);
  assert.deepEqual(rules({ register: 'i', focusStyles: [{ visible: true, color: c.focus }] }), []);
});

test('links are underlined and, in II, terra deep', () => {
  assert.deepEqual(rules({ register: 'ii', links: [{ color: c.terracotta, underlined: false }] }).sort(), ['link-colour-ii', 'link-not-underlined']);
  assert.deepEqual(rules({ register: 'i', links: [{ color: c.terracotta, underlined: true }] }), []);
});

test('decorative imagery is flagged in II only', () => {
  assert.deepEqual(rules({ register: 'ii', imagery: [{ kind: 'photo' }] }), ['decorative-imagery']);
  assert.deepEqual(rules({ register: 'i', imagery: [{ kind: 'photo' }] }), []);
});

test('a contrast violation suggests the token fallback that passes on the same ground', () => {
  const [v] = lint({ register: 'i', text: [{ voice: 'text', sizePx: 17, color: c.terracotta, background: c.sand }] });
  assert.equal(v.rule, 'contrast');
  assert.equal(v.suggestion, c['terra-deep']);
  assert.match(v.message, new RegExp(`Use terra-deep ${c['terra-deep']}`));
  const [w] = lint({ register: 'ii', text: [{ voice: 'text', sizePx: 19, color: c.clay, background: c.terracotta }] });
  assert.equal(w.suggestion, null);
  assert.match(w.message, /Change the ground/);
});

test('chart: a series colour under the mark floor on white is flagged', () => {
  // Palette-agnostic: sand is a ground, so as a mark on white it is under 3:1 in any system that
  // keeps its grounds light. The brand series and the suggested deep variants are the guide's
  // claim and are held in guide.test.mjs.
  const v = lint({ register: 'ii', chart: { series: [c.terracotta, c.teal, c.sand] } });
  assert.ok(v.some((x) => x.rule === 'series-contrast' && /Series 3/.test(x.message)), JSON.stringify(v.map((x) => x.message)));
  assert.deepEqual(rules({ register: 'ii', chart: { series: [c.terracotta, c.teal, c['clay-deep']] } }), []);
});

test('chart: legend, series count and order, hand-drawn figures', () => {
  assert.deepEqual(rules({ register: 'ii', chart: { series: [c.terracotta], legend: true } }), ['chart-legend']);
  assert.deepEqual(rules({ register: 'ii', chart: { series: [c.terracotta, c.teal, c['clay-deep'], c.espresso] } }), ['series-count']);
  assert.deepEqual(rules({ register: 'ii', chart: { series: [c.teal, c.terracotta] } }), ['series-order']);
  assert.deepEqual(rules({ register: 'ii', chart: { series: [c.terracotta, c.teal] } }), []);
  assert.deepEqual(rules({ register: 'ii-dark', background: c.ink, chart: { series: [c['terracotta-light'], c['teal-light']] } }), []);
  assert.deepEqual(rules({ register: 'ii', imagery: [{ kind: 'plot', tag: 'svg', sizePx: 300 }] }), ['figure-hand-drawn']);
  assert.deepEqual(rules({ register: 'ii', imagery: [{ kind: 'plot', tag: 'svg', sizePx: 300, generated: 'bar@1' }] }), []);
});

test('chart: an unlabelled chart is flagged, and near-equal luminance neighbours are named', () => {
  const v = lint({ register: 'i', chart: { series: [c.terracotta, c.teal], labelledDirectly: false } });
  assert.deepEqual(v.map((x) => x.rule), ['series-unlabelled', 'series-indistinct']);
  assert.deepEqual(rules({ register: 'i', chart: { series: [c.terracotta, c.teal], labelledDirectly: true } }), []);
  assert.deepEqual(rules({ register: 'i', chart: { series: [c.terracotta], labelledDirectly: false } }), ['series-unlabelled']);
});

test('spreads: unknown names, once-per-document, grounds, joins, mark over body, figure voice', () => {
  assert.deepEqual(rules({ register: 'i', spreads: [{ name: 'nope' }] }), ['spread-unknown']);
  assert.deepEqual(rules({ register: 'ii', spreads: [{ name: 'datum' }] }), ['spread-in-ii']);
  assert.deepEqual(rules({ register: 'i', spreads: [{ name: 'colossus' }, { name: 'colossus' }] }), ['spread-once']);
  assert.deepEqual(rules({ register: 'i', spreads: [{ name: 'counterpoint', ground: c.terracotta }] }), ['spread-ground']);
  assert.deepEqual(rules({ register: 'i', spreads: [{ name: 'counterpoint', ground: c.espresso }] }), []);
  assert.deepEqual(rules({ register: 'i', spreads: [{ name: 'ground-shift', grounds: [c.espresso] }] }), ['spread-grounds']);
  assert.deepEqual(rules({ register: 'i', spreads: [{ name: 'ground-shift', grounds: [c.espresso, c.terracotta], joinOnColumn: false }] }), ['spread-join']);
  assert.deepEqual(rules({ register: 'i', spreads: [{ name: 'ground-shift', grounds: [c.espresso, c.terracotta], joinOnColumn: true }] }), []);
  assert.deepEqual(rules({ register: 'i', spreads: [{ name: 'bled-form', markOverBody: true }] }), ['spread-mark-over-body']);
  assert.deepEqual(rules({ register: 'i', spreads: [{ name: 'bled-form', markOverBody: false }] }), []);
  assert.deepEqual(rules({ register: 'i', spreads: [{ name: 'datum', figureVoice: 'display' }] }), ['spread-figure-voice']);
  assert.deepEqual(rules({ register: 'i', spreads: [{ name: 'datum', figureVoice: 'data', ground: c.espresso }] }), []);
});

test('grid items off the column lines are flagged', () => {
  assert.deepEqual(rules({ register: 'i', offGrid: [{ element: 'div', left: 7, right: 400 }] }), ['grid-off-column']);
  assert.deepEqual(rules({ register: 'i', offGrid: [] }), []);
});

test('composition: layers, rotation, offsets, bleeds, panels, form over type, recipes', () => {
  assert.deepEqual(rules({ register: 'i', composition: { zIndex: [{ zIndex: 7 }] } }), ['layer-unknown']);
  assert.deepEqual(rules({ register: 'i', composition: { zIndex: [] } }), []);
  assert.deepEqual(rules({ register: 'i', composition: { rotation: [{ rotation: 12 }] } }), ['rotation-off-set']);
  assert.deepEqual(rules({ register: 'i', composition: { offsets: [{ left: 7, top: 12 }] } }), ['offset-off-grid']);
  assert.deepEqual(rules({ register: 'i', composition: { bleeds: [{ over: 23 }] } }), ['bleed-off-scale']);
  assert.deepEqual(rules({ register: 'i', composition: { panels: [{ declared: '5:4', ok: true }] } }), ['panel-ratio-unknown']);
  assert.deepEqual(rules({ register: 'i', composition: { panels: [{ declared: '16:9', ok: false, measured: '640:400' }] } }), ['panel-ratio']);
  assert.deepEqual(rules({ register: 'i', composition: { panels: [{ declared: '16:9', ok: true }] } }), []);
  assert.deepEqual(rules({ register: 'i', composition: { formOverType: [{ sample: 'x' }] } }), ['form-over-type']);
  assert.deepEqual(rules({ register: 'i', composition: { motion: [{ property: 'transitionDuration', ms: 300 }] } }), ['motion-off-scale']);
  assert.deepEqual(rules({ register: 'i', composition: { motion: [] } }), []);
  assert.deepEqual(rules({ register: 'i', composition: { recipe: [{ spread: 'datum', missing: ['1/11'], have: [] }] } }), ['recipe-mismatch']);
});

test('motion must collapse under prefers-reduced-motion', () => {
  assert.deepEqual(rules({ register: 'i', motion: { animations: 4, underReducedMotion: 2 } }), ['motion-not-reduced']);
  assert.deepEqual(rules({ register: 'i', motion: { animations: 4, underReducedMotion: 0 } }), []);
});

test('advise() reports APCA readings under the advisory thresholds and nothing else', () => {
  const low = advise({ register: 'ii', text: [{ voice: 'display', sizePx: 28, color: c.terracotta, background: c.ink, sample: 'Form' }] });
  assert.equal(low.length, 1);
  assert.equal(low[0].rule, 'apca-advisory');
  assert.ok(low[0].lc < 45);
  assert.deepEqual(advise({ register: 'ii', text: [{ voice: 'text', sizePx: 19, color: c['text-ii'], background: c.white }] }), []);
});

test('artefact → register table matches the Field Guide', () => {
  assert.equal(registerFor('marketing-page'), 'i');
  assert.equal(registerFor('provenance-card'), 'ii');
  assert.equal(registerFor('product-ui'), 'ii');
  assert.equal(registerFor('proposal-cover'), 'i');
  assert.equal(registerFor('proposal-body'), 'ii');
  assert.equal(registerFor('careers-page'), 'i');
  assert.equal(registerFor('job-description'), 'ii');
  assert.throws(() => registerFor('mystery'), /Unknown artefact/);
  assert.ok(Object.values(ARTEFACT_REGISTER).every((r) => r === 'i' || r === 'ii'));
});

test('type tokens per register', () => {
  assert.deepEqual(typeTokensFor('ii'), ['heading-02', 'heading-03', 'body-01', 'label-01', 'data-01', 'data-02']);
  assert.deepEqual(typeTokensFor('i'), ['display-01', 'display-02', 'heading-01', 'body-02', 'label-01', 'data-01', 'data-02']);
});

test('target-size: interactive elements need 24px in both dimensions, except inline links in running text', () => {
  assert.deepEqual(rules({ register: 'ii', targets: [{ element: 'button', width: 16, height: 16, inline: false }] }), ['target-size']);
  assert.deepEqual(rules({ register: 'ii', targets: [{ element: 'a', width: 40, height: 12, inline: false }] }), ['target-size']);
  assert.deepEqual(rules({ register: 'ii', targets: [{ element: 'a', width: 12, height: 12, inline: true }] }), [], 'an inline link inside a paragraph or list item is exempt (WCAG 2.5.8)');
  assert.deepEqual(rules({ register: 'ii', targets: [{ element: 'button', width: 24, height: 48, inline: false }] }), []);
});

test('alt-missing: an <img> needs alt, a figure svg needs a label', () => {
  assert.deepEqual(rules({ register: 'i', imagery: [{ kind: 'decorative', tag: 'img', hasAlt: false }] }), ['alt-missing']);
  assert.deepEqual(rules({ register: 'i', imagery: [{ kind: 'decorative', tag: 'img', hasAlt: true }] }), []);
  assert.deepEqual(rules({ register: 'ii', imagery: [{ kind: 'plot', tag: 'svg', generated: 'bar@1', hasAriaLabel: false, hasTitle: false, ariaHidden: false }] }), ['alt-missing']);
  assert.deepEqual(rules({ register: 'ii', imagery: [{ kind: 'plot', tag: 'svg', generated: 'bar@1', hasAriaLabel: true, hasTitle: false, ariaHidden: false }] }), []);
  assert.deepEqual(rules({ register: 'ii', imagery: [{ kind: 'plot', tag: 'svg', generated: 'bar@1', hasAriaLabel: false, hasTitle: false, ariaHidden: true }] }), []);
});

test('shadow-present: flagged everywhere except .af-skip, .af-button.af-secondary, and the current-page bar', () => {
  assert.deepEqual(rules({ register: 'ii', absences: [{ kind: 'shadow', element: 'div', className: 'card', value: '0 4px 8px rgba(0,0,0,0.2)' }] }), ['shadow-present']);
  assert.deepEqual(rules({ register: 'ii', absences: [{ kind: 'shadow', element: 'a', className: 'af-skip', value: '0 4px 0 0 #FFDD00' }] }), []);
  assert.deepEqual(rules({ register: 'ii', absences: [{ kind: 'shadow', element: 'button', className: 'af-button af-secondary', value: 'inset 0 0 0 1px #3B5D6E' }] }), []);
  assert.deepEqual(rules({ register: 'ii', absences: [{ kind: 'shadow', element: 'li', className: '', value: '0 2px 0 0 currentColor', ariaCurrent: 'page' }] }), []);
});

test('gradient-fill: flagged as a text fill or as a fill narrower than a full-width ground', () => {
  assert.deepEqual(rules({ register: 'ii', absences: [{ kind: 'gradient', element: 'h1', className: '', textClip: true, wide: false }] }), ['gradient-fill']);
  assert.deepEqual(rules({ register: 'ii', absences: [{ kind: 'gradient', element: 'div', className: 'card', textClip: false, wide: false }] }), ['gradient-fill']);
  assert.deepEqual(rules({ register: 'ii', absences: [{ kind: 'gradient', element: 'section', className: '', textClip: false, wide: true }] }), []);
});

test('radius-present: flagged everywhere except a range-input thumb', () => {
  assert.deepEqual(rules({ register: 'ii', absences: [{ kind: 'radius', element: 'div', className: 'box', value: 8, inputType: null }] }), ['radius-present']);
  assert.deepEqual(rules({ register: 'ii', absences: [{ kind: 'radius', element: 'input', className: '', value: 8, inputType: 'range' }] }), []);
});

test('a system that permits radius and shadow is held to its own scale', () => {
  // The proof that the rules are parameters rather than Applied Form's taste. The fixture system
  // declares a radius scale of 4 and 12 and two elevations; under it, those values are correct
  // and anything else is a violation — the same strictness, a different system. It runs in a
  // child process because a system is chosen at import time, by AF_BRAND.
  const script = `
    import { lint } from '${pathToFileURL(root + 'src/lib/rules.mjs').href}';
    const base = { register: 'ii', background: '#FFFFFF' };
    const ids = (spec) => lint(spec).map((v) => v.rule).sort();
    console.log(JSON.stringify({
      onScale: ids({ ...base, absences: [
        { kind: 'radius', element: 'button', value: 4 },
        { kind: 'shadow', element: 'div', value: 'rgba(0, 0, 0, 0.12) 0px 2px 4px 0px' },
      ] }),
      offScale: ids({ ...base, absences: [
        { kind: 'radius', element: 'button', value: 5 },
        { kind: 'shadow', element: 'div', value: 'rgba(0, 0, 0, 0.4) 0px 9px 30px 0px' },
      ] }),
      squareIsFine: ids({ ...base, absences: [{ kind: 'radius', element: 'button', value: 0 }] }),
      gradientStillRefused: ids({ ...base, absences: [{ kind: 'gradient', element: 'span', textClip: true }] }),
    }));
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root, env: { ...process.env, AF_BRAND: root + 'test/fixtures/rounded.tokens.json' }, encoding: 'utf8',
  });
  const r = JSON.parse(out);
  assert.deepEqual(r.onScale, [], 'a declared radius and a declared elevation are correct under this system');
  assert.deepEqual(r.offScale, ['elevation-off-scale', 'radius-off-scale'], 'a value off the scale is not');
  assert.deepEqual(r.squareIsFine, [], 'square corners are always allowed');
  assert.deepEqual(r.gradientStillRefused, ['gradient-fill'], 'a prohibition this system keeps is still enforced');
});

test('a system named by its file path builds under its file name, never under the path', () => {
  const dist = (brand) => execFileSync(process.execPath, ['--input-type=module', '-e', `import { DIST } from '${pathToFileURL(root + 'src/lib/build-utils.mjs').href}'; console.log(DIST);`], { env: { ...process.env, AF_BRAND: brand }, encoding: 'utf8' }).trim();
  assert.equal(dist(root + 'test/fixtures/rounded.tokens.json'), 'dist/brands/rounded/');
  assert.equal(dist('../../escape.json'), 'dist/brands/escape/', 'a relative path cannot climb out of dist/');
  assert.equal(dist('north'), 'dist/brands/north/');
});

test('under Applied Form the same values are refused outright, because it declares them absent', () => {
  // The other half of the same proof: nothing about the checks changed for a system that
  // refuses these effects, and the message says refused rather than off-scale.
  const violations = lint({
    register: 'ii',
    background: '#FFFFFF',
    absences: [
      { kind: 'radius', element: 'button', value: 3 },
      { kind: 'shadow', element: 'div', value: 'rgba(0, 0, 0, 0.14) 0px 1px 2px 0px' },
    ],
  });
  assert.deepEqual(violations.map((v) => v.rule).sort(), ['radius-present', 'shadow-present']);
});

test('no rule module names a colour, a typeface or a hex literal of its own', () => {
  // The rules are the system's, not Applied Form's. A rule that names terracotta or Fraunces
  // cannot be true of anybody else's system, and would tell a designer their work is wrong for
  // not being ours. Semantic role names (accent, support, caution) are allowed: every derived
  // palette has them. This is the test that keeps track 2 from rotting.
  const brandWords = /terracotta|teal|clay|espresso|sand\b|tint\b|fraunces|franklin|plex|instrument serif|public sans|jetbrains|#[0-9A-Fa-f]{6}/i;
  const dir = new URL('../src/lib/rules/', import.meta.url);
  const offenders = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.mjs')) continue;
    const src = readFileSync(new URL(file, dir), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (file === 'registry.mjs' && /^\s*\*/.test(line)) return;
      const m = line.match(brandWords);
      if (m) offenders.push(`${file}:${i + 1} names ${m[0]}`);
    });
  }
  assert.deepEqual(offenders, [], offenders.join('\n'));
});

test('every rule says how to fix it, in one sentence a model can act on', () => {
  // The loop is what this project claims is new, and a loop is worth exactly as much as the
  // feedback it returns. A rule that states what is wrong but not what to change makes the model
  // guess, and guessing is where a repair round is spent. Whether the fix line is worth its
  // tokens is an ablation the protocol names; this is the field that ablation needs.
  for (const r of RULES) {
    assert.ok(r.fix && r.fix.length > 12, `${r.id} has no fix`);
    assert.match(r.fix, /^[A-Z]/, `${r.id}: the fix reads as an instruction`);
    assert.match(r.fix, /\.$/, `${r.id}: the fix is a sentence`);
    assert.ok(r.fix.length < 170, `${r.id}: the fix is one sentence, not a paragraph`);
  }
});

test('a recipe that cannot fit the page grid says so, and one that fits does not', () => {
  // The failing and passing cases for the branch added with decision 0019. It shipped inert once
  // already: the column count was parsed from computed grid-template-columns, which includes the
  // implicit tracks Chromium creates for an overflowing item, so a twelve-column grid reported
  // sixteen and the counts always matched. A test that only asserted the rule id could not see it.
  const spec = (recipe) => ({ register: 'i', background: c.paper, composition: { recipe: [recipe] } });

  const mismatched = lint(spec({ spread: 'datum', missing: ['11/13'], have: ['1/11'], columns: 12, authoredFor: 16 }));
  assert.deepEqual(mismatched.map((v) => v.rule), ['recipe-mismatch']);
  assert.match(mismatched[0].message, /grid has 12 columns and the move is authored for 16/);
  assert.match(mismatched[0].message, /no column line here/);

  // Same grid: the cells are missing for some other reason, and blaming the grid would be wrong.
  const sameGrid = lint(spec({ spread: 'datum', missing: ['11/13'], have: ['1/11'], columns: 16, authoredFor: 16 }));
  assert.deepEqual(sameGrid.map((v) => v.rule), ['recipe-mismatch']);
  assert.ok(!/columns and the move is authored/.test(sameGrid[0].message), 'no grid explanation when the grids agree');

  // Nothing missing is no violation at all, whatever the grids say.
  assert.deepEqual(lint({ register: 'i', background: c.paper, composition: { recipe: [] } }).map((v) => v.rule), []);
});
