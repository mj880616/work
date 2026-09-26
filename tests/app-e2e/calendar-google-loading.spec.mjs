import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';

// Google Calendar 로딩 성능 측정(mock). Google API는 Edge Function 내부에서 호출되므로
// Edge 호출 1회를 아래 모델로 Google 요청으로 환산한다(현재 Edge 코드 기준).
//   status  = calendarList ∥ colors                 (병렬)
//   events  = colors → calendars[i].events ×N        (직렬)
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const APP='http://127.0.0.1:8123/app/';
const LAT={edge:80,calendarList:300,colors:200,events:300};
const CALS=['primary','cal-b','cal-c'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const iso=d=>d.toISOString();

function monthEvents(){
  const base=new Date(),y=base.getFullYear(),m=base.getMonth(),out=[];
  for(const off of [-1,0,1])CALS.forEach((cal,i)=>{const d=new Date(y,m+off,10+i,9);out.push({id:`${cal}-${off}`,title:`G${off}-${cal}`,start:iso(d),end:iso(new Date(d.getTime()+3600000)),allDay:false,calendarId:cal,source:'google',color:'#4285f4'})});
  return out;
}

async function installMock(page,state){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const body=(()=>{try{return req.postDataJSON()}catch{return null}})();
    let entry=null;const ok=(d,s=200)=>{if(entry)entry.done=true;return route.fulfill({status:s,contentType:'application/json',body:JSON.stringify(d??null)})};
    if(path==='/auth/v1/token')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer'});
    if(path==='/auth/v1/user')return ok(state.user);
    if(path==='/functions/v1/google-calendar'){
      const action=url.searchParams.get('action')||(method==='POST'?body?.action:'status');
      entry={t:Date.now()-state.t0,action,google:[]};state.log.push(entry);
      if(state.authFail&&action!=='disconnect'){await sleep(LAT.edge);entry.dur=LAT.edge;return ok({error:'Google 재인증이 필요합니다.'},400)}
      if(action==='status'){
        entry.google=[['calendarList','colors']];await sleep(LAT.edge+Math.max(LAT.calendarList,LAT.colors));entry.dur=Date.now()-state.t0-entry.t;
        if(!state.connected)return ok({connected:false});
        return ok({connected:true,enabled:true,email:'e2e@example.org',selected:state.selected,colors:{},eventColors:{1:{background:'#7986cb'}},calendars:CALS.map(id=>({id,summary:id,primary:id==='primary',backgroundColor:'#4285f4',accessRole:'owner'}))});
      }
      if(action==='events'){
        const ids=state.selected;entry.google=['colors',...ids.map(id=>'events:'+id)];
        await sleep(LAT.edge+LAT.colors+LAT.events*ids.length+(state.extraDelays?.shift()||0));entry.dur=Date.now()-state.t0-entry.t;
        const min=new Date(url.searchParams.get('timeMin')),max=new Date(url.searchParams.get('timeMax'));
        return ok({events:state.events.filter(e=>ids.includes(e.calendarId)&&new Date(e.start)>=min&&new Date(e.start)<max),eventColors:{1:{background:'#7986cb'}}});
      }
      if(action==='create-event'){entry.google=['colors','insert'];await sleep(LAT.edge+400);const row={id:'new-'+state.events.length,title:body.title,start:body.start_iso,end:body.end_iso,allDay:false,calendarId:body.calendar_id||'primary',source:'google'};state.events.push(row);return ok({ok:true,event:row})}
      if(action==='preferences'){state.selected=body.calendar_ids;return ok({ok:true})}
      if(action==='disconnect'){state.connected=false;return ok({ok:true})}
      return ok({});
    }
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path==='/rest/v1/app_workspace_members'){if(url.searchParams.get('limit')==='1')return ok([{workspace_id:'ws-1',role:'owner',user_id:state.user.id}]);return ok([{workspace_id:'ws-1',user_id:state.user.id,role:'owner'}])}
    if(path==='/rest/v1/app_workspaces')return ok([{id:'ws-1',slug:'public-institutions',name:'웹2'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'E2E'}]);
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

async function boot(page,state){
  await installMock(page,state);
  await page.goto(`${APP}login/?return=${encodeURIComponent(APP)}`);
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('e2e@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
}
function newState(){return{t0:Date.now(),log:[],user:{id:'user-1',email:'e2e@example.org',user_metadata:{display_name:'E2E'}},connected:true,selected:[...CALS],events:monthEvents(),authFail:false}}
const googleCount=log=>log.reduce((n,e)=>n+e.google.flat().length,0);
const summary=(log,from)=>{const part=log.slice(from);return{edge:part.map(e=>e.action),google:googleCount(part),timeline:part.map(e=>`${e.action}@${e.t}+${e.dur??'?'}ms`)}};
const googleVisible=(page,prefix)=>page.waitForSelector(`[data-google-event="primary-${prefix}"]`,{state:'attached',timeout:10000});
async function quiet(page,state,ms=1500){let n=-1;while(n!==state.log.length||state.log.some(e=>!e.done)){n=state.log.length;await page.waitForTimeout(ms)}}
// 앱 타이머는 그대로 두고 Date.now만 앞으로 옮겨 30초·5분 경과를 흉내 낸다.
const advance=(page,ms)=>page.evaluate(ms=>{const base=Date.now.__base||Date.now,shift=(Date.now.__shift||0)+ms;Date.now=Object.assign(()=>base()+shift,{__base:base,__shift:shift})},ms);
const focus=page=>page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'))});
async function openCalendar(page,state){await boot(page,state);await page.locator('[data-view="calendar"]').click();await googleVisible(page,'0');await quiet(page,state)}

test('Google Calendar 요청 수·시간 측정 (첫 진입·월 이동·포커스 복귀)',async({page})=>{
  test.setTimeout(90000);
  const state=newState(),m={};
  await boot(page,state);
  let mark=state.log.length,t=Date.now();
  await page.locator('[data-view="calendar"]').click();
  await googleVisible(page,'0');m.firstEntryMs=Date.now()-t;
  await quiet(page,state);m.firstEntry=summary(state.log,mark);
  expect(m.firstEntry.edge).toEqual(['status','events']);

  mark=state.log.length;t=Date.now();
  await page.locator('#nextMonthBtn').click();
  await googleVisible(page,'1');m.nextMonthMs=Date.now()-t;
  await quiet(page,state);m.nextMonth=summary(state.log,mark);
  expect(m.nextMonth.edge).toEqual(['events']);

  mark=state.log.length;t=Date.now();
  await page.locator('#prevMonthBtn').click();
  await googleVisible(page,'0');m.prevMonthRevisitMs=Date.now()-t;
  await quiet(page,state);m.prevMonthRevisit=summary(state.log,mark);
  expect(m.prevMonthRevisit.edge).toEqual(['events']);
  expect(m.prevMonthRevisitMs).toBeLessThan(600);

  mark=state.log.length;
  await focus(page);
  await quiet(page,state);m.focus=summary(state.log,mark);
  expect(m.focus.edge).toEqual([]);

  mark=state.log.length;
  await advance(page,31000);await focus(page);
  await quiet(page,state);m.focusAfter30s=summary(state.log,mark);
  expect(m.focusAfter30s.edge).toEqual(['events']);

  mark=state.log.length;
  await advance(page,5*60*1000);await focus(page);
  await quiet(page,state);m.focusAfter5min=summary(state.log,mark);
  expect(m.focusAfter5min.edge.sort()).toEqual(['events','status']);
  const [a,b]=state.log.slice(mark);
  expect(Math.abs(a.t-b.t)).toBeLessThan(200);

  if(process.env.CAL_MEASURE_OUT)writeFileSync(process.env.CAL_MEASURE_OUT,JSON.stringify(m,null,2));
  console.log(JSON.stringify(m));
});

test('일정 생성 직후에는 캐시와 포커스 제한을 무시하고 새로 읽는다',async({page})=>{
  const state=newState();
  await openCalendar(page,state);
  const mark=state.log.length,day=new Date(new Date().getFullYear(),new Date().getMonth(),20),ymd=`${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-20`;
  await page.locator('#newEventBtn').click();
  await page.locator('#eventTitle').fill('새 Google 일정');
  await page.locator('#eventTarget').selectOption('google');
  await page.locator('#eventStartDate').fill(ymd);
  await page.locator('#eventStartTime').fill('10:00');
  await page.locator('#eventEndDate').fill(ymd);
  await page.locator('#eventEndTime').fill('11:00');
  await page.locator('#saveEventBtn').click();
  await expect(page.locator('.cp-event')).toContainText(['새 Google 일정'],{timeout:10000});
  await quiet(page,state);
  expect(state.log.slice(mark).map(e=>e.action)).toEqual(['create-event','events']);
  // 이전 달로 갔다 돌아와도 생성 전 캐시가 되살아나지 않는다.
  await page.locator('#prevMonthBtn').click();
  await googleVisible(page,'-1');
  await page.locator('#nextMonthBtn').click();
  await expect(page.locator('.cp-event')).toContainText(['새 Google 일정']);
});

test('인증 만료 응답은 status 캐시를 즉시 버리고 다음 포커스에서 다시 확인한다',async({page})=>{
  const state=newState();
  await openCalendar(page,state);
  await advance(page,31000);
  state.authFail=true;
  let mark=state.log.length;
  await focus(page);await quiet(page,state);
  expect(state.log.slice(mark).map(e=>e.action)).toEqual(['events']);
  await expect(page.locator('#cpCalMsg')).toContainText('Google 재인증이 필요합니다.');
  state.authFail=false;
  mark=state.log.length;
  await focus(page);await quiet(page,state);
  expect(state.log.slice(mark).map(e=>e.action).sort()).toEqual(['events','status']);
  await expect(page.locator('#cpCalMsg')).toContainText('Google 일정 3건 표시 중');
});

test('연결 해제 후에는 캐시를 쓰지 않고 Google 일정을 지운다',async({page})=>{
  const state=newState();
  await openCalendar(page,state);
  page.on('dialog',d=>d.accept());
  await page.locator('#googleCalendarPanel summary').click();
  await page.locator('#disconnectGoogle').click();
  await expect(page.locator('[data-google-event]')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>window.__KPTU_GOOGLE_STATE__?.connected)).toBe(false);
  const mark=state.log.length;
  await focus(page);await quiet(page,state);
  expect(state.log.slice(mark).map(e=>e.action)).toEqual(['status']);
  await expect(page.locator('[data-google-event]')).toHaveCount(0);
});

test('빠른 월 이동에서 늦게 도착한 이전 달 응답이 현재 달을 덮지 않는다',async({page})=>{
  const state=newState();
  await openCalendar(page,state);
  state.extraDelays=[1500];
  await page.locator('#nextMonthBtn').click();
  await page.waitForTimeout(100);
  await page.locator('#prevMonthBtn').click();
  await page.waitForTimeout(100);
  await page.locator('#prevMonthBtn').click();
  await quiet(page,state);
  await expect(page.locator('[data-google-event="primary--1"]')).toHaveCount(1);
  await expect(page.locator('[data-google-event="primary-1"]')).toHaveCount(0);
});

test('캘린더가 아닌 화면에서는 포커스 복귀 때 Google 요청을 하지 않는다',async({page})=>{
  const state=newState();
  await openCalendar(page,state);
  await page.locator('[data-view="tasks"]').click();
  await expect(page.locator('#tasksView')).toBeVisible();
  await quiet(page,state);
  await advance(page,6*60*1000);
  const mark=state.log.length;
  await focus(page);await quiet(page,state);
  expect(state.log.slice(mark).filter(e=>['status','events'].includes(e.action))).toEqual([]);
});

for(const width of [360,390,412,430]){
  test(`모바일 ${width}px에서 Google 일정 표시와 월 재방문 캐시가 유지된다`,async({page})=>{
    await page.setViewportSize({width,height:844});
    const state=newState();
    await openCalendar(page,state);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.locator('#nextMonthBtn').click();
    await googleVisible(page,'1');
    const t=Date.now();
    await page.locator('#prevMonthBtn').click();
    await googleVisible(page,'0');
    expect(Date.now()-t).toBeLessThan(600);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  });
}
