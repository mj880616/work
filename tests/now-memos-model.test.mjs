import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MEMO_PAGE, MEMO_KEY, memoTarget, memoLine, memoPage, memoEntries, memoHit} from '../app/now-memos-model.mjs';
import {rowHtml} from '../app/news-row.mjs';
import {tabForItem} from '../app/now-model.mjs';
// S69-70(사용자 11/24 20:43~20:45): 읽을 거리 [메모] 탭(메모 있는 글)과 '관심 주제 후보'를 ⋯ 메뉴 안으로.
const N = 'b1000000-0000-4000-8000-000000000001', P = 'a1000000-0000-4000-8000-000000000001', P2 = 'a1000000-0000-4000-8000-000000000002';
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

test('메모 노트 → 메모한 글(뉴스 열쇠 먼저, uuid만)', () => {
  assert.deepEqual(MEMO_KEY, {news: 'news_item_id', outside: 'outside_post_id'});
  assert.deepEqual(memoTarget({metadata: {news_item_id: N}}), {type: 'news', id: N});
  assert.deepEqual(memoTarget({metadata: {outside_post_id: P}}), {type: 'outside', id: P});
  assert.deepEqual(memoTarget({metadata: {news_item_id: N, outside_post_id: P}}), {type: 'news', id: N});
  for (const m of [null, [], {}, {news_item_id: 'x'}, {outside_post_id: 3}, 'text']) assert.equal(memoTarget({metadata: m}), null);
  assert.equal(memoTarget(null), null);
});

test('메모 첫 줄: 빈 줄 건너뜀·빈칸 정리·80자, 글자가 없으면 노트 제목', () => {
  assert.equal(memoLine({raw_text: '\n\n  첫  줄 \n둘째 줄'}), '첫 줄');
  assert.equal(memoLine({raw_text: '', title: '제목만'}), '제목만');
  assert.equal(memoLine({}), '');
  const long = memoLine({raw_text: '가'.repeat(100)});
  assert.equal([...long].length, 80);
  assert.ok(long.endsWith('…'));
});

test('한 쪽 = 1000줄, 1001번째가 오면 이어 읽기', () => {
  assert.equal(MEMO_PAGE, 1000);
  const rows = Array.from({length: 3}, (_, i) => ({id: 'n' + i, metadata: {outside_post_id: P}}));
  assert.deepEqual(memoPage(rows, 2), {rows: rows.slice(0, 2), end: false});
  assert.deepEqual(memoPage(rows.slice(0, 2), 2), {rows: rows.slice(0, 2), end: true});
  assert.deepEqual(memoPage(null), {rows: [], end: true});
  assert.equal(memoPage([{id: 'x', metadata: {}}]).rows.length, 0, '글 열쇠 없는 노트는 뺀다');
});

test('줄: 최근 고친 메모 먼저, 같은 글은 한 줄(옛 id도 공용 id로 합침), 글이 없으면 row null', () => {
  const notes = [
    {id: 'n1', updated_at: '2026-11-20T00:00:00Z', raw_text: '옛 메모', metadata: {outside_post_id: 'c1000000-0000-4000-8000-000000000009'}},
    {id: 'n2', updated_at: '2026-11-24T00:00:00Z', raw_text: '새 메모', metadata: {outside_post_id: P}},
    {id: 'n3', updated_at: '2026-11-22T00:00:00Z', raw_text: '뉴스 메모', metadata: {news_item_id: N}},
    {id: 'n4', updated_at: '2026-11-23T00:00:00Z', raw_text: '지운 글 메모', metadata: {outside_post_id: P2}},
  ];
  const idOf = (t, id) => (id.startsWith('c1') ? P : id);
  const rows = {[`outside:${P}`]: {id: P, title: '성명'}, [`news:${N}`]: {id: N, title: '기사'}};
  const out = memoEntries(notes, {idOf, articleOf: (t, id) => rows[`${t}:${id}`]});
  assert.deepEqual(out.map(e => [e.key, e.note.id, e.row?.title ?? null]), [[`outside:${P}`, 'n2', '성명'], [`outside:${P2}`, 'n4', null], [`news:${N}`, 'n3', '기사']]);
});

test('찾기: 글 제목·한국어 제목·메모 글자에서, 띄어쓰기 무시', () => {
  const e = {row: {title: 'An Article', title_ko: '가상 글'}, note: {raw_text: '철도 민영화 메모', title: '노트'}};
  assert.ok(memoHit(e, ''));
  assert.ok(memoHit(e, '철도민영화'));
  assert.ok(memoHit(e, '가상'));
  assert.ok(memoHit(e, 'article'));
  assert.ok(!memoHit(e, '없는말'));
  assert.ok(memoHit({row: null, note: {raw_text: '메모만'}}, '메모'));
});

test('글 줄에 메모 첫 줄(작게, esc), 없으면 그 칸 없음', () => {
  const base = {key: `outside:${P}`, openAttr: 'data-nm-open', openId: P, title: '제목', src: '단체', color: 'x', tag: '', time: '', read: null};
  assert.match(rowHtml({...base, memo: '<b>메모</b>'}, esc), /<p class="nw-memo"><span class="nm-k">메모<\/span>&lt;b&gt;메모&lt;\/b&gt;<\/p>/);
  assert.doesNotMatch(rowHtml(base, esc), /nw-memo/);
});

test('주소로 다시 연 글은 [메모] 탭 그대로(두 종류를 다 담음)', () => {
  assert.equal(tabForItem('news', 'memos'), 'memos');
  assert.equal(tabForItem('outside', 'memos'), 'memos');
});

test('관심 주제 후보는 목록 위 줄이 아니라 ⋯ 메뉴 안 한 줄(0개면 없음)', () => {
  const src = readFileSync(new URL('../app/outside-statements.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /data-now-cand/);
  assert.doesNotMatch(src, /data-now-interests-open/);
  assert.match(src, /const candidatesItem = \(\) => \{ const n = interests\.candidates\(\); return n \? `<button type="button" data-os-act="interests" data-os-cand>관심 주제 후보 \$\{n\}<\/button>` : ''; \};/);
});
