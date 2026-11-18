// FIX-잊지말기할일기한(2026-11-18): 새 할 일 창의 빠른 기한 버튼이 먹지 않던 두 원인을 소스로 고정한다.
// ① 버튼 처리기가 '고치는 할 일(editing)'이 없으면 그냥 돌아갔다 → 새 할 일은 기한 칸만 바꾸고 고른 표시를 다시 그린다.
// ② 잊지 말기 화면(정리함)은 할 일 창 모양(google-tasks.css)을 싣지 않았다 → 창이 자기 모양을 직접 싣는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const js=readFileSync(new URL('../app/google-tasks.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/google-tasks.css',import.meta.url),'utf8');

test('빠른 기한 버튼: 새 할 일(editing 없음)에서도 받고, 기한 칸만 바꾼 뒤 고른 표시를 다시 그린다(바로 저장 없음)',()=>{
  const at=js.indexOf("m.querySelectorAll('[data-gt-due-quick]').forEach(q=>q.onclick=");
  assert.ok(at>0);
  const handler=js.slice(at,js.indexOf('openWeekPick(q',at));
  assert.doesNotMatch(handler,/onclick=\(\)=>\{if\(!editing\|\|/);
  assert.match(handler,/if\(!editing\)\{if\(editorSaving\)return;field\.value=day;paintQuick\(\);return\}/);
});

test('고른 표시(aria-pressed)는 상세 칸만이 아니라 폰 창·새 할 일 창에서도 기한 칸 값을 따른다',()=>{
  const fn=js.slice(js.indexOf('function paintQuick('),js.indexOf('\n',js.indexOf('function paintQuick(')));
  assert.match(fn,/q\.setAttribute\('aria-pressed',String\(on\)\)/);
  assert.doesNotMatch(fn,/removeAttribute\('aria-pressed'\)/);
});

test('할 일 창은 어느 화면에서 열어도 자기 모양(google-tasks.css)을 싣고, 없을 때만 기다린다',()=>{
  assert.match(js,/const EDITOR_STYLE='\.\/google-tasks\.css'/);
  assert.match(js,/async function openEditor\([^)]*\)\{\{const ready=ensureEditorStyle\(\);if\(!editorStyleOk\)await ready\}/);
  assert.doesNotMatch(js,/google-tasks\.css\?v=/);
});

test('새 할 일 창에도 빠른 기한 버튼 줄이 보인다(가리는 규칙 없음)',()=>{
  assert.match(css,/#gtTaskModal \.gt-due-quick\{display:flex/);
  assert.doesNotMatch(css,/(^|\n)\.gt-due-quick\{display:none\}/);
  assert.doesNotMatch(css,/#gtTaskModal\.gt-has-task \.gt-due-quick/);
});
