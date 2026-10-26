import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {zlib, SAMPLE} from '../scripts/weekly-hwpx/cli.mjs';
import {makeFakeReport} from '../scripts/weekly-hwpx/fixture.mjs';
import {openHwpx, packHwpx} from '../app/weekly-hwpx/hwpx.mjs';
import {prepareConfirmed, openConfirmed, startDraft, editableRows, assembleDraft, buildHwpx, issuedFrom} from '../app/weekly-hwpx/draft.mjs';
import {weeklyLines, sectionXmlText, issuedFromSections, readIssued, newerIssued, sameIssuedLines, squashLine, ISSUED_MAX_BYTES} from '../app/weekly-lines.mjs';
import {makeDraft, readDraft, merge3, keepDocsOnly, withDocEdit, hasContent, putIssued, readWeekDraft, writeWeekDraft, changeWeekDocs, DRAFT_MAX_BYTES} from '../app/weekly-draft-store.js';

// WEEKLY-개인본대조 W-2: 받은 초안 줄 기록(draft.issued). 글은 모두 지어낸 것(가 지부·나 사업장·가짜 영역).
const p = t => `<hp:p><hp:run><hp:t>${t}</hp:t></hp:run></hp:p>`;
const xmlOf = lines => `<hs:sec>${lines.map(p).join('')}</hs:sec>`;
const FILE = [
  '주간 업무 보고', '2026.10.26.',
  '1. 요청사항', '1) 집회/행사 참가 요청', '일', '시간/내용/장소', '참석 요청', '10/28 가상 결의대회 참석 요청',
  '2) 주요 일정', '일', '시간/내용/장소', '참석자', '10/29 일정 표 줄은 읽지 않음',
  '2. 기본․영역․의제 사업', '1) 요약', '사업영역', '세부 과제', '진행 상황 및 이후 계획', '담당 팀원', '가상 영역', '가상 과제', '가 지부 임금교섭 준비 중', '회의 일정 조율',
  '2) 세부 내용', '나 회의 결과 정리 완료',
  '3. 투쟁 사업', '1) 집회·농성 등', '2) 투쟁 사업장 현황', '조직명', '현황', '가 지부', '3차 교섭 결렬, 다음 주 재교섭',
  '4. 산하조직 현황', '1) 요약', '사업장', '조직현황', '나 사업장', '위원회 구성 논의 중',
  '5. 주요 일정', '일', '시간/내용/장소', '참석자', '10/30 일정 표 줄은 읽지 않음',
];

test('줄 나누기: 큰 제목 앞·5절·2) 주요 일정·표 머리 칸 이름·절 제목은 빼고 칸 글(사업영역·세부 과제·요청 표 줄)은 전부 넣는다', () => {
  const got = weeklyLines(sectionXmlText(xmlOf(FILE))).map(l => `${l.section}|${l.text}`);
  assert.deepEqual(got, [
    'requests|10/28 가상 결의대회 참석 요청',
    'work|가상 영역', 'work|가상 과제', 'work|가 지부 임금교섭 준비 중', 'work|회의 일정 조율', 'work|나 회의 결과 정리 완료',
    'struggle|가 지부', 'struggle|3차 교섭 결렬, 다음 주 재교섭',
    'orgs|나 사업장', 'orgs|위원회 구성 논의 중',
  ]);
  assert.deepEqual(weeklyLines(''), []);
  assert.deepEqual(weeklyLines('절 제목이 없는 글\n둘째 줄'), []);
});

test('받은 초안 기록: 쪽(section) 순서대로 읽고, 줄이 없거나 상한을 넘으면 기록하지 않는다. 읽을 때는 모양대로만 받는다', () => {
  const issued = issuedFromSections([xmlOf(FILE.slice(0, 20)), xmlOf(FILE.slice(20))], '2026-10-26T09:10:00+09:00');
  assert.equal(issued.from, 'generated');
  assert.equal(issued.lines.length, 10);
  assert.deepEqual(issued.lines[0], {section: 'requests', text: '10/28 가상 결의대회 참석 요청'});
  assert.equal(issuedFromSections([xmlOf(['제목만', '2026.10.26.'])], 'x'), null);
  assert.equal(issuedFromSections([], 'x'), null);
  const big = issuedFromSections([xmlOf(['3. 투쟁 사업', ...Array.from({length: 400}, (_, i) => `${i}번 ${'가'.repeat(290)}`)])], 'x');
  assert.equal(big, null); // 400줄 × 한글 290자는 64 KB 를 넘는다
  assert.ok(ISSUED_MAX_BYTES < DRAFT_MAX_BYTES);
  assert.deepEqual(readIssued({at: 'a', lines: [{section: 'work', text: '가나'}, {section: 'nope', text: 'x'}, {section: 'orgs'}, null], extra: 1}), {at: 'a', from: 'generated', lines: [{section: 'work', text: '가나'}]});
  for (const bad of [null, [], {at: 1, lines: []}, {at: 'a', lines: 'x'}, {at: 'a', lines: []}, {at: 'x'.repeat(41), lines: [{section: 'work', text: '가나'}]}]) assert.equal(readIssued(bad), null);
});

// 합성 확정본 → 내 칸 바탕 → .hwpx 만들기까지 앱이 실제로 쓰는 길로, 내준 파일에서 줄을 읽는다.
const fakeBytes = () => packHwpx(makeFakeReport(openHwpx(new Uint8Array(readFileSync(SAMPLE)), zlib)), zlib);
test('앱이 만든 .hwpx 에서 읽는다: 칸 글(영역·과제·진행 글·조직 글)은 들어가고 표 머리 칸 이름·5절은 빠진다', async () => {
  const {team, template} = prepareConfirmed(await openConfirmed(fakeBytes()));
  const base = startDraft(team, {me: '가짜담당 갑', myOrgs: ['가짜조직 갑'], date: '2026년 1월 5일(월)'});
  const rows = editableRows(base, '가짜담당 갑');
  const data = assembleDraft(base, {summary: new Map([[rows[0].index, ['- 가짜 진행 하나 완료', '- 새로 쓴 가짜 줄']]])});
  const bytes = await buildHwpx(template, data);
  const issued = await issuedFrom(bytes, '2026-01-05T09:00:00+09:00');
  const texts = issued.lines.map(l => l.text);
  for (const t of ['가짜영역', '가짜과제 하나', '- 가짜 진행 하나 완료', '- 새로 쓴 가짜 줄', '가짜조직 갑', '개요 가짜 현황 갑', '- 가짜 소식 갑']) assert.ok(texts.includes(t), t);
  for (const label of ['사업영역', '세부 과제', '진행 상황 및 이후 계획', '담당 팀원', '조직명', '현황', '사업장', '조직현황', '시간/내용/장소', '참석자']) assert.ok(!texts.includes(label), label);
  assert.ok(!texts.some(t => /주요 일정|^5\./.test(t)));
  assert.deepEqual([...new Set(issued.lines.map(l => l.section))], ['work', 'struggle', 'orgs']);
  // 같은 파일을 한 번 더 읽으면 줄이 같다(다시 내줘도 서버에 또 쓰지 않음).
  assert.equal(sameIssuedLines(issued, await issuedFrom(bytes, '2026-01-05T10:00:00+09:00')), true);
});

// ---- 임시저장에 실어 보내기 ----
const ISSUED = {at: '2026-10-26T09:10:00+09:00', from: 'generated', lines: [{section: 'work', text: '가상 과제'}, {section: 'struggle', text: '가 지부'}]};
const LATER = {at: '2026-10-26T11:00:00+09:00', from: 'generated', lines: [{section: 'work', text: '가상 과제 둘'}]};

test('임시저장 모양: makeDraft·readDraft·합치기·[처음부터]·자료 줄 고침이 issued 를 지우지 않는다. 고친 칸이 아니라서 이어 쓰기 판정에는 안 들어간다', () => {
  const a = makeDraft({issued: ISSUED});
  assert.deepEqual(a.issued, ISSUED);
  assert.equal(hasContent(a), false);
  assert.equal('issued' in makeDraft({}), false);
  assert.deepEqual(readDraft(JSON.parse(JSON.stringify(a))).issued, ISSUED);
  // 덮어쓰기 재현: issued 를 다시 싣지 않은 makeDraft 는 지운다(그래서 화면이 늘 싣는다).
  assert.equal('issued' in makeDraft({date: 'x'}), false);
  // 합치기: 한쪽에만 있어도 남고, 양쪽이면 더 나중에 낸 것.
  assert.deepEqual(merge3(null, makeDraft({}), a).draft.issued, ISSUED);
  assert.deepEqual(merge3(null, a, makeDraft({})).draft.issued, ISSUED);
  const m = merge3(a, makeDraft({issued: LATER}), a);
  assert.deepEqual(m.draft.issued, LATER);
  assert.deepEqual(m.conflicts, []);
  assert.deepEqual(merge3(a, a, makeDraft({issued: LATER})).draft.issued, LATER);
  assert.equal(newerIssued(null, null), null);
  // [처음부터]: 칸은 비우고 issued 는 남긴다. docs 도 같이 남는다. 둘 다 없으면 null.
  const withRows = {...a, rows: [{section: 'orgs', key: 'k', n: 0, lines: ['x']}]};
  assert.deepEqual(keepDocsOnly(withRows), {v: 1, base: null, me: '', me_from: '', date: '', rows: [], titles: [], issued: ISSUED});
  assert.deepEqual(keepDocsOnly(withDocEdit(withRows, 'd', {drop: true})).docs, [{id: 'd', drop: true}]);
  assert.deepEqual(keepDocsOnly(withDocEdit(withRows, 'd', {drop: true})).issued, ISSUED);
  assert.equal(keepDocsOnly({v: 1, rows: []}), null);
  // 자료 줄 고침이 issued 를 지나 보낸다.
  assert.deepEqual(withDocEdit(a, 'd', {text: '고친 줄'}).issued, ISSUED);
  assert.deepEqual(withDocEdit(null, 'd', {text: '고친 줄'}).issued, undefined);
});

test('크기: issued 때문에 고친 칸 저장이 막히지 않는다(넘치면 issued 만 뺀다)', () => {
  const rows = new Map([['summary\u0000k\u00000', ['가'.repeat(DRAFT_MAX_BYTES / 3 - 2000)]]]);
  const d = makeDraft({cells: rows, issued: {at: 'a', lines: Array.from({length: 150}, (_, i) => ({section: 'work', text: `${i}`.padEnd(120, '나')}))}});
  assert.equal('issued' in d, false);
  assert.equal(d.rows.length, 1);
  assert.equal('issued' in putIssued(makeDraft({}), {at: 'a', lines: []}), false);
});

function fakeRt(rows = []) {
  const rt = {
    context: {read: () => ({workspace: {id: 'w'}})},
    async api(path, {method = 'GET', body = null} = {}) {
      const q = new URL(path, 'https://x').searchParams;
      const hit = () => rows.filter(r => (!q.has('week_start') || q.get('week_start') === `eq.${r.week_start}`) &&
        (!q.has('draft_saved_at') || (q.get('draft_saved_at') === 'is.null' ? r.draft_saved_at == null : q.get('draft_saved_at') === `eq.${r.draft_saved_at}`)));
      if (method === 'GET') return hit().map(r => ({id: r.id, draft: r.draft, draft_saved_at: r.draft_saved_at}));
      if (method === 'POST') { const row = {id: `r${rows.length}`, ...body}; rows.push(row); return [row]; }
      const list = hit(); for (const r of list) Object.assign(r, body); return list;
    },
  };
  let clock = 0;
  return {rt, rows, now: () => `2026-10-26T0${++clock}:00:00.000Z`};
}

test('서버 왕복: 받은 초안을 적은 뒤 상자가 고쳐 저장해도, 다시 열어 저장해도, 자료 줄 고침을 해도 issued 가 남는다', async () => {
  const f = fakeRt();
  const START = '2026-10-26';
  // 1) 파일을 내줘서 issued 만 적힘(행이 없으면 만든다).
  const first = await writeWeekDraft({start: START, known: {exists: false}, draft: makeDraft({issued: ISSUED}), now: f.now}, f.rt);
  assert.equal(first.ok, true);
  assert.deepEqual(f.rows[0].draft.issued, ISSUED);
  // 2) 다시 연 상자: 읽은 issued 를 들고 있다가 고친 칸과 함께 다시 싣는다(journal-hwpx 의 currentDraft).
  const read = await readWeekDraft(START, f.rt);
  assert.deepEqual(read.row.draft.issued, ISSUED);
  assert.equal(hasContent(read.row.draft), false); // 이어 쓰기로 보이지 않는다
  const edited = makeDraft({cells: new Map([['orgs\u0000가\u00000', ['- 고침']]]), initial: new Map([['orgs\u0000가\u00000', ['- 바탕']]]), issued: read.row.draft.issued});
  const second = await writeWeekDraft({start: START, known: read.row, draft: edited, now: f.now}, f.rt);
  assert.deepEqual(f.rows[0].draft.issued, ISSUED);
  assert.equal(f.rows[0].draft.rows.length, 1);
  // 3) 자료 줄 고침(다른 화면)도 같은 줄에 issued 를 남긴다.
  const docs = await changeWeekDocs({start: START, known: second.row, change: d => withDocEdit(d, 'doc1', {drop: true})}, f.rt);
  assert.equal(docs.ok, true);
  assert.deepEqual(f.rows[0].draft.issued, ISSUED);
  assert.deepEqual(f.rows[0].draft.docs, [{id: 'doc1', drop: true}]);
  // 4) 다른 기기가 더 나중에 낸 초안: 합친 판에 그쪽 issued, 서버에서 읽은 것도 그대로.
  const theirs = {...f.rows[0].draft, issued: LATER};
  assert.deepEqual(merge3(second.row.draft, makeDraft({issued: ISSUED}), theirs).draft.issued, LATER);
  // 5) [처음부터]: issued 는 남는다.
  const cleared = await writeWeekDraft({start: START, known: (await readWeekDraft(START, f.rt)).row, draft: keepDocsOnly((await readWeekDraft(START, f.rt)).row.draft), now: f.now}, f.rt);
  assert.deepEqual(cleared.row.draft.issued, ISSUED);
  assert.deepEqual(cleared.row.draft.rows, []);
});
