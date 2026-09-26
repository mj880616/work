import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'mobile-user',email:'mobile@example.org',user_metadata:{display_name:'모바일 QA'}};
const workspace={id:'mobile-workspace',slug:'mobile',name:'웹2'};
const tasks=Array.from({length:8},(_,i)=>({id:`task-${i+1}`,workspace_id:workspace.id,title:`모바일 QA 할 일 ${i+1}`,assignee_id:user.id,created_by:user.id,status:'todo',assignment_status:'accepted',priority:'normal',project_id:null,due_at:`2026-09-${String(14+i).padStart(2,'0')}T09:00:00Z`,created_at:'2026-09-13T00:00:00Z'}));
const events=Array.from({length:12},(_,i)=>({id:`event-${i+1}`,title:`9월 13일 일정 ${i+1}`,start:`2026-09-13T${String(1+i).padStart(2,'0')}:00:00Z`,end:`2026-09-13T${String(2+i).padStart(2,'0')}:00:00Z`,calendarId:'primary',source:'google',color:'#4285f4'}));

async function mockApp(page){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'mobile-access',refresh_token:'mobile-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar'){
      const action=url.searchParams.get('action');
      if(action==='events')return ok({events,eventColors:{}});
      return ok({connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'기본',primary:true,accessRole:'owner',backgroundColor:'#4285f4'}],colors:{},events,eventColors:{}});
    }
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email}]);
    if(path==='/rest/v1/app_workspaces')return ok([workspace]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'모바일 QA'}]);
    if(path==='/rest/v1/app_tasks')return ok(tasks);
    if(path==='/rest/v1/app_events')return ok([]);
    if(path==='/rest/v1/app_spaces')return ok([]);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

async function signIn(page){
  await enterLogin(page);
  await expect(page.locator('#emailAuthToggle')).toBeVisible({timeout:10000});
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('mobile@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('body')).toHaveClass(/kptu-workspace-shell/,{timeout:10000});
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

  await expect(page.locator('#calendarView')).toBeVisible({timeout:10000});

  const motion=await gesture(page,'#calendarView',[{x:330,y:400},{x:240,y:402},{x:110,y:405}]);
  expect(motion).toContain('translate3d');
  await expect.poll(()=>page.evaluate(()=>window.KPTURouter?.current)).toBe('tasks');
  await expect(page.locator('#tasksView')).toBeVisible();
  await expect.poll(()=>page.locator('#tasksView').evaluate(el=>el.style.transform||'')).toBe('');

  const vertical=await gesture(page,'#tasksView',[{x:220,y:300},{x:214,y:390},{x:210,y:510}]);
  expect(vertical).toBe('');
  await expect.poll(()=>page.evaluate(()=>window.KPTURouter?.current)).toBe('tasks');

  await page.locator('[data-view="calendar"]').click();
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
  await expect(page.locator('#tasksView')).toBeVisible();

  const before=await page.evaluate(()=>window.KPTURouter?.current);
  const navBox=await page.locator('.app-nav').boundingBox();
  await gesture(page,'.app-nav',[{x:330,y:navBox.y+10},{x:210,y:navBox.y+10},{x:80,y:navBox.y+10}]);
  await page.waitForTimeout(220);
  expect(await page.evaluate(()=>window.KPTURouter?.current)).toBe(before);

  await page.locator('[data-view="calendar"]').click();
  const scrollRoom=await page.evaluate(()=>{
    const view=document.querySelector('#calendarView');
    const runway=parseFloat(getComputedStyle(view,'::after').height)||0;
    return {runway,scrollHeight:document.documentElement.scrollHeight,viewport:innerHeight};
  });
  expect(scrollRoom.runway).toBeGreaterThanOrEqual(56);
  expect(scrollRoom.scrollHeight-scrollRoom.viewport).toBeGreaterThan(40);
  const more=page.locator('.kptu-day-more').first();
  await expect(more).toBeVisible({timeout:10000});
  const busyWeek=page.locator('.cal-cell[data-date="2026-09-13"]').locator('..').locator('..');
  expect(await busyWeek.locator('.cmv-event').count()).toBeGreaterThan(4);
  await expect(more).toHaveText(/^\+\d+$/);
  await more.click();
  await expect(page.locator('#calendarDayModal')).toBeVisible();
  await expect(page.locator('#calendarDayList .cal-event')).toHaveCount(12);
  const agendaSafe=await page.evaluate(()=>{
    const card=document.querySelector('#calendarDayModal .modal-card').getBoundingClientRect();
    return {cardBottom:card.bottom,viewportBottom:innerHeight};
  });
  expect(agendaSafe.cardBottom).toBeLessThanOrEqual(agendaSafe.viewportBottom+1);
});


test('mobile shell and event modal stay inside 360/390/412/430px viewports',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:390,height:844});
  await mockApp(page);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);

  for(const width of [360,390,412,430]){
    await page.setViewportSize({width,height:844});
    await page.waitForTimeout(50);
    const shell=await page.evaluate(()=>{
      const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom}};
      return {
        topbar:rect(document.querySelector('.topbar')),
        nav:rect(document.querySelector('.app-nav')),
        topbarDisplay:getComputedStyle(document.querySelector('.topbar')).display,
        sidebarBrandDisplay:getComputedStyle(document.querySelector('.sidebar-brand')).display,
        sidebarLogoutDisplay:getComputedStyle(document.querySelector('#sidebarLogoutBtn')).display,
        viewport:{width:innerWidth,height:innerHeight}
      };
    });
    expect(shell.topbarDisplay).toBe('none');
    expect(shell.sidebarBrandDisplay).toBe('none');
    expect(shell.sidebarLogoutDisplay).not.toBe('none');
    expect(shell.nav.left).toBeGreaterThanOrEqual(-1);
    expect(shell.nav.right).toBeLessThanOrEqual(width+1);

    await page.locator('[data-view="calendar"]').click();
    await expect(page.locator('#calendarView')).toBeVisible({timeout:10000});
    await page.locator('#newEventBtn').click();
    await expect(page.locator('#eventModal')).toBeVisible();
    const modal=await page.evaluate(()=>{
      const r=document.querySelector('#eventModal .modal-card').getBoundingClientRect();
      return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight};
    });
    expect(modal.left).toBeGreaterThanOrEqual(-1);
    expect(modal.right).toBeLessThanOrEqual(width+1);
    expect(modal.bottom).toBeLessThanOrEqual(modal.height+1);
    await page.goBack();
    await expect(page.locator('#eventModal')).toBeHidden();
  }
});
