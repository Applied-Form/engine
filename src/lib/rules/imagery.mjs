/** Imagery kinds and the generative mark. */
import { markParams } from '../tokens.mjs';

/**
 * Content the DOM cannot see.
 *
 * Every other rule in this engine reads rendered elements: their colours, sizes, measures and
 * focus rings. A page that paints its interface onto a canvas has none of those, so it breaks no
 * rule and scores clean while being, to a reader using anything but their eyes, empty. The
 * research report proposed this as an attack on the evaluation and it landed: only Register II
 * refused a canvas, and only because it refuses decorative figures generally.
 *
 * The threshold is deliberately generous. A chart on a canvas is a legitimate figure and says so
 * with data-figure; what this catches is a surface large enough to be the page itself.
 */
const CANVAS_SHARE_OF_VIEWPORT = 0.25;

export function checkImagery(ctx, spec, add) {
  for (const img of spec.imagery ?? []) {
    const painted = ['canvas', 'video'].includes(img.tag) && !['form', 'plot'].includes(img.kind);
    if (painted && (img.areaFraction ?? 0) >= CANVAS_SHARE_OF_VIEWPORT) {
      add('content-not-dom', `A ${img.tag} covering ${Math.round(img.areaFraction * 100)}% of the viewport is not a declared figure. Content painted rather than marked up is invisible to every other rule, and to every reader not using their eyes`, { imagery: img });
    }
  }

  const { isII } = ctx;
  let forms = 0;
  for (const img of spec.imagery ?? []) {
    if (isII && !['form', 'plot'].includes(img.kind)) {
      add('decorative-imagery', 'Register II permits only a generative Form or a data plot as a figure', { imagery: img });
    }
    if (img.kind === 'plot' && !img.generated) add('figure-hand-drawn', 'A plot is produced by a generator and carries data-generated', { imagery: img });
    if (img.kind === 'form') {
      forms++;
      if (['img', 'canvas', 'video', 'picture'].includes(img.tag)) add('mark-not-svg', 'The mark is SVG only, never rasterised', { imagery: img });
      if (img.sizePx != null && img.sizePx < markParams.minSizePx) add('mark-too-small', `The mark renders at ${markParams.minSizePx}px minimum, got ${img.sizePx}px`, { imagery: img });
    }
  }
  if (isII && forms > 1) add('mark-once-ii', 'In Register II the mark appears once, small, in a provenance panel', { count: forms });
}
