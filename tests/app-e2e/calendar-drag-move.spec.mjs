import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// CAL-끌어옮기기: PC 주간·월간에서 일정을 마우스로 끌면 수정 창과 같은 update-event로 저장되고, [되돌리기]는 원래 시간으로 같은 경로로 다시 저장한다.
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
      return ok({connected:true,enabled:true,selected:['own','ro'],calendars,events:state.events.map(e=>({...e})),colors:{},eventColors:{}});
    }
    if(url.pathname==='/functions/v1/google-tasks')return ok({connected:true,authorized:true,tasks:[],links:[],meeting_links:[]});
    return ok([]);
  });
  await page.goto(loginEntry(BASE+'/app/?view=calendar'));
  await signInWithSession(page,'qa@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  await page.evaluate(()=>Promise.all([window.__KPTU_CALENDAR_PERSISTENCE_READY__,new Promise(r=>{const t=setInterval(()=>{if(window.__KPTU_CALENDAR_DRAG_READY__){clearInterval(t);r()}},20)})]));
  return state;
}
async function drag(page,from,dx,dy){
  const b=await from.boundingBox();const x=b.x+b.width/2,y=b.y+Math.min(10,b.height/2);
  await page.mouse.move(x,y);await page.mouse.down();
  for(let i=1;i<=5;i++)await page.mouse.move(x+dx*i/5,y+dy*i/5);
  return async()=>page.mouse.up();
}
const colWidth=async page=>(await page.locator('.cwv-day').first().boundingBox()).width;

test('주간 시간 일정: 아래로 1시간·옆으로 하루 끌면 같은 update-event로 저장되고 되돌리기는 원래 시간으로',async({page})=>{
  const state=await open(page);
  const card=page.locator('#calendarWeek .cwv-timeline [data-google-event="timed"]');
  await expect(card).toHaveAttribute('data-drag','timed');
  const release=await drag(page,card,await colWidth(page),48+5);
  await expect(page.locator('.cwv-drag-preview')).toHaveText('11:00–12:00');
  await page.screenshot({path:'test-results/cal-drag-week-preview.png'}).catch(()=>{});
  await release();
  await expect.poll(()=>state.writes.length).toBe(1);
  expect(state.writes[0]).toMatchObject({action:'update-event',calendar_id:'own',event_id:'timed',title:'끌기 시험',memo:'메모',location:'본부',all_day:false,organization_ids:['org-a'],start_date:'2026-10-21',start_iso:iso('2026-10-21','11:00'),end_iso:iso('2026-10-21','12:00')});
  expect('target_calendar_id' in state.writes[0]).toBe(false);
  await expect(page.locator('#ciGoogleModal')).toBeHidden();
  const notice=page.locator('[data-undo-notice]');await expect(notice).toContainText('옮김');
  await expect(page.locator('.cwv-day[data-date="2026-10-21"] [data-google-event="timed"]')).toBeVisible();
  await notice.getByRole('button',{name:'되돌리기'}).click();
  await expect.poll(()=>state.writes.length).toBe(2);
  expect(state.writes[1]).toMatchObject({start_iso:iso('2026-10-20','10:00'),end_iso:iso('2026-10-20','11:00')});
  await expect(notice).toContainText('원래 시간으로 되돌렸어요');
});
test('아래 끝을 끌면 끝 시간만 15분 단위로 바뀜',async({page})=>{
  const state=await open(page);
  const card=page.locator('#calendarWeek [data-google-event="timed"]');
  const b=await card.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height-2);await page.mouse.down();
  for(let i=1;i<=4;i++)await page.mouse.move(b.x+b.width/2,b.y+b.height-2+i*9);
  await expect(page.locator('.cwv-drag-preview')).toHaveText('10:00–11:45');
  await page.mouse.up();
  await expect.poll(()=>state.writes.length).toBe(1);
  expect(state.writes[0]).toMatchObject({start_iso:iso('2026-10-20','10:00'),end_iso:iso('2026-10-20','11:45')});
});
test('짧게 누르면 일정이 열리고, 권한 없는 캘린더 일정은 끌리지 않음',async({page})=>{
  const state=await open(page);
  await page.locator('#calendarWeek [data-google-event="timed"]').click();
  await expect(page.locator('#ciGoogleModal')).toBeVisible();
  await page.locator('#ciGoogleClose').click();await expect(page.locator('#ciGoogleModal')).toBeHidden();
  const locked=page.locator('#calendarWeek [data-google-event="locked"]');
  await expect(locked).toBeVisible();expect(await locked.getAttribute('data-drag')).toBe(null);
  await expect(locked.locator('[data-drag-resize]')).toHaveCount(0);
  const b=await locked.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+10);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+30);
  await expect(page.locator('.cwv-drag-preview')).toHaveCount(0);
  await page.mouse.move(b.x+b.width/2,b.y+10);await page.mouse.up();
  expect(state.writes).toHaveLength(0);
});
test('시간 일정을 종일 줄로 끌면 막고 원래 자리로',async({page})=>{
  const state=await open(page);
  const card=page.locator('#calendarWeek [data-google-event="timed"]');
  const top=(await page.locator('.cwv-header').first().boundingBox()).y;
  const b=await card.boundingBox();
  const release=await drag(page,card,0,top+20-(b.y+10));
  await expect(page.locator('.cwv-drag-preview')).toHaveClass(/cwv-drag-blocked/);
  await release();
  await expect(page.locator('#toast')).toContainText('종일 줄로 옮길 수 없습니다');
  expect(state.writes).toHaveLength(0);
  await expect(page.locator('.cwv-day[data-date="2026-10-20"] [data-google-event="timed"]')).toBeVisible();
});
test('종일 띠: 옆으로 끌면 날짜, 오른쪽 끝을 끌면 기간',async({page})=>{
  const state=await open(page);const w=await colWidth(page);
  const band=page.locator('.cwv-bands [data-google-event="band"]');
  await expect(band).toHaveAttribute('data-drag','band');
  let release=await drag(page,band,w*2,0);await release();
  await expect.poll(()=>state.writes.length).toBe(1);
  expect(state.writes[0]).toMatchObject({all_day:true,start_date:'2026-10-24',end_date:'2026-10-24'});
  await page.locator('[data-undo-notice]').waitFor();
  const moved=page.locator('.cwv-bands [data-google-event="band"]');await expect(moved).toHaveAttribute('data-date','2026-10-24');
  const b=await moved.boundingBox();await page.mouse.move(b.x+b.width-2,b.y+b.height/2);await page.mouse.down();
  for(let i=1;i<=4;i++)await page.mouse.move(b.x+b.width-2+i*w/4,b.y+b.height/2);
  await page.mouse.up();
  await expect.poll(()=>state.writes.length).toBe(2);
  expect(state.writes[1]).toMatchObject({all_day:true,start_date:'2026-10-24',end_date:'2026-10-25'});
});
test('월간: 다른 날로 끌면 시간은 그대로 날짜만 바뀜',async({page})=>{
  const state=await open(page,'month');
  const ev=page.locator('#calendarGrid [data-google-event="timed"]');
  await expect(ev).toHaveAttribute('data-drag','day');
  const to=await page.locator('.cal-cell[data-date="2026-10-28"]').boundingBox();
  const b=await ev.boundingBox();
  const release=await drag(page,ev,(to.x+to.width/2)-(b.x+b.width/2),(to.y+to.height/2)-(b.y+5));
  await expect(page.locator('.cal-cell[data-date="2026-10-28"].cmv-drop')).toBeVisible();
  await release();
  await expect.poll(()=>state.writes.length).toBe(1);
  expect(state.writes[0]).toMatchObject({all_day:false,start_iso:iso('2026-10-28','10:00'),end_iso:iso('2026-10-28','11:00')});
});
