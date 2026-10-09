/** Playwright driver: open each URL at each viewport, extract, lint, advise. */
import { specFromPage } from './page-spec.mjs';
import { lint, advise } from './rules.mjs';
import { aspectRatios, registers, grid, layers, composition, recipes, motion, print, fonts, recipeColumns } from './tokens.mjs';

export const FAMILIES = Object.fromEntries(Object.entries(fonts).map(([voice, list]) => [list[0], voice]));
export const VIEWPORTS = [320, 672, 1280, 1584];

/**
 * Widths drawn from between the fixed four, so a page cannot be built for the test.
 *
 * Four named viewports are four numbers a page can be written to satisfy: media queries pinned
 * to 320, 672, 1280 and 1584 pass every check while every width in between is broken. The
 * research report proposed this as an attack, and nothing in the linter stopped it.
 *
 * The sample is seeded rather than random so a failing run can be reproduced exactly — the run
 * prints the widths it used — but it moves between runs, which is what makes it a sample rather
 * than four more numbers to build to. Goldens are never measured at sampled widths: a snapshot
 * has to be comparable across runs.
 */
export function sampledViewports(count = 2, seed = Date.now()) {
  let x = seed >>> 0;
  const next = () => { x = (x * 1103515245 + 12345) >>> 0; return x / 0x100000000; };
  const out = [];
  for (let i = 0; i < count; i++) {
    const lo = VIEWPORTS[i % (VIEWPORTS.length - 1)];
    const hi = VIEWPORTS[(i % (VIEWPORTS.length - 1)) + 1];
    out.push(Math.round(lo + next() * (hi - lo - 16)) + 8);
  }
  return out;
}

/**
 * The flags are both load-bearing, and the second one is a measurement decision (decision 0020).
 *
 * `--allow-file-access-from-files` lets module scripts and `fetch()` work from `file://`, so the
 * reference pages can import `src/lib` directly.
 *
 * `--font-render-hinting=none` makes glyph advances fractional. Without it Chromium takes the
 * platform's hinting, and on a host that hints to full pixels the advance of a "0" is rounded to
 * a whole pixel before anything measures it: Libre Franklin at 22px/700 reports 16 rather than
 * 15.576, a 2.7% error. Everything the extractor reports in `ch` divides by that number, so the
 * error lands directly on `measureCh`, and a heading at the 66ch ceiling reads 64 — comfortably
 * inside a limit it is in fact sitting on. That is the wrong failure: the gate passes a page it
 * should stop, and it does so only on some machines. Turning hinting off makes the advance a
 * function of the font and the size alone, which is what a measurement has to be if two people
 * running this are to get the same answer. It costs nothing else: hinting affects rasterisation,
 * and nothing here reads pixels.
 */
export async function launchBrowser() {
  const { chromium } = await import('playwright');
  return chromium.launch({
    executablePath: process.env.AF_CHROMIUM || undefined,
    args: ['--allow-file-access-from-files', '--font-render-hinting=none'],
  });
}

/**
 * A page that does not declare a register can be linted as if it did.
 *
 * Without a `[data-register]` root the linter has nothing to measure against and stops at one
 * violation, which is right for a page that is meant to be an Applied Form page and useless for
 * the first look at anyone else's: the drift run on example.com reported "No [data-register]
 * root" at six widths and nothing else. `register` tags `<body>` at DOMContentLoaded, on every
 * load the linter makes (the reload for focus, the reduced-motion and print passes), and only
 * when the document has no root of its own; a page that declares one keeps it. Scripts that run
 * before then (inline, deferred, module) do not see it; a page that never declared a register has
 * no code that reads one. The register is also handed to the extractor, which falls back to
 * `<body>` if the tag is somehow absent. The result records the assumption, because a pass under
 * an assumed register is a statement about the assumption as much as the page.
 */
const assume = (register) => (register ? (page) => page.addInitScript((r) => {
  document.addEventListener('DOMContentLoaded', () => {
    // An empty data-register declares nothing, so it is filled rather than treated as a root.
    if (document.querySelector('[data-register]:not([data-register=""])')) return;
    const el = document.querySelector('[data-register=""]') ?? document.body;
    if (!el) return;
    el.setAttribute('data-register', r);
    el.setAttribute('data-af-assumed', '');
  }, { once: true, capture: true });
}, register) : async () => {});

export async function lintPages(urls, { viewports = VIEWPORTS, browser, register = null } = {}) {
  if (register != null && !Object.hasOwn(registers, register)) throw new Error(`unknown register "${register}"; the tokens define ${Object.keys(registers).join(', ')}`);
  const own = !browser;
  browser ||= await launchBrowser();
  const tag = assume(register);
  const open = async (options) => { const p = await browser.newPage(options); await tag(p); return p; };
  const permittedRatios = aspectRatios.map((r) => r.split(':').map(Number));
  const layersByRegister = Object.fromEntries(Object.entries(registers).map(([k, r]) => [k, [r.layer]]));
  const breakpoints = Object.values(grid.breakpoints);
  const extractOpts = { register, families: FAMILIES, permittedRatios, layersByRegister, gutter: grid.gutter, breakpoints, layerValues: Object.values(layers), rotations: composition.rotation, recipes, recipeColumns, durations: Object.values(motion.duration) };
  const results = [];
  try {
    for (const url of urls) {
      let printSpec = null, printDone = false;
      for (const width of viewports) {
        const page = await open({ viewport: { width, height: 900 } });
        const spec = await specFromPage(page, url, extractOpts);
        await page.close();
        if (spec.register == null) {
          results.push({ url, viewport: width, spec, violations: [{ rule: 'register', message: 'No [data-register] root in the document' }], advisories: [] });
          continue;
        }
        // Second pass under prefers-reduced-motion: every animation must be gone.
        const quiet = await open({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
        await quiet.goto(url, { waitUntil: 'load' });
        const underReducedMotion = await quiet.evaluate(() => document.getAnimations().length);
        await quiet.close();
        spec.motion = { animations: spec.animations ?? 0, underReducedMotion };
        // Print pass, once per URL: emulate print media at the page size the tokens set.
        if (spec.register.startsWith('ii') && !printDone) {
          printDone = true;
          const mm = (v) => Math.round(parseFloat(v) * 96 / 25.4);
          const pw = mm(print.page.width), ph = mm(print.page.height);
          const pageH = ph - mm(print.margin.top) - mm(print.margin.bottom);
          const printPage = await open({ viewport: { width: pw, height: ph } });
          await printPage.emulateMedia({ media: 'print' });
          await printPage.goto(url, { waitUntil: 'load' });
          printSpec = await printPage.evaluate((pageH) => {
            const de = document.documentElement;
            const links = [...document.querySelectorAll('a[href^="http"]')];
            const withoutHref = links.filter((a) => !getComputedStyle(a, '::after').content.includes('attr(href)') && !getComputedStyle(a, '::after').content.includes('http')).map((a) => a.textContent.trim().slice(0, 40));
            const orphans = [...document.querySelectorAll('h1, h2, h3')].filter((h) => {
              const r = h.getBoundingClientRect(); const top = r.top + window.scrollY;
              const next = h.nextElementSibling; if (!next) return false;
              const nr = next.getBoundingClientRect(); const nextTop = nr.top + window.scrollY;
              return Math.floor(top / pageH) !== Math.floor((nextTop + Math.min(nr.height, 40)) / pageH) && getComputedStyle(h).breakAfter !== 'avoid';
            }).map((h) => h.textContent.trim().slice(0, 40));
            return { overflowX: Math.max(0, de.scrollWidth - de.clientWidth), linksWithoutHref: withoutHref, orphanHeadings: orphans, pages: Math.ceil(de.scrollHeight / pageH) };
          }, pageH);
          await printPage.close();
        }
        if (printSpec) spec.print = printSpec;
        const violations = [...lint(spec), ...spec.charts.flatMap((chart) => lint({ register: spec.register, theme: spec.theme, background: spec.background, chart }))];
        results.push({ url, viewport: width, spec, violations, advisories: advise(spec) });
      }
    }
  } finally {
    if (own) await browser.close();
  }
  return results;
}
