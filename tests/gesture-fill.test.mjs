// S51-24 UI-빈칸손짓: 손짓 칸 높이 계산(app/gesture-fill.js fillHeight)과 '그 폴더만' 상자 HTML(app/folder-tree-ui.mjs ftFocusHtml).
import test from 'node:test';
import assert from 'node:assert/strict';
import {fillHeight} from '../app/gesture-fill.js';
import {ftFocusHtml, ftFocusCount} from '../app/folder-tree-ui.mjs';

test('칸 아래에 다른 줄이 없으면 아래 바 위 끝까지, 여백 중 바 자리보다 많은 만큼 당긴다', () => {
  assert.deepEqual(fillHeight({viewH: 900, barTop: 852, top: 64, own: 300, sib: 0, pad: 100}), {h: 788, pull: 52});
  assert.deepEqual(fillHeight({viewH: 900, barTop: 852, top: 64, own: 300, sib: 0, pad: 30}), {h: 788, pull: 0});
});
test('칸 아래에 다른 줄이 있으면 그 줄까지 화면에 들어오는 만큼만', () => {
  assert.deepEqual(fillHeight({viewH: 900, barTop: 852, top: 64, own: 300, sib: 120, pad: 78}), {h: 638, pull: 0});
});
test('내용이 이미 길면 그대로', () => {
  assert.deepEqual(fillHeight({viewH: 900, barTop: 852, top: 64, own: 2000, sib: 0, pad: 78}), {h: 0, pull: 0});
  assert.deepEqual(fillHeight({viewH: NaN, top: 0, own: 0}), {h: 0, pull: 0});
});
test("'그 폴더만' 상자: 위치 줄(위 단계) · 머리([‹] + 열린 폴더 + 이름) · 개수, 돌아가기 글자 없음", () => {
  const html = ftFocusHtml({back: {'data-x-up': ''}, trail: [{label: '원드라이브', attrs: {'data-go': ''}}, {label: 'Documents', attrs: {'data-go': 'D'}}], name: 'PowerShell', count: ftFocusCount(1, 3), body: '<i>줄</i>'});
  assert.match(html, /^<section class="ft-box ft-focus"/);
  // FILES-폰폴더위로 ②: [‹]는 위치 줄이 아니라 지금 폴더 이름 줄 맨 앞.
  assert.match(html, /<nav class="ft-focus-anc"[^>]*><button type="button" class="ft-btn ft-focus-step" data-go="">/);
  assert.match(html, /원드라이브<\/button><span class="ft-focus-sep" aria-hidden="true">›<\/span><button[^>]*data-go="D">Documents<\/button>/);
  assert.match(html, /<div class="ft-focus-head"><button type="button" class="ft-btn ft-focus-back" data-x-up="" aria-label="폴더 나무" title="폴더 나무">‹<\/button><span class="ft-ico" data-ft-shape="open"/);
  assert.match(ftFocusHtml({back: {'data-x-up': ''}, backLabel: '위 폴더', name: 'A'}), /aria-label="위 폴더" title="위 폴더">‹</);
  assert.match(html, /<span class="ft-focus-name">PowerShell<\/span> <span class="ft-num">폴더 1 · 파일 3<\/span>/);
  assert.doesNotMatch(html, /나무로/);
  assert.equal(ftFocusCount(0, 2, '노트'), '노트 2');
  assert.equal(ftFocusCount(0, 0), '');
});
