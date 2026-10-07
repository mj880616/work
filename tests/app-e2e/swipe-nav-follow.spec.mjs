import { test, expect } from '@playwright/test';

// Existing month-view regressions choose month explicitly.
test.beforeEach(async({page})=>{await page.addInitScript(()=>{try{localStorage.setItem('kptu-calendar-view','month')}catch{}})});
import { loginEntry } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';

async function mockApp(page){
  const user={id:'nav-user',email:'nav@example.org',user_metadata:{display_name:'메뉴 QA'}};
  const workspace={id:'nav-workspace',name:'웹2'};
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
  await page.addInitScript(()=>{try{localStorage.setItem('kptu-calendar-view','month')}catch{}});
  await page.goto(loginEntry('http://127.0.0.1:8123/app/?view=calendar'));
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
  await expect(page.locator('.kptu-swipe-panel')).toHaveCount(0);
}

// Exercise the real touch handlers; API calls are mocked only at the network boundary.
async function touchSequence(page,selector,{dx=-170,dy=2,phase='all',count=1,releaseClick=false}={}){
  return page.locator(selector).first().evaluate((el,{dx,dy,phase,count,releaseClick})=>{
    const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    const fire=(type,px,py)=>{
      const event=new Event(type,{bubbles:true,cancelable:true});
      const points=Array.from({length:count},(_,i)=>({clientX:px+i*10,clientY:py}));
      Object.defineProperty(event,'touches',{value:type==='touchend'?[]:points});
      Object.defineProperty(event,'changedTouches',{value:points});
      el.dispatchEvent(event);
      return event.defaultPrevented;
    };
    if(phase==='all'||phase==='start')fire('touchstart',x,y);
    let prevented=false;
    if(phase==='all'||phase==='move')prevented=fire('touchmove',x+dx,y+dy);
    const panel=el.closest('.view-panel'),transform=panel?.style.transform||'';
    if(phase==='all'||phase==='end')fire('touchend',x+dx,y+dy);
    if(releaseClick)el.click();
    return {prevented,transform};
  },{dx,dy,phase,count,releaseClick});
}

async function setScale(page,scale){
  await page.evaluate(scale=>{
    Object.defineProperty(window.visualViewport,'scale',{configurable:true,get:()=>scale});
    window.visualViewport.dispatchEvent(new Event('resize'));
  },scale);
}

async function openMobileApp(page){
  await page.setViewportSize({width:390,height:844});
  await mockApp(page);
  await login(page);
  await page.evaluate(()=>window.KPTURouter.go('calendar',{source:'test'}));
  await expect(page.locator('#calendarGrid .cal-cell').first()).toBeVisible();
}

// Removing the zoom guard must cause prevention, a panel transform or a route/month change.
test('zoomed calendar, tasks and projects release both pan axes and restore normal swipes',async({page})=>{
  await openMobileApp(page);
  await page.clock.install();
  const monthBefore=await page.locator('#monthTitle').textContent();
  await setScale(page,2);
  for(const [view,selector] of [['calendar','.calendar-toolbar'],['calendar','#calendarGrid .cal-cell'],['tasks','#tasksView'],['projects','#projectsView']]){
    await page.evaluate(view=>window.KPTURouter.go(view,{source:'test'}),view);
    await expect(page.locator(selector).first()).toBeVisible();
    expect(await page.locator(selector).first().evaluate(el=>getComputedStyle(el).touchAction)).toBe('auto');
    for(const direction of [{dx:-170},{dx:170},{dx:0,dy:100},{dx:0,dy:-100}]){
      expect(await touchSequence(page,selector,direction)).toEqual({prevented:false,transform:''});
      // Drain the existing swipe animation timers without a wall-clock sleep.
      await page.clock.fastForward(1000);
      expect(await page.evaluate(()=>window.KPTURouter.current)).toBe(view);
      expect(await page.locator('#monthTitle').textContent()).toBe(monthBefore);
    }
  }
  await setScale(page,1);
  await page.evaluate(()=>window.KPTURouter.go('calendar',{source:'test'}));
  const motion=await touchSequence(page,'.calendar-toolbar');
  expect(motion.prevented).toBe(true);
  expect(motion.transform).toContain('translate3d');
  await page.clock.fastForward(1000);
  await expect(page.locator('#tasksView')).toBeVisible();
  await page.evaluate(()=>window.KPTURouter.go('calendar',{source:'test'}));
  await touchSequence(page,'#calendarGrid .cal-cell');
  await page.clock.fastForward(1000);
  await expect(page.locator('#tasksView')).toBeVisible();
  expect(await page.locator('#monthTitle').textContent()).toBe(monthBefore);
});

test('normal scale tolerates small errors and allows pinch zoom without taking vertical scroll',async({page})=>{
  await openMobileApp(page);
  await setScale(page,1.005);
  expect(await page.locator('.calendar-toolbar').evaluate(el=>getComputedStyle(el).touchAction)).toBe('pan-y pinch-zoom');
  expect(await page.locator('#calendarGrid').evaluate(el=>getComputedStyle(el).touchAction)).toBe('pan-y pinch-zoom');
  expect(await touchSequence(page,'.calendar-toolbar',{dx:2,dy:100})).toEqual({prevented:false,transform:''});
  const motion=await touchSequence(page,'.calendar-toolbar');
  expect(motion.prevented).toBe(true);
  await expect(page.locator('#tasksView')).toBeVisible();
});

test('zoom and a second finger cancel active swipes before movement, release and queued navigation',async({page})=>{
  await openMobileApp(page);
  // Load the destination first so a wrongly queued route cannot hide behind lazy loading.
  await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'test'}));
  await expect(page.locator('#tasksView')).toBeVisible();
  await page.evaluate(()=>window.KPTURouter.go('calendar',{source:'test'}));
  await expect(page.locator('#calendarView')).toBeVisible();
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now()+1000));
  const monthBefore=await page.locator('#monthTitle').textContent();
  for(const selector of ['.calendar-toolbar','#calendarGrid .cal-cell']){
    for(const phase of ['move','end']){
      await touchSequence(page,selector,{phase:'start'});
      if(phase==='end')await touchSequence(page,selector,{phase:'move'});
      await setScale(page,2);
      expect(await touchSequence(page,selector,{phase})).toEqual({prevented:false,transform:''});
      await page.clock.fastForward(1000);
      expect(await page.evaluate(()=>window.KPTURouter.current)).toBe('calendar');
      expect(await page.locator('#monthTitle').textContent()).toBe(monthBefore);
      await setScale(page,1);
    }
    await touchSequence(page,selector,{phase:'start'});
    await touchSequence(page,selector,{phase:'start',count:2});
    expect(await touchSequence(page,selector,{phase:'move'})).toEqual({prevented:false,transform:''});
    await touchSequence(page,selector,{phase:'end'});
    await page.clock.fastForward(1000);
    expect(await page.evaluate(()=>window.KPTURouter.current)).toBe('calendar');
    expect(await page.locator('#monthTitle').textContent()).toBe(monthBefore);
  }
  expect((await touchSequence(page,'.calendar-toolbar')).prevented).toBe(true);
  await setScale(page,2);
  await page.clock.fastForward(1000);
  expect(await page.evaluate(()=>window.KPTURouter.current)).toBe('calendar');
  await setScale(page,1);
  expect((await touchSequence(page,'.calendar-toolbar')).prevented).toBe(true);
  await setScale(page,2);
  await setScale(page,1);
  await page.clock.fastForward(1000);
  expect(await page.evaluate(()=>window.KPTURouter.current)).toBe('calendar');
  expect((await touchSequence(page,'.calendar-toolbar')).prevented).toBe(true);
  await touchSequence(page,'.calendar-toolbar',{phase:'start',count:2});
  await page.clock.fastForward(1000);
  expect(await page.evaluate(()=>window.KPTURouter.current)).toBe('calendar');
  const prevented=await page.locator('.calendar-toolbar').evaluate(el=>{
    const r=el.getBoundingClientRect(),y=r.top+r.height/2;
    const fire=(type,x)=>{
      const e=new Event(type,{bubbles:true,cancelable:true});
      Object.defineProperty(e,type==='touchend'?'changedTouches':'touches',{value:[{clientX:x,clientY:y}]});
      el.dispatchEvent(e);
      return e.defaultPrevented;
    };
    const results=[];
    for(let i=0;i<2;i++){
      fire('touchstart',300);results.push(fire('touchmove',200));fire('touchend',130);
    }
    for(const scale of [2,1]){
      Object.defineProperty(visualViewport,'scale',{configurable:true,get:()=>scale});
      visualViewport.dispatchEvent(new Event('resize'));
    }
    return results;
  });
  expect(prevented).toEqual([true,true]);
  await page.clock.fastForward(1000);
  expect(await page.evaluate(()=>window.KPTURouter.current)).toBe('calendar');
});

test('Chromium page scale releases calendar touch action and restores it after zoom out',async({browser})=>{
  const context=await browser.newContext({viewport:{width:412,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  try{
    await page.addInitScript(()=>{try{localStorage.setItem('kptu-calendar-view','month')}catch{}});
    await mockApp(page);
    await login(page);
    await expect(page.locator('#calendarGrid')).toBeVisible();
    const cdp=await context.newCDPSession(page);
    await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:2});
    await expect.poll(()=>page.evaluate(()=>visualViewport.scale)).toBeGreaterThan(1.01);
    await expect.poll(()=>page.locator('#calendarGrid').evaluate(el=>getComputedStyle(el).touchAction)).toBe('auto');
    expect(await touchSequence(page,'.calendar-toolbar')).toEqual({prevented:false,transform:''});
    await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
    await expect.poll(()=>page.locator('#calendarGrid').evaluate(el=>getComputedStyle(el).touchAction)).toBe('pan-y pinch-zoom');
    expect((await touchSequence(page,'.calendar-toolbar')).prevented).toBe(true);
    await expect(page.locator('#tasksView')).toBeVisible();
  }finally{await context.close()}
});

test('active bottom tab follows swipes and auxiliary views leave tabs inactive',async({page})=>{
  await openMobileApp(page);
  await page.evaluate(()=>window.KPTURouter.go('pages',{source:'swipe'}));
  await expect(page.locator('#pagesView')).toBeVisible();
  await expect(page.locator('.mobile-tabs [aria-current]')).toHaveCount(0);
  await page.evaluate(()=>window.KPTURouter.go('calendar',{source:'swipe'}));
  await expect(page.locator('.mobile-tabs [data-view="calendar"]')).toHaveAttribute('aria-current','page');
  const box=await page.locator('.mobile-tabs').boundingBox();expect(box.y+box.height).toBe(844);
});

test('calendar date cells, events and overflow use menu swipes and the first-menu boundary without changing month',async({page})=>{
  await openMobileApp(page);
  await expect.poll(()=>page.evaluate(()=>KPTUViewLoader.isLoaded('calendar'))).toBe(true);
  const before=await page.locator('#monthTitle').textContent();
  await page.locator('#nextMonthBtn').click();
  await expect(page.locator('#monthTitle')).not.toHaveText(before);
  await page.locator('#prevMonthBtn').click();
  await expect(page.locator('#monthTitle')).toHaveText(before);
  await page.evaluate(()=>{
    const date=document.querySelector('.cal-cell:not(.other)').dataset.date;
    const events=Array.from({length:12},(_,i)=>({id:'swipe-'+i,calendarId:'qa',title:'QA',start:date+'T09:00:00+09:00',end:date+'T10:00:00+09:00',source:'google'}));
    window.__KPTU_SYNC_GOOGLE_EVENTS__(events);
  });
  await expect(page.locator('.cp-event').first()).toBeVisible();
  await expect(page.locator('.kptu-day-more').first()).toBeVisible();
  for(const selector of ['#calendarGrid .cal-cell','.cp-event','.kptu-day-more']){
    await setScale(page,2);
    expect(await page.locator(selector).first().evaluate(el=>getComputedStyle(el).touchAction)).toBe('auto');
    for(const dx of [-170,170]){
      expect(await touchSequence(page,selector,{dx,releaseClick:true})).toEqual({prevented:false,transform:''});
      expect(await page.evaluate(()=>KPTURouter.current)).toBe('calendar');
      await expect(page.locator('#monthTitle')).toHaveText(before);
      await expect(page.locator('.modal:not(.hidden)')).toHaveCount(0);
    }
    await setScale(page,1);
  }
  for(const selector of ['#calendarGrid .cal-cell','.cp-event','.kptu-day-more'])for(const [dx,destination] of [[-170,'tasks'],[170,'home']]){
    await page.evaluate(()=>KPTURouter.go('calendar',{source:'test'}));
    await expect(page.locator(selector).first()).toBeVisible();
    await touchSequence(page,selector,{dx,releaseClick:true});
    await expect.poll(()=>page.evaluate(()=>KPTURouter.current)).toBe(destination);
    await expect(page.locator('#'+destination+'View')).toBeVisible();
    await expect(page.locator('#monthTitle')).toHaveText(before);
    await expect(page.locator('.modal:not(.hidden)')).toHaveCount(0);
    await expect(page.locator('.kptu-swipe-panel')).toHaveCount(0);
  }
});

test('760px enables menu swipes and 761px touch width has no menu or month swipe',async({browser})=>{
  const context=await browser.newContext({viewport:{width:761,height:844},hasTouch:true});
  const page=await context.newPage();
  try{
    await openMobileApp(page);
    await page.clock.install();
    const before=await page.locator('#monthTitle').textContent();
    for(const width of [761,820]){
      await page.setViewportSize({width,height:844});
      expect(await touchSequence(page,'#calendarGrid .cal-cell')).toEqual({prevented:false,transform:''});
      await page.clock.fastForward(1000);
      expect(await page.evaluate(()=>KPTURouter.current)).toBe('calendar');
      await expect(page.locator('#monthTitle')).toHaveText(before);
    }
    await page.setViewportSize({width:760,height:844});
    expect((await touchSequence(page,'#calendarGrid .cal-cell')).prevented).toBe(true);
    await page.clock.fastForward(1000);
    await expect(page.locator('#tasksView')).toBeVisible();
    await expect(page.locator('#monthTitle')).toHaveText(before);
  }finally{await context.close()}
});

test('calendar toolbar and Google calendar list retain menu swipes',async({page})=>{
  await openMobileApp(page);
  const before=await page.locator('#monthTitle').textContent();
  await swipe(page,'.calendar-toolbar','left');
  await expect(page.locator('#tasksView')).toBeVisible();
  await page.evaluate(()=>KPTURouter.go('calendar',{source:'test'}));
  await page.evaluate(()=>{const list=document.querySelector('#googleCalendarList');list.classList.remove('hidden');list.innerHTML='<b>QA</b><label><input type="checkbox">QA</label>';});
  await swipe(page,'#googleCalendarList','left');
  await expect(page.locator('#tasksView')).toBeVisible();
  await expect(page.locator('#monthTitle')).toHaveText(before);
});
