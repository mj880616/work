import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lineOrBlank, blankRootAt} from '../app/drop-open-folder.mjs';
// S71-45 STD-빈곳놓기·순서는줄사이만(docs/design/standard-interactions.md D10·D11): 화면 없이 판정만 본다.
test('순서 선은 줄 사이에서만: 맨 끝 줄 아래 끝·맨 첫 줄 위 끝은 빈 곳', () => {
  assert.equal(lineOrBlank('after', {last: true}), 'blank');
  assert.equal(lineOrBlank('after', {last: false}), 'after');
  assert.equal(lineOrBlank('before', {first: true}), 'blank');
  assert.equal(lineOrBlank('before'), 'before');
  assert.equal(lineOrBlank('inside', {last: true, first: true}), 'inside');
});
// 작은 가짜 요소: closest(선택자)를 사슬로 흉내 낸다.
const el = (tags, parent = null) => { const me = {tags, parent, contains(x) { for (let n = x; n; n = n.parent) if (n === me) return true; return false; }, closest(sel) { for (let n = me; n; n = n.parent) if (sel.split(',').some(s => n.tags.includes(s.trim()))) return n; return null; }}; return me; };
test('빈 곳: 나무 칸 안이고 줄·단추 밖일 때만', () => {
  const tree = el(['[data-tree]']), row = el(['.ft-row'], tree), name = el(['span'], row), btn = el(['button'], tree), out = el(['div']);
  assert.equal(blankRootAt(tree, {zone: '[data-tree]'}), true);
  assert.equal(blankRootAt(name, {zone: '[data-tree]'}), false);
  assert.equal(blankRootAt(btn, {zone: '[data-tree]'}), false);
  assert.equal(blankRootAt(out, {zone: '[data-tree]'}), false);
  assert.equal(blankRootAt(tree, {zone: tree}), true);
  assert.equal(blankRootAt(null, {zone: '[data-tree]'}), false);
});
