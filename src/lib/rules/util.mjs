/** Shared helpers for rule modules. */
export const norm = (hex) => (typeof hex === 'string' ? hex.toUpperCase() : hex);
export const eq = (a, b) => norm(a) === norm(b);
