import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as time from '../app/meeting-time.js';
import {normalizeTime} from '../app/time-input.js';
import {eventColor} from '../app/home-read-model.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=name=>readFileSync(new URL('../app/'+name,import.meta.url),'utf8');
for(const tz of ['Asia/Seoul','Europe/Rome','America/Los_Angeles'])test(`공용 한국 날짜·요일·월 경계·입력 왕복 ${tz}`,()=>{
  const previous=process.env.TZ;process.env.TZ=tz;
  try{
    assert.equal(typeof time.seoulDateKey,'function','공용 한국 날짜 도구가 필요하다');
    for(const [input,iso] of [['2026-09-15T10:00','2026-09-15T01:00:00.000Z'],['2026-10-01T00:30','2026-09-30T15:30:00.000Z'],['2026-09-30T23:30','2026-09-30T14:30:00.000Z']]){
      assert.equal(time.toSeoulISO(input),iso);
      assert.equal(time.seoulInputValue(iso),input);
      assert.equal(time.toSeoulISO(time.seoulInputValue(iso)),iso);
      assert.equal(time.seoulDateKey(iso),input.slice(0,10));
    }
    assert.equal(time.seoulDateKey('2026-10-01'),'2026-10-01');
    assert.equal(time.seoulDateKey(new Date('2026-12-31T15:01:00Z')),'2027-01-01');
    assert.equal(time.seoulParts('2026-09-14T15:30:00Z').weekday,2);
    assert.equal(time.seoulDayStart('2026-10-01').toISOString(),'2026-09-30T15:00:00.000Z');
    assert.equal(time.seoulDateKey(time.addSeoulDays(time.seoulDate(2026,8,30),1)),'2026-10-01');
    assert.match(time.formatSeoulTime('2026-09-15T01:00:00Z',{hour:'2-digit',minute:'2-digit',month:undefined,day:undefined}),/오전 10:00/);
    for(const invalid of ['2026-02-30T10:00','2026-10-01T25:00','2026-10-01'])assert.throws(()=>time.toSeoulISO(invalid),RangeError);
  }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous}
});
for(const tz of ['Asia/Seoul','Europe/Rome','America/Los_Angeles'])test(`일정 등록 폼과 프로젝트 폼이 동일 UTC 저장 ${tz}`,()=>{
  const previous=process.env.TZ;process.env.TZ=tz;
  try{
    const values={'#eventTitle':'일정','#eventStartDate':'2026-10-01','#eventEndDate':'2026-10-01','#eventStartTime':'00:30','#eventEndTime':'01:30','#ps3MilestoneTitle':'일정','#ps3MilestoneAt':'2026-10-01T00:30','#ps3MilestoneNotes':''};
    const $=key=>({value:values[key]||'',checked:false});
    const context=vm.createContext({...time,normalizeTime,document:{querySelector:$},$,cmColorValue:()=>({hex:'#4285f4'}),Date});
    const calendar=source('calendar-plus.js');vm.runInContext(calendar.slice(calendar.indexOf('function cmForm(){'),calendar.indexOf('async function cmSaveGoogle(){'))+';this.form=cmForm',context);
    assert.equal(context.form().start_iso,'2026-09-30T15:30:00.000Z');
    const project=source('project-system-v3.js');vm.runInContext(project.slice(project.indexOf('function milestoneVisibleBody(){'),project.indexOf('function milestoneFullBody('))+';this.project=milestoneVisibleBody',context);
    assert.equal(context.project().start_at,'2026-09-30T15:30:00.000Z');
  }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous}
});
test('달력은 잘못된 종료일을 걸러내고 나머지 정상 일정을 유지한다',()=>{
  const context=vm.createContext({...time,eventColor,window:{matchMedia:()=>({matches:false,addEventListener(){}}),addEventListener(){}},document:{documentElement:{clientWidth:1280,clientHeight:900},addEventListener(){}}});
  vm.runInContext(source('calendar-month-view.js').replace(/^import .*;\n/gm,''),context);
  const month=context.window.KPTUCalendarMonthView;
  for(const end of ['invalid','2026-13-02']){
    const bad=month.normalizeGoogle({id:'bad',start:'2026-10-01T00:30:00+09:00',end},{});
    assert.equal(Number.isFinite(bad.end.getTime()),false);
  }
  const good=month.normalizeGoogle({id:'good',start:'2026-10-01T00:30:00+09:00',end:'2026-10-01T01:30:00+09:00'},{});
  assert.equal(good.start.toISOString(),'2026-09-30T15:30:00.000Z');
});
