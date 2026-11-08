// S53-5 NEWS-밑줄모으기: 고른 글(밑줄) 순수 계산 — 자리 찾기·겹침·노트 글·DB 규칙과 같은 제한.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanQuote, tooLong, cleanMemo, edgesOf, cleanSource, highlightBody, locate, markRanges, noteOf, copyOf, hlHit, sourceLine, QUOTE_MAX, EDGE} from '../app/text-highlights-model.mjs';
const WS = '21000000-0000-4000-8000-000000000001', ID = '31000000-0000-4000-8000-000000000001';

test('quote cleaning keeps paragraphs and refuses empty or too long', () => {
  assert.equal(cleanQuote('  첫 문단  글 \n\n\n\n 둘째  '), '첫 문단 글\n\n둘째');
  assert.equal(cleanQuote('   '), '');
  assert.equal(cleanQuote('가'.repeat(QUOTE_MAX + 1)), '');
  assert.equal(tooLong('가'.repeat(QUOTE_MAX + 1)), true);
  assert.equal(cleanMemo('  '), null);
  assert.equal(cleanMemo('메모'.repeat(2000)).length, 2000);
});

test('edges are at most 60 letters on each side', () => {
  const full = 'ㄱ'.repeat(100) + '고른' + 'ㄴ'.repeat(100);
  const e = edgesOf(full, 100, 102);
  assert.equal(e.prefix.length, EDGE); assert.equal(e.suffix.length, EDGE);
  assert.deepEqual(edgesOf('abc', 0, 3), {prefix: '', suffix: ''});
});

test('source and body follow the database checks', () => {
  assert.equal(cleanSource({type: 'mail', id: ID}), null);
  assert.equal(cleanSource({type: 'news', id: 'x'}), null);
  const s = cleanSource({type: 'news', id: ID, title: '제목\n줄', media: '매체', date: '2026-11-07T01:00:00Z', url: 'javascript:alert(1)'});
  assert.deepEqual(s, {type: 'news', id: ID, title: '제목 줄', media: '매체', date: '2026-11-07T01:00:00.000Z', url: null});
  const b = highlightBody(WS, {type: 'outside', id: ID, url: 'https://e.org/a'}, ' 고른 글 ', {prefix: 'p'.repeat(80), suffix: 's'.repeat(80)}, ' 메모 ');
  assert.equal(b.quote, '고른 글'); assert.equal(b.quote_prefix.length, EDGE); assert.equal(b.quote_suffix.length, EDGE); assert.equal(b.memo, '메모');
  assert.deepEqual(Object.keys(b).sort(), ['memo', 'quote', 'quote_prefix', 'quote_suffix', 'source_date', 'source_id', 'source_media', 'source_title', 'source_type', 'source_url', 'workspace_id']);
  assert.equal(highlightBody('nope', {type: 'news', id: ID}, 'x'), null);
  assert.equal(highlightBody(WS, {type: 'news', id: ID}, '  '), null);
});

test('locate ignores spacing and picks the copy whose edges match', () => {
  const full = '첫 문단 글.둘째 문단 권력의 냉소와 부정의.셋째 권력의 냉소와 부정의 끝';
  const r = locate(full, {quote: '권력의 냉소와\n부정의'});
  assert.equal(full.slice(r.start, r.end), '권력의 냉소와 부정의');
  assert.equal(r.start, full.indexOf('권력'));
  const r2 = locate(full, {quote: '권력의 냉소와 부정의', quote_prefix: '셋째 ', quote_suffix: ' 끝'});
  assert.equal(r2.start, full.lastIndexOf('권력'));
  assert.equal(locate(full, {quote: '없는 글'}), null, 'changed original: no mark, the saved quote stays');
});

test('overlapping marks: the first in list order wins', () => {
  const full = '하나 둘 셋 넷';
  const m = markRanges(full, [{id: 'a', quote: '둘 셋'}, {id: 'b', quote: '셋 넷'}, {id: 'c', quote: '하나'}]);
  assert.deepEqual(m.map(x => x.id), ['c', 'a']);
});

test('note, copy and search text carry quote, memo and source', () => {
  const h = {quote: '한 줄\n둘째 줄', memo: '생각', source_media: '매체', source_date: '2026-11-06T16:00:00Z', source_title: '글 제목', source_url: 'https://e.org/a'};
  assert.equal(sourceLine(h), '매체 · 2026-11-07 · 글 제목', 'date is the Seoul day');
  const n = noteOf([h, {...h, memo: null, quote: '다른 것'}]);
  assert.match(n.title, /^밑줄 2개 · 글 제목/);
  assert.match(n.raw_text, /> 한 줄\n> 둘째 줄\n\n메모: 생각\n\n출처: 매체 · 2026-11-07 · 글 제목\nhttps:\/\/e\.org\/a/);
  assert.equal(noteOf([]), null);
  assert.equal(copyOf(h), '한 줄\n둘째 줄\n\n매체 · 2026-11-07 · 글 제목\n\nhttps://e.org/a');
  assert.equal(hlHit(h, '생 각'), true); assert.equal(hlHit(h, '둘째줄'), true); assert.equal(hlHit(h, '없음'), false); assert.equal(hlHit(h, ''), true);
});
