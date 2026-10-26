import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// CAL-빈칸시간채우기: PC 주간 빈칸을 누르거나 끌면 일정 만들기 창에 누른 자리의 날짜·시간이 미리 들어간다.
const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const calendars=[{id:'own',summary:'내 캘린더',accessRole:'owner',backgroundColor:'#336699'},{id:'ro',summary:'읽기 전용',accessRole:'reader',backgroundColor:'#aa5533'}];
test.use({timezoneId:'Asia/Seoul',viewport:{width:1280,height:844}});
const iso=(d,t)=>new Date(`${d}T${t}:00+09:00`).toISOString();
async function open(page,view='week'){
  const state={writes:[],events:[
    {id:'timed',calendarId:'own',title:'끌기 시험',start:iso('2026-10-20','10:00'),end:iso('2026-10-20','11:00'),allDay:false,description:'메모',location:'본부',organizationIds:['org-a'],recurring:false,source:'google'},
    {id:'locked',calendarId:'ro',title:'읽기 전용 일정',start:iso('2026-10-21','10:00'),end:iso('2026-10-21','11:00'),allDay:false,description:'',location:'',organizationIds:[],recurring:false,source:'google'},
    {id:'band',calendarId:'own',title:'종일 시험',start:'2026-10-22',end:'2026-10-23',allDay:true,description:'',location:'',organizationIds:[],recurring:false,source:'google'}
  ]};
  await page.clock.setFixedTime(new Date('2026-10-20T00:00:00Z'));
  await installViewPrefsServer(page,{calendar_view:view});
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin===BASE)return route.continue();
    if(url.origin!==SB)return route.abort();
    const ok=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    const user={id:'drag-user',email:'qa@example.org',user_metadata:{display_name:'QA'}};
    if(url.pathname==='/auth/v1/token')return ok({access_token:'synthetic',refresh_token:'synthetic',expires_at:4102444800,user});
    if(url.pathname==='/auth/v1/user')return ok(user);
    if(url.pathname==='/rest/v1/app_workspace_members')return ok([{workspace_id:'drag-ws',user_id:user.id,role:'owner'}]);
    if(url.pathname==='/rest/v1/app_workspaces')return ok([{id:'drag-ws',name:'QA'}]);
    if(url.pathname==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'QA'}]);
    if(url.pathname==='/functions/v1/google-calendar'){
      const action=url.searchParams.get('action');
      if(req.method()==='POST'){
        const body=req.postDataJSON();state.writes.push(body);
        const ev=state.events.find(e=>e.id===body.event_id&&e.calendarId===body.calendar_id);
        Object.assign(ev,body.all_day?{allDay:true,start:body.start_date,end:new Date(Date.parse(body.end_date+'T00:00:00Z')+86400000).toISOString().slice(0,10)}:{allDay:false,start:body.start_iso,end:body.end_iso});
        return ok({ok:true,moved:false,event:{...ev}});
      }
      if(action==='event')return ok({event:state.events.find(e=>e.id===url.searchParams.get('eventId')&&e.calendarId===url.searchParams.get('calendarId')),eventColors:{}});
      // Like the real Edge: status has no events; only action=events does.
      const status={connected:true,enabled:true,selected:['own','ro'],calendars,colors:{},eventColors:{}};
      return ok(action==='events'?{...status,events:state.events.map(e=>({...e}))}:status);
    }
    if(url.pathname==='/functions/v1/google-tasks')return ok({connected:true,authorized:true,tasks:[],links:[],meeting_links:[]});
    return ok([]);
  });
  await page.goto(loginEntry(BASE+'/app/?view=calendar'));
  await signInWithSession(page,'qa@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  // Both ready promises are set by background modules, so wait for them to exist before awaiting them.
  await expect.poll(()=>page.evaluate(()=>!!window.__KPTU_CALENDAR_PERSISTENCE_READY__)).toBe(true);
  await page.evaluate(()=>Promise.all([window.__KPTU_CALENDAR_PERSISTENCE_READY__,new Promise(r=>{const t=setInterval(()=>{if(window.__KPTU_CALENDAR_RANGE_READY__){clearInterval(t);r()}},20)})]));
  return state;
}

// 시간표 안 지정한 시(hour) 줄의 화면 좌표. 그 줄이 날짜 줄·종일 띠에 가리지 않게 먼저 스크롤한다.
async function pointAt(page,date,hour,x=20){
  await page.locator('#calendarWeek').evaluate((el,h)=>{el.scrollTop=Math.max(0,h*48-120)},hour);
  const line=await page.locator(`.cwv-day[data-date="${date}"] .cwv-timeline`).boundingBox();
  return {x:line.x+x,y:line.y+hour*48};
}
const values=page=>page.evaluate(()=>['StartDate','StartTime','EndDate','EndTime'].map(k=>document.querySelector('#event'+k).value));

test('주간 15시 칸을 누르면 그 날짜 15:00~16:00이 들어간다',async({page})=>{
  await open(page);
  const p=await pointAt(page,'2026-10-22',15);
  await page.mouse.click(p.x,p.y+10);
  await expect(page.locator('#eventModal')).toBeVisible();
  expect(await values(page)).toEqual(['2026-10-22','15:00','2026-10-22','16:00']);
  await expect(page.locator('#eventAllDay')).not.toBeChecked();
});
test('주간 15시 40분쯤 누르면 15분 칸에 맞춰 15:30~16:30',async({page})=>{
  await open(page);
  const p=await pointAt(page,'2026-10-23',15);
  await page.mouse.click(p.x,p.y+Math.round(48*40/60));
  await expect(page.locator('#eventModal')).toBeVisible();
  expect(await values(page)).toEqual(['2026-10-23','15:30','2026-10-23','16:30']);
});
test('주간 맨 위 날짜 줄(종일 칸)을 누르면 그날 종일',async({page})=>{
  await open(page);
  await page.locator('.cwv-day[data-date="2026-10-24"] .cwv-header').click({position:{x:8,y:8}});
  await expect(page.locator('#eventModal')).toBeVisible();
  await expect(page.locator('#eventAllDay')).toBeChecked();
  await expect(page.locator('#eventStartDate')).toHaveValue('2026-10-24');
  await expect(page.locator('#eventEndDate')).toHaveValue('2026-10-24');
});
test('주간 빈 곳을 위아래로 끌면 미리보기가 보이고 놓으면 그 범위가 들어간다',async({page})=>{
  await open(page);
  const p=await pointAt(page,'2026-10-22',13);
  await page.mouse.move(p.x,p.y+5);await page.mouse.down();
  for(let i=1;i<=6;i++)await page.mouse.move(p.x,p.y+5+i*17);
  await expect(page.locator('.cwv-drag-preview')).toHaveText('13:00–15:15');
  await page.mouse.up();
  await expect(page.locator('#eventModal')).toBeVisible();
  expect(await values(page)).toEqual(['2026-10-22','13:00','2026-10-22','15:15']);
  await expect(page.locator('.cwv-drag-preview')).toHaveCount(0);
});
test('월간 날짜 칸을 누르면 그 날짜가 들어간다',async({page})=>{
  await open(page,'month');
  await page.locator('.cal-cell[data-date="2026-10-14"]').click({position:{x:10,y:60}});
  await expect(page.locator('#eventModal')).toBeVisible();
  await expect(page.locator('#eventStartDate')).toHaveValue('2026-10-14');
  await expect(page.locator('#eventEndDate')).toHaveValue('2026-10-14');
});
