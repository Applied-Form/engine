/** Accessibility: target size (WCAG 2.5.8) and missing alt text/labels. */

export function checkTargetSize(ctx, spec, add) {
  for (const t of spec.targets ?? []) {
    if (t.ariaHidden) {
      add('hidden-interactive', `A ${t.element} is inside aria-hidden="true" but is still focusable and clickable. It is reachable by keyboard and absent from the accessibility tree, which is worse than either alone`, { target: t });
    }
  }

  for (const t of spec.targets ?? []) {
    if (t.inline) continue; // WCAG 2.5.8: inline links inside running text are exempt.
    if (t.width < 24 || t.height < 24) {
      add('target-size', `Interactive targets are at least 24px in both dimensions, got ${t.width}×${t.height}px on a ${t.element}`, { target: t });
    }
  }
}

export function checkAltMissing(ctx, spec, add) {
  for (const img of spec.imagery ?? []) {
    if (img.tag === 'img' && img.hasAlt === false) {
      add('alt-missing', 'Every <img> carries an alt attribute', { imagery: img });
    }
    // aria-hidden is an acceptable answer for a figure that carries no information — a shape
    // beside a heading. It is not an acceptable answer for a figure whose content is words: an
    // SVG full of text is read by the eye and by nothing else, and hiding it hides the content
    // rather than describing it. The research report proposed this as an attack; it landed.
    const carriesWords = (img.textLength ?? 0) > 24;
    if (img.tag === 'svg' && ['plot', 'form'].includes(img.kind) && img.hasAriaLabel === false && img.hasTitle === false
        && (img.ariaHidden !== true || carriesWords)) {
      add('alt-missing', carriesWords
        ? `A figure svg carrying ${img.textLength} characters of text needs aria-label or a <title>; aria-hidden hides the content rather than describing it`
        : 'A figure svg carries aria-label, a <title>, or aria-hidden="true"', { imagery: img });
    }
  }
}
