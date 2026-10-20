/** Statuses, focus rings, links. */
import { colors, pack, darkGrounds, colorName } from '../tokens.mjs';
import { eq } from './util.mjs';

export function checkStatuses(ctx, spec, add) {
  for (const st of spec.statuses ?? []) {
    // Applied Form asks for a label and a shape; the universal rule (WCAG 1.4.1) is not colour alone.
    if (pack ? !st.label && !st.shape : !st.label || !st.shape) {
      add('status-colour-only', pack ? 'A status carries a label or a shape, never colour alone' : 'Every status carries a label and a shape as well as a colour', { status: st });
    }
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

/** Whether a measured ground is exactly one of the dark grounds, the dark register's ground and layer (tokens.mjs, `darkGrounds`). */
export const onDarkGround = (ground) => !!ground && darkGrounds.some((g) => eq(g, ground));

/**
 * Whether `link-colour-ii` also accepts the on-dark link colour on a Register II link (decision
 * 0025): the link paints no ground of its own, and the link's own measured ground is exactly a dark
 * ground. That ground is `bgOf` on the link element (src/lib/page-spec.mjs). It is not always the
 * ground `contrast` reads: `contrast` reads each text run on `bgOf` of the element that holds the
 * run, and a run in a child that paints its own fill, such as a white chip inside the link, is read
 * on that fill. Every other link is judged against the link colour alone, as on 5722c0a: a link that
 * paints its own ground (a filled button, a skip link, a selected item) on any ground, a link on any
 * other ground, and a link with no measured ground.
 */
export const linkOnDarkGround = (link) => !!link && !link.paintsGround && onDarkGround(link.background);

/**
 * The on-dark link colour `link-colour-ii` accepts on this link besides the link colour, against the
 * palette the page is judged against, or null: it is the palette's `link-on-dark` where
 * `linkOnDarkGround` holds. The dark palette declares none: every ground it has is dark, and its link
 * colour is already the one for them.
 */
export const onDarkColourFor = (palette, link) => (linkOnDarkGround(link) && palette?.['link-on-dark']) || null;

const named = (hex) => `${colorName(hex) ? `${colorName(hex)} ` : ''}${hex}`;

export function checkLinks(ctx, spec, add) {
  const { palette, isII } = ctx;
  for (const l of spec.links ?? []) {
    if (l.underlined === false) add('link-not-underlined', 'Links are underlined', { link: l });
    // The link colour passes everywhere, as on 5722c0a. Decision 0025 only adds a second colour that
    // passes, so the rule can only pass a link it failed before, never fail one it passed.
    if (!isII || !l.color || eq(l.color, palette.link)) continue;
    const onDark = onDarkColourFor(palette, l);
    if (!onDark) {
      add('link-colour-ii', `Register II link text is terra deep ${palette.link}`, { link: l });
    } else if (!eq(l.color, onDark)) {
      add('link-colour-ii', `A Register II link on ${named(l.background)} is the on-dark link colour, ${named(onDark)}, or the link colour, ${named(palette.link)}. Use the on-dark link colour: the register names it for this ground.`, { link: l });
    }
  }
}
