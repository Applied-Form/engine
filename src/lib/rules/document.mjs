/** Long-form structure: heading order, provenance panel, print. */
import { floors } from '../tokens.mjs';

export function checkDocument(ctx, spec, add) {
  const { isII } = ctx;
  if (spec.headings) {
    let prev = 0;
    for (const h of spec.headings) {
      if (prev && h.level > prev + 1) add('heading-order', `Heading level skips from h${prev} to h${h.level} at "${h.sample}"`, { heading: h });
      prev = h.level;
    }
    if (isII && spec.headings.length && spec.headings[0].level !== 1) add('heading-order', `A document starts with an h1, not h${spec.headings[0].level}`, { heading: spec.headings[0] });
  }
  if (isII && spec.wordCount != null && spec.wordCount > floors.provenanceAfterWords && !spec.hasProvenance) {
    add('provenance-required', `A document of ${spec.wordCount} words carries a provenance panel (.af-provenance)`, { wordCount: spec.wordCount });
  }
  if (spec.print) {
    if (spec.print.overflowX > 0) add('print-overflow', `Content is wider than the printed page by ${spec.print.overflowX}px`, { print: spec.print });
    for (const l of spec.print.linksWithoutHref ?? []) add('print-link-url', `In print an external link shows its URL; "${l}" does not`, { link: l });
  }
}
