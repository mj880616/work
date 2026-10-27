// TG-원문폰배치: 폰에서 텔레그램 원문 메시지를 '시각 · 이름' 한 줄 아래 화면 폭 전체로, 긴 글은 6줄로 접고 [더보기].
// 순수 규칙(접기 후보)과 화면·CSS의 약속을 글자로 확인한다. 메시지 글은 가짜 값만 쓴다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {rawFoldable, rawMoreKey, RAW_FOLD_LINES, RAW_FOLD_CHARS} from '../app/tg-day-model.mjs';

const css = readFileSync(new URL('../app/feed.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../app/telegram-feed.js', import.meta.url), 'utf8');
const phone = (() => { const i = css.indexOf('TG-원문폰배치'); return css.slice(i); })();

test('접기 후보: 6줄 이하 짧은 글은 접지 않는다', () => {
  assert.equal(RAW_FOLD_LINES, 6);
  assert.equal(rawFoldable(''), false);
  assert.equal(rawFoldable(null), false);
  assert.equal(rawFoldable('가나다'), false);
  assert.equal(rawFoldable(Array(6).fill('줄').join('\n')), false);
  assert.equal(rawFoldable('가'.repeat(RAW_FOLD_CHARS * 6)), false);
});

test('접기 후보: 줄바꿈 7줄 이상이거나 폰 폭으로 셈해 6줄을 넘으면 접는다', () => {
  assert.equal(rawFoldable(Array(7).fill('줄').join('\n')), true);
  assert.equal(rawFoldable('가'.repeat(RAW_FOLD_CHARS * 6 + 1)), true);
  assert.equal(rawFoldable(['가'.repeat(RAW_FOLD_CHARS * 3), '나'.repeat(RAW_FOLD_CHARS * 3 + 1)].join('\n')), true);
});

test('펼친 상태 열쇠는 소식 ID와 줄 순서', () => {
  assert.equal(rawMoreKey('r1', 0), 'r1:0');
  assert.notEqual(rawMoreKey('r1', 1), rawMoreKey('r2', 1));
});

test('화면: 접기 단추·펼친 상태는 메모리(state.more)에만, 방·날을 바꾸면 비운다', () => {
  assert.match(js, /data-tg-rt-more=/);
  assert.match(js, /aria-expanded="\$\{more\}"/);
  assert.match(js, /more:new Set\(\)/);
  assert.equal((js.match(/state\.more = new Set\(\)/g) || []).length, 3);
  assert.match(js, /fitRawFolds\(box\)/);
});

test('CSS: 폰(760px 이하)에서만 위 한 줄 + 폭 전체, PC는 단추 없음', () => {
  assert.match(css, /\.feed-view \.feed-rt-more\{display:none\}/);
  assert.match(phone, /@media\(max-width:760px\)\{/);
  assert.match(phone, /\.feed-rm \.feed-rt\{flex:1 0 100%\}/);
  assert.match(phone, /-webkit-line-clamp:6/);
  assert.match(phone, /\.feed-di-row>\.feed-at\{flex:1 0 100%/);
  assert.match(phone, /\.feed-di>\.feed-raw[^{]*\{margin-left:0\}/);
  assert.match(phone, /\.feed-script p\{flex-direction:column/);
  assert.doesNotMatch(phone, /min-width:761px/);
});
