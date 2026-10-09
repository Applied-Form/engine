/** Statuses, focus rings, links. */
import { colors } from '../tokens.mjs';
import { eq } from './util.mjs';

export function checkStatuses(ctx, spec, add) {
  for (const st of spec.statuses ?? []) {
    if (!st.label || !st.shape) add('status-colour-only', 'Every status carries a label and a shape as well as a colour', { status: st });
  }
}

export function checkFocus(ctx, spec, add) {
  for (const f of [].concat(spec.focusStyles ?? [], spec.focusStyle ?? [])) {
    if (f.visible === false) add('focus-hidden', `Focus state removed on ${f.element ?? 'an element'}`, { focus: f });
    if (f.color && !eq(f.color, colors.focus)) {
      add('focus-restyled', `Focus colour is ${colors.focus} in both registers, got ${f.color} on ${f.element ?? 'an element'}`, { focus: f });
    }
  }
}

export function checkLinks(ctx, spec, add) {
  const { palette, isII } = ctx;
  for (const l of spec.links ?? []) {
    if (l.underlined === false) add('link-not-underlined', 'Links are underlined', { link: l });
    if (isII && l.color && !eq(l.color, palette.link)) {
      add('link-colour-ii', `Register II link text is terra deep ${palette.link}`, { link: l });
    }
  }
}
