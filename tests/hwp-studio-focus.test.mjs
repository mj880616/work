// STAB-HWP저장버튼초점(S56-2): 편집기 frame은 사람 손 없이 Web2 창의 키보드 초점을 가져가지 않는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('app/hwp-lab/studio-focus.js','utf8');

test('the editor frame loads the focus rule with the other Web2 frame scripts, before the editor bundle',()=>{
  const editor=readFileSync('app/hwp-lab/rhwp-0.8.7/studio/index.html','utf8');
  const scripts=[...editor.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(scripts.slice(0,5),['../../studio-guard.js','../../studio-styles.js','../../studio-convert.js','../../studio-fit.js','../../studio-focus.js']);
  assert.ok(scripts.findIndex(src=>/assets\/index-.*\.js$/.test(src))>4);
  assert.match(readFileSync('scripts/hwp-lab/finalize-rhwp-studio.mjs','utf8'),/studio-fit\.js"><\/script>\\n\s+<script src="\.\.\/\.\.\/studio-focus\.js">/);
  assert.doesNotMatch(source,/\bfetch\(|XMLHttpRequest|WebSocket|postMessage|eval\(|new Function|cookie|localStorage/);
});

function frame({hasFocus,active}){
  const calls=[];
  class HTMLElement{focus(...args){calls.push(args)}}
  const context={HTMLElement,document:{hasFocus:()=>hasFocus},navigator:{userActivation:{isActive:active}}};
  vm.runInNewContext(source,context);
  new HTMLElement().focus({preventScroll:true});
  return calls;
}

test('focus moves into the editor only when the frame already has focus or the person just pressed inside it',()=>{
  // 시작 때 빈 문서의 입력칸 초점: frame에 초점도 없고 사람이 누르지도 않았다 → 가져가지 않는다.
  assert.deepEqual(frame({hasFocus:false,active:false}),[]);
  // 편집기 안을 눌렀다(사용자 활성) 또는 frame에 이미 초점이 있다 → 전과 같다(인자도 그대로).
  assert.deepEqual(frame({hasFocus:false,active:true}),[[{preventScroll:true}]]);
  assert.deepEqual(frame({hasFocus:true,active:false}),[[{preventScroll:true}]]);
});
