/** Full-bleed colour grounds, judged against what the system declares rather than what ours does. */
import { prohibitions, colorName } from '../tokens.mjs';
import { eq } from './util.mjs';

export function checkGrounds(ctx, spec, add) {
  const { palette, isII } = ctx;
  for (const g of spec.grounds ?? []) {
    const name = colorName(g) ?? g;
    if (prohibitions.neverGround.some((c) => eq(c, g))) {
      add('support-as-ground', `${name} is declared never a ground; it carries meaning elsewhere in this system`, { color: g });
    } else if (isII) {
      add('ground-in-ii', 'Full-bleed colour grounds are forbidden in Register II', { color: g });
    } else if (!palette.grounds.some((p) => eq(p, g))) {
      add('ground-off-palette', `Ground ${g} is not one of the Register I grounds`, { color: g });
    }
  }
}
