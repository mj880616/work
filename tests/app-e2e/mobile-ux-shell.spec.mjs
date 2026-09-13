import { test, expect } from '@playwright/test';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'mobile-user',email:'mobile@example.org',user_metadata:{display_name:'모바일 QA'}};
const workspace={id:'mobile-workspace',slug:'mobile',name:'공공기관사업팀 Workspace'};
const tasks=Array.from({length:8},(_,i)=>({id:`task-${i+1}`,workspace_id:workspace.id,title:`모바일 QA 할 일 ${i+1}`,assignee_id:user.id,created_by:user.id,status:'todo',assignment_status:'accepted',priority:'normal',project_id:null,due_at:`2026-09-${String(14+i).padStart(2,'0')}T09:00:00Z`,created_at:'2026-09-13T00:00:00Z'}));
const events=Array.from({length:5},(_,i)=>({id:`event-${i+1}`,workspace_id:workspace.id,title:`9월 13일 일정 ${i+1}`,event_type:'meeting',start_at:`2026-09-13T${String(1+i).padStart(2,'0')}:00:00Z`,end_at:`2026-09-13T${String(2+i).padStart(2,'0')}:00:00Z`,calendar_scope:'team',created_by:user.id,color_hex:'#24496f'}));
const googleTasks=[
  {id:'gt-1',title:'Google 제출자료 확인',notes:'읽기 전용 테스트',due:'2026-09-16T00:00:00.000Z',status:'needsAction',taskListId:'list-1',taskListTitle:'내 할 일',source:'google-task'},
  {id:'gt-2',title:'Google 일정 후속 확인',notes:'',due:null,status:'needsAction',taskListId:'list-2',taskListTitle:'업무',source:'google-task'}
];

async function mockApp(page){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'mobile-access',refresh_token:'mobile-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/google-tasks')return ok({tasks:googleTasks,needs_reconnect:false,connected:true,authorized:true});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email}]);
    if(path==='/rest/v1/app_workspaces')return ok([workspace]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'모바일 QA'}]);
    if(path==='/rest/v1/app_tasks')return ok(tasks);
    if(path==='/rest/v1/app_events')return ok(events);
    if(path==='/rest/v1/app_spaces')return ok([]);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

async function signIn(page){
  await expect(page.locator('#emailAuthToggle')).toBeVisible({timeout:10000});
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('mobile@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#ccMobileDock')).toBeVisible({timeout:10000});
}

async function swipe(page,selector,from,to){
  await page.locator(selector).evaluate((el,{from,to})=>{
    const start=new Event('touchstart',{bubbles:true,cancelable:true});
    Object.defineProperty(start,'touches',{value:[{clientX:from.x,clientY:from.y}]});
    el.dispatchEvent(start);
    const end=new Event('touchend',{bubbles:true,cancelable:true});
    Object.defineProperty(end,'changedTouches',{value:[{clientX:to.x,clientY:to.y}]});
    el.dispatchEvent(end);
  },{from,to});
}

test('mobile navigation, modal safe area, back behavior, task expansion, Google tasks and busy day UI',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:390,height:844});
  await mockApp(page);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);

  await expect(page.locator('[data-hta-expand]')).toHaveText('+ 2개 더 보기',{timeout:10000});
  await page.locator('[data-hta-expand]').click();
  await expect(page.locator('#myTaskMini .hta-task')).toHaveCount(8);
  await expect(page.locator('[data-hta-expand]')).toHaveText('접기');

  await swipe(page,'#homeView',{x:320,y:400},{x:70,y:405});
  await expect.poll(()=>page.evaluate(()=>window.KPTURouter?.current)).toBe('calendar');
  await expect(page.locator('#calendarView')).toBeVisible();

  await page.locator('#newEventBtn').click();
  await expect(page.locator('#eventModal')).toBeVisible();
  const safe=await page.evaluate(()=>{
    const card=document.querySelector('#eventModal .modal-card').getBoundingClientRect();
    const dock=document.querySelector('#ccMobileDock').getBoundingClientRect();
    return {cardBottom:card.bottom,dockTop:dock.top};
  });
  expect(safe.cardBottom).toBeLessThanOrEqual(safe.dockTop+1);

  await page.goBack();
  await expect(page.locator('#eventModal')).toBeHidden();
  await expect(page.locator('#calendarView')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#homeView')).toBeVisible();

  await page.locator('[data-view="calendar"]').click();
  await expect(page.locator('.kptu-day-more').first()).toBeVisible({timeout:10000});
  const more=page.locator('.kptu-day-more').filter({hasText:'+3개'}).first();
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.locator('#calendarDayModal')).toBeVisible();
  await expect(page.locator('#calendarDayList .cal-event')).toHaveCount(5);
  const agendaSafe=await page.evaluate(()=>{
    const card=document.querySelector('#calendarDayModal .modal-card').getBoundingClientRect();
    const dock=document.querySelector('#ccMobileDock').getBoundingClientRect();
    return {cardBottom:card.bottom,dockTop:dock.top};
  });
  expect(agendaSafe.cardBottom).toBeLessThanOrEqual(agendaSafe.dockTop+1);

  await page.goBack();
  await expect(page.locator('#calendarDayModal')).toBeHidden();
  await page.locator('[data-view="tasks"]').click();
  await expect(page.locator('#gtTaskSection')).toBeVisible({timeout:10000});
  await expect(page.locator('#gtTaskSection .gt-row')).toHaveCount(2);
  await expect(page.locator('#gtTaskSection')).toContainText('Google 제출자료 확인');
  await expect(page.locator('#gtTaskSection')).toContainText('Workspace 할 일과 별도 · 읽기 전용');
  await expect(page.locator('#tlTaskSections .tl-task-section')).toHaveCount(3);
});
