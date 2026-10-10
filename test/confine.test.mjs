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
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser, lintPages, ENGINE_ROOT } from '../src/lib/page-lint.mjs';
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

test('close browser', { skip }, async () => {
  await browser.close();
});
