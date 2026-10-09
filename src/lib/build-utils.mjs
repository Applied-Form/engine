/**
 * Shared helpers for the scripts/build-*.mjs scripts: repo-relative paths,
 * the CSS type shorthand, and a logging writer. The wordmark and mark helpers, which read the
 * brand's own assets, are in identity.mjs, so this module carries nothing the open engine lacks.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Absolute path to the repo root, trailing slash included. */
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** Output root: dist/ for the base system, dist/brands/<name>/ when AF_BRAND names a brand overlay. */
export const BRAND = process.env.AF_BRAND || null;
// AF_BRAND may be a path to an overlay file (tokens.mjs); its output goes under its file name,
// never under the path, which could be absolute or climb out of dist/.
const brandKey = BRAND && BRAND.endsWith('.json') ? BRAND.split(/[\\/]/).pop().replace(/(\.tokens)?\.json$/, '') : BRAND;
export const DIST = BRAND ? `dist/brands/${brandKey}/` : 'dist/';

/** Ensure `${ROOT}${sub}` exists and return it. */
export function outDir(sub) {
  const dir = `${ROOT}${sub}`;
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The CSS `font` shorthand fragment for a type-scale token name. */
export function typeShorthand(name) {
  return `var(--af-type-${name}-weight) var(--af-type-${name}-size)/var(--af-type-${name}-leading)`;
}

/** Write `content` to `path` (absolute) and log a relative confirmation. */
export function writeGenerated(path, content) {
  writeFileSync(path, content);
  console.log(`wrote ${path.startsWith(ROOT) ? path.slice(ROOT.length) : path}`);
}
