import { appOrigin } from './helpers/test-origin.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { openQuickBox } from './helpers/home-entry.mjs';
import {screenFind} from './helpers/screen-find.mjs';

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
 await page.goto(`${appOrigin}/app/`);await signIn(page);
}
async function open(page,name){await clickView(page,name);await expect.poll(()=>page.evaluate(n=>window.KPTUViewLoader.isLoaded(n),name)).toBe(true);}
// Painted height and 44px touch area (pointer hits the same button 3px above and below its painted edge).
async function measure(locator){
 await expect(locator).toBeVisible();
 return locator.evaluate(el=>{
  const r=el.getBoundingClientRect(),x=r.left+r.width/2,hit=y=>document.elementFromPoint(x,y)?.closest('button')===el;
  const touch=Math.max(parseFloat(getComputedStyle(el,'::after').height)||0,parseFloat(getComputedStyle(el,'::after').minHeight)||0);
  // 칠한 끝 바깥에서 누르는 범위 안쪽(3px, 40px 단추처럼 범위가 위아래 2px뿐이면 1.5px)을 눌러 본다.
  const d=Math.min(3,Math.max(1,(touch-r.height)/2-0.5));
  return {height:r.height,top:r.top,font:getComputedStyle(el).fontSize,touch,above:hit(r.top-d),below:hit(r.bottom+d)};
 });
}
// 글자 크기는 바꾸지 않는다(업무일지 [저장]은 원래 12px): 높이·누르는 범위만 본다.
async function pcButton(locator,label,want=36){const m=await measure(locator);expect(m.height,label).toBe(want);expect(m.touch,label).toBeGreaterThanOrEqual(44);expect(m.above,label+' touch above').toBe(true);expect(m.below,label+' touch below').toBe(true);return m;}
// UI-PC프로젝트좌우(2026-10-20 사용자 확정): PC 프로젝트 화면 [+ 프로젝트]는 왼쪽 목록 머리의 낮은 버튼(--ds-compact-height 32px), 누르는 범위 44px 그대로.
async function pcCompact(locator,label){const m=await measure(locator);expect(m.height,label).toBe(32);expect(m.touch,label).toBeGreaterThanOrEqual(44);expect(m.above,label+' touch above').toBe(true);expect(m.below,label+' touch below').toBe(true);return m;}

test('PC 1280: 큰 버튼은 회의 [+ 회의 결과]와 같은 36px, 옆 입력칸도 같은 높이·같은 줄, 누르는 범위 44px',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await boot(page,1280);
 await open(page,'meetings');await pcCompact(page.locator('#newMeetingBtn'),'사업 보고');/* BIZ-버튼줄정리(10/29) → BIZ-위쪽정돈PC(11/09): 사업 보고 [+]는 작은 32px 아이콘(누르는 범위 44px) */
 await open(page,'library');{const b=await page.locator('#newDocumentBtn').boundingBox();expect([b.width,b.height],'#newDocumentBtn').toEqual([32,32]);}/* LIB-위쪽한줄(11/09): 자료실 [+]는 위 줄 작은 아이콘 32px */
 await open(page,'projects');await pcCompact(page.locator('#newProjectBtn'),'사업영역');
 await open(page,'home');await pcButton(page.locator('#homeView [data-journal-save]'),'업무일지 저장');
 // QUICK-입력정리(2026-11-28): 홈·잊지 말기 손 입력칸은 지웠다 — 남은 [할 일]·노트 입력 줄을 본다.
 // 할 일: 입력칸·칸 안 [+]·[추가].
 await open(page,'tasks');const tq=page.locator('#tasksView [data-home-quick]');
 const ti=await measure(tq.locator('[data-quick-input]')),ts=await pcButton(tq.locator('[data-quick-save]'),'할 일 추가',40),td=await measure(tq.locator('[data-quick-detail]'));
 expect(ti.height).toBe(40);expect(td.height).toBe(38);expect(td.touch).toBeGreaterThanOrEqual(44);expect(Math.abs(ti.top-ts.top)).toBeLessThanOrEqual(0.5);
 // 잊지 말기·노트: 입력 줄 [추가] 40px(NOTE-입력줄높이), 클립은 칸 안. 노트 찾기 칸 36px.
 await open(page,'basket');
 await chooseBasketKind(page,'note');
 const nb=await pcButton(page.locator('#basketView [data-note-list] [data-quick-save]'),'노트 추가',40),ns=await measure((await screenFind(page)));
 expect(ns.height).toBe(36); // S70-54 UI-검색창하나로: 노트 찾기는 상단 줄 칸이 겸한다(높이 36 그대로)
 // 입력 줄 버튼은 40px(입력칸과 같은 높이). 창(모달) 버튼은 그대로.
 expect(nb.height).toBe(40);
 await open(page,'projects');await page.locator('#newProjectBtn').click();
 expect((await measure(page.locator('#ps3CreateSave'))).height).toBe(36);/* UI-버튼줄이기: 창 주 동작 36px */
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 expect(errors).toEqual([]);
});

test('폰 390: 동그란 [+]는 그대로, 빠른 입력 [추가]는 입력칸과 같은 40px(NOTE-입력줄높이)',async({page})=>{
 await boot(page,390);
 // MTG-프로젝트합치기 ①: [+ 사업영역]은 사업영역 관리 창 머리줄의 작은 [+](32px)라 둥근 [+] 묶음에서 뺀다.
 await open(page,'projects');expect((await page.locator('#newProjectBtn').boundingBox()).height).toBe(32);
 // LIB-위쪽한줄(11/09): 자료실 [+]도 사업 보고처럼 위 줄 오른쪽 32px 작은 아이콘(떠 있지 않음).
 await open(page,'library');{const b=await page.locator('#newDocumentBtn').boundingBox();expect([b.width,b.height],'#newDocumentBtn').toEqual([32,32]);
  expect(await page.locator('#newDocumentBtn').evaluate(el=>getComputedStyle(el).position)).not.toBe('fixed');}
 // BIZ-위쪽정돈(11/09 01:22 확정안, 사업 보고만 예외): 사업 보고 [+]는 떠 있는 36px 동그라미가 아니라 맨 위 줄 오른쪽 32px 작은 아이콘(떠 있지 않음).
 await open(page,'meetings');{const b=await page.locator('#newMeetingBtn').boundingBox();expect([b.width,b.height],'#newMeetingBtn').toEqual([32,32]);
  expect(await page.locator('#newMeetingBtn').evaluate(el=>getComputedStyle(el).position)).not.toBe('fixed');}
 await open(page,'tasks');const tq=page.locator('#tasksView [data-home-quick]');
 expect((await tq.locator('[data-quick-save]').boundingBox()).height).toBe(40);
});

test('중간 폭 900: 목록 머리 채운 버튼은 36px(UI-버튼전수조사), 빠른 입력 [추가]는 40px(NOTE-입력줄높이)',async({page})=>{
 await boot(page,900);
 await open(page,'projects');expect((await page.locator('#newProjectBtn').boundingBox()).height).toBe(32);/* MTG-프로젝트합치기 ①: [+ 사업영역]은 사업영역 관리 창 머리줄의 작고 낮은 버튼(32px) */
 await open(page,'tasks');expect((await page.locator('#tasksView [data-home-quick] [data-quick-save]').boundingBox()).height).toBe(40);
});
