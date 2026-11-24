import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// S62-40 UI-파일검색줄(시안 #2691 B안) → S69-38 FILES-보기두칸(명진 11/24 '오른쪽 위 두 칸 아이콘을 자료실과 같은 붙은 버튼으로'):
// [파일] 맨 위 줄의 보기 단추는 자료실과 같은 붙은 [한 칸 | 두 칸](공용 ⑤ ds-seg). 지금 보기 쪽이 aria-pressed, 그리는 곳 하나.
// 배치(412px에서 찾기와 같은 줄)는 화면 시험 tests/app-e2e/files-search-row.spec.mjs가 본다.
const js = readFileSync(new URL('../app/files.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/files.css', import.meta.url), 'utf8');

test('[한 칸 | 두 칸]은 붙은 ds-seg 단추 둘 · 이름 고정 · 지금 보기 쪽 aria-pressed', () => {
  const seg = js.match(/<span class="ds-seg fx-view-seg"[^]*?<\/span><\/span>/)?.[0] || '';
  assert.match(seg, /role="group"/);
  assert.match(seg, /<button type="button" class="ds-seg-btn" data-fx-one aria-pressed="true" aria-label="한 칸 보기"/);
  assert.match(seg, /<button type="button" class="ds-seg-btn" data-fx-two aria-pressed="false" aria-label="두 칸 보기"/);
  assert.match(seg, /\$\{ONE_SVG\}/);
  assert.match(seg, /\$\{TWO_SVG\}/);
  assert.match(js, /setAttribute\('aria-pressed', String\(!twoNow\)\)/);
  assert.match(js, /setAttribute\('aria-pressed', String\(!!twoNow\)\)/);
  // 눌린 쪽을 다시 눌러도 바뀌지 않는다(고르기만).
  assert.match(js, /if \(two\(\) !== want\) setTwo\(want\)/);
  assert.doesNotMatch(js, /class="icon-btn fx-two"/);
});

test('폰 맨 위 줄: 찾기 칸이 보기 단추 자리만큼 비켜 같은 줄, 폰은 그림만', () => {
  assert.match(css, /\.fx-search \{ flex:1 1 calc\(100% - 220px\); width:auto; min-width:0;/);
  assert.match(css, /\.fx-view-seg \.fx-seg-t \{ display:none; \}/);
  assert.match(css, /\.fx-view-seg \{ order:2; \}/);
  assert.doesNotMatch(css, /\.fx-view-seg \{[^}]*display:none/);
});
