import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {leAddHtml,leRowHtml,leInlineHtml,leMenuHtml,leMove,leStep} from '../app/list-edit.mjs';
import {reorderedCategories} from '../app/document-categories.js';
// S51-28 LIB-화면정리 ②: '목록 고치기' 공용 부품. 줄 = ⠿ · 이름(누르면 그 자리 고침) · 수 · ⋯, 고정 줄 = 자물쇠 '고정'. 큰 버튼·빨강 없음.

test('줄 모양: 손잡이·이름 단추·수·⋯, 고정 줄은 단추 없음, 빨강 없음',()=>{
  const row=leRowHtml({id:'정책',label:'정책',meta:'7',drag:true});
  assert.match(row,/data-reorder-id="정책"/);assert.match(row,/class="le-handle" data-reorder-handle/);
  assert.match(row,/class="le-name" data-le-rename="정책" aria-label="정책 이름 수정"/);assert.match(row,/<span class="le-meta">7<\/span>/);
  assert.match(row,/class="le-more" data-le-menu="정책"/);assert.doesNotMatch(row,/danger/);
  const lock=leRowHtml({id:'기타',label:'기타',meta:'1',locked:true});
  assert.doesNotMatch(lock,/<button/);assert.match(lock,/<span class="le-lock"><span class="ui-ico ui-ico-lock" aria-hidden="true"><svg[^]*<\/span>고정<\/span>/);assert.doesNotMatch(lock,/🔒/);
  const sub=leRowHtml({id:'a›b',label:'a › b',shown:'b',sub:true});
  assert.match(sub,/le-row le-sub/);assert.doesNotMatch(sub,/data-reorder-id/);
  assert.match(leAddHtml({name:'새 분류 이름',limit:20}),/<form class="le-add" data-enter-save><input type="text" class="le-input" maxlength="20" placeholder="새 분류 이름"/);
  assert.match(leInlineHtml({label:'새 이름',value:'x'}),/class="le-done" data-enter-save-submit>완료/);
  assert.equal(leMenuHtml([{key:'delete',label:'지우기'}]),'<button type="button" data-le-act="delete">지우기</button>');
  // 이름은 늘 이스케이프.
  assert.match(leRowHtml({id:'<a>',label:'<a>'}),/&lt;a&gt;/);
});

test('끌어 놓기·키보드 한 칸',()=>{
  assert.deepEqual(leMove(['a','b','c'],'c',0),['c','a','b']);
  assert.deepEqual(leMove(['a','b','c'],'a',2),['b','c','a']);
  assert.deepEqual(leMove(['a','b'],'x',0),['a','b']);
  assert.deepEqual(leStep(['a','b','c'],'b',-1),['b','a','c']);
  assert.deepEqual(leStep(['a','b','c'],'c',1),['a','b','c']);
});

test('분류 순서: 소분류는 큰 분류 뒤로 함께, 기타는 끝, 같은 이름들만',()=>{
  const list=['교섭','주간보고','주간보고›확정본','투쟁','기타'];
  assert.deepEqual(reorderedCategories(list,['투쟁','주간보고','교섭']),['투쟁','주간보고','주간보고›확정본','교섭','기타']);
  assert.deepEqual(reorderedCategories(['기타','교섭','투쟁'],['투쟁','교섭']),['투쟁','교섭','기타']);
  assert.equal(reorderedCategories(list,['투쟁','교섭']),null);
  assert.equal(reorderedCategories(list,['투쟁','주간보고','교섭','새것']),null);
});

test('목록 고치기 창은 아래 탭 위에서 끝나고 빨강을 쓰지 않는다',()=>{
  const css=readFileSync(new URL('../app/list-edit.css',import.meta.url),'utf8');
  assert.match(css,/\.modal\.le-modal\{bottom:calc\(var\(--kptu-mobile-tab-height,0px\) \+ env\(safe-area-inset-bottom\)\)\}/);
  assert.doesNotMatch(css.replace(/\.le-status\.error\{[^}]*\}/,''),/danger/);
});
