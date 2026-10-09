import {clickView,accountButton} from './helpers/shell-navigation.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'design-system-user',email:'design-system@example.org',user_metadata:{display_name:'Design QA'}};
const workspace={id:'design-system-workspace',slug:'design-system',name:'웹2'};

async function mockApp(page,{spaces=[],tasks=[]}={}){
  await page.route(`${SB}/**`,async route=>{
    const url=new URL(route.request().url());
    const path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'design-access',refresh_token:'design-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/google-tasks')return ok({connected:true,authorized:true,pending_scope:"all",tasks});
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
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:10000});
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
  await page.goto('http://127.0.0.1:8123/app/?view=calendar');
  await signIn(page);await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  const account=accountButton(page);
  const trigger=page.locator(width<=760?'#mobileMenu [data-theme-open]':'#sidebarThemeBtn');
  const openTheme=async()=>{await account.click();await trigger.click()};
  await expect(account).toBeVisible();
  expect(await account.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  const dialog=page.getByRole('dialog',{name:'화면 색'});
  for(const [theme,color] of Object.entries(primary)){
   await openTheme();await expect(dialog).toBeVisible();
   const option=dialog.locator('[data-theme-choice="'+theme+'"]');
   expect(await option.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
   await option.click();expect(await readPrimary(page)).toBe(color);
   await expect(option).toHaveAttribute('aria-pressed','true');
   expect(await page.evaluate(THEME_STORAGE_KEY=>localStorage.getItem(THEME_STORAGE_KEY),THEME_STORAGE_KEY)).toBe(theme);
   expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(account).toBeFocused();
   await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay||null)).toBe(null);
  }
  await clickView(page,'tasks');expect(await readPrimary(page)).toBe(primary.sand);
  await page.reload();await expect(account).toBeVisible();expect(await readPrimary(page)).toBe(primary.sand);
  await openTheme();await expect(dialog).toBeVisible();await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBe('themeModal');
  await page.goBack();await expect(dialog).toBeHidden();expect(await readPrimary(page)).toBe(primary.sand);
  await openTheme();await expect(dialog).toBeVisible();await page.locator('#themeModal').click({position:{x:4,y:4}});await expect(dialog).toBeHidden();
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
 await page.goto('http://127.0.0.1:8123/app/?view=calendar');await signIn(page);
 await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
 const writes=[];page.on('request',r=>{if(r.url().includes('/rest/v1/')&&r.method()!=='GET')writes.push(r.url())});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='kptu-theme')throw Error('theme write blocked');return original.call(this,key,value)}});
 await accountButton(page).click();await page.locator('#sidebarThemeBtn').click();await page.locator('[data-theme-choice="navy"]').click();
 expect(await readPrimary(page)).toBe(primary.navy);expect(errors).toEqual([]);expect(writes).toEqual([]);
});

test('theme returns focus after project history listeners run',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await mockApp(page);await page.goto('http://127.0.0.1:8123/app/?view=calendar');await signIn(page);
 await clickView(page,'projects');await expect(page.locator('#newProjectBtn')).toBeVisible();
 const account=accountButton(page);
 const trigger=page.locator('#sidebarThemeBtn');
 const openTheme=async()=>{await account.click();await trigger.click()};
 for(const close of ['Escape','outside','back','button']){
  await openTheme();await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBe('themeModal');
  if(close==='Escape')await page.keyboard.press('Escape');
  else if(close==='outside')await page.locator('#themeModal').click({position:{x:4,y:4}});
  else if(close==='back')await page.goBack();
  else await page.getByRole('button',{name:'화면 색 선택 창 닫기'}).click();
  await expect(page.locator('#themeModal')).toBeHidden();await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay||null)).toBe(null);
  await expect(account).toBeFocused();
 }
});

test('390px drawer keeps account actions and dismissal without switching views',async({page})=>{
 await page.setViewportSize({width:390,height:900});await mockApp(page);await page.goto('http://127.0.0.1:8123/app/?view=calendar');await signIn(page);
 const account=accountButton(page),panel=page.locator('#mobileMenu');
 await expect(page.locator('#appView>.app-nav')).toBeHidden();
 for(const close of ['outside','back']){
  await account.click();await expect(panel).toBeVisible();
  await expect.poll(async()=>{const pb=await panel.locator('.mobile-menu-panel').boundingBox();return pb.x+pb.width}).toBe(390);expect((await panel.locator('.mobile-menu-panel').boundingBox()).width).toBe(260);
  if(close==='outside')await page.mouse.click(10,500);else await page.goBack();
  await expect(panel).toBeHidden();await expect(page.locator('#calendarView')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>history.state?.kptuMobileMenu||null)).toBe(null);
 }
 await account.click();await panel.locator('[data-theme-open]').click();await expect(page.locator('#themeModal')).toBeVisible();
});

// D-3b: computed colors on the actual eight routes, including a populated project detail.
for(const width of [390,1440])for(const [theme,color] of Object.entries(primary)){
 test('D-3b route colors '+theme+' at '+width,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.addInitScript(({theme,THEME_STORAGE_KEY})=>localStorage.setItem(THEME_STORAGE_KEY,theme),{theme,THEME_STORAGE_KEY});
  await mockApp(page,{spaces:[{id:'theme-project',workspace_id:workspace.id,name:'Theme fixture',status:'active',owner_id:user.id,created_by:user.id,metadata:{project_system:'v2',management_version:2},visibility:'private'}]});
  await page.route('https://raw.githubusercontent.com/**',route=>route.fulfill({status:200,body:'<p>Fixture</p>'}));
  await page.goto('http://127.0.0.1:8123/app/?view=calendar');await signIn(page);
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
   await clickView(page,view);
   await expect(page.locator('#'+view+'View')).toBeVisible();await expect.poll(()=>page.evaluate(view=>window.KPTUViewLoader.isLoaded(view),view)).toBe(true);
   await expect.poll(()=>page.evaluate(view=>window.KPTUViewLoader.isLoaded(view),view)).toBe(true);
   expect(await readPrimary(page)).toBe(color);
   if(width<=760){if(['calendar','tasks','projects','team'].includes(view))await matches('.mobile-tabs [aria-current]','color',theme==='olive'?'#47532a':theme==='navy'?'#355f86':theme==='terracotta'?'#7f3f1b':'#7a5012');}else await matches('.app-nav .nav-btn.active','backgroundColor',color);
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
  await expect(page.locator('#followupFocus')).toHaveCSS('border-color',await token('--kptu-primary-ink'));
  await expect(page.locator('#followupFocus')).toHaveCSS('box-shadow',(await token('--kptu-primary-soft'))+' 0px 0px 0px 3px');
 });
}

for(const width of [390,1440])test('D-3c shell owns account and orders its actions '+width,async({page})=>{
 await page.setViewportSize({width,height:900});await mockApp(page);await page.goto('http://127.0.0.1:8123/app/?view=calendar');await signIn(page);
 const nav=page.locator('#appView>.app-nav'),account=accountButton(page);
 await expect(account).toBeVisible();
 await expect(nav.locator(':scope > [data-theme-open], :scope > [data-kptu-logout]')).toHaveCount(0);
 await account.click();
 const panel=page.locator(width<=760?'#mobileMenu':'#sidebarAccountPanel');await expect(panel).toBeVisible();
 expect(await panel.locator(width<=760?'#mobileAccountGroup button':'button').allTextContents()).toEqual(['화면 색','로그아웃']);
 await page.keyboard.press('Escape');await expect(panel).toBeHidden();await expect(account).toBeFocused();
 await account.click();await page.goBack();await expect(panel).toBeHidden();
});

for(const width of [390,1440])test('D-3c painted buttons and real 44px pointer targets '+width,async({page})=>{
 await page.setViewportSize({width,height:900});await mockApp(page,{tasks:[{id:'pointer-task',title:'Fixture',status:'needsAction',taskListTitle:'Fixture'}]});await page.goto('http://127.0.0.1:8123/app/?view=calendar');await signIn(page);
 const check=async(selector,painted)=>{
  const button=page.locator(selector);await expect(button).toBeVisible();await button.scrollIntoViewIfNeeded();
  const bounds=await button.evaluate(el=>{
   const r=el.getBoundingClientRect(),p=getComputedStyle(el,'::after'),style=getComputedStyle(el);
   const active=p.content!=='none';const left=active?r.left+parseFloat(style.borderLeftWidth)+parseFloat(p.left):r.left,top=active?r.top+parseFloat(style.borderTopWidth)+parseFloat(p.top):r.top;
   const width=active?parseFloat(p.width):r.width,height=active?parseFloat(p.height):r.height;
   return {paintedHeight:r.height,width,height,debug:{left,top,viewport:innerHeight,r:{top:r.top,bottom:r.bottom},disabled:el.disabled},hits:[[left+1,top+height/2],[left+width-1,top+height/2],[left+width/2,top+1],[left+width/2,top+height-1]].map(([x,y])=>{const hit=document.elementFromPoint(x,y);return {same:hit?.closest('button')===el,tag:hit?.tagName,id:hit?.id,cls:hit?.className}})};
  });
  expect(bounds.paintedHeight).toBe(painted);expect(bounds.width).toBeGreaterThanOrEqual(44);expect(bounds.height).toBeGreaterThanOrEqual(44);expect(bounds.hits.every(hit=>hit.same),selector+' '+JSON.stringify(bounds)).toBe(true);
 };
 await check('#prevMonthBtn',32);await check('#nextMonthBtn',32);await check('#newEventBtn',32);
 await page.locator('#newEventBtn').click();await expect(page.locator('#eventModal')).toBeVisible();
 await check('#eventModal .icon-btn',32);await check('#saveEventBtn',36);
 const close=page.locator('#eventModal .icon-btn');await close.scrollIntoViewIfNeeded();const r=await close.boundingBox();
 await page.mouse.click(r.x+r.width/2,r.y-4);await expect(page.locator('#eventModal')).toBeHidden();
 await clickView(page,'tasks');await expect(page.locator('#gtTaskBody .gt-menu-trigger')).toBeVisible();await check('#gtTaskBody .gt-menu-trigger',44);
});

for(const width of [390,1440])test('D-3c expanded buttons do not overlap adjacent controls '+width,async({page})=>{
 await page.setViewportSize({width,height:900});await mockApp(page);await page.goto('http://127.0.0.1:8123/app/?view=calendar');await signIn(page);
 for(const view of ['calendar','tasks','projects','meetings','library','media','pages','team']){
  await clickView(page,view);await expect(page.locator('#'+view+'View')).toBeVisible();await expect.poll(()=>page.evaluate(view=>window.KPTUViewLoader.isLoaded(view),view)).toBe(true);
  const overlaps=await page.evaluate(()=>{
   const visible=el=>el.checkVisibility({checkVisibilityCSS:true});
   const controls=[...document.querySelectorAll('button,input,select,textarea,a[href],summary')].filter(visible);
   const rect=el=>{
    const r=el.getBoundingClientRect(),p=getComputedStyle(el,'::after'),s=getComputedStyle(el);
    if(el.matches('button:is(.primary,.secondary,.ghost,.danger,.mini,.icon-btn)')&&p.content!=='none'){
     const left=r.left+parseFloat(s.borderLeftWidth)+parseFloat(p.left),top=r.top+parseFloat(s.borderTopWidth)+parseFloat(p.top);
     return {left,top,right:left+parseFloat(p.width),bottom:top+parseFloat(p.height)};
    }return r;
   };
   const buttons=controls.filter(el=>el.matches('button:is(.primary,.secondary,.ghost,.danger,.mini,.icon-btn)')&&getComputedStyle(el,'::after').content!=='none');
   const result=[];
   for(const button of buttons)for(const other of controls){
    if(button===other||button.contains(other)||other.contains(button))continue;
    const a=rect(button),b=rect(other);
    if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>0.5&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>0.5)result.push([button.id||button.className,other.id||other.className]);
   }return result;
  });expect(overlaps,view).toEqual([]);
 }
});

for(const width of [390,1440])test('D-3c outside navigation keeps its route and one back entry '+width,async({page})=>{
 await page.setViewportSize({width,height:900});await mockApp(page);await page.goto('http://127.0.0.1:8123/app/?view=calendar');await signIn(page);
 await clickView(page,'tasks');await expect(page.locator('#tasksView')).toBeVisible();
 await clickView(page,'calendar');await expect(page.locator('#calendarView')).toBeVisible();
 const account=accountButton(page);await account.click();
 if(width<=760){await page.mouse.click(10,500);await expect(page.locator('#mobileMenu')).toBeHidden();}
 await clickView(page,'tasks');await expect(page.locator('#sidebarAccountPanel')).toBeHidden();
 await expect.poll(()=>page.evaluate(()=>history.state?.kptuAccount||null)).toBe(null);
 await expect(page.locator('#tasksView')).toBeVisible();await expect(page).toHaveURL(/view=tasks/);
 await page.goBack();await expect(page.locator('#calendarView')).toBeVisible();
});

for(const width of [390,760,761,1023,1024,1280,1439,1440])test('D-3c account matches menu typography '+width,async({page})=>{
 await page.setViewportSize({width,height:900});await mockApp(page);await page.goto('http://127.0.0.1:8123/app/?view=calendar');await signIn(page);
 if(width<=760){await accountButton(page).click();await expect(page.locator('#mobileMenu [data-theme-open]')).toHaveCSS('font-size','14px');await expect(page.locator('.mobile-tabs [data-view="tasks"]')).toHaveCSS('font-size','12px');return;}
 const styles=await page.evaluate(()=>{
  const nav=getComputedStyle(document.querySelector('.app-nav [data-view="tasks"]')),account=getComputedStyle(document.querySelector(innerWidth<1024?'#mobileMenuOpen':'.app-nav [data-account-open]'));
  const keys=['fontSize','fontWeight','color'];return {nav:keys.map(k=>nav[k]),account:keys.map(k=>account[k])};
 });expect(styles.account).toEqual(styles.nav);
});

test('D-3c crowded compact actions retain their own click areas',async({page})=>{
 await page.goto('http://127.0.0.1:8123/app/login/');
 await page.evaluate(()=>{
  for(const cls of ['card-actions','head-actions','page-card-foot','side-actions','auth-tabs','compact-entry-actions','ps3-row-actions','ps3-page-actions','meeting-file-actions','mrd-task-actions','ps3-pg-quick']){
   const row=document.createElement('div');row.className=cls;row.innerHTML='<button class="mini">열기</button><button class="mini">수정</button>';document.body.append(row);
  }
 });
 const targets=await page.locator('body>div button.mini').evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el,'::after').content));
 expect(targets).toHaveLength(22);expect(targets.every(content=>content==='none')).toBe(true);
});

// Account placement is anchored to its trigger, including browsers without Popover API.
for(const width of [390,1440])for(const nativePopover of [true,false]){
 test('D-3c account anchored placement and dismissal '+width+' popover='+nativePopover,async({page})=>{
  await page.setViewportSize({width,height:900});
  if(!nativePopover)await page.addInitScript(()=>{
   for(const name of ['showPopover','hidePopover','togglePopover','popover'])delete HTMLElement.prototype[name];
  });
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await mockApp(page);await page.goto('http://127.0.0.1:8123/app/?view=calendar');await signIn(page);
  const nav=page.locator('#appView>.app-nav'),account=accountButton(page),panel=page.locator(width<=760?'#mobileMenu':'#sidebarAccountPanel');
  const open=async()=>{
   if(width<=760){await account.click();await expect(panel).toBeVisible();await expect(account).toHaveAttribute('aria-expanded','true');await expect.poll(async()=>{const box=await panel.locator('.mobile-menu-panel').boundingBox();return box.x+box.width}).toBe(width);expect((await panel.locator('.mobile-menu-panel').boundingBox()).width).toBe(260);return;}
   await account.click();await expect(panel).toBeVisible();
   await expect(account).toHaveAttribute('aria-expanded','true');
   await expect.poll(()=>panel.evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThan(0);
   const geometry=await page.evaluate(()=>{
    const t=document.querySelector('.app-nav [data-account-open]').getBoundingClientRect(),p=document.querySelector('#sidebarAccountPanel').getBoundingClientRect(),n=document.querySelector('#appView>.app-nav');
    const b=n.getBoundingClientRect(),s=getComputedStyle(n);
    return {button:{top:t.top,bottom:t.bottom,right:t.right},panel:{left:p.left,right:p.right,top:p.top,bottom:p.bottom},inside:{left:b.left+parseFloat(s.borderLeftWidth)+parseFloat(s.paddingLeft),right:b.right-parseFloat(s.borderRightWidth)-parseFloat(s.paddingRight)}};
   });
   expect(geometry.panel.left).toBeGreaterThanOrEqual(12);
   expect(geometry.panel.right).toBeLessThanOrEqual(width-12);
   expect(geometry.panel.top).toBeGreaterThanOrEqual(12);
   expect(geometry.panel.bottom).toBeLessThanOrEqual(888);
   if(width===390){
    expect(Math.abs(geometry.panel.right-geometry.button.right)).toBeLessThanOrEqual(2);
    expect(geometry.panel.top).toBeGreaterThanOrEqual(geometry.button.bottom);
   }else{
    expect(geometry.panel.bottom).toBeLessThanOrEqual(geometry.button.top);
    expect(geometry.panel.left).toBeGreaterThanOrEqual(geometry.inside.left-1);
    expect(geometry.panel.right).toBeLessThanOrEqual(geometry.inside.right+1);
    expect(Math.abs(geometry.panel.left-geometry.inside.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.panel.right-geometry.inside.right)).toBeLessThanOrEqual(1);
   }
  };
  for(const close of ['outside','Escape','back']){
   await open();
   if(close==='outside')await page.mouse.click(width<=760?10:width-12,500);
   else if(close==='Escape')await page.keyboard.press('Escape');
   else await page.goBack();
   await expect(panel).toBeHidden();await expect(account).toHaveAttribute('aria-expanded','false');
   await expect.poll(()=>page.evaluate(()=>history.state?.kptuAccount||null)).toBe(null);
  }
  await open();await panel.locator('[data-theme-open]').click();await expect(page.locator('#themeModal')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#themeModal')).toBeHidden();await expect(account).toBeFocused();
  expect(errors).toEqual([]);
 });
}
