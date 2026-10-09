/**
 * Register rules for Applied Form v1.0.
 *
 * `lint(spec)` takes a plain description of a deliverable or component and
 * returns a list of violations. An empty list means the spec is on-system.
 *
 * spec = {
 *   register: 'i' | 'ii',
 *   background?: hex,
 *   grounds?: hex[],                 // full-bleed colour fields used
 *   text?: [{ voice, sizePx, weight, color, background, role, measureCh, isWordmark, isData }],
 *   spacing?: number[],              // every margin/gap/step used, px
 *   aspectRatios?: string[],         // 'w:h' strings used by images/tiles
 *   statuses?: [{ label, shape, color }],
 *   focusStyle?: { visible, color },
 *   links?: [{ color, background, underlined }],
 *   imagery?: [{ kind: 'form' | 'plot' | 'photo' | 'illustration' | 'icon' }],
 *   chart?: { series: hex[], background?: hex, labelledDirectly?: boolean },
 *   spreads?: [{ name, ground, grounds?: hex[], joinOnColumn?: boolean, markOverBody?: boolean, figureVoice?: string }],
 *   motion?: { animations: number, underReducedMotion: number },
 * }
 *
 * A contrast violation carries `suggestion`: the first token fallback that
 * passes on the same ground, or null when the ground itself has to change.
 *
 * `lint()` returns violations only. `advise(spec)` returns APCA readings for
 * every text entry that fall under the advisory thresholds. They never fail
 * a build; the WCAG 2 floors are the gate.
 */
import { registers, typeScale, floors } from './tokens.mjs';
import { apca, isLargeText } from './contrast.mjs';
import { eq } from './rules/util.mjs';
import { checkGrounds } from './rules/grounds.mjs';
import { checkText } from './rules/text.mjs';
import { checkSpacing, checkAspectRatios, checkOverflow, checkGrid } from './rules/layout.mjs';
import { checkStatuses, checkFocus, checkLinks } from './rules/interaction.mjs';
import { checkTargetSize, checkAltMissing } from './rules/accessibility.mjs';
import { checkAbsences } from './rules/absence.mjs';
import { checkImagery } from './rules/imagery.mjs';
import { checkSpreads } from './rules/spreads.mjs';
import { checkDocument } from './rules/document.mjs';
import { checkComposition } from './rules/composition.mjs';
import { checkMotion } from './rules/motion.mjs';
import { checkCharts } from './rules/charts.mjs';

export function lint(spec) {
  const out = [];
  const add = (rule, message, detail = {}) => out.push({ rule, message, ...detail });
  const reg = spec.register;
  if (!registers[reg]) {
    add('register', `register must be one of ${Object.keys(registers).join(', ')}, got ${JSON.stringify(reg)}`);
    return out;
  }
  // A Register II document on the dark ground is judged against the dark palette whether it got
  // there by declaring the ii-dark register or by the reader's own theme. Same rules, other ground.
  const themed = reg === 'ii' && spec.theme === 'dark' && registers['ii-dark'] ? 'ii-dark' : reg;
  const palette = registers[themed];
  const isII = reg.startsWith('ii');
  const ctx = { reg, isII, palette };

  if (spec.mixedRegisters) add('register-mixed', 'The register switches at a document boundary, never mid-page');

  // Background is fixed per register.
  if (spec.background && !eq(spec.background, palette.background)) {
    add('background', `Register ${reg.toUpperCase()} background must be ${palette.background}, got ${spec.background}`);
  }

  // Full-bleed grounds.
  checkGrounds(ctx, spec, add);

  // Type.
  checkText(ctx, spec, add);

  // Spacing must be on the 8px scale (or a multiple of the unit above it).
  checkSpacing(ctx, spec, add);

  // Aspect ratios.
  checkAspectRatios(ctx, spec, add);

  // Statuses must carry label and shape, not colour alone.
  checkStatuses(ctx, spec, add);

  // Focus: every tab stop, not only the first.
  checkFocus(ctx, spec, add);

  // Links.
  checkLinks(ctx, spec, add);

  // Accessibility: target size (WCAG 2.5.8) and missing alt text/labels.
  checkTargetSize(ctx, spec, add);
  checkAltMissing(ctx, spec, add);

  // Declared absences: shadow, gradient-fill, radius.
  checkAbsences(ctx, spec, add);

  // Imagery.
  checkImagery(ctx, spec, add);

  // Layout.
  checkOverflow(ctx, spec, add);

  // Spreads: the moves. Register I only.
  checkSpreads(ctx, spec, add);

  // Grid: every item in a data-grid container starts and ends on a column line.
  checkGrid(ctx, spec, add);

  // Long-form structure: heading order, provenance on long documents, print.
  checkDocument(ctx, spec, add);

  // Composition: layers, rotation, offsets, bleeds, panels, type above Form, recipes.
  checkComposition(ctx, spec, add);

  // Motion collapses under prefers-reduced-motion.
  checkMotion(ctx, spec, add);

  // Charts.
  checkCharts(ctx, spec, add);

  return out;
}

/** APCA advisories: text entries whose Lc falls under the advisory threshold. */
export function advise(spec) {
  const out = [];
  // Print orphan headings are estimated from scroll positions, not real fragmentation: advisory until Chromium exposes page breaks.
  for (const h of spec.print?.orphanHeadings ?? []) out.push({ rule: 'print-orphan-heading', message: `Heading "${h}" may print alone at the foot of a page (estimated)`, heading: h });
  const reg = spec.register;
  const palette = registers[reg] ?? registers.ii;
  for (const t of spec.text ?? []) {
    if (!t.color) continue;
    const bg = t.background ?? spec.background ?? palette.background;
    const lc = Math.abs(apca(t.color, bg));
    const need = isLargeText(t.sizePx ?? 16, t.weight ?? 400, floors) ? floors.apcaLargeAdvisory : floors.apcaBodyAdvisory;
    if (lc < need) {
      out.push({ rule: 'apca-advisory', message: `APCA Lc ${lc.toFixed(1)} is under the ${need} advisory for ${t.sizePx}px text (WCAG 2 is still the gate)`, text: t, lc, need });
    }
  }
  return out;
}

/** Which register a named artefact belongs to, from the Field Guide table. */
export const ARTEFACT_REGISTER = {
  'marketing-page': 'i',
  'docs-page': 'ii',
  'model-card': 'ii',
  'changelog': 'ii',
  'deck': 'i',
  'proposal-cover': 'i',
  'proposal-body': 'ii',
  'report-cover': 'i',
  'report-body': 'ii',
  'provenance-card': 'ii',
  'product-ui': 'ii',
  'contract': 'ii',
  'social': 'i',
  'careers-page': 'i',
  'job-description': 'ii',
};

export function registerFor(artefact) {
  const r = ARTEFACT_REGISTER[artefact];
  if (!r) throw new Error(`Unknown artefact ${artefact}`);
  return r;
}

/** Type tokens available in a register. */
export function typeTokensFor(register) {
  return Object.entries(typeScale)
    .filter(([, t]) => t.registers.includes(register))
    .map(([name]) => name);
}
