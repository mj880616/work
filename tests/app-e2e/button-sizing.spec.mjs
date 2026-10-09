import {clickView} from './helpers/shell-navigation.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'design-system-user',email:'design-system@example.org',user_metadata:{display_name:'Design QA'}};
const workspace={id:'design-system-workspace',slug:'design-system',name:'웹2'};

async function mockApp(page,{spaces=[],tasks=[],calendarEvents=[]}={}){
  await page.route(`${SB}/**`,async route=>{
    const url=new URL(route.request().url());
    const path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'design-access',refresh_token:'design-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok(url.searchParams.get('action')==='event'?{event:calendarEvents[0]}:{connected:calendarEvents.length>0,enabled:calendarEvents.length>0,selected:['primary'],calendars:[{id:'primary',summary:'QA',primary:true}],events:calendarEvents,eventColors:{}});
    if(path==='/functions/v1/google-tasks')return ok({connected:true,authorized:true,pending_scope:"all",tasks});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email}]);
    if(path==='/rest/v1/app_workspaces')return ok([workspace]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'Design QA'}]);
    if(path==='/rest/v1/app_meetings')return ok([{id:'type-meeting',workspace_id:workspace.id,title:'Fixture meeting',meeting_name:'Fixture meeting',round_no:2,meeting_at:'2026-10-05T12:00:00'}]);
    if(path==='/rest/v1/app_suborganizations')return ok([{id:'type-org',name:'Fixture organization',active:true,created_by:user.id}]);
    if(path==='/rest/v1/app_suborganization_assignees')return ok([{organization_id:'type-org',user_id:user.id}]);
    if(path==='/rest/v1/app_documents')return ok([{id:'size-doc',workspace_id:workspace.id,title:'Fixture document',created_by:user.id,url:'https://example.org/fixture.pdf'}]);
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



import {execFileSync} from 'node:child_process';
async function boot(page,tasks=[],calendarEvents=[]){
 await mockApp(page,{tasks,calendarEvents,spaces:[{id:'type-project',workspace_id:workspace.id,name:'Fixture project',status:'active',owner_id:user.id,created_by:user.id,metadata:{project_system:'v2',management_version:2}},{id:'type-archive',workspace_id:workspace.id,name:'Archive fixture',status:'archived',owner_id:user.id,created_by:user.id,metadata:{project_system:'v2',management_version:2}}]});
 await page.goto('http://127.0.0.1:8123/app/');await signIn(page);
}
async function view(page,name){await clickView(page,name);await expect.poll(()=>page.evaluate(name=>window.KPTUViewLoader.isLoaded(name),name)).toBe(true);}
async function baseline(page,ref='3824ca580ddcc1ba50154b45cf220c6e73742627'){
 const cache=new Map();
 await page.route(/^http:\/\/127\.0\.0\.1:8123\/(?:app|press)\//,route=>{
  let path=new URL(route.request().url()).pathname.slice(1);if(path.endsWith('/'))path+='index.html';
  if(!/\.(css|js|html)$/.test(path))return route.continue();
  if(!cache.has(path))cache.set(path,execFileSync('git',['show',ref+':'+path],{encoding:'utf8'}));
  const contentType=path.endsWith('.css')?'text/css':path.endsWith('.js')?'text/javascript':'text/html';
  return route.fulfill({status:200,contentType,body:cache.get(path)});
 });
}

const listButtons={projects:['#ps3ArchiveBtn','#newProjectBtn'],calendar:['#googleConnectBtn'],meetings:['#newMeetingBtn'],team:['#soAddOrg'],media:['[data-press-type="all"]','[data-press-type="statement"]','[data-press-type="release"]','[data-press-type="request"]']};
async function muted(page){return page.evaluate(()=>{const el=document.createElement('span');el.style.color='var(--kptu-muted)';document.body.append(el);const value=getComputedStyle(el).color;el.remove();return value})}
async function size(el){return el.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {height:r.height,font:s.fontSize,paddingLeft:s.paddingLeft,paddingRight:s.paddingRight,radius:s.borderRadius,weight:s.fontWeight,color:s.color,background:s.backgroundColor}})}
async function standard(page,selector){const el=page.locator(selector);await expect(el).toBeVisible();await expect(el).toHaveCSS('font-size','12px');const s=await size(el);expect(s.height,selector).toBeGreaterThanOrEqual(35);expect(s.height,selector).toBeLessThanOrEqual(37);expect(s.paddingLeft).toBe('12px');expect(s.paddingRight).toBe('12px');if(!selector.includes('press-type'))expect(s.radius).toBe('8px');}
for(const width of [390,1440])test('D-button list sizes and compact exclusions '+width,async({page,browser})=>{
 await page.setViewportSize({width,height:900});await boot(page);
 const original=await browser.newPage({viewport:{width,height:900}});await baseline(original);await boot(original);
 for(const [name,selectors]of Object.entries(listButtons)){
  await view(page,name);await view(original,name);
  if(name==='calendar')for(const p of [page,original])await p.locator('.calendar-google-panel').evaluate(el=>el.open=true);
  for(const selector of selectors){await standard(page,selector);const before=await size(original.locator(selector)),after=await size(page.locator(selector));expect(after.weight).toBe(before.weight);expect(after.color).toBe(before.color);expect(after.background).toBe(before.background);}
  expect(await page.locator('#'+name+'View').evaluate(el=>({overflow:el.scrollWidth>el.clientWidth,clipped:[...el.querySelectorAll('button.primary,button.secondary,.w1p-filter')].filter(b=>b.checkVisibility()&&b.scrollWidth>b.clientWidth+1).map(b=>b.id||b.className)}))).toEqual({overflow:false,clipped:[]});
 }
 for(const [name,selectors]of Object.entries({tasks:['#newTaskBtn'],calendar:['#prevMonthBtn','#nextMonthBtn'],library:['#newDocumentBtn'],menu:['.app-nav [data-view="tasks"]','.app-nav [data-account-open]']})){
  if(name!=='menu')for(const p of [page,original])await view(p,name);
  if(name==='menu'&&width<=760){await expect(page.locator('.mobile-tabs [data-view="tasks"]')).toHaveCSS('font-size','12px');await expect(page.locator('#mobileMenuOpen')).toHaveCSS('min-height','44px');}else for(const selector of selectors){const before=await size(original.locator(selector).first());expect(await size(page.locator(selector).first()),selector).toEqual(name==='calendar'?{...before,height:32,font:'24px',paddingLeft:'0px',paddingRight:'0px',color:await muted(page),background:'rgba(0, 0, 0, 0)'}:before);}
 }
 await original.close();
});

for(const width of [390,760,761,1440])test('calendar controls paint 32px with real 44px targets and borderless month arrows '+width,async({page,browser},testInfo)=>{
 await page.setViewportSize({width,height:900});await boot(page);await view(page,'calendar');
 const button=page.locator('#newEventBtn');await expect(button).toBeVisible();
 const painted=await size(button),rect=await button.boundingBox();
 expect(painted.height).toBe(32);
 expect(painted.font).toBe('12px');expect(painted.radius).toBe('8px');
 expect((await button.innerText()).replace(/\s+/g,' ').trim()).toBe(width<=760?'+':'+ 일정 등록');
 if(width<=760){expect(rect.width).toBeGreaterThanOrEqual(35);expect(rect.width).toBeLessThanOrEqual(37);}
 else{expect(painted.paddingLeft).toBe('12px');expect(painted.paddingRight).toBe('12px');}
 const original=await browser.newPage({viewport:{width,height:900}});
 await baseline(original,'8d9a30626b11c0826def8393cefdf65934489d2f');await boot(original);await view(original,'calendar');
 for(const selector of ['#prevMonthBtn','#nextMonthBtn']){
  const before=await size(original.locator(selector));
  expect(await size(page.locator(selector))).toEqual({...before,height:32,font:'24px',paddingLeft:'0px',paddingRight:'0px',color:await muted(page),background:'rgba(0, 0, 0, 0)'});
  expect((await page.locator(selector).boundingBox()).width).toBe(width<=760?16:32);
 }
 const before=await size(original.locator('#newEventBtn'));
 for(const property of ['weight','color','background'])expect(painted[property]).toBe(before[property]);
 await original.close();
 const target=await button.evaluate(el=>{
  const r=el.getBoundingClientRect(),s=getComputedStyle(el),p=getComputedStyle(el,'::after');
  const x=r.x+parseFloat(s.borderLeftWidth)+parseFloat(p.left),y=r.y+parseFloat(s.borderTopWidth)+parseFloat(p.top),w=parseFloat(p.width),h=parseFloat(p.height);
  const points=[[x+1,y+h/2],[x+w-1,y+h/2],[x+w/2,y+1],[x+w/2,y+h-1]];
  return {w,h,points,hits:points.map(([x,y])=>document.elementFromPoint(x,y)?.closest('button')===el)};
 });
 expect(target.w).toBeGreaterThanOrEqual(44);expect(target.h).toBeGreaterThanOrEqual(44);
 expect(target.hits).toEqual([true,true,true,true]);
 await page.screenshot({path:testInfo.outputPath('calendar-'+width+'.png')});
 await testInfo.attach('calendar bounds',{body:JSON.stringify({width,painted,rect,target}),contentType:'application/json'});
 for(const [x,y]of target.points){
  await page.mouse.click(x,y);await expect(page.locator('#eventModal')).toBeVisible();
  await page.locator('#eventModal [data-close="eventModal"]').click();await expect(page.locator('#eventModal')).toBeHidden();
 }
 await button.focus();await page.keyboard.press('Enter');await expect(page.locator('#eventModal')).toBeVisible();
});
for(const width of [390,1440])test('D-button real painted and pointer bounds in project toolbar '+width,async({page})=>{
 await page.setViewportSize({width,height:900});await boot(page);await view(page,'projects');
 for(const selector of ['#ps3ArchiveBtn','#newProjectBtn']){
  const el=page.locator(selector);await el.scrollIntoViewIfNeeded();
  const target=await el.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el),p=getComputedStyle(el,'::after'),x=r.x+parseFloat(s.borderLeftWidth)+parseFloat(p.left),y=r.y+parseFloat(s.borderTopWidth)+parseFloat(p.top),w=parseFloat(p.width),h=parseFloat(p.height);return {w,h,hits:[[x+1,y+h/2],[x+w-1,y+h/2],[x+w/2,y+1],[x+w/2,y+h-1]].map(([x,y])=>document.elementFromPoint(x,y)?.closest('button')===el)}});
  expect(target.w).toBeGreaterThanOrEqual(44);expect(target.h).toBeGreaterThanOrEqual(44);expect(target.hits).toEqual([true,true,true,true]);
 }
});


for(const width of [390,1440])test('D-button project and organization detail and meeting input '+width,async({page})=>{
 await page.setViewportSize({width,height:900});await boot(page);await view(page,'projects');
 await page.locator('[data-ps3-project="type-project"]').click();await expect(page.locator('#ps3DetailModal')).toBeVisible();
 await page.locator('.ps3-more>summary').click();
 for(const selector of ['[data-ps3-toggle-done]','[data-ps3-edit-project]','[data-ps3-archive-project]','[data-ps3-delete-project]'])await standard(page,selector);
 await page.locator('[data-ps3-close="ps3DetailModal"]').click();await expect(page.locator('#ps3DetailModal')).toBeHidden();
 await view(page,'team');await page.locator('[data-ps-workplace-org="type-org"]').click();await standard(page,'#wdInboxSave');
 await page.locator('[data-wd-close="wdModal"]').click();await expect(page.locator('#wdModal')).toBeHidden();
 await view(page,'meetings');await page.locator('#newMeetingBtn').click();await page.locator('#addMeetingAction').click();for(let i=0;i<await page.locator('.meeting-action-remove').count();i++)await standard(page,'.meeting-action-remove >> nth='+i);
});

for(const width of [390,1440])test('D-button undo painted size and real 44px target '+width,async({page})=>{
 await page.setViewportSize({width,height:900});await boot(page,[{id:'size-task',title:'Fixture task',taskListId:'l1',taskListTitle:'QA',status:'needsAction',due:null}]);await view(page,'tasks');
 await page.locator('#gtTaskBody [data-google-task="size-task"] [data-gt-menu]').click();await page.locator('#gtTaskMenu [data-gt-menu-action="delete"]').click();
 await standard(page,'[data-gt-undo="size-task"]');
 const el=page.locator('[data-gt-undo="size-task"]');await el.scrollIntoViewIfNeeded();
 const bounds=await el.evaluate(el=>{const r=el.getBoundingClientRect(),p=getComputedStyle(el,'::after'),x=r.x+parseFloat(p.left),y=r.y+parseFloat(p.top),w=parseFloat(p.width),h=parseFloat(p.height);return {w,h,hit:document.elementFromPoint(x+w/2,y+1)?.closest('button')===el}});
 expect(bounds.w).toBeGreaterThanOrEqual(44);expect(bounds.h).toBeGreaterThanOrEqual(44);expect(bounds.hit).toBe(true);await el.click();await expect(page.locator('#gtTaskBody [data-google-task="size-task"]')).toBeVisible();
});

for(const width of [390,1440])test('D-button Google event editor delete and save '+width,async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-05T03:00:00Z'));await page.setViewportSize({width,height:900});
 await boot(page,[],[{id:'size-event',calendarId:'primary',title:'Fixture event',start:'2026-10-05',end:'2026-10-06',allDay:true,color:'#7986cb'}]);
 await view(page,'calendar');const chip=page.locator('.cp-event[data-google-event="size-event"]').first();await expect(chip).toBeVisible();await chip.click();
 await expect(page.locator('#ciGoogleDelete')).toBeEnabled();await standard(page,'#ciGoogleDelete');await standard(page,'#ciGoogleSave');
 expect(await page.locator('#ciGoogleModal .modal-card').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});
