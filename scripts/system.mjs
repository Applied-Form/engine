/**
 * `af system import <pack-tokens.json>` — read a system authored elsewhere into this one.
 *
 * The report is the deliverable as much as the overlay: what the pack stated, what had to be
 * derived because a six-colour contract cannot state a chart series, what could not be carried
 * across at all, and every contrast measurement taken on the way. A pack whose own colours fail
 * a floor is refused with the number, exactly as `af brand` refuses a hue that cannot work.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fromPack } from '../src/lib/pack.mjs';

const args = process.argv.slice(2);
const sub = args[0] === 'import' ? args.slice(1) : args;
const flag = (name) => { const i = sub.indexOf(`--${name}`); return i === -1 ? null : sub[i + 1]; };
const file = sub.find((a) => !a.startsWith('--') && !sub[sub.indexOf(a) - 1]?.startsWith('--'));

if (!file) {
  console.error('usage: af system import <pack tokens.json> [--key k] [--name "Name"] [--out file]');
  process.exit(2);
}

const pack = JSON.parse(readFileSync(file, 'utf8'));
const { overlay, report } = fromPack(pack, { key: flag('key'), name: flag('name') });

console.log(`\n${report.system ?? file} ${report.version ?? ''}`.trimEnd());
const section = (title, lines) => { if (lines.length) { console.log(`\n${title}`); for (const l of lines) console.log(`  ${l}`); } };
section('Stated by the pack', report.stated);
section('Derived, because the pack does not state them', report.derived);
section('Not carried across', report.carried);
section('Measured', report.notes);
section('Refused', report.refused);

if (!overlay) {
  console.error('\nNo overlay written. A system that cannot meet the floors is a finding for its author.');
  process.exit(1);
}

const out = flag('out');
if (out) {
  writeFileSync(out, `${JSON.stringify(overlay, null, 2)}\n`);
  console.log(`\nwrote ${out} (${Object.keys(overlay.color).length} colours, ${Object.keys(overlay.font ?? {}).length} voices)`);
} else {
  console.log(`\n${JSON.stringify(overlay, null, 2)}`);
}
