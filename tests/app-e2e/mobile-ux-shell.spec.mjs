import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'mobile-user',email:'mobile@example.org',user_metadata:{display_name:'모바일 QA'}};
const workspace={id:'mobile-workspace',slug:'mobile',name:'공공기관사업팀 Workspace'};
const tasks=Array.from({length:8},(_,i)=>({id:`task-${i+1}`,workspace_id:workspace.id,title:`모바일 QA 할 일 ${i+1}`,assignee_id:user.id,created_by:user.id,status:'todo',assignment_status:'accepted',priority:'normal',project_id:null,due_at:`2026-09-${String(14+i).padStart(2,'0')}T09:00:00Z`,created_at:'2026-09-13T00:00:00Z'}));
const events=Array.from({length:5},(_,i)=>({id:`event-${i+1}`,workspace_id:workspace.id,title:`9월 13일 일정 ${i+1}`,event_type:'meeting',start_at:`2026-09-13T${String(1+i).padStart(2,'0')}:00:00Z`,end_at:`2026-09-13T${String(2+i).padStart(2,'0')}:00:00Z`,calendar_scope:'team',created_by:user.id,color_hex:'#24496f'}));

async function mockApp(page){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'mobile-access',refresh_token:'mobile-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
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
  await page.goto(loginEntry(page.url()));
  await expect(page.locator('#emailAuthToggle')).toBeVisible({timeout:10000});
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('mobile@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#ccMobileDock')).toHaveCount(0);
}

async function gesture(page,selector,points){
  return page.locator(selector).evaluate((el,points)=>{
    const touch=(type,p,key='touches')=>{
      const ev=new Event(type,{bubbles:true,cancelable:true});
      Object.defineProperty(ev,key,{value:[{clientX:p.x,clientY:p.y}]});
      el.dispatchEvent(ev);
    };
    touch('touchstart',points[0]);
    for(const p of points.slice(1,-1))touch('touchmove',p);
    const transform=el.style.transform;
    touch('touchend',points.at(-1),'changedTouches');
    return transform;
  },points);
}

test('mobile navigation, animated full-area swipe, safe area, back behavior and busy day UI',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:390,height:844});
  await mockApp(page);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);

  await expect(page.locator('#hdvTaskPanel')).toBeVisible({timeout:10000});
  await expect(page.locator('#hdvTasks .hdv-row')).toHaveCount(6);
  await expect(page.locator('#hdvTasks')).toContainText('모바일 QA 할 일 1');
  await expect(page.locator('[data-hta-expand]')).toHaveCount(0);

  const motion=await gesture(page,'#homeView',[{x:330,y:400},{x:240,y:402},{x:110,y:405}]);
  expect(motion).toContain('translate3d');
  await expect.poll(()=>page.evaluate(()=>window.KPTURouter?.current)).toBe('calendar');
  await expect(page.locator('#calendarView')).toBeVisible();
  await expect.poll(()=>page.locator('#calendarView').evaluate(el=>el.style.transform||'')).toBe('');

  await page.locator('[data-view="home"]').click();
  const vertical=await gesture(page,'#homeView',[{x:220,y:300},{x:214,y:390},{x:210,y:510}]);
  expect(vertical).toBe('');
  await expect.poll(()=>page.evaluate(()=>window.KPTURouter?.current)).toBe('home');

  await page.locator('#hdvMilestonePanel [data-hdv-goto="calendar"]').evaluate(el=>{
    const ev=(type,p,key='touches')=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,key,{value:[{clientX:p.x,clientY:p.y}]});el.dispatchEvent(e)};
    ev('touchstart',{x:330,y:360});ev('touchmove',{x:210,y:362});ev('touchend',{x:90,y:364},'changedTouches');
  });
  await expect.poll(()=>page.evaluate(()=>window.KPTURouter?.current)).toBe('calendar');
  await page.waitForTimeout(240);

  await page.locator('#newEventBtn').click();
  await expect(page.locator('#eventModal')).toBeVisible();
  const safe=await page.evaluate(()=>{
    const card=document.querySelector('#eventModal .modal-card').getBoundingClientRect();
    return {cardBottom:card.bottom,viewportBottom:innerHeight};
  });
  expect(safe.cardBottom).toBeLessThanOrEqual(safe.viewportBottom+1);

  await page.goBack();
  await expect(page.locator('#eventModal')).toBeHidden();
  await expect(page.locator('#calendarView')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#homeView')).toBeVisible();

  const before=await page.evaluate(()=>window.KPTURouter?.current);
  const navBox=await page.locator('.app-nav').boundingBox();
  await gesture(page,'.app-nav',[{x:330,y:navBox.y+10},{x:210,y:navBox.y+10},{x:80,y:navBox.y+10}]);
  await page.waitForTimeout(220);
  expect(await page.evaluate(()=>window.KPTURouter?.current)).toBe(before);

  await page.locator('[data-view="calendar"]').click();
  await expect(page.locator('.kptu-day-more').first()).toBeVisible({timeout:10000});
  const more=page.locator('.kptu-day-more').filter({hasText:'+3개'}).first();
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.locator('#calendarDayModal')).toBeVisible();
  await expect(page.locator('#calendarDayList .cal-event')).toHaveCount(5);
  const agendaSafe=await page.evaluate(()=>{
    const card=document.querySelector('#calendarDayModal .modal-card').getBoundingClientRect();
    return {cardBottom:card.bottom,viewportBottom:innerHeight};
  });
  expect(agendaSafe.cardBottom).toBeLessThanOrEqual(agendaSafe.viewportBottom+1);
});
