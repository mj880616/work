import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'design-system-user',email:'design-system@example.org',user_metadata:{display_name:'Design QA'}};
const workspace={id:'design-system-workspace',slug:'design-system',name:'웹2'};

async function mockApp(page,{spaces=[]}={}){
  await page.route(`${SB}/**`,async route=>{
    const url=new URL(route.request().url());
    const path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'design-access',refresh_token:'design-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email}]);
    if(path==='/rest/v1/app_workspaces')return ok([workspace]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'Design QA'}]);
    if(path==='/rest/v1/app_tasks')return ok([]);
    if(path==='/rest/v1/app_spaces')return ok(spaces);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

async function signIn(page){
  await enterLogin(page);
  await expect(page.locator('#emailAuthToggle')).toBeVisible({timeout:10000});
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill(user.email);
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
}


const THEME_STORAGE_KEY='kptu-theme';
const primary={olive:'#5c6a35',navy:'#263f5f',terracotta:'#a8582a',sand:'#4a3d33'};
const readPrimary=page=>page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--kptu-primary').trim());
for(const stored of [null,'olive','navy','terracotta','sand','invalid']){
 test('first paint and reload retain '+stored,async({page})=>{
  await page.addInitScript(({value,THEME_STORAGE_KEY})=>{if(value===null)localStorage.removeItem(THEME_STORAGE_KEY);else localStorage.setItem(THEME_STORAGE_KEY,value);
   window.firstThemeFrame=new Promise(resolve=>requestAnimationFrame(()=>resolve(getComputedStyle(document.documentElement).getPropertyValue('--kptu-primary').trim())));
  },{value:stored,THEME_STORAGE_KEY});
  await page.goto('http://127.0.0.1:8123/app/login/');
  const expected=primary[stored]||primary.olive;
  expect(await page.evaluate(()=>window.firstThemeFrame)).toBe(expected);
  expect(await readPrimary(page)).toBe(expected);
  await page.reload();expect(await readPrimary(page)).toBe(expected);
  await mockApp(page);await signIn(page);
  expect(await page.evaluate(()=>window.firstThemeFrame)).toBe(expected);
  await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  expect(await page.evaluate(()=>window.firstThemeFrame)).toBe(expected);
  expect(await readPrimary(page)).toBe(expected);
 });
}
test('blocked theme storage starts olive without theme errors',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(THEME_STORAGE_KEY=>Object.defineProperty(window,'localStorage',{get(){throw Error(THEME_STORAGE_KEY+' storage blocked')}}),THEME_STORAGE_KEY);
 await page.goto('http://127.0.0.1:8123/app/login/');
 expect(await readPrimary(page)).toBe(primary.olive);
 expect(errors.filter(x=>x.includes('storage blocked'))).toEqual([]);
});
for(const width of [390,1440]){
 test('theme dialog selection, navigation and dismissal at '+width,async({page})=>{
  await page.setViewportSize({width,height:900});await mockApp(page);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  const trigger=page.locator('#sidebarThemeBtn');
  await expect(trigger).toBeVisible();
  expect(await trigger.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  const dialog=page.getByRole('dialog',{name:'화면 색'});
  for(const [theme,color] of Object.entries(primary)){
   await trigger.click();await expect(dialog).toBeVisible();
   const option=dialog.locator('[data-theme-choice="'+theme+'"]');
   expect(await option.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
   await option.click();expect(await readPrimary(page)).toBe(color);
   await expect(option).toHaveAttribute('aria-pressed','true');
   expect(await page.evaluate(THEME_STORAGE_KEY=>localStorage.getItem(THEME_STORAGE_KEY),THEME_STORAGE_KEY)).toBe(theme);
   expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
   await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay||null)).toBe(null);
  }
  await page.locator('[data-view="tasks"]').first().click();expect(await readPrimary(page)).toBe(primary.sand);
  await page.reload();await expect(trigger).toBeVisible();expect(await readPrimary(page)).toBe(primary.sand);
  await trigger.click();await expect(dialog).toBeVisible();await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBe('themeModal');
  await page.goBack();await expect(dialog).toBeHidden();expect(await readPrimary(page)).toBe(primary.sand);
  await trigger.click();await expect(dialog).toBeVisible();await page.locator('#themeModal').click({position:{x:4,y:4}});await expect(dialog).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay||null)).toBe(null);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:team-ready',{detail:{state:'auth'}})));
  for(const button of await page.locator('[data-theme-open]').all())await expect(button).toBeHidden();
 });
}

test('direct color guard and its regression cases pass',async()=>{
 const {execFileSync}=await import('node:child_process');
 execFileSync(process.execPath,['--test','tests/hardcoded-colors.test.mjs','tests/theme-bootstrap.test.mjs'],{stdio:'pipe'});
});

test('blocked theme write still applies and does not save profile',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await mockApp(page);
 await page.goto('http://127.0.0.1:8123/app/');await signIn(page);
 await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
 const writes=[];page.on('request',r=>{if(r.url().includes('/rest/v1/')&&r.method()!=='GET')writes.push(r.url())});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='kptu-theme')throw Error('theme write blocked');return original.call(this,key,value)}});
 await page.locator('#sidebarThemeBtn').click();await page.locator('[data-theme-choice="navy"]').click();
 expect(await readPrimary(page)).toBe(primary.navy);expect(errors).toEqual([]);expect(writes).toEqual([]);
});

test('theme returns focus after project history listeners run',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await mockApp(page);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);
 await page.locator('[data-view="projects"]').first().click();await expect(page.locator('#newProjectBtn')).toBeVisible();
 const trigger=page.locator('#sidebarThemeBtn');
 for(const close of ['Escape','outside','back','button']){
  await trigger.click();await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBe('themeModal');
  if(close==='Escape')await page.keyboard.press('Escape');
  else if(close==='outside')await page.locator('#themeModal').click({position:{x:4,y:4}});
  else if(close==='back')await page.goBack();
  else await page.getByRole('button',{name:'화면 색 선택 창 닫기'}).click();
  await expect(page.locator('#themeModal')).toBeHidden();await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay||null)).toBe(null);
  await expect(trigger).toBeFocused();
 }
});

test('390px menu end shows theme button and scrolling does not switch views',async({page})=>{
 await page.setViewportSize({width:390,height:900});await mockApp(page);await page.goto('http://127.0.0.1:8123/app/');await signIn(page);
 await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
 const nav=page.locator('#appView>.app-nav');
 await nav.evaluate(el=>el.scrollLeft=el.scrollWidth);
 const metrics=await nav.evaluate(el=>{const n=el.getBoundingClientRect(),t=el.querySelector('#sidebarThemeBtn').getBoundingClientRect(),l=el.querySelector('#sidebarLogoutBtn').getBoundingClientRect();return {navLeft:n.left,navRight:n.right,themeLeft:t.left,themeRight:t.right,themeWidth:t.width,themeHeight:t.height,logoutRight:l.right,adjacent:el.querySelector('#sidebarThemeBtn').nextElementSibling.id,topbar:getComputedStyle(document.querySelector('.topbar')).display}});
 expect(metrics.adjacent).toBe('sidebarLogoutBtn');expect(metrics.topbar).toBe('none');
 expect(metrics.themeLeft).toBeGreaterThanOrEqual(metrics.navLeft);expect(metrics.themeRight).toBeLessThanOrEqual(metrics.navRight);expect(metrics.logoutRight).toBeLessThanOrEqual(metrics.navRight);
 expect(metrics.themeWidth).toBeGreaterThanOrEqual(44);expect(metrics.themeHeight).toBeGreaterThanOrEqual(44);
 await expect.poll(()=>page.evaluate(()=>window.__KPTU_MOBILE_SWIPE_NAV__)).toBe(true);
 await page.evaluate(()=>{window.themeNavigationCalls=[];const original=window.KPTURouter.go;window.KPTURouter.go=function(...args){window.themeNavigationCalls.push(args);return original.apply(this,args)}});
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
 const box=await nav.boundingBox();const start={x:box.x+100,y:box.y+box.height/2};const before=await nav.evaluate(el=>el.scrollLeft);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
 for(const dx of [40,80,120])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+dx,y:start.y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect.poll(()=>nav.evaluate(el=>el.scrollLeft)).toBeLessThan(before);
 await expect(page.locator('#calendarView')).toBeVisible();await expect(page.locator('#themeModal')).toBeHidden();
 expect(await page.evaluate(()=>window.themeNavigationCalls)).toEqual([]);
 await nav.evaluate(el=>el.scrollLeft=el.scrollWidth);await page.locator('#sidebarThemeBtn').click();await expect(page.locator('#themeModal')).toBeVisible();
 expect(await page.evaluate(()=>window.themeNavigationCalls)).toEqual([]);
});

// D-3b: computed colors on the actual eight routes, including a populated project detail.
for(const width of [390,1440])for(const [theme,color] of Object.entries(primary)){
 test('D-3b route colors '+theme+' at '+width,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.addInitScript(({theme,THEME_STORAGE_KEY})=>localStorage.setItem(THEME_STORAGE_KEY,theme),{theme,THEME_STORAGE_KEY});
  await mockApp(page,{spaces:[{id:'theme-project',workspace_id:workspace.id,name:'Theme fixture',status:'active',owner_id:user.id,created_by:user.id,metadata:{project_system:'v2',management_version:2},visibility:'private'}]});
  await page.route('https://raw.githubusercontent.com/**',route=>route.fulfill({status:200,body:'<p>Fixture</p>'}));
  await page.goto('http://127.0.0.1:8123/app/');await signIn(page);
  const rgb=hex=>'rgb('+hex.slice(1).match(/../g).map(v=>parseInt(v,16)).join(', ')+')';
  const surface={olive:'#fffefa',navy:'#ffffff',terracotta:'#fffdf9',sand:'#fffcf6'};
  const matches=async(selector,property,hex)=>{
   const element=page.locator(selector).first();await expect(element).toBeVisible();
   await expect.poll(()=>element.evaluate((el,property)=>getComputedStyle(el)[property],property)).toBe(rgb(hex));
  };
  for(const [view,selector,property,expected] of [
   ['calendar','#calendarCard','backgroundColor',surface[theme]],
   ['tasks','#newTaskBtn','backgroundColor',color],
   ['projects','#newProjectBtn','backgroundColor',color],
   ['library','#libraryListCard','backgroundColor',surface[theme]],
   ['meetings','#newMeetingBtn','backgroundColor',color],
   ['media','.w1p-filter.active','backgroundColor',color],
   ['pages','.w1b-card','backgroundColor',surface[theme]],
   ['team','#soAddOrg','backgroundColor',surface[theme]]
  ]){
   await page.locator('.app-nav [data-view="'+view+'"]').click();
   await expect(page.locator('#'+view+'View')).toBeVisible();
   await expect.poll(()=>page.evaluate(view=>window.KPTUViewLoader.isLoaded(view),view)).toBe(true);
   expect(await readPrimary(page)).toBe(color);
   await matches('.app-nav .nav-btn.active','backgroundColor',color);
   await matches(selector,property,expected);
   if(view==='projects'){
    await page.locator('[data-ps3-project="theme-project"]').first().click();
    await matches('#ps3DetailModal .modal-card','backgroundColor',surface[theme]);
    expect(await readPrimary(page)).toBe(color);
    await page.locator('[data-ps3-close="ps3DetailModal"]').click();
    await expect(page.locator('#ps3DetailModal')).toBeHidden();
   }
  }
 });
}

for(const theme of Object.keys(primary)){
 test('D-3b followup toast warning and focus colors '+theme,async({page})=>{
  const {readFileSync}=await import('node:fs');
  const warningStyle=readFileSync('app/calendar-health.js','utf8').match(/st.textContent=`([\s\S]*?)`/)[1];
  await page.addInitScript(({theme,THEME_STORAGE_KEY})=>localStorage.setItem(THEME_STORAGE_KEY,theme),{theme,THEME_STORAGE_KEY});
  await page.goto('http://127.0.0.1:8123/app/login/');
  await page.addStyleTag({content:warningStyle});
  await page.evaluate(()=>{const host=document.createElement('div');host.innerHTML='<div class="toast" id="followupToast">Fixture</div><div id="googleCalendarWarning">Fixture <a href="#">Link</a></div><input id="followupFocus">';document.body.append(host)});
  const token=async name=>page.evaluate(name=>{const probe=document.createElement('i');probe.style.color='var('+name+')';document.body.append(probe);const color=getComputedStyle(probe).color;probe.remove();return color},name);
  await expect(page.locator('#followupToast')).toHaveCSS('background-color',await token('--kptu-ink'));
  await expect(page.locator('#followupToast')).toHaveCSS('color',await token('--kptu-surface'));
  await expect(page.locator('#googleCalendarWarning')).toHaveCSS('background-color',await token('--kptu-warning-soft'));
  await expect(page.locator('#googleCalendarWarning')).toHaveCSS('color',await token('--kptu-warning'));
  await expect(page.locator('#googleCalendarWarning a')).toHaveCSS('color',await token('--kptu-link'));
  await page.locator('#followupFocus').focus();
  await expect(page.locator('#followupFocus')).toHaveCSS('box-shadow',(await token('--kptu-primary-soft'))+' 0px 0px 0px 3px');
 });
}
