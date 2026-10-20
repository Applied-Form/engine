/**
 * Build a lint() spec from a rendered page, using Playwright.
 *
 * The browser-side extractor walks computed styles inside the document's
 * [data-register] root and reports what it finds in the same shape that
 * src/lib/rules.mjs expects. Nothing here decides what is allowed; it only
 * measures. rules.mjs decides.
 *
 * One traversal. Styles, rects and hit-test stacks are read once per element
 * and cached; the page is scrolled only when a hit-test needs an element in
 * view. The function runs inside page.evaluate, so it stays self-contained.
 */

/** Runs inside the page. Must stay self-contained: no imports, no closures. */
/** Number every element in document order, so a violation can name the element it came from. Deterministic: the same document gives the same ids on every load. */
export function stampIds() {
  let i = 0;
  for (const el of document.querySelectorAll('*')) el.setAttribute('data-af-id', String(i++));
}

export function extract(opts) {
  const { permittedRatios = [], families = {}, layersByRegister = {}, gutter = 32, breakpoints = [], layerValues = [], rotations = [0], recipes = {}, recipeColumns = null, durations = [], register: explicitRegister = null } = opts || {};
  const roots = [...document.querySelectorAll('[data-register]')];
  const root = roots[0] ?? (explicitRegister ? (document.body ?? document.documentElement) : null);
  if (!root) return { register: null };
  const register = (root.getAttribute && root.getAttribute('data-register')) || explicitRegister || null;
  // Which ground the document is actually on. An explicit data-theme wins; otherwise the viewer's
  // system preference decides, which is the state most readers are in.
  const declaredTheme = (root.getAttribute && root.getAttribute('data-theme')) ?? document.documentElement.getAttribute('data-theme');
  const theme = declaredTheme ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const mixedRegisters = roots.length > 0 && (new Set(roots.map((el) => el.getAttribute('data-register'))).size > 1 || roots.length > 1);
  // A Register II document on the dark ground uses the dark register's layer colour for its
  // panels. Judged against the light layer it would read as a full-bleed colour ground, which is
  // the opposite of what it is.
  const themedRegister = register === 'ii' && theme === 'dark' && layersByRegister['ii-dark'] ? 'ii-dark' : register;
  const layerColors = layersByRegister[themedRegister] ?? [];
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  // ---------------------------------------------------------------- caches
  const styleCache = new Map();
  const cs = (el) => { let s = styleCache.get(el); if (!s) { s = getComputedStyle(el); styleCache.set(el, s); } return s; };
  const rectCache = new Map();
  const rectOf = (el) => { let r = rectCache.get(el); if (!r) { r = el.getBoundingClientRect(); rectCache.set(el, r); } return r; };

  // ---------------------------------------------------------------- colour
  const parse = (rgb) => {
    const m = rgb && rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    const a = m[4] != null ? Number(m[4]) : 1;
    return a === 0 ? null : { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a };
  };
  const hexOf = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0').toUpperCase()).join('');
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: fg.a + bg.a * (1 - fg.a) });
  const parseHex = (hex) => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16), a: 1 });
  const composite = (fg, bgHex) => (!fg ? null : fg.a >= 1 || !bgHex ? hexOf(fg) : hexOf(over(fg, parseHex(bgHex))));
  const toHex = (rgb) => { const c = parse(rgb); return c ? hexOf(c) : null; };
  const gradientStops = (bgImage) => (bgImage && /gradient\(/.test(bgImage) ? [...bgImage.matchAll(/rgba?\([^)]*\)/g)].map((m) => toHex(m[0])).filter(Boolean) : []);
  const effectiveOpacity = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= Number(cs(e).opacity); return o; };
  // CSS propagates <body>'s background to the canvas when the element above it declares none, so
  // `body{background:X}` paints the same pixels as `html,body{background:X}`. Reading the register
  // root alone saw transparent here and then reported <body> as a full-bleed ground of an
  // unexpected colour — failing a page for its selector list rather than its design, and in
  // Register II, where any ground is forbidden, failing it outright.
  const rootBg = toHex(cs(root).backgroundColor)
    ?? toHex(cs(document.body).backgroundColor)
    ?? toHex(cs(document.documentElement).backgroundColor);

  // ---------------------------------------------------------------- type
  const firstFamily = (ff) => ff.split(',')[0].trim().replace(/^["']|["']$/g, '');
  const voiceOf = (ff) => families[firstFamily(ff)] ?? 'unknown';
  // The width of one `ch`, measured the way CSS defines it rather than approximated.
  //
  // This used to ask a canvas context to measure a "0" from a font string built out of
  // computed styles. That string cannot carry font-variation-settings, so for a variable
  // face the canvas measured a different instance than the page rendered — on the report
  // page it was out by 3%, which put a 22px heading at 64ch on one machine and 66ch on
  // another and made the goldens unportable (decision 0014). Asking the browser for the
  // width of `1ch` in the element's own font gets its own answer, so two machines with the
  // same font file agree.
  //
  // Probing lazily cost more than the measurement was worth: inserting and removing a node
  // invalidates layout for the whole document, so one probe per font instance meant the
  // cached rects were recomputed that many times, and a full check went from 28 seconds to
  // 69. Every probe is therefore built, inserted, read and removed together, off-screen, so
  // the whole extraction pays for one insertion rather than one per font.
  const chCache = new Map();
  const chKey = (s) => `${s.fontFamily}|${s.fontSize}|${s.fontWeight}|${s.fontStyle}|${s.fontStretch}|${s.fontVariationSettings}`;
  const primeCh = (els) => {
    const wanted = new Map();
    for (const el of els) {
      const key = chKey(cs(el));
      if (!chCache.has(key) && !wanted.has(key)) wanted.set(key, cs(el));
    }
    if (!wanted.size) return;
    const host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;contain:strict;';
    const probes = [];
    for (const [key, st] of wanted) {
      const probe = document.createElement('span');
      probe.style.cssText = `position:absolute;width:1ch;padding:0;border:0;font-family:${st.fontFamily};font-size:${st.fontSize};font-weight:${st.fontWeight};font-style:${st.fontStyle};font-stretch:${st.fontStretch};font-variation-settings:${st.fontVariationSettings};`;
      host.appendChild(probe);
      probes.push([key, probe]);
    }
    document.body.appendChild(host);
    for (const [key, probe] of probes) chCache.set(key, probe.getBoundingClientRect().width || 1);
    host.remove();
  };
  const chOf = (el) => chCache.get(chKey(cs(el))) ?? 1;
  const dataSelector = opts?.dataSelector ?? '[data-voice="data"], code, kbd, samp, data, time, th, pre, figcaption, .af-label, .af-data-01, .af-data-02, .af-footnotes, .af-toc, .af-pagination, .af-nav, .af-hint, .af-spine, .af-figures, .af-bar-labels';
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent).join('');

  // ---------------------------------------------------------------- hit-testing
  // The stack of elements under an element's centre, after scrolling it into view once. Shared by the
  // effective-background lookup and the type-above-Form check.
  const stackCache = new Map();
  const stackAt = (el) => {
    if (stackCache.has(el)) return stackCache.get(el);
    const r0 = el.getBoundingClientRect();
    if (r0.top < 0 || r0.bottom > vh) { window.scrollTo(0, window.scrollY + r0.top - vh / 2); rectCache.clear(); }
    const r = el.getBoundingClientRect();
    const cx = Math.min(Math.max(r.left + r.width / 2, 0), vw - 1), cy = r.top + r.height / 2;
    const stack = cy >= 0 && cy < vh ? document.elementsFromPoint(cx, cy) : [];
    stackCache.set(el, stack);
    return stack;
  };
  // Effective background: the element's own opaque colour or gradient, else the first opaque thing under its
  // centre in the stacking order (translucent layers composited on the way down), else the nearest opaque ancestor.
  const bgOf = (el) => {
    const own = parse(cs(el).backgroundColor);
    if (own && own.a >= 1) return hexOf(own);
    const ownStops = gradientStops(cs(el).backgroundImage);
    if (ownStops.length) return ownStops[0];
    let acc = own;
    for (const e of stackAt(el)) {
      if (e === el || el.contains(e)) continue;
      const stops = gradientStops(cs(e).backgroundImage);
      if (stops.length) return acc ? composite(acc, stops[0]) : stops[0];
      const c = parse(cs(e).backgroundColor);
      if (!c) continue;
      if (c.a >= 1) return acc ? composite(acc, hexOf(c)) : hexOf(c);
      acc = acc ? over(acc, c) : c;
    }
    for (let e = el; e; e = e.parentElement) { const c = parse(cs(e).backgroundColor); if (c && c.a >= 1) return hexOf(c); }
    return null;
  };
  // Whether the ground bgOf reports is the one the reader sees behind the text. It is not when it was
  // taken from something painted over the text (a sticky bar), when the text is missing from its own hit
  // stack (clipped or off the viewport), when an image or an SVG shape lies between them, when nothing
  // opaque does and the ancestor fallback is not the canvas colour, when an ancestor paints its ground with
  // ::before/::after, which hit-testing cannot see, or when an ancestor is translucent (mid-fade). A fix aimed
  // at such a ground makes the page worse, so the fixer leaves it to the model. Reuses bgOf's cached stack;
  // pseudo-elements are read only here.
  const canvasCol = parse(cs(document.documentElement).backgroundColor) ?? (document.body && parse(cs(document.body).backgroundColor));
  const canvasBg = canvasCol && canvasCol.a >= 1 ? hexOf(canvasCol) : null;
  const pseudoCache = new Map();
  const paintsPseudo = (e) => {
    if (!pseudoCache.has(e)) {
      pseudoCache.set(e, ['::before', '::after'].some((p) => {
        const ps = getComputedStyle(e, p);
        return ps.content !== 'none' && ps.content !== 'normal' && (!!parse(ps.backgroundColor) || gradientStops(ps.backgroundImage).length > 0);
      }));
    }
    return pseudoCache.get(e);
  };
  const groundTrusted = (el, ground) => {
    if (effectiveOpacity(el) < Number(cs(el).opacity)) return false;
    if (parse(cs(el).backgroundColor)?.a >= 1 || gradientStops(cs(el).backgroundImage).length) return true;
    const stack = stackAt(el);
    const i = stack.indexOf(el);
    if (i < 0) return false;
    let beneath = false;
    for (const [j, e] of stack.entries()) {
      if (e === el || el.contains(e)) continue;
      if (j > i && (e instanceof SVGGeometryElement || /^(img|video|canvas|picture)$/i.test(e.tagName) || /url\(/.test(cs(e).backgroundImage))) return false;
      if (!(parse(cs(e).backgroundColor)?.a >= 1 || gradientStops(cs(e).backgroundImage).length)) continue;
      if (j < i) return false;
      beneath = true;
      break;
    }
    if (!beneath && ground !== canvasBg) return false;
    for (let a = el; a; a = a.parentElement) if (paintsPseudo(a)) return false;
    return true;
  };

  // ---------------------------------------------------------------- grid geometry
  const breakpoint = [...breakpoints].reverse().find((b) => vw >= b.minWidth) ?? breakpoints[0];
  const columns = breakpoint ? breakpoint.columns : 16;
  const linesCache = new Map();
  // Column lines of a grid container: its padding is the margin, columns from the breakpoint, gutter from the
  // token. Both edges of every gutter count as lines.
  const columnLines = (sec) => {
    const container = sec.matches('[data-grid]') ? sec : sec.querySelector('[data-grid]') ?? sec;
    if (linesCache.has(container)) return linesCache.get(container);
    const lines = [];
    if (breakpoint) {
      const r = container.getBoundingClientRect();
      const margin = parseFloat(cs(container).paddingLeft) || 0;
      const colW = (r.width - 2 * margin - gutter * (columns - 1)) / columns;
      for (let i = 0; i <= columns; i++) { const x = r.left + margin + i * (colW + gutter); lines.push(x, x - gutter); }
    }
    linesCache.set(container, lines);
    return lines;
  };
  const onLine = (lines, x) => lines.some((l) => Math.abs(l - x) <= 1);
  // A length that may be a percentage of a size.
  const lengthOf = (v, size) => (v.endsWith('%') ? (parseFloat(v) / 100) * size : parseFloat(v));
  // Placement is judged before motion: the translation an element's own transform and translate add,
  // so a layer sliding into register is not read where it is mid-slide. A translate percentage is of
  // the element's own border box; the computed value keeps it as a percentage.
  const translationOf = (el, s) => {
    let tx = 0, ty = 0;
    if (s.translate && s.translate !== 'none') {
      const [px, py = '0px'] = s.translate.split(/\s+/);
      tx += lengthOf(px, el.offsetWidth) || 0; ty += lengthOf(py, el.offsetHeight) || 0;
    }
    const tm = s.transform && s.transform !== 'none' && s.transform.match(/matrix\(([^)]+)\)/);
    if (tm) { const m = tm[1].split(','); tx += Number(m[4]) || 0; ty += Number(m[5]) || 0; }
    return [tx, ty];
  };
  // A positioned element that paints nothing where it is placed has no placement to judge. On
  // engine8 that was every offset failure but one: text hidden for screen readers by clipping it to
  // nothing, laid out wherever the flow left it, and skip links parked at left:-9999px until focus
  // brings them in. Parked is a box wholly before the page's origin, where no reader can scroll to it.
  // That box is the one before the element's own translation, the box it is judged by below: a drawer
  // or toast moved off the page by a transform is revealed where the transform takes it from, and is
  // judged there. An element only partly off the page, or clipped to part of itself, still paints and
  // is judged.
  //
  // Hidden for screen readers is a `clip` rect with no area left, or the visually-hidden clip-path,
  // an inset() of at least half on every side, such as inset(50%). Content waiting to be revealed is
  // judged where it waits, as content waiting at opacity 0 is: a clip-path cut from one side, such as
  // inset(0 100% 0 0), is where a wipe starts, and a clip or clip-path that a transition or an
  // animation is set to change is a reveal. The `clip` rect has no such shape test, because text is
  // hidden with rect(0, 0, 1px, 1px), which has no width but a height, as a wipe's start has.
  // `transition: all` with a duration moves a clip as surely as naming it does.
  const trDurations = (s) => s.transitionDuration.split(',').map((d) => parseFloat(d) || 0);
  const clipMoves = (el, s) => s.transitionProperty.split(',').some((p, i) => /^(-webkit-)?clip(-path)?$/.test(p.trim())
      || (p.trim() === 'all' && trDurations(s)[i % trDurations(s).length] > 0))
    || el.getAnimations().some((a) => a.effect?.getKeyframes().some((k) => 'clip' in k || 'clipPath' in k));
  // The box with no transform at all, the element's own or an ancestor's: offsets summed up the chain.
  const layoutBox = (el) => { let x = 0, y = 0; for (let e = el; e; e = e.offsetParent) { x += e.offsetLeft ?? NaN; y += e.offsetTop ?? NaN; } return [x, y]; };
  // Parked off the page means off it on one axis both as painted and with no transform anywhere up the
  // chain, so a parked drawer's children and an element a transform brings into view are still judged.
  const paintsNothing = (el, s, r) => {
    const scroll = s.position === 'fixed' ? 0 : window.scrollY;
    const [x, y] = layoutBox(el);
    if ((r.right <= 0 && x + el.offsetWidth <= 0) || (r.bottom + scroll <= 0 && y + el.offsetHeight <= 0)) return true;
    const w = el.offsetWidth, h = el.offsetHeight;
    let hidden = false;
    // `clip` applies only to an absolutely positioned box, which every placed element is.
    const clip = /^(absolute|fixed)$/.test(s.position) && /^rect\((.+)\)$/.exec(s.clip);
    if (clip) {
      const [t, rt, b, l] = clip[1].split(/[\s,]+/).map((v) => (v === 'auto' ? null : parseFloat(v)));
      hidden = (rt ?? w) - (l ?? 0) <= 0 || (b ?? h) - (t ?? 0) <= 0;
    }
    const inset = /^inset\(([^)]*?)(?:\s+round\b[^)]*)?\)$/.exec(s.clipPath);
    if (inset) {
      const [t, rt = t, b = t, l = rt] = inset[1].trim().split(/\s+/);
      hidden ||= [[t, h], [rt, w], [b, h], [l, w]].every(([v, size]) => lengthOf(v, size) >= size / 2);
    }
    return hidden && !clipMoves(el, s);
  };
  const gridOf = (el) => el.closest('[data-grid]');
  const linesFor = (g) => columnLines(g.closest('[data-spread]') ?? g);
  const rotationOf = (s) => {
    let deg = s.rotate && s.rotate !== 'none' ? Math.round(parseFloat(s.rotate)) : 0;
    const m = s.transform && s.transform !== 'none' && s.transform.match(/matrix\(([^)]+)\)/);
    if (m) { const [a, b] = m[1].split(',').map(Number); deg += Math.round((Math.atan2(b, a) * 180) / Math.PI); }
    return deg;
  };

  // ---------------------------------------------------------------- traversal
  const allElements = (node) => { const out = []; const walk = (n) => { for (const el of n.querySelectorAll('*')) { out.push(el); if (el.shadowRoot) walk(el.shadowRoot); } }; walk(node); return out; };
  const elements = allElements(root);
  primeCh(elements);
  const isMasthead = (el) => !!el.closest('[data-masthead]');
  const inSvg = (el) => !!el.closest('svg');

  const text = [], grounds = [], ratios = [], imagery = [], statuses = [], links = [], charts = [], offGrid = [], targets = [], absences = [];
  const spacing = new Set();
  const composition = { zIndex: [], rotation: [], offsets: [], bleeds: [], panels: [], formOverType: [], recipe: [], motion: [] };
  const withIds = !!opts.withIds;
  // A structural selector for the element, computed in the same load that stamped its id, so a fix
  // addresses exactly what the checker measured without opening the page again.
  const selOf = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      let i = 1;
      for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i++;
      parts.unshift(`${n.tagName.toLowerCase()}:nth-of-type(${i})`);
    }
    return ['html', ...parts].join(' > ');
  };
  const tagged = (el, extra = {}) => (withIds ? { afId: el.getAttribute('data-af-id'), sel: selOf(el), ...extra } : {});
  const item = (el, extra) => ({ element: el.tagName.toLowerCase(), className: typeof el.className === 'string' ? el.className : '', ...tagged(el), ...extra });
  const spacingSources = [], ratioSources = [];

  for (const el of elements) {
    const s = cs(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    const tag = el.tagName.toLowerCase();
    if (tag === 'option' || tag === 'optgroup') continue; // UA-styled form internals
    const rect = rectOf(el);
    const parent = el.parentElement;

    // Spacing. Horizontal auto margins resolve to arbitrary px; centred blocks and flex/grid items use them for
    // alignment, not spacing, so their horizontal margins are skipped. Layout works in 1/64px units, so when the
    // free space is an odd number of them one auto margin gets the extra unit (286.625px against 286.641px): a
    // block is centred when its margins differ by less than half a pixel, a difference no author writes.
    const centred = Math.abs(parseFloat(s.marginLeft) - parseFloat(s.marginRight)) < 0.5 && parent && rect.width < rectOf(parent).width - 1;
    const inFlexOrGrid = parent && /flex|grid/.test(cs(parent).display);
    for (const prop of ['marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap']) {
      if ((centred || inFlexOrGrid) && (prop === 'marginLeft' || prop === 'marginRight')) continue;
      const v = parseFloat(s[prop]);
      if (Number.isFinite(v) && v !== 0) {
        spacing.add(Math.round(Math.abs(v)));
        if (withIds) spacingSources.push({ value: Math.round(Math.abs(v)), raw: Math.round(v), prop, ...tagged(el) });
      }
    }

    // Grounds: surfaces that bleed to both edges of the viewport, other than the register's background and layer.
    // The masthead is exempt. "Wide" was 90% of the viewport, which at 320px is exactly a card inside the ordinary
    // 16px margin, so cards that are cards at 1280px became grounds at 320px. Translucent paint is judged by what it
    // renders as, composited over the nearest opaque surface beneath it, not by its raw rgb.
    const bleeds = rect.left <= 1 && rect.right >= vw - 1 && rect.height >= 48 && !isMasthead(el);
    if (bleeds) {
      let beneath = rootBg ?? '#FFFFFF'; // an unpainted canvas is white
      for (let e = parent; e; e = e.parentElement) { const c = parse(cs(e).backgroundColor); if (c && c.a >= 1) { beneath = hexOf(c); break; } }
      const fill = composite(parse(s.backgroundColor), beneath);
      const stops = /gradient\(/.test(s.backgroundImage) ? [...s.backgroundImage.matchAll(/rgba?\([^)]*\)/g)].map((m) => composite(parse(m[0]), fill ?? beneath)) : [];
      for (const g of [fill, ...stops]) if (g && g !== rootBg && !layerColors.includes(g)) grounds.push(g);
    }

    // Text: elements with their own text nodes, HTML and SVG alike.
    const own = ownText(el);
    if (own && rect.width > 0 && effectiveOpacity(el) > 0) {
      const isSvgText = el instanceof SVGElement;
      const ctmScale = isSvgText && el.getScreenCTM ? Math.hypot(el.getScreenCTM().a, el.getScreenCTM().b) : 1;
      const role = /^h[1-6]$/.test(tag) ? 'heading' : ['p', 'li', 'td', 'dd', 'blockquote', 'figcaption'].includes(tag) ? 'body' : 'other';
      const block = el.closest('p, li, h1, h2, h3, h4, h5, h6, td, dd, blockquote, figcaption, [data-measure]') ?? el;
      const ground = bgOf(el);
      const fill = isSvgText ? parse(s.fill) : (s.webkitTextFillColor && parse(s.webkitTextFillColor)) || parse(s.color);
      const words = own.trim().split(/\s+/).length;
      text.push({
        voice: voiceOf(s.fontFamily), family: firstFamily(s.fontFamily),
        sizePx: Math.round(parseFloat(s.fontSize) * ctmScale * 100) / 100, weight: Number(s.fontWeight),
        color: fill ? composite({ ...fill, a: fill.a * effectiveOpacity(el) }, ground) : null, background: ground, role,
        // The box sets how long a line can be; the text sets how long it is. A three-word heading in a
        // wide column is a short line, not a long measure.
        measureCh: role === 'other' && words < 8 ? null : Math.min(Math.round(block.getBoundingClientRect().width / chOf(block)), (block.textContent ?? '').trim().length),
        isData: !!el.closest(dataSelector), isWordmark: !!el.closest('.af-wordmark'),
        // An inactive control is exempt from the contrast floor by WCAG 1.4.3 itself, and this
        // system dims one with an opacity token, so it would otherwise fail its own rule.
        isDisabled: !!el.closest('[disabled], [aria-disabled="true"], .af-disabled, fieldset[disabled]'),
        isInteractive: !!el.closest('a[href], button, [role="button"], input, select, textarea, summary'),
        sample: own.trim().slice(0, 40),
        ...tagged(el, { cssPx: parseFloat(s.fontSize) }),
        // What a contrast fix needs: SVG paints text with fill, the element's own opacity dims its colour,
        // and a ground the checker cannot vouch for is not one to recolour against.
        ...(withIds ? { isSvgText, opacitySelf: Number(s.opacity), groundTrusted: groundTrusted(el, ground) } : {}),
        // The colour the run is painted in before any opacity, and the alpha it is painted at, so the
        // fixer can tell a run painted in its link's colour, dimmed or not (decision 0025).
        ...(withIds ? { paint: fill ? hexOf(fill) : null, alpha: fill ? fill.a * effectiveOpacity(el) : null } : {}),
        // The block is what sets the line length, so a measure fix has to address it rather than
        // the run inside it; its display and contents say whether capping its width is safe.
        ...(withIds ? { block: { ...tagged(block), display: cs(block).display, hasLayoutChild: !!block.querySelector('img, svg, video, canvas, table, iframe, figure') } } : {}),
      });
      // Type is always above Form: if a mark comes before this run in the hit stack, the run is behind it.
      if (!el.closest('.af-mark')) {
        const stack = stackAt(el);
        const iText = stack.indexOf(el), iMark = stack.findIndex((e) => e.closest && e.closest('.af-mark'));
        if (iMark >= 0 && iText >= 0 && iMark < iText) composition.formOverType.push({ sample: own.trim().slice(0, 40) });
      }
    }

    // Generated content: ::before and ::after with string content are text runs too.
    for (const pseudo of ['::before', '::after']) {
      const ps = getComputedStyle(el, pseudo);
      const content = ps.content;
      if (!content || content === 'none' || content === 'normal' || !/^["']/.test(content)) continue;
      const txt = content.slice(1, -1).trim();
      if (!txt || ps.display === 'none') continue;
      const fill = parse(ps.color), ground = bgOf(el);
      text.push({
        voice: voiceOf(ps.fontFamily), family: firstFamily(ps.fontFamily), sizePx: parseFloat(ps.fontSize), weight: Number(ps.fontWeight),
        color: fill ? composite({ ...fill, a: fill.a * effectiveOpacity(el) }, ground) : null, background: ground, role: 'other', measureCh: null,
        isData: !!el.closest(dataSelector), isWordmark: !!el.closest('.af-wordmark'), isInteractive: !!el.closest('a[href], button'), isDisabled: !!el.closest('[disabled], [aria-disabled="true"], .af-disabled, fieldset[disabled]'), pseudo, sample: txt.slice(0, 40),
        // Located by its host, so a fix can address `host::before`; a run nothing can name goes unfixed.
        ...tagged(el, { cssPx: parseFloat(ps.fontSize) }),
        ...(withIds ? { isSvgText: false, opacitySelf: Number(ps.opacity), groundTrusted: groundTrusted(el, ground), paint: fill ? hexOf(fill) : null, alpha: fill ? fill.a * effectiveOpacity(el) : null } : {}),
      });
    }

    // Imagery and aspect ratios.
    if (['img', 'video', 'picture', 'svg', 'canvas'].includes(tag) && !(parent && parent.closest('svg'))) {
      const generated = el.getAttribute('data-generated');
      const isSpark = (generated ?? '').startsWith('sparkline');
      // How much of the viewport a surface covers, because a page whose content is painted
      // rather than marked up is a page every other rule reads as empty.
      const areaFraction = Math.round(((rect.width * rect.height) / (vw * vh)) * 1000) / 1000;
      if (isSpark) imagery.push({ kind: 'plot', tag, sizePx: Math.round(rect.height), generated, sample: el.getAttribute('aria-label') ?? '' });
      else if (rect.width >= 48 && rect.height >= 48) {
        const r = rect.width / rect.height;
        const snapped = permittedRatios.find(([w, h]) => Math.abs(r - w / h) / (w / h) < 0.01);
        ratios.push(snapped ? `${snapped[0]}:${snapped[1]}` : `${Math.round(rect.width)}:${Math.round(rect.height)}`);
        if (withIds) {
          // The drawing's own ratio, from the viewBox an svg scales its content to fit; null where nothing scales.
          const vb = tag === 'svg' ? el.viewBox?.baseVal : null;
          const intrinsic = vb && vb.width > 0 && vb.height > 0 ? vb.width / vb.height : null;
          ratioSources.push({ value: ratios[ratios.length - 1], w: Math.round(rect.width), h: Math.round(rect.height), element: tag, intrinsic, ...tagged(el) });
        }
        const inMark = !!el.closest('.af-mark');
        imagery.push({
          kind: el.getAttribute('data-figure') ?? (inMark ? 'form' : 'decorative'), tag, sizePx: Math.round(Math.min(rect.width, rect.height)),
          generated: generated ?? (inMark ? 'form' : null), sample: el.getAttribute('aria-label') ?? el.getAttribute('alt') ?? '',
          // Whether an SVG actually draws anything, so a declared plot can be required to be one.
          hasGeometry: tag === 'svg' ? !!el.querySelector('path, rect, circle, ellipse, line, polyline, polygon, use, image') : undefined,
          hasAlt: tag === 'img' ? el.hasAttribute('alt') : undefined,
          // An ARIA name: aria-label, or aria-labelledby that resolves to text (a chart's printed title).
          hasAriaLabel: tag === 'svg' ? el.hasAttribute('aria-label') || (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).some((id) => id && document.getElementById(id)?.textContent.trim()) : undefined,
          hasTitle: tag === 'svg' ? !!el.querySelector(':scope > title') : undefined,
          ariaHidden: el.getAttribute('aria-hidden') === 'true',
          areaFraction,
          // Text painted inside an SVG is read by the eye and by nothing else. Recorded so a
          // figure that carries its words in glyphs cannot pass for a figure that has none.
          textLength: tag === 'svg' ? (el.textContent || '').trim().length : 0,
        });
      }
    }
    if (/url\(/.test(s.backgroundImage) && rect.width >= 24 && rect.height >= 24) {
      imagery.push({ kind: el.getAttribute('data-figure') ?? 'decorative', tag: 'background-image', sizePx: Math.round(Math.min(rect.width, rect.height)) });
    }

    // Statuses.
    if (el.hasAttribute('data-status')) {
      statuses.push({ label: el.textContent.trim() || null, shape: el.getAttribute('data-shape') ?? (el.querySelector('svg') ? 'glyph' : null), color: toHex(s.color) });
    }

    // Links: the underline must survive on every text-bearing descendant. A descendant cannot remove an
    // ancestor's underline unless it is inline-block or floated.
    if (tag === 'a' && el.hasAttribute('href')) {
      const runs = [el, ...el.querySelectorAll('*')].filter((e) => ownText(e));
      // A link with no text at all (the home link around an outlined wordmark) has nothing to underline:
      // it is neither underlined nor not. Text drawn by ::before or ::after is still text to judge,
      // and any generated content but none, normal, a blank string or an image (a counter, an
      // attribute, a mix) is taken to draw some.
      const drawn = (e) => ['::before', '::after'].some((p) => !/^(none|normal|(["'])\s*\2|url\([^)]*\))$/.test(getComputedStyle(e, p).content.trim()));
      const textless = !runs.length && ![el, ...el.querySelectorAll('*')].some(drawn);
      const underlined = textless ? null : runs.length > 0 && runs.every((e) => {
        for (let n = e; n && n !== parent; n = n.parentElement) {
          const ns = cs(n);
          if (ns.textDecorationLine.includes('underline')) return true;
          if (/inline-block|inline-flex|inline-grid|block|flex|grid/.test(ns.display) && n !== el) return false;
        }
        return false;
      });
      // Whether the link paints its own ground (a link drawn as a filled button). The rule reads it on
      // every run: a link that paints no ground of its own on ink or espresso may also take the on-dark
      // link colour (decision 0025). Read from the link's own style, with no lookup, and reported only
      // where it is true, so every other link reads as it did. For the fixer only: the ground behind the
      // link once that paint is gone, so a remedy that lifts the paint can be judged.
      const paintsGround = !!parse(s.backgroundColor)?.a || gradientStops(s.backgroundImage).length > 0;
      const behind = withIds && paintsGround && el.parentElement ? bgOf(el.parentElement) : null;
      const background = bgOf(el);
      // Also for the fixer only (decision 0025): whether the checker can vouch for the link's own
      // ground, as it asks of a run's ground before a contrast fix, and whether the link holds text of
      // its own that a reader can see and that is not the wordmark. The first reuses the hit-test the
      // lookup for `background` already made, and the second reads only the link's own subtree, so the
      // fixer's run measures nothing else differently.
      //
      // Text inside an svg (the <title> of an outlined wordmark) is the image's, text inside
      // .af-wordmark is the wordmark's, as the text runs mark it, and an img holds none. Text no reader
      // can see is not text the link's colour paints: text that is not displayed, is hidden or is fully
      // transparent, or that sits, at any depth inside the link, in a box a screen-reader-only pattern
      // hides. The patterns are the ones the placement check above recognises (`paintsNothing`: a
      // `clip` rect with no area, an inset() clip-path of half or more on every side, a box parked
      // before the page's origin), and a box 1px or less across that clips what overflows it.
      // aria-hidden hides nothing from the eye, so text inside it still counts. So a link whose only
      // visible content is an svg or an img holds no text: the outlined wordmark painted in
      // currentColor as the home link, named by a screen-reader-only label, is one.
      const ofLink = (e) => !e.closest('svg') && !e.closest('.af-wordmark');
      const srOnly = (n) => {
        const ns = cs(n);
        return ns.display === 'none'
          || (n.offsetWidth <= 1 && ns.overflowX !== 'visible') || (n.offsetHeight <= 1 && ns.overflowY !== 'visible')
          || paintsNothing(n, ns, rectOf(n));
      };
      const seen = (e) => {
        const es = cs(e);
        if (es.visibility === 'hidden' || !(effectiveOpacity(e) > 0) || !(rectOf(e).width > 0) || /^transparent$|,\s*0(\.0+)?\)$/.test(es.color) || !(parseFloat(es.fontSize) > 0)) return false;
        for (let n = e; n; n = n === el ? null : n.parentElement) if (srOnly(n)) return false;
        return true;
      };
      const fixerOnly = withIds ? {
        paintsGround, behind, behindTrusted: behind ? groundTrusted(el.parentElement, behind) : false,
        groundTrusted: !!background && groundTrusted(el, background),
        hasText: [el, ...el.querySelectorAll('*')].some((e) => ofLink(e) && (!!ownText(e) || drawn(e)) && seen(e)),
      } : {};
      links.push({ color: toHex(s.color), background, underlined, sample: el.textContent.trim().slice(0, 40), ...(paintsGround ? { paintsGround } : {}), ...tagged(el, fixerOnly) });
    }

    // Charts.
    if (el.hasAttribute('data-chart')) {
      const series = [...el.querySelectorAll('[data-series]')].map((m) => { const ms = cs(m); return m instanceof SVGElement ? (toHex(ms.fill) ?? toHex(ms.stroke)) : (toHex(ms.backgroundColor) ?? toHex(ms.color)); }).filter(Boolean);
      const fig = el.closest('figure') ?? parent;
      const legend = !!(fig && fig.querySelector('.legend, [class*="legend"], legend, [role="legend"], [aria-label*="legend" i]'));
      charts.push({ series: [...new Set(series)], background: bgOf(el), labelledDirectly: el.getAttribute('data-labelled') === 'direct', legend, generated: el.getAttribute('data-generated') });
    }

    // Target size (WCAG 2.5.8): interactive elements at least 24x24, except inline links inside running text.
    const isTarget = (tag === 'a' && el.hasAttribute('href')) || ['button', 'input', 'select', 'textarea', 'summary'].includes(tag) || el.getAttribute('role') === 'button';
    if (isTarget && rect.width > 0 && rect.height > 0) {
      const inline = tag === 'a' && !!el.closest('p, li');
      targets.push({
        element: tag, width: Math.round(rect.width), height: Math.round(rect.height), inline,
        sample: (el.textContent || '').trim().slice(0, 40),
        // An interactive element inside an aria-hidden subtree is reachable by keyboard and
        // absent from the accessibility tree, which is worse than either alone.
        ariaHidden: !!el.closest('[aria-hidden="true"]'),
        ...tagged(el, { display: s.display }),
      });
    }

    // Absences: no box-shadow, no gradient fill, no radius, save for the named exemptions the rule applies.
    const className = typeof el.className === 'string' ? el.className : '';
    if (s.boxShadow && s.boxShadow !== 'none') {
      absences.push({ kind: 'shadow', element: tag, className, value: s.boxShadow, ariaCurrent: el.getAttribute('aria-current'), ...tagged(el) });
    }
    if (/gradient\(/.test(s.backgroundImage)) {
      const clip = s.webkitBackgroundClip || s.backgroundClip || '';
      absences.push({ kind: 'gradient', element: tag, className, textClip: /text/.test(clip), wide: rect.width >= vw * 0.9, ...tagged(el) });
    }
    const radius = parseFloat(s.borderTopLeftRadius) || 0;
    if (radius > 0) {
      // A circle has no corners to round: equal sides, and a radius of half of them.
      const circle = Math.abs(rect.width - rect.height) <= 1 && radius >= Math.min(rect.width, rect.height) / 2 - 0.5;
      absences.push({ kind: 'radius', element: tag, className, value: Math.round(radius), circle, inputType: tag === 'input' ? el.type : null, ...tagged(el) });
    }

    // Composition: motion durations, layers, rotation, offsets, bleeds, panels.
    if (rect.width || rect.height) {
      for (const prop of ['transitionDuration', 'animationDuration']) {
        for (const raw of (s[prop] || '').split(',')) {
          const v = raw.trim(); if (!v) continue;
          const ms = Math.round(v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000);
          if (ms > 0 && !durations.includes(ms)) composition.motion.push(item(el, { property: prop, ms }));
        }
      }
      if (s.zIndex !== 'auto' && !layerValues.includes(Number(s.zIndex))) composition.zIndex.push(item(el, { zIndex: Number(s.zIndex) }));
      if (!inSvg(el)) {
        const rot = rotationOf(s);
        if (!rotations.includes(rot)) composition.rotation.push(item(el, { rotation: rot }));
      }
      const g = gridOf(el);
      // Placement is judged whether or not a grid was declared. It used to require a
      // [data-grid] ancestor, so a page that never used the attribute could place anything
      // anywhere: an arm of the evaluation never told the attribute exists placed freely and
      // scored clean. With no grid to give column lines, both axes are held to the 8px scale,
      // which is the part of "on the grid" that survives without columns.
      const placed = (s.position === 'absolute' || s.position === 'fixed') && !inSvg(el) && !el.closest('.af-mark');
      const [tx, ty] = placed ? translationOf(el, s) : [0, 0];
      if (placed && !paintsNothing(el, s, rect)) {
        const lines = g ? linesFor(g) : [];
        // Against column lines the left edge is read where it lands in the viewport, since that is
        // where the lines are. With no grid it is read from the offset parent, as the top is below:
        // read from the viewport, a toggle's hit area at left:0 inside a switch the flow put 165px in
        // was judged at 165px, a number its author never wrote, while the switch itself is not placed
        // and not judged. offsetLeft ignores transforms, so a translate needs no subtracting there.
        // An element with no offsetLeft (MathML) is read in the viewport, as before.
        const left = lines.length ? rect.left - tx : el.offsetLeft ?? (rect.left - tx);
        // The vertical offset is read from offsetTop rather than from the computed `top` and
        // `bottom`. A browser resolves both of those to used values for a positioned element —
        // the skip link reports top 8px and bottom 854.25px — so judging them both meant judging
        // a number the author never wrote. offsetTop is the offset from the offset parent, which
        // is the number they did write.
        const inset = [Math.round(el.offsetTop ?? (rect.top - ty))].filter((v) => Number.isFinite(v) && v !== 0);
        const offGrid = lines.length
          ? !onLine(lines, left) || !inset.every((v) => Math.abs(v) % 8 === 0)
          : Math.round(Math.abs(left)) % 8 !== 0 || !inset.every((v) => Math.abs(v) % 8 === 0);
        if (offGrid) composition.offsets.push(item(el, { left: Math.round(left), top: inset[0] ?? 0, grid: lines.length > 0 }));
      }
      if (g && parent === g && !el.closest('.af-mark')) {
        const gr = rectOf(g);
        const overhang = Math.max(gr.left - rect.left, rect.right - gr.right);
        if (overhang > 1) {
          const colW = breakpoint ? (gr.width - gutter * (columns - 1)) / columns : 0;
          const past = rect.left <= 0 || rect.right >= vw;
          if (!(past || Math.abs(overhang - gutter / 2) <= 1 || Math.abs(overhang - (colW + gutter)) <= 1)) composition.bleeds.push(item(el, { over: Math.round(overhang) }));
        }
        // Direct grid children start and end on column lines (absolute children are placed, checked above).
        if (s.position !== 'fixed' && rect.width) {
          const lines = linesFor(g);
          if (lines.length && (!onLine(lines, rect.left) || !onLine(lines, rect.right))) offGrid.push(item(el, { left: Math.round(rect.left), right: Math.round(rect.right), sample: el.textContent.trim().slice(0, 40) }));
        }
      }
      if (el.hasAttribute('data-aspect')) {
        const [w, h] = el.getAttribute('data-aspect').split(':').map(Number);
        composition.panels.push({ declared: el.getAttribute('data-aspect'), ok: Math.abs(rect.width / rect.height - w / h) / (w / h) < 0.02, measured: `${Math.round(rect.width)}:${Math.round(rect.height)}` });
      }
      if (el.hasAttribute('data-grid-item') && g) {
        const lines = linesFor(g);
        if (rect.width && lines.length && (!onLine(lines, rect.left) || !onLine(lines, rect.right))) offGrid.push(item(el, { left: Math.round(rect.left), right: Math.round(rect.right), sample: el.textContent.trim().slice(0, 40) }));
      }
    }
  }

  // ---------------------------------------------------------------- spreads
  const intersects = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  const bodyRects = [...root.querySelectorAll('p, li, dd, blockquote')].filter((el) => el.textContent.trim()).map((el) => el.getBoundingClientRect());
  const normRange = (start, end) => {
    const a = parseInt(start, 10);
    const b = /span/.test(end) ? a + parseInt(end.replace(/span\s*/, ''), 10) : /^-1$/.test(end.trim()) ? columns + 1 : parseInt(end, 10);
    return `${a}/${b}`;
  };
  const spreads = [];
  for (const sec of root.querySelectorAll('[data-spread]')) {
    const name = sec.getAttribute('data-spread');
    const recipe = recipes[name];
    const g = sec.matches('[data-grid]') ? sec : sec.querySelector('[data-grid]');
    if (recipe && g && vw >= 1056) {
      const want = recipe.cells.map((c) => { const [a, b] = c.cell.split('/').map((x) => x.trim()); return normRange(a, b); });
      const have = [...g.children].filter((ch) => cs(ch).position !== 'absolute' && cs(ch).display !== 'none').map((ch) => normRange(cs(ch).gridColumnStart, cs(ch).gridColumnEnd));
      const missing = want.filter((w) => !have.includes(w));
      // How many columns this page's grid has, from the breakpoint rather than from the computed
      // grid-template-columns. Chromium reports implicit tracks in that value — an item reaching
      // line 17 on a twelve-column grid adds four 0px tracks and the count reads 16 — so parsing it
      // told us the grids matched when they did not, and this message never appeared. The
      // breakpoint's own number is the one the column lines are computed from.
      //
      // A recipe names cells by absolute column index, so a move authored on sixteen columns cannot
      // be satisfied on twelve: five-eighths of the width is column 11 of 16, and there is no
      // column 7.5 of 12. Reporting both counts turns "these cells are missing" into the sentence
      // that is actually true.
      if (missing.length) composition.recipe.push({ spread: name, missing, have, columns, authoredFor: recipeColumns ?? null });
    }
    const secRect = sec.getBoundingClientRect();
    const fields = [...sec.querySelectorAll('[data-field]')].map((f) => ({ bg: toHex(cs(f).backgroundColor), rect: f.getBoundingClientRect() })).filter((f) => f.bg);
    const entry = { name, ground: toHex(cs(sec).backgroundColor) ?? rootBg, grounds: fields.map((f) => f.bg) };
    if (fields.length >= 2) { const lines = columnLines(sec); entry.joinOnColumn = fields.slice(1).every((f) => onLine(lines, f.rect.left)); }
    const mark = sec.querySelector('.af-mark');
    if (mark) { const mr = mark.getBoundingClientRect(); entry.markOverBody = bodyRects.some((b) => intersects(mr, b) && intersects(secRect, b)); }
    const figure = sec.querySelector('.af-data-01, [data-figure-text]');
    if (figure) entry.figureVoice = voiceOf(cs(figure).fontFamily);
    spreads.push(entry);
  }

  // Overflow clipped at the root is still overflow: content past the edge is cut off rather than
  // scrolled to, a worse reflow failure than a scrollbar. `html,body{overflow-x:hidden}` made
  // scrollWidth equal clientWidth and hid it, so measure with root clipping lifted, then put it back.
  // The boxes that stick out are recorded too: "the page scrolls at 320px" alone sent whole-page
  // repairs after the wrong elements, and gpt-5-mini's still overflowed 52% of the time (engine5).
  // A culprit overflows while its parent fits; a box inside its own scroller is not one.
  //
  // For the fixer only (withIds), the remedies that would stop it are tried here, in the page as it
  // was measured: each rung of the ladder is one declaration on the boxes past the edge, applied in a
  // style element that is removed again, and kept if the page then fits this width. engine9's 23
  // overflowing pipeline pages were each cleared by one of them (eval/overflow-diag.mjs). The scorer
  // never asks for ids, so it never runs this and its output is unchanged.
  const [overflowX, overflowCulprits, overflowRemedies] = (() => {
    const de = document.documentElement;
    const measure = () => Math.max(0, de.scrollWidth - de.clientWidth);
    const edge = de.clientWidth + 0.5;
    const over = (e) => e.getBoundingClientRect().right > edge;
    const scrolls = (e) => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (cs(a).overflowX !== 'visible' && !over(a)) return true; return false; };
    const culprits = () => {
      return [...document.body.querySelectorAll('*')]
        .filter((e) => !(e instanceof SVGElement && e.localName !== 'svg') && over(e) && (!e.parentElement || !over(e.parentElement) || e.parentElement === document.body) && !scrolls(e))
        .map((e) => { const r = e.getBoundingClientRect(); return { tag: e.localName, cls: (e.getAttribute('class') ?? '').trim().split(/\s+/)[0], width: Math.round(r.width), right: Math.round(r.right), sample: (e.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40), ...tagged(e) }; })
        .sort((a, b) => b.right - a.right).slice(0, 3);
    };
    const ladder = () => {
      const body = document.body;
      const boxes = new Set([...body.querySelectorAll('*')].filter((e) => !(e instanceof SVGElement && e.localName !== 'svg') && over(e) && !scrolls(e)));
      const outer = [...boxes].filter((e) => !boxes.has(e.parentElement) || e.parentElement === body);
      const inner = [...boxes].filter((e) => ![...e.children].some((c) => boxes.has(c)));
      // Text past the edge, which can spill from a box that itself fits: its parent is where it breaks.
      const runs = new Set();
      const range = document.createRange();
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const p = t.parentElement;
        if (!p || !t.textContent.trim() || p.closest('svg') || /^(script|style|noscript|template)$/.test(p.localName) || scrolls(p)) continue;
        range.selectNodeContents(t);
        if ([...range.getClientRects()].some((r) => r.width > 0 && r.right > edge)) runs.add(p);
      }
      // Each innermost box's ancestors up to its outermost: the boxes a width passes down through.
      const chain = new Set();
      for (const e of [...inner, ...runs]) for (let a = e; a && a !== body && a !== de; a = a.parentElement) { chain.add(a); if (outer.includes(a)) break; }
      const parents = new Set([...chain].map((e) => e.parentElement).filter((p) => p && p !== de));
      const html = (els) => [...new Set(els)].filter((e) => !(e instanceof SVGElement && e.localName !== 'svg'));
      const patch = (els, decl) => html(els).map((e) => ({ ...tagged(e), decl }));
      const isMedia = (e) => /^(img|svg|video|canvas|iframe|picture|object|embed)$/.test(e.localName);
      const rungs = {
        wrap: patch([...runs, ...inner], { 'overflow-wrap': 'anywhere' }),
        nowrap: patch([...chain, ...runs].filter((e) => /nowrap|pre/.test(cs(e).whiteSpace)), { 'white-space': 'normal' }),
        media: patch([...chain].filter(isMedia), { 'max-width': '100%', height: 'auto' }),
        shrink: patch([...chain], { 'max-width': '100%', 'min-width': '0', 'box-sizing': 'border-box' }),
        flexwrap: patch([...chain, ...parents].filter((e) => /flex/.test(cs(e).display) && cs(e).flexWrap === 'nowrap'), { 'flex-wrap': 'wrap' }),
      };
      // Every rung at once, one patch per element, for an overflow with more than one cause.
      const merged = new Map();
      for (const k of ['wrap', 'nowrap', 'media', 'shrink', 'flexwrap']) for (const p of rungs[k]) merged.set(p.afId, { ...p, decl: { ...merged.get(p.afId)?.decl, ...p.decl } });
      rungs.all = [...merged.values()];
      // Before the scroller: every outermost box that is not itself a table, svg or code block reflows,
      // all the way down (words may break, minimums lift, nowrap wraps), except tables, svg and code
      // inside it; a table or code block still past the edge then scrolls in a box of its own. On
      // engine10 the scroller put whole panels and metadata rows behind a sideways scroll when only a
      // table inside them needed one. Offered only when some outermost box is not a table, svg or code
      // block: otherwise it is the scroller under another name.
      const keepsShape = (e) => cs(e).display === 'table' || e.localName === 'svg' || e.localName === 'pre' || isMedia(e);
      const flows = outer.filter((e) => !keepsShape(e));
      if (flows.length) {
        const deep = { 'overflow-wrap': 'anywhere', 'min-width': '0', 'max-width': '100%', 'white-space': 'normal', 'box-sizing': 'border-box' };
        const scroll = (e) => ({ ...tagged(e), decl: { 'max-width': '100%', 'overflow-x': 'auto', ...(cs(e).display === 'table' ? { display: 'block' } : {}) } });
        const wide = [...outer.filter((e) => cs(e).display === 'table' || e.localName === 'pre'), ...flows.flatMap((e) => [...e.querySelectorAll('table, pre')].filter((t) => over(t) && !t.parentElement.closest('table, pre')))];
        rungs.reflow = [
          ...(withIds ? flows.map((e) => { const t = tagged(e); return { afId: `${t.afId}~reflow`, sel: `${t.sel}, ${t.sel} :not(table, table *, svg, svg *, pre, pre *)`, decl: deep }; }) : []),
          ...[...new Set(wide)].map(scroll),
        ];
      }
      // Last, since it hides content behind a scrollbar of its own: the outermost box scrolls.
      // A table cannot scroll as a table, so it is made a block.
      rungs.scroller = outer.map((e) => ({ ...tagged(e), decl: { 'max-width': '100%', 'overflow-x': 'auto', ...(cs(e).display === 'table' ? { display: 'block' } : {}) } }));
      const host = document.head ?? de;
      const clears = (patches) => {
        if (!patches.length) return false;
        const st = document.createElement('style');
        st.textContent = patches.map((p) => `${p.sel} { ${Object.entries(p.decl).map(([k, v]) => `${k}: ${v} !important`).join('; ')}; }`).join('\n');
        host.appendChild(st);
        const left = measure();
        st.remove();
        return left === 0;
      };
      // Transitions are held while the trials run: a page that transitions `all` would otherwise show
      // each trial's first frame rather than where it lands, and start a transition on every change
      // that the motion rules would then count (engine8 mini b30-s0 put one on every element).
      const freeze = document.createElement('style');
      freeze.textContent = '*, *::before, *::after { transition: none !important; }';
      host.appendChild(freeze);
      try {
        return Object.entries(rungs).filter(([, ps]) => clears(ps)).map(([name, patches]) => ({ name, patches }));
      } finally { freeze.remove(); }
    };
    const clipped = [de, document.body].filter((e) => e && /hidden|clip/.test(getComputedStyle(e).overflowX + getComputedStyle(e).overflowY));
    const saved = clipped.map((e) => [e, e.getAttribute('style')]);
    for (const e of clipped) e.style.setProperty('overflow', 'visible', 'important');
    const n = measure();
    const found = n > 0 ? culprits() : [];
    const remedies = n > 0 && withIds ? ladder() : null;
    for (const [e, style] of saved) (style == null ? e.removeAttribute('style') : e.setAttribute('style', style));
    return [n, found, remedies];
  })();

  return {
    register, theme, spreads, offGrid, composition,
    headings: [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter((h) => cs(h).display !== 'none').map((h) => ({ level: Number(h.tagName[1]), sample: h.textContent.trim().slice(0, 40), ...tagged(h) })),
    wordCount: (root.querySelector('main') ?? root).innerText.split(/\s+/).filter(Boolean).length,
    hasProvenance: !!root.querySelector('.af-provenance'),
    animations: document.getAnimations().length,
    mixedRegisters,
    overflowX, overflowCulprits,
    ...(overflowRemedies ? { overflowRemedies } : {}),
    viewport: vw,
    background: rootBg,
    grounds: [...new Set(grounds)],
    text,
    spacing: [...spacing].sort((a, b) => a - b),
    ...(withIds ? { spacingSources, ratioSources } : {}),
    // One entry per figure, not per distinct ratio. The scorer's denominator for `aspect-ratio` is
    // the imagery count, so deduplicating here made three figures sharing one off-system ratio read
    // as one violation against three opportunities — drawing more figures lowered the rate whether
    // or not any of them conformed. `grounds` above is deduplicated on purpose: its rule is about
    // which colours appear, not how many surfaces carry them.
    aspectRatios: ratios,
    imagery, statuses, links, charts, targets, absences,
  };
}

/**
 * Drive a Playwright page: load `url`, extract the spec, then reload and walk every tab stop reading its focus ring.
 */
export async function specFromPage(page, url, opts) {
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  if (opts?.withIds) await page.evaluate(stampIds);
  const spec = await page.evaluate(extract, opts);
  // Whether the register was assumed is read from the load the spec came from, before the reload
  // for focus: a page that changes between loads must not report the second load's answer.
  if (opts?.register != null) spec.assumedRegister = await page.evaluate(() => !!document.querySelector('[data-af-assumed]'));
  if (spec.register == null) return spec;

  await page.reload({ waitUntil: 'load' });
  if (opts?.withIds) await page.evaluate(stampIds);
  const seen = new Set();
  spec.focusStyles = [];
  // How long a ring may take to arrive and still be read where it settles: the longest motion token.
  const settle = Math.max(0, ...(opts?.durations ?? []));
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(([withIds, settle]) => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      // A ring that transitions in is read where it settles: read at once, it is still at its first
      // frame, 0px wide in the text colour, and how far in the read lands depends on the machine.
      // One that only arrives after the longest motion token is read as it is when focus lands.
      for (const a of el.getAnimations()) if (a instanceof CSSTransition && a.effect.getComputedTiming().endTime <= settle) a.finish();
      const s = getComputedStyle(el);
      const visible = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      const m = s.outlineColor.match(/\d+/g);
      const color = m ? '#' + m.slice(0, 3).map((v) => Number(v).toString(16).padStart(2, '0').toUpperCase()).join('') : null;
      const key = el.tagName.toLowerCase() + '#' + (el.id || '') + '.' + el.className + ':' + (el.getAttribute('href') || '') + (el.textContent || '').slice(0, 20);
      const selOf = (e) => {
        const parts = [];
        for (let n = e; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
          let i = 1;
          for (let s = n.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === n.tagName) i++;
          parts.unshift(`${n.tagName.toLowerCase()}:nth-of-type(${i})`);
        }
        return ['html', ...parts].join(' > ');
      };
      return { visible, color, element: el.tagName.toLowerCase(), key, ...(withIds ? { afId: el.getAttribute('data-af-id'), sel: selOf(el) } : {}) };
    }, [!!opts?.withIds, settle]);
    if (!f || seen.has(f.key)) break;
    seen.add(f.key);
    spec.focusStyles.push(f);
  }
  spec.focusStyle = spec.focusStyles[0] ?? null;
  return spec;
}
