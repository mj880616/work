import test from 'node:test';
import assert from 'node:assert/strict';
import {minuteAtY,slotStart,slotEnd,clickSlot,rangeSlot,allDaySlot,dateSlot} from '../app/calendar-create-slot.js';

const D='2026-10-29';
test('누른 높이를 분으로: 1시간 48px',()=>{
  assert.equal(minuteAtY(148,100,48),60);assert.equal(minuteAtY(100+15*48,100,48),15*60);
});
test('15분 칸 시작은 내림, 끝은 올림, 하루 안으로 제한',()=>{
  assert.equal(slotStart(15*60),900);assert.equal(slotStart(15*60+40),15*60+30);assert.equal(slotStart(-5),0);assert.equal(slotStart(1439),1425);
  assert.equal(slotEnd(15*60+1),15*60+15);assert.equal(slotEnd(1500),1440);assert.equal(slotEnd(0),15);
});
test('목 29일 15시 칸을 누르면 10/29 15:00~16:00',()=>{
  assert.deepEqual(clickSlot(D,15*60+7),{kind:'time',startDate:D,startTime:'15:00',endDate:D,endTime:'16:00'});
});
test('15분 칸 경계: 15:15와 15:44',()=>{
  assert.equal(clickSlot(D,15*60+15).startTime,'15:15');assert.equal(clickSlot(D,15*60+44).startTime,'15:30');
});
test('23:30 칸은 끝이 다음 날 00:30',()=>{
  assert.deepEqual(clickSlot(D,23*60+31),{kind:'time',startDate:D,startTime:'23:30',endDate:'2026-10-30',endTime:'00:30'});
});
test('0시 칸과 월말 넘김',()=>{
  assert.equal(clickSlot(D,0).startTime,'00:00');
  assert.equal(clickSlot('2026-10-31',23*60+45).endDate,'2026-11-01');
});
test('끌어서 고른 범위: 위아래 방향 무관, 끝 칸 포함',()=>{
  const want={kind:'time',startDate:D,startTime:'14:00',endDate:D,endTime:'16:30'};
  assert.deepEqual(rangeSlot(D,14*60+5,16*60+20),want);assert.deepEqual(rangeSlot(D,16*60+20,14*60+5),want);
});
test('끌기가 아주 짧아도 한 칸(15분), 하루 끝은 다음 날 00:00',()=>{
  assert.deepEqual(rangeSlot(D,10*60,10*60+2),{kind:'time',startDate:D,startTime:'10:00',endDate:D,endTime:'10:15'});
  assert.deepEqual(rangeSlot(D,23*60+10,1440),{kind:'time',startDate:D,startTime:'23:00',endDate:'2026-10-30',endTime:'00:00'});
});
test('종일 칸은 그날 종일, 월간 날짜 칸은 그 날짜의 예전 기본 9~10시',()=>{
  assert.deepEqual(allDaySlot(D),{kind:'allday',startDate:D,endDate:D});
  assert.deepEqual(dateSlot(D),{kind:'time',startDate:D,startTime:'09:00',endDate:D,endTime:'10:00'});
});
