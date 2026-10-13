import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePatches, patchCss } from '../src/lib/fix/patch.mjs';
import { withPatches } from '../src/lib/fix/apply.mjs';

test('a fenced or bare JSON edit list is read as patches', () => {
  const edits = '[{"id":"12","css":{"max-width":"72ch"}},{"id":"3","pseudo":":focus-visible","css":{"outline":"3px solid #FFDD00"}}]';
  for (const text of [edits, '```json\n' + edits + '\n```', 'Here are the edits:\n```\n' + edits + '\n```\nThat should do it.']) {
    const p = parsePatches(text);
    assert.equal(p.length, 2, text.slice(0, 20));
    assert.deepEqual(p[0], { afId: '12', pseudo: '', decl: { 'max-width': '72ch' } });
    assert.equal(p[1].pseudo, ':focus-visible');
  }
});

test('anything that is not an edit list is not guessed at', () => {
  for (const text of ['I rewrote the page.', '<!doctype html><html></html>', '', '{"id":"1"}', '[{"id":"1"}]', '[]']) {
    assert.equal(parsePatches(text), null, JSON.stringify(text.slice(0, 20)));
  }
});

test('patches become CSS only for elements the checker actually saw', () => {
  const sel = new Map([['12', 'html > body:nth-of-type(1) > p:nth-of-type(1)']]);
  const { css, applied, unknown } = patchCss([
    { afId: '12', pseudo: '', decl: { 'max-width': '72ch' } },
    { afId: '99', pseudo: '', decl: { color: 'red' } },
  ], sel);
  assert.equal(applied.length, 1);
  assert.deepEqual(unknown, ['99']);
  assert.match(css, /^html > body:nth-of-type\(1\) > p:nth-of-type\(1\) \{ max-width: 72ch !important; \}$/);
});

test('a patch block is separate from the fixer block, so neither erases the other', () => {
  const page = '<!doctype html><html><head><style data-af-fixes>a{}</style></head><body></body></html>';
  const out = withPatches(page, 'p { color: red !important; }');
  assert.match(out, /data-af-fixes/, 'the fixer block survives');
  assert.match(out, /<style data-af-patch>/);
  assert.equal((withPatches(out, 'p { color: blue !important; }').match(/data-af-patch/g) ?? []).length, 1, 'patches replace, not accumulate');
});
