// NEWS-도배막기(A + C): 같은 매체 묶음·관심 주제 위 칸 계산과 묶음 그리기.
import test from 'node:test';
import assert from 'node:assert/strict';
import {foldSrc, foldRuns, liftRelated, LIFT_HOURS} from '../app/news-fold.mjs';
import {runsHtml} from '../app/news-row.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const n = (id, source_key, publisher = '') => ({type: 'news', row: {id, source_key, publisher}});
const o = (id, source_key) => ({type: 'outside', row: {id, source_key}});

test('묶음 기준: 언론 기사만 매체 키, 사회운동 글·매체 모름은 묶지 않음', () => {
  assert.equal(foldSrc('news', {source_key: 'news-a'}), 'k:news-a');
  assert.equal(foldSrc('news', {source_key: null, publisher: ' 가 매체 '}), 'p:가 매체');
  assert.equal(foldSrc('news', {}), '');
  assert.equal(foldSrc('outside', {source_key: 'kctu'}), '');
});

test('같은 매체가 연달아 나오면 한 묶음, 순서는 그대로', () => {
  const runs = foldRuns([n(1, 'a'), n(2, 'a'), n(3, 'a'), n(4, 'b'), o(5, 's'), o(6, 's'), n(7, 'a'), n(8, null), n(9, null)]);
  assert.deepEqual(runs.map(r => [r.lead.row.id, r.more.map(e => e.row.id)]), [[1, [2, 3]], [4, []], [5, []], [6, []], [7, []], [8, []], [9, []]]);
  assert.deepEqual(foldRuns([]), []);
});

test('관심 주제 위 칸: 걸린 최근 글만, 시간순 그대로', () => {
  const now = Date.parse('2026-11-10T00:00:00Z');
  const e = (id, h, hit) => ({id, at: now - h * 3600000, hit});
  const list = [e(1, 1, false), e(2, 2, true), e(3, 5, true), e(4, LIFT_HOURS + 1, true), {id: 5, at: NaN, hit: true}];
  const {top, rest} = liftRelated(list, x => x.hit, x => x.at, now);
  assert.deepEqual(top.map(x => x.id), [2, 3]);
  assert.deepEqual(rest.map(x => x.id), [1, 4, 5]);
});

test('묶음 그리기: 첫 줄 + 작게 "○○ 외 N건", 펼침 기억은 open으로', () => {
  const runs = foldRuns([n('x', 'a'), n('y', 'a'), n('z', 'a'), n('w', 'b')]);
  const opt = open => ({rowOf: e => `<article data-id="${e.row.id}"></article>`, keyOf: e => `news:${e.row.id}`, nameOf: () => '가<매체>', isOpen: k => open.has(k)});
  const closed = runsHtml(runs, opt(new Set()), esc);
  assert.match(closed, /^<article data-id="x"><\/article><details class="nw-fold" data-nw-fold="fold:news:x"><summary class="nw-fold-sum">가&lt;매체&gt; 외 2건<i class="kptu-chev" aria-hidden="true"><\/i><\/summary><article data-id="y"><\/article><article data-id="z"><\/article><\/details><article data-id="w"><\/article>$/);
  assert.match(runsHtml(runs, opt(new Set(['fold:news:x'])), esc), /<details class="nw-fold" data-nw-fold="fold:news:x" open>/);
});
