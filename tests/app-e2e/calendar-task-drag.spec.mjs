import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';

// S51-16 CAL-할일끌기: PC 월간에서 할 일 줄을 다른 날짜 칸에 끌면 기한(날짜만)이 수정 창과 같은 google-tasks update로 한 번 바뀌고,
// [되돌리기]는 원래 날짜로 같은 길로 다시 저장한다. 짧게 누르기는 그 할 일 열기, 체크 네모는 끌기로 잡지 않는다.
// 끌기 손맛: 끄는 동안 반투명 조각(.cal-drag-ghost) 하나가 커서를 따라가고, 놓거나 Esc면 사라진다(일정도 같음).
const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({timezoneId:'Asia/Seoul',viewport:{width:1280,height:844}});
const iso=(d,t)=>new Date(`${d}T${t}:00+09:00`).toISOString();
async function open(page,{failUpdate=false}={}){
  const state={updates:[],writes:[],tasks:[
    {id:'t1',title:'끌기 할 일',notes:'메모',due:'2026-10-20T00:00:00.000Z',status:'needsAction',completed:null,taskListId:'@default',taskListTitle:'QA',source:'google-task'}
  ],events:[
    {id:'timed',calendarId:'own',title:'끌기 일정',start:iso('2026-10-22','10:00'),end:iso('2026-10-22','11:00'),allDay:false,description:'',location:'',organizationIds:[],recurring:false,source:'google'}
  ]};
  await page.clock.setFixedTime(new Date('2026-10-20T00:00:00Z'));
  await installViewPrefsServer(page,{calendar_view:'month'});
  await page.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin===BASE)return route.continue();
    if(url.origin!==SB)return route.abort();
    const ok=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
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
        const ev=state.events.find(e=>e.id===body.event_id);Object.assign(ev,{start:body.start_iso,end:body.end_iso});
        return ok({ok:true,moved:false,event:{...ev}});
      }
      if(action==='event')return ok({event:state.events.find(e=>e.id===url.searchParams.get('eventId')),eventColors:{}});
      const status={connected:true,enabled:true,selected:['own'],calendars:[{id:'own',summary:'내 캘린더',accessRole:'owner',backgroundColor:'#336699'}],colors:{},eventColors:{}};
      return ok(action==='events'?{...status,events:state.events.map(e=>({...e}))}:status);
    }
    if(url.pathname==='/functions/v1/google-tasks'){
      const action=url.searchParams.get('action');
      if(action==='update'){
        const body=req.postDataJSON();state.updates.push(body);
        if(failUpdate)return ok({error:'QA failure'},500);
        const t=state.tasks.find(x=>x.id===body.task_id);Object.assign(t,{title:body.title,notes:body.notes,due:body.due?body.due+'T00:00:00.000Z':null});
        return ok({ok:true,task:{...t}});
      }
      if(action==='links')return ok({links:[],meeting_links:[]});
      return ok({connected:true,authorized:true,needs_reconnect:false,tasks:state.tasks.map(t=>({...t})),links:[],meeting_links:[],pending_scope:'all'});
    }
    return ok([]);
  });
  await page.goto(loginEntry(BASE+'/app/?view=calendar'));
  await signInWithSession(page,'qa@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  await page.evaluate(()=>new Promise(r=>{const t=setInterval(()=>{if(window.__KPTU_CALENDAR_DRAG_READY__&&window.KPTUCalendarTasks){clearInterval(t);r()}},20)}));
  return state;
}
const task=page=>page.locator('#calendarGrid .cmv-cell-task[data-calendar-task="t1"]');
async function dragTo(page,from,date,{release=true}={}){
  const to=await page.locator(`.cal-cell[data-date="${date}"]`).boundingBox(),b=await from.boundingBox();
  const x=b.x+b.width*.6,y=b.y+b.height/2,tx=to.x+to.width/2,ty=to.y+to.height/2;
  await page.mouse.move(x,y);await page.mouse.down();
  for(let i=1;i<=6;i++)await page.mouse.move(x+(tx-x)*i/6,y+(ty-y)*i/6);
  if(release)await page.mouse.up();
  return {x,y,tx,ty};
}

test('PC 월간: 할 일을 다른 날로 끌면 기한이 한 번 바뀌고, 되돌리기는 원래 날짜로',async({page})=>{
  const state=await open(page);
  await expect(task(page)).toHaveAttribute('data-drag','task');
  await dragTo(page,task(page),'2026-10-23');
  await expect.poll(()=>state.updates.length).toBe(1);
  expect(state.updates[0]).toMatchObject({action:'update',task_id:'t1',task_list_id:'@default',title:'끌기 할 일',notes:'메모',due:'2026-10-23'});
  await expect(page.locator('.cal-drag-ghost')).toHaveCount(0);
  const notice=page.locator('[data-undo-notice]');await expect(notice).toContainText('할 일 옮김');
  // 화면이 새 날짜로 다시 그려진다.
  await expect.poll(()=>task(page).evaluate(el=>{const r=el.getBoundingClientRect();const c=[...document.querySelectorAll('#calendarGrid .cal-cell[data-date]')].find(c=>{const q=c.getBoundingClientRect();return r.left+2>=q.left&&r.left+2<q.right&&r.top>=q.top&&r.top<q.bottom});return c?.dataset.date})).toBe('2026-10-23');
  await expect(page.locator('#gtTaskModal')).toBeHidden();
  await notice.getByRole('button',{name:'되돌리기'}).click();
  await expect.poll(()=>state.updates.length).toBe(2);
  expect(state.updates[1]).toMatchObject({task_id:'t1',due:'2026-10-20'});
  await expect(notice).toContainText('원래 날짜로 되돌렸어요');
});

test('짧게 누르면 할 일이 열리고, 체크 네모에서 시작하면 끌기가 아님',async({page})=>{
  const state=await open(page);
  await task(page).click();
  await expect(page.locator('#gtTaskModal')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#gtTaskModal')).toBeHidden();
  const box=await task(page).locator('.cmv-cell-task-box').boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+200,box.y+80,{steps:5});
  await expect(page.locator('.cal-drag-ghost')).toHaveCount(0);
  await expect(page.locator('#calendarGrid .cmv-drop')).toHaveCount(0);
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.up();
  expect(state.updates).toHaveLength(0);
});

test('끄는 동안 조각이 커서를 따라가고, Esc면 사라지고 저장하지 않음',async({page})=>{
  const state=await open(page);
  const start=await task(page).boundingBox();
  const p=await dragTo(page,task(page),'2026-10-29',{release:false});
  const ghost=page.locator('.cal-drag-ghost');
  await expect(ghost).toHaveCount(1);
  await expect(page.locator('.cal-cell[data-date="2026-10-29"].cmv-drop')).toBeVisible();
  await expect(task(page)).toHaveClass(/cmv-drag-source/);
  // 조각은 커서가 움직인 만큼 옮겨 간다(잡은 자리 그대로).
  await expect.poll(async()=>{const g=await ghost.boundingBox();return Math.round(Math.abs((g.x-start.x)-(p.tx-p.x))+Math.abs((g.y-start.y)-(p.ty-p.y)))}).toBeLessThan(3);
  expect(await ghost.evaluate(el=>({op:getComputedStyle(el).opacity,pe:getComputedStyle(el).pointerEvents,pos:getComputedStyle(el).position,parent:el.parentElement===document.body}))).toEqual({op:'0.7',pe:'none',pos:'fixed',parent:true});
  await page.mouse.move(p.tx+30,p.ty+10);
  await expect.poll(async()=>{const g=await ghost.boundingBox();return Math.round(Math.abs((g.x-start.x)-(p.tx+30-p.x)))}).toBeLessThan(3);
  await page.keyboard.press('Escape');
  await expect(ghost).toHaveCount(0);
  await expect(page.locator('#calendarGrid .cmv-drop')).toHaveCount(0);
  await page.mouse.up();
  expect(state.updates).toHaveLength(0);
  await expect(page.locator('#gtTaskModal')).toBeHidden();
});

test('저장 실패면 원래 자리 + 알림',async({page})=>{
  const state=await open(page,{failUpdate:true});
  await dragTo(page,task(page),'2026-10-23');
  await expect.poll(()=>state.updates.length).toBe(1);
  await expect(page.locator('#toast')).toContainText('기한을 바꾸지 못했어요');
  await expect(page.locator('[data-undo-notice]')).toHaveCount(0);
  await expect(page.locator('.cal-drag-ghost')).toHaveCount(0);
});

test('일정 끌기도 조각이 따라오고 놓으면 사라짐',async({page})=>{
  const state=await open(page);
  const ev=page.locator('#calendarGrid [data-google-event="timed"]');
  await dragTo(page,ev,'2026-10-27',{release:false});
  await expect(page.locator('.cal-drag-ghost')).toHaveCount(1);
  await page.mouse.up();
  await expect(page.locator('.cal-drag-ghost')).toHaveCount(0);
  await expect.poll(()=>state.writes.length).toBe(1);
  expect(state.writes[0]).toMatchObject({start_iso:iso('2026-10-27','10:00')});
});
