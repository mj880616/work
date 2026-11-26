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
    points: [
      { heading: '2. 평가 지표', text: '인건비 지표 배점 5점→8점(2쪽)' },
      { heading: '', text: '<script>' }, 7,
      { heading: '1. 개요', text: '의견 제출 11/28까지(1쪽)' },
      { heading: 'x', text: '없는 쪽(99쪽)' },
      { heading: 'x', text: '후보 인용 q1 참고' },
    ],
    quotes: [
      { text: '신규 인력 수요는 기존 총인건비 범위 내에서 재배치를 우선 검토한다.', heading: '3-2. 정원 관리', speaker: '예시 기관', why: '근거', page: 50 },
      { text: '의견 제출은 11월 28일까지 한다.', heading: '1', speaker: '지어낸 장관', why: '기한' },
      { text: '인력 충원을 전면 금지한다.', heading: '지어낸 문장', why: 'x' },
    ],
  });
  const n = m.parseChunkNote('```json\n' + raw + '\n```', ctx);
  assert.equal(n.quotes.length, 2);
  assert.equal(n.quotes[0].page, 3);
  assert.equal(n.quotes[0].speaker, '예시 기관', '원문에 있는 기관 이름은 남김');
  assert.equal(n.quotes[1].speaker, '', '원문에 없는 발언자는 쓰지 않음(추측 금지)');
  assert.deepEqual(n.points, [
    { heading: '2. 평가 지표', text: '인건비 지표 배점 5점→8점(2쪽)' },
    { heading: '1. 개요', text: '의견 제출 11/28까지(1쪽)' },
    { heading: 'x', text: '없는 쪽' },
  ], '꺾쇠·글 아닌 값·내부 낱말 줄은 버리고, 범위 밖 쪽 표시는 지움');
  assert.equal(n.touches, undefined, '고정 칸(touches·todos·conflicts)을 만들지 않음');
  assert.equal(m.parseChunkNote('그냥 글', ctx), null);
});

test('parseChunkNote: unknown pages → page null and page refs stripped', () => {
  const text = m.tidyBriefText(RAW.replace(/\f/g, '\n')).text;
  const ctx = { text, starts: m.pageStarts(text), folded: m.foldForMatch(text), chunk: { start: 0, end: text.length } };
  const n = m.parseChunkNote(JSON.stringify({ lead: '요지', points: [{ heading: '', text: '의견 제출(1쪽)' }], quotes: [{ text: '신규 인력 수요는 기존 총인건비 범위 내에서 재배치를 우선 검토한다.' }] }), ctx);
  assert.equal(n.quotes[0].page, null);
  assert.deepEqual(n.points, [{ heading: '', text: '의견 제출' }]);
});

const QA = '신규 인력 수요는 기존 총인건비 범위 내에서 재배치를 우선 검토한다.';
const QB = '인건비 관리의 적정성 지표 배점을 현행 5점에서 8점으로 상향하고';
const candOf = () => m.quoteCandidates([m.parseChunkNote(JSON.stringify({ lead: 'a', quotes: [
  { text: QA, heading: '3-2', speaker: '예시 기관', why: '충원' }, { text: QB, heading: '2', why: '배점' },
] }), ctxOf())]);

test('verifyBrief v3: 인용은 후보 번호로만(글·발언자·쪽은 후보 값), 인용은 선택, 요지 필수', () => {
  const candidates = candOf();
  assert.equal(candidates.length, 2);
  const b = m.verifyBrief(JSON.stringify({
    gist: ['예시 기관이 인건비 배점을 올림.'], sections: [],
    quotes: [{ id: 'q1' }, 'q2', { id: 'q9' }, { id: 'q1' }, { text: '새로 쓴 인용' }],
  }), { candidates, pageCount: 3 });
  assert.equal(b.v, 3);
  assert.deepEqual(b.quotes, [
    { text: QA, speaker: '예시 기관', heading: '3-2', page: 3 },
    { text: QB, speaker: '', heading: '2', page: 2 },
  ]);
  assert.equal(b.lead, '예시 기관이 인건비 배점을 올림.');
  assert.deepEqual(b.sections, [], '소제목 0개도 됨');
  assert.deepEqual(m.verifyBrief(JSON.stringify({ gist: ['요지.'], sections: [], quotes: [] }), { candidates, pageCount: 3 }).quotes, [], '인용 0개도 됨');
  assert.equal(m.verifyBrief(JSON.stringify({ gist: [], sections: [{ title: 'a', items: [{ text: 'b' }] }] }), { candidates, pageCount: 3 }), null, '요지 없으면 실패');
  assert.equal(m.verifyBrief(JSON.stringify({ gist: ['x'.repeat(121)] }), { candidates, pageCount: 3 }), null);
  assert.equal(m.verifyBrief(JSON.stringify({ gist: ['material 칸이 비어 있음'] }), { candidates, pageCount: 3 }), null, '내부 낱말만 있으면 실패');
  assert.equal(m.verifyBrief('그냥 글', { candidates, pageCount: 3 }), null);
});

test('verifyBrief v3: 소제목은 AI가 정한 대로(고정 이름 없음), 수·길이·글자 상한, 쪽 칸, 우리 관련은 등록 이름이 든 줄만', () => {
  const sec = (title, n, extra = {}) => ({ title, items: Array.from({ length: n }, (_, i) => ({ text: `${title} 항목 ${i + 1}`, page: 0, ours: false, ...extra })) });
  const b = m.verifyBrief(JSON.stringify({
    gist: ['국토교통부 철도국장: 연내 기준 마련 약속', '예시 위원: 예산 재검토 요구', '<b>', '넷째 줄'],
    sections: [
      { title: '안건 1. 예시 사업 보고', items: [
        { text: '국토교통부 철도국장: 연내 운영 기준 마련(2쪽)', page: 0, ours: false },
        { text: '예시 위원: 예산 재검토 요구', page: 3, ours: false },
        { text: '예시 거래처 단가 조정이 논의됨', page: 99, ours: true },
        { text: '다른 곳 단가 조정', page: 1, ours: true },
        { text: 'x'.repeat(161), page: 1, ours: false },
        { text: '후보 인용 q2 참고', page: 0, ours: false },
        '글로 온 항목',
      ] },
      { title: '', items: [{ text: '제목 없는 묶음 항목', page: 0, ours: false }] },
      { title: '빈 소제목', items: [] },
      { title: 'y'.repeat(41), items: [{ text: '긴 소제목', page: 0, ours: false }] },
      ...['가', '나', '다', '라', '마', '바', '사'].map(t => sec(t, 12)),
    ],
    quotes: [],
  }), { candidates: [], pageCount: 3, names: ['예시 거래처'] });
  assert.deepEqual(b.gist, ['국토교통부 철도국장: 연내 기준 마련 약속', '예시 위원: 예산 재검토 요구', '넷째 줄']);
  assert.deepEqual(b.sections[0], { title: '안건 1. 예시 사업 보고', items: [
    { text: '국토교통부 철도국장: 연내 운영 기준 마련', page: 2 },
    { text: '예시 위원: 예산 재검토 요구', page: 3 },
    { text: '예시 거래처 단가 조정', page: null, ours: true },
    { text: '다른 곳 단가 조정', page: 1 },
    { text: '글로 온 항목', page: null },
  ] }, '발언자는 문장 안 그대로, 쪽은 범위 안만, 우리 관련은 등록 이름이 든 줄만');
  assert.deepEqual(b.sections[1], { title: '', items: [{ text: '제목 없는 묶음 항목', page: null }] });
  assert.ok(b.sections.length <= m.BRIEF_LIMITS.sections);
  assert.ok(b.sections.every(s => s.items.length <= m.BRIEF_LIMITS.items));
  assert.ok(b.sections.reduce((n, s) => n + s.items.length, 0) <= m.BRIEF_LIMITS.totalItems);
  assert.ok(!b.sections.some(s => s.title === '빈 소제목' || s.title.startsWith('yyy')));
  for (const k of ['todos', 'orgs', 'counters', 'glance', 'touches', 'scope']) assert.equal(b[k], undefined, `고정 칸 ${k} 없음`);
  const none = m.verifyBrief(JSON.stringify({ gist: ['요지'], sections: [{ title: 'a', items: [{ text: '예시 거래처 단가', page: 0, ours: true }] }] }), { candidates: [], pageCount: null, names: null });
  assert.equal(none.sections[0].items[0].ours, undefined, '담당 목록을 모르면 우리 관련 표시 없음');
});

test('verifyBrief v3: 전체 글자 수 상한', () => {
  const long = n => ({ text: `${n} ${'가'.repeat(150)}`, page: 0, ours: false });
  const b = m.verifyBrief(JSON.stringify({ gist: ['요지'], sections: Array.from({ length: 8 }, (_, i) => ({ title: `제목${i}`, items: Array.from({ length: 5 }, (_, j) => long(`${i}-${j}`)) })) }), { candidates: [], pageCount: null });
  const total = b.sections.flatMap(s => s.items).reduce((n, it) => n + [...it.text].length, 0);
  assert.ok(total <= m.BRIEF_LIMITS.totalChars, String(total));
});

test('chunkWithPages marks pages; inputs carry no ids', () => {
  const { text, starts } = ctxOf();
  const body = m.chunkWithPages(text, starts, { start: 0, end: text.length });
  assert.match(body, /^〔1쪽〕/);
  assert.match(body, /〔3쪽〕\n3-2/);
  const scope = m.scopeText(['예시 가지부', '<x>'], ['사업영역 A']);
  assert.equal(scope, '내가 등록한 담당 대상: 예시 가지부\n내가 등록한 프로젝트: 사업영역 A');
  const ci = m.chunkInput({ index: 0, total: 2, title: '예시', body });
  assert.match(ci, /조각 1\/2/);
  assert.doesNotMatch(ci, /내가 등록한/, '조각 요약에는 담당 목록을 보내지 않음');
  assert.equal(m.stepTotal(3), 4);
});

test('mergeInput: 새 메모(points)·옛 메모(touches·todos·conflicts)를 칸 이름 없이 줄로, 인용은 번호·쪽·발언자', () => {
  const input = m.mergeInput({ title: '예시', scope: '내가 등록한 담당: 없음', candidates: candOf(), notes: [
    { lead: '새 요지', points: [{ heading: '안건 1', text: '국장: 기준 마련' }], quotes: [] },
    { lead: '옛 요지', touches: ['닿는 줄'], todos: ['할 일 줄'], conflicts: ['부딪힘 줄'], quotes: [] },
  ] });
  assert.match(input, /- \[안건 1\] 국장: 기준 마련/);
  assert.match(input, /- 닿는 줄\n- 할 일 줄\n- 부딪힘 줄/);
  assert.doesNotMatch(input, /닿는 것:|할 일·숫자:|부딪힘:/);
  assert.match(input, /q1 \(3쪽\) \[3-2\] \{예시 기관\}: 신규 인력/);
});

test('trimTail·matchScopeName', () => {
  assert.equal(m.trimTail('예산 축소가 논의됨.'), '예산 축소');
  assert.equal(m.trimTail('하반기 시행 예정임'), '하반기 시행 예정임', '뜻이 있는 꼬리는 남김');
  assert.equal(m.trimTail('논의됨'), '논의됨', '다 지워지면 그대로');
  assert.equal(m.matchScopeName('예시거래처', '', ['예시 거래처']), '예시 거래처');
  assert.equal(m.matchScopeName('', '예시 거래처 단가', ['예시 거래처']), '예시 거래처');
  assert.equal(m.matchScopeName('다른 곳', '무관', ['예시 거래처']), null);
  assert.equal(m.matchScopeName('예시 거래처', '', null), null);
});

// S68-56(사용자 11/23 15:06·15:12): 미리 정한 칸(챙길 일·우리 조직 관련·대응할 것·쟁점별·숫자)에 끼워 넣지 않는다.
test('S68-56 프롬프트·스키마: 고정 칸 없음, 자료 짜임대로, 누가 한 말인지 문장 안에, 요지·소제목·인용', async () => {
  for (const text of [m.CHUNK_INSTRUCTIONS, m.MERGE_INSTRUCTIONS]) {
    assert.match(text, /칸을 미리 정하지 않는다/);
    assert.match(text, /누가 했는지/);
    assert.match(text, /이 사람이 할 일로 바꿔 적지 않는다/);
    assert.match(text, /꼬리말을 붙이지 않는다/);
    assert.doesNotMatch(text, /챙길 일|우리 조직 관련|대응할 것|쟁점별|"todos"|"orgs"|"counters"|"glance"|"touches"|"conflicts"/);
  }
  assert.match(m.MERGE_INSTRUCTIONS, /"gist"/);
  assert.match(m.MERGE_INSTRUCTIONS, /우리 관련만 따로 모은 소제목을 만들지 않는다/);
  const r = await import('../supabase/functions/document-actions/brief-run.mjs');
  assert.deepEqual(r.MERGE_SCHEMA.required, ['gist', 'sections', 'quotes']);
  assert.deepEqual(r.MERGE_SCHEMA.properties.sections.items.required, ['title', 'items']);
  assert.deepEqual(r.MERGE_SCHEMA.properties.sections.items.properties.items.items.required, ['text', 'page', 'ours']);
  assert.deepEqual(r.MERGE_SCHEMA.properties.quotes.items.required, ['id']);
  assert.deepEqual(r.CHUNK_SCHEMA.required, ['lead', 'points', 'quotes']);
  assert.deepEqual(r.CHUNK_SCHEMA.properties.quotes.items.required, ['text', 'heading', 'speaker', 'why']);
});
