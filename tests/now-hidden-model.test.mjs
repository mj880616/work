import test from 'node:test';
import assert from 'node:assert/strict';
import {hiddenEntries, withoutEntry, HIDDEN_LIMIT, UNHIDE_LABEL, HIDDEN_TITLE} from '../app/now-hidden-model.mjs';
// S70-62 READ-밀기메뉴 [숨긴 글]: 뉴스 hidden_at · 사회운동 관심 없음 두 쪽을 합쳐 최근 숨긴 것 먼저. 내가 넣은 기사(삭제도 숨김 칸)는 뺀다.

test('두 쪽을 합쳐 최근 숨긴 것 먼저, 같은 글은 한 줄', () => {
  const news = [{id: 'n1', hidden_at: '2026-11-25T01:00:00Z'}, {id: 'n2', hidden_at: '2026-11-25T03:00:00+09:00'}, {id: 'n1', hidden_at: '2026-11-25T01:00:00Z'}];
  const outside = [{row: {id: 'o1'}, at: '2026-11-25T02:00:00Z'}];
  // n2의 '+09:00'은 UTC로 전날 18시라 맨 뒤(글자 순서가 아니라 시각 순서).
  assert.deepEqual(hiddenEntries({news, outside}).map(e => e.key), ['outside:o1', 'news:n1', 'news:n2']);
});

test('숨김 시각이 없는 줄·글을 못 읽은 줄·내가 넣은 기사는 빼고, 개수는 한도까지', () => {
  const news = [{id: 'a', hidden_at: null}, {id: 'b', hidden_at: '2026-11-25T00:00:00Z', origin: 'user'}, {id: 'c', hidden_at: '2026-11-25T00:00:00Z'}];
  const outside = [{row: null, at: '2026-11-25T00:00:00Z'}, {row: {id: 'o'}, at: null}];
  assert.deepEqual(hiddenEntries({news, outside}, {mine: r => r.origin === 'user'}).map(e => e.key), ['news:c']);
  const many = Array.from({length: HIDDEN_LIMIT + 5}, (_, i) => ({id: 'x' + i, hidden_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()}));
  const got = hiddenEntries({news: many});
  assert.equal(got.length, HIDDEN_LIMIT);
  assert.equal(got[0].id, 'x' + (HIDDEN_LIMIT + 4));
  assert.deepEqual(hiddenEntries(), []);
});

test('다시 보이기 뒤 그 줄만 빠진다 · 화면 글자', () => {
  const list = hiddenEntries({news: [{id: 'a', hidden_at: '2026-11-25T00:00:00Z'}, {id: 'b', hidden_at: '2026-11-24T00:00:00Z'}]});
  assert.deepEqual(withoutEntry(list, 'news:a').map(e => e.id), ['b']);
  assert.equal(UNHIDE_LABEL, '다시 보이기');
  assert.equal(HIDDEN_TITLE, '숨긴 글');
});
