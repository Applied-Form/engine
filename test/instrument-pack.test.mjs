/**
 * Instrument's own reference pages, judged under Instrument.
 *
 * One page per move from appliedform/standards (examples/workflow/reference-catalogue-r3, the
 * standard width; CC BY 4.0, attributed in NOTICE). Under Instrument's imported system the gate must
 * report exactly the breaches of Instrument's own declared rules that a reader of those pages finds,
 * and nothing else: every one below was read against the page's CSS and Instrument's source
 * ("Spacing 8/16/24/32/48/64/96. Nothing off the scale."), and it is the pack's finding, not the gate's.
 * A new entry is a false positive to fix; a missing one is a breach the gate stopped seeing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromPack } from '../src/lib/pack.mjs';
import { launchBrowser } from '../src/lib/page-lint.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const pages = join(root, 'test/fixtures/packs/instrument');

let skip = false;
try { await (await launchBrowser()).close(); } catch (e) { if (process.env.CI) throw e; skip = `no Chromium: ${e.message.split('\n')[0]}`; }

const GENUINE = {
  'band-statement.html': [],
  'datum.html': ['spacing: 19px is off the 8px spacing scale'],      // row-gap: 0.2em on the datum figure
  'key.html': ['spacing: 3px is off the 8px spacing scale'],         // gap: 3px between key rows
  'matrix.html': ['spacing: 1px is off the 8px spacing scale'],      // th keeps the browser's 1px padding
  'plate.html': [],
  'register.html': [],
  'running-index.html': [],
  'schedule.html': [],
  'series.html': ['spacing: 4px is off the 8px spacing scale'],      // padding-left: 4px !important
};

test("Instrument's reference pages show exactly Instrument's own breaches under Instrument", { skip, timeout: 300_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'af-instrument-'));
  const instrument = JSON.parse(readFileSync(join(root, 'test/fixtures/instrument.tokens.json'), 'utf8'));
  const { overlay } = fromPack(instrument, { key: 'instrument' });
  writeFileSync(join(dir, 'system.json'), JSON.stringify(overlay));
  writeFileSync(join(dir, 'child.mjs'), `
    import { pathToFileURL } from 'node:url';
    import { join } from 'node:path';
    import { lintPages, launchBrowser, DEFAULT_FILE_ROOTS } from ${JSON.stringify(join(root, 'src/lib/page-lint.mjs'))};
    const dir = ${JSON.stringify(pages)};
    const browser = await launchBrowser();
    const out = {};
    for (const f of ${JSON.stringify(Object.keys(GENUINE))}) {
      const rs = await lintPages([pathToFileURL(join(dir, f)).href], { browser, viewports: [320, 1280], fileRoots: [dir, ...DEFAULT_FILE_ROOTS()] });
      out[f] = [...new Set(rs.flatMap((r) => r.violations.map((v) => v.rule + ': ' + v.message)))].sort();
    }
    await browser.close();
    console.log(JSON.stringify(out));`);
  const run = spawnSync(process.execPath, [join(dir, 'child.mjs')], { env: { ...process.env, AF_BRAND: join(dir, 'system.json') }, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout.trim().split('\n').pop()), GENUINE);
});
