import {test,expect} from '@playwright/test';
import {enterLogin} from './helpers/login-entry.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
// UI-디자인기준 3/3 2부(8-9e-2): 폰(760px 이하) 배치만 바꾼다. 하단 탭 6칸(홈·바구니·일정·사업 보고·담당조직·메뉴; MTG-프로젝트합치기 3단계 전에는 프로젝트),
// [일정] 탭 하나에 [달력 | 할 일], 홈·바구니 입력칸 하단 고정(자판 위로), 동그란 [+], 담당조직 추가 링크, 바구니 [⋯] 메뉴와
// [분류 요청] → 조용히 복사 + 한 줄 알림 + [분류 결과 입력] 창(#577). PC(1280)는 그대로.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'ds3b-user',email:'ds3b@example.org',user_metadata:{display_name:'배치'}};
const ws={id:'ds3b-ws',slug:'ds3b',name:'웹2'};
const now=new Date('2026-10-16T03:00:00Z');
const ago=days=>new Date(now.getTime()-days*86400000).toISOString();
const orgs=Array.from({length:9},(_,i)=>({id:'o'+i,name:'합성 담당조직 '+(i+1),active:true,created_by:user.id,workspace_id:ws.id}));
const meta={project_system:'v2',management_version:2};
const spaces=Array.from({length:9},(_,i)=>({id:'p'+i,name:'합성 프로젝트 '+(i+1),parent_id:null,status:'active',workspace_id:ws.id,owner_id:user.id,created_by:user.id,sort_order:i,metadata:meta}));
const docs=Array.from({length:12},(_,i)=>({id:'d'+i,title:'합성 자료 '+(i+1),file_name:`자료${i}.pdf`,workspace_id:ws.id,created_by:user.id,category:'교섭',document_date:`2026-10-${String(15-i).padStart(2,'0')}`,file_id:'f'+i,project_id:null}));
const tasks=Array.from({length:10},(_,i)=>({id:'t'+i,taskListId:'l1',taskListTitle:'내 할 일',title:'합성 할 일 '+(i+1),due:new Date(now.getTime()+i*86400000).toISOString().slice(0,10)+'T00:00:00.000Z',status:'needsAction',notes:''}));
const noteRow=(i,text)=>({id:`10000000-0000-4000-8000-00000000000${i}`,workspace_id:ws.id,occurred_at:ago(i),updated_at:ago(i),created_at:ago(i),raw_text:text,ai_export_allowed:true,archived_at:null,attachments:[],metadata:{}});

async function boot(page,width,{notes=[noteRow(1,'합성 메모 하나'),noteRow(2,'합성 메모 둘')],url='/app/'}={}){
 await page.setViewportSize({width,height:width<761?844:900});
 await page.clock.setFixedTime(now);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route(`${SB}/**`,route=>{
  const u=new URL(route.request().url()),path=u.pathname,q=u.searchParams,action=q.get('action');
  const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
  if(path==='/auth/v1/token')return ok({access_token:'a',refresh_token:'r',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
  if(path==='/auth/v1/user')return ok(user);
  if(path==='/functions/v1/google-calendar')return ok(action==='events'?{events:[],colors:{},eventColors:{}}:{connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
  if(path==='/functions/v1/google-tasks'){if(['linked','links'].includes(action))return ok({tasks:[],links:[],meeting_links:[]});return ok({connected:true,authorized:true,pending_scope:'all',tasks});}
  if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
  if(path.startsWith('/functions/v1/'))return ok({});
  if(path.startsWith('/rest/v1/rpc/'))return ok(null);
  if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:ws.id,user_id:user.id,role:'owner',email:user.email}]);
  if(path==='/rest/v1/app_workspaces')return ok([ws]);
  if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'배치'}]);
  if(path==='/rest/v1/app_suborganizations')return ok(orgs);
  if(path==='/rest/v1/app_suborganization_assignees')return ok(orgs.map(o=>({organization_id:o.id,user_id:user.id})));
  if(path==='/rest/v1/app_documents')return ok(docs);
  if(path==='/rest/v1/app_meetings')return ok([{id:'m1',workspace_id:ws.id,title:'합성 집행국 회의',series_name:'합성 집행국 회의',meeting_at:ago(1),created_by:user.id},{id:'m2',workspace_id:ws.id,title:'합성 교섭 회의',series_name:'합성 교섭 회의',meeting_at:ago(2),created_by:user.id}]);
  if(path==='/rest/v1/app_spaces'){if((q.get('select')||'').includes('milestones:'))return ok(spaces.map(p=>({id:p.id,milestones:[]})));return ok(spaces);}
  if(path==='/rest/v1/app_notes'){if(q.get('metadata'))return ok([]);return ok(notes.slice(Number(q.get('offset')||0)));}
  if(path.startsWith('/rest/v1/'))return ok([]);
  return ok({});
 });
 await page.goto(testOrigin+url);await enterLogin(page);
 await signInWithSession(page,user.email);
 await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
 return {errors};
}
const loaded=(page,view)=>expect.poll(()=>page.evaluate(v=>window.KPTUViewLoader.isLoaded(v)&&!document.querySelector('#'+v+'View').classList.contains('hidden'),view)).toBe(true);
const box=locator=>locator.evaluate(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};});
const token=(page,name)=>page.evaluate(name=>{const e=document.createElement('span');e.style.color=`var(${name})`;document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c;},name);

test('폰 하단 탭 6칸: 정리함 색 아이콘, [메뉴] 탭이 메뉴 창을 열고 오른쪽 위 ☰는 없다',async({page})=>{
 const {errors}=await boot(page,390);
 const tabs=page.locator('.mobile-tabs > button');
 // MTG-프로젝트합치기 3단계: 4번째 칸이 [프로젝트] → [사업 보고].
 await expect(tabs).toHaveText(['홈','정리함','일정','사업 보고','담당조직','메뉴']);
 for(const tab of await tabs.all()){const b=await box(tab);expect(b.width).toBeGreaterThanOrEqual(44);expect(b.height).toBeGreaterThanOrEqual(44);}
 // 8-9e-3(사용자 결정): 바구니 아이콘도 다른 탭과 같다 — 고르지 않으면 회색(흐린 색), 고르면 같은 선택 색. 바구니 종류 색(주황)은 쓰지 않는다.
 const tabColor=view=>page.locator(`.mobile-tabs [data-view="${view}"] svg`).evaluate(el=>getComputedStyle(el).color);
 expect(await tabColor('basket')).toBe(await tabColor('meetings'));expect(await tabColor('basket')).toBe(await token(page,'--kptu-muted'));
 expect(await tabColor('basket')).not.toBe(await token(page,'--ds-kind-basket-ink'));
 await expect(page.locator('#mobileMenuOpen')).toHaveCount(0);
 const menuTab=page.locator('#mobileMenuTab');await expect(menuTab).toHaveAttribute('aria-expanded','false');
 await menuTab.click();await expect(page.locator('#mobileMenu')).toBeVisible();await expect(menuTab).toHaveAttribute('aria-expanded','true');
 // 바구니는 하단 탭으로 옮겨 메뉴 창에서 뺐다. UI-디자인손질 4: 큰 칸 [쓰기]·회의·자료실·HWP 편집·게시판.
 await expect(page.locator('#mobileMenu nav button:visible')).toHaveText(['노트','자료실','HWP 편집','공유 페이지','원장','사진','통화','텔레그램 소식','아스날']);
 await page.keyboard.press('Escape');await expect(page.locator('#mobileMenu')).toBeHidden();await expect(menuTab).toBeFocused();await expect(menuTab).toHaveAttribute('aria-expanded','false');
 await menuTab.click();await page.locator('#mobileMenu [data-view="library"]').click();await loaded(page,'library');await expect(page.locator('#mobileMenu')).toBeHidden();
 await page.locator('.mobile-tabs [data-view="basket"]').click();await loaded(page,'basket');await expect(page.locator('.mobile-tabs [data-view="basket"]')).toHaveAttribute('aria-current','page');
 expect(errors).toEqual([]);
});

test('[일정] 탭: [달력 | 할 일] 전환, 마지막으로 본 쪽, 옛 ?view=tasks·홈 "할 일 ›"·밀기 순서',async({page})=>{
 const {errors}=await boot(page,390,{url:'/app/?view=tasks'});
 const schedule=page.locator('.mobile-tabs [data-mobile-schedule-tab]'),name=page.locator('[data-mobile-view-name]');
 // 옛 할 일 주소는 [일정]의 [할 일] 쪽으로 열린다.
 await loaded(page,'tasks');await expect(page).toHaveURL(/view=tasks/);
 await expect(schedule).toHaveAttribute('aria-current','page');await expect(name).toHaveText('할 일'); // UI-화면정리 B ①: 일정 하위 화면은 머리줄에 제 이름
 const toTasks=page.locator('#tasksView .schedule-switch [data-view="tasks"]'),toCalendar=page.locator('#tasksView .schedule-switch [data-view="calendar"]');
 await expect(toTasks).toHaveAttribute('aria-pressed','true');await expect(toCalendar).toHaveAttribute('aria-pressed','false');
 const pressed=await toTasks.evaluate(el=>({fg:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor}));
 expect(pressed).toEqual({fg:await token(page,'--ds-select-ink'),bg:await page.evaluate(()=>{const e=document.createElement('span');e.style.backgroundColor='var(--ds-select-bg)';document.body.append(e);const c=getComputedStyle(e).backgroundColor;e.remove();return c;})});
 await toCalendar.click();await loaded(page,'calendar');await expect(schedule).toHaveAttribute('aria-current','page');await expect(name).toHaveText('일정');
 await expect(page.locator('#calendarView .schedule-switch [data-view="calendar"]')).toHaveAttribute('aria-pressed','true');
 // UI-선택표시통일: 고른 [달력]도 [할 일]과 같은 회색, 안 고른 [할 일]은 흰 바탕.
 expect(await page.locator('#calendarView .schedule-switch [data-view="calendar"]').evaluate(el=>({fg:getComputedStyle(el).color,bg:getComputedStyle(el).backgroundColor}))).toEqual(pressed);
 expect(await page.locator('#calendarView .schedule-switch [data-view="tasks"]').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(await page.evaluate(()=>{const e=document.createElement('span');e.style.backgroundColor='var(--kptu-surface)';document.body.append(e);const c=getComputedStyle(e).backgroundColor;e.remove();return c;}));
 // 탭은 마지막으로 본 쪽을 연다(새 저장소 없이 라우터가 탭의 data-view를 맞춘다).
 await page.locator('.mobile-tabs [data-view="home"]').click();await loaded(page,'home');await schedule.click();await loaded(page,'calendar');
 await page.locator('#calendarView .schedule-switch [data-view="tasks"]').click();await loaded(page,'tasks');
 await page.locator('.mobile-tabs [data-view="home"]').click();await loaded(page,'home');await schedule.click();await loaded(page,'tasks');
 // 홈 "할 일 ›"도 [일정]의 [할 일] 쪽.
 await page.locator('.mobile-tabs [data-view="home"]').click();await loaded(page,'home');await page.locator('#calendarView .schedule-switch [data-view="calendar"]').evaluate(el=>el.click());await loaded(page,'calendar');
 await page.locator('.mobile-tabs [data-view="home"]').click();await page.locator('#homeView [data-journal-tasks-open]').click();await loaded(page,'tasks');await expect(schedule).toHaveAttribute('aria-current','page');
 // UI-버튼작게 ③: [달력 | 할 일 | 일기](HOME-업무일지홈: 업무일지는 홈)는 아래 탭 바로 위 한 줄(가운데, 줄 높이 44px 안 32px 알약).
 const switchBox=await box(page.locator('#tasksView .schedule-switch')),tabsBox=await box(page.locator('.mobile-tabs'));
 expect(Math.round(tabsBox.top-switchBox.bottom)).toBe(6);expect(Math.round(switchBox.height)).toBe(32);
 expect(Math.abs((switchBox.left+switchBox.right)/2-195)).toBeLessThanOrEqual(1);
 // UI-밀기탭이동삭제: 탭 이동은 하단 탭 누르기로만 한다. 할 일 쪽에서도 [일정] 자리가 그대로 이어진다.
 const goTab=async view=>{await page.locator('.mobile-tabs [data-view="'+view+'"]').first().click();await loaded(page,view);};
 await goTab('meetings');await goTab('team');await goTab('basket');await goTab('home');
 expect(errors).toEqual([]);
});

test('PC(1280)는 그대로: 일정·할 일 따로, 위쪽 추가 버튼, 홈 입력칸 제자리',async({page})=>{
 const {errors}=await boot(page,1280);
 await expect(page.locator('.mobile-tabs')).toBeHidden();
 expect(await page.locator('#homeView .home-quick').evaluate(el=>getComputedStyle(el).position)).not.toBe('fixed');await expect(page.locator('#homeView .home-basket-link')).toBeVisible();
 for(const [view,id,text] of [['calendar','#newEventBtn',null],['projects','#newProjectBtn','+ 사업영역'],['library','#newDocumentBtn','+ 자료 등록']]){
  // MTG-프로젝트합치기 3단계: 사업영역 관리(projects)는 왼쪽 메뉴 줄이 없어 사업 보고 ⋯ 안에서 연다(clickView가 그 길로 간다).
  await clickView(page,view);await loaded(page,view);
  await expect(page.locator(`#${view}View .schedule-switch`)).toHaveCount(view==='calendar'||view==='tasks'?1:0);
  if(view==='calendar'||view==='tasks')await expect(page.locator(`#${view}View .schedule-switch`)).toBeHidden();
  const button=page.locator(id);await expect(button).toBeVisible();expect(await button.evaluate(el=>getComputedStyle(el).position)).not.toBe('fixed');
  if(text)await expect(button).toHaveText(text);
 }
 await page.locator('.app-nav [data-view="team"]').click();await loaded(page,'team');await expect(page.locator('#soAddOrg,#soAddOrgLink')).toHaveCount(0);
 expect(errors).toEqual([]);
});

test('동그란 [+]: 하단 탭 바로 위 오른쪽, 보이는 원 36px·누르는 범위 44px, 이름, 같은 창, 마지막 줄이 가리지 않음',async({page})=>{
 const {errors}=await boot(page,390);
 const tabsTop=(await box(page.locator('.mobile-tabs'))).top;
 for(const [view,id,label,modal] of [['calendar','#newEventBtn','일정 등록','#eventModal'],['library','#newDocumentBtn','자료 등록','#documentModal'],['meetings','#newMeetingBtn','사업 보고 등록','#meetingModal']]){
  await page.evaluate(v=>KPTURouter.go(v),view);await loaded(page,view);
  const button=page.locator(id);await expect(button).toBeVisible();await expect(button).toHaveAttribute('aria-label',label);
  // 보이는 원은 버튼 자체 36px, 누르는 범위는 ::after 44px(앱의 다른 버튼과 같은 방식). 누르는 범위가 탭 위 12px·오른쪽 16px.
  const b=await box(button);expect(b.width).toBe(36);expect(b.height).toBe(36);expect(await button.evaluate(el=>getComputedStyle(el).borderRadius)).toBe('50%');
  const t=await button.evaluate(el=>{const r=el.getBoundingClientRect(),p=getComputedStyle(el,'::after');const left=r.left+parseFloat(p.left),top=r.top+parseFloat(p.top),w=parseFloat(p.width),h=parseFloat(p.height);
   return {w,h,bottom:top+h,right:left+w,hits:[[left+1,top+h/2],[left+w-1,top+h/2],[left+w/2,top+1],[left+w/2,top+h-1]].map(([x,y])=>document.elementFromPoint(x,y)?.closest('button')===el)};});
  // UI-버튼작게 ③: 일정·할 일은 아래 탭 위에 전환 줄(44px)이 있어 [+]는 그 줄 위 12px.
  const dock=view==='calendar'||view==='tasks'?44:0;
  expect(t.w).toBe(44);expect(t.h).toBe(44);expect(t.hits).toEqual([true,true,true,true]);expect(Math.round(tabsTop-dock-t.bottom)).toBe(12);expect(Math.round(390-t.right)).toBe(16);
  // 8-9e-3: + 는 글자가 아닌 선으로 그린 SVG 아이콘(장식), 원의 가로·세로 정가운데.
  const plus=await button.evaluate(el=>{const p=getComputedStyle(el,'::before');return {content:p.content,mask:p.maskImage||p.webkitMaskImage,w:p.width,h:p.height};});
  expect(plus.content).toBe('""');expect(plus.mask).toContain('svg');expect([plus.w,plus.h]).toEqual(['20px','20px']);
  // 그려진 + 의 픽셀 상자(원 안에서 원 바탕색과 다른 픽셀) 가운데가 원 가운데와 1px 안(위로 치우치지 않음). 밝은·어두운 화면 모두.
  for(const scheme of ['light','dark']){
   await page.emulateMedia({colorScheme:scheme});await page.waitForTimeout(100);
   const shot=await button.screenshot();
   const center=await page.evaluate(async data=>{const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const g=c.getContext('2d');g.drawImage(img,0,0);const d=g.getImageData(0,0,c.width,c.height).data;
    const cx=c.width/2,cy=c.height/2,at=(x,y)=>{const k=(y*c.width+x)*4;return [d[k],d[k+1],d[k+2]];},bg=at(Math.round(cx),Math.round(cy*0.25)+2);
    let x0=1e9,y0=1e9,x1=-1,y1=-1;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){if(Math.hypot(x+0.5-cx,y+0.5-cy)>c.width/2-5)continue;const p=at(x,y);if(Math.abs(p[0]-bg[0])+Math.abs(p[1]-bg[1])+Math.abs(p[2]-bg[2])>150){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}}
    return {dx:(x0+x1+1)/2-cx,dy:(y0+y1+1)/2-cy,w:x1-x0+1,h:y1-y0+1};},shot.toString('base64'));
   expect(Math.abs(center.dx),view+' '+scheme+' + 가로 가운데').toBeLessThanOrEqual(1);expect(Math.abs(center.dy),view+' '+scheme+' + 세로 가운데').toBeLessThanOrEqual(1);expect(center.w).toBeGreaterThan(10);expect(center.h).toBeGreaterThan(10);
  }
  await page.emulateMedia({colorScheme:'light'});
  // 목록 끝까지 내리면 마지막 줄은 [+] 위에 있다.
  await expect.poll(()=>page.locator('#'+view+'View').evaluate(el=>{
   window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'});
   // LIB-토글트리: 접힌 토글(<details>) 안 줄은 상자 크기는 있어도 보이지 않으므로 checkVisibility로 뺀다.
   const shown=[...el.querySelectorAll('*')].filter(node=>node.getClientRects().length&&node.checkVisibility()&&getComputedStyle(node).position!=='fixed'&&!node.closest('.modal,.schedule-switch'));
   return Math.max(...shown.map(node=>node.getBoundingClientRect().bottom));
  })).toBeLessThanOrEqual(b.top);
  await button.click();await expect(page.locator(modal)).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator(modal)).toBeHidden();
 }
 // UI-선택표시통일: 회의 화면의 위쪽 [+ 회의]는 동그란 [+]로만 보이고(카드 머리줄 안에 글자 버튼 없음), 고른 필터 칩은 회색, 안 고른 칩은 흰 바탕(UI-전수디자인점검 F01 뒤로는 칸 칩 줄로 본다).
 await page.evaluate(()=>KPTURouter.go('meetings'));await loaded(page,'meetings');
 expect(await page.locator('#newMeetingBtn').evaluate(el=>getComputedStyle(el).position)).toBe('fixed');
 const chips=page.locator('#reportKindFilter button');await expect.poll(()=>chips.count()).toBeGreaterThanOrEqual(2);
 {
  const color=(el,prop)=>el.evaluate((el,prop)=>getComputedStyle(el)[prop],prop);
  const paint=prop=>page.evaluate(([prop,name])=>{const e=document.createElement('span');e.style[prop]=`var(${name})`;document.querySelector('#appView').append(e);const c=getComputedStyle(e)[prop];e.remove();return c;},[prop,prop==='color'?'--ds-select-ink':'--ds-select-bg']);
  const picked=page.locator('#reportKindFilter [aria-checked="true"]');
  await expect(picked).toHaveCount(1);expect(await color(picked,'backgroundColor')).toBe(await paint('backgroundColor'));expect(await color(picked,'color')).toBe(await paint('color'));
  for(const other of await page.locator('#reportKindFilter [aria-checked="false"]').all())expect(await color(other,'backgroundColor')).toBe(await page.evaluate(()=>{const e=document.createElement('span');e.style.backgroundColor='var(--kptu-surface)';document.body.append(e);const c=getComputedStyle(e).backgroundColor;e.remove();return c;}));
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 expect(errors).toEqual([]);
});

test('담당조직: 폰에도 추가 버튼·글자 링크를 그리지 않음(UI-조직추가숨김)',async({page})=>{
 const {errors}=await boot(page,390);
 await page.locator('.mobile-tabs [data-view="team"]').click();await loaded(page,'team');
 await expect(page.locator('#soAddOrg,#soAddOrgLink,.so-add-link')).toHaveCount(0);
 await expect(page.locator('#soOrganizationList')).toBeVisible();
 expect(errors).toEqual([]);
});

test('홈: 입력칸은 하단 탭 바로 위, 그 위로 탭·버튼, 카드가 가리지 않고 자판이 열리면 자판 위로',async({page})=>{
 const {errors}=await boot(page,390);
 const quick=page.locator('#homeView .home-quick'),tabs=page.locator('.mobile-tabs');
 await expect(page.locator('#homeView .home-basket-link')).toBeHidden();
 const q=await box(quick),t=await box(tabs);expect(Math.round(q.bottom)).toBe(Math.round(t.top));expect(q.left).toBe(0);expect(q.right).toBe(390);
 const entry=await box(quick.locator('.home-quick-entry')),modes=await box(quick.locator('.home-quick-modes'));expect(modes.bottom).toBeLessThanOrEqual(entry.top);
 // [할 일]의 오늘·내일·날짜·프로젝트 버튼은 입력칸 위.
 await quick.locator('[data-quick-mode="task"]').click();await quick.locator('[data-quick-input]').click();
 const options=await box(quick.locator('[data-quick-options]'));expect(options.bottom).toBeLessThanOrEqual((await box(quick.locator('.home-quick-entry'))).top);
 expect(Math.round((await box(quick)).bottom)).toBe(Math.round(t.top));
 // 카드는 그 위에서 스크롤: 끝까지 내리면 마지막 카드가 입력칸 위.
 await page.locator('body').click({position:{x:5,y:5}});
 await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));
 const cards=await box(page.locator('#homeView [data-journal-day]'));/* HOME-업무일지홈: 홈 본문(업무일지 하루 칸) */expect(cards.bottom).toBeLessThanOrEqual((await box(quick)).top+1);
 // 자판(레이아웃 뷰포트가 줄지 않는 브라우저): 탭이 사라지고 입력칸이 자판 바로 위로.
 await quick.locator('[data-quick-input]').focus();
 await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>400});visualViewport.dispatchEvent(new Event('resize'))});
 await expect(tabs).toBeHidden();await expect.poll(async()=>Math.round((await box(quick)).bottom)).toBe(400);
 await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>844});visualViewport.dispatchEvent(new Event('resize'))});
 await expect(tabs).toBeVisible();await expect.poll(async()=>Math.round((await box(quick)).bottom)).toBe(Math.round(t.top));
 expect(errors).toEqual([]);
});

test('정리함: 업데이트가 없으면 회색 한 줄 "업데이트 없음"',async({page})=>{
 const {errors}=await boot(page,390,{notes:[]});
 await page.locator('.mobile-tabs [data-view="basket"]').click();await loaded(page,'basket');
 const empty=page.locator('#basketView [data-basket-list-status]');await expect(empty).toHaveText('업데이트 없음');
 await expect(empty).toHaveCSS('text-align','start');expect(await empty.evaluate(el=>getComputedStyle(el).color)).toBe(await token(page,'--kptu-muted'));
 await expect(page.locator('#basketView [data-basket-filter="unclassified"]')).toHaveText('미분류 0');
 expect(errors).toEqual([]);
});

