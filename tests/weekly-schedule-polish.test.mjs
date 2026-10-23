import test from 'node:test';
import assert from 'node:assert/strict';

// WEEKLY-일정다듬기(2026-10-23 사용자 요청 12:43 ④⑤): 5. 주요 일정 칸 '시간 / 내용 / 장소'(장소 없으면 '미정'), 화면에서 확인한 제목·장소,
// 본문과 일정표 '다름' 찾기, AI 요청·답 모양. 가짜 이름만.
const s = await import('../app/weekly-hwpx/schedule.mjs');
const w = await import('../app/journal-weekly.js');
import {readFileSync} from 'node:fs';
import {zlib, SAMPLE} from '../scripts/weekly-hwpx/cli.mjs';
import {makeFakeReport} from '../scripts/weekly-hwpx/fixture.mjs';
import {openHwpx} from '../app/weekly-hwpx/hwpx.mjs';
import {extractBlankTemplate} from '../app/weekly-hwpx/template.mjs';
import {buildReport, findTables} from '../app/weekly-hwpx/report.mjs';

const cal = Object.assign([
  {id:'a', calendarId:'k', calendarName:'공공운수노조', title:'가상에이', start:'2026-10-27T14:00:00+09:00', end:'2026-10-27T15:00:00+09:00'},
  {id:'b', calendarId:'k', calendarName:'공공운수노조', title:'가상 대표자회의', allDay:true, start:'2026-11-06', end:'2026-11-07'},
  {id:'c', calendarId:'k', calendarName:'공공운수노조', title:'가상 집회', location:'가상 광장', start:'2026-10-28T10:00:00+09:00', end:'2026-10-28T12:00:00+09:00'},
], {calendarNames:['공공운수노조']});
const START = '2026-10-19';

test('form cell: always 시간 / 내용 / 장소, no place → 미정, 종일 kept; the screen text is unchanged', () => {
  assert.equal(s.formWhat({time:'10:00', title:' 가상  회의 ', place:''}), '10:00 / 가상 회의 / 미정');
  assert.equal(s.formWhat({time:'', title:'', place:'곳'}), '종일 / (제목 없음) / 곳');
  const c = w.upcomingSchedule(cal, START);
  assert.deepEqual(c.rows.map(r => r.items.map(i => i.what)), [['14:00 / 가상에이'], ['10:00 / 가상 집회 / 가상 광장'], ['종일 / 가상 대표자회의']]);
  const f = w.scheduleForm(c, '가상 담당');
  const cells = f.calendar.flatMap(d => d.items.map(i => i.what));
  assert.deepEqual(cells, ['14:00 / 가상에이 / 미정', '10:00 / 가상 집회 / 가상 광장', '종일 / 가상 대표자회의 / 미정']);
  // An old-shape item ({what} only) stays as it is.
  assert.equal(s.itemWhat({what:'옛 칸'}), '옛 칸');
});

test('confirmed titles and places replace the calendar text in the file only; the original stays in the list', () => {
  const c = w.upcomingSchedule(cal, START);
  const items = s.scheduleItems(c);
  assert.deepEqual(items.map(i => [i.day, i.time, i.title, i.place]), [['2026-10-27', '14:00', '가상에이', ''], ['2026-10-28', '10:00', '가상 집회', '가상 광장'], ['2026-11-06', '종일', '가상 대표자회의', '']]);
  assert.ok(items.every(i => i.key));
  const overrides = new Map([[items[0].key, {title:'가상에이운영지부 임단투 점검 회의', place:''}], [items[1].key, {title:'가상 집회', place:'가상 시청 앞'}]]);
  const cells = w.scheduleForm(c, '가상 담당', overrides).calendar.flatMap(d => d.items.map(i => i.what));
  assert.deepEqual(cells, ['14:00 / 가상에이운영지부 임단투 점검 회의 / 미정', '10:00 / 가상 집회 / 가상 시청 앞', '종일 / 가상 대표자회의 / 미정']);
  // An empty confirmed title falls back to the calendar title.
  assert.equal(s.itemWhat(c.rows[0].items[0], new Map([[items[0].key, {title:' ', place:'곳'}]])), '14:00 / 가상에이 / 곳');
  // Loading or failed calendar: nothing to check.
  assert.deepEqual(s.scheduleItems({loading:true}), []);
  assert.deepEqual(s.scheduleItems({failed:['upcoming'], rows:c.rows}), []);
});

test('the .hwpx schedule table carries the confirmed cell (시간 / 내용 / 장소, 미정)', () => {
  const template = extractBlankTemplate(makeFakeReport(openHwpx(new Uint8Array(readFileSync(SAMPLE)), zlib)));
  const c = w.upcomingSchedule(cal, START);
  const items = s.scheduleItems(c);
  const f = w.scheduleForm(c, '가상 담당', new Map([[items[0].key, {title:'가상에이운영지부 임단투 점검 회의', place:''}]]));
  const {pkg} = buildReport(template, {title:'t', date:'d', ...f});
  const cells = findTables(pkg).schedule.rows.map(r => r[1]?.lines.join('') ?? '').filter(Boolean);
  assert.deepEqual(cells, ['14:00 / 가상에이운영지부 임단투 점검 회의 / 미정', '10:00 / 가상 집회 / 가상 광장', '종일 / 가상 대표자회의 / 미정']);
});

test('본문과 일정표: same day, different time is shown; same time is not; untimed lines are left alone; nothing is changed', () => {
  const c = w.upcomingSchedule(cal, START);
  const orgs = [{name:'가상에이운영지부', aliases:['가상에이']}];
  const sections = [
    {where:'철도 › 가상 공동', lines:['- 11.6.(금) 10시 가상 기자회견, 14시 가상 연석회의 예정']},
    {where:'가상에이운영지부', lines:['- 10.27.(화) 14:00 가상에이 점검 회의']},   // same time → fine
    {where:'가상 사업', lines:['- 10.29. 가상 간담회 예정']},                    // no time → not checked
    {where:'가상 사업', lines:['- 10.30.(금) 오후 3시 가상 토론회']},             // no event that day → missing
    {where:'가상 사업', lines:['- 10.10. 09:00 범위 밖 날짜']},                  // outside the 14 days
  ];
  const found = s.scheduleMismatches({sections, calendar:c, overrides:new Map(), orgs});
  assert.deepEqual(found.map(f => [f.day, f.kind, f.body, f.events]), [
    ['2026-11-06', 'time', ['10:00', '14:00'], ['종일 / 가상 대표자회의 / 미정']],
    ['2026-10-30', 'missing', ['15:00'], []],
  ]);
  assert.equal(found[0].sure, false);
  // The same organization on both sides → sure.
  const sure = s.scheduleMismatches({sections:[{where:'x', lines:['10.27. 10:00 가상에이운영지부 회의']}], calendar:c, orgs});
  assert.deepEqual(sure.map(f => [f.kind, f.sure]), [['time', true]]);
  // A confirmed title is what is compared (overrides).
  const items = s.scheduleItems(c);
  const o = new Map([[items[2].key, {title:'가상 기자회견', place:'가상 소통관'}]]);
  assert.deepEqual(s.scheduleMismatches({sections:sections.slice(0, 1), calendar:c, overrides:o, orgs})[0].events, ['종일 / 가상 기자회견 / 가상 소통관']);
  // Dates and times read from a line: several dates split the line; an end time after '~' is not a start.
  assert.deepEqual(s.lineDates('11/6 10:00~12:00 회의, 10월 28일 오후 2시 집회', c.days), [{day:'2026-11-06', times:['10:00']}, {day:'2026-10-28', times:['14:00']}]);
  assert.deepEqual(s.scheduleMismatches({sections, calendar:{loading:true}}), []);
});

test('AI request carries only week and event lines; the answer is checked against the refs sent', () => {
  const c = w.upcomingSchedule(cal, START);
  const items = s.scheduleItems(c);
  const {body, refs, more} = s.titleRequest(START, items);
  assert.deepEqual(Object.keys(body).sort(), ['events', 'kind', 'week_start']);
  assert.equal(body.kind, 'schedule_titles');
  assert.deepEqual(body.events.map(e => Object.keys(e).sort().join(',')), Array(3).fill('day,place,ref,time,title'));
  assert.deepEqual(body.events.map(e => e.ref), ['e1', 'e2', 'e3']);
  assert.equal(more, 0);
  assert.equal(JSON.stringify(body).includes(items[0].key), false, 'event ids are not sent');
  const many = Array.from({length:35}, (_, i) => ({...items[0], key:`k${i}`}));
  assert.equal(s.titleRequest(START, many).body.events.length, 30);
  assert.equal(s.titleRequest(START, many).more, 5);
  const answer = s.titleAnswer({items:[{ref:'e1', title:'가상에이운영지부 임단투 점검 회의', place:''}, {ref:'e9', title:'없음', place:''}, {ref:'e2', title:'<b>x</b>집회', place:'곳'},
    {ref:'e1', title:'두 번째', place:''}, {ref:'e3', title:'', place:''}]}, refs);
  assert.deepEqual([...answer.values()], [{title:'가상에이운영지부 임단투 점검 회의', place:''}, {title:'x집회', place:'곳'}]);
  assert.deepEqual([...s.titleAnswer(null, refs)], []);
});
