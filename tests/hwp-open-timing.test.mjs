// LIB-편집열기느림: 열기 단계별 시간 글과, 자료실 검색 [결과 n개 모두 고르기](SEARCH-선택옮기기 ⑤) 연결을 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openTimingText} from '../app/hwp-open-timing.mjs';

test('3초 안에 열리면 시간 글을 붙이지 않는다', () => {
  assert.equal(openTimingText({file: 500, editor: 800, load: 300, total: 1200}), '');
  assert.equal(openTimingText({}), '');
});
test('오래 걸리면 단계별 초와 전체 초를 보인다', () => {
  assert.equal(openTimingText({file: 1200, editor: 45000, load: 2500, total: 48000}), ' (걸린 시간: 파일 1.2초 · 편집기 45.0초 · 펼침 2.5초 · 전체 48.0초)');
});
test('빠진 단계는 건너뛴다', () => {
  assert.equal(openTimingText({editor: 4000, total: 4200}), ' (걸린 시간: 편집기 4.0초 · 전체 4.2초)');
});
test('자료실 검색 결과 모두 고르기 버튼이 검색칸 옆에 연결돼 있다', () => {
  const js = readFileSync(new URL('../app/library-upload.js', import.meta.url), 'utf8');
  assert.match(js, /luSyncSearchPickAll\(q,matches\)/);
  assert.match(js, /결과 \$\{luSearchPickIds\.length\}개 모두 고르기/);
  assert.match(js, /input\.after\(button\)/);
});
