# Accessibility scope

This linter is a design-system conformance checker, not an accessibility audit. It catches
a specific, bounded set of things: colours, sizes, spacing, and a handful of structural
rules, evaluated against a static description of a page (`spec` objects, or DOM extracted
from a rendered page by `page-lint.mjs`). Passing it is **not a claim of WCAG conformance**
and it does **not substitute for a human accessibility audit**, assistive-technology testing,
or a VPAT.

Contrast is not checked on text inside an inactive user interface component, because WCAG 1.4.3
exempts it explicitly. That is an exemption the standard grants, not one this system invented.

## WCAG 2.2 success criteria this linter tests, at least partially

Run `node scripts/rules.mjs --wcag` for the exact rule-to-SC mapping. As of this writing:

- **1.1.1 Non-text Content** — partially. Checks that `<img>` and figure `<svg>` elements carry
  alt text or an accessible name; an SVG carrying more than a label's worth of text needs a real
  name rather than `aria-hidden`, because hiding it hides the content. Also fails a page that
  carries its content on a canvas or video surface instead of in markup. Does not evaluate whether
  any of that text is accurate or useful.
- **1.3.1 Info and Relationships** — partially. Checks heading level order, and that an interactive
  element is not hidden from the accessibility tree with `aria-hidden` while remaining focusable.
  Does not check list markup, table headers, landmark regions, or any other structural relationship.
- **1.4.1 Use of Color** — partially. Checks that status indicators carry a label and a shape,
  not colour alone. Does not check every other place colour might be the only signal.
- **1.4.3 Contrast (Minimum)** — checks text-colour contrast against its background using the
  WCAG 2 formula, at both the required ratio and (advisory only) an APCA reading.
- **1.4.8 Visual Presentation** — partially. Checks line measure (max characters per line) only,
  one of several 1.4.8 sub-requirements.
- **1.4.10 Reflow** — partially. Checks for horizontal scrolling at the tested viewport widths
  only. Does not test reflow at 400% zoom.
- **1.4.11 Non-text Contrast** — partially. Checks chart series-mark contrast only. Does not
  check UI component or state-indicator contrast generally.
- **2.3.3 Animation from Interactions** — partially. Checks that declared animations stop under
  `prefers-reduced-motion`. Does not detect all motion triggers.
- **2.4.7 Focus Visible** — partially. Checks that focus indication isn't removed. Does not
  verify the indicator is visible against every background it can appear on.
- **2.5.8 Target Size (Minimum)** — checks interactive target dimensions against the 24×24px
  floor, with the inline-text exemption WCAG allows.
- **4.1.2 Name, Role, Value** — barely, and only in one direction: an interactive element hidden
  from assistive technology with `aria-hidden` while still focusable is reported. Nothing else about
  names, roles or values is checked.

## What this linter does NOT test at all

- ARIA validity (roles, states, properties used correctly), beyond the one `aria-hidden` case above
- Keyboard traps or full keyboard operability
- Form label association
- Screen-reader output — what assistive technology actually announces
- Reflow at 400% zoom
- Colour-blindness simulation
- Language of page or of parts (`lang` attributes)
- Error identification and suggestion (form validation messaging)
- Link purpose (out of context or in context) — requires human judgement
- Meaningful sequence — requires human judgement
- Alt text *quality*, as opposed to presence — requires human judgement
- Any other WCAG 2.2 success criterion not listed above as at least partially tested

## Bottom line

This tool checks that a page follows the Applied Form design system, and along the way it
happens to test parts of eleven WCAG 2.2 success criteria. It does not test the other ~39. A
page can pass every rule here and still fail an accessibility audit, and can fail a rule
here for a reason that has nothing to do with accessibility (most rules are house style with
no WCAG basis at all — see the `wcag: []` entries in `src/lib/rules/registry.mjs`). Treat a
clean run as "no known design-system or partial-accessibility regressions," not as a
conformance claim. For an actual conformance claim, commission a manual audit against WCAG 2.2
AA, including assistive-technology testing.
