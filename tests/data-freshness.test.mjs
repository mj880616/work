import {test} from 'node:test';
import assert from 'node:assert/strict';
import {freshnessText} from '../app/data-freshness.js';
import {homeEventRows} from '../app/home-read-model.js';

// CAL-저장본먼저: the one status line of screens that show this device's saved copy first.
test('freshness line says loading, refreshing, not latest with the last check time in Korea, or failed',()=>{
  assert.equal(freshnessText('loading'),'불러오는 중…');
  assert.equal(freshnessText('refresh'),'새로 불러오는 중');
  assert.equal(freshnessText('stale',Date.parse('2026-10-21T15:07:00Z')),'최신 아님 · 마지막 확인 00:07');
  assert.equal(freshnessText('stale',0),'최신 아님');
  assert.equal(freshnessText('failed'),'불러오지 못했습니다');
  assert.equal(freshnessText(''),'');
});
test('home 오늘 일정 rows keep event and calendar ids so a deleted event can be dropped from the copy',()=>{
  const now=Date.parse('2026-10-22T03:00:00Z');
  const rows=homeEventRows([
    {id:'e1',calendarId:'c1',title:'오늘',start:'2026-10-22T10:00:00+09:00',end:'2026-10-22T11:00:00+09:00'},
    {id:'e2',calendarId:'c1',title:'내일',start:'2026-10-23T10:00:00+09:00',end:'2026-10-23T11:00:00+09:00'},
    {id:'e3',calendarId:'c2',title:'취소',status:'cancelled',start:'2026-10-22T10:00:00+09:00',end:'2026-10-22T11:00:00+09:00'},
  ],{colors:{c1:'#112233'}},now);
  assert.deepEqual(rows,[{id:'e1',calendarId:'c1',start:'2026-10-22T10:00:00+09:00',end:'2026-10-22T11:00:00+09:00',allDay:false,title:'오늘',color:'#112233'}]);
});
