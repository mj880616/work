import {test} from 'node:test';
import assert from 'node:assert/strict';
import {countPatterns, comparePatterns, checkBaseline} from './patch-patterns.mjs';
// S71-74 UI-덮어쓰기땜질없애기: 땜질 모양(넓은 감시·힘 숨김·:has 숨김)은 기준표보다 늘 수 없다.
test('앱 전체: 땜질 모양이 기준표보다 늘지 않음', () => assert.deepEqual(checkBaseline().errors, []));
test('넓은 MutationObserver(document·body subtree)는 센다 · 좁은 감시는 세지 않는다', () => {
  assert.equal(countPatterns('a.js', "new MutationObserver(fix).observe(document.body,{childList:true,subtree:true})").broadObserver, 1);
  assert.equal(countPatterns('a.js', "mo.observe(document.documentElement, { subtree: true, attributes: true })").broadObserver, 1);
  assert.equal(countPatterns('a.js', "mo.observe(document, {childList:true, subtree:true})").broadObserver, 1);
  assert.equal(countPatterns('a.js', "mo.observe(dialog,{attributes:true,attributeFilter:['class']})").broadObserver, 0);
  assert.equal(countPatterns('a.js', "mo.observe(document.body,{childList:true})").broadObserver, 0);
  assert.equal(countPatterns('a.js', "// mo.observe(document.body,{subtree:true})").broadObserver, 0);
});
test('display:none!important와 :has 숨김 규칙을 센다 · 상태 숨김([hidden])은 세지 않는다', () => {
  assert.equal(countPatterns('a.css', '.old-box{display:none!important}').importantHide, 1);
  assert.equal(countPatterns('a.css', '.x[hidden]{display:none}').importantHide, 0);
  assert.equal(countPatterns('a.css', 'html:has(#noteView .open) #appView>.mobile-shell-header{display:none}').hasHide, 1);
  assert.equal(countPatterns('a.css', '.box:has(.row){display:grid}').hasHide, 0);
  assert.equal(countPatterns('a.css', '/* .a:has(.b){display:none} */').hasHide, 0);
  assert.equal(countPatterns('a.js', "style.textContent='.y{display:none !important}'").importantHide, 1);
});
test('기준표: 늘면 실패(새 파일 포함) · 줄면 통과하고 기준표 줄이기 알림', () => {
  const base = {'a.js': {broadObserver: 1}};
  assert.equal(comparePatterns({'a.js': {broadObserver: 2, importantHide: 0, hasHide: 0}}, base).errors.length, 1);
  assert.equal(comparePatterns({'new.css': {broadObserver: 0, importantHide: 1, hasHide: 0}}, base).errors.length, 1);
  const r = comparePatterns({}, base);
  assert.deepEqual(r.errors, []); assert.equal(r.reduced.length, 1);
});
