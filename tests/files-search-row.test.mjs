import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// S62-40 UI-파일검색줄(시안 #2691 B안): [파일] 맨 위 줄의 [두 칸 보기]는 공용 ⑥ 아이콘 단추, 이름은 늘 '두 칸 보기', 켜짐은 aria-pressed.
// 배치(412px에서 찾기와 같은 줄)는 화면 시험 tests/app-e2e/files-search-row.spec.mjs가 본다.
const js = readFileSync(new URL('../app/files.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/files.css', import.meta.url), 'utf8');

test('[두 칸 보기]는 아이콘 단추(icon-btn) · 이름 고정 · aria-pressed', () => {
  const btn = js.match(/<button [^>]*data-fx-two[^>]*>[^<]*<\/button>|<button [^>]*data-fx-two[^>]*>\$\{TWO_SVG\}<\/button>/)?.[0] || '';
  assert.match(btn, /class="icon-btn fx-two"/);
  assert.match(btn, /aria-label="두 칸 보기"/);
  assert.match(btn, /aria-pressed="false"/);
  assert.match(btn, /\$\{TWO_SVG\}/);
  assert.match(js, /tw\.setAttribute\('aria-pressed', String\(!!twoNow\)\)/);
  // 글자 바꾸기('한 칸 보기')로 켜짐을 알리던 옛 길은 없다(그리는 곳 하나).
  assert.doesNotMatch(js, /'한 칸 보기'/);
});

test('폰 맨 위 줄: 찾기 칸이 [두 칸 보기] 자리만큼 비켜 같은 줄', () => {
  assert.match(css, /\.fx-search \{ flex:1 1 calc\(100% - 164px\);/);
  assert.match(css, /\.fx-two \{ flex:none; width:28px; height:28px;/);
  assert.match(css, /\.fx-two\[aria-pressed="true"\]/);
  assert.doesNotMatch(css, /\.fx-two(\[aria-pressed[^\]]*\])? \{[^}]*display:none/);
});
