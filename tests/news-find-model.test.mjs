// S63-11 News 서버 찾기·탭 맞춤·사회운동 국제 묶음 계산(순수 함수). 네트워크 없음, 가짜 글만.
import test from 'node:test';
import assert from 'node:assert/strict';
import {findWords, ilikeAny, sinceIso, mergeFound, findTab, FIND_DAYS, FIND_EMPTY, FIND_SHORT} from '../app/news-find-model.mjs';
import {tabForItem, titlePending} from '../app/now-model.mjs';
import {intlSplitOn, splitIntl, intlKeys, INTL_LABEL} from '../app/outside-statements-model.mjs';

test('찾는 말: 뜻 있는 글자(* % _ \\ ")는 빼고 낱말로, 두 글자부터', () => {
  assert.deepEqual(findWords('  철도  파업 '), ['철도', '파업']);
  assert.deepEqual(findWords('a*b%c_d"e\\f'), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(findWords('철'), null);
  assert.equal(findWords('**'), null);
  assert.equal(findWords(''), null);
  assert.equal(findWords('a b c d e f g h i j').length, 8);
});

test('서버 거르기 글자: 칸마다 ilike, 낱말은 순서대로 이어 찾기, 큰따옴표로 감쌈(쉼표·괄호도 안전)', () => {
  assert.equal(ilikeAny(['title', 'summary'], ['철도', '파업']), '(title.ilike."*철도*파업*",summary.ilike."*철도*파업*")');
  assert.equal(ilikeAny(['title'], ['a,b(c)']), '(title.ilike."*a,b(c)*")');
});

test('기간·합치기·탭', () => {
  assert.equal(sinceIso(Date.parse('2026-11-16T00:00:00Z')), '2026-10-17T00:00:00.000Z');
  assert.equal(FIND_DAYS, 30);
  const at = r => Date.parse(r.t);
  const out = mergeFound([{id: 'a', t: '2026-11-10'}, {id: 'b', t: '2026-11-12'}], [{id: 'a', t: '2026-11-10'}, {id: 'c', t: '2025-01-01'}, null, {id: 'd', t: ''}], at);
  assert.deepEqual(out.map(r => r.id), ['b', 'a', 'c', 'd']);
  assert.ok(findTab('all') && findTab('media') && !findTab('movement') && !findTab('archive') && !findTab('marks'));
  assert.match(FIND_EMPTY, /없어요$/); assert.match(FIND_SHORT, /^2글자/);
});

test('주소 ?item= 글의 탭: 전체·보관·밑줄은 그대로, 사회운동↔언론은 글 종류에 맞춤', () => {
  assert.equal(tabForItem('outside', 'media'), 'movement');
  assert.equal(tabForItem('news', 'movement'), 'media');
  assert.equal(tabForItem('news', 'media'), 'media');
  for (const t of ['all', 'archive', 'marks']) { assert.equal(tabForItem('news', t), t); assert.equal(tabForItem('outside', t), t); }
  assert.equal(tabForItem('outside', ''), 'all');
});

test('읽기 전 줄: state pending만', () => {
  assert.equal(titlePending({state: 'pending'}), true);
  assert.equal(titlePending({state: 'ok'}), false);
  assert.equal(titlePending(null), false);
});

test("사회운동 국제 묶음: 카탈로그 묶음 foreign 글만 아래로, [매체 ▾]에서 국제를 고르면 나누지 않음", () => {
  const cat = [{key: 'kctu', group: 'labor'}, {key: 'jacobin', group: 'foreign'}, {key: 'sw', group: 'foreign'}];
  assert.equal(INTL_LABEL, '국제');
  assert.deepEqual([...intlKeys(cat)], ['jacobin', 'sw']);
  const posts = [{id: 1, source_key: 'jacobin'}, {id: 2, source_key: 'kctu'}, {id: 3, source_key: 'sw'}, {id: 4, source_key: 'kctu'}];
  const {home, intl} = splitIntl(posts, cat);
  assert.deepEqual(home.map(p => p.id), [2, 4]);
  assert.deepEqual(intl.map(p => p.id), [1, 3]);
  assert.equal(intlSplitOn('all', cat), true);
  assert.equal(intlSplitOn('g:labor', cat), true);
  assert.equal(intlSplitOn('g:foreign', cat), false);
  assert.equal(intlSplitOn('s:jacobin', cat), false);
  assert.equal(intlSplitOn('s:kctu', cat), true);
});
