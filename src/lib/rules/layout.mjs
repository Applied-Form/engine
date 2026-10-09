/** Spacing scale, aspect ratios, horizontal overflow, data-grid column alignment. */
import { spacingScale, spacingUnit, aspectRatios } from '../tokens.mjs';

export function checkSpacing(ctx, spec, add) {
  for (const s of spec.spacing ?? []) {
    if (s === 0) continue;
    const onScale = spacingScale.includes(s) || (s > Math.max(...spacingScale) && s % spacingUnit === 0);
    if (!onScale) add('spacing', `${s}px is off the 8px spacing scale`, { value: s });
  }
}

export function checkAspectRatios(ctx, spec, add) {
  for (const r of spec.aspectRatios ?? []) {
    if (!aspectRatios.includes(r)) add('aspect-ratio', `Aspect ratio ${r} is not one of ${aspectRatios.join(', ')}`, { value: r });
  }
}

export function checkOverflow(ctx, spec, add) {
  if (spec.overflowX) add('horizontal-overflow', `The page scrolls horizontally at ${spec.viewport ?? 'this'}px`, { overflow: spec.overflowX });
}

export function checkGrid(ctx, spec, add) {
  for (const item of spec.offGrid ?? []) {
    add('grid-off-column', `A grid item does not sit on column lines (${item.left}–${item.right}px)`, { item });
  }
}
