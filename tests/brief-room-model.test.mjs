// BRIEF-브리핑룸 PR ②: supabase/functions/_shared/brief-room.mjs (순수 함수). 네트워크 없음, 예시 자료만.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as m from '../supabase/functions/_shared/brief-room.mjs';

// 예시 자료(실제 자료 아님): 3쪽, 쪽 나눔 \f.
const P1 = '1. 개요\n예시 기관 경영평가 편람 개정안이다. 의견 제출은 11월 28일까지 한다.';
const P2 = '2. 평가 지표\n인건비 관리의 적정성 지표 배점을 현행 5점에서 8점으로 상향하고,\n총인건비 인상률 준수 여부를 감점 요소로 반영한다.';
const P3 = '3-2. 정원 관리\n신규 인력 수요는 기존 총인건비 범위 내에서 재배치를 우선 검토한다.';
const RAW = `﻿${P1}\r\n\f${P2}\u0007\f\n${P3}\n\n\n`;

test('tidyBriefText keeps page breaks and drops control chars', () => {
  const { text, cut } = m.tidyBriefText(RAW);
  assert.equal(cut, false);
  assert.equal(text.split('\f').length, 3);
  assert.doesNotMatch(text, /[\u0007﻿\r]/);
  assert.equal(m.tidyBriefText('가'.repeat(20), 10).cut, true);
});

test('pageStarts / pageAt: 1-based pages, unknown when no breaks', () => {
  const { text } = m.tidyBriefText(RAW);
  const s = m.pageStarts(text);
  assert.equal(s.length, 3);
  assert.equal(m.pageAt(s, 0), 1);
  assert.equal(m.pageAt(s, text.indexOf('인건비 관리')), 2);
  assert.equal(m.pageAt(s, text.indexOf('신규 인력')), 3);
  assert.equal(m.pageAt([0], 5), null);
});

test('splitChunks: whole pages per chunk, long page split, covers all text', () => {
  const pages = Array.from({ length: 10 }, (_, i) => `${i + 1}쪽 내용 `.repeat(400)); // 쪽마다 약 2,800자
  const text = pages.join('\f');
  const chunks = m.splitChunks(text, 12000);
  assert.ok(chunks.length >= 2 && chunks.length <= 4, String(chunks.length));
  for (const c of chunks) assert.ok(c.end - c.start <= 12000);
  // 조각 경계는 쪽 나눔 자리
  for (const c of chunks.slice(1)) assert.equal(text[c.start - 1], '\f');
  const joined = chunks.map(c => text.slice(c.start, c.end)).join('');
  assert.equal(joined.replace(/\f/g, ''), text.replace(/\f/g, ''));
  const long = '문장입니다.\n'.repeat(5000); // 쪽 없음, 3만 자 이상
  const lc = m.splitChunks(long, 12000);
  assert.ok(lc.length >= 3);
  for (const c of lc) assert.ok(c.end - c.start <= 12000);
  assert.equal(lc.map(c => long.slice(c.start, c.end)).join(''), long);
});

test('findQuote: ignores spaces/line breaks/quote shapes, rejects paraphrase and too-short', () => {
  const { text } = m.tidyBriefText(RAW);
  const f = m.foldForMatch(text);
  assert.ok(m.findQuote(f, '“인건비 관리의 적정성 지표 배점을 현행 5점에서 8점으로 상향하고, 총인건비 인상률 준수 여부를 감점 요소로 반영한다.”') > 0);
  assert.equal(m.findQuote(f, '인건비 관리 지표 배점을 5점에서 8점으로 올린다.'), -1);
  assert.equal(m.findQuote(f, '인건비'), -1);
});

const ctxOf = () => {
  const { text } = m.tidyBriefText(RAW);
  const starts = m.pageStarts(text);
  return { text, starts, folded: m.foldForMatch(text), chunk: { start: 0, end: text.length } };
};

test('parseChunkNote: invented quote dropped, page reassigned by server, page refs outside range removed', () => {
  const ctx = ctxOf();
  const raw = JSON.stringify({
    lead: '인건비 배점이 오른다(2쪽).',
    touches: ['정원 관리 지표 신설(3쪽)', '<script>', 7],
    todos: ['의견 제출 11/28까지(1쪽)', '없는 쪽(99쪽)'],
    conflicts: ['총인건비 안에서 재배치(3쪽)'],
    quotes: [
      { text: '신규 인력 수요는 기존 총인건비 범위 내에서 재배치를 우선 검토한다.', heading: '3-2. 정원 관리', why: '충원 요구를 막는 근거', page: 50 },
      { text: '인력 충원을 전면 금지한다.', heading: '지어낸 문장', why: 'x' },
    ],
  });
  const n = m.parseChunkNote('```json\n' + raw + '\n```', ctx);
  assert.equal(n.quotes.length, 1);
  assert.equal(n.quotes[0].page, 3);
  assert.deepEqual(n.touches, ['정원 관리 지표 신설(3쪽)']);
  assert.deepEqual(n.todos, ['의견 제출 11/28까지(1쪽)', '없는 쪽']);
  assert.equal(m.parseChunkNote('그냥 글', ctx), null);
});

test('parseChunkNote: unknown pages → page null and page refs stripped', () => {
  const text = m.tidyBriefText(RAW.replace(/\f/g, '\n')).text;
  const ctx = { text, starts: m.pageStarts(text), folded: m.foldForMatch(text), chunk: { start: 0, end: text.length } };
  const n = m.parseChunkNote(JSON.stringify({ lead: '요지', todos: ['의견 제출(1쪽)'], quotes: [{ text: '신규 인력 수요는 기존 총인건비 범위 내에서 재배치를 우선 검토한다.' }] }), ctx);
  assert.equal(n.quotes[0].page, null);
  assert.deepEqual(n.todos, ['의견 제출']);
});

test('verifyBrief: quotes only by candidate id, text from candidates, sorted by page', () => {
  const ctx = ctxOf();
  const note = m.parseChunkNote(JSON.stringify({ lead: 'a', quotes: [
    { text: '신규 인력 수요는 기존 총인건비 범위 내에서 재배치를 우선 검토한다.', heading: '3-2', why: '충원' },
    { text: '인건비 관리의 적정성 지표 배점을 현행 5점에서 8점으로 상향하고', heading: '2', why: '배점' },
  ] }), ctx);
  const candidates = m.quoteCandidates([note, note]);
  assert.equal(candidates.length, 2); // 같은 인용은 한 번
  const b = m.verifyBrief(JSON.stringify({
    lead: '인건비 배점이 늘고 정원 관리 지표가 생김.',
    touches: ['예시 가지부 영향(2쪽)'], todos: ['의견 제출 11/28(1쪽)'], conflicts: [],
    quotes: [{ id: 'q1', why: '충원 요구를 막는 근거' }, { id: 'q2' }, { id: 'q9' }, { id: 'q1' }, { text: '새로 쓴 인용' }],
  }), { candidates, pageCount: 3 });
  assert.equal(b.quotes.length, 2);
  assert.deepEqual(b.quotes.map(q => q.page), [2, 3]);
  assert.equal(b.quotes[1].why, '충원 요구를 막는 근거');
  assert.equal(b.quotes[0].text, candidates[1].text);
  assert.equal(m.verifyBrief(JSON.stringify({ lead: '' }), { candidates, pageCount: 3 }), null);
  assert.equal(m.verifyBrief(JSON.stringify({ lead: 'x'.repeat(121) }), { candidates, pageCount: 3 }), null);
});

test('chunkWithPages marks pages; inputs carry no ids', () => {
  const { text, starts } = ctxOf();
  const body = m.chunkWithPages(text, starts, { start: 0, end: text.length });
  assert.match(body, /^〔1쪽〕/);
  assert.match(body, /〔3쪽〕\n3-2/);
  const scope = m.scopeText(['예시 가지부', '<x>'], ['사업영역 A']);
  assert.equal(scope, '내 담당 조직: 예시 가지부\n내 사업영역: 사업영역 A');
  assert.match(m.chunkInput({ index: 0, total: 2, title: '예시', scope, body }), /조각 1\/2/);
  assert.equal(m.stepTotal(3), 4);
});
