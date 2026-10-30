import { appOrigin } from './helpers/test-origin.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import {openWriteFromEntry} from './helpers/write-opener.mjs';

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




async function boot(page,width,url=`${appOrigin}/app/`){
 await page.setViewportSize({width,height:900});await mockApp(page,{spaces:[project]});
 await page.goto(url);await signIn(page);
}
async function open(page,name){await clickView(page,name);await expect.poll(()=>page.evaluate(n=>window.KPTUViewLoader.isLoaded(n),name)).toBe(true);}
const box=async locator=>{await expect(locator.first()).toBeVisible();return locator.first().evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,height:r.height,width:r.width}})};

test('UI-PC다듬기묶음 ① PC 1280: 사이드바 맨 아래는 [HWP 편집]·[원장], [쓰기] 항목은 없음(쓰기 창은 상단 줄 빠른 추가로)',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await boot(page,1280);
 const items=await page.locator('#appView>.app-nav .nav-btn:visible').allTextContents();
 // UI-자주가는링크: '자주 가는 링크 ›' 줄이 맨 끝. CALL·TG: 그 바로 위(빈 공간 아래)에 [통화]·[텔레그램 소식].
 expect(items.at(-7)).toBe('HWP 편집');expect(items.at(-6)).toBe('원장');expect(items.at(-5)).toBe('사진');expect(items.slice(-4,-1)).toEqual(['통화','텔레그램 소식','아스날']);expect(items.at(-1)).toMatch(/^자주 가는 링크/);expect(items).not.toContain('쓰기');
 await expect(page.locator('[data-menu-write]')).toHaveCount(0);
 await openWriteFromEntry(page,1280);
 await expect(page.locator('#edWindow')).toBeVisible({timeout:10000});
 expect(errors).toEqual([]);
});

test('UI-PC다듬기묶음 ① 폰 390: ☰ 메뉴에 [쓰기]가 없고 회의부터 시작',async({page})=>{
 await boot(page,390);
 await page.locator('#mobileMenuTab').click();
 expect(await page.locator('#mobileMenu nav button:visible').allTextContents()).toEqual(['노트','자료실','HWP 편집','공유 페이지','원장','사진','통화','텔레그램 소식','아스날']);
});

for(const width of [1024,1280,1440,1920])test(`UI-PC다듬기묶음 ② PC ${width}: [+ 일정 등록]은 같은 줄 [오늘]·보기 전환과 같은 높이, 누르는 범위 44`,async({page})=>{
 await boot(page,width,`${appOrigin}/app/?view=calendar`);
 const tb=page.locator('#calendarView .calendar-toolbar');
 const add=await box(tb.locator('#newEventBtn')),today=await box(tb.locator('#calendarTodayBtn')),group=await box(tb.locator('.calendar-view-switch'));
 expect(add.height).toBe(32);expect(add.height).toBe(today.height);expect(add.height).toBe(group.height);
 expect(Math.abs(add.top-today.top)).toBeLessThanOrEqual(.5);expect(Math.abs(add.top-group.top)).toBeLessThanOrEqual(.5);
 expect(await tb.locator('#newEventBtn').evaluate(el=>getComputedStyle(el).fontSize)).toBe(await tb.locator('#calendarTodayBtn').evaluate(el=>getComputedStyle(el).fontSize));
 const hit=await tb.locator('#newEventBtn').evaluate(el=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2,p=getComputedStyle(el,'::after');return {touch:parseFloat(p.height),above:document.elementFromPoint(x,r.top-5)?.closest('button')===el,below:document.elementFromPoint(x,r.bottom+5)?.closest('button')===el}});
 expect(hit.touch).toBeGreaterThanOrEqual(44);expect(hit.above).toBe(true);expect(hit.below).toBe(true);
 await tb.locator('#newEventBtn').click();await expect(page.locator('#eventModal')).toBeVisible();
});

test('UI-PC다듬기묶음 ② 폰 390·중간 폭 900: [+ 일정 등록]은 폰 동그란 [+] 36, 중간 폭 32(UI-버튼전수조사)',async({page})=>{
 await boot(page,390,`${appOrigin}/app/?view=calendar`);
 const phone=await box(page.locator('#newEventBtn'));expect([phone.width,phone.height]).toEqual([36,36]);
 await page.setViewportSize({width:900,height:900});
 const mid=await box(page.locator('#newEventBtn'));expect(mid.height).toBe(32);
});

for(const width of [1024,1280,1920])test(`UI-PC다듬기묶음 ③ PC ${width}: 정리함 업데이트·노트 본문이 사이드바 바로 옆 왼쪽에서 시작, 최대 폭 1100`,async({page})=>{
 await boot(page,width);
 await open(page,'basket');
 const nav=await box(page.locator('#appView>.app-nav'));
 const check=async label=>{
  const root=await box(page.locator('#basketView'));
  expect(root.left-nav.right,label+' 본문 시작').toBeGreaterThanOrEqual(0);expect(root.left-nav.right,label+' 본문 시작').toBeLessThanOrEqual(48);
  expect(root.width,label+' 폭').toBeLessThanOrEqual(1100.5);
  return root;
 };
 // 업데이트: 탭·입력창
 await check('업데이트');
 // BASKET-노트입력창: PC(≥1024)에는 화면 위 [업데이트 | 노트]가 없다(사이드바가 맡음).
 await expect(page.locator('#basketView .basket-kind-switch')).toHaveCount(0);
 for(const sel of ['#basketView [data-basket-list] [data-home-quick]']){const b=await box(page.locator(sel));expect(b.left-nav.right,sel).toBeLessThanOrEqual(48);}
 await chooseBasketKind(page,'note');
 await expect(page.locator('#basketView [data-note-search]')).toBeVisible();
 await check('노트');
 for(const sel of ['#basketView [data-note-list] [data-home-quick]','#basketView [data-note-search]']){const b=await box(page.locator(sel));expect(b.left-nav.right,sel).toBeLessThanOrEqual(48);}
 // 노트 입력칸의 [추가]는 오른쪽 끝(본문 칸 안쪽)에 있다([+ 노트] 자리).
 const root=await box(page.locator('#basketView')),add=await box(page.locator('#basketView [data-note-list] [data-quick-save]'));expect(add.right).toBeLessThanOrEqual(root.right+.5);expect(add.right).toBeGreaterThanOrEqual(root.right-48);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});

test('UI-PC다듬기묶음 ③ 폰 390: 정리함 본문 폭 규칙은 그대로(가운데 정렬 값 유지), 900은 PC 틀(UI-폴드PC틀)',async({page})=>{
 await boot(page,390);await open(page,'basket');
 const phone=await page.locator('#basketView').evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {max:s.maxWidth,left:r.left,right:innerWidth-r.right}});
 expect(phone.max).toBe('900px');expect(Math.abs(phone.left-phone.right)).toBeLessThanOrEqual(1);
 await page.setViewportSize({width:900,height:900});
 expect(await page.locator('#basketView').evaluate(el=>getComputedStyle(el).maxWidth)).not.toBe('900px');
});
