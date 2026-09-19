import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';

async function mockApp(page){
  const user={id:'nav-user',email:'nav@example.org',user_metadata:{display_name:'메뉴 QA'}};
  const workspace={id:'nav-workspace',name:'공공기관사업팀 Workspace'};
  await page.route(`${SB}/**`,async route=>{
    const u=new URL(route.request().url()),p=u.pathname;
    const ok=x=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x??null)});
    if(p==='/auth/v1/token')return ok({access_token:'nav-access',refresh_token:'nav-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
    if(p==='/auth/v1/user')return ok(user);
    if(p==='/auth/v1/logout')return ok({});
    if(p==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner'}]);
    if(p==='/rest/v1/app_workspaces')return ok([workspace]);
    if(p==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'메뉴 QA'}]);
    if(p==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(p==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(p.startsWith('/rest/v1/')||p.startsWith('/functions/v1/'))return ok([]);
    return ok({});
  });
}

async function login(page){
  await page.goto(loginEntry('http://127.0.0.1:8123/app/'));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('nav@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect.poll(()=>page.evaluate(()=>!!window.__KPTU_MOBILE_SWIPE_NAV__),{timeout:10000}).toBe(true);
}

async function swipe(page,selector,direction='left'){
  const locator=page.locator(selector).first();
  await expect(locator).toBeVisible({timeout:10000});
  await locator.evaluate((el,direction)=>{
    const r=el.getBoundingClientRect();
    const y=Math.max(r.top+2,Math.min(r.bottom-2,r.top+r.height/2));
    const startX=direction==='left'?Math.min(innerWidth-24,Math.max(90,r.left+r.width*.78)):Math.max(24,Math.min(innerWidth-90,r.left+r.width*.22));
    const endX=direction==='left'?Math.max(24,startX-170):Math.min(innerWidth-24,startX+170);
    const fire=(type,x,key='touches')=>{
      const ev=new Event(type,{bubbles:true,cancelable:true});
      Object.defineProperty(ev,key,{value:[{clientX:x,clientY:y}]});
      el.dispatchEvent(ev);
    };
    fire('touchstart',startX);
    fire('touchmove',startX+(endX-startX)*.55);
    fire('touchend',endX,'changedTouches');
  },direction);
  await page.waitForTimeout(260);
}

test('active top menu follows swipe navigation and remains visible',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await mockApp(page);
  await login(page);

  await page.evaluate(()=>window.KPTURouter.go('team',{source:'swipe'}));
  await expect(page.locator('#teamView')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>{
    const nav=document.querySelector('.app-nav');
    const active=nav?.querySelector('.nav-btn.active');
    if(!nav||!active)return false;
    const n=nav.getBoundingClientRect(),a=active.getBoundingClientRect();
    return nav.scrollLeft>0&&a.left>=n.left-1&&a.right<=n.right+1;
  })).toBe(true);

  await page.evaluate(()=>window.KPTURouter.go('home',{source:'swipe'}));
  await expect(page.locator('#homeView')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.querySelector('.app-nav')?.scrollLeft||0)).toBeLessThan(4);
});

test('calendar horizontal swipe works from toolbar, date cells and Google options',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await mockApp(page);
  await login(page);

  await page.evaluate(()=>window.KPTURouter.go('calendar',{source:'test'}));
  await expect(page.locator('#calendarView')).toBeVisible();
  const monthBefore=await page.locator('#monthTitle').textContent();
  await page.locator('#nextMonthBtn').click();
  await expect.poll(()=>page.locator('#monthTitle').textContent()).not.toBe(monthBefore);

  await swipe(page,'.calendar-toolbar','left');
  await expect.poll(()=>page.evaluate(()=>window.KPTURouter?.current)).toBe('tasks');

  await page.evaluate(()=>window.KPTURouter.go('calendar',{source:'test'}));
  await expect(page.locator('#calendarView')).toBeVisible();
  await swipe(page,'#calendarGrid .cal-cell:nth-of-type(11)','right');
  await expect.poll(()=>page.evaluate(()=>window.KPTURouter?.current)).toBe('home');

  await page.evaluate(()=>window.KPTURouter.go('calendar',{source:'test'}));
  await page.evaluate(()=>{
    const list=document.querySelector('#googleCalendarList');
    list.classList.remove('hidden');
    list.innerHTML='<b>표시할 Google 캘린더</b><label class="toggle-line"><input type="checkbox"> 테스트 캘린더</label>';
  });
  await swipe(page,'#googleCalendarList','left');
  await expect.poll(()=>page.evaluate(()=>window.KPTURouter?.current)).toBe('tasks');
});
