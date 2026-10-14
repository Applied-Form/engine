/**
 * Patches to CSS. Each element a patch names is addressed by the structural selector the checker
 * computed in the load it measured, so the fixes live in one appended stylesheet, the page's own markup
 * is untouched, and the page is never opened outside the checker's sandbox.
 */
/** One CSS rule per patch, aligned with `patches`; null where the checker gave no selector. A `subtree` patch reaches the element's descendants too. */
export function cssOf(patches) {
  return patches.map((p) => {
    if (!p.sel) return null;
    const body = Object.entries(p.decl).map(([k, v]) => `${k}: ${v} !important`).join('; ');
    const sel = p.subtree ? `${p.sel}${p.pseudo}, ${p.sel} *${p.pseudo}` : `${p.sel}${p.pseudo}`;
    return `${sel} { ${body}; }`;
  });
}

/** The model's own edits, kept in their own block so the fixer's block and theirs never erase each other. */
export function withPatches(html, css) {
  const stripped = html.replace(/<style data-af-patch>[\s\S]*?<\/style>\n?/g, '');
  if (!css) return stripped;
  const block = `<style data-af-patch>\n${css}\n</style>`;
  if (/<\/head>/i.test(stripped)) return stripped.replace(/<\/head>/i, `${block}\n</head>`);
  const opener = stripped.match(/<html[^>]*>/i) ?? stripped.match(/<!doctype[^>]*>/i);
  if (opener) {
    const at = opener.index + opener[0].length;
    return `${stripped.slice(0, at)}\n${block}${stripped.slice(at)}`;
  }
  return `${block}\n${stripped}`;
}

export function withFixes(html, css) {
  const stripped = html.replace(/<style data-af-fixes>[\s\S]*?<\/style>\n?/g, '');
  if (!css) return stripped;
  const block = `<style data-af-fixes>\n${css}\n</style>`;
  if (/<\/head>/i.test(stripped)) return stripped.replace(/<\/head>/i, `${block}\n</head>`);
  // Never ahead of the doctype: anything before it puts the page in quirks mode.
  const opener = stripped.match(/<html[^>]*>/i) ?? stripped.match(/<!doctype[^>]*>/i);
  if (opener) {
    const at = opener.index + opener[0].length;
    return `${stripped.slice(0, at)}\n${block}${stripped.slice(at)}`;
  }
  return `${block}\n${stripped}`;
}
