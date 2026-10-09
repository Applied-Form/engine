/**
 * Registry of every rule id that `lint()` or `advise()` in ../rules.mjs can
 * emit. This is the single source of truth for "what rules exist" — read it,
 * or run `node scripts/rules.mjs`, instead of reading the rule modules.
 *
 * `severity` is the DEFAULT severity: 'error' for everything `lint()` emits
 * (it fails a build), 'advisory' for the two ids `advise()` emits (they never
 * fail a build; WCAG 2 floors are the gate, APCA is advisory).
 *
 * `wcag` lists WCAG 2.2 success criteria the rule contributes to testing, at
 * least partially. An empty array means the rule is a house style rule with
 * no WCAG basis. See docs/accessibility-scope.md for what this does and does
 * not cover.
 */

export const GROUPS = [
  'colour', 'type', 'layout', 'composition', 'interaction', 'imagery',
  'chart', 'document', 'motion', 'spread', 'accessibility', 'absence', 'register',
];

export const SEVERITIES = ['error', 'advisory'];

export const RULES = [
  // register
  { id: 'register', group: 'register', severity: 'error', summary: 'Every spec declares a register, "i" or "ii".', why: "All other checks resolve against one register's palette and rules.", wcag: [] , fix: 'Put data-register="i" or "ii" on the document root.' },
  { id: 'register-mixed', group: 'register', severity: 'error', summary: 'The register switches only at a document boundary, never mid-page.', why: "Mixing registers on one page breaks each register's internal logic.", wcag: [] , fix: 'Split the document: one register per page, decided at the document boundary.' },

  // colour
  { id: 'background', group: 'colour', severity: 'error', summary: 'The page background matches the fixed background colour for its register.', why: 'Each register has exactly one background; anything else is off-system.', wcag: [] , fix: "Set the page background to the register's own, or change the register." },
  { id: 'ground-off-palette', group: 'colour', severity: 'error', summary: "A full-bleed ground colour is one of the register's defined grounds.", why: 'Grounds outside the palette are off-system.', wcag: [] , fix: "Use one of the register's declared grounds, or add this colour to them with a decision record." },
  { id: 'support-as-ground', group: 'colour', severity: 'error', summary: 'A colour the system declares as never-a-ground is not used as a full-bleed ground.', why: 'A colour reserved for one job — chart series, in this system — loses that meaning if it also carries a field.', wcag: [] , fix: 'Use one of the declared grounds instead; this colour carries meaning elsewhere.' },
  { id: 'ground-in-ii', group: 'colour', severity: 'error', summary: 'Register II carries no full-bleed colour grounds.', why: 'Register II is plain by design; colour fields belong to Register I.', wcag: [] , fix: 'Remove the full-bleed colour, or move this content to a Register I document.' },
  { id: 'accent-non-interactive-ii', group: 'colour', severity: 'error', summary: 'In Register II the accent colour appears only on interactive or data text.', why: 'Reserving the accent for interactive elements keeps it meaningful as a signal.', wcag: [] , fix: 'Set this text in the body colour, or make the element a link or button.' },
  { id: 'label-apca', group: 'colour', severity: 'error', summary: 'Label-size text clears the APCA Lc floor for its size.', why: 'Small text needs higher effective contrast to stay legible.', wcag: ['1.4.3'] , fix: 'Darken the text or lighten the ground until it clears the Lc floor, or set it larger than label size.' },
  { id: 'contrast', group: 'colour', severity: 'error', summary: 'Text meets the WCAG contrast floor required for its size and weight.', why: 'Text below the floor is illegible for many readers.', wcag: ['1.4.3'] , fix: 'Use the fallback named in the message, or change the ground.' },
  { id: 'forbidden-pairing', group: 'colour', severity: 'error', summary: 'A text-on-ground pairing the system forbids outright is not used.', why: 'A system may refuse a pairing that clears the contrast floor but still reads badly; the floor is a minimum, not the whole judgement.', wcag: [] , fix: 'Change one of the two: this pairing is refused whatever it measures.' },
  { id: 'caution-as-text', group: 'colour', severity: 'error', summary: 'Caution colour is used as a fill, never as small running text on a light ground.', why: "At text sizes, caution's contrast on a light ground falls short of the floor.", wcag: ['1.4.3'] , fix: 'Use the deep variant for text, and keep this colour for fills.' },
  { id: 'apca-advisory', group: 'colour', severity: 'advisory', summary: 'Text clears the APCA advisory threshold for its size, above and beyond the WCAG floor.', why: 'APCA better predicts perceived legibility, but WCAG 2 remains the enforced floor.', wcag: [] , fix: 'Advisory only. Raise the contrast if the text is small or thin, or record why it stands.' },

  // type
  { id: 'font-off-system', group: 'type', severity: 'error', summary: 'Every text run uses one of the voices the system declares.', why: "A typeface outside the set breaks the system's closed set of voices.", wcag: [] , fix: "Set this run in one of the system's voices; a fourth typeface is not available." },
  { id: 'wordmark-live-text', group: 'type', severity: 'error', summary: 'The wordmark is always the outlined SVG, never live text.', why: "Live text can't guarantee the wordmark's exact letterforms across environments.", wcag: [] , fix: 'Replace the text inside .af-wordmark with the outlined SVG.' },
  { id: 'display-voice-in-ii', group: 'type', severity: 'error', summary: 'The display voice appears in Register II only in the wordmark.', why: "The display voice is Register I's expressive one; Register II stays plain.", wcag: [] , fix: 'Set this run in the text voice; the display voice belongs to Register I.' },
  { id: 'heading-voice-ii', group: 'type', severity: 'error', summary: 'Register II headings are set in the text voice at the heading weight.', why: "A consistent heading voice keeps Register II's hierarchy plain and legible.", wcag: [] , fix: 'Set the heading in the text voice at the heading weight.' },
  { id: 'data-not-mono', group: 'type', severity: 'error', summary: "Every numeral, unit, label, ID, and status is set in the system's data voice.", why: 'A consistent data voice makes data distinguishable from prose at a glance.', wcag: [] , fix: 'Set numerals, units, IDs and labels in the data voice, or mark the run data-voice="data".' },
  { id: 'text-too-small', group: 'type', severity: 'error', summary: "No text is set below the system's minimum size.", why: 'Below that size, text becomes hard to read for most people.', wcag: [] , fix: 'Raise the size to the minimum; nothing in the system is smaller.' },
  { id: 'body-too-small', group: 'type', severity: 'error', summary: 'Register II body text meets its register-specific minimum size.', why: "Register II's plain, document-like use calls for a larger body minimum than the system floor.", wcag: [] , fix: 'Raise Register II body text to its minimum, or mark it as a data run if that is what it is.' },
  { id: 'measure', group: 'type', severity: 'error', summary: 'Text measure stays at or under the maximum line length.', why: 'Lines longer than the maximum are harder to track while reading.', wcag: ['1.4.8'] , fix: 'Cap the block at the measure, or give it fewer columns.' },
  { id: 'display-weight', group: 'type', severity: 'error', summary: "The display voice's weight stays within the system's permitted range.", why: "Weights outside the range don't match the display voice's design intent.", wcag: [] , fix: 'Bring the weight inside the permitted range.' },

  // layout
  { id: 'aspect-ratio', group: 'layout', severity: 'error', summary: "Every image and tile uses one of the system's defined aspect ratios.", why: "Arbitrary ratios don't compose with the grid or the imagery system.", wcag: [] , fix: "Crop or size the image to one of the system's ratios." },
  { id: 'horizontal-overflow', group: 'layout', severity: 'error', summary: 'The page does not scroll horizontally at its viewport width.', why: 'Unexpected horizontal scroll hides content and breaks reflow.', wcag: ['1.4.10'] , fix: 'Find the element wider than the viewport and let it wrap, scroll in its own container, or shrink.' },
  { id: 'grid-off-column', group: 'layout', severity: 'error', summary: 'Every item in a data-grid container starts and ends on a column line.', why: "Off-grid items break the grid's alignment guarantee.", wcag: [] , fix: 'Start and end the item on column lines, using the grid classes rather than a width.' },
  { id: 'spacing', group: 'layout', severity: 'error', summary: 'Every margin, gap, and step is on the 8px spacing scale (or a multiple above it).', why: 'A shared spacing scale keeps rhythm consistent across the system.', wcag: [] , fix: 'Round the value to the spacing scale, or use a spacing token.' },

  // composition
  { id: 'panel-ratio-unknown', group: 'composition', severity: 'error', summary: "A panel's declared aspect ratio is one of the system's named ratios.", why: "Undeclared ratios don't compose reliably with the grid.", wcag: [] , fix: 'Declare one of the named ratios in data-aspect.' },
  { id: 'panel-ratio', group: 'composition', severity: 'error', summary: "A panel's measured aspect ratio matches its declared ratio.", why: 'A mismatch signals the panel was resized without updating its declaration.', wcag: [] , fix: 'Resize the panel to the ratio it declares, or declare the ratio it actually is.' },
  { id: 'form-over-type', group: 'composition', severity: 'error', summary: 'Type always sits above the generative Form mark, never behind it.', why: 'Legibility of text takes priority over the mark.', wcag: [] , fix: 'Raise the type above the mark, or move the mark out from under the copy.' },
  { id: 'motion-off-scale', group: 'composition', severity: 'error', summary: 'Every animated property uses one of the motion duration tokens (short, medium, long).', why: "Off-scale durations break the system's motion rhythm.", wcag: [] , fix: 'Use a motion duration token: short, medium or long.' },
  { id: 'recipe-mismatch', group: 'composition', severity: 'error', summary: "A spread's grid cells match its named recipe.", why: 'Recipes define which cells a spread archetype needs to be recognisable.', wcag: [] , fix: 'Add the cells the recipe names, or use a different spread; af move <name> emits the scaffold.' },
  { id: 'layer-unknown', group: 'composition', severity: 'error', summary: "Every element's z-index is one of the defined layer tokens (ground, form, type, data, overlay).", why: 'Undeclared stacking order is unpredictable across contexts.', wcag: [] , fix: 'Take the z-index from a layer token: ground, form, type, data or overlay.' },
  { id: 'rotation-off-set', group: 'composition', severity: 'error', summary: 'Rotation is one of the permitted angles.', why: "Arbitrary rotation breaks the system's controlled set of moves.", wcag: [] , fix: 'Use one of the permitted angles, or none.' },
  { id: 'offset-off-grid', group: 'composition', severity: 'error', summary: "A placed element's left and top sit on column lines and the 8px scale.", why: 'Off-grid placement breaks alignment with everything else on the page.', wcag: [] , fix: 'Place the element on a column line horizontally and on the 8px scale vertically.' },
  { id: 'bleed-off-scale', group: 'composition', severity: 'error', summary: 'An element that bleeds past its frame does so by half a gutter, one column, or the full frame.', why: "Arbitrary bleed amounts don't read as intentional.", wcag: [] , fix: 'Bleed by half a gutter, one column, or past the frame; nothing between.' },

  // interaction
  { id: 'status-colour-only', group: 'interaction', severity: 'error', summary: 'Every status carries a label and a shape, not colour alone.', why: "Colour alone excludes people who can't distinguish it.", wcag: ['1.4.1'] , fix: 'Give the status a label and a shape, so it reads without colour.' },
  { id: 'focus-hidden', group: 'interaction', severity: 'error', summary: 'Every focusable element keeps a visible focus state.', why: 'Removing focus indication strands keyboard users.', wcag: ['2.4.7'] , fix: 'Remove the outline: none, or replace it with the system focus ring.' },
  { id: 'focus-restyled', group: 'interaction', severity: 'error', summary: "Focus rings use the system's one focus colour in both registers.", why: 'A restyled focus ring breaks a consistent, learnable signal.', wcag: [] , fix: "Use the system's focus colour and ring width." },
  { id: 'link-not-underlined', group: 'interaction', severity: 'error', summary: 'Links are underlined.', why: "Underlining is the one link signal that doesn't depend on colour perception.", wcag: [] , fix: 'Underline the link; colour alone is not a link signal.' },
  { id: 'link-colour-ii', group: 'interaction', severity: 'error', summary: "Register II link text uses the register's terra-deep link colour.", why: 'A consistent link colour keeps links recognisable across Register II.', wcag: [] , fix: "Use the register's link colour." },

  // accessibility
  { id: 'hidden-interactive', group: 'accessibility', severity: 'error', summary: 'A focusable element is not hidden from assistive technology with aria-hidden.', why: 'An element reachable by keyboard but absent from the accessibility tree strands the people who rely on it, and reads as compliant to a checker that only counts labels.', wcag: ['1.3.1', '4.1.2'] , fix: 'Remove aria-hidden, or make the element genuinely unreachable with disabled or inert.' },
  { id: 'target-size', group: 'accessibility', severity: 'error', summary: 'Interactive targets are at least 24×24px unless the target is inline in running text.', why: 'Small targets are hard to activate for people with limited precision.', wcag: ['2.5.8'] , fix: 'Grow the target to the minimum, or add padding around it; inline links in prose are exempt.' },
  { id: 'alt-missing', group: 'accessibility', severity: 'error', summary: 'Every <img> and figure <svg> carries alt text, an aria-label/title, or aria-hidden.', why: 'Non-text content needs a text alternative for assistive technology.', wcag: ['1.1.1'] , fix: 'Give it alt text, an aria-label, or a <title>. Hide it only if it carries nothing.' },

  // absence
  { id: 'shadow-present', group: 'absence', severity: 'error', summary: 'No box-shadow appears except on the named exemptions (skip link, secondary button, current-page marker, focus ring).', why: 'Shadow is a declared absence in this system; only a few components are exempt by name.', wcag: [] , fix: 'Remove the shadow; this system declares it absent.' },
  { id: 'gradient-fill', group: 'absence', severity: 'error', summary: 'A gradient is a full-width background ground, never a text fill or a fill on a narrow element.', why: 'Gradients are declared absent except as wide grounds.', wcag: [] , fix: 'Use a flat colour, or make the gradient a full-width ground.' },
  { id: 'radius-present', group: 'absence', severity: 'error', summary: 'No element has rounded corners except a range-input thumb, in a system that declares radius absent.', why: 'Radius is a declared absence in this system.', wcag: [] , fix: 'Square the corners; this system declares radius absent.' },
  { id: 'radius-off-scale', group: 'absence', severity: 'error', summary: 'In a system that permits radius, every corner radius is one of its declared steps.', why: 'A system that has a radius scale is held to it exactly as strictly as one that has none.', wcag: [] , fix: 'Use one of the declared radius steps, or none.' },
  { id: 'elevation-off-scale', group: 'absence', severity: 'error', summary: 'In a system that permits shadow, every shadow is one of its declared elevations.', why: 'An elevation scale is a set of named steps; a shadow outside it is off-system.', wcag: [] , fix: 'Use one of the declared elevations.' },

  // imagery
  { id: 'content-not-dom', group: 'imagery', severity: 'error', summary: 'A page does not carry its content on a canvas or video surface instead of in markup.', why: 'Content painted rather than marked up is invisible to every rule that reads rendered elements, and to every reader not using their eyes.', wcag: ['1.1.1'] , fix: 'Build the content as markup. Keep the canvas for a declared figure and give it a text alternative.' },
  { id: 'figure-hand-drawn', group: 'imagery', severity: 'error', summary: 'A plot figure is produced by the generator and carries a data-generated marker.', why: "Hand-drawn plots can't be trusted to match the underlying data.", wcag: [] , fix: 'Generate the plot from its data so it carries data-generated.' },
  { id: 'mark-not-svg', group: 'imagery', severity: 'error', summary: 'The generative mark renders as SVG, never as a raster image, canvas, or video.', why: 'A rasterised mark loses the scalability and crispness SVG gives it.', wcag: [] , fix: 'Render the mark as inline SVG.' },
  { id: 'mark-too-small', group: 'imagery', severity: 'error', summary: 'The generative mark renders at or above its minimum size.', why: "Below that size the mark's form is no longer legible.", wcag: [] , fix: 'Render the mark at or above its minimum size.' },
  { id: 'decorative-imagery', group: 'imagery', severity: 'error', summary: 'Register II permits only a generative Form or a data plot as a figure.', why: "Decorative imagery doesn't belong in Register II's plain register.", wcag: [] , fix: 'Remove the image, or replace it with a generative Form or a data plot.' },
  { id: 'mark-once-ii', group: 'imagery', severity: 'error', summary: 'In Register II the mark appears at most once, small, in a provenance panel.', why: 'Repeating the mark in Register II would read as branding, not provenance.', wcag: [] , fix: 'Keep one mark, in the provenance panel, and remove the rest.' },

  // chart
  { id: 'chart-legend', group: 'chart', severity: 'error', summary: 'Chart series are labelled directly on the chart, not only through a legend.', why: 'A legend forces a lookup that direct labelling avoids.', wcag: [] , fix: 'Label each series on the chart itself and remove the legend.' },
  { id: 'series-count', group: 'chart', severity: 'error', summary: 'A chart has no more series than the token maximum.', why: "Beyond the maximum, series stop being distinguishable at a glance.", wcag: [] , fix: 'Reduce the number of series, or split the chart.' },
  { id: 'series-order', group: 'chart', severity: 'error', summary: 'Chart series colours follow one of the defined series lists, in order.', why: 'A fixed order keeps colour-to-meaning mapping consistent across charts.', wcag: [] , fix: 'Take the series colours from the declared list, in its order.' },
  { id: 'series-contrast', group: 'chart', severity: 'error', summary: 'Every chart series mark meets the minimum contrast against its background.', why: "A series that doesn't stand out from its ground can't be read.", wcag: ['1.4.11'] , fix: 'Use the on-light or on-dark series list for this ground.' },
  { id: 'series-unlabelled', group: 'chart', severity: 'error', summary: "When a chart isn't labelled directly, its legend is still required.", why: "Colour alone can't carry a series' identity.", wcag: [] , fix: 'Label the series directly, or keep the legend.' },
  { id: 'series-indistinct', group: 'chart', severity: 'error', summary: 'Neighbouring chart series differ enough in luminance to be told apart without a legend.', why: 'Series that carry meaning by colour alone must still be distinguishable.', wcag: [] , fix: 'Choose series that differ in lightness, not only in hue.' },

  // document
  { id: 'heading-order', group: 'document', severity: 'error', summary: 'Headings step down one level at a time and a Register II document starts at h1.', why: 'Skipped levels break the outline assistive technology relies on.', wcag: ['1.3.1'] , fix: 'Step headings down one level at a time, starting at h1.' },
  { id: 'provenance-required', group: 'document', severity: 'error', summary: 'A Register II document past the word-count threshold carries a provenance panel.', why: 'Long documents need a visible record of source and authorship.', wcag: [] , fix: 'Add a provenance panel: source, author, date.' },
  { id: 'print-overflow', group: 'document', severity: 'error', summary: 'Printed content fits within the page width.', why: 'Content wider than the page is cut off or misprinted.', wcag: [] , fix: 'Let the content wrap or scale so it fits the printed page width.' },
  { id: 'print-link-url', group: 'document', severity: 'error', summary: 'In print, an external link shows its URL text, not just link text.', why: 'A printed page has no href to follow.', wcag: [] , fix: 'Print the URL after the link text.' },
  { id: 'print-orphan-heading', group: 'document', severity: 'advisory', summary: 'A heading does not print alone at the foot of a page.', why: 'An orphaned heading separates a section title from its content across the page break.', wcag: [] , fix: 'Advisory. Keep the heading with its first paragraph if the break is real.' },

  // motion
  { id: 'motion-not-reduced', group: 'motion', severity: 'error', summary: 'Every animation stops under prefers-reduced-motion.', why: "Motion that ignores the user's reduced-motion preference can cause harm.", wcag: ['2.3.3'] , fix: 'Collapse every animation to none under prefers-reduced-motion.' },

  // spread
  { id: 'spread-unknown', group: 'spread', severity: 'error', summary: "A spread is one of the system's named archetypes.", why: "Undeclared spreads aren't part of the system's controlled set of moves.", wcag: [] , fix: 'Use one of the named spreads, or add this one with a recipe and a decision record.' },
  { id: 'spread-in-ii', group: 'spread', severity: 'error', summary: 'Spread archetypes appear only in Register I.', why: 'Spreads are an expressive Register I device; Register II is plain.', wcag: [] , fix: 'Move the spread to a Register I document.' },
  { id: 'spread-once', group: 'spread', severity: 'error', summary: 'A spread archetype marked once-per-document appears only once.', why: 'Repeating it dilutes the specific moment it is meant to mark.', wcag: [] , fix: 'Keep one instance of this spread in the document.' },
  { id: 'spread-ground', group: 'spread', severity: 'error', summary: "A spread sits on its archetype's defined ground colour.", why: "Each spread's ground is part of what makes it recognisable.", wcag: [] , fix: "Set the spread's ground to the one its archetype defines." },
  { id: 'spread-grounds', group: 'spread', severity: 'error', summary: 'A spread carries exactly the number of colour fields its archetype defines.', why: "The count of colour fields is part of the archetype's definition.", wcag: [] , fix: 'Use exactly the number of colour fields the archetype defines.' },
  { id: 'spread-join', group: 'spread', severity: 'error', summary: "A spread's two colour fields meet on a column line.", why: "An off-column join breaks the archetype's alignment with the grid.", wcag: [] , fix: 'Move the join onto a column line.' },
  { id: 'spread-mark-over-body', group: 'spread', severity: 'error', summary: "A spread's bled Form mark never sits behind body copy.", why: 'Body copy over the mark hurts legibility.', wcag: [] , fix: 'Move the mark out from behind the body copy.' },
  { id: 'spread-figure-voice', group: 'spread', severity: 'error', summary: "A spread's headline figure is set in its archetype's defined voice.", why: 'The figure\'s voice is part of what identifies the archetype.', wcag: [] , fix: "Set the headline figure in the archetype's voice." },
];

export const RULE_IDS = new Set(RULES.map((r) => r.id));

/** RULES filtered to one severity ('error' | 'advisory'). */
export function bySeverity(severity) {
  return RULES.filter((r) => r.severity === severity);
}

/** RULES filtered to one group. */
export function byGroup(group) {
  return RULES.filter((r) => r.group === group);
}
