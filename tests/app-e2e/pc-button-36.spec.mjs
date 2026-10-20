import {clickView} from './helpers/shell-navigation.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';

// UI-PC버튼36(2026-10-20 사용자 결정): PC(≥1024) 큰 버튼은 회의 [+ 회의 결과]와 같은 입력칸 높이(--kptu-control-height 36px).
// 같은 줄 입력칸·칸 안 아이콘도 36px로 맞춰 줄이 어긋나지 않는다. 누르는 범위는 44px(::after). 폰 동그란 [+]·폰 버튼·중간 폭은 그대로.

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'design-system-user',email:'design-system@example.org',user_metadata:{display_name:'Design QA'}};
const workspace={id:'design-system-workspace',slug:'design-system',name:'웹2'};
const project={id:'type-project',workspace_id:'design-system-workspace',name:'Fixture project',status:'active',owner_id:'design-system-user',created_by:'design-system-user',metadata:{project_system:'v2',management_version:2}};

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
  await expect(page.locator('#googleLoginBtn')).toBeVisible({timeout:10000});
  await signInWithSession(page,user.email);
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:10000});
}




async function boot(page,width){
 await page.setViewportSize({width,height:900});await mockApp(page,{spaces:[project]});
 await page.goto('http://127.0.0.1:8123/app/');await signIn(page);
}
async function open(page,name){await clickView(page,name);await expect.poll(()=>page.evaluate(n=>window.KPTUViewLoader.isLoaded(n),name)).toBe(true);}
// Painted height and 44px touch area (pointer hits the same button 3px above and below its painted edge).
async function measure(locator){
 await expect(locator).toBeVisible();
 return locator.evaluate(el=>{
  const r=el.getBoundingClientRect(),x=r.left+r.width/2,hit=y=>document.elementFromPoint(x,y)?.closest('button')===el;
  return {height:r.height,top:r.top,font:getComputedStyle(el).fontSize,touch:Math.max(parseFloat(getComputedStyle(el,'::after').height)||0,parseFloat(getComputedStyle(el,'::after').minHeight)||0),above:hit(r.top-3),below:hit(r.bottom+3)};
 });
}
// 글자 크기는 바꾸지 않는다(업무일지 [저장]은 원래 12px): 높이·누르는 범위만 본다.
async function pcButton(locator,label){const m=await measure(locator);expect(m.height,label).toBe(36);expect(m.touch,label).toBeGreaterThanOrEqual(44);expect(m.above,label+' touch above').toBe(true);expect(m.below,label+' touch below').toBe(true);return m;}

test('PC 1280: 큰 버튼은 회의 [+ 회의 결과]와 같은 36px, 옆 입력칸도 같은 높이·같은 줄, 누르는 범위 44px',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await boot(page,1280);
 await open(page,'meetings');const meeting=await pcButton(page.locator('#newMeetingBtn'),'회의');
 await open(page,'library');await pcButton(page.locator('#newDocumentBtn'),'자료 등록');
 await open(page,'projects');await pcButton(page.locator('#newProjectBtn'),'프로젝트');
 await open(page,'journal');await pcButton(page.locator('#journalView [data-journal-save]'),'업무일지 저장');
 // 홈: 입력칸·[크게]·[📎 첨부]·[추가]가 한 줄에서 같은 높이.
 await open(page,'home');const home=page.locator('#homeView [data-home-quick]');
 const hi=await measure(home.locator('[data-quick-input]')),hs=await pcButton(home.locator('[data-quick-save]'),'홈 추가'),hc=await pcButton(home.getByRole('button',{name:'파일 첨부',exact:true}),'홈 첨부');
 const hb=await measure(home.locator('[data-quick-big]'));
 for(const m of [hi,hb])expect(m.height).toBe(36);for(const m of [hi,hb,hc])expect(Math.abs(m.top-hs.top)).toBeLessThanOrEqual(0.5);
 // 할 일: 입력칸·칸 안 [+]·[추가].
 await open(page,'tasks');const tq=page.locator('#tasksView [data-home-quick]');
 const ti=await measure(tq.locator('[data-quick-input]')),ts=await pcButton(tq.locator('[data-quick-save]'),'할 일 추가'),td=await measure(tq.locator('[data-quick-detail]'));
 expect(ti.height).toBe(36);expect(td.height).toBe(36);expect(td.touch).toBeGreaterThanOrEqual(44);expect(Math.abs(ti.top-ts.top)).toBeLessThanOrEqual(0.5);
 // 바구니: [추가]·[📎 첨부] 36px(여러 줄 업데이트 칸 높이는 그대로), 노트 [+ 노트]와 옆 검색칸 같은 높이.
 await open(page,'basket');const bq=page.locator('#basketView [data-home-quick]');
 await pcButton(bq.locator('[data-quick-save]'),'바구니 추가');await pcButton(bq.getByRole('button',{name:'파일 첨부',exact:true}),'바구니 첨부');
 await page.locator('#basketView [data-basket-kind="note"]').click();
 const nb=await pcButton(page.locator('#newNoteBtn'),'새 노트'),ns=await measure(page.locator('#basketView [data-note-search]'));
 expect(ns.height).toBe(36);expect(Math.abs(ns.top-nb.top)).toBeLessThanOrEqual(0.5);
 // 모두 회의 버튼과 같은 높이. 창(모달) 버튼은 공용 기준(46px) 그대로.
 expect(meeting.height).toBe(nb.height);
 await open(page,'projects');await page.locator('#newProjectBtn').click();
 expect((await measure(page.locator('#ps3CreateSave'))).height).toBe(46);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 expect(errors).toEqual([]);
});

test('PC 1280: 공유 페이지 큰 버튼([새 공유 페이지]·[다시 불러오기]·[저장]·[링크 만들기])도 36px, 작은 보조 버튼은 그대로',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let listFails=true;
 const row={id:'sp-fixture',title:'Fixture share',status:'draft',project_id:null,blocks:[{type:'summary',text:'fixture'}],updated_at:'2026-10-20T01:00:00.000Z'};
 await boot(page,1280);
 await page.route(`${SB}/rest/v1/app_share_pages**`,route=>{
  if(route.request().method()!=='GET')return route.fallback();
  const id=new URL(route.request().url()).searchParams.get('id');
  if(!id&&listFails)return route.fulfill({status:500,contentType:'application/json',body:'{"message":"fixture"}'});
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([row])});
 });
 await open(page,'pages');
 const root=page.locator('#sharePagesRoot');
 await pcButton(root.locator('[data-sp-new]'),'새 공유 페이지');await pcButton(root.locator('[data-sp-reload]'),'목록 다시 불러오기');
 listFails=false;await root.locator('[data-sp-reload]').click();
 await root.locator('[data-sp-open="sp-fixture"]').click();
 await pcButton(root.locator('[data-sp-save]'),'공유 페이지 저장');await pcButton(root.locator('[data-sp-link-create]'),'링크 만들기');
 expect((await measure(root.locator('[data-sp-add-block]').first())).height).toBe(32);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 expect(errors).toEqual([]);
});

test('폰 390: 동그란 [+]·빠른 입력 [추가]는 그대로',async({page})=>{
 await boot(page,390);
 for(const [view,selector] of [['projects','#newProjectBtn'],['library','#newDocumentBtn'],['meetings','#newMeetingBtn']]){
  await open(page,view);const b=await page.locator(selector).boundingBox();expect([b.width,b.height],selector).toEqual([36,36]);
  expect(await page.locator(selector).evaluate(el=>getComputedStyle(el).position)).toBe('fixed');
 }
 await open(page,'home');const home=page.locator('#homeView [data-home-quick]');
 expect((await home.locator('[data-quick-save]').boundingBox()).height).toBe(46);expect((await home.locator('[data-quick-input]').boundingBox()).height).toBe(46);
 await open(page,'tasks');const tq=page.locator('#tasksView [data-home-quick]');
 expect((await tq.locator('[data-quick-save]').boundingBox()).height).toBe(46);
});

test('중간 폭 900: PC 기준(≥1024) 밖이라 46px 그대로',async({page})=>{
 await boot(page,900);
 await open(page,'projects');expect((await page.locator('#newProjectBtn').boundingBox()).height).toBe(46);
 await open(page,'tasks');expect((await page.locator('#tasksView [data-home-quick] [data-quick-save]').boundingBox()).height).toBe(46);
});
