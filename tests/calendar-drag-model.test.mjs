import test from 'node:test';
import assert from 'node:assert/strict';
import {snap,canDrag,moveTimed,resizeTimed,moveBand,resizeBand,moveDays,original,same,updateBody,label,dayDiff} from '../app/calendar-drag-model.js';

const T=(d,t)=>new Date(`${d}T${t}:00+09:00`).toISOString();
const timed={id:'e1',calendarId:'c',start:'2026-10-21T10:00:00+09:00',end:'2026-10-21T11:30:00+09:00'};

test('15분 단위 반올림',()=>{
  assert.equal(snap(7),0);assert.equal(snap(8),15);assert.equal(snap(22),15);assert.equal(snap(23),30);assert.equal(snap(-8),-15);
});
test('시간 일정: 위아래로 끌면 시간, 옆으로 끌면 날짜(길이 유지, 15분 맞춤)',()=>{
  assert.deepEqual(moveTimed(timed,{minuteDelta:37}),{allDay:false,start:T('2026-10-21','10:30'),end:T('2026-10-21','12:00')});
  assert.deepEqual(moveTimed(timed,{dayDelta:2,minuteDelta:-61}),{allDay:false,start:T('2026-10-23','09:00'),end:T('2026-10-23','10:30')});
  assert.deepEqual(moveTimed(timed,{dayDelta:-1}),{allDay:false,start:T('2026-10-20','10:00'),end:T('2026-10-20','11:30')});
});
test('시간 일정: 15분 단위가 아닌 시작도 칸에 맞춰지고, 0시 앞으로는 못 감',()=>{
  const odd={...timed,start:'2026-10-21T10:07:00+09:00',end:'2026-10-21T10:52:00+09:00'};
  assert.equal(moveTimed(odd,{minuteDelta:0}).start,T('2026-10-21','10:00'));
  assert.equal(moveTimed(timed,{minuteDelta:-900}).start,T('2026-10-21','00:00'));
});
test('시간 일정: 자정 넘김 — 밤 늦게 놓으면 끝은 다음 날로',()=>{
  const r=moveTimed(timed,{minuteDelta:13*60});
  assert.deepEqual(r,{allDay:false,start:T('2026-10-21','23:00'),end:T('2026-10-22','00:30')});
  assert.equal(label(r),'23:00–10월 22일 00:30');
  assert.equal(moveTimed(timed,{minuteDelta:2000}).start,T('2026-10-21','23:45'));
});
test('아래 끝 끌기: 끝 시간만 바뀌고 최소 15분, 최대 그날 24시',()=>{
  assert.deepEqual(resizeTimed(timed,{minuteDelta:20}),{allDay:false,start:T('2026-10-21','10:00'),end:T('2026-10-21','11:45')});
  assert.equal(resizeTimed(timed,{minuteDelta:-500}).end,T('2026-10-21','10:15'));
  const r=resizeTimed(timed,{minuteDelta:5000});assert.equal(r.end,T('2026-10-22','00:00'));assert.equal(label(r),'10:00–24:00');
});
test('종일·여러 날 띠: 옆으로 끌면 날짜 이동, 끝 끌면 기간 늘리기·줄이기(최소 하루)',()=>{
  const band={id:'b',calendarId:'c',allDay:true,start:'2026-10-30',end:'2026-11-02'};
  assert.deepEqual(moveBand(band,{dayDelta:3}),{allDay:true,start:'2026-11-02',end:'2026-11-05'});
  assert.deepEqual(resizeBand(band,{dayDelta:2}),{allDay:true,start:'2026-10-30',end:'2026-11-04'});
  assert.deepEqual(resizeBand(band,{dayDelta:-5}),{allDay:true,start:'2026-10-30',end:'2026-10-31'});
  assert.equal(label(moveBand(band,{dayDelta:3})),'11월 2일–11월 4일');
  const multi={id:'m',calendarId:'c',start:'2026-10-21T22:00:00+09:00',end:'2026-10-22T09:00:00+09:00'};
  assert.deepEqual(moveBand(multi,{dayDelta:1}),{allDay:false,start:T('2026-10-22','22:00'),end:T('2026-10-23','09:00')});
  assert.equal(resizeBand(multi,{dayDelta:-1}),null);
});
test('월간: 다른 날로 옮기면 시간·길이는 그대로',()=>{
  assert.deepEqual(moveDays(timed,dayDiff('2026-10-21','2026-11-03')),{allDay:false,start:T('2026-11-03','10:00'),end:T('2026-11-03','11:30')});
  assert.deepEqual(moveDays({allDay:true,start:'2026-10-21',end:'2026-10-22'},-21),{allDay:true,start:'2026-09-30',end:'2026-10-01'});
});
test('권한: 수정 창과 같은 owner·writer 캘린더만 끌 수 있음',()=>{
  const state={calendars:[{id:'me@x',primary:true,accessRole:'owner'},{id:'w',accessRole:'writer'},{id:'r',accessRole:'reader'},{id:'f',accessRole:'freeBusyReader'}]};
  assert.equal(canDrag('primary',state),true);assert.equal(canDrag('w',state),true);
  assert.equal(canDrag('r',state),false);assert.equal(canDrag('f',state),false);assert.equal(canDrag('없음',state),false);assert.equal(canDrag('w',null),false);
});
test('되돌리기 값: 옮기기 전 시작·끝 그대로이고, 같은 자리는 저장하지 않음',()=>{
  const back=original(timed);
  assert.deepEqual(back,{allDay:false,start:T('2026-10-21','10:00'),end:T('2026-10-21','11:30')});
  assert.equal(same(timed,moveTimed(timed,{minuteDelta:5})),true);
  assert.equal(same(timed,moveTimed(timed,{minuteDelta:15})),false);
  assert.equal(same({...timed,start:'2026-10-21T01:00:00Z',end:'2026-10-21T02:30:00Z'},back),true);
  assert.deepEqual(original({allDay:true,start:'2026-10-21',end:'2026-10-23'}),{allDay:true,start:'2026-10-21',end:'2026-10-23'});
});
test('저장 본문: 수정 창과 같은 update-event, 시간만 바뀌고 제목·메모·장소·담당조직은 읽은 값 그대로',()=>{
  const fresh={id:'e1',calendarId:'c',title:'회의',description:'메모',location:'본부',organizationIds:['o1'],colorId:'3'};
  const b=updateBody(fresh,moveTimed(timed,{minuteDelta:60}));
  assert.deepEqual(b,{action:'update-event',calendar_id:'c',event_id:'e1',title:'회의',memo:'메모',location:'본부',all_day:false,organization_ids:['o1'],start_date:'2026-10-21',end_date:'2026-10-21',start_iso:T('2026-10-21','11:00'),end_iso:T('2026-10-21','12:30')});
  assert.equal('color_hex' in b,false);assert.equal('target_calendar_id' in b,false);
  const all=updateBody(fresh,{allDay:true,start:'2026-11-02',end:'2026-11-05'});
  assert.equal(all.all_day,true);assert.equal(all.start_date,'2026-11-02');assert.equal(all.end_date,'2026-11-04');assert.equal('start_iso' in all,false);
});
