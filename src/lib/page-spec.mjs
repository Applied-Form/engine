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
  const rootBg = toHex(cs(root).backgroundColor);

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
  const dataSelector = '[data-voice="data"], code, kbd, samp, data, time, th, pre, figcaption, .af-label, .af-data-01, .af-data-02, .af-footnotes, .af-toc, .af-pagination, .af-nav, .af-hint, .af-spine, .af-figures, .af-bar-labels';
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
  const item = (el, extra) => ({ element: el.tagName.toLowerCase(), className: typeof el.className === 'string' ? el.className : '', ...extra });

  for (const el of elements) {
    const s = cs(el);
    if (s.display === 'none' || s.visibility === 'hidden') continue;
    const tag = el.tagName.toLowerCase();
    if (tag === 'option' || tag === 'optgroup') continue; // UA-styled form internals
    const rect = rectOf(el);
    const parent = el.parentElement;

    // Spacing. Horizontal auto margins resolve to arbitrary px; centred blocks and flex/grid items use them for
    // alignment, not spacing, so their horizontal margins are skipped.
    const centred = s.marginLeft === s.marginRight && parent && rect.width < rectOf(parent).width - 1;
    const inFlexOrGrid = parent && /flex|grid/.test(cs(parent).display);
    for (const prop of ['marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'rowGap', 'columnGap']) {
      if ((centred || inFlexOrGrid) && (prop === 'marginLeft' || prop === 'marginRight')) continue;
      const v = parseFloat(s[prop]);
      if (Number.isFinite(v) && v !== 0) spacing.add(Math.round(Math.abs(v)));
    }

    // Grounds: opaque surfaces spanning the viewport, other than the register's background and layer. The masthead is exempt.
    const bg = toHex(s.backgroundColor);
    const wide = rect.width >= vw * 0.9 && rect.height >= 48 && !isMasthead(el);
    if (wide) {
      if (bg && bg !== rootBg && !layerColors.includes(bg)) grounds.push(bg);
      for (const stop of gradientStops(s.backgroundImage)) if (stop !== rootBg && !layerColors.includes(stop)) grounds.push(stop);
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
        measureCh: role === 'other' && words < 8 ? null : Math.round(block.getBoundingClientRect().width / chOf(block)),
        isData: !!el.closest(dataSelector), isWordmark: !!el.closest('.af-wordmark'),
        // An inactive control is exempt from the contrast floor by WCAG 1.4.3 itself, and this
        // system dims one with an opacity token, so it would otherwise fail its own rule.
        isDisabled: !!el.closest('[disabled], [aria-disabled="true"], .af-disabled, fieldset[disabled]'),
        isInteractive: !!el.closest('a[href], button, [role="button"], input, select, textarea, summary'),
        sample: own.trim().slice(0, 40),
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
        const inMark = !!el.closest('.af-mark');
        imagery.push({
          kind: el.getAttribute('data-figure') ?? (inMark ? 'form' : 'decorative'), tag, sizePx: Math.round(Math.min(rect.width, rect.height)),
          generated: generated ?? (inMark ? 'form' : null), sample: el.getAttribute('aria-label') ?? el.getAttribute('alt') ?? '',
          hasAlt: tag === 'img' ? el.hasAttribute('alt') : undefined,
          hasAriaLabel: tag === 'svg' ? el.hasAttribute('aria-label') : undefined,
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
      const underlined = runs.length > 0 && runs.every((e) => {
        for (let n = e; n && n !== parent; n = n.parentElement) {
          const ns = cs(n);
          if (ns.textDecorationLine.includes('underline')) return true;
          if (/inline-block|inline-flex|inline-grid|block|flex|grid/.test(ns.display) && n !== el) return false;
        }
        return false;
      });
      links.push({ color: toHex(s.color), background: bgOf(el), underlined, sample: el.textContent.trim().slice(0, 40) });
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
      });
    }

    // Absences: no box-shadow, no gradient fill, no radius, save for the named exemptions the rule applies.
    const className = typeof el.className === 'string' ? el.className : '';
    if (s.boxShadow && s.boxShadow !== 'none') {
      absences.push({ kind: 'shadow', element: tag, className, value: s.boxShadow, ariaCurrent: el.getAttribute('aria-current') });
    }
    if (/gradient\(/.test(s.backgroundImage)) {
      const clip = s.webkitBackgroundClip || s.backgroundClip || '';
      absences.push({ kind: 'gradient', element: tag, className, textClip: /text/.test(clip), wide: rect.width >= vw * 0.9 });
    }
    const radius = parseFloat(s.borderTopLeftRadius) || 0;
    if (radius > 0) {
      absences.push({ kind: 'radius', element: tag, className, value: Math.round(radius), inputType: tag === 'input' ? el.type : null });
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
      if ((s.position === 'absolute' || s.position === 'fixed') && !inSvg(el) && !el.closest('.af-mark')) {
        const lines = g ? linesFor(g) : [];
        // Placement is judged before motion: subtract any translate so a layer sliding into register is not read as off-grid.
        let tx = 0, ty = 0;
        if (s.translate && s.translate !== 'none') {
          const [px, py] = s.translate.split(/\s+/).map(parseFloat);
          tx += px || 0; ty += py || 0;
        }
        const tm = s.transform && s.transform !== 'none' && s.transform.match(/matrix\(([^)]+)\)/);
        if (tm) { const m = tm[1].split(','); tx += Number(m[4]) || 0; ty += Number(m[5]) || 0; }
        const left = rect.left - tx;
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

  return {
    register, theme, spreads, offGrid, composition,
    headings: [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter((h) => cs(h).display !== 'none').map((h) => ({ level: Number(h.tagName[1]), sample: h.textContent.trim().slice(0, 40) })),
    wordCount: (root.querySelector('main') ?? root).innerText.split(/\s+/).filter(Boolean).length,
    hasProvenance: !!root.querySelector('.af-provenance'),
    animations: document.getAnimations().length,
    mixedRegisters,
    overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    viewport: vw,
    background: rootBg,
    grounds: [...new Set(grounds)],
    text,
    spacing: [...spacing].sort((a, b) => a - b),
    aspectRatios: [...new Set(ratios)],
    imagery, statuses, links, charts, targets, absences,
  };
}

/**
 * Drive a Playwright page: load `url`, extract the spec, then reload and walk every tab stop reading its focus ring.
 */
export async function specFromPage(page, url, opts) {
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const spec = await page.evaluate(extract, opts);
  // Whether the register was assumed is read from the load the spec came from, before the reload
  // for focus: a page that changes between loads must not report the second load's answer.
  if (opts?.register != null) spec.assumedRegister = await page.evaluate(() => !!document.querySelector('[data-af-assumed]'));
  if (spec.register == null) return spec;

  await page.reload({ waitUntil: 'load' });
  const seen = new Set();
  spec.focusStyles = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      const visible = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
      const m = s.outlineColor.match(/\d+/g);
      const color = m ? '#' + m.slice(0, 3).map((v) => Number(v).toString(16).padStart(2, '0').toUpperCase()).join('') : null;
      const key = el.tagName.toLowerCase() + '#' + (el.id || '') + '.' + el.className + ':' + (el.getAttribute('href') || '') + (el.textContent || '').slice(0, 20);
      return { visible, color, element: el.tagName.toLowerCase(), key };
    });
    if (!f || seen.has(f.key)) break;
    seen.add(f.key);
    spec.focusStyles.push(f);
  }
  spec.focusStyle = spec.focusStyles[0] ?? null;
  return spec;
}
