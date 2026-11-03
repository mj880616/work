// UI-고르기줄(S48-54, 요청함 11/03 07:43·07:44): 고르기 줄·크게 보기 아래 줄은 공용 부품 하나(app/action-bar.mjs + base-ui.css .kptu-actbar).
// 세 폭 실측은 tests/app-e2e/photos-menu.spec.mjs·basket-note-folder.spec.mjs·library-select-bar-even.spec.mjs 'UI-고르기줄'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACT_ICON, actInner } from '../app/action-bar.mjs';

const read = f => readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8');
const noComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

test('공용 부품: 옮기기·지우기는 글자색 선 아이콘(SVG), 아이콘 칸은 화면 읽기에서 뺀다', () => {
  for (const k of ['move', 'delete']) { assert.match(ACT_ICON[k], /^<svg [^>]*stroke="currentColor"[^>]*fill="none"|^<svg [^>]*fill="none"[^>]*stroke="currentColor"/); assert.match(ACT_ICON[k], /aria-hidden="true"/); }
  assert.equal(actInner('☆', '별표'), '<span class="kptu-act-ic" aria-hidden="true">☆</span> <span class="kptu-act-tx">별표</span>');
});

test('공용 규칙 한 곳: 같은 너비 칸·최대 120px·같은 간격·낱말 단위 줄바꿈·지우기 글자만 빨강', () => {
  const css = noComments(read('base-ui.css'));
  assert.match(css, /\.kptu-actbar\{display:flex;align-items:center;justify-content:space-evenly;/);
  assert.match(css, /#appView \.kptu-actbar>button\.kptu-act\{[^}]*flex:1 1 0;min-width:min-content;max-width:120px;[^}]*word-break:keep-all/);
  assert.doesNotMatch(css, /\.kptu-act-danger[^{]*\{[^}]*color:var\(--kptu-danger\)/, 'UI-지우기빨강빼기: 줄의 지우기도 다른 버튼과 같은 색');
  assert.match(css, /\.kptu-actbar-text\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(var\(--kptu-act-min,56px\),1fr\)\)/);
  assert.match(css, /#appView \.kptu-actbar-text>button\.kptu-act\{[^}]*width:100%/);
});

test('전수: 사진 고르기·휴지통 고르기·크게 보기·노트·자료실 고르기 줄이 같은 부품을 쓰고 📁·🗑 색 그림이 없다', () => {
  const photos = read('photos.js'), strip = read('photo-strip.js'), notes = read('basket-notes.js'), html = read('index.html');
  assert.match(photos, /<div class="photos-act kptu-actbar kptu-actbar-icon" data-photos-act /);
  assert.match(photos, /<div class="photos-act kptu-actbar kptu-actbar-icon" data-photos-trash-act /);
  assert.match(strip, /<div class="diary-viewer-actions kptu-actbar kptu-actbar-icon" /);
  assert.match(notes, /<span class="kptu-actbar kptu-actbar-text nx-sel-acts">/);
  assert.match(html, /<span class="kptu-actbar kptu-actbar-text lu-select-acts" /);
  const bar = (src, start) => { const i = src.indexOf(start); assert.ok(i >= 0, start); return src.slice(i, src.indexOf('</div>', i)); };
  for (const [src, start] of [[photos, '<div class="photos-act kptu-actbar kptu-actbar-icon" data-photos-act '], [photos, 'data-photos-trash-act'], [strip, '<div class="diary-viewer-actions']]) assert.doesNotMatch(bar(src, start), /📁|🗑/, start);
  for (const attr of ['data-photos-act-move', 'data-photos-act-delete', 'data-photos-purge']) assert.match(photos, new RegExp(`${attr}[^>]*>\\$\\{actInner\\(ACT_ICON\\.(move|delete)`));
  assert.match(strip, /data-od-delete>\$\{actInner\(ACT_ICON\.delete, '지우기'\)\}/);
  // 지우기는 모두 kptu-act-danger(표시만, 색은 같음).
  for (const attr of ['data-photos-act-delete', 'data-photos-purge']) assert.match(photos, new RegExp(`class="kptu-act kptu-act-danger" ${attr}`));
  assert.match(notes, /class="kptu-act kptu-act-danger" data-nx-sel-delete/);
  assert.match(html, /id="librarySelectDelete" class="lu-select-act kptu-act kptu-act-danger"/);
});

test('화면 CSS는 줄 자리·바탕만 — 버튼 모양을 따로 두지 않는다(경쟁 규칙 없음)', () => {
  assert.doesNotMatch(noComments(read('photos.css')), /\.photos-act button/);
  assert.doesNotMatch(noComments(read('diary.css')), /\.diary-viewer-actions button\{/);
  assert.doesNotMatch(noComments(read('library-upload.css')), /\.lu-select-act\{/);
  // 정리함 기본 버튼 모양(ui-standard.css)은 고르기 칸에 쓰지 않는다.
  assert.match(read('ui-standard.css'), /#appView #basketView :is\(button:not\([^)]*\.kptu-act,/);
});
