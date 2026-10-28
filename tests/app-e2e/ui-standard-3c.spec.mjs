import {openLegacyBoard} from './helpers/legacy-board.mjs';
import {THEMES} from './helpers/theme-list.mjs';
import {test,expect} from '@playwright/test';
import {clickView} from './helpers/shell-navigation.mjs';
import {enterLogin} from './helpers/login-entry.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import {openFirstMeetingResult} from './helpers/meeting-open.mjs';
// UI-디자인기준 3/3 3부(8-9e-3, 마지막): 남은 화면(HWP 편집 바깥 틀·게시판)·공용 셸(폰 머리줄·하단 탭·PC 사이드바·☰ 메뉴 판·계정 메뉴)·
// 화면 색 창·공용 창(.modal)을 같은 기준(버튼 높이 하나·13px/500·모서리 8px, 0.5px 상자 안 44px 줄·이름 13px/400, 제목 18px/500)으로,
// 다크 모드는 기기 설정만 따라 Web2 전체(창 포함)에 켠다. 칸막이(HWP 편집기·성명·게시판 본문 iframe) 바탕은 밝게 둔다.
// 폰 실제 환경처럼 한국어 로케일(글꼴 대체로 줄 높이가 달라지는 경우까지 본다).
test.use({locale:'ko-KR'});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'ds3c-user',email:'ds3c@example.org',user_metadata:{display_name:'마무리'}};
const ws={id:'ds3c-ws',slug:'ds3c',name:'웹2'};
const now=new Date('2026-10-16T03:00:00Z');
const ago=days=>new Date(now.getTime()-days*86400000).toISOString();
const iso=days=>new Date(now.getTime()+days*86400000).toISOString().slice(0,10);
const orgs=[['o1','전국철도노동조합'],['o2','서울교통공사노동조합'],['o3','서해선지부']].map(([id,name])=>({id,name,active:true,created_by:user.id,workspace_id:ws.id}));
const meta={project_system:'v2',management_version:2};
const spaces=[['p1','2026 임금교섭',null],['p1a','실무교섭','p1'],['p2','안전인력 충원 요구',null]].map(([id,name,parent_id],i)=>({id,name,parent_id,status:'active',workspace_id:ws.id,owner_id:user.id,created_by:user.id,sort_order:i,metadata:meta}));
const docs=[['d1','요구안','요구안.pdf'],['d2','개정안','개정안.hwpx']].map(([id,title,file_name],i)=>({id,title,file_name,workspace_id:ws.id,created_by:user.id,category:'교섭',document_date:`2026-10-${15-i}`,file_id:'f'+id,project_id:null}));
const meetings=[{id:'m1',workspace_id:ws.id,title:'정책위원회',meeting_name:'정책위원회',round_no:5,meeting_at:'2026-10-10T14:00:00'}];
const tasks=[0,1,2].map(i=>({id:'t'+i,taskListId:'l1',taskListTitle:'내 할 일',title:'합성 할 일 '+(i+1),due:iso(i-1)+'T00:00:00.000Z',status:'needsAction',notes:''}));
const notes=[{id:'10000000-0000-4000-8000-000000000001',workspace_id:ws.id,occurred_at:ago(0),updated_at:ago(0),created_at:ago(0),raw_text:'합성 메모',ai_export_allowed:true,archived_at:null,attachments:[],metadata:{}}];

async function boot(page,width,{dark=false}={}){
 await page.setViewportSize({width,height:width<761?844:900});
 await page.emulateMedia({colorScheme:dark?'dark':'light'});
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
  if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'마무리'}]);
  if(path==='/rest/v1/app_meetings')return ok(meetings);
  if(path==='/rest/v1/app_suborganizations')return ok(orgs);
  if(path==='/rest/v1/app_suborganization_assignees')return ok(orgs.map(o=>({organization_id:o.id,user_id:user.id})));
  if(path==='/rest/v1/app_suborganization_updates')return ok([{organization_id:'o1',occurred_at:ago(2)}]);
  if(path==='/rest/v1/app_documents')return ok(docs);
  if(path==='/rest/v1/app_spaces'){if((q.get('select')||'').includes('milestones:'))return ok(spaces.map(p=>({id:p.id,milestones:p.id==='p1'?[{start_at:iso(2)+'T01:00:00Z'}]:[]})));return ok(spaces);}
  if(path==='/rest/v1/app_notes'){if(q.get('metadata'))return ok([]);return ok(notes.slice(Number(q.get('offset')||0)));}
  if(path.startsWith('/rest/v1/'))return ok([]);
  return ok({});
 });
 await page.route('https://raw.githubusercontent.com/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<p>합성 본문</p>'}));
 await page.goto(testOrigin+'/app/');await enterLogin(page);
 await signInWithSession(page,user.email);
 await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
 return {errors};
}
async function view(page,name){await clickView(page,name);await expect.poll(()=>page.evaluate(n=>window.KPTUViewLoader.isLoaded(n)&&!document.querySelector('#'+n+'View').classList.contains('hidden'),name)).toBe(true);}
const look=locator=>locator.evaluate(el=>{const b=el.getBoundingClientRect(),s=getComputedStyle(el);return {height:b.height,fontSize:s.fontSize,fontWeight:s.fontWeight,radius:s.borderRadius,bg:s.backgroundColor,fg:s.color,border:s.borderTopColor,borderStyle:s.borderTopStyle,shadow:s.boxShadow};});
const token=(page,name)=>page.evaluate(name=>{const e=document.createElement('span');e.style.color=`var(${name})`;document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c;},name);
// Every visible button-shaped control in a region: one height (46px), 13px, 500, 8px corners, no shadow (UI-버튼크기: filters/switches 32px). Returns the filled ones.
async function sameButtons(page,region,skip='.icon-btn'){
 const primary=await token(page,'--kptu-primary'),filled=[];
 for(const control of await region.locator('button:visible,a.mini:visible').all()){
  if(await control.evaluate((el,skip)=>el.matches(skip),skip))continue;
  const s=await look(control),label=(await control.textContent()).trim();
  // UI-버튼크기: 필터 칩은 32px 알약, 전환 세그먼트(일정 창 [일정 | 할 일])는 32px 상자 안 칸. 둘 다 누르는 범위 44px.
  const kind=await control.evaluate(el=>el.matches('.filter-chips button')?'chip':el.matches('[data-event-mode]')?'segment':'button');
  // UI-버튼줄이기: 창 주 동작·HWP [내 기기에 저장]은 36px, 창 보조·HWP 보조는 32px.
  // UI-버튼전수조사(2026-10-24): 남은 46px 버튼도 기준으로 — 채운 버튼(주 동작)은 36px, 나머지는 작은 버튼 32px.
  const want=await control.evaluate(el=>el.matches('#hwpLabPick,#hwpLabUpload,#eventTaskProject,#gtDeleteBtn,#gtToggleBtn,.gt-pick-btn,.gt-pane-save,#wdInboxBig')?32:el.matches('.primary,#hwpLabSave,#saveEventBtn,#saveTaskBtn,#gtSaveBtn,#saveMeetingBtn,#saveDocumentBtn,#ps3CreateSave,#libraryEditSave,#mffCreate,#soSaveOrg,#soSaveAssignees,#wdAffSave,#wdTimeSave,#wfMeetingGenerate,#wdInboxSave')?36:32);
  if(kind==='button'){expect(s.height,label).toBe(want);expect(s.radius,label).toBe('8px');}
  else{expect(s.height,label).toBeGreaterThanOrEqual(kind==='chip'?32:30);expect(s.height,label).toBeLessThanOrEqual(32);if(kind==='chip')expect(s.radius,label).toBe('999px');expect(await control.evaluate(el=>parseFloat(getComputedStyle(el,'::after').height)),label).toBe(44);}
  expect(s.fontSize,label).toBe('13px');expect(s.fontWeight,label).toBe('500');expect(s.shadow,label).toBe('none');
  // UI-테마선택색: 고른 전환·필터 쪽은 일부러 주 버튼 색이라 채운 버튼 수에서 뺀다.
  if(s.bg===primary&&!await control.evaluate(el=>el.matches('[aria-pressed="true"],[aria-checked="true"],.active')))filled.push(label);
 }
 return filled;
}
async function inputs(region){
 for(const input of await region.locator('input:visible:not([type="checkbox"],[type="radio"],[type="file"],[type="color"],.dt-date>input),select:visible').all()){
  // MTG-보고창칸정리(명진 2026-10-27): 창 한 줄 입력칸 높이 46px -> 28px(공용 --ds-field-height). 날짜 칸 위에 투명하게 겹친 달력 입력(.dt-date>input)은 칸 자체(.dt-date)가 28px라 뺀다.
  const s=await look(input);expect(s.height,await input.getAttribute('id')).toBeGreaterThanOrEqual(28);expect(s.height,await input.getAttribute('id')).toBeLessThanOrEqual(30);expect(s.radius).toBe('8px');expect(s.fontWeight).toBe('400');
 }
}
// Normal text contrast (WCAG): every visible text node in the viewport against its painted background. Large text needs 3:1.
const lowContrast=page=>page.evaluate(()=>{
 const parse=c=>{const m=c.match(/rgba?\(([^)]+)\)/);if(!m)return null;const p=m[1].split(/[ ,/]+/).filter(Boolean).map(Number);return [p[0],p[1],p[2],p.length>3?p[3]:1];};
 const lum=([r,g,b])=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);};
 const blend=(top,bottom)=>{const a=top[3];return [top[0]*a+bottom[0]*(1-a),top[1]*a+bottom[1]*(1-a),top[2]*a+bottom[2]*(1-a),1];};
 const background=el=>{const stack=[];for(let e=el;e;e=e.parentElement){const c=parse(getComputedStyle(e).backgroundColor);if(c&&c[3]>0){stack.push(c);if(c[3]>=1)break;}}let base=parse(getComputedStyle(document.documentElement).backgroundColor);if(!base||base[3]<1)base=parse(getComputedStyle(document.body).backgroundColor);for(let i=stack.length-1;i>=0;i--)base=blend(stack[i],base);return base;};
 const out=[],seen=new Set(),walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 while(walker.nextNode()){
  const node=walker.currentNode,el=node.parentElement;if(!node.data.trim()||!el||seen.has(el))continue;seen.add(el);
  if(el.closest('iframe,svg,.a11y-only,:disabled,[aria-disabled="true"]')||!el.checkVisibility({visibilityProperty:true,opacityProperty:true}))continue;
  const r=el.getBoundingClientRect();if(!r.width||!r.height||r.bottom<0||r.top>innerHeight)continue;
  const s=getComputedStyle(el),bg=background(el),fg=blend(parse(s.color),bg),[a,b]=[lum(fg),lum(bg)],ratio=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
  const size=parseFloat(s.fontSize),large=size>=24||size>=18.66&&Number(s.fontWeight)>=700;
  if(ratio<(large?3:4.5))out.push(`${ratio.toFixed(2)} ${node.data.trim().slice(0,20)}`);
 }
 return out;
});

test('다크 모드: 기기 설정이 어두우면 Web2 전체·창이 어둡고, 테마 4종 모두 본문 글자 4.5:1 이상',async({page})=>{
 test.setTimeout(180000);
 const {errors}=await boot(page,390,{dark:true});
 const dark='rgb(22, 22, 19)',surface='rgb(31, 31, 27)';
 for(const name of ['home','basket','calendar','tasks','projects','team','library','meetings','pages','hwp']){
  await view(page,name);
  expect(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),name).toContain('dark');
  expect(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),name).toBe(dark);
  expect(await page.locator('.mobile-tabs').evaluate(el=>getComputedStyle(el).backgroundColor),name).toBe(surface);
  if(name!=='hwp')expect(await lowContrast(page),name).toEqual([]);
 }
 // 창도 어둡다: 할 일 편집·화면 색 창·메뉴 판.
 await view(page,'tasks');await expect(page.locator('#gtTaskSection')).toBeVisible();await page.waitForFunction(()=>window.KPTUGoogleTasks?.openEditor);await page.evaluate(()=>window.KPTUGoogleTasks.openEditor());
 const taskModal=page.locator('#gtTaskModal .modal-card');await expect(taskModal).toBeVisible();
 expect((await look(taskModal)).bg).toBe(surface);expect(await lowContrast(page)).toEqual([]);
 await page.keyboard.press('Escape');await expect(taskModal).toBeHidden();
 await page.locator('#mobileMenuTab').click();await expect(page.locator('#mobileMenu')).toBeVisible();
 expect((await look(page.locator('.mobile-menu-panel'))).bg).toBe(surface);expect(await lowContrast(page)).toEqual([]);
 await page.locator('#mobileMenu [data-theme-open]').click();await expect(page.locator('#themeModal')).toBeVisible();
 expect((await look(page.locator('#themeModal .modal-card'))).bg).toBe(surface);
 // 테마 10종: 계정 색만 바뀌고 모두 어두운 바탕에서 읽힌다.
 const primaries=new Set();
 for(const theme of THEMES){
  await page.locator(`[data-theme-choice="${theme}"]`).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  expect(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),theme).toBe(dark);
  primaries.add(await token(page,'--kptu-primary'));
  expect(await lowContrast(page),theme).toEqual([]);
 }
 expect(primaries.size).toBe(THEMES.length);
 await page.keyboard.press('Escape');
 // 테마는 화면 색 창에서 고른다(사용자가 고르는 그 경로).
 for(const theme of THEMES.slice(1)){
  await page.locator('#mobileMenuTab').click();await page.locator('#mobileMenu [data-theme-open]').click();
  await page.locator(`[data-theme-choice="${theme}"]`).click();await expect(page.locator('html')).toHaveAttribute('data-theme',theme);
  await page.keyboard.press('Escape');await expect(page.locator('#themeModal')).toBeHidden();
  for(const name of ['home','projects','meetings']){await view(page,name);expect(await lowContrast(page),theme+' '+name).toEqual([]);}
 }
 expect(errors).toEqual([]);
});

test('밝은 설정은 그대로 밝고, 칸막이(HWP 편집기·성명·게시판 본문) 바탕은 다크에서도 밝다',async({page})=>{
 const light=await boot(page,390);
 expect(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor)).toBe('rgb(243, 241, 234)');
 expect(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme)).not.toContain('dark');
 await page.emulateMedia({colorScheme:'dark'});
 expect(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor)).toBe('rgb(22, 22, 19)');
 const paper='rgb(255, 255, 255)';
 await view(page,'hwp');expect((await look(page.locator('#hwpLabEditor'))).bg).toBe(paper);
 for(const id of ['#web1BoardDetailFrame'])expect(await page.locator(id).evaluate(el=>[getComputedStyle(el).backgroundColor,getComputedStyle(el).colorScheme])).toEqual([paper,'light']);
 expect(light.errors).toEqual([]);
});

for(const width of [390,1280])test('남은 화면: HWP 편집 바깥 틀·게시판 '+width,async({page})=>{
 const {errors}=await boot(page,width);
 const primary=await token(page,'--kptu-primary');
 // HWP 편집: PC는 상자 0.5px·12px, 버튼 한 높이·[내 기기에 저장] 하나만 채운 버튼, 칸막이 바깥 틀 0.5px·8px.
 // HWP-화면가득: 폰은 화면 가득(모서리 0)이고 위 얇은 줄의 [파일 ▾]·[저장 ▾]만 버튼(채운 버튼 없음). 겹친 제목·안내문은 없다.
 await view(page,'hwp');
 const hwp=page.locator('#hwpView');
 expect(await sameButtons(page,hwp)).toEqual(width<1024?[]:['내 기기에 저장']);
 const card=await look(hwp.locator('.hwp-lab'));expect(card.radius).toBe(width<1024?'0px':'12px');expect(card.shadow).toBe('none');
 await expect(hwp.locator('h2,.hwp-lab-note')).toHaveCount(0);
 expect((await look(hwp.locator('#hwpLabEditor'))).radius).toBe(width<1024?'0px':'8px');
 // 게시판: 한 상자 안 줄(44px)·이름 13px/400·오른쪽 ›, 카드 그림자·떠오름 없음.
 await view(page,'pages');await openLegacyBoard(page);
 const board=page.locator('#web1BoardActive');await expect(board.locator('.w1b-card').first()).toBeVisible();
 const box=await look(board);expect(box.radius).toBe('12px');expect(box.shadow).toBe('none');expect(box.borderStyle).toBe('solid');
 for(const row of await board.locator('.w1b-card').all()){const s=await look(row);expect(s.height).toBeGreaterThanOrEqual(44);expect(s.radius).toBe('0px');expect(s.shadow).toBe('none');}
 const name=await look(board.locator('.w1b-card h3').first());expect([name.fontSize,name.fontWeight]).toEqual(['13px','400']);
 expect(await board.locator('.w1b-card').first().evaluate(el=>getComputedStyle(el,'::after').content)).toBe('"›" / ""');
 await expect(board.locator('.w1b-card').first()).toHaveAccessibleName(/^[^›]+$/);
 await board.locator('.w1b-card').first().click();
 const detail=page.locator('#web1BoardDetailModal');await expect(detail).toBeVisible();
 expect(await sameButtons(page,detail)).toEqual([]);
 await page.keyboard.press('Escape');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});

test('공용 셸(폰): 머리줄 18px/500, 하단 탭 0.5px 선, ☰ 메뉴 판은 메뉴 줄(44px·13px/400), 화면 색 창은 상자 안 줄',async({page})=>{
 const {errors}=await boot(page,390);
 await view(page,'projects');
 const header=await look(page.locator('[data-mobile-view-name]'));expect([header.fontSize,header.fontWeight]).toEqual(['18px','500']);
 const current=await look(page.locator('.mobile-tabs [aria-current="page"]'));expect(current.fontWeight).toBe('500');
 await page.locator('#mobileMenuTab').click();await expect(page.locator('#mobileMenu')).toBeVisible();
 // Measure after the sheet's slide-up (ds-sheet-up): mid-slide the transformed boxes read 44±0.00006px.
 await page.locator('#appView .mobile-menu-panel').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));
 // UI-디자인손질 4: 폰 메뉴 판은 손잡이(제목 대신)·큰 칸(13px·400, 모서리 12px)·계정 줄(44px·13px·400).
 await expect(page.locator('.mobile-menu-head b')).toBeHidden();await expect(page.locator('#mobileMenu [data-mobile-menu-close]')).toBeVisible();
 for(const item of await page.locator('#mobileMenu nav button:visible').all()){
  const s=await look(item);expect(s.height).toBeGreaterThanOrEqual(44);expect([s.fontSize,s.radius]).toEqual(['13px','12px']);expect(['400','500']).toContain(s.fontWeight);
 }
 for(const item of await page.locator('#mobileAccountGroup button:visible').all()){
  const s=await look(item);expect(s.height).toBeCloseTo(44,2);expect([s.fontSize,s.fontWeight]).toEqual(['13px','400']);
 }
 const account=await look(page.locator('.mobile-menu-panel h2'));expect([account.fontSize,account.fontWeight,account.fg]).toEqual(['13px','500',await token(page,'--ds-section-ink')]);
 await page.locator('#mobileMenu [data-theme-open]').click();
 const theme=page.locator('#themeModal');await expect(theme).toBeVisible();
 const title=await look(theme.locator('#themeTitle'));expect([title.fontSize,title.fontWeight]).toEqual(['18px','500']);
 const choices=await look(theme.locator('.theme-choices'));expect(choices.radius).toBe('12px');
 for(const choice of await theme.locator('.theme-choices button').all()){const s=await look(choice);expect(s.height).toBe(44);expect([s.fontSize,s.fontWeight]).toEqual(['13px','400']);}
 const picked=await look(theme.locator('.theme-choices [aria-pressed="true"]'));
 expect(picked.bg).toBe(await token(page,'--ds-kind-other-soft'));
 expect(await sameButtons(page,theme.locator('.modal-head'))).toEqual([]);
 expect(errors).toEqual([]);
});

test('공용 셸(PC): 사이드바 0.5px 상자·그림자 없음, 메뉴 13px(고른 화면만 500), 계정 메뉴 줄 13px/400',async({page})=>{
 const {errors}=await boot(page,1280);
 const nav=page.locator('#appView > .app-nav');
 const s=await look(nav);expect(s.radius).toBe('12px');expect(s.shadow).toBe('none');
 for(const item of await nav.locator('.nav-btn:visible').all()){
  const v=await look(item),active=await item.evaluate(el=>el.classList.contains('active'));
  expect(v.fontSize).toBe('13px');expect(v.fontWeight).toBe(active?'500':'400');
  if(active){expect(v.bg).toBe(await token(page,'--kptu-primary-soft'));expect(v.fg).toBe(await token(page,'--kptu-primary-ink'));}
 }
 await page.locator('#appView>.app-topline [data-account-open]').click();
 const panel=page.locator('#sidebarAccountPanel');await expect(panel).toBeVisible();
 for(const item of await panel.locator('.account-action:visible').all()){const v=await look(item);expect(v.height).toBeGreaterThanOrEqual(44);expect([v.fontSize,v.fontWeight]).toEqual(['13px','400']);}
 expect((await look(panel.locator('[data-kptu-logout]'))).fg).toBe(await token(page,'--kptu-danger'));
 expect(errors).toEqual([]);
});

for(const width of [390,1280])test('공용 창: 제목 18px/500, 버튼 한 높이·채운 버튼 하나, 입력칸 28px·8px, 라벨 500, 프로젝트 상세 위계·⋯·접기 그대로 '+width,async({page})=>{
 const {errors}=await boot(page,width);
 const titleOf=async modal=>{const t=await look(modal.locator('.modal-head h2').first());expect([t.fontSize,t.fontWeight]).toEqual(['18px','500']);};
 const labels=async modal=>{for(const label of await modal.locator('label:visible').all())expect((await look(label)).fontWeight).toBe('500');};
 // 할 일 편집
 await view(page,'tasks');await expect(page.locator('#gtTaskSection')).toBeVisible();await page.waitForFunction(()=>window.KPTUGoogleTasks?.openEditor);await page.evaluate(()=>window.KPTUGoogleTasks.openEditor());
 let modal=page.locator('#gtTaskModal');await expect(modal).toBeVisible();
 await titleOf(modal);expect(await sameButtons(page,modal)).toEqual(['저장']);await inputs(modal);await labels(modal);
 const card=await look(modal.locator('.modal-card'));expect(card.radius).toBe('12px');expect(card.shadow).toBe('none');
 await page.keyboard.press('Escape');await expect(modal).toBeHidden();
 // 일정 창: [일정 | 할 일]은 같은 버튼, 고른 쪽은 [일정]·[할 일] 모두 회색(UI-선택표시통일).
 await view(page,'calendar');await page.locator('#newEventBtn').click();
 modal=page.locator('#eventModal');await expect(modal).toBeVisible();
 await titleOf(modal);await inputs(modal);await labels(modal);
 expect(await sameButtons(page,modal,'.icon-btn,.calendar-color-swatch,[role="radio"]')).toEqual(['저장']);
 expect((await look(modal.locator('[data-event-mode="event"]'))).bg).toBe(await token(page,'--ds-select-bg'));
 await page.keyboard.press('Escape');await expect(modal).toBeHidden();
 // 자료 등록
 await view(page,'library');await page.locator('#newDocumentBtn').click();
 modal=page.locator('#documentModal');await expect(modal).toBeVisible();
 await titleOf(modal);await inputs(modal);await labels(modal);expect((await sameButtons(page,modal)).length).toBeLessThanOrEqual(1);
 await page.keyboard.press('Escape');await expect(modal).toBeHidden();
 // 회의 상세: 제목 줄 ⋯ 하나에 [수정]·[칸 바꾸기]·[삭제]가 있고 큰 버튼 줄은 없다(MTG-보고창정리).
 await view(page,'meetings');await openFirstMeetingResult(page);
 modal=page.locator('#meetingRoundDetailModal');await expect(modal).toBeVisible();
 await expect(modal.locator('#mrdEdit,#mrdKind,#mrdDelete')).toHaveCount(0);await modal.locator('#mrdMore').click();const del=modal.locator('#mrdMoreMenu [data-mrd-more="delete"]');await expect(del).toBeVisible();await expect(modal.locator('#mrdMoreMenu button')).toHaveText(['수정','칸 바꾸기','성명 초안 만들기','삭제']);await page.keyboard.press('Escape');await expect(del).toBeHidden();
 // PC는 세 번째 칸에 붙은 화면이라 닫을 창이 없다(Esc는 메뉴만 닫는다). 폰·중간 폭만 창이 닫힌다.
 if(!(await modal.evaluate(m=>m.dataset.mrdDocked==='1'))){await page.keyboard.press('Escape');await expect(modal).toBeHidden()}
 // 프로젝트 상세: 제목 18px, 위계(상위 링크는 제목 위)·⋯ 메뉴·접기(<details>)는 그대로.
 await view(page,'projects');await page.locator('[data-ps3-project="p1a"]').first().click();
 modal=page.locator('#ps3DetailModal');await expect(modal).toBeVisible();
 // UI-중복제목삭제: PC 오른쪽 칸(붙인 상세)은 상단 줄이 이름을 보이므로 제목 줄이 없다 - 창일 때만 제목 18px을 본다.
 const dockedNow=await modal.evaluate(m=>m.dataset.ps3Docked==='1');
 if(dockedNow)await expect(modal.locator('#ps3Title')).toHaveCount(0);else{const t=await look(modal.locator('#ps3Title'));expect([t.fontSize,t.fontWeight]).toEqual(['18px','500'])}
 const parent=modal.locator('.ps3-parent-link');await expect(parent).toBeVisible();
 expect((await parent.boundingBox()).y).toBeLessThan((await modal.locator(dockedNow?'#ps3Summary':'#ps3Title').boundingBox()).y);
 expect(await modal.locator('details.ps3-more,details[data-ps3-more],.ps3-head-actions details').count()).toBeGreaterThan(0);
 expect(errors).toEqual([]);
});

test('일정 [Google Calendar] 설정 칸 버튼도 같은 기준(옛 !important 크기 정리)',async({page})=>{
 const {errors}=await boot(page,1280);
 await view(page,'calendar');
 await page.locator('.calendar-google-panel').evaluate(el=>el.open=true);
 const button=await look(page.locator('#googleConnectBtn'));
 expect([button.height,button.fontSize,button.fontWeight,button.radius]).toEqual([32,'13px','500','8px']);/* UI-버튼전수조사: 설정 칸 [연결]은 보조 32px */
 expect(await page.locator('#calendarCompactStyle').evaluate(el=>/#googleConnectBtn\{[^}]*!important/.test(el.textContent))).toBe(false);
 expect(errors).toEqual([]);
});

test('동그란 [+]: 선으로 그린 + 가 원의 가로·세로 정가운데(한국어 로케일, 밝은·어두운 화면, 네 화면)',async({page})=>{
 const {errors}=await boot(page,390);
 for(const [name,id] of [['calendar','#newEventBtn'],['projects','#newProjectBtn'],['library','#newDocumentBtn']]){
  await view(page,name);const button=page.locator(id);await expect(button).toBeVisible();
  for(const scheme of ['light','dark']){
   await page.emulateMedia({colorScheme:scheme});await page.waitForTimeout(100);
   const shot=await button.screenshot();
   const c=await page.evaluate(async data=>{const img=new Image();img.src='data:image/png;base64,'+data;await img.decode();const cv=document.createElement('canvas');cv.width=img.width;cv.height=img.height;const g=cv.getContext('2d');g.drawImage(img,0,0);const d=g.getImageData(0,0,cv.width,cv.height).data;
    const cx=cv.width/2,cy=cv.height/2,at=(x,y)=>{const k=(y*cv.width+x)*4;return [d[k],d[k+1],d[k+2]];},bg=at(Math.round(cx),4);
    let x0=1e9,y0=1e9,x1=-1,y1=-1;for(let y=0;y<cv.height;y++)for(let x=0;x<cv.width;x++){if(Math.hypot(x+0.5-cx,y+0.5-cy)>cv.width/2-5)continue;const p=at(x,y);if(Math.abs(p[0]-bg[0])+Math.abs(p[1]-bg[1])+Math.abs(p[2]-bg[2])>150){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}}
    return {dx:(x0+x1+1)/2-cx,dy:(y0+y1+1)/2-cy,w:x1-x0+1,h:y1-y0+1};},shot.toString('base64'));
   expect(Math.abs(c.dx),name+' '+scheme+' 가로').toBeLessThanOrEqual(1);expect(Math.abs(c.dy),name+' '+scheme+' 세로').toBeLessThanOrEqual(1);expect(c.w).toBeGreaterThan(10);expect(c.h).toBeGreaterThan(10);
  }
  await page.emulateMedia({colorScheme:'light'});
 }
 expect(errors).toEqual([]);
});
