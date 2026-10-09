/**
 * What a system refuses, and what it permits on a scale.
 *
 * `$extensions["form.applied"].absent` lists the effects a system refuses outright. Applied
 * Form refuses shadow, gradient fill and radius, and each refusal carries named exemptions
 * rather than a heuristic — the ones below are what this system actually draws in
 * dist/components.css.
 *
 * A different system permits some of them. It drops the effect from `absent` and declares the
 * scale it is allowed on, as a `radius` or `elevation` token group, and the check becomes
 * membership of that scale rather than presence of the effect. That is the difference between
 * enforcing a design system and enforcing this one: a system with a four-pixel radius and two
 * elevations is held to its own scale exactly as strictly, instead of being told it is wrong
 * for having a design.
 */
import { absent, radiusScale, elevationScale } from '../tokens.mjs';

const hasClass = (className, name) => (className || '').split(/\s+/).includes(name);

/** .af-skip's focus bar, .af-button.af-secondary's hairline, and the current-page bar all use box-shadow as a hairline/bar by design. */
const isShadowExempt = (a) => {
  const cls = a.className || '';
  if (hasClass(cls, 'af-skip')) return true;
  if (hasClass(cls, 'af-button') && hasClass(cls, 'af-secondary')) return true;
  if (a.ariaCurrent === 'page') return true;
  return false;
};

/** The numbers in a shadow, which is what makes two elevations the same step rather than the same string. */
const shadowGeometry = (v) => (String(v).match(/-?\d*\.?\d+px/g) ?? []).map((n) => parseFloat(n)).join(' ');

export function checkAbsences(ctx, spec, add) {
  const permitsRadius = !absent.includes('radius') && radiusScale.length > 0;
  const permitsElevation = !absent.includes('shadow') && elevationScale.length > 0;
  const elevations = elevationScale.map(shadowGeometry);

  for (const a of spec.absences ?? []) {
    if (a.kind === 'shadow') {
      if (permitsElevation) {
        // A permitted shadow is one of the declared steps, compared by its geometry rather
        // than its text, because a browser respells a shadow and a token does not. The named
        // exemptions still stand: those components use a shadow as a hairline or a bar, which
        // is a different thing from an elevation and is not on the elevation scale.
        if (!isShadowExempt(a) && !elevations.includes(shadowGeometry(a.value))) {
          add('elevation-off-scale', `A shadow must be one of the ${elevationScale.length} declared elevations, got ${a.value} on a ${a.element}`, { absence: a });
        }
      } else if (!isShadowExempt(a)) {
        add('shadow-present', `No box-shadow other than the focus ring, .af-skip, .af-button.af-secondary, and [aria-current="page"], got ${a.value} on a ${a.element}`, { absence: a });
      }
    }
    if (a.kind === 'gradient') {
      if (a.textClip) add('gradient-fill', 'No gradient text fill; gradients are grounds only', { absence: a });
      else if (!a.wide) add('gradient-fill', 'A gradient background-image is a full-width ground only, not a fill on a narrower element', { absence: a });
    }
    if (a.kind === 'radius') {
      const isRangeThumb = a.element === 'input' && a.inputType === 'range';
      if (permitsRadius) {
        if (!isRangeThumb && a.value !== 0 && !radiusScale.includes(a.value)) {
          add('radius-off-scale', `A corner radius must be one of the declared steps (${radiusScale.join(', ')}px), got ${a.value}px on a ${a.element}`, { absence: a });
        }
      } else if (!isRangeThumb) {
        add('radius-present', `No rounded corners anywhere except a range-input thumb, got ${a.value}px on a ${a.element}`, { absence: a });
      }
    }
  }
}
