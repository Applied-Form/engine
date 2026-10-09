/** Motion collapses under prefers-reduced-motion. */
export function checkMotion(ctx, spec, add) {
  if (spec.motion && spec.motion.underReducedMotion > 0) {
    add('motion-not-reduced', `${spec.motion.underReducedMotion} animation(s) still run under prefers-reduced-motion`, { motion: spec.motion });
  }
}
