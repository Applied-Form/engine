/** Playwright driver: open each URL at each viewport, extract, lint, advise. */
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { specFromPage } from './page-spec.mjs';
import { lint, advise } from './rules.mjs';
import { appliesToPack } from './rules/registry.mjs';
import { aspectRatios, registers, grid, layers, composition, recipes, motion, print, fonts, recipeColumns, pack } from './tokens.mjs';

/** The engine's own files: its stylesheets, fonts and modules, which a page it renders may load. */
export const ENGINE_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * What a page loaded from a file may read: its own directory and the roots given, nothing else.
 *
 * `--allow-file-access-from-files` (below) lets a `file://` page read any local file by
 * XMLHttpRequest or an iframe, not only the stylesheets, fonts and modules it is meant to load.
 * Measured on 2026-10-10: a draft read a secret from another directory by both routes. The MCP
 * server renders drafts a model wrote, so that was a model reading the user's files. Every
 * `file://` request is now checked against the page's directory and the roots, and refused
 * outside them. Requests over the network are not touched; a page served over http cannot read a
 * local file in any case.
 *
 * The default roots are the working directory, where a person's own page may keep its assets,
 * and the engine's files. A caller rendering something it did not write (the MCP server, for a
 * draft) passes the engine's files alone.
 *
 * A path is checked as it is written, so a link inside a root is read wherever it leads. That is
 * what `af lint`, `af fix` and the MCP server rely on: a person's own site may link its assets in.
 * `realpaths: true` checks the file a link leads to instead, so a link inside a root that leads
 * outside every root is refused. `af audit`, which renders other people's pages, asks for this. A
 * file that does not exist is then checked by its path, and fails as not found.
 *
 * `network: false` also refuses every request a `file://` page makes over the network, WebSockets
 * included. `af audit --offline` renders pages this way. `onRefused({ url, type })` hears every
 * request refused, with its resource type.
 */
export const DEFAULT_FILE_ROOTS = () => [process.cwd(), ENGINE_ROOT];

const realOr = (p) => { try { return realpathSync(p); } catch { return p; } };
const inside = (p, root) => p === root || p.startsWith(root.endsWith(sep) ? root : root + sep);

export async function confine(page, url, roots = DEFAULT_FILE_ROOTS(), { network = true, onRefused = null, realpaths = false } = {}) {
  if (!String(url).startsWith('file:')) return;
  const own = resolve(fileURLToPath(url));
  const real = realpaths ? realOr : (p) => p;
  // The page's directory as named and, with realpaths, as it really is (they differ when the page is a link).
  const within = [...new Set([dirname(own), ...roots].map((r) => real(resolve(r))).concat(realpaths ? [dirname(realOr(own))] : []))];
  const allowed = (href) => {
    let p;
    try { p = real(resolve(fileURLToPath(href))); } catch { return false; }
    return within.some((r) => inside(p, r));
  };
  const refuse = (route, why) => { onRefused?.({ url: route.request().url(), type: route.request().resourceType() }); return route.abort(why); };
  await page.route((u) => u.protocol === 'file:', (route) => (allowed(route.request().url()) ? route.continue() : refuse(route, 'accessdenied')));
  if (network) return;
  await page.route((u) => u.protocol !== 'file:', (route) => refuse(route, 'blockedbyclient'));
  await page.routeWebSocket(() => true, (ws) => { onRefused?.({ url: ws.url(), type: 'websocket' }); ws.close(); });
}

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

/**
 * `css` is added to every load of the page, at the end of its head once the document is parsed, in
 * the top frame only: where the block `af fix` writes sits in the fixed page, so the page is measured
 * at its own address, with its own origin and its own relative URLs, as it would be with the fixes.
 */
const withCss = (css) => (css ? (page) => page.addInitScript((text) => {
  if (window !== window.top) return;
  document.addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style');
    st.setAttribute('data-af-fixes', '');
    st.textContent = text;
    (document.head ?? document.documentElement).append(st);
  }, { once: true, capture: true });
}, css) : async () => {});

/**
 * `network: false` renders a `file://` page offline, with every request over the network refused
 * (see confine). `requireOk` makes a page served over http that answers the browser with anything
 * but a 2xx document an error, rather than a page to measure: a 403 or a bot wall is not the page.
 *
 * `onFailed({ url, type, why })` hears every request the page made that did not load, on every load
 * the linter makes, with its resource type (stylesheet, script, font, image, fetch, …): `why` is
 * 'refused' when confine refused it, `HTTP <status>` for an answer of 400 or more, or the browser's
 * error (net::ERR_FILE_NOT_FOUND). The page's own document is not among them, and nor is a request
 * the page cancelled itself (net::ERR_ABORTED). The same request is heard once per load.
 * `onRequest({ url, type })` hears every request the page made, loaded, failed or refused, other
 * than its own document.
 *
 * `realpaths: true` checks the file a link leads to (see confine). Only `af audit` asks for it.
 * `css` is added to the page on every load (withCss above); only `af audit` asks for it.
 *
 * `settle` (ms, default 0) keeps each measured page open after it is measured until its network has
 * been quiet for 300ms, or `settle` ms have passed, so a request the page makes after its load event
 * (a fetch a script starts, a late image) is heard by `onFailed` before the page is closed rather
 * than cancelled by the close. It changes nothing that is measured. Only `af audit` asks for it.
 */
export async function lintPages(urls, { viewports = VIEWPORTS, browser, register = null, fileRoots = DEFAULT_FILE_ROOTS(), withIds = false, unregistered = 'house', network = true, requireOk = false, onFailed = null, onRequest = null, realpaths = false, css = null, settle = 0 } = {}) {
  if (register != null && !Object.hasOwn(registers, register)) throw new Error(`unknown register "${register}"; the tokens define ${Object.keys(registers).join(', ')}`);
  // A page under a Standards pack needs no register of its own: the pack's is assumed for it.
  register ??= pack ? 'pack' : null;
  // With no system loaded and no register given, a page that declares none is judged by the rules that
  // hold for any page (`unregistered: 'universal'`, what `af lint` asks for), instead of stopping at
  // "no register". A page that declares a register keeps every rule. The default is unchanged.
  const universalIfUndeclared = unregistered === 'universal' && register == null;
  if (universalIfUndeclared) register = 'ii';
  const own = !browser;
  browser ||= await launchBrowser();
  const tag = assume(register);
  const fixes = withCss(css);
  let current = null;
  // The status the browser was answered with, for the document of a page served over http: the
  // first that is not a success or a redirect. Checked after every load the linter makes.
  let refusedStatus = null;
  const inflightOf = new WeakMap();
  const offline = (url) => !network && String(url).startsWith('file:');
  const open = async (options) => {
    const p = await browser.newPage({ ...options, ...(offline(current) ? { offline: true } : {}) });
    const refused = new Set();
    const onRefused = onFailed ? ({ url, type }) => {
      refused.add(url);
      // A WebSocket refused is never a failed request; it is heard here.
      if (type === 'websocket') onFailed({ url, type, why: 'refused' });
    } : null;
    await confine(p, current, fileRoots, { network, onRefused, realpaths });
    const isDocument = (req) => req.isNavigationRequest() && req.frame() === p.mainFrame();
    if (onRequest) p.on('request', (req) => { if (!isDocument(req)) onRequest({ url: req.url(), type: req.resourceType() }); });
    if (onFailed) {
      p.on('requestfailed', (req) => {
        const why = refused.has(req.url()) ? 'refused' : req.failure()?.errorText ?? 'failed';
        if (!isDocument(req) && why !== 'net::ERR_ABORTED') onFailed({ url: req.url(), type: req.resourceType(), why });
      });
    }
    p.on('response', (res) => {
      const s = res.status(), req = res.request();
      if (isDocument(req)) {
        if (requireOk && /^https?:/i.test(String(current)) && (s < 200 || s >= 400)) refusedStatus ??= s;
      } else if (onFailed && s >= 400) onFailed({ url: req.url(), type: req.resourceType(), why: `HTTP ${s}` });
    });
    if (settle > 0) {
      const count = { inflight: 0 };
      const done = () => { count.inflight = Math.max(0, count.inflight - 1); };
      p.on('request', () => { count.inflight += 1; });
      p.on('requestfinished', done);
      p.on('requestfailed', done);
      inflightOf.set(p, count);
    }
    await tag(p);
    await fixes(p);
    return p;
  };
  // Wait until the page's network has been quiet for 300ms, or `settle` ms have passed.
  const quietDown = async (p) => {
    const count = inflightOf.get(p);
    if (!count) return;
    const started = Date.now();
    let since = Date.now();
    while (Date.now() - started < settle) {
      await p.waitForTimeout(50);
      if (count.inflight > 0) since = Date.now();
      else if (Date.now() - since >= 300) return;
    }
  };
  const loaded = () => { if (refusedStatus != null) throw new Error(`the browser was answered HTTP ${refusedStatus}, not the page`); };
  const permittedRatios = aspectRatios.map((r) => r.split(':').map(Number));
  const layersByRegister = Object.fromEntries(Object.entries(registers).map(([k, r]) => [k, [r.layer]]));
  const breakpoints = Object.values(grid.breakpoints);
  // A pack's data voice is for numerals, units, identifiers, headers and labels, never running text,
  // so a caption is not data under a pack; Applied Form's own convention sets figcaption in it.
  const dataSelector = pack ? '[data-voice="data"], code, kbd, samp, data, time, th, pre' : undefined;
  const extractOpts = { register, dataSelector, families: FAMILIES, permittedRatios, layersByRegister, gutter: grid.gutter, breakpoints, layerValues: Object.values(layers), rotations: composition.rotation, recipes, recipeColumns, durations: Object.values(motion.duration) , withIds };
  const results = [];
  try {
    for (const url of urls) {
      current = url;
      refusedStatus = null;
      let printSpec = null, printDone = false;
      for (const width of viewports) {
        const page = await open({ viewport: { width, height: 900 } });
        const spec = await specFromPage(page, url, extractOpts);
        await quietDown(page);
        await page.close();
        loaded();
        if (spec.register == null) {
          results.push({ url, viewport: width, spec, violations: [{ rule: 'register', message: 'No [data-register] root in the document' }], advisories: [] });
          continue;
        }
        // Second pass under prefers-reduced-motion: every animation must be gone.
        const quiet = await open({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
        await quiet.goto(url, { waitUntil: 'load' });
        const underReducedMotion = await quiet.evaluate(() => document.getAnimations().length);
        await quiet.close();
        loaded();
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
          loaded();
        }
        if (printSpec) spec.print = printSpec;
        const violations = [...lint(spec), ...spec.charts.flatMap((chart) => lint({ register: spec.register, theme: spec.theme, background: spec.background, chart }))];
        const universal = universalIfUndeclared && spec.assumedRegister;
        results.push({ url, viewport: width, spec, violations: universal ? violations.filter((v) => appliesToPack(v.rule, [])) : violations, advisories: advise(spec), ...(universal ? { scope: 'universal' } : {}) });
      }
    }
  } finally {
    if (own) await browser.close();
  }
  return results;
}
