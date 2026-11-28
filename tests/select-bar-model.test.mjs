// UI-고르기막대(S69-85, 명진 11/25 00:37~00:42 "두줄로 삐져나오지 않게 … 좀더 세련되게"): 공용 고르기 막대의 순수 부분(단추 HTML·접는 차례)과
// 막대 모양 규칙 한 곳(base-ui.css .kptu-selbar)을 본다. 실제 폭에서 한 줄인지는 tests/app-e2e/select-bar-one-line.spec.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sbActHtml, sbCloseHtml, sbIconHtml, foldOrder, SB_ICON } from '../app/select-bar-model.mjs';

const read = f => readFileSync(new URL(`../app/${f}`, import.meta.url), 'utf8');
const noComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

test('단추: 글자 버튼(ghost) + 선 아이콘(글자색) + 짧은 글자, 화면의 data-* 그대로, 휴지통은 경고 표시만', () => {
  const b = sbActHtml({ attrs: 'data-fx-copy', icon: 'copy', label: '복사', rank: 5 });
  assert.match(b, /^<button type="button" class="ghost kptu-sb-act" data-fx-copy data-sb-icon="copy" data-sb-rank="5" title="복사">/);
  assert.match(b, /<span class="kptu-act-ic" aria-hidden="true"><svg [^>]*stroke="currentColor"/);
  assert.match(b, /<span class="kptu-act-tx">복사<\/span><\/button>$/);
  assert.match(sbActHtml({ attrs: 'data-x', icon: 'trash', label: '휴지통', danger: true }), /class="ghost kptu-sb-act kptu-sb-danger"/);
  assert.match(sbActHtml({ label: '분류 바꾸기', more: true }), / data-sb-more /);
  assert.doesNotMatch(sbActHtml({ label: '글자만' }), /kptu-act-ic/);
  assert.match(sbActHtml({ label: '<&>' }), /&lt;&amp;&gt;/);
  const x = sbCloseHtml('data-fx-unpick');
  assert.match(x, /class="ghost kptu-sb-act kptu-sb-close" data-fx-unpick aria-label="선택 풀기" title="선택 풀기"/);
  for (const k of ['copy', 'move', 'tolib', 'rename', 'star', 'trash', 'color', 'up', 'down', 'close', 'all', 'paste', 'send']) assert.ok(SB_ICON[k], k);
  assert.match(sbIconHtml('more'), /<circle/);
});

test('접는 차례: rank 큰 것부터, 같으면 뒤의 것부터, 닫기·늘 ⋯ 안은 빼고, 휴지통은 맨 마지막', () => {
  const items = [
    { i: 0, keep: true }, { i: 1, rank: 5 }, { i: 2, rank: 10 }, { i: 3, rank: 30 }, { i: 4, rank: 40 }, { i: 5, rank: 20 },
    { i: 6, more: true }, { i: 7, danger: true },
  ];
  assert.deepEqual(foldOrder(items), [4, 3, 5, 2, 1, 7]);
  assert.deepEqual(foldOrder([{ i: 0 }, { i: 1 }, { i: 2 }]), [2, 1, 0]);
  assert.deepEqual(foldOrder(null), []);
});

test('모양 한 곳: 늘 한 줄(nowrap·고정 높이), 단추 테두리·바탕 없음, 휴지통은 글자색만 경고색, 색은 테마 변수만', () => {
  const css = noComments(read('base-ui.css'));
  const bar = css.match(/\.kptu-selbar\{[^}]*\}/)[0];
  assert.match(bar, /flex-wrap:nowrap/);
  assert.match(bar, /height:var\(--kptu-selbar-h,36px\)/);
  assert.match(bar, /overflow:hidden/);
  assert.match(bar, /background:var\(--kptu-primary-soft\)/);
  const btn = css.match(/:is\(#appView,\.modal\) \.kptu-selbar button\.kptu-sb-act\{[^}]*\}/)[0];
  assert.match(btn, /border:0;/);
  assert.match(btn, /background:transparent/);
  assert.match(btn, /white-space:nowrap/);
  assert.match(css, /:is\(#appView,\.modal\) \.kptu-selbar button\.kptu-sb-danger\{color:var\(--kptu-danger\)\}/);
  const all = (css.match(/[^{}]*kptu-s[eb][^{}]*\{[^}]*\}/g) || []).join('\n');
  assert.doesNotMatch(all, /#[0-9a-f]{3,8}\b|rgb\(/i, '하드코딩 색 없음');
  // 화면 CSS는 자리만 — 막대 모양(줄바꿈·바탕·테두리)을 따로 두지 않는다.
  assert.doesNotMatch(noComments(read('files.css')), /\.fx-bar\s*\{[^}]*flex-wrap/);
  assert.doesNotMatch(noComments(read('files.css')), /\.fx-bar:has/);
  assert.doesNotMatch(noComments(read('library-upload.css')), /\.lu-select-bar\{[^}]*flex-wrap/);
  assert.doesNotMatch(noComments(read('basket.css')), /\.nx-select-bar[^{]*\{[^}]*(border|background)/);
  assert.doesNotMatch(noComments(read('photos.css')), /\.photos-sel\{[^}]*background/);
});

test('쓰는 곳: 파일·자료실·노트·사진 위 막대가 같은 부품을 쓰고 그린 뒤 맞춘다', () => {
  const files = read('files.js'), lib = read('library-upload.js'), notes = read('basket-notes.js'), photos = read('photos.js'), html = read('index.html');
  assert.match(files, /function paintBar\(\) \{ return keepFxMenus\(\(\) => \{ paintBarNow\(\); fitSelectBar\(\$\('\[data-fx-bar\]'\)\); \}\); \}/);
  assert.match(lib, /function luSyncPicks\(\)\{luSyncPicksNow\(\);fitSelectBar\(document\.querySelector\('#librarySelectBar'\)\)\}/);
  assert.match(notes, /function paintSelectBar\(\) \{ paintSelectBarNow\(\); fitSelectBar\(host\.querySelector\('\[data-nx-select-bar\]'\)\); \}/);
  assert.match(photos, /class="photos-sel kptu-selbar"/);
  // 자료실 한꺼번에 바꾸기 셋은 늘 ⋯ 안(살릴 것 1).
  for (const k of ['project', 'organization', 'category']) assert.match(html, new RegExp(`data-lu-bulk="${k}"[^>]*data-sb-more`));
  // 예전 테두리 상자 단추(secondary)·꽉 찬 빨강(danger)·오른쪽 끝 ✕는 고르기 막대에 없다.
  const bar = files.slice(files.indexOf('function paintBarNow()'), files.indexOf('function paintPicks('));
  assert.doesNotMatch(bar, /class="(secondary|danger)"/);
  assert.doesNotMatch(bar, />✕</);
});
