import {showBasketRow} from './helpers/basket-more.mjs';
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {clickView} from './helpers/shell-navigation.mjs';
import {enterLogin} from './helpers/login-entry.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
// UI-디자인손질(8-9e 후속): 메뉴 판(폰)·메뉴 [쓰기]·메모 [⋯]·상자 안쪽 여백·일정 하루 보기 할 일·담당조직 머리줄·
// 성명·보도자료 제목·[AI 분류 요청]·앱 아이콘. Supabase 응답만 합성하고 실제 앱을 Chromium에서 누른다.
test.use({locale:'ko-KR'});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'polish-user',email:'polish@example.org',user_metadata:{display_name:'손질'}};
const ws={id:'polish-ws',slug:'kptu-work',name:'웹2'};
const now=new Date('2026-10-16T03:00:00Z');
const ago=days=>new Date(now.getTime()-days*86400000).toISOString();
const iso=days=>new Date(now.getTime()+days*86400000).toISOString().slice(0,10);
const N1='10000000-0000-4000-8000-000000000001';
const orgs=[{id:'o1',name:'전국철도노동조합',active:true,created_by:user.id,workspace_id:ws.id}];
const spaces=[{id:'p1',name:'2026 임금교섭',parent_id:null,status:'active',workspace_id:ws.id,owner_id:user.id,created_by:user.id,sort_order:0,metadata:{project_system:'v2',management_version:2}}];
const tasks=[
 {id:'late',taskListId:'l1',taskListTitle:'내 할 일',title:'지난 할 일',due:iso(-2)+'T00:00:00.000Z',status:'needsAction',notes:''},
 {id:'today',taskListId:'l1',taskListTitle:'내 할 일',title:'오늘 할 일',due:iso(0)+'T00:00:00.000Z',status:'needsAction',notes:''},
];

async function boot(page,width,{dark=false}={}){
 await page.setViewportSize({width,height:width<761?844:900});
 await page.emulateMedia({colorScheme:dark?'dark':'light'});
 await page.clock.setFixedTime(now);
 const errors=[],state={notes:[{id:N1,workspace_id:ws.id,occurred_at:ago(0),updated_at:ago(0),created_at:ago(0),raw_text:'10/20 기자회견 자료\n\n- 장소: 국회',ai_export_allowed:true,archived_at:null,attachments:[],metadata:{write_request:{reason:'예전 후보',marked_at:ago(3),handed_off_at:null}}},{id:'10000000-0000-4000-8000-000000000002',workspace_id:ws.id,occurred_at:ago(1),updated_at:ago(1),created_at:ago(1),raw_text:'미분류 메모',ai_export_allowed:true,archived_at:null,attachments:[],metadata:{}}],posts:[],patches:[]};
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(`${SB}/**`,route=>{
  const req=route.request(),u=new URL(req.url()),path=u.pathname,q=u.searchParams,action=q.get('action');
  const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
  if(path==='/auth/v1/token')return ok({access_token:'a',refresh_token:'r',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
  if(path==='/auth/v1/user')return ok(user);
  if(path==='/functions/v1/google-calendar')return ok(action==='events'?{events:[],colors:{},eventColors:{}}:{connected:true,enabled:true,selected:['primary'],calendars:[{id:'primary',summary:'내 캘린더',primary:true,selected:true}],events:[],eventColors:{}});
  if(path==='/functions/v1/google-tasks'){if(['linked','links'].includes(action))return ok({tasks:[],links:[],meeting_links:[]});return ok({connected:true,authorized:true,pending_scope:'all',tasks});}
  if(path==='/functions/v1/drive-summary')return ok({ok:true,updated_at:ago(0.1),documents:{org:'https://docs.google.com/document/d/org/edit',project:'https://docs.google.com/document/d/project/edit'}});
  if(path.startsWith('/functions/v1/'))return ok({});
  if(path.startsWith('/rest/v1/rpc/'))return ok(null);
  if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:ws.id,user_id:user.id,role:'owner',email:user.email,workspace:ws}]);
  if(path==='/rest/v1/app_workspaces')return ok([ws]);
  if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'손질'}]);
  if(path==='/rest/v1/app_suborganizations')return ok(orgs);
  if(path==='/rest/v1/app_suborganization_assignees')return ok([{organization_id:'o1',user_id:user.id}]);
  if(path==='/rest/v1/app_spaces')return ok((q.get('select')||'').includes('milestones:')?[]:spaces);
  if(path==='/rest/v1/app_record_links')return ok([{note_id:N1,status:'confirmed',project_id:'p1',organization_id:null,project:{name:'2026 임금교섭'}},{note_id:N1,status:'confirmed',project_id:null,organization_id:'o1',organization:{name:'전국철도노동조합'}}]);
  if(path==='/rest/v1/app_notes'){
   if(req.method()==='POST'){const body=req.postDataJSON();state.posts.push(body);const row={id:'10000000-0000-4000-8000-000000000099',occurred_at:now.toISOString(),updated_at:now.toISOString(),created_at:now.toISOString(),archived_at:null,attachments:[],metadata:{},ai_export_allowed:true,...body};state.notes.unshift(row);return ok([row]);}
   if(req.method()==='PATCH'){state.patches.push(req.postDataJSON());return ok([]);}
   if(q.get('metadata'))return ok([]);return ok(state.notes.slice(Number(q.get('offset')||0)));
  }
  if(path.startsWith('/rest/v1/'))return ok([]);
  return ok({});
 });
 await page.goto(testOrigin+'/app/');await enterLogin(page);
 await page.locator('#emailAuthToggle').click();await page.locator('#authEmail').fill(user.email);await page.locator('#authPassword').fill('password123');await page.locator('#authSubmit').click();
 await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
 return {errors,state};
}
async function view(page,name){await clickView(page,name);await expect.poll(()=>page.evaluate(n=>window.KPTUViewLoader.isLoaded(n)&&!document.querySelector('#'+n+'View').classList.contains('hidden'),name)).toBe(true);}
const rect=locator=>locator.evaluate(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};});

for(const dark of [false,true])test(`메뉴 판(폰${dark?'·어두운 화면':''}): 하단 탭 바로 위로 올라오고 손잡이·바깥·Esc·아래로 밀기로 닫힌다`,async({page})=>{
 const {errors}=await boot(page,390,{dark});
 await view(page,'team');
 const tab=page.locator('#mobileMenuTab'),menu=page.locator('#mobileMenu'),panel=page.locator('.mobile-menu-panel'),grip=page.locator('#mobileMenu [data-mobile-menu-close]');
 // Opens with a short slide-up; measure only once it has settled.
 const open=async()=>{await tab.click();await expect(menu).toBeVisible();await expect.poll(()=>panel.evaluate(el=>el.getAnimations().length)).toBe(0);};
 await open();await expect(tab).toHaveAttribute('aria-expanded','true');
 // The sheet sits right on top of the tab bar, full width, rounded top.
 await expect.poll(async()=>{const [sheet,tabs]=await Promise.all([rect(panel),rect(page.locator('.mobile-tabs'))]);return Math.abs(sheet.bottom-tabs.top)<=1&&sheet.left===0&&Math.round(sheet.right)===390;}).toBe(true);
 await expect(grip).toBeFocused();await expect(grip).toHaveAccessibleName('메뉴 닫기');
 // 큰 칸 3×2: 쓰기·회의·자료실 / HWP 편집·성명·보도자료·공유 페이지. 성명과 보도자료는 한 칸.
 const tiles=page.locator('#mobileMenu nav button:visible');
 await expect(tiles).toHaveText(['쓰기','회의','자료실','HWP 편집','성명·보도자료','공유 페이지']);
 const boxes=await tiles.evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {x:Math.round(r.left),y:Math.round(r.top),h:r.height};}));
 expect(new Set(boxes.map(b=>b.y)).size).toBe(2);expect(new Set(boxes.map(b=>b.x)).size).toBe(3);
 for(const b of boxes)expect(b.h).toBeGreaterThanOrEqual(44);
 // 계정 상자: 화면 색·사본 갱신(시각은 오른쪽 작게)·로그아웃(빨강), 사본 링크는 밑줄 없는 보조 글자.
 const account=page.locator('#mobileAccountGroup');
 await expect(account.locator('button')).toHaveText(['화면 색','사본 갱신','로그아웃']);
 await account.locator('[data-drive-summary-refresh]').click();
 await open();
 const time=account.locator('.drive-summary-time');await expect(time).toBeVisible();
 const [refresh,timeBox]=await Promise.all([rect(account.locator('[data-drive-summary-refresh]')),rect(time)]);
 expect(timeBox.top).toBeGreaterThanOrEqual(refresh.top);expect(timeBox.bottom).toBeLessThanOrEqual(refresh.bottom);expect(timeBox.right).toBeGreaterThan(refresh.left+refresh.width/2);
 expect(await account.locator('.drive-summary-links a').first().evaluate(el=>getComputedStyle(el).textDecorationLine)).toBe('none');
 const red=await account.locator('[data-kptu-logout]').evaluate(el=>getComputedStyle(el).color),danger=await page.evaluate(()=>{const e=document.createElement('span');e.style.color='var(--kptu-danger)';document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c;});
 expect(red).toBe(danger);
 // Keyboard: Tab moves from the grip into the tiles; Esc closes and returns to the [메뉴] tab.
 await grip.focus();await page.keyboard.press('Tab');await expect(tiles.first()).toBeFocused();
 await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(tab).toBeFocused();await expect(tab).toHaveAttribute('aria-expanded','false');
 // A tap on the grip closes.
 await open();await grip.click();await expect(menu).toBeHidden();
 // A tap outside (above the sheet) closes.
 await open();await page.mouse.click(195,80);await expect(menu).toBeHidden();
 // A short pull springs back; a long pull down closes.
 await open();
 const g=await rect(grip),x=g.left+g.width/2,y=g.top+g.height/2;
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+20,{steps:4});await page.mouse.up();
 await expect(menu).toBeVisible();await expect.poll(()=>panel.evaluate(el=>el.style.transform)).toBe('');
 await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+180,{steps:8});await page.mouse.up();
 await expect(menu).toBeHidden();
 // A tap right after a page load still works (the clock is small then; only the click that ends a pull is swallowed).
 await page.evaluate(()=>{performance.now=()=>120;});
 // A tile opens its screen; 성명·보도자료 shows that one name on top.
 await tab.click();await page.locator('#mobileMenu [data-view="media"]').click();
 await expect(page.locator('#mediaView')).toBeVisible();await expect(page.locator('[data-mobile-view-name]')).toHaveText('성명·보도자료');
 expect(errors).toEqual([]);
});

test('PC 사이드바: 메뉴 판과 같은 항목([쓰기]·성명·보도자료 한 줄), 761~1023px 가로 메뉴에는 [쓰기]가 ☰ 안에만',async({page})=>{
 await boot(page,1280);
 await expect(page.locator('#appView>.app-nav [data-menu-write]')).toBeVisible();
 // UI-PC사이드바: 홈은 맨 위 아이콘+"홈" 줄(따로 있던 [홈] 줄은 PC 사이드바에서 숨김), 게시판 → 공유 페이지.
 await expect(page.locator('#appView>.app-nav .nav-btn:visible')).toHaveText(['바구니','쓰기','일정','할 일','일지','일기','프로젝트','자료실','회의','성명·보도자료','공유 페이지','담당조직','HWP 편집']);
 await page.setViewportSize({width:900,height:900});
 await expect(page.locator('#appView>.app-nav [data-menu-write]')).toBeHidden();
 await page.locator('#mobileMenuOpen').click();await expect(page.locator('#mobileMenu [data-menu-write]')).toBeVisible();
});

for(const width of [390,1280])test(`메뉴 [쓰기]: 빈 MD 편집기에서 저장 아이콘을 누르면 바구니 새 업데이트 하나(기존 저장 경로) ${width}`,async({page})=>{
 const {errors,state}=await boot(page,width);
 await view(page,'basket');
 if(width<761){await page.locator('#mobileMenuTab').click();await page.locator('#mobileMenu [data-menu-write]').click();}
 else await page.locator('#appView>.app-nav [data-menu-write]').click();
 const editor=page.locator('#mdEditor');await expect(editor).toBeVisible();
 await expect(editor.locator('h2')).toHaveText('쓰기');await expect(editor.locator('.md-editor-text')).toHaveValue('');await expect(editor.locator('.md-editor-text')).toBeFocused();
 // Empty text is refused by the same validation as the basket input; nothing is sent.
 await editor.locator('[data-md-save-icon]').click();await expect(editor.locator('.md-editor-status')).toHaveText('글을 입력해 주세요.');expect(state.posts).toHaveLength(0);
 // Closing keeps the unsaved text in this tab for the next [쓰기].
 await editor.locator('.md-editor-text').fill('# 새 메모\n쓰기에서 저장');
 await editor.locator('[data-close="mdEditor"]').click();await expect(editor).toHaveCount(0);
 await expect(page.locator('#toast')).toContainText('[쓰기]를 다시 누르면 이어서');
 if(width<761){await page.locator('#mobileMenuTab').click();await page.locator('#mobileMenu [data-menu-write]').click();}
 else await page.locator('#appView>.app-nav [data-menu-write]').click();
 await expect(page.locator('#mdEditor .md-editor-text')).toHaveValue('# 새 메모\n쓰기에서 저장');
 await page.locator('#mdEditor [data-md-save-icon]').click();
 await expect(page.locator('#mdEditor')).toHaveCount(0);await expect(page.locator('#toast')).toContainText('바구니에 저장했어요.');
 expect(state.posts).toEqual([{workspace_id:ws.id,raw_text:'# 새 메모\n쓰기에서 저장'}]);
 // The basket list on screen shows the new note without leaving it.
 await showBasketRow(page,'10000000-0000-4000-8000-000000000099');
 await expect(page.locator('[data-basket-row="10000000-0000-4000-8000-000000000099"]')).toContainText('# 새 메모');
 // The next [쓰기] starts empty again.
 if(width<761){await page.locator('#mobileMenuTab').click();await page.locator('#mobileMenu [data-menu-write]').click();}
 else await page.locator('#appView>.app-nav [data-menu-write]').click();
 await expect(page.locator('#mdEditor .md-editor-text')).toHaveValue('');
 await page.keyboard.press('Escape');await expect(page.locator('#mdEditor')).toHaveCount(0);
 expect(errors).toEqual([]);
});

for(const [width,dark] of [[390,false],[390,true],[1280,false]])test(`메모 읽기·수정: "‹ 바구니", 이 메모의 [⋯] 메뉴, 큰 버튼 둘, 연결·날짜 한 줄 ${width}${dark?' 어두운 화면':''}`,async({page})=>{
 const {errors,state}=await boot(page,width,{dark});
 await view(page,'basket');
 const listMore=page.locator('[data-basket-more]');await expect(listMore).toBeVisible();
 await (await showBasketRow(page,N1)).click();
 const detail=page.locator('[data-basket-detail]');await expect(detail.locator('[data-basket-read-text]')).toBeVisible();
 // The list menu (AI 분류 요청 등) is the list's only; the note has its own.
 await expect(listMore).toBeHidden();
 const back=detail.locator('.basket-back');await expect(back).toHaveText('‹ 바구니');await expect(back).toHaveAccessibleName('바구니 목록으로');
 if(width<761){
  await expect(page.locator('[data-mobile-view-name]')).toBeHidden();
  const [b,header]=await Promise.all([rect(back),rect(page.locator('.mobile-shell-header'))]);
  expect(Math.abs((b.top+b.bottom)/2-(header.top+header.bottom)/2)).toBeLessThanOrEqual(6);
 }
 // Card's last row (UI-바구니상세개편): [연결하기](filled)·[할 일 만들기](task teal)·[노트로 옮기기]. No write-request candidate anywhere.
 await expect(detail.locator('[data-basket-read-actions] button')).toHaveText(['연결하기','할 일 만들기','노트로 옮기기']);
 const color=sel=>detail.locator(sel).evaluate(el=>getComputedStyle(el).backgroundColor);
 const token=name=>page.evaluate(name=>{const e=document.createElement('span');e.style.color=`var(${name})`;document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c;},name);
 expect(await color('[data-basket-link-open]')).toBe(await token('--kptu-primary'));
 expect(await color('[data-basket-task-open]')).toBe(await token('--ds-kind-task-soft'));
 await expect(page.locator('#basketView')).not.toContainText('쓰기요청');
 // One line under the text: colored-dot chips for each link, then the date.
 const meta=detail.locator('.basket-note-meta');
 await expect(meta.locator('.basket-chip')).toHaveText(['프로젝트: 2026 임금교섭','담당조직: 전국철도노동조합']);
 await expect(meta.locator('.basket-chip-dot')).toHaveCount(2);await expect(meta.locator('time')).toHaveText(/2026\. 10\. 16\./);
 const [textBox,metaBox]=await Promise.all([rect(detail.locator('[data-basket-read-text]')),rect(meta)]);expect(metaBox.top).toBeGreaterThan(textBox.bottom);
 // [⋯] = 수정·보관·삭제(빨강), keyboard and Esc. 원문 보기 is the small toggle icon near the text.
 const more=detail.locator('[data-basket-note-more]'),menu=detail.locator('#basketNoteMenu');
 await expect(menu).toBeHidden();await more.click();await expect(menu).toBeVisible();await expect(more).toHaveAttribute('aria-expanded','true');
 await expect(menu.locator('button')).toHaveText(['수정','보관','삭제']);
 await expect(menu.locator('[data-basket-edit]')).toBeFocused();
 expect(await menu.locator('[data-basket-delete]').evaluate(el=>getComputedStyle(el).color)).toBe(await token('--kptu-danger'));
 await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(more).toBeFocused();await expect(detail.locator('[data-basket-read-text]')).toBeVisible();
 const raw=detail.locator('[data-basket-read-raw]');await expect(raw).toHaveAccessibleName('원문 그대로 보기');await raw.click();
 await expect(detail.locator('[data-basket-read-text]')).toContainText('- 장소: 국회');
 await expect(raw).toHaveAttribute('aria-pressed','true');await expect(raw).toHaveAccessibleName('정리해서 보기');
 // 수정: the edit view keeps "‹ 바구니", hides [⋯], and names the big editor [큰 창에서 수정].
 await more.click();await menu.locator('[data-basket-edit]').click();
 await expect(detail.locator('[data-basket-text]')).toBeFocused();await expect(more).toBeHidden();await expect(back).toBeVisible();
 await expect(detail.locator('[data-basket-big-write]')).toHaveText('큰 창에서 수정');
 await detail.locator('[data-basket-big-write]').click();await expect(page.locator('#mdEditor h2')).toHaveText('큰 창에서 수정');
 await page.locator('#mdEditor [data-close="mdEditor"]').click();await detail.locator('[data-basket-cancel]').click();
 // 보관 still uses the same PATCH; the stored write_request metadata is never written or removed here.
 await more.click();await menu.locator('[data-basket-archive]').click();
 await expect.poll(()=>state.patches.length).toBe(1);expect(Object.keys(state.patches[0]).sort()).toEqual(['archived_at','updated_at']);
 // "‹ 바구니" returns to the list with its own [⋯].
 await back.click();await expect(page.locator('[data-basket-list]')).toBeVisible();await expect(listMore).toBeVisible();
 expect(errors).toEqual([]);
});

test('바구니 목록 [⋯]: [AI 분류 요청], 누른 뒤 안내 문구',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:testOrigin});
 await boot(page,390);await view(page,'basket');
 await page.locator('[data-basket-more]').click();
 await expect(page.locator('#basketMoreMenu button')).toHaveText(['AI 분류 요청','GPT 답변 가져오기']);
 await page.locator('[data-handoff-copy]').click();
 await expect(page.locator('[data-basket-handoff-scope]')).toContainText('AI 분류 요청을 복사했어요. ChatGPT에 붙여 넣고, 받은 답을 아래 [분류 결과 입력]에 붙여 넣으세요.');
});

for(const width of [390,1280])test(`상자 안쪽 여백·제목 정리: 회의 결과 창, 성명·보도자료 목록, 담당조직 머리줄, 일정 하루 보기 할 일 ${width}`,async({page})=>{
 const {errors}=await boot(page,width);
 // 1 회의 결과 창: 묶음 상자 안 입력칸이 테두리에서 12px 이상 떨어지고, "차수"에 "선택" 이름표가 없다.
 await view(page,'meetings');await page.locator('#newMeetingBtn').click();await expect(page.locator('#meetingModal')).toBeVisible();
 for(const box of await page.locator('#meetingModal fieldset.meeting-entry-section').all()){
  const gap=await box.evaluate(el=>{const r=el.getBoundingClientRect();return Math.min(...[...el.querySelectorAll('input:not([type=file]),select,textarea,legend')].filter(c=>c.getClientRects().length).map(c=>{const b=c.getBoundingClientRect();return Math.min(b.left-r.left,r.right-b.right);}));});
  expect(gap).toBeGreaterThanOrEqual(12);
 }
 await expect(page.locator('#meetingRoundNo').locator('xpath=..')).not.toContainText('선택');
 await page.keyboard.press('Escape');
 // 5 성명·보도자료: 목록 줄 글자가 상자 왼쪽에서 12px 이상.
 await view(page,'media');await expect(page.locator('#mediaView .w1p-item').first()).toBeVisible();
 const pad=await page.locator('#mediaView .w1p-item').first().evaluate((el,phone)=>{const box=el.closest('.w1p-table').getBoundingClientRect();return el.querySelector(phone?'.w1p-tag':'.w1p-date').getBoundingClientRect().left-box.left;},width<761);
 expect(pad).toBeGreaterThanOrEqual(12);
 if(width<761)await expect(page.locator('[data-mobile-view-name]')).toHaveText('성명·보도자료');
 // 3 담당조직: 맨 위 "N개 담당조직" 줄이 없다.
 await view(page,'team');await expect(page.locator('#soOrganizationList .kptu-list-row')).toHaveCount(1);
 await expect(page.locator('#soOrgCount')).toHaveCount(0);await expect(page.locator('#teamView')).not.toContainText('개 담당조직');
 // 2 일정 하루 보기의 할 일: 바탕·테두리 없는 줄, 13px·400, 기한 지난 것만 빨간 "지남".
 if(width<761){
  await view(page,'calendar');await page.locator('.calendar-view-switch button[aria-pressed="false"]').last().click();
  for(const [date,overdue] of [[iso(-2),true],[iso(0),false]]){
   await page.locator(`.cmv-date-list[data-date="${date}"]`).click();
   const row=page.locator('#calendarDayTasks .cmv-task').first();await expect(row).toBeVisible();
   const s=await row.evaluate(el=>{const c=getComputedStyle(el),t=getComputedStyle(el.querySelector('.cmv-event-title'));return {bg:c.backgroundColor,border:c.borderTopWidth,left:c.borderLeftWidth,size:t.fontSize,weight:t.fontWeight};});
   expect(s).toEqual({bg:'rgba(0, 0, 0, 0)',border:'0px',left:'0px',size:'13px',weight:'400'});
   await expect(row.locator('.gt-meta')).toBeVisible();
   await expect(row.locator('.kptu-day-overdue')).toHaveCount(overdue?1:0);
   if(overdue)await expect(row).toHaveAttribute('aria-label',/기한 지남/);
   await page.keyboard.press('Escape');await expect(page.locator('#calendarDayModal')).toBeHidden();
  }
 }
 expect(errors).toEqual([]);
});

test('앱 아이콘·시작 화면: 9-6, 남색 바탕, 모든 크기 파일이 있고 크기가 맞다',async({request})=>{
 const manifest=JSON.parse(readFileSync('app/windows-manifest.json','utf8'));
 // UI-하단바색: background_color·theme_color 모두 앱 바탕(밝은 --kptu-bg). 일부 폰이 background_color를 하단 내비게이션 바에 쓰므로 남색을 쓰지 않는다(아이콘 바탕 app-icon.svg만 남색).
 expect(manifest).toMatchObject({name:'9-6',short_name:'9-6',background_color:'#f3f1ea',theme_color:'#f3f1ea'});
 const png=manifest.icons.filter(i=>i.type==='image/png');
 expect(png.map(i=>`${i.sizes} ${i.purpose}`).sort()).toEqual(['192x192 any','192x192 maskable','512x512 any','512x512 maskable']);
 const html=readFileSync('app/index.html','utf8');
 const apple=html.match(/rel="apple-touch-icon" href="\.\/([^"?]+)/)[1],favicon=html.match(/rel="icon" href="\.\/([^"?]+)(?:\?[^"]*)?" sizes="32x32"/)[1];
 for(const [path,size] of [...png.map(i=>[i.src.replace('./','').split('?')[0],Number(i.sizes.split('x')[0])]),[apple,180],[favicon,32]]){
  const res=await request.get(`${testOrigin}/app/${path}`);expect(res.ok(),path).toBe(true);
  const body=await res.body();expect(body.subarray(1,4).toString(),path).toBe('PNG');
  expect([body.readUInt32BE(16),body.readUInt32BE(20)],path).toEqual([size,size]);
 }
 const svg=readFileSync('app/app-icon.svg','utf8');
 expect(svg).toContain('fill="#1f3150"');expect(svg).toContain('@media (max-width:32px){.dot{r:4.5px}}');
 expect(svg).not.toMatch(/<image|href=|data:/);
});

// UI-버튼크기(2026-10-17): 폰 위 상태줄·아래 버튼줄은 남색이 아니라 앱 바탕(--kptu-bg)과 같은 색(밝게·어둡게 각각).
// manifest background_color도 앱 바탕(UI-하단바색). 계정 테마를 바꾸면 지금 켜진 쪽 meta가 그 테마의 바탕으로 바뀐다.
for(const dark of [false,true])test(`위아래 줄 색: meta theme-color가 앱 바탕을 따른다${dark?' (어두운 화면)':''}`,async({page})=>{
 for(const path of ['app/index.html','app/login/index.html']){
  const html=readFileSync(path,'utf8');
  expect(html,path).toContain('<meta name="theme-color" content="#f3f1ea" media="(prefers-color-scheme: light)">');
  expect(html,path).toContain('<meta name="theme-color" content="#161613" media="(prefers-color-scheme: dark)">');
 }
 const {errors}=await boot(page,390,{dark});
 const scheme=dark?'dark':'light';
 const read=()=>page.evaluate(scheme=>({meta:document.querySelector(`meta[name="theme-color"][media="(prefers-color-scheme: ${scheme})"]`).content,bg:getComputedStyle(document.documentElement).getPropertyValue('--kptu-bg').trim()}),scheme);
 await expect.poll(async()=>{const r=await read();return r.meta===r.bg;}).toBe(true);
 expect((await read()).bg).toBe(dark?'#161613':'#f3f1ea');
 // 테마 [남색]을 고르면 밝은 화면의 meta는 그 테마 바탕(#f5f6f7), 어두운 화면은 공통 어두운 바탕 그대로.
 await page.locator('#themeModal [data-theme-choice="navy"]').evaluate(el=>el.click());
 await expect.poll(async()=>(await read()).meta).toBe(dark?'#161613':'#f5f6f7');
 expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe('navy');
 expect(errors).toEqual([]);
});
