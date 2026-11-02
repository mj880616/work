// S48-3 주간 정리 묶음(WEEKLY-주요일정기준·WEEKLY-뺀목록삭제·WEEKLY-줄끌기·지우기버그·WEEKLY-사업영역세부줄). 글·이름은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {majorRule, isInternalMeeting, MAJOR_SCHEDULE_RULE, MAJOR_RULES, INTERNAL_MEETINGS} from '../app/weekly-major-schedule.mjs';
import {withCellLine, withLineMove, cellLinesOf, cellVisibleLines, visibleLines, cellId} from '../app/weekly-draft-store.js';
import {flowCells} from '../app/weekly-flow-cells.js';
import {readHand, handRows, withHandRow, withoutHandRow, withDetailEdit, detailEdits} from '../app/weekly-hand.mjs';
import {hqSuggestions} from '../app/weekly-hq-schedule.js';
import {withPick} from '../app/weekly-picks.mjs';

const AT = '2026-11-02T00:00:00.000Z';
const proposed = {at:AT, base:{from:'personal', document_id:'d1'}, cells:[
  {section:'summary', key:'가 영역›가-1', n:0, lines:['- 가상 교섭 3차', '- 가상 회의']},
  {section:'summary', key:'나 영역›', n:0, lines:['- 나 줄']},
  {section:'orgs', key:'A 지부', n:0, lines:['- 가상 소식']},
]};
const base = {v:1, base:null, me:'', me_from:'', date:'', rows:[], titles:[], proposed};
const A = {section:'summary', key:'가 영역›가-1', n:0}, B = {section:'summary', key:'나 영역›', n:0};

// ---- 1. 주요 일정 기준 ----
test('주요 일정 기준: 연대를 조직할 투쟁(파업·선전전·결의대회·총회 투쟁·공동 집회)과 기자회견·국회 토론회는 넣고, 회의는 모두·단순 방문은 넣지 않는다', () => {
  for (const t of ['가상 사업장 집중 릴레이 선전전', '가상 조합원 총회 투쟁', '궤도 주최 기자회견', '국회 토론회 — 가상 정책', '공동 집회', '가상 공동투쟁 선포', '현장 파업 집회', '가상 조합원 총력 투쟁 결의대회'])
    assert.ok(majorRule(t), t);
  for (const t of ['궤도협의회 대표자회의', '가상 대의원대회', '가상 파업 대책 회의', '본부 집행위', '궤도 집행국 회의', '노조 상집 44차', '노조 중집', '가상 사업장 방문', '파업 사업장 방문', '교섭 실무 회의', '', null])
    assert.equal(majorRule(t), null, String(t));
  assert.ok(isInternalMeeting('노조 상집 44차') && isInternalMeeting('본부집행위') && !isInternalMeeting('궤도협의회 대표자회의'));
  assert.match(MAJOR_SCHEDULE_RULE, /회의는 넣지 않는다/);
  assert.ok(MAJOR_RULES.length >= 5 && INTERNAL_MEETINGS.includes('상집') && INTERNAL_MEETINGS.includes('중집'));
});

test('2) 주요 일정 제안: 기준에 맞고 표에 없는 달력 일정만, 뺀 제안은 다시 안 뜸(목록 없이), 넣은 일정도 안 뜸', () => {
  const ev = (key, title, day = '2026-11-10') => ({key, label:'11.10.(화)', what:title, title, day, time:'10:00', place:''});
  const events = [ev('e1', '가상 기자회견'), ev('e2', '노조 상집 45차'), ev('e3', '가상 교섭'), ev('e4', '가상 결의대회'), ev('e5', '공동 집회')];
  const shown = hqSuggestions(events, [{id:'r1', event:'e5'}], new Map(), null);
  assert.deepEqual(shown.map(x => x.raw.item.key), ['e1', 'e4']);
  const text = shown[0].text;
  const picks = withPick(null, {kind:'calendar', from:'calendar', cell:'requests:hq', org:'', text}, 'drop', AT);
  assert.deepEqual(hqSuggestions(events, [], new Map(), picks).map(x => x.raw.item.key), ['e4', 'e5']);
});

test('옛 안내 문구·뺀 목록 코드가 화면 파일에 남지 않는다(코드째 삭제)', async () => {
  const weekly = await readFile(new URL('../app/journal-weekly.js', import.meta.url), 'utf8');
  const flow = await readFile(new URL('../app/weekly-flow-cells.js', import.meta.url), 'utf8');
  assert.doesNotMatch(weekly, /HQ_SCHEDULE_GUIDE|journalWeeklyGuide|주간보고에서 뺀 회의 종류|journalKindsOff|다시 올리기/);
  assert.doesNotMatch(flow, /이번 주 보고에서 뺀 사업장|flowHiddenSites|flowSiteShow/);
});

// ---- 3. 지우기 버그·줄 끌기·아래에 줄 추가 ----
test('★지우기 버그 재현: 칸 저장 줄에 빈 줄이 있어도 [빼기]는 화면에 보이는 그 줄을 지운다(빈 줄을 지우고 끝나지 않음)', () => {
  // 상자에서 고친 칸처럼 저장 줄 사이·끝에 빈 줄이 있고, [+ 추가]로 'ㅇㅇ'을 더한 판.
  const draft = {...base, rows:[{section:'summary', key:'가 영역›가-1', n:0, lines:['- 가상 교섭 3차', '', '- 가상 회의', '']}]};
  const added = withCellLine(draft, {...A, act:'add', text:'- ㅇㅇ', at:AT});
  const shown = flowCells(added, 'summary').find(c => c.key === A.key).lines;
  assert.deepEqual(shown, ['- 가상 교섭 3차', '- 가상 회의', '- ㅇㅇ']);
  // 화면 번호 2(= 'ㅇㅇ')를 빼면 'ㅇㅇ'이 사라져야 한다(전에는 저장 번호 2 = 빈 줄이 지워지고 'ㅇㅇ'은 남았다).
  const cut = withCellLine(added, {...A, act:'cut', index:shown.indexOf('- ㅇㅇ'), at:AT});
  assert.deepEqual(cellVisibleLines(cut, A), ['- 가상 교섭 3차', '- 가상 회의']);
  // 바탕과 같아졌으니 고친 칸(rows)도 없어진다 — 다시 열어도(다른 기기도) 바탕 그대로.
  assert.deepEqual(cut.rows, []);
  // 고치기도 보이는 번호 그대로.
  const fixed = withCellLine(draft, {...A, act:'fix', index:1, text:'- 가상 회의(고침)', at:AT});
  assert.deepEqual(cellLinesOf(fixed, A), ['- 가상 교섭 3차', '- 가상 회의(고침)']);
  assert.deepEqual(visibleLines(['', ' ', '- 가', null]), ['- 가']);
});

test('지우기: 바탕 줄·손으로 더한 줄 모두 지워지고, 바탕에 없던 칸은 빈 칸으로 남지 않고 rows 에서 빠진다', () => {
  const one = withCellLine(base, {...A, act:'cut', index:0, at:AT});
  assert.deepEqual(cellLinesOf(one, A), ['- 가상 회의']);
  const extra = {section:'summary', key:'다 영역›', n:0};
  const added = withCellLine(base, {...extra, act:'add', text:'- 손 줄', at:AT});
  const gone = withCellLine(added, {...extra, act:'cut', index:0, at:AT});
  assert.deepEqual(cellLinesOf(gone, extra), []);
  assert.equal(gone.rows.length, 0);
});

test('[아래에 줄 추가]: 그 줄 바로 아래에 들어간다', () => {
  const next = withCellLine(base, {...A, act:'add', insertAt:1, text:'- 가운데 줄', at:AT});
  assert.deepEqual(cellLinesOf(next, A), ['- 가상 교섭 3차', '- 가운데 줄', '- 가상 회의']);
  const end = withCellLine(base, {...A, act:'add', text:'- 끝 줄', at:AT});
  assert.deepEqual(cellLinesOf(end, A).at(-1), '- 끝 줄');
});

test('줄 끌기: 같은 칸 안 자리 바꾸기, 같은 묶음 다른 칸으로 옮기기(두 칸을 한 판에), 다른 묶음은 거절', () => {
  const down = withLineMove(base, {from:{...A, index:0}, to:{...A, index:1}});
  assert.deepEqual(cellLinesOf(down, A), ['- 가상 회의', '- 가상 교섭 3차']);
  const back = withLineMove(down, {from:{...A, index:1}, to:{...A, index:0}});
  assert.deepEqual(back.rows, []); // 처음 순서로 돌아오면 고친 칸이 없다
  assert.equal(withLineMove(base, {from:{...A, index:0}, to:{...A, index:0}}), base);
  const moved = withLineMove(base, {from:{...A, index:1}, to:{...B, index:0}});
  assert.deepEqual(cellLinesOf(moved, A), ['- 가상 교섭 3차']);
  assert.deepEqual(cellLinesOf(moved, B), ['- 가상 회의', '- 나 줄']);
  assert.throws(() => withLineMove(base, {from:{...A, index:0}, to:{section:'orgs', key:'A 지부', n:0, index:0}}), {code:'cell'});
  assert.throws(() => withLineMove(base, {from:{...A, index:5}, to:{...B, index:0}}), {code:'index'});
  // 빈 줄이 섞인 칸에서도 보이는 번호로 옮긴다.
  const gappy = {...base, rows:[{...A, lines:['', '- 가상 교섭 3차', '', '- 가상 회의']}]};
  assert.deepEqual(cellLinesOf(withLineMove(gappy, {from:{...A, index:1}, to:{...A, index:0}}), A), ['- 가상 회의', '- 가상 교섭 3차']);
  assert.ok(cellId(A.section, A.key, 0));
});

// ---- 2·4. 세부 내용 줄 고치기·빼기·더하기(draft.hand) ----
test('세부 내용 줄: 손으로 더하기·고치기·지우기, 원래 줄 고치기·빼기·원래대로 — 모양 밖은 버린다', () => {
  let h = withHandRow(null, 'details', {text:'가상 손 줄'}).hand;
  const row = handRows(h, 'details')[0];
  assert.equal(row.text, '가상 손 줄');
  h = withHandRow(h, 'details', {id:row.id, text:'가상 손 줄(고침)'}).hand;
  assert.equal(handRows(h, 'details')[0].text, '가상 손 줄(고침)');
  h = withDetailEdit(h, 'meeting:m1', {text:'가상 회의(보고 글)'}).hand;
  h = withDetailEdit(h, 'meeting:m2', {drop:true}).hand;
  assert.deepEqual([...detailEdits(h)], [['meeting:m1', {text:'가상 회의(보고 글)'}], ['meeting:m2', {drop:true}]]);
  h = withDetailEdit(h, 'meeting:m2', null).hand;
  assert.deepEqual([...detailEdits(h).keys()], ['meeting:m1']);
  assert.equal(withDetailEdit(h, 'bad ref', {drop:true}), null);
  h = withoutHandRow(h, 'details', row.id).hand;
  assert.deepEqual(handRows(h, 'details'), []);
  assert.deepEqual(readHand({details:[{id:'x', text:''}], details_edits:[{ref:'meeting:m9', text:''}, {ref:'X', drop:true}]}), null);
  assert.equal(withDetailEdit(withDetailEdit(null, 'meeting:m1', {drop:true}).hand, 'meeting:m1', null).hand, null);
});

test('세부 내용 모델: 뺀 줄은 빠지고(목록 없음) 고친 줄은 고친 글, 손 줄은 끝에 — 화면·복사 글이 같다', async () => {
  const {weeklySummary, weeklyReportText} = await import('../app/journal-weekly.js');
  const ok = items => ({status:'ok', items});
  const meetings = [
    {id:'00000000-0000-4000-8000-000000000001', title:'운영위원회', series_name:'운영위원회', round_no:3, meeting_at:'2026-10-06T01:00:00Z'},
    {id:'00000000-0000-4000-8000-000000000002', title:'가상 기자회견', series_name:'가상 기자회견', round_no:null, meeting_at:'2026-10-07T05:00:00Z'},
    {id:'00000000-0000-4000-8000-000000000003', title:'노조 상집', series_name:'노조 상집', round_no:44, meeting_at:'2026-10-07T07:00:00Z'},
  ];
  const hand = {details:[{id:'h1', text:'가상 손 줄'}], details_edits:[{ref:'meeting:00000000-0000-4000-8000-000000000001', text:'운영위원회 3차(고침)'}, {ref:'meeting:00000000-0000-4000-8000-000000000002', drop:true}]};
  const draft = {v:1, base:null, me:'', me_from:'', date:'', rows:[], titles:[], hand};
  const materials = {events:ok([]), upcoming:ok([]), tasks:ok([]), basket:ok({notes:[], links:[], docs:[]}), orgUpdates:Object.assign([], {mine:new Set()}), projectUpdates:ok([]), catalog:ok([]),
    meetings:ok(meetings), documents:ok([]), sharePages:ok([]), weekDraft:ok({missing:false, row:{exists:true, draft, saved_at:AT}})};
  const model = weeklySummary({start:'2026-10-05', lines:new Map(), linesState:'ok', today:'2026-10-06', materials, kinds:{status:'ok', list:[]}});
  assert.deepEqual(model.meetings.items.map(i => [i.text, !!i.edited, i.hand ?? '']), [['운영위원회 3차(고침)', true, ''], ['가상 손 줄', false, 'h1']]);
  assert.equal(model.meetings.detailEditable, true);
  const text = weeklyReportText(model);
  assert.match(text, /운영위원회 3차\(고침\)/); assert.match(text, /\n- 가상 손 줄\n/);
  assert.doesNotMatch(text, /가상 기자회견|노조 상집/);
});
