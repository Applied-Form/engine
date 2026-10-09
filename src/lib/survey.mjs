/**
 * What a page actually renders, measured on somebody else's site.
 *
 * The gate in `page-spec.mjs` reads a page that already belongs to this system — it looks for
 * registers, recipes, spreads, and the attributes Applied Form pages carry. Pointed at a client's
 * marketing site it would find none of that and report nothing useful. This is the same
 * instrument with the house assumptions taken out: no vocabulary, no rules, no opinion, just
 * every design-relevant computed value with a weight attached.
 *
 * **Weight is the whole point.** A distinct-value count treats a colour used once in a footer as
 * equal to the one on every heading, which flatters a messy site and slanders a disciplined one.
 * So text carries the length of the text set in it, a ground carries the area it covers, and a
 * gap carries how often it occurs. `infer.mjs` consumes these directly.
 *
 * **Own text, not subtree text.** An element's weight is the length of its own text nodes. Using
 * `textContent` would give `<body>` the entire page and every wrapper a copy of its children,
 * and the heaviest colour on any site would be whatever the outermost element inherited.
 *
 * **Colour is composited before it is recorded.** A 60%-opacity grey over a warm ground is not
 * grey, and recording it as one would invent a token the site does not have. Text is composited
 * over the nearest ancestor that actually paints, which is what a reader sees.
 *
 * **Colour is resolved by the browser, not by a regex.** `getComputedStyle` hands back whatever
 * syntax the author wrote for anything modern: Chromium returns `oklch(0.55 0.15 29)` and
 * `color(display-p3 ...)` verbatim. The first version of this matched `rgb()`/`rgba()` only, so
 * every such colour parsed as null and was dropped — silently. On a brand that ships its palette
 * in oklch, now ordinary practice, the report would have missed the accent entirely and presented
 * what survived as the system. A measuring tool that omits the brand's own colour and says nothing
 * is worse than one that fails loudly. So an unrecognised syntax is painted onto a 1x1 canvas and
 * read back, which converts anything the browser can paint.
 *
 * What this does not do, stated plainly because a measurement that hides its limits is a claim:
 * it does not hit-test, so an element sitting over an image or a gradient is composited against
 * the nearest painted colour rather than the pixel behind it; it reads one viewport per pass, so
 * responsive values need more than one pass; it cannot see anything a page only renders after
 * interaction; and the canvas read-back is sRGB, so a wide-gamut colour outside sRGB is recorded
 * as the nearest colour inside it. That last one is a narrowing rather than a loss: the contrast
 * floors, the token file and every rule here are defined in sRGB, so a P3 colour has to be judged
 * there regardless.
 */
import { launchBrowser } from './page-lint.mjs';

/** Runs inside the page. Returns weighted samples, one array per design dimension. */
/* c8 ignore start -- executes in the browser, covered by test/survey.test.mjs through Chromium */
function collect() {
  const px = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

  /**
   * Any colour the browser can paint, to sRGB components.
   *
   * `rgb()`/`rgba()` is taken by regex because it is the overwhelming majority and costs nothing.
   * Everything else goes to the canvas, which is the only converter that needs no new case when
   * CSS gains its next colour function. A regex per syntax is a list that silently falls behind
   * the web, and this one already did.
   */
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const resolved = new Map();

  const viaCanvas = (value) => {
    if (resolved.has(value)) return resolved.get(value);
    let out = null;
    try {
      // Assigning an unparseable value to fillStyle is a no-op, so the previous value shows
      // through. Two different sentinels separate a rejected value from an accepted one: if the
      // browser took it, both reads agree.
      const read = (sentinel) => { ctx.fillStyle = sentinel; ctx.fillStyle = value; return ctx.fillStyle; };
      if (read('#000000') === read('#ffffff')) {
        ctx.clearRect(0, 0, 1, 1);
        const previous = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = 'copy';
        ctx.fillStyle = value;
        ctx.fillRect(0, 0, 1, 1);
        ctx.globalCompositeOperation = previous;
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        // Alpha returns as a byte, so 0.9 reads as 0.902 — finer than anything here decides with it.
        out = { r, g, b, a: a / 255 };
      }
    } catch { out = null; }
    resolved.set(value, out);
    return out;
  };

  const parse = (value) => {
    const text = String(value ?? '').trim();
    if (!text) return null;
    // `currentcolor` is the one value canvas accepts and gets wrong: it has no element to read a
    // colour from, so it silently paints black. Computed styles resolve it before this sees it,
    // but a black that came from nowhere is exactly the wrong number worth refusing outright.
    if (/^currentcolor$/i.test(text)) return null;
    const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.%]+))?\s*\)$/i.exec(text);
    if (m) {
      let a = m[4] === undefined ? 1 : (String(m[4]).endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
      if (!Number.isFinite(a)) a = 1;
      return { r: +m[1], g: +m[2], b: +m[3], a };
    }
    return viaCanvas(text);
  };
  const hex = ({ r, g, b }) => '#' + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });

  /** The nearest ancestor that actually paints, which is what a colour is really sitting on. */
  const groundOf = (el) => {
    for (let node = el; node && node !== document.documentElement.parentNode; node = node.parentElement) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) return c.a === 1 ? c : over(c, { r: 255, g: 255, b: 255, a: 1 });
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };

  /** Only an element's own text nodes, so a wrapper does not inherit its children's weight. */
  const ownText = (el) => {
    let n = 0;
    for (const node of el.childNodes) if (node.nodeType === 3) n += node.nodeValue.trim().length;
    return n;
  };

  const out = {
    textColor: [], ground: [], borderColor: [],
    spacing: [], fontSize: [], fontFamily: [], fontWeight: [], lineHeight: [],
    radius: [], borderWidth: [], shadow: [],
    elements: 0, textElements: 0,
  };
  const push = (bucket, value, weight) => { if (value !== null && weight > 0) out[bucket].push({ value, weight }); };

  for (const el of document.querySelectorAll('body, body *')) {
    const box = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || box.width === 0 || box.height === 0) continue;
    out.elements += 1;

    const chars = ownText(el);
    if (chars > 0) {
      out.textElements += 1;
      const fg = parse(s.color);
      if (fg) push('textColor', hex(fg.a === 1 ? fg : over(fg, groundOf(el))), chars);
      push('fontSize', px(s.fontSize), chars);
      push('fontFamily', s.fontFamily.split(',')[0].replace(/^["']|["']$/g, '').trim(), chars);
      push('fontWeight', px(s.fontWeight), chars);
      // Unitless line-height computes to a pixel value; as a ratio it is comparable across sizes.
      const [lh, fs] = [px(s.lineHeight), px(s.fontSize)];
      if (lh && fs) push('lineHeight', Math.round((lh / fs) * 100) / 100, chars);
    }

    // A ground is weighted by the area it covers, in hundreds of square pixels so a full-page
    // background does not arrive as a six-figure number beside a gap counted once.
    const bg = parse(s.backgroundColor);
    if (bg && bg.a > 0) push('ground', hex(bg.a === 1 ? bg : over(bg, groundOf(el.parentElement ?? el))), (box.width * box.height) / 100);

    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const w = px(s[`border${side}Width`]);
      if (w && w > 0 && s[`border${side}Style`] !== 'none') {
        push('borderWidth', w, 1);
        const bc = parse(s[`border${side}Color`]);
        if (bc && bc.a > 0) push('borderColor', hex(bc.a === 1 ? bc : over(bc, groundOf(el))), 1);
      }
    }

    for (const prop of ['marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'rowGap', 'columnGap']) {
      const v = px(s[prop]);
      if (v && v > 0) push('spacing', v, 1);
    }

    for (const prop of ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius']) {
      const v = px(s[prop]);
      if (v !== null) push('radius', v, 1);
    }

    if (s.boxShadow && s.boxShadow !== 'none') push('shadow', s.boxShadow, 1);
  }
  return out;
}
/* c8 ignore stop */

/** Merge surveys from several pages or viewports into one set of weighted samples. */
export function mergeSurveys(surveys) {
  const merged = { elements: 0, textElements: 0 };
  for (const s of surveys) {
    for (const [key, value] of Object.entries(s)) {
      if (typeof value === 'number') merged[key] = (merged[key] ?? 0) + value;
      else (merged[key] ??= []).push(...value);
    }
  }
  return merged;
}

/**
 * Survey one or more pages. `urls` are file:// or https:// — in practice file://, because a
 * report you can re-run against a frozen snapshot is reproducible and one that re-scrapes is not.
 */
export async function surveyPages(urls, { browser: given = null, viewports = [1280], timeout = 20000 } = {}) {
  const browser = given ?? await launchBrowser();
  const pages = [];
  try {
    for (const url of urls) {
      for (const width of viewports) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        try {
          await page.goto(url, { waitUntil: 'load', timeout });
          await page.evaluate(() => document.fonts.ready);
          const survey = await page.evaluate(collect);
          pages.push({ url, viewport: width, survey });
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    if (!given) await browser.close();
  }
  return { pages, merged: mergeSurveys(pages.map((p) => p.survey)) };
}
