import {clickView} from './helpers/shell-navigation.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'design-system-user',email:'design-system@example.org',user_metadata:{display_name:'Design QA'}};
const workspace={id:'design-system-workspace',slug:'design-system',name:'웹2'};

async function mockApp(page,{spaces=[],tasks=[],calendarEvents=[]}={}){
  await page.addInitScript(()=>{try{localStorage.setItem('kptu-calendar-view','month')}catch{}});
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
async function boot(page,tasks=[{id:'font-task',title:'Typography QA task',notes:'Typography QA notes',due:new Date().toISOString(),status:'needsAction',taskListId:'@default',taskListTitle:'QA',source:'google-task'}],calendarEvents=[{id:'font-event',calendarId:'primary',title:'Typography QA event',start:new Date().toISOString().slice(0,10)+'T12:00:00+09:00',end:new Date().toISOString().slice(0,10)+'T13:00:00+09:00',color:'var(--kptu-primary)'}]){
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


for(const width of [390,1440])test('D-3e modal roles and excluded list computed styles '+width,async({page,browser})=>{
 await page.setViewportSize({width,height:900});await boot(page);
 const original=await browser.newPage({viewport:{width,height:900}});await baseline(original,'b9dbcaee0b8e92bd8d80334bf97999f561deef94');await boot(original);
 for(const name of ['projects','meetings','media','pages','team','tasks','calendar','library']){
  for(const p of [page,original])await view(p,name);
  const snapshot=async p=>p.locator('#'+name+'View').evaluate(el=>[...el.querySelectorAll('*')].filter(e=>!e.closest('.calendar-view-switch,#calendarTodayBtn')&&e.checkVisibility()&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>{const s=getComputedStyle(e);return [e.tagName,e.className,s.fontSize,s.color,s.fontWeight,s.lineHeight]}));
  expect(await snapshot(page),name).toEqual(await snapshot(original));
 }
 await view(page,'projects');await page.locator('#ps3ArchiveBtn').click();await audit(page,'ps3ArchiveModal');await page.locator('[data-ps3-close="ps3ArchiveModal"]').click();await page.locator('#newProjectBtn').click();await audit(page,'ps3CreateModal');await page.locator('[data-ps3-close="ps3CreateModal"]').click();await page.locator('[data-ps3-project="type-project"]').first().click();await expect(page.locator('#ps3Title')).toHaveText('Fixture project');await audit(page,'ps3DetailModal');await page.evaluate(()=>window.KPTUGoogleTasks.openLinkPicker({project_id:'type-project'}));await audit(page,'gtPickModal');await page.locator('[data-gt-pick-close]').click();await page.locator('[data-ps3-close="ps3DetailModal"]').click();
 await view(page,'meetings');await page.locator('#newMeetingBtn').click();await audit(page,'meetingModal');await page.locator('#meetingModal').evaluate(el=>el.classList.add('hidden'));
 await view(page,'team');await page.locator('#soAddOrg').click();await audit(page,'soEditModal');await page.locator('[data-so-close="soEditModal"]').click();
 await view(page,'library');await page.locator('#newDocumentBtn').click();await audit(page,'documentModal');await page.locator('#documentModal').evaluate(el=>el.classList.add('hidden'));
 await view(page,'calendar');await page.locator('#newEventBtn').click();await audit(page,'eventModal');await page.locator('#eventModal').evaluate(el=>el.classList.add('hidden'));
 await expect(page.locator('.theme-choices button').first()).toHaveCSS('font-size',await original.locator('.theme-choices button').first().evaluate(el=>getComputedStyle(el).fontSize));await original.close();
});
async function audit(page,id){
 const modal=page.locator('#'+id);await expect(modal).toBeVisible();
 const small=await modal.evaluate(root=>[...root.querySelectorAll('*')].filter(e=>e.checkVisibility()&&!e.closest('button,.icon-btn,[aria-hidden="true"]')&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<12).map(e=>({tag:e.tagName,id:e.id,class:e.className,size:getComputedStyle(e).fontSize})));
 expect(small,id).toEqual([]);
 for(const input of await modal.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]),textarea,select').all())await expect(input).toHaveCSS('font-size','14px');
 for(const label of await modal.locator('label:not(.secondary):not(.primary)').all())await expect(label).toHaveCSS('font-size','12px');
 for(const h2 of await modal.locator('.modal-head h2,.w1b-detail-head h2').all())await expect(h2).toHaveCSS('font-size','20px');
}

const modalIds=['ps3DetailModal','ps3CreateModal','ps3WorkstreamModal','ps3ProgressModal','ps3MilestoneModal','ps3ArchiveModal','ps3DeleteModal','meetingModal','meetingRoundDetailModal','wfMeetingAiModal','wdModal','wdAffModal','wdTimeModal','soEditModal','soAssignModal','pressDetailModal','web1BoardDetailModal','documentModal','libraryEditModal','libraryManageModal','eventModal','ciGoogleModal','taskModal','gtTaskModal','gtPickModal','themeModal','warDraftModal','polManageModal'];
for(const width of [390,1440])test('D-3e installed dialog templates use role sizes '+width,async({page},testInfo)=>{
 await page.setViewportSize({width,height:900});await boot(page);
 for(const name of ['projects','meetings','team','library','tasks','calendar','media','pages'])await view(page,name);
 const inventory=await page.evaluate(ids=>{
  const result={present:[],notInstalled:[],counts:{},violations:[]};
  // Synchronous template measurement avoids adding overlay history entries while walking closed templates.
  for(const id of ids){const root=document.getElementById(id);if(!root){result.notInstalled.push(id);continue}result.present.push(id);
   const className=root.className,aria=root.getAttribute('aria-hidden');root.classList.remove('hidden');root.setAttribute('aria-hidden','false');
   const text=[...root.querySelectorAll('*')].filter(e=>!e.closest('button,.icon-btn,[aria-hidden="true"]')&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()));
   result.counts[id]=text.length;
   for(const e of text){const size=parseFloat(getComputedStyle(e).fontSize);if(size<12)result.violations.push({id,element:e.id||e.className||e.tagName,size})}
   for(const e of root.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]),textarea,select'))if(getComputedStyle(e).fontSize!=='14px')result.violations.push({id,element:e.id,size:getComputedStyle(e).fontSize,want:14});
   for(const e of root.querySelectorAll('label:not(.secondary):not(.primary):not(.mrd-upload-label):not(.library-picker-mobile)'))if(getComputedStyle(e).fontSize!=='12px')result.violations.push({id,element:e.id||e.className,size:getComputedStyle(e).fontSize,want:12});
   for(const e of root.querySelectorAll('.modal-head h2,.w1b-detail-head h2'))if(getComputedStyle(e).fontSize!=='20px')result.violations.push({id,element:e.id,size:getComputedStyle(e).fontSize,want:20});root.className=className;if(aria===null)root.removeAttribute('aria-hidden');else root.setAttribute('aria-hidden',aria);
  }return result;
 },modalIds);
 expect(inventory.violations).toEqual([]);
 await testInfo.attach('dialog-inventory',{body:JSON.stringify({width,...inventory},null,2),contentType:'application/json'});
});
