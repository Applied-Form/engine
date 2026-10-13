/**
 * The repair round's edit list.
 *
 * A repair that returns the whole page pays for the page twice: output tokens are what the cost bar
 * is made of, and a rewrite regenerates every line to change a few. So the model is asked for the
 * edits instead — each naming an element the checker already identified — and only falls back to a
 * rewrite when the fix genuinely needs different markup. Nothing here guesses: text that is not an
 * edit list parses to null, and the caller rewrites instead.
 */

/** The first JSON array in the text, fenced or bare, or null. */
function firstArray(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  for (const candidate of [fenced?.[1], text]) {
    if (!candidate) continue;
    const start = candidate.indexOf('[');
    if (start < 0) continue;
    for (let end = candidate.lastIndexOf(']'); end > start; end = candidate.lastIndexOf(']', end - 1)) {
      try { return JSON.parse(candidate.slice(start, end + 1)); } catch { /* try a shorter span */ }
    }
  }
  return null;
}

/** Patches the model asked for, or null if it did not return an edit list. */
export function parsePatches(text) {
  const raw = firstArray(String(text ?? ''));
  if (!Array.isArray(raw) || !raw.length) return null;
  const patches = raw
    .filter((e) => e && (typeof e.id === 'string' || typeof e.id === 'number') && e.css && typeof e.css === 'object' && Object.keys(e.css).length)
    .map((e) => ({ afId: String(e.id), pseudo: typeof e.pseudo === 'string' ? e.pseudo : '', decl: e.css }));
  return patches.length ? patches : null;
}

/** CSS for the patches whose element the checker saw; the rest are reported, never invented. */
export function patchCss(patches, selById) {
  const applied = [], unknown = [];
  const rules = [];
  for (const p of patches) {
    const sel = selById.get(String(p.afId));
    if (!sel) { unknown.push(String(p.afId)); continue; }
    const body = Object.entries(p.decl).map(([k, v]) => `${k}: ${v} !important`).join('; ');
    rules.push(`${sel}${p.pseudo} { ${body}; }`);
    applied.push(p);
  }
  return { css: rules.join('\n'), applied, unknown };
}

/** Every element the checker identified in these lint results, by the id it stamped. */
export function selectorsFrom(results) {
  const map = new Map();
  for (const r of results) {
    const spec = r.spec ?? {};
    const groups = [spec.text, spec.links, spec.targets, spec.absences, spec.focusStyles, spec.imagery, spec.spacingSources, spec.ratioSources, spec.offGrid];
    for (const g of groups) for (const item of g ?? []) if (item?.afId && item?.sel) map.set(String(item.afId), item.sel);
    for (const t of spec.text ?? []) if (t.block?.afId && t.block?.sel) map.set(String(t.block.afId), t.block.sel);
  }
  return map;
}
