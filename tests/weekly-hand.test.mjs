// WEEKLY-한흐름확정 ⑤ 남은 부분: 손으로 더한 줄(app/weekly-hand.mjs — draft.hand: 5. 주요 일정·참고)과 칸 줄 밖 동작 기록(weekly-draft-store.js withLinePick).
// 이름·일정·글은 모두 가짜.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readHand, handRows, withHandRow, withoutHandRow, withHandCalendar, handText, handId, HAND_CALENDAR_MAX, HAND_NOTE_MAX} from '../app/weekly-hand.mjs';
import {makeDraft, readDraft, merge3, keepDocsOnly, draftHand, withHand, draftCells, hasContent, withLinePick} from '../app/weekly-draft-store.js';
import {readPicks, learnPicks, sigLabel} from '../app/weekly-picks.mjs';
import {scheduleItems} from '../app/weekly-hwpx/schedule.mjs';
import * as weekly from '../app/journal-weekly.js';

const C1 = {id:'h1', day:'2026-10-14', time:'09:30', title:'가상 손 회의', place:'가상 회관'};
const N1 = {id:'n1', text:'가상 메모 한 줄'};

test('모양: 5. 주요 일정 줄은 2) 주요 일정 줄과 같은 검사(내용 필수·시간 모양), 달력 키는 버림, 메모는 한 줄 글, 둘 다 비면 null', () => {
  assert.equal(readHand(null), null);
  assert.equal(readHand({calendar:[], notes:[]}), null);
  assert.deepEqual(readHand({calendar:[{...C1, event:'c:x', extra:1}, {id:'h2', day:'2026-10-14', title:''}], notes:[N1, {id:'n2', text:' \n '}, {id:'bad id', text:'가'}], other:1}),
    {calendar:[C1], notes:[N1]});
  assert.equal(readHand({calendar:[{...C1, time:'25:00'}]}).calendar[0].time, '');
  assert.equal([...readHand({notes:[{id:'n3', text:'가'.repeat(500)}]}).notes[0].text].length, HAND_NOTE_MAX);
  const many = Array.from({length:HAND_CALENDAR_MAX + 5}, (_, i) => ({id:`h${i}`, day:'2026-10-14', title:`가상 ${i}`}));
  assert.equal(readHand({calendar:many}).calendar.length, HAND_CALENDAR_MAX);
});

test('더하기·고치기·지우기: 고치기는 고치기 전 줄(before)을 함께, 내용이 비면 null, 가득 차면 null', () => {
  const a = withHandRow(null, 'calendar', {day:C1.day, time:'930', title:C1.title, place:C1.place});
  assert.equal(a.before, null);
  assert.deepEqual({...a.row, id:'h1'}, C1);
  const id = a.row.id;
  const b = withHandRow(a.hand, 'calendar', {id, day:C1.day, time:'10:00', title:'가상 고친 회의', place:''});
  assert.equal(b.before.title, C1.title);
  assert.deepEqual(handRows(b.hand, 'calendar').map(r => [r.time, r.title]), [['10:00', '가상 고친 회의']]);
  assert.equal(withHandRow(b.hand, 'calendar', {day:C1.day, title:'  '}), null);
  const n = withHandRow(b.hand, 'notes', {text:N1.text});
  assert.deepEqual(handRows(n.hand, 'notes').map(r => r.text), [N1.text]);
  assert.equal(handRows(n.hand, 'calendar').length, 1); // 다른 칸은 그대로
  const gone = withoutHandRow(n.hand, 'calendar', id);
  assert.equal(gone.row.title, '가상 고친 회의');
  assert.deepEqual(gone.hand, {notes:handRows(n.hand, 'notes')});
  assert.equal(withoutHandRow(gone.hand, 'calendar', id), null);
  assert.equal(withHandRow(null, 'other', {text:'가'}), null);
  const full = {calendar:Array.from({length:HAND_CALENDAR_MAX}, (_, i) => ({id:`f${i}`, day:'2026-10-14', title:`가상 ${i}`}))};
  assert.equal(withHandRow(full, 'calendar', {day:'2026-10-14', title:'하나 더'}), null);
  assert.ok(withHandRow(full, 'calendar', {id:'f0', day:'2026-10-14', title:'고치기는 됨'})); // 있는 줄 고치기는 가득 차도 됨
  assert.equal(handText('calendar', C1), '10.14.(수) 09:30 / 가상 손 회의 / 가상 회관');
  assert.equal(handText('notes', N1), N1.text);
  assert.equal(handId('hand:h1'), 'h1'); assert.equal(handId('c:x'), '');
});

test('임시저장: 읽기·3자 비교·[처음부터]에서도 남고, "고친 칸"은 아니다(이어 쓰기 질문 없음)', () => {
  const hand = {calendar:[C1], notes:[N1]};
  const d = makeDraft({hand});
  assert.deepEqual(draftHand(d), hand);
  assert.equal(hasContent(d), false);
  assert.deepEqual(draftHand(readDraft(JSON.parse(JSON.stringify(d)))), hand);
  assert.deepEqual(draftCells(d).get('hand'), hand);
  assert.deepEqual(draftHand(keepDocsOnly(d)), hand);
  // 한쪽(이 기기)만 손 줄을 바꿨으면 그 판, 서버만 바꿨으면 서버 판, 둘 다 다르게 바꿨으면 충돌(서버 값).
  const base = makeDraft({hand}), mine = withHand(base, {calendar:[C1], notes:[N1, {id:'n2', text:'가상 둘째'}]}), theirs = makeDraft({hand, date:'2026-10-13'});
  const m = merge3(base, mine, theirs);
  assert.deepEqual(m.conflicts, []);
  assert.equal(draftHand(m.draft).notes.length, 2);
  assert.equal(m.draft.date, '2026-10-13');
  const other = withHand(base, {calendar:[], notes:[{id:'n3', text:'가상 서버 쪽'}]});
  const c = merge3(base, mine, other);
  assert.deepEqual(c.conflicts.map(x => x.cell), ['hand']);
  assert.deepEqual(draftHand(c.draft), {notes:[{id:'n3', text:'가상 서버 쪽'}]});
});

const calendar = () => ({days:['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'], vacations:[], rows:[
  {day:'2026-10-14', label:'10.14.(수)', items:[{what:'종일 / 가상 종일', key:'c:a', time:'종일', title:'가상 종일', place:''}, {what:'10:30 / 가상 달력 회의', key:'c:b', time:'10:30', title:'가상 달력 회의', place:''}]},
  {day:'2026-10-14', label:'10.14.(수) ~ 10.15.(목)', items:[{what:'가상 여러 날', key:'c:m', time:'종일', title:'가상 여러 날', place:'', multi:true}]}]});
const what = h => [h.time, h.title, h.place].filter(Boolean).join(' / ');

test('5. 주요 일정 표: 손 줄은 그날 하루 일정 줄에 시간 순(종일 먼저, 시간 없는 줄 끝), 일정 없는 날은 새 날 줄, 2주 밖 날짜는 빠짐', () => {
  const rows = [C1, {id:'h2', day:'2026-10-14', time:'', title:'가상 시간 없음', place:''}, {id:'h3', day:'2026-10-12', time:'08:00', title:'가상 월요일', place:''}, {id:'h4', day:'2026-11-30', time:'', title:'가상 밖', place:''}];
  const out = withHandCalendar({...calendar(), allRows:calendar().rows}, rows, what);
  assert.deepEqual(out.rows.map(r => [r.label, r.items.map(i => i.title)]), [
    ['10.12.(월)', ['가상 월요일']],
    ['10.14.(수)', ['가상 종일', '가상 손 회의', '가상 달력 회의', '가상 시간 없음']],
    ['10.14.(수) ~ 10.15.(목)', ['가상 여러 날']]]);
  assert.deepEqual(out.allRows.map(r => r.items.length), [1, 4, 1]);
  assert.equal(out.handCount, 3);
  const hand = out.rows[1].items[1];
  assert.deepEqual({key:hand.key, hand:hand.hand, what:hand.what}, {key:'hand:h1', hand:'h1', what:'09:30 / 가상 손 회의 / 가상 회관'});
  // 달력 일정이 아니라서 칸별 고침·기억·빼기·[달력에서] 목록(scheduleItems)에는 없다.
  assert.deepEqual(scheduleItems(out).map(i => i.key), ['c:a', 'c:b', 'c:m']);
  // 한글 파일 5. 주요 일정 표에는 달력 일정과 같은 줄(참석 = 내 이름).
  const form = weekly.scheduleForm(out, '가상 담당');
  assert.deepEqual(form.calendar.find(d => d.day === '10.12.(월)').items, [{what:'08:00 / 가상 월요일 / 미정', who:['가상 담당']}]);
  assert.deepEqual(form.calendar.find(d => d.day === '10.14.(수)').items.map(i => i.what), ['종일 / 가상 종일 / 미정', '09:30 / 가상 손 회의 / 가상 회관', '10:30 / 가상 달력 회의 / 미정', '종일 / 가상 시간 없음 / 미정']); // 시간 없는 줄은 파일 칸 규칙대로 '종일'
  // 읽는 중·실패·손 줄 없음은 그대로.
  assert.deepEqual(withHandCalendar({loading:true}, rows, what), {loading:true});
  const c = calendar();
  assert.equal(withHandCalendar(c, [], what), c);
});

test('주간 정리 모델·복사 글: 손 줄은 5. 주요 일정 줄과 참고 "내 메모"(한글 파일 칸 밖)로', () => {
  const draft = makeDraft({hand:{calendar:[{id:'h1', day:'2026-10-13', time:'15:00', title:'가상 손 일정', place:''}], notes:[N1]}});
  const materials = {weekDraft:{status:'ok', items:{missing:false, row:{exists:true, draft, saved_at:null}}}, upcoming:{status:'ok', items:[]}};
  const model = weekly.weeklySummary({start:'2026-10-05', lines:new Map(), materials, today:'2026-10-09'});
  assert.deepEqual(model.hand.notes, [N1]);
  assert.deepEqual(model.hand.calendar.map(r => r.title), ['가상 손 일정']);
  assert.deepEqual(model.calendar.rows.map(r => [r.label, r.items.map(i => i.what)]), [['10.13.(화)', ['15:00 / 가상 손 일정']]]);
  const text = weekly.weeklyReportText(model);
  assert.match(text, /5\. 주요 일정[^\n]*\n- 10\.13\.\(화\) 15:00 \/ 가상 손 일정/);
  assert.match(text, /◦ 내 메모\n- 가상 메모 한 줄/);
  assert.ok(text.indexOf('◦ 내 메모') > text.indexOf('\n참고'));
});

test('칸 줄 밖 동작 기록(withLinePick): 1. 요청사항·5. 주요 일정·참고 — 손 동작은 보고서 줄(학습 셈 밖), 지난주 줄·달력 고르기는 제안 답', () => {
  const at = '2026-10-06T01:00:00.000Z';
  let d = withLinePick(null, {cell:'requests:ask', act:'add', text:'10.13.(화) 가상 토론회', at});
  d = withLinePick(d, {cell:'requests:hq', act:'fix', text:'새 글', before:'옛 글', at});
  d = withLinePick(d, {cell:'calendar', act:'cut', text:'10.14.(수) 09:30 / 가상 손 회의', at});
  d = withLinePick(d, {cell:'notes', act:'add', text:'가상 메모', at});
  d = withLinePick(d, {cell:'requests:ask', kind:'carried', act:'drop', text:'10.14.(수) 지난주 줄', at});
  d = withLinePick(d, {cell:'requests:hq', kind:'calendar', from:'calendar', act:'take', text:'10.13.(화) 10:30 / 가상 회의', at});
  // 모양 밖은 그대로: 모르는 칸, 빈 글, 같은 글로 고치기, 보고서 줄에 제안 답·제안에 줄 동작.
  for (const bad of [{cell:'summary:x', act:'add', text:'가'}, {cell:'notes', act:'add', text:' '}, {cell:'notes', act:'fix', text:'같음', before:'같음'},
    {cell:'notes', act:'take', text:'가'}, {cell:'requests:ask', kind:'carried', act:'add', text:'가'}]) assert.equal(withLinePick(d, bad), d);
  const items = readPicks(d.picks).items;
  assert.deepEqual(items.map(x => [x.kind, x.from, x.cell, x.act]), [
    ['line', 'hand', 'requests:ask', 'add'], ['line', '', 'requests:hq', 'fix'], ['line', '', 'calendar', 'cut'], ['line', 'hand', 'notes', 'add'],
    ['carried', '', 'requests:ask', 'drop'], ['calendar', 'calendar', 'requests:hq', 'take']]);
  assert.equal(items[1].before, '옛 글');
  // 되돌리기(none)는 같은 글의 앞 기록을 지운 표시로 바꾼다.
  const undone = readPicks(withLinePick(d, {cell:'requests:ask', kind:'carried', act:'none', text:'10.14.(수) 지난주 줄', at:'2026-10-06T02:00:00.000Z'}).picks).items;
  assert.equal(undone.find(x => x.kind === 'carried').act, 'none');
  // 학습 셈은 제안 답만(지난주 줄 빼기·달력 고르기), 칸 이름은 일상어로.
  assert.deepEqual(sigLabel('carried||requests:ask'), '지난주 줄 · 1. 1) 임원 배정 요청');
  assert.deepEqual(sigLabel('line|hand|notes'), '보고서 줄 · 손 · 참고');
  assert.equal(typeof learnPicks, 'function');
});
