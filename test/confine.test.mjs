/**
 * A rendered page reads only its own directory and the engine's files.
 *
 * The browser runs with `--allow-file-access-from-files` (page-lint.mjs says why), which also lets a
 * `file://` page read any other local file by XMLHttpRequest or an iframe. The MCP server writes a
 * model's draft to a temporary file and renders it, so before 2026-10-10 a draft could read any
 * file the user can read. Measured: a draft read a secret from another directory by both routes.
 *
 * Each test page has one h1. If its script reads the secret it appends an h4, which the
 * heading-order rule reports, so a leak is visible in the lint result itself. The control allows
 * the secret's directory and must see the h4, or the other tests prove nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser, lintPages, ENGINE_ROOT, DEFAULT_FILE_ROOTS } from '../src/lib/page-lint.mjs';
import { surveyPages } from '../src/lib/survey.mjs';
import { HANDLERS, closeBrowser } from '../src/lib/mcp.mjs';

let browser = null, launchError = null;
try { browser = await launchBrowser(); } catch (e) { launchError = e; if (process.env.CI) throw e; }
const skip = browser ? false : `no Chromium: ${launchError?.message.split('\n')[0]}`;

const secretDir = mkdtempSync(join(tmpdir(), 'af-secret-'));
writeFileSync(join(secretDir, 'secret.txt'), 'TOP-SECRET');
const secret = pathToFileURL(join(secretDir, 'secret.txt')).href;

/** A Register II page that appends an h4 and fifty paragraphs for every route that reads the secret. */
const thief = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Draft</title></head>
<body data-register="ii"><main><h1>A draft</h1><p>Body text.</p></main>
<iframe id="f" src=${JSON.stringify(secret)} title="f" hidden></iframe>
<script>
  const leak = (how) => {
    const h = document.createElement('h4'); h.textContent = 'leaked by ' + how; document.querySelector('main').append(h);
    for (let i = 0; i < 50; i++) { const p = document.createElement('p'); p.textContent = 'x'; document.querySelector('main').append(p); }
  };
  try { const x = new XMLHttpRequest(); x.open('GET', ${JSON.stringify(secret)}, false); x.send(); if (x.responseText.includes('TOP-SECRET')) leak('xhr'); } catch {}
  document.getElementById('f').addEventListener('load', () => {
    try { if (document.getElementById('f').contentDocument.body.textContent.includes('TOP-SECRET')) leak('iframe'); } catch {}
  });
</script></body></html>`;

const draftDir = mkdtempSync(join(tmpdir(), 'af-draft-'));
writeFileSync(join(draftDir, 'draft.html'), thief);
const draft = pathToFileURL(join(draftDir, 'draft.html')).href;
const leaked = (result) => result.violations.some((v) => v.rule === 'heading-order');

test('control: when the secret directory is allowed, the page reads it and the lint shows it', { skip }, async () => {
  const [r] = await lintPages([draft], { viewports: [1280], browser, fileRoots: [secretDir, ENGINE_ROOT] });
  assert.ok(leaked(r), 'the detector must see a read it was allowed to make');
});

test('a page linted from a file cannot read a file outside its directory', { skip }, async () => {
  const [r] = await lintPages([draft], { viewports: [1280], browser });
  assert.ok(!leaked(r), JSON.stringify(r.violations.filter((v) => v.rule === 'heading-order')));
});

test('a page surveyed from a file cannot read a file outside its directory', { skip }, async () => {
  const { pages: allowed } = await surveyPages([draft], { browser, fileRoots: [secretDir, ENGINE_ROOT] });
  const { pages: confined } = await surveyPages([draft], { browser });
  assert.ok(allowed[0].survey.elements > confined[0].survey.elements + 40, `control ${allowed[0].survey.elements}, confined ${confined[0].survey.elements}`);
});

test('an MCP draft cannot read the directory the server runs in', { skip }, async () => {
  // The command line also allows its working directory, where a person's own page may keep its
  // assets. A draft is a model's, so it gets its own directory and the engine's files only: with
  // the server running inside the secret's directory, the draft still cannot read it.
  const was = process.cwd();
  process.chdir(secretDir);
  try {
    const out = await HANDLERS.af_lint({ html: thief, viewports: [1280] });
    const text = out.content.map((c) => c.text).join('\n');
    assert.doesNotMatch(text, /heading-order/, text.slice(0, 2000));
  } finally {
    process.chdir(was);
    await closeBrowser();
  }
});

test('an af_fix draft cannot read the directory the server runs in, and only its own source comes back', { skip }, async () => {
  // af_fix returns the page, so a draft that read a file would hand the file back. It gets af_lint's
  // roots: its own directory and the engine's files, with the server running inside the secret's.
  const was = process.cwd();
  process.chdir(secretDir);
  try {
    const out = JSON.parse((await HANDLERS.af_fix({ html: thief, viewports: [1280] })).content[0].text);
    assert.ok(!out.remaining.some((v) => v.rule === 'heading-order'), JSON.stringify(out.remaining));
    // What comes back is the draft's own source and the fix block, never anything the page rendered.
    assert.equal(out.html.replace(/<style data-af-fixes>[\s\S]*?<\/style>\n?/, ''), thief);
  } finally {
    process.chdir(was);
    await closeBrowser();
  }
});

test('control: the same draft fixed with the secret directory allowed reads it, so the test above can fail', { skip }, async () => {
  const { fixPage } = await import('../src/lib/fix/page.mjs');
  const { report } = await fixPage(thief, { browser, viewports: [1280], fileRoots: [secretDir, ENGINE_ROOT] });
  assert.ok(report.remaining.some((v) => v.rule === 'heading-order'), JSON.stringify(report.remaining));
});

test('with realpaths, a link inside a root is followed to where it leads: outside every root it is refused, inside one it is read', { skip }, async () => {
  // af audit lints pages in place, in directories a person named; one of them may hold a link to
  // the auditor's files. The browser follows a link, so with realpaths confine checks the file it
  // leads to. af audit asks for this; af lint and af fix do not (the next test).
  const dir = mkdtempSync(join(tmpdir(), 'af-link-'));
  writeFileSync(join(dir, 'kept.txt'), 'TOP-SECRET');
  symlinkSync(join(secretDir, 'secret.txt'), join(dir, 'out.txt'));
  symlinkSync(join(dir, 'kept.txt'), join(dir, 'in.txt'));
  writeFileSync(join(dir, 'page.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Links</title></head>
<body data-register="ii"><main><h1>Links</h1><p>Body text.</p></main><script>
  for (const name of ['out.txt', 'in.txt']) {
    try { const x = new XMLHttpRequest(); x.open('GET', name, false); x.send(); if (x.responseText.includes('TOP-SECRET')) { const h = document.createElement('h4'); h.textContent = 'read ' + name; document.querySelector('main').append(h); } } catch {}
  }
</script></body></html>`);
  const failed = [];
  const [r] = await lintPages([pathToFileURL(join(dir, 'page.html')).href], { viewports: [1280], browser, fileRoots: [], onFailed: (f) => failed.push(f), realpaths: true });
  const read = r.violations.filter((v) => v.rule === 'heading-order').map((v) => v.message).join('\n');
  assert.match(read, /read in\.txt/, 'a link to a file inside the root is read: the control');
  assert.doesNotMatch(read, /out\.txt/, 'a link to a file outside every root is not');
  assert.ok(failed.some((f) => f.url.endsWith('/out.txt') && f.type === 'xhr' && f.why === 'refused'), JSON.stringify(failed));
  assert.ok(!failed.some((f) => f.url.endsWith('/in.txt')), JSON.stringify(failed));
});

test('without realpaths, as af lint and af fix call it, a page reads a stylesheet linked into its directory from outside every root; with realpaths it is refused', { skip }, async () => {
  // A person's own site may link a shared stylesheet into the page's directory. Without realpaths
  // confine checks the path as written, so the link is read.
  const outside = mkdtempSync(join(tmpdir(), 'af-shared-'));
  writeFileSync(join(outside, 'pale.css'), '.pale { color: #d0d0d0; }\n');
  const dir = mkdtempSync(join(tmpdir(), 'af-linked-'));
  symlinkSync(join(outside, 'pale.css'), join(dir, 'style.css'));
  writeFileSync(join(dir, 'page.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Linked</title><link rel="stylesheet" href="style.css"></head>
<body data-register="ii"><main><h1>Linked</h1><p class="pale">A pale paragraph, coloured by a stylesheet linked in from elsewhere.</p></main></body></html>`);
  const url = pathToFileURL(join(dir, 'page.html')).href;
  const pale = (r) => r.violations.some((v) => v.rule === 'contrast' && /d0d0d0/i.test(`${v.text?.color} ${v.message}`));
  // af lint's roots: the working directory and the engine's files, neither of which holds the target.
  const failed = [];
  const [asLint] = await lintPages([url], { viewports: [1280], browser, onFailed: (f) => failed.push(f) });
  assert.ok(pale(asLint), `the stylesheet loaded: ${JSON.stringify(asLint.violations.map((v) => v.rule))}`);
  assert.deepEqual(failed, []);
  const { fixPage } = await import('../src/lib/fix/page.mjs');
  // af fix's roots: the page's directory and af lint's.
  const { initial } = await fixPage(readFileSync(join(dir, 'page.html'), 'utf8'), { browser, viewports: [1280], baseHref: pathToFileURL(`${dir}/`).href, fileRoots: [dir, ...DEFAULT_FILE_ROOTS()] });
  assert.ok(pale(initial[0]), 'af fix reads it too');
  // The control: with realpaths, as af audit asks, the same link is refused and heard.
  const refused = [];
  const [asReport] = await lintPages([url], { viewports: [1280], browser, onFailed: (f) => refused.push(f), realpaths: true });
  assert.ok(!pale(asReport), 'with realpaths the stylesheet is refused');
  assert.ok(refused.some((f) => f.url.endsWith('/style.css') && f.type === 'stylesheet' && f.why === 'refused'), JSON.stringify(refused));
});

test('close browser', { skip }, async () => {
  await browser.close();
});
