/** Named spread archetypes: Register I only. */
import { spreads, colorName } from '../tokens.mjs';
import { eq } from './util.mjs';

export function checkSpreads(ctx, spec, add) {
  const { isII } = ctx;
  const seenSpreads = {};
  for (const sp of spec.spreads ?? []) {
    const def = spreads[sp.name];
    if (!def) { add('spread-unknown', `${sp.name} is not a named spread archetype`, { spread: sp }); continue; }
    if (isII) add('spread-in-ii', 'Spread archetypes belong to Register I', { spread: sp });
    seenSpreads[sp.name] = (seenSpreads[sp.name] ?? 0) + 1;
    if (def.oncePerDocument && seenSpreads[sp.name] > 1) add('spread-once', `${sp.name} is used once per document`, { spread: sp });
    if (def.ground && def.ground !== 'any' && sp.ground && !eq(sp.ground, def.ground)) {
      add('spread-ground', `${sp.name} sits on ${colorName(def.ground)} ${def.ground}, not ${sp.ground}`, { spread: sp });
    }
    if (def.grounds && (sp.grounds ?? []).length !== def.grounds) add('spread-grounds', `${sp.name} needs exactly ${def.grounds} colour fields, got ${(sp.grounds ?? []).length}`, { spread: sp });
    if (def.joinOnColumn && sp.joinOnColumn === false) add('spread-join', `${sp.name}: the two fields must meet on a column line`, { spread: sp });
    if (def.neverBehindBody && sp.markOverBody) add('spread-mark-over-body', `${sp.name}: the bled Form never sits behind body copy`, { spread: sp });
    if (def.figureVoice && sp.figureVoice && sp.figureVoice !== def.figureVoice) add('spread-figure-voice', `${sp.name}: the headline figure is set in the ${def.figureVoice} voice`, { spread: sp });
  }
}
