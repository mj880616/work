import test from 'node:test';
import assert from 'node:assert/strict';
import {weekTimeline,eventMinutes,linesFor,HOUR,FOLD} from '../app/calendar-week-timeline.js';

const ev=(id,start,end)=>({id,calendarId:'c',start:new Date(start),end});
const D='2026-10-15';

test('0~7시 접기: 이른 일정이 없으면 한 줄로 접고 7시부터 1시간 48px',()=>{
  const line=weekTimeline([{date:D,events:[ev('a',D+'T09:00:00+09:00',D+'T10:30:00+09:00')]}]);
  assert.equal(line.firstHour,7);assert.equal(line.collapsedHeight,FOLD);
  assert.equal(line.height,FOLD+17*HOUR);
  const at=line.place(D).get('c:a');
  assert.equal(at.top,FOLD+2*HOUR);assert.equal(at.height,1.5*HOUR);assert.equal(at.cols,1);
  assert.equal(line.ticks[0].hour,7);assert.equal(line.ticks[0].top,FOLD);
});
test('새벽 일정이 있으면 그 시부터 펼친다',()=>{
  const line=weekTimeline([{date:D,events:[]},{date:'2026-10-16',events:[ev('b','2026-10-16T05:30:00+09:00','2026-10-16T06:00:00+09:00')]}]);
  assert.equal(line.firstHour,5);assert.equal(line.ticks[0].hour,5);
  assert.equal(line.place('2026-10-16').get('c:b').top,FOLD+0.5*HOUR);
  const zero=weekTimeline([{date:D,events:[ev('z',D+'T00:10:00+09:00',D+'T01:00:00+09:00')]}]);
  assert.equal(zero.firstHour,0);assert.equal(zero.collapsedHeight,0);assert.equal(zero.height,24*HOUR);
});
test('자정을 넘기는 끝은 그날 칸 끝(24시)에서 자르고, 전날 시작은 0시부터',()=>{
  assert.deepEqual(eventMinutes(ev('m',D+'T22:00:00+09:00','2026-10-16T00:00:00+09:00'),D),{start:1320,end:1440});
  assert.deepEqual(eventMinutes({start:'2026-10-14T23:00:00+09:00',end:D+'T01:00:00+09:00'},D),{start:0,end:60});
});
test('겹치는 일정은 열을 나눠 나란히, 겹치지 않으면 한 열',()=>{
  const line=weekTimeline([{date:D,events:[
    ev('a',D+'T09:00:00+09:00',D+'T11:00:00+09:00'),
    ev('b',D+'T10:00:00+09:00',D+'T12:00:00+09:00'),
    ev('c',D+'T11:00:00+09:00',D+'T11:30:00+09:00'),
    ev('d',D+'T13:00:00+09:00',D+'T14:00:00+09:00')]}]);
  const p=line.place(D);
  assert.deepEqual([p.get('c:a').col,p.get('c:b').col,p.get('c:c').col],[0,1,0]);
  assert.equal(p.get('c:a').cols,2);assert.equal(p.get('c:c').cols,2);
  assert.equal(p.get('c:d').cols,1);assert.equal(p.get('c:d').col,0);
});
test('짧은 일정도 최소 높이와 줄 수 규칙을 가진다',()=>{
  const line=weekTimeline([{date:D,events:[ev('s',D+'T09:00:00+09:00',D+'T09:00:00+09:00')]}]);
  assert.equal(line.place(D).get('c:s').height,18);
  assert.equal(linesFor(24),0);assert.equal(linesFor(48),2);assert.equal(linesFor(36),1);
});
