// LIB-편집열기느림: 열기 단계별 시간 글과, 자료실 검색 [결과 n개 모두 선택](SEARCH-선택옮기기 ⑤) 연결을 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openTimingText} from '../app/hwp-open-timing.mjs';

test('3초 안에 열리면 시간 글을 붙이지 않는다', () => {
  assert.equal(openTimingText({file: 500, editor: 800, load: 300, total: 1200}), '');
  assert.equal(openTimingText({}), '');
});
test('오래 걸리면 단계별 초와 전체 초를 보인다', () => {
  assert.equal(openTimingText({file: 1200, editor: 45000, load: 2500, total: 48000}), ' (걸린 시간: 파일 1.2초 · HWP 편집 45.0초 · 펼침 2.5초 · 전체 48.0초)');
});
test('빠진 단계는 건너뛴다', () => {
  assert.equal(openTimingText({editor: 4000, total: 4200}), ' (걸린 시간: HWP 편집 4.0초 · 전체 4.2초)');
});
// S70-54 UI-검색창하나로: 찾기 칸은 맨 위 칸이 겸하므로 [결과 n개 모두 선택]은 그 오른쪽 맨 위 줄 단추 자리(luTools) 맨 앞.
// S71-07 SEARCH-누른자리그대로(Q3): 단추는 맨 위 찾기 칸 옆이 아니라 본문 첫 줄 [폴더 ▾][분류 ▾] 끝 — 치는 동안 찾기 칸 폭이 그대로(E2E 'Q3 자료실 …').
test('자료실 검색 결과 모두 고르기 버튼이 본문 첫 줄 고르기 줄 끝에 연결돼 있다(맨 위 찾기 칸을 좁히지 않음)', () => {
  const js = readFileSync(new URL('../app/library-upload.js', import.meta.url), 'utf8');
  assert.match(js, /luSyncSearchPickAll\(q,matches\)/);
  assert.match(js, /결과 \$\{luSearchPickIds\.length\}개 모두 선택/);
  assert.match(js, /const row=document\.querySelector\('#libraryView \.lu-pick-row'\)\|\|luTools;/);
  assert.match(js, /row\.append\(button\)/);
});
