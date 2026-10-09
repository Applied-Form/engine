/**
 * The cheap tier.
 *
 * The browser gate measures what a page rendered, which is the only way to catch an inherited
 * colour, a composited ground, a focus ring or a reflow — and it costs a browser. A hard-coded
 * hex in a stylesheet needs none of that: it is visible in the source, and a static linter catches
 * it in milliseconds, in the editor, before the commit. The research report's one substantive
 * engineering recommendation was to stop paying browser prices for that class of mistake, and it
 * is right.
 *
 * So this emits a stylelint config from the token file: the values a stylesheet may write
 * literally, and the properties that must come from a custom property instead. It is generated
 * rather than written, so it cannot drift from the tokens, and it is the pre-commit tier — the
 * browser stays the gate, because static analysis cannot see any of the things the gate is for.
 *
 * A consumer installs `stylelint` and `stylelint-declaration-strict-value` themselves; neither is
 * a dependency of this package, which has one.
 */
import { writeFileSync } from 'node:fs';
import { colors, spacingScale, fonts, radiusScale, absent } from '../src/lib/tokens.mjs';

const OUT = new URL('../dist/', import.meta.url);

// Properties whose value should be a token reference rather than a literal. Colour first, because
// that is where drift starts.
const TOKENED = [
  '/color$/', 'background', 'background-color', 'border-color', 'outline-color',
  'fill', 'stroke', 'box-shadow',
  '/^margin/', '/^padding/', 'gap', 'row-gap', 'column-gap',
  'font-family', 'border-radius',
];

// Values that are always allowed, because they say "nothing here" rather than a design decision.
// The last entry is arithmetic over a token — `calc(-1 * var(--af-grid-gutter))` is how a bleed
// is written — which the plugin otherwise reads as a literal. The first run of this config over
// the reference pages found exactly one warning, and it was that (eval/compare.mjs).
const ALWAYS = ['currentColor', 'inherit', 'initial', 'unset', 'revert', 'transparent', 'none', 'auto', '0', '0px', '/^calc\\(.*var\\(--af-/'];

const config = {
  $generated: 'scripts/build-stylelint.mjs from tokens/applied-form.tokens.json. Do not edit by hand.',
  plugins: ['stylelint-declaration-strict-value'],
  // The generated stylesheets are where the tokens are *defined*, each as a literal, so running
  // this config over them reports every token as a violation — 138 hex colours on a page the gate
  // finds clean, the first time it was tried (eval/compare.mjs). The static tier is for CSS a
  // person writes against the tokens, never for the file that defines them.
  ignoreFiles: ['**/dist/**'],
  rules: {
    // Every tokened property takes a var(--af-*), or one of the values that mean nothing.
    'scale-unlimited/declaration-strict-value': [
      TOKENED,
      {
        ignoreValues: ALWAYS,
        ignoreFunctions: false,
        expandShorthand: true,
        message: 'Use a design token: var(--af-…). A literal value here is how a system drifts.',
      },
    ],
    // The declared absences, stated as the static half of the rules that the browser enforces.
    'declaration-property-value-disallowed-list': {
      ...(absent.includes('radius') ? { 'border-radius': ['/^(?!0)/'] } : {}),
      ...(absent.includes('shadow') ? { 'box-shadow': ['/^(?!none)/'] } : {}),
      ...(absent.includes('gradient-fill') ? { 'background-image': ['/gradient\\(/'] } : {}),
    },
    'color-no-hex': true,
    'unit-disallowed-list': ['pt', 'pc', 'in', 'cm', 'mm'],
  },
  $tokens: {
    note: 'For a config that lists values rather than forbidding literals, these are the ones the system has.',
    colors: Object.values(colors),
    spacing: spacingScale.map((v) => `${v}px`),
    radius: radiusScale.length ? radiusScale.map((v) => `${v}px`) : ['0'],
    families: Object.values(fonts).map((stack) => stack[0]),
  },
};

const body = `/* ${config.$generated} */\nmodule.exports = ${JSON.stringify(config, null, 2)};\n`;
writeFileSync(new URL('stylelint.config.cjs', OUT), body);
console.log(`wrote dist/stylelint.config.cjs (${TOKENED.length} tokened properties, ${Object.values(colors).length} colours)`);
