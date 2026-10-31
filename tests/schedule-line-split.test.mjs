// FORM-시간숫자 + WEEKLY-장소칸(요청함 10/31 00:28·00:31): 한 줄 모양('10:30 / 제목 / 장소') 일정 제목을 읽을 때 칸별로 나누기,
// 종일을 받는 공용 시간 칸 값. 이름은 모두 합성.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseScheduleLine, splitScheduleFields} from '../app/schedule-line-split.mjs';
import {eventFields, editFrom, hqFields} from '../app/weekly-schedule-rows.mjs';
import {itemWhat} from '../app/weekly-hwpx/schedule.mjs';
import {annotateCalendar} from '../app/weekly-schedule-memory.js';
import {cellTime, normalizeTime, TIME_HINT, TIME_PLACEHOLDER} from '../app/time-input.js';

test('parseScheduleLine: 시각으로 시작하는 한 줄만 나눈다', () => {
  assert.deepEqual(parseScheduleLine('10:30 / 가상 결의대회 / 가상 시의회'), {time:'10:30', title:'가상 결의대회', place:'가상 시의회'});
  assert.deepEqual(parseScheduleLine('9:05 / 가상 회의'), {time:'09:05', title:'가상 회의', place:''});
  assert.deepEqual(parseScheduleLine('14:00 / 가상 A / 가상 B / 가상 회관'), {time:'14:00', title:'가상 A / 가상 B', place:'가상 회관'});
  assert.deepEqual(parseScheduleLine('종일 / 가상 수련회 / 가상 연수원'), {time:'종일', title:'가상 수련회', place:'가상 연수원'});
  for (const plain of ['가상 회의 / 가상 회관', '가상 회의', '', '25:00 / 가상 회의', '10:30 /  / 가상 회관', '10:30'])
    assert.equal(parseScheduleLine(plain), null, plain);
});

test('splitScheduleFields: 빈·종일 시간은 제목 앞 시각으로, 장소는 비었을 때만', () => {
  assert.deepEqual(splitScheduleFields({time:'종일', title:'10:30 / 가상 결의대회 / 가상 시의회', place:''}), {time:'10:30', title:'가상 결의대회', place:'가상 시의회'});
  assert.deepEqual(splitScheduleFields({time:'', title:'10:30 / 가상 결의대회', place:'가상 회관', day:'2026-11-10'}), {time:'10:30', title:'가상 결의대회', place:'가상 회관', day:'2026-11-10'});
  // 다른 시간·다른 장소가 이미 있으면 그 값을 두고, 마지막 부분은 제목에 남긴다.
  assert.deepEqual(splitScheduleFields({time:'14:00', title:'10:30 / 가상 결의대회 / 가상 시의회', place:'가상 회관'}), {time:'14:00', title:'가상 결의대회 / 가상 시의회', place:'가상 회관'});
  assert.deepEqual(splitScheduleFields({time:'종일', title:'10:30 / 가상 결의대회 / 가상 시의회', place:'가상 시의회'}), {time:'10:30', title:'가상 결의대회', place:'가상 시의회'});
  const plain = {time:'10:30', title:'가상 회의 / 2부', place:''};
  assert.equal(splitScheduleFields(plain), plain);
});

const combined = {key:'c:x', day:'2026-11-10', label:'11.10.(화)', time:'종일', title:'10:30 / 가상 결의대회 / 가상 시의회', place:''};
test('주간보고 일정 칸: 달력·기억·임시저장의 한 줄 모양을 칸별로 읽고, 고치지 않으면 저장할 것이 없다', () => {
  assert.deepEqual(eventFields(combined, undefined, '가상 담당'), {day:'2026-11-10', time:'10:30', title:'가상 결의대회', place:'가상 시의회', who:'가상 담당'});
  const memo = {...combined, title:'가상 원래 제목', memo:{key:'가상원래제목', title:'10:30 / 가상 결의대회 / 가상 시의회'}};
  assert.deepEqual(eventFields(memo), {day:'2026-11-10', time:'10:30', title:'가상 결의대회', place:'가상 시의회', who:''});
  const plainItem = {...combined, time:'종일', title:'가상 원래 제목'};
  assert.deepEqual(eventFields(plainItem, {title:'10:30 / 가상 결의대회 / 가상 시의회', place:''}), {day:'2026-11-10', time:'10:30', title:'가상 결의대회', place:'가상 시의회', who:''});
  // 화면이 보인 나뉜 값 그대로면 고침 없음. 칸에 한 줄 모양을 붙여 넣어도 나뉜 모양으로 저장.
  assert.equal(editFrom(combined, {day:'2026-11-10', time:'10:30', title:'가상 결의대회', place:'가상 시의회', who:''}), null);
  assert.deepEqual(editFrom(plainItem, {title:'11:00 / 가상 집회 / 가상 광장'}), {title:'가상 집회', place:'가상 광장', time:'11:00'});
});

test('한글 파일 칸·2) 주요 일정 수기 줄·화면 글: 시간이 두 번 들어가지 않는다', () => {
  assert.equal(itemWhat(combined, new Map()), '10:30 / 가상 결의대회 / 가상 시의회');
  assert.equal(itemWhat({...combined, title:'가상 수련회'}, new Map()), '종일 / 가상 수련회 / 미정');
  assert.deepEqual(hqFields({id:'r1', day:'2026-11-10', time:'', title:'10:30 / 가상 결의대회 / 가상 시의회', place:''}), {day:'2026-11-10', time:'10:30', title:'가상 결의대회', place:'가상 시의회', linked:false});
  const cal = {days:['2026-11-10'], rows:[{day:'2026-11-10', label:'11.10.(화)', items:[{key:'c:x', time:'종일', title:'가상 원래', place:'', what:'종일 / 가상 원래'}]}], vacations:[]};
  const memory = [{key:'가상원래', origin:'가상 원래', title:'10:30 / 가상 결의대회 / 가상 시의회', saved:'2026-10-01'}];
  assert.equal(annotateCalendar(cal, memory).rows[0].items[0].what, '10:30 / 가상 결의대회 / 가상 시의회');
});

test('공용 시간 칸: 숫자만 맞춤, 종일은 종일 칸에서만, 흐린 글자는 칸 이름', () => {
  for (const [raw, want] of [['1030', '10:30'], ['930', '09:30'], ['9', '09:00'], ['10', '10:00'], ['2575', null], ['', '']]) assert.equal(normalizeTime(raw), want, raw);
  assert.equal(cellTime('종일', {allDay:true}), '종일');
  assert.equal(cellTime('종일'), null);
  assert.equal(cellTime('1030', {allDay:true}), '10:30');
  assert.equal(cellTime('2575', {allDay:true}), null);
  assert.equal(TIME_HINT, '시간을 확인해 주세요');
  assert.equal(TIME_PLACEHOLDER, '시간');
});
