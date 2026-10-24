/**
 * The gate, served to an agent as tools rather than as context.
 *
 * There are two halves to giving a design system to a model. `Applied-Form/standards-schema` serves the
 * first: what the system *is* — its rules, its tokens, the move to reach for. This serves the
 * second: whether an artefact actually obeys one. They are different questions, they belong in
 * different servers, and a client can hold both at once, which is the arrangement this file is
 * written for. Nothing here re-serves a ruleset.
 *
 * Why a server rather than a paragraph in a prompt. A model handed a design system as text has to
 * hold every rule in context and check its own work against them. A model handed `standards_lint` has
 * the check made for it from the rendered page: it writes a page, calls a tool, and is told what
 * is wrong and what to change. Whether that yields better pages than the rules alone is what the
 * evaluation tests; the pilot found it removes most violations of the rules it checks and does
 * not improve the rules it does not (docs/pilot-results.md).
 *
 * JSON-RPC 2.0 over newline-delimited stdio, no dependencies beyond what the linter already needs.
 */
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RULES } from './rules/registry.mjs';
import { contrast, requiredContrast, apca } from './contrast.mjs';
import { colors, floors, registers, spacingScale, fonts, typeScale, aspectRatios, recipes, prohibitions, absent, radiusScale } from './tokens.mjs';
import { derivePalette } from './palette.mjs';
import { fromPack } from './pack.mjs';
import { CLIENT_KEY, TOOL_MAP, deprecated } from './names.mjs';

export const SERVER = { name: CLIENT_KEY, version: '4.0.1' };

export const TOOLS = [
  {
    name: 'standards_lint',
    description: 'Measure a page against the design system in a real browser and return every violation with the fix. Pass html for a draft, or url for something already served. This is the loop: draft, lint, apply the fixes, lint again.',
    inputSchema: {
      type: 'object',
      properties: {
        html: { type: 'string', description: 'A complete HTML document to measure.' },
        url: { type: 'string', description: 'A file:// or https:// page to measure instead.' },
        register: { type: 'string', enum: ['i', 'ii'], description: 'Which register the page is in, if the document does not declare it.' },
        viewports: { type: 'array', items: { type: 'number' }, description: 'Widths to measure. Defaults to the system\'s four plus two sampled from between them.' },
      },
    },
  },
  {
    name: 'standards_fix',
    description: 'Apply the fixes Standards can make on its own to a draft, measured in a real browser, and return the fixed HTML with a report: rules fixed, patches applied and refused, and what still fails, by element. No model is called, and a fix that makes any rule worse is not applied. Pass html; what remains needs a change to the markup.',
    inputSchema: {
      type: 'object',
      required: ['html'],
      properties: {
        html: { type: 'string', description: 'A complete HTML document to fix.' },
        register: { type: 'string', enum: ['i', 'ii'], description: 'Which register the page is in, if the document does not declare it.' },
        viewports: { type: 'array', items: { type: 'number' }, description: 'Widths to measure and fix at. Defaults to the system\'s four plus two sampled from between them.' },
      },
    },
  },
  {
    name: 'standards_rules',
    description: 'Every rule the gate enforces: what it requires, why, how to fix it, and which WCAG criteria it touches. Filter by group to keep the answer small.',
    inputSchema: { type: 'object', properties: { group: { type: 'string' }, wcag: { type: 'boolean', description: 'Only rules that touch a WCAG criterion.' } } },
  },
  {
    name: 'standards_tokens',
    description: 'The values the system permits: colours, spacing scale, type scale, voices, floors, ratios, and what it declares absent. Ask for this instead of guessing a value.',
    inputSchema: { type: 'object', properties: { group: { type: 'string', description: 'colour, spacing, type, floors, absent — omit for all.' } } },
  },
  {
    name: 'standards_contrast',
    description: 'Measure a foreground against a background: the WCAG 2 ratio, the floor required at that size and weight, whether it passes, and the APCA reading as an advisory.',
    inputSchema: {
      type: 'object',
      required: ['foreground', 'background'],
      properties: {
        foreground: { type: 'string' }, background: { type: 'string' },
        sizePx: { type: 'number' }, weight: { type: 'number' },
      },
    },
  },
  {
    name: 'standards_brand',
    description: 'Derive a complete palette from a hue and a paper colour, measured against every floor, or refuse it with the reasons. Use this instead of inventing a palette.',
    inputSchema: { type: 'object', required: ['hue', 'paper'], properties: { hue: { type: 'number' }, paper: { type: 'string' } } },
  },
  {
    name: 'standards_move',
    description: 'The recipe for a named compositional move: its cells, layers, voices and ground. One move is active per artefact; ask for the one you need rather than reading all of them.',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Omit to list the moves that exist.' } } },
  },
  {
    name: 'standards_system',
    description: 'Read a design system authored elsewhere (a Standards pack tokens.json) into this one, reporting what it stated, what had to be derived, and what could not be carried across.',
    inputSchema: { type: 'object', required: ['pack'], properties: { pack: { type: 'object', description: 'The pack\'s token contract, parsed.' } } },
  },
  {
    name: 'standards_drift',
    description: 'Measure what a design system actually is on pages that were not built to this one, and how far they have drifted from it: the palette, spacing step and type scale in use, plus how many values are indistinguishable duplicates. Use this to learn somebody else\'s system before working in it, rather than guessing from a screenshot.',
    inputSchema: {
      type: 'object',
      properties: {
        html: { type: 'array', items: { type: 'string' }, description: 'Complete HTML documents to measure.' },
        urls: { type: 'array', items: { type: 'string' }, description: 'file:// or https:// pages to measure instead. More pages give a truer system; one page gives one page\'s habits.' },
        declared: { type: 'array', items: { type: 'string' }, description: 'Hex colours the organisation publishes, to report where the guideline and the site disagree.' },
        viewports: { type: 'array', items: { type: 'number' }, description: 'Widths to measure. Defaults to 1280.' },
      },
    },
  },
];

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });

/**
 * One browser for the life of the server, started on first use.
 *
 * The loop this server exists to serve is draft, lint, fix, lint again, and the first version
 * launched and destroyed a whole Chromium on every call — paying browser startup on each turn of
 * exactly the cycle it was built for. It is started lazily so a client that only ever asks for
 * rules or tokens never pays for one at all, and closed when the transport ends.
 */
let shared = null;
async function browser() {
  if (!shared || !shared.isConnected?.()) {
    const { launchBrowser } = await import('./page-lint.mjs');
    shared = await launchBrowser();
  }
  return shared;
}

/** Release the browser. Called when stdio closes, and by the tests, which must not leak one. */
export async function closeBrowser() {
  if (!shared) return;
  const b = shared;
  shared = null;
  await b.close();
}

/** Drafts are written to a temp file because a browser lays out a document, not a string. */
function draftFiles(docs) {
  const dir = mkdtempSync(join(tmpdir(), 'af-mcp-'));
  return docs.map((doc, i) => {
    const file = join(dir, `draft-${i}.html`);
    writeFileSync(file, doc);
    return pathToFileURL(file).href;
  });
}

/** Tool implementations. Each returns MCP content; each is callable directly, which is how they are tested. */
export const HANDLERS = {
  async standards_lint({ html, url, register, viewports } = {}, tool = 'standards_lint') {
    if (!html && !url) throw new Error(`${tool} needs html or url`);
    const { lintPages, VIEWPORTS, sampledViewports, ENGINE_ROOT } = await import('./page-lint.mjs');
    // The register is assumed by the linter itself, so a URL gets it as well as a draft.
    const [target] = html ? draftFiles([html]) : [url];
    const widths = viewports?.length ? viewports : [...VIEWPORTS, ...sampledViewports(2)].sort((a, b) => a - b);
    {
      // A draft is a model's page: it may read its own directory and the engine's files, and not
      // the directory the server runs in, which is usually the person's project.
      const fileRoots = html ? [ENGINE_ROOT] : undefined;
      const results = await lintPages([target], { viewports: widths, browser: await browser(), register: register ?? null, fileRoots });
      const fixOf = Object.fromEntries(RULES.map((r) => [r.id, r.fix]));
      const violations = [];
      for (const r of results) {
        for (const v of r.violations) {
          violations.push({ viewport: r.viewport, rule: v.rule, message: v.message, fix: fixOf[v.rule] ?? null, sample: v.text?.sample ?? v.imagery?.sample ?? null });
        }
      }
      return text({
        clean: violations.length === 0,
        widths,
        // The register the rules ran under. A page that declares its own keeps it, so a caller who
        // asked for one is told whether it was used.
        register: results[0]?.spec.register ?? null,
        assumedRegister: results[0]?.spec.assumedRegister ?? false,
        violations,
        advisories: results.flatMap((r) => r.advisories.map((a) => ({ viewport: r.viewport, rule: a.rule, message: a.message }))),
        note: violations.length ? 'Apply every fix and lint again. Do not lower a floor to pass.' : 'Clean at every width measured.',
      });
    }
  },

  /**
   * A draft only, as a string. standards_lint also takes a url, and returns what it measured; this returns
   * the page itself, so a url here would hand a model the full text of any local file the server can
   * read. The draft gets a draft's roots: its own temporary directory and the engine's files.
   */
  async standards_fix({ html, url, register, viewports } = {}, tool = 'standards_fix') {
    if (url != null) throw new Error(`${tool} takes html only, never a url: it returns the page, and a url would let a draft read any file the server can. Read the page yourself and pass its html.`);
    if (typeof html !== 'string' || !html) throw new Error(`${tool} needs html`);
    const { VIEWPORTS, sampledViewports, ENGINE_ROOT } = await import('./page-lint.mjs');
    const { fixPage } = await import('./fix/page.mjs');
    const widths = viewports?.length ? viewports : [...VIEWPORTS, ...sampledViewports(2)].sort((a, b) => a - b);
    const { html: fixed, report } = await fixPage(html, { browser: await browser(), register: register ?? null, viewports: widths, fileRoots: [ENGINE_ROOT] });
    return text({
      ...report,
      html: fixed,
      note: report.passed
        ? 'Every checked rule passes at every width measured. That is not a WCAG conformance claim; see notChecked.'
        : 'What remains needs a change to the markup or a decision the fixer does not make. Make it, then lint again. Do not lower a floor to pass.',
    });
  },

  async standards_drift({ html, urls, declared, viewports } = {}, tool = 'standards_drift') {
    const { surveyPages } = await import('./survey.mjs');
    const { driftReport } = await import('./drift.mjs');
    const { ENGINE_ROOT } = await import('./page-lint.mjs');
    const targets = [...(urls ?? []), ...draftFiles(html ?? [])];
    if (!targets.length) throw new Error(`${tool} needs html or urls`);
    // Drafts may be among the targets, so every page gets a draft's roots.
    const fileRoots = html?.length ? [ENGINE_ROOT] : undefined;
    const { merged, pages } = await surveyPages(targets, { browser: await browser(), viewports: viewports?.length ? viewports : [1280], fileRoots });
    merged.pages = pages.length;
    const report = driftReport(merged, { declared: declared?.length ? declared : null });
    return text({
      ...report,
      note: targets.length === 1
        ? 'One page measures one page\'s habits. Survey several before calling the result a system.'
        : 'Waste is the number to read first: nobody chose those values, so nothing is lost by removing them.',
    });
  },

  standards_rules({ group, wcag } = {}) {
    let out = RULES;
    if (group) out = out.filter((r) => r.group === group);
    if (wcag) out = out.filter((r) => r.wcag.length > 0);
    return text(out.map(({ id, group: g, severity, level, summary, why, fix, wcag: w }) => ({ id, group: g, severity, level, summary, why, fix, wcag: w })));
  },

  standards_tokens({ group } = {}) {
    const all = {
      colour: colors,
      register: registers,
      spacing: spacingScale,
      type: typeScale,
      voices: fonts,
      floors,
      aspectRatios,
      absent,
      radius: radiusScale.length ? radiusScale : 'declared absent',
      prohibitions,
    };
    return text(group ? { [group]: all[group] ?? `no such group; try ${Object.keys(all).join(', ')}` } : all);
  },

  standards_contrast({ foreground, background, sizePx = 16, weight = 400 } = {}) {
    const ratio = contrast(foreground, background);
    const need = requiredContrast(sizePx, weight, floors);
    return text({
      foreground, background, sizePx, weight,
      ratio: Number(ratio.toFixed(2)),
      required: need,
      passes: ratio >= need,
      apca: Number(Math.abs(apca(foreground, background)).toFixed(1)),
      note: 'WCAG 2 is the gate. APCA is advisory and does not decide anything.',
    });
  },

  standards_brand({ hue, paper } = {}) {
    try {
      const p = derivePalette({ hue, paper });
      return text({ derived: p.colors, note: 'Every role measured against the floors before it was returned.' });
    } catch (e) {
      return text({ refused: e.message, note: 'A palette that cannot meet the floors is refused rather than emitted.' });
    }
  },

  standards_move({ name } = {}) {
    if (!name) return text({ moves: Object.keys(recipes), note: 'One move is active per artefact. Ask for the one you need.' });
    const recipe = recipes[name];
    if (!recipe) return text({ error: `no move named ${name}`, moves: Object.keys(recipes) });
    return text({ name, recipe });
  },

  standards_system({ pack } = {}) {
    const { overlay, report } = fromPack(pack ?? {});
    return text({ imported: !!overlay, report, overlay });
  },
};

/**
 * The tool list a client sees. The default profile lists the `standards_*` names. The legacy
 * profile lists the `af_*` names and nothing else about the tools differs: it is for a client
 * configured with `af mcp` or `af-mcp`, which has `af_*` in its instructions and allowlists. Both
 * profiles accept both spellings on a call.
 */
const LEGACY_NAME = Object.fromEntries(Object.entries(TOOL_MAP).map(([old, current]) => [current, old]));
const toolsFor = (legacy) => (legacy ? TOOLS.map((t) => ({ ...t, name: LEGACY_NAME[t.name] })) : TOOLS);

/** Per process: which old names have already been named on stderr. */
const toldInThisProcess = new Set();
const toStderr = (line) => process.stderr.write(`${line}\n`);

/**
 * One JSON-RPC message in, one out, or null for a notification.
 *
 * `profile` is `{ legacy }`: which spelling `tools/list` uses. It is never read from the
 * environment, so a child process cannot inherit it; the entry point passes it from an argument.
 * A call under an old name is answered as the new name would be, with the notice appended as a
 * second content item and, once per name per process, a line on stderr. Under the legacy profile
 * the old names are the ones listed and the entry point has already said once that they are
 * deprecated, so only the item is added. `told` and `warn` are the profile's own, for the tests.
 */
export async function handle(msg, { legacy = false, told = toldInThisProcess, warn = toStderr } = {}) {
  const { id, method, params = {} } = msg ?? {};
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  if (method === 'initialize') {
    return ok({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: SERVER });
  }
  if (method === 'tools/list') return ok({ tools: toolsFor(legacy) });
  if (method === 'tools/call') {
    // Own properties only: a name every object has (constructor, toString) is not a tool.
    const old = Object.hasOwn(TOOL_MAP, params.name);
    const current = old ? TOOL_MAP[params.name] : params.name;
    const handler = Object.hasOwn(HANDLERS, current) ? HANDLERS[current] : null;
    if (!handler) return fail(-32602, `unknown tool: ${params.name}`);
    let result;
    try {
      result = await handler(params.arguments ?? {}, params.name);
    } catch (e) {
      // A failed measurement is a result the model can act on, not a transport error.
      result = { ...text({ error: e.message }), isError: true };
    }
    if (old) {
      const line = deprecated(params.name, current);
      if (!legacy && !told.has(params.name)) { told.add(params.name); warn(line); }
      result = { ...result, content: [...result.content, { type: 'text', text: line }] };
    }
    return ok(result);
  }
  if (method === 'notifications/initialized' || id === undefined) return null;
  return fail(-32601, `unknown method: ${method}`);
}

/** Serve over stdio, one JSON-RPC message per line. `profile` is handle's: `{ legacy }`. */
export async function serve(stdin = process.stdin, stdout = process.stdout, profile = {}) {
  let buffer = '';
  stdin.setEncoding('utf8');
  for await (const chunk of stdin) {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      let response;
      try {
        response = await handle(JSON.parse(line), profile);
      } catch (e) {
        response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: e.message } };
      }
      if (response) stdout.write(`${JSON.stringify(response)}\n`);
    }
  }
  // stdin ended: the client has gone, so the browser goes with it rather than outliving the
  // process that owns it.
  await closeBrowser();
}
