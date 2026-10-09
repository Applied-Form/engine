/** Composition: layers, rotation, offsets, bleeds, panels, type-above-Form, recipes. */
import { aspectRatios } from '../tokens.mjs';

export function checkComposition(ctx, spec, add) {
  const comp = spec.composition ?? {};
  for (const z of comp.zIndex ?? []) add('layer-unknown', `z-index ${z.zIndex} is not a layer token (ground 0, form 1, type 2, data 3, overlay 4)`, { item: z });
  for (const r of comp.rotation ?? []) add('rotation-off-set', `Rotation ${r.rotation}° is not in the permitted set`, { item: r });
  for (const o of comp.offsets ?? []) add('offset-off-grid', `A placed element sits off the column lines or off the 8px scale (left ${o.left}px, top ${o.top}px)`, { item: o });
  for (const b of comp.bleeds ?? []) add('bleed-off-scale', `An element runs ${b.over}px past its grid: bleeds are half a gutter, one column, or past the frame`, { item: b });
  for (const pnl of comp.panels ?? []) {
    if (!aspectRatios.includes(pnl.declared)) add('panel-ratio-unknown', `Panel ratio ${pnl.declared} is not one of ${aspectRatios.join(', ')}`, { item: pnl });
    else if (!pnl.ok) add('panel-ratio', `Panel declares ${pnl.declared} but measures ${pnl.measured}`, { item: pnl });
  }
  for (const f of comp.formOverType ?? []) add('form-over-type', `Type is always above Form; "${f.sample}" is behind the mark`, { item: f });
  for (const m of comp.motion ?? []) add('motion-off-scale', `${m.property} of ${m.ms}ms is not a motion token (short 200, medium 480, long 960)`, { item: m });
  for (const r of comp.recipe ?? []) {
    // A move authored for one column count cannot be laid out on another: its cells are absolute
    // column indices, and a fraction like five-eighths has no column line on a twelve-column grid.
    // Saying that is more useful than listing cells the page could not have produced.
    const grids = r.columns && r.authoredFor && r.columns !== r.authoredFor
      ? ` This page's grid has ${r.columns} columns and the move is authored for ${r.authoredFor}, so its cells have no column line here.`
      : '';
    add('recipe-mismatch', `${r.spread}: grid cells ${r.missing.join(', ')} from the recipe are not present (found ${r.have.join(', ')}).${grids}`, { item: r });
  }
}
