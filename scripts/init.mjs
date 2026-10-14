#!/usr/bin/env node
/**
 * af init --pack <pack tokens.json | instrument>
 *
 * Import a Standards pack and name it in af.config.json, so every later `af` command in this directory
 * judges pages against the pack's own rules. `instrument` is the free pack, bundled (CC BY 4.0).
 * A pack that cannot meet the floors is refused with the measurement, as `af system import` refuses it.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fromPack } from '../src/lib/pack.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const which = args[args.indexOf('--pack') + 1];
if (!args.includes('--pack') || !which) { console.error('usage: af init --pack <pack tokens.json | instrument>'); process.exit(2); }
const bundled = /^[a-z-]+$/.test(which) && !existsSync(which);
const path = bundled ? `${ROOT}packs/${which}.tokens.json` : which;
if (!existsSync(path)) { console.error(`af init: no pack at ${which}${bundled ? ' (bundled packs: instrument)' : ''}`); process.exit(2); }

const pack = JSON.parse(readFileSync(path, 'utf8'));
const { overlay, report } = fromPack(pack, { key: bundled ? which : undefined });
if (!overlay) {
  console.error(`${pack.system ?? 'The pack'} was refused:\n  ${report.refused.join('\n  ')}\nA system that cannot meet the floors is a finding for its author.`);
  process.exit(1);
}
mkdirSync('.af', { recursive: true });
writeFileSync('.af/system.json', `${JSON.stringify(overlay, null, 2)}\n`);
const config = existsSync('af.config.json') ? JSON.parse(readFileSync('af.config.json', 'utf8')) : {};
writeFileSync('af.config.json', `${JSON.stringify({ ...config, system: '.af/system.json' }, null, 2)}\n`);
console.log(`${pack.system} ${pack.version ?? ''} is this directory's system: .af/system.json, named in af.config.json.`);
console.log(`  ${report.stated.length} colours and voices stated by the pack, ${report.derived.length} derived; af system import ${bundled ? `${ROOT}packs/${which}.tokens.json` : which} lists each one.`);
console.log('Next: af lint <page.html | url>');
