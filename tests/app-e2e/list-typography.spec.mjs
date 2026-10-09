import {clickView} from './helpers/shell-navigation.mjs';
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
    if(path==='/rest/v1/app_meetings')return ok([{id:'type-meeting',workspace_id:workspace.id,title:'Fixture meeting',meeting_name:'Fixture meeting',round_no:2,meeting_at:'2026-10-05T12:00:00'}]);
    if(path==='/rest/v1/app_suborganizations')return ok([{id:'type-org',name:'Fixture organization',active:true,created_by:user.id}]);
    if(path==='/rest/v1/app_suborganization_assignees')return ok([{organization_id:'type-org',user_id:user.id}]);
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
const BASE='248451a0afab043321620d168ec9610451e8bbeb';
const samples={
 projects:[['.add-list-head [data-ps3-total]',12],['.ps3-prow-name',16],['.ps3-prow-meta',12],['button.primary',12]],
 meetings:[['.add-list-head h2',20],['.meeting-list-title h3',16],['.meeting-list-row p',12],['button.primary',12]],
 media:[['.w1p-title',16],['.w1p-year>h3',16],['.w1p-filter',12],['.w1p-date',12],['.w1p-tag',12],['.w1p-publisher',12]],
 pages:[['.w1b-card h3',16],['.w1b-card p',14],['.badge',12],['.w1b-open',12]],
 team:[['.so-card h4',16],['button.secondary',12],['.muted',12]]
};
async function boot(page){
 await mockApp(page,{spaces:[{id:'type-project',workspace_id:workspace.id,name:'Fixture project',status:'active',owner_id:user.id,created_by:user.id,metadata:{project_system:'v2',management_version:2}},{id:'type-archive',workspace_id:workspace.id,name:'Archive fixture',status:'archived',owner_id:user.id,created_by:user.id,metadata:{project_system:'v2',management_version:2}}]});
 await page.goto('http://127.0.0.1:8123/app/');await signIn(page);
}
async function view(page,name){await clickView(page,name);await expect.poll(()=>page.evaluate(name=>window.KPTUViewLoader.isLoaded(name),name)).toBe(true);}
async function baseline(page){
 const cache=new Map();
 await page.route(/^http:\/\/127\.0\.0\.1:8123\/(?:app|press)\//,route=>{
  let path=new URL(route.request().url()).pathname.slice(1);if(path.endsWith('/'))path+='index.html';
  if(!/\.(css|js|html)$/.test(path))return route.continue();
  if(!cache.has(path))cache.set(path,execFileSync('git',['show',BASE+':'+path],{encoding:'utf8'}));
  const contentType=path.endsWith('.css')?'text/css':path.endsWith('.js')?'text/javascript':'text/html';
  return route.fulfill({status:200,contentType,body:cache.get(path)});
 });
}
for(const width of [390,1440])test('D-3d list roles, C2 and excluded main fonts '+width,async({page,browser})=>{
 await page.setViewportSize({width,height:900});await boot(page);
 for(const [name,rows]of Object.entries(samples)){
  await view(page,name);
  for(const [selector,size]of rows){const el=page.locator('#'+name+'View '+selector).first();await expect(el).toHaveCount(1);await expect(el).toHaveCSS('font-size',size+'px');}
  const clip=await page.locator('#'+name+'View').evaluate(el=>({overflow:el.scrollWidth>el.clientWidth,buttons:[...el.querySelectorAll('button.primary,button.secondary,button.mini,.w1p-filter')].filter(b=>b.checkVisibility()).filter(b=>b.scrollWidth>b.clientWidth+1).map(b=>b.id||b.className)}));
  expect(clip).toEqual({overflow:false,buttons:[]});
 }
 await view(page,'media');
 const row=page.locator('.w1p-item').first();
 const geometry=await row.evaluate(el=>{const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}};return {row:box(el),title:box(el.querySelector('.w1p-title')),tag:box(el.querySelector('.w1p-tag')),date:box(el.querySelector('.w1p-date')),publisher:getComputedStyle(el.querySelector('.w1p-publisher')).display}});
 if(width===390){expect(geometry.title.width/geometry.row.width).toBeGreaterThanOrEqual(.9);expect(geometry.publisher).toBe('none');expect(geometry.tag.bottom).toBeLessThanOrEqual(geometry.title.y);expect(geometry.date.bottom).toBeLessThanOrEqual(geometry.title.y);expect(Math.abs(geometry.tag.y-geometry.date.y)).toBeLessThan(8);}
 else{expect(geometry.publisher).not.toBe('none');expect(Math.abs(geometry.title.y-geometry.date.y)).toBeLessThan(8);}
 const original=await browser.newPage({viewport:{width,height:900}});await baseline(original);await boot(original);
 const selectors={calendar:['#monthTitle','#newEventBtn','#prevMonthBtn'],tasks:['#newTaskBtn','#gtTaskBody'],library:['#libraryListCard h2','#libraryListCard button'],menu:['.app-nav [data-view="tasks"]','.app-nav [data-account-open]']};
 for(const [name,selectorsForView]of Object.entries(selectors)){
  if(name!=='menu'){await view(page,name);await view(original,name);}
  for(const selector of selectorsForView){await expect(page.locator(selector).first()).toHaveCount(1);await expect(original.locator(selector).first()).toHaveCount(1);const fonts=async p=>p.locator(selector).first().evaluate(el=>getComputedStyle(el).fontSize);expect(await fonts(page),selector).toBe(selector==='#prevMonthBtn'?'24px':selector==='#newEventBtn'?'12px':selector==='#monthTitle'&&width<=760?'20px':await fonts(original));}
 }
 for(const p of [page,original])await p.goto('http://127.0.0.1:8123/press/');
 for(const selector of ['h1','.item h3','.date','.tag','.filter']){
  const fonts=async p=>p.locator(selector).first().evaluate(el=>getComputedStyle(el).fontSize);expect(await fonts(page)).toBe(await fonts(original));
 }
 await original.close();
});

for(const width of [390,1440])test('D-3e archive and input roles preserve other main styles '+width,async({page,browser})=>{
 await page.setViewportSize({width,height:900});await boot(page);await view(page,'projects');
 const original=await browser.newPage({viewport:{width,height:900}});await baseline(original);await boot(original);await view(original,'projects');
 for(const p of [page,original]){await p.locator('#ps3ArchiveBtn').click();await expect(p.locator('#ps3ArchiveModal')).toBeVisible();}
 const properties=['fontSize','fontWeight','lineHeight','color','minHeight','whiteSpace','overflow','textOverflow'];
 for(const selector of ['#ps3ArchiveList .ps3-prow-name','#ps3ArchiveList .ps3-prow-meta','#ps3ArchiveModal h2','#ps3ArchiveModal button.mini','#eventModal input','#ps3CreateModal .modal-head h2','#ps3CreateSave']){
  const styles=async p=>p.locator(selector).first().evaluate((el,keys)=>{const s=getComputedStyle(el);return keys.map(k=>s[k])},properties);
  const before=await styles(original);if(selector==='#ps3ArchiveList .ps3-prow-meta'){before[0]='12px';before[2]='16px';before[4]='auto';before[6]='visible';before[7]='clip'}if(selector==='#ps3ArchiveList .ps3-prow-name'){before[0]='16px';before[1]='750';before[2]='21.6px'}if(selector==='#eventModal input'){before[0]='14px';before[2]='21.7px'}expect(await styles(page),selector).toEqual(before);
 }
 await original.close();
});
for(const width of [760,761])test('D-3d C2 boundary '+width,async({page})=>{
 await page.setViewportSize({width,height:900});await boot(page);await view(page,'media');
 if(width===760){await expect(page.locator('.w1p-head').first()).toBeHidden();await expect(page.locator('.w1p-publisher').first()).toBeHidden();await expect(page.locator('.w1p-item').first()).toHaveCSS('grid-template-areas','"tag date" "title title"');}
 else{await expect(page.locator('.w1p-head').first()).toBeVisible();await expect(page.locator('.w1p-publisher').first()).toBeVisible();await expect(page.locator('.w1p-item').first()).toHaveCSS('grid-template-areas','none');}
});
