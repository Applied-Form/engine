#!/usr/bin/env node
/**
 * Derive a brand palette that satisfies every floor, or refuse.
 *   node scripts/brand.mjs --hue 210 --paper "#F4F7FA" [--saturation 0.5] [--name "North Field"] [--key north] [--wordmark brands/north/wordmark.svg] [--out brands/north.tokens.json]
 *
 * With --out the result is a brand overlay (system colour names plus the brand block), ready for
 * AF_BRAND=<key> npm run build:brand. Without it, the roles and their measurements are printed.
 */
import { writeFileSync } from 'node:fs';
import { derivePalette, toOverlay } from '../src/lib/palette.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const hue = Number(opt('hue')), paper = opt('paper'), saturation = Number(opt('saturation', 0.55));
const key = opt('key', 'brand'), name = opt('name', key), wordmark = opt('wordmark'), fontsDir = opt('fonts-dir');
if (!Number.isFinite(hue) || !paper) { console.error('usage: node scripts/brand.mjs --hue <0-360> --paper "#RRGGBB" [--saturation 0.55] [--name brand] [--out file]'); process.exit(2); }
try {
  const p = derivePalette({ hue, paper, saturation });
  for (const [k, v] of Object.entries(p.colors)) console.log(`${k.padEnd(14)} ${v}`);
  console.log('\nmeasured:'); for (const [k, v] of p.report) console.log(`  ${k.padEnd(24)} ${v}:1`);
  const out = opt('out');
  if (out) { writeFileSync(out, JSON.stringify(toOverlay(p, { name, key, wordmark, fontsDir }), null, 2) + '\n'); console.log(`\nwrote ${out} (${Object.keys(p.colors).length} roles as a brand overlay)`); }
} catch (e) { console.error(e.message); process.exit(1); }
