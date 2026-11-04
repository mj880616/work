import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// UI-플러스키보드(요청함 11/03 15:09): 폰에서 담당조직 자료 [+]를 누르면 파일 고르기가 먼저이고 키보드가 올라오면 안 된다.
// 원인(사실): [+] → #newDocumentBtn → team.js openDocumentModal이 자료명 칸(#docTitle)에 초점을 줘서 폰 키보드가 올라옴.
// 고침: 손가락 화면(pointer:coarse)에서는 자료명 칸에 초점을 주지 않는다. 마우스·키보드 화면은 그대로(accessibility-ux.spec 1024px).
const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('자료 등록 창은 손가락 화면에서 자료명 칸에 초점을 주지 않고, 마우스 화면은 그대로 자료명 칸', () => {
  const team = read('app/team.js');
  assert.match(team, /const docInitialFocus=\(\)=>window\.matchMedia\?\.\('\(pointer: coarse\)'\)\.matches\?null:'#docTitle'/);
  assert.match(team, /openModal\('documentModal',\{initialFocus:docInitialFocus\(\)\}\)/);
  assert.doesNotMatch(team, /openModal\('documentModal',\{initialFocus:'#docTitle'\}\)/);
});

test('[+] 버튼 바탕은 마우스를 올릴 수 있는 화면에서만(폰에서 누른 뒤 회색 동그라미가 남지 않게)', () => {
  const css = read('app/workplace-detail.css');
  assert.match(css, /@media\(hover:hover\)\{\.wd-add-plus:hover\{background:var\(--kptu-surface-subtle\)\}\}/);
  assert.doesNotMatch(css, /(^|\n)\.wd-add-plus:hover\{/);
});
