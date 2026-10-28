// MTG-보고창기본일시: 사업 보고 새 입력 창의 [일시] 기본값. 규칙은 report-default-at.mjs 한 곳, 창을 여는 길마다 들어가는 값은 아래 표로 막는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {defaultReportAt,DEFAULT_REPORT_TIME} from '../app/report-default-at.mjs';
import {dateDisplay} from '../app/time-input.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

// 한국 2026-10-27 화요일 23:30 = UTC 14:30. 한국 날짜로 읽는지(UTC 날짜 10-27이 아니라 한국 날짜) 확인하려고 한국 자정 직전과 직후를 모두 쓴다.
const NOW_KST_LATE=new Date('2026-10-27T14:30:00Z'),NOW_KST_AFTER_MIDNIGHT=new Date('2026-10-27T15:30:00Z');

test('길마다 [일시]에 들어가는 값(표)',()=>{
  const rows=[
    ['사업 보고 [+]',                    {},                                   '2026-10-27T10:00'],
    ['칸 고른 상태 [+]',                 {name:'',kind:'press'},               '2026-10-27T10:00'],
    ['담당조직 상세의 추가',              {targets:[{kind:'organization',id:'o'}]}, '2026-10-27T10:00'],
    ['프로젝트 상세의 추가',              {targets:[{kind:'project',id:'p'}]},      '2026-10-27T10:00'],
    ['구글 일정 [결과 남기기](시간 있는 일정)', {at:'2026-10-30T14:30'},         '2026-10-30T14:30'],
    ['구글 일정 [결과 남기기](종일 일정)',     {date:'2026-10-30'},              '2026-10-30T10:00'],
    ['날짜만 있는 길(달력 빈칸 등)',      {date:'2026-11-02'},                  '2026-11-02T10:00'],
    ['정리함 메모 → 사업 보고',           {at:'2026-10-25T08:05'},              '2026-10-25T08:05'],
  ];
  for(const [label,opts,want] of rows)assert.equal(defaultReportAt({...opts,now:NOW_KST_LATE}),want,label);
});
test('오늘은 한국 날짜로 읽는다(한국 자정을 넘기면 다음 날)',()=>{
  assert.equal(defaultReportAt({now:NOW_KST_LATE}),'2026-10-27T10:00');
  assert.equal(defaultReportAt({now:NOW_KST_AFTER_MIDNIGHT}),'2026-10-28T10:00');
});
test('읽을 수 없는 값은 오늘 10:00으로 돌아가고, 기본 시각은 10:00 하나다',()=>{
  assert.equal(DEFAULT_REPORT_TIME,'10:00');
  for(const bad of ['', 'abc', '2026-13', '2026-10-27T9:00', null, undefined])assert.equal(defaultReportAt({at:bad,now:NOW_KST_LATE}),'2026-10-27T10:00',String(bad));
  assert.equal(defaultReportAt({at:'2026-10-27',now:NOW_KST_LATE}),'2026-10-27T10:00');
});
test('기본값을 정하는 곳은 한 군데: 입력 창 여는 함수만 쓰고, 길은 값만 넘기며, 고치는 창은 쓰지 않는다',()=>{
  const team=read('app/team.js'),mrd=read('app/meeting-round-detail.js'),cal=read('app/calendar-interactions-v2.js');
  assert.match(team,/\$\('#meetingAt'\)\.value=defaultReportAt\(\{at,date\}\)/);
  assert.equal((team.match(/defaultReportAt\(/g)||[]).length,1);
  assert.doesNotMatch(mrd,/defaultReportAt|report-default-at/);
  assert.doesNotMatch(cal+read('app/basket.js')+read('app/workplace-detail.js')+read('app/project-system-v3.js'),/#meetingAt|meetingAt/);
  // 구글 일정: 종일은 날짜만(10:00), 시간이 있으면 그 시간.
  assert.match(cal,/e\.allDay\?\{date:String\(e\.start\)\.slice\(0,10\)\}:/);
  assert.match(cal,/\.\.\.when,location/);
});
test('날짜 칸의 보이는 글자는 한 가지(YYYY-MM-DD)다',()=>{
  assert.equal(dateDisplay('2026-10-26'),'2026-10-26');
  assert.equal(dateDisplay(''),'날짜');assert.equal(dateDisplay('2026. 10. 26.'),'날짜');
  const css=read('app/ui-standard.css');
  assert.match(css,/\.modal \.dt-date>input\[type="date"\]\{[^}]*opacity:0/);
});
