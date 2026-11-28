// S53-5 NEWS-밑줄모으기: 고른 글(밑줄) 순수 계산 — 자리 찾기·겹침·노트 글·DB 규칙과 같은 제한.
import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanQuote, tooLong, cleanMemo, edgesOf, cleanSource, highlightBody, locate, markRanges, noteOf, copyOf, hlHit, sourceLine, QUOTE_MAX, EDGE, HL_TYPES, sourceTag, quoteGone} from '../app/text-highlights-model.mjs';
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
  assert.equal(highlightBody('', {type: 'news', id: ID}, 'x'), null);
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

// S62-17 NOTE-노트에서도밑줄: 노트도 밑줄 출처(DB 20261115194000), 출처 꼬리표, 노트 글이 바뀌어 고른 글이 없는지.
test('note is a highlight source; source tag; quote gone when the note text changed', () => {
  // S68-09 READ-읽을거리함: 읽을 거리도 밑줄 출처(DB 20261122100000).
  assert.deepEqual(HL_TYPES, ['news', 'outside', 'telegram', 'note', 'reading', 'brief']);
  assert.equal(highlightBody('w', {type: 'reading', id: '32000000-0000-4000-8000-000000000003', url: 'https://ex.com/a'}, '고른 글').source_type, 'reading');
  assert.equal(sourceTag({source_type: 'reading'}), '저장한 글'); // S68-34: 옛 '읽을 거리' 화면 이름이 '저장한 글'
  const id = '32000000-0000-4000-8000-000000000002';
  assert.deepEqual(cleanSource({type: 'note', id, title: '회의 메모', media: '노트', date: '2026-11-15T00:00:00Z', url: ''}), {type: 'note', id, title: '회의 메모', media: '노트', date: '2026-11-15T00:00:00.000Z', url: null});
  assert.equal(highlightBody('w', {type: 'note', id}, '고른 글').source_type, 'note');
  assert.equal(cleanSource({type: 'note', id: 'n1'}), null, 'note id must be a uuid');
  assert.deepEqual(['note', 'telegram', 'news', 'outside'].map(t => sourceTag({source_type: t})), ['노트', '텔레그램', '읽을 거리', '읽을 거리']); // S68-34: 기사 화면 이름 News → 읽을 거리
  const raw = '# 회의\n\n- **철도** 현장 간담회\n- 다음 주 _재논의_';
  assert.equal(quoteGone(raw, '철도 현장 간담회'), false, 'markdown marks and spaces are ignored');
  assert.equal(quoteGone(raw, '다음 주 재논의'), false);
  assert.equal(quoteGone(raw, '고치기 전 문장'), true);
  assert.equal(quoteGone(null, '철도'), true, 'a deleted note counts as changed');
  assert.equal(quoteGone(raw, ''), true);
});

// S70-16 UI-형광펜: 같은 표의 모양(mark_kind)·색(mark_color) 칸 — DB 검사(20261125113000)와 같은 값.
import {MARK_COLORS, markColor, isHighlight, isCollected, lastColor, highlightAt, DEFAULT_COLOR} from '../app/text-highlights-model.mjs';
test('highlight body: kind and one of five colors, no memo; plain underline sends no new columns', () => {
  const src = {type: 'brief', id: ID, title: '자료'};
  const pen = highlightBody(WS, src, '칠한 글', {prefix: '앞', suffix: '뒤'}, '메모는 빠짐', {kind: 'highlight', color: 'green'});
  assert.equal(pen.mark_kind, 'highlight');
  assert.equal(pen.mark_color, 'green');
  assert.equal(pen.memo, null);
  assert.equal(highlightBody(WS, src, '칠한 글', {}, null, {kind: 'highlight', color: 'red'}).mark_color, DEFAULT_COLOR);
  const plain = highlightBody(WS, src, '밑줄 글', {}, '메모');
  assert.equal('mark_kind' in plain || 'mark_color' in plain, false);
  assert.equal(plain.memo, '메모');
  assert.deepEqual([...MARK_COLORS], ['yellow', 'green', 'blue', 'pink', 'orange']);
  assert.equal(markColor('blue'), 'blue');
  assert.equal(markColor(undefined), 'yellow');
});
test('collections leave highlights out; last color = most recent painted or recolored highlight', () => {
  const rows = [
    {id: 'a', mark_kind: null, mark_color: null, created_at: '2026-11-25T03:00:00Z', updated_at: '2026-11-25T03:00:00Z'},
    {id: 'b', mark_kind: 'highlight', mark_color: 'green', created_at: '2026-11-25T01:00:00Z', updated_at: '2026-11-25T01:00:00Z'},
    {id: 'c', mark_kind: 'highlight', mark_color: 'pink', created_at: '2026-11-25T00:00:00Z', updated_at: '2026-11-25T02:00:00Z'},
  ];
  assert.deepEqual(rows.filter(isCollected).map(h => h.id), ['a']);
  assert.equal(isHighlight(rows[1]), true);
  assert.equal(lastColor(rows), 'pink');
  assert.equal(lastColor([rows[0]]), 'yellow');
  assert.equal(lastColor(null), 'yellow');
});
test('highlightAt finds the painted highlight under a selection (underlines are not edited this way)', () => {
  const rows = [{id: 'p', mark_kind: 'highlight', mark_color: 'blue'}, {id: 'u', mark_kind: null}];
  const ranges = [{start: 0, end: 5, id: 'u'}, {start: 10, end: 20, id: 'p'}];
  assert.equal(highlightAt(ranges, rows, 12, 14)?.id, 'p');
  assert.equal(highlightAt(ranges, rows, 18, 30)?.id, 'p');
  assert.equal(highlightAt(ranges, rows, 1, 3), null);
  assert.equal(highlightAt(ranges, rows, 20, 25), null);
});

// HL-밑줄위치로: 밑줄 줄에서 글을 열 때 갈 자리(정확한 자리 → 같은 문장 → 없음)와 눈에 보이는 띠 안 놓을 자리.
import {spotOf, jumpDelta} from '../app/text-highlights-model.mjs';
const FULL = '첫 문단은 배경이에요.\n\n둘째 문단: 가상 인력 충원 이야기를 짚어 봐요. 마지막 줄이에요.';
const hl = (quote, quote_prefix = '', quote_suffix = '') => ({quote, quote_prefix, quote_suffix});
test('spotOf: 저장한 자리 그대로면 exact, 글이 조금 바뀌면 같은 문장 앞머리로 near, 없으면 null', () => {
  const ex = spotOf(FULL, hl('가상 인력 충원'));
  assert.equal(ex.exact, true);
  assert.equal(FULL.slice(ex.start, ex.end), '가상 인력 충원');
  const near = spotOf(FULL, hl('가상 인력 충원 이야기를 크게 바꿔 봐요. 다른 문장'));
  assert.equal(near.exact, false);
  assert.equal(FULL.slice(near.start).startsWith('가상 인력 충원'), true);
  assert.equal(spotOf(FULL, hl('전혀 없는 글자들이 여기에 있어요')), null);
  assert.equal(spotOf(FULL, hl('짧음')), null); // 너무 짧은 글은 엉뚱한 곳으로 보내지 않는다
  assert.equal(spotOf(FULL, hl('')), null);
});
test('jumpDelta: 띠 위쪽 3분의 1에 놓고, 이미 거기면 0, 띠보다 큰 밑줄은 첫 줄을 띠 맨 위로', () => {
  const band = {bandTop: 100, bandBottom: 700};
  assert.equal(jumpDelta({top: 1000, height: 20, ...band}), 1000 - (100 + (600 - 20) * 0.3));
  assert.equal(jumpDelta({top: 100 + (600 - 20) * 0.3, height: 20, ...band}), 0);
  assert.equal(jumpDelta({top: -300, height: 20, ...band}) < 0, true); // 위로 지나쳐 있으면 거꾸로
  assert.equal(jumpDelta({top: 900, height: 2000, ...band}), 800);
});
