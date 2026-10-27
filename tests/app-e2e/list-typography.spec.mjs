import { appOrigin } from './helpers/test-origin.mjs';
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
  await expect(page.locator('#googleLoginBtn')).toBeVisible({timeout:10000});
  await signInWithSession(page,user.email);
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:10000});
}



import {execFileSync} from 'node:child_process';
import { signInWithSession } from './helpers/session-login.mjs';
const BASE='248451a0afab043321620d168ec9610451e8bbeb';
const samples={
 // UI-디자인기준 2/3(8-9d): 프로젝트 목록 행 13px, 버튼 13px(새 기준).
 projects:[['.add-list-head [data-ps3-total]',12],['.ps3-prow-name',13],['.ps3-prow-meta',12],['button.primary',13]],
 // UI-디자인기준 3/3(8-9e-1): 회의·담당조직 목록 이름 13px, 상자 제목(섹션 이름) 13px, 버튼 13px(새 기준).
 meetings:[['.add-list-head h2',13],['.meeting-list-title h3',13],['.meeting-list-row p',12],['button.primary',13]],
 pages:[['.w1b-card h3',13],['.w1b-card p',14],['.badge',12],['.w1b-open',12]],
 // UI-디자인손질 3: the "N개 담당조직" line (.muted) is gone; the group heading carries the 12px meta text.
 // UI-조직추가숨김: the team menu's only button.secondary was the [+ 담당조직] add button, which is no longer drawn (team-list.spec asserts it is absent).
 team:[['.so-card h4',13],['.so-group-heading',12]]
};
async function boot(page){
 await mockApp(page,{spaces:[{id:'type-project',workspace_id:workspace.id,name:'Fixture project',status:'active',owner_id:user.id,created_by:user.id,metadata:{project_system:'v2',management_version:2}},{id:'type-archive',workspace_id:workspace.id,name:'Archive fixture',status:'archived',owner_id:user.id,created_by:user.id,metadata:{project_system:'v2',management_version:2}}]});
 await page.goto(`${appOrigin}/app/`);await signIn(page);
}
async function view(page,name){await clickView(page,name);await expect.poll(()=>page.evaluate(name=>window.KPTUViewLoader.isLoaded(name),name)).toBe(true);}
async function baseline(page){
 const cache=new Map();
 await page.route(new RegExp('^'+appOrigin.replace(/[.*+?^${}()|[\]\\\/]/g,'\\$&')+"\\/(?:app|press)\\/"),route=>{
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
  // 8-9e-2: the phone projects add button is the round [+] (no label text); covered by ui-standard-3b. UI-선택표시통일: meetings too.
  // UI-PC회의: PC(≥1024) 회의는 유형별 열 — 열 제목(.mcol-name)·차수(.mcol-round) 13px, 날짜·자료(.mcol-meta) 12px.
  const list=name==='meetings'&&width>=1024?rows.map(([sel,size])=>[sel==='.meeting-list-title h3'?'.mcol-name':sel==='.meeting-list-row p'?'.mcol-meta':sel,size]).concat([['.mcol-round',13]]):rows;
  for(const [selector,size]of list){if(width<=760&&(name==='projects'||name==='meetings')&&selector==='button.primary')continue;const el=page.locator('#'+name+'View '+selector).first();await expect(el).toHaveCount(1);await expect(el).toHaveCSS('font-size',size+'px');}
  const clip=await page.locator('#'+name+'View').evaluate(el=>({overflow:el.scrollWidth>el.clientWidth,buttons:[...el.querySelectorAll('button.primary,button.secondary,button.mini')].filter(b=>b.checkVisibility()&&!(innerWidth<=760&&['newEventBtn','newTaskBtn','newProjectBtn','newDocumentBtn','newMeetingBtn'].includes(b.id))).filter(b=>b.scrollWidth>b.clientWidth+1).map(b=>b.id||b.className)}));
  expect(clip).toEqual({overflow:false,buttons:[]});
 }
 const original=await browser.newPage({viewport:{width,height:900}});await baseline(original);await boot(original);
 // UI-디자인기준 2/3(8-9d): 일정 제목 18px·일정/할 일 버튼 13px(새 기준). 3/3(8-9e-1): 자료실 상자 제목·버튼 13px.
 const selectors={calendar:['#monthTitle','#newEventBtn','#prevMonthBtn'],tasks:['#gtTaskBody'],library:['#libraryListCard h2','#libraryListCard button','#libraryView #manageLibraryBtn'],menu:['.app-nav [data-view="projects"]','#appView [data-account-open]']};
 for(const [name,selectorsForView]of Object.entries(selectors)){
  if(name!=='menu'){await view(page,name);await view(original,name);}
  // 8-9e-2: phone add buttons of calendar·tasks are the round [+] (no label text); covered by ui-standard-3b.
  for(const selector of selectorsForView){if(width<=760&&['#newEventBtn','#newTaskBtn','#libraryListCard button'].includes(selector))continue;// 폰의 자료실 머리 버튼은 글자 없는 동그란 [+](분류 편집은 종류 칩 줄로 옮김, 아래 #manageLibraryBtn으로 검사)
  await expect(page.locator(selector).first()).toHaveCount(1);await expect(original.locator(selector).first()).toHaveCount(1);const fonts=async p=>p.locator(selector).first().evaluate(el=>getComputedStyle(el).fontSize);expect(await fonts(page),selector).toBe(selector==='#prevMonthBtn'?'24px':['#newEventBtn','#newTaskBtn','#libraryListCard h2','#libraryListCard button','#libraryView #manageLibraryBtn'].includes(selector)?'13px':selector==='#monthTitle'?'18px':await fonts(original));}
 }
 for(const p of [page,original])await p.goto(`${appOrigin}/press/`);
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
  const before=await styles(original);if(selector==='#ps3ArchiveList .ps3-prow-meta'){before[0]='12px';before[2]='16px';before[4]='auto';before[6]='visible';before[7]='clip'}if(selector==='#ps3ArchiveList .ps3-prow-name'){before[0]='16px';before[1]='750';before[2]='21.6px'}if(selector==='#eventModal input'){before[0]='14px';before[2]='21.7px'}
  // UI-디자인기준 3/3 3부(8-9e-3): 창 제목 18px·500, 창 버튼은 높이 하나(46px)·13px·500, 창 입력칸 46px·글자 400.
  if(selector.endsWith(' h2')){before[0]='18px';before[1]='500';before[2]='25.2px'}
  if(selector==='#ps3ArchiveModal button.mini'||selector==='#ps3CreateSave'){before[0]='13px';before[1]='500';before[2]='16.9px';before[4]=selector==='#ps3CreateSave'?'36px':'32px'}/* UI-버튼줄이기: 창 주 동작 36px. UI-버튼전수조사: 창 보조 버튼 32px */
  if(selector==='#ps3ArchiveModal button.mini')before[3]=await page.evaluate(()=>{const e=document.createElement('span');e.style.color='var(--kptu-ink)';document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c});// 기본 버튼 글자는 본문 색
  if(selector==='#eventModal input'){before[1]='400';before[4]='28px'}/* MTG-보고창칸정리(명진 2026-10-27): 창 입력칸 높이 46px -> 28px(공용 --ds-field-height) */expect(await styles(page),selector).toEqual(before);
 }
 await original.close();
});
