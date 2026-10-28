import {test,expect} from '@playwright/test';
import {expandLibraryTree} from './helpers/library-tree.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {enterLogin} from './helpers/login-entry.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {showAllReportWeeks} from './helpers/report-week.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
// UI-디자인기준 3/3 1부(8-9e-1): 담당조직·자료실·회의를 새 기준(버튼 높이 하나·버튼 4종·모서리 8px·13px/500·0.5px 상자 안 줄 단위)으로,
// 목록 줄 이름 13px·400(프로젝트 메인만 500)·보조 줄 12px 흐린 색, 담당조직 마지막 기록 점·보조 줄, 프로젝트 목록 오른쪽 D-day 하나,
// 자료실 종류 색(확장자, 없으면 Drive 파일 종류), 바구니 [분류 결과 입력] 칸 제목.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'ds3-user',email:'ds3@example.org',user_metadata:{display_name:'디자인'}};
const ws={id:'ds3-ws',slug:'ds3',name:'웹2'};
const now=new Date('2026-10-16T03:00:00Z');
const ago=days=>new Date(now.getTime()-days*86400000).toISOString();
const orgs=[['o1','전국철도노동조합'],['o2','서울교통공사노동조합'],['o3','부산지하철노동조합'],['o4','대구교통공사노동조합'],['o5','서해선지부'],['o6','신분당선지부']].map(([id,name])=>({id,name,active:true,created_by:user.id,workspace_id:ws.id}));
// KST days: o2 today, o1 7 days (green edge), o6 8 days (orange edge), o3 20 days (orange edge), o4 21 days (red edge), o5 none (red).
const updates=[['o1',7],['o2',0],['o3',20],['o4',21],['o6',8]].map(([organization_id,days])=>({organization_id,occurred_at:ago(days)}));
const meta={project_system:'v2',management_version:2};
const spaces=[['p1','2026 임금교섭',null],['p1a','실무교섭','p1'],['p2','안전인력 충원 요구',null]].map(([id,name,parent_id],i)=>({id,name,parent_id,status:'active',workspace_id:ws.id,owner_id:user.id,created_by:user.id,sort_order:i,metadata:meta}));
const docs=[['d1','요구안','요구안.pdf',null],['d2','개정안','개정안.hwpx',null],['d3','인력표','인력.xlsx',null],['d4','안내문','안내.docx',null],['d5','발표','발표.pptx',null],['d6','Drive 문서','정책 메모','application/vnd.google-apps.document'],['d7','Drive 시트','집계','application/vnd.google-apps.spreadsheet'],['d8','PDF 사본','스캔','application/pdf'],['d9','사진','현장.jpg','image/jpeg']]
 .map(([id,title,file_name,mime_type],i)=>({id,title,file_name,mime_type,workspace_id:ws.id,created_by:user.id,category:'교섭',document_date:`2026-10-${String(15-i).padStart(2,'0')}`,file_id:'f'+id,project_id:null}));
const meetings=[['m1','중앙쟁의대책위원회',3,'2026-10-14T10:00:00'],['m2','정책위원회',5,'2026-10-10T14:00:00']].map(([id,meeting_name,round_no,meeting_at])=>({id,workspace_id:ws.id,title:meeting_name,meeting_name,round_no,meeting_at}));
const note={id:'10000000-0000-4000-8000-000000000002',workspace_id:ws.id,occurred_at:ago(0),updated_at:ago(0),created_at:ago(0),raw_text:'10/20 기자회견 자료',ai_export_allowed:true,archived_at:null,attachments:[],metadata:{}};

async function boot(page,width){
 await page.setViewportSize({width,height:width<761?844:900});
 await page.clock.setFixedTime(now);
 const calls={updates:0,spaces:[]},errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route(`${SB}/**`,route=>{
  const url=new URL(route.request().url()),path=url.pathname,q=url.searchParams;
  const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
  if(path==='/auth/v1/token')return ok({access_token:'a',refresh_token:'r',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
  if(path==='/auth/v1/user')return ok(user);
  if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
  if(path==='/functions/v1/google-tasks')return ok({connected:true,authorized:true,pending_scope:'all',tasks:[]});
  if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
  if(path.startsWith('/functions/v1/'))return ok({});
  if(path.startsWith('/rest/v1/rpc/'))return ok(null);
  if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:ws.id,user_id:user.id,role:'owner',email:user.email}]);
  if(path==='/rest/v1/app_workspaces')return ok([ws]);
  if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'디자인'}]);
  if(path==='/rest/v1/app_meetings')return ok(meetings);
  if(path==='/rest/v1/app_suborganizations')return ok(orgs);
  if(path==='/rest/v1/app_suborganization_assignees')return ok(orgs.map(o=>({organization_id:o.id,user_id:user.id})));
  if(path==='/rest/v1/app_suborganization_updates'){if(q.get('select')==='organization_id,occurred_at')calls.updates++;return ok(updates);}
  if(path==='/rest/v1/app_documents')return ok(docs);
  if(path==='/rest/v1/app_spaces'){const select=q.get('select')||'';if(select.includes('milestones:')){calls.spaces.push(select);return ok([{id:'p1',milestones:[{start_at:'2026-10-18T01:00:00Z'}]},{id:'p1a',milestones:[]},{id:'p2',milestones:[{start_at:'2026-10-26T01:00:00Z'}]}]);}return ok(spaces);}
  // UI-PC프로젝트좌우: PC opens the first project in the pane, whose own detail read (same dates as the list read) also paints its D-day.
  if(path==='/rest/v1/app_project_milestones'){const id=(q.get('project_id')||'').slice(3),at={p1:'2026-10-18T01:00:00Z',p2:'2026-10-26T01:00:00Z'}[id];return ok(at?[{id:'ms-'+id,project_id:id,title:'합성 일정',start_at:at,status:'planned'}]:[]);}
  if(path==='/rest/v1/app_notes'){if(q.get('metadata'))return ok([]);return ok([note].slice(Number(q.get('offset')||0)));}
  if(path.startsWith('/rest/v1/'))return ok([]);
  return ok({});
 });
 await page.goto(testOrigin+'/app/');await enterLogin(page);
 await signInWithSession(page,user.email);
 await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
 return {calls,errors};
}
async function view(page,name){await clickView(page,name);await expect.poll(()=>page.evaluate(n=>window.KPTUViewLoader.isLoaded(n),name)).toBe(true);}
const look=locator=>locator.evaluate(el=>{const b=el.getBoundingClientRect(),s=getComputedStyle(el);return {height:b.height,fontSize:s.fontSize,fontWeight:s.fontWeight,radius:s.borderRadius,bg:s.backgroundColor,fg:s.color,border:s.borderTopColor,borderWidth:s.borderTopWidth,shadow:s.boxShadow};});
// The 0.5px line (--ds-line-width) as this screen computes it (Chromium shows a 1px device line at scale 1).
const lineWidth=page=>page.evaluate(()=>{const e=document.createElement('div');e.style.borderTop='var(--ds-line-width) solid';document.querySelector('#appView').append(e);const w=getComputedStyle(e).borderTopWidth;e.remove();return w;});
const token=(page,name)=>page.evaluate(name=>{const e=document.createElement('span');e.style.color=`var(${name})`;document.querySelector('#appView').append(e);const c=getComputedStyle(e).color;e.remove();return c;},name);
// Every visible button-shaped control in a region: one height, 13px, 500, 8px corners, no shadow (UI-버튼크기: filter chips·[분류 수정] 32px). Returns the filled ones.
async function sameButtons(page,region){
 const primary=await token(page,'--kptu-primary'),filled=[];
 for(const control of await region.locator('button:visible').all()){
  // 8-9e-2: on phones the add button is the floating round [+] and 담당조직 추가 is a small text link (ui-standard-3b).
  // ORG-PC좌우: the organization detail on the right of the PC 담당조직 screen keeps the detail's own buttons (as in its dialog).
  // REF-참고묶음 화면 2: the 참고 묶음 › entry at the bottom of the organization list is a list row (44px, no box), not a button.
  if(await control.evaluate(el=>el.matches('.icon-btn,.kptu-list-row,.so-reference-entry,[data-ps3-project]')||!!el.closest('#wdDetailPane')||innerWidth<761&&el.matches('#newDocumentBtn,#newMeetingBtn,.so-add-link')))continue;
  const s=await look(control),label=(await control.textContent()).trim();
  // UI-버튼크기: 필터 칩(자료실·회의)은 32px 알약, 보조 버튼([분류 수정])은 32px. 둘 다 누르는 범위 44px. 나머지는 46px·8px.
  // LIB-토글트리: [모두 펴기/접기]·[N건 더]는 안내 줄 안의 작은 글자 버튼(28px, 테두리 없음, 누르는 범위 44px, UI-버튼기준).
  if(await control.evaluate(el=>el.matches('.lu-expand-all,.lu-more-files,.lu-select-btn,.lu-select-act'))){expect(s.height,label).toBe(28);expect(s.borderWidth,label).toBe('0px');expect(await control.evaluate(el=>parseFloat(getComputedStyle(el,'::after').height)),label).toBe(44);expect(s.shadow,label).toBe('none');continue}
  const kind=await control.evaluate(el=>el.matches('.filter-chips button')?'chip':el.matches('#manageLibraryBtn')?'compact':'button');
  // UI-PC버튼36: PC(≥1024) 목록 머리 추가 버튼은 입력칸 높이(36px), 누르는 범위 44px.
  // UI-버튼전수조사(2026-10-24): 채운 버튼(주 동작·목록 머리 추가)은 36px, 나머지 버튼은 작은 버튼 32px. 둘 다 누르는 범위 44px.
  if(kind==='button'){const pcAdd=await control.evaluate(el=>innerWidth>=1024&&el.matches('#newDocumentBtn,#newMeetingBtn,#newProjectBtn'));const want=await control.evaluate(el=>el.matches('.primary')?36:32);expect(s.height,label).toBe(want);expect(s.radius,label).toBe('8px');if(pcAdd)expect(await control.evaluate(el=>parseFloat(getComputedStyle(el,'::after').minHeight)),label).toBe(44);}
  else{expect(s.height,label).toBe(32);expect(s.radius,label).toBe(kind==='chip'?'999px':'8px');expect(await control.evaluate(el=>parseFloat(getComputedStyle(el,'::after').height)),label).toBe(44);}
  expect(s.fontSize,label).toBe('13px');expect(s.fontWeight,label).toBe('500');expect(s.shadow,label).toBe('none');
  // UI-테마선택색: 고른 전환·필터 쪽은 일부러 주 버튼 색이라 채운 버튼 수에서 뺀다.
  if(s.bg===primary&&!await control.evaluate(el=>el.matches('[aria-pressed="true"],[aria-checked="true"],.active')))filled.push(label);
 }
 return filled;
}
async function rowText(page,locator,{weight='400'}={}){
 for(const el of await locator.all()){const s=await look(el);expect(s.fontSize).toBe('13px');expect(s.fontWeight).toBe(weight);}
}
async function metaText(page,locator){
 const muted=await token(page,'--kptu-muted');
 for(const el of await locator.all()){const s=await look(el);expect(s.fontSize).toBe('12px');expect(s.fg).toBe(muted);}
}
const noOverflow=page=>expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);

for(const width of [390,1280])test(`담당조직: 이름 한 줄·마지막 기록 점·묶음 제목·새 버튼 ${width}`,async({page})=>{
 const {calls,errors}=await boot(page,width);
 await view(page,'team');
 const list=page.locator('#soOrganizationList');
 await expect(list.locator('.so-card')).toHaveCount(6);
 // 묶음 제목: 이름(테마 색 12px) + 오른쪽 "N곳".
 await expect(list.locator('.so-group-heading').first().locator('span')).toHaveText(['철도','1곳']);
 await expect(list.locator('.so-group-heading').nth(1).locator('span')).toHaveText(['지하철','3곳']);
 const heading=await look(list.locator('.so-group-heading').first());
 expect(heading.fontSize).toBe('12px');expect(heading.fg).toBe(await token(page,'--kptu-primary-ink'));
 // 점 색(한국 시간 날짜 기준). 보조 줄은 없고(2026-10-16 사용자 결정), 같은 말은 줄의 화면 낭독 이름에 들어간다.
 const expectRow=async(id,text,level)=>{const row=list.locator(`[data-so-org="${id}"]`);await expect(row.locator('[data-so-dot]')).toHaveAttribute('data-so-recency',level);await expect(row).toHaveAttribute('aria-label',new RegExp(`, ${text}, 상세 열기$`));return row};
 await expectRow('o2','오늘 기록','fresh');await expectRow('o1','7일 전 기록','fresh');await expectRow('o6','8일 전 기록','warn');
 await expectRow('o3','20일 전 기록','warn');await expectRow('o4','21일 전 기록','stale');await expectRow('o5','기록 없음','stale');
 const colors={fresh:await token(page,'--ds-recency-fresh'),warn:await token(page,'--ds-recency-warn'),stale:await token(page,'--ds-recency-stale')};
 for(const [id,level] of [['o2','fresh'],['o6','warn'],['o5','stale']]){const dot=await look(list.locator(`[data-so-org="${id}"] [data-so-dot]`));expect(dot.bg).toBe(colors[level]);expect(dot.radius).toBe('50%');}
 const dotBox=await list.locator('[data-so-org="o1"] [data-so-dot]').boundingBox(),nameBox=await list.locator('[data-so-org="o1"] .kptu-list-name').boundingBox();
 expect(dotBox.width).toBe(8);expect(dotBox.height).toBe(8);expect(dotBox.x+dotBox.width).toBeLessThan(nameBox.x);
 // 이름 한 줄만: 날짜·보조 줄·할 일 수 없음, 오른쪽은 › 만. 이름 13px·400, 줄 44px, 상자 0.5px.
 await expect(list.locator('time,.so-sub,.so-task-count,[data-so-summary]')).toHaveCount(0);
 await expect(list.locator('[data-so-org="o1"] .kptu-list-row-main > *')).toHaveCount(3);
 await rowText(page,list.locator('.kptu-list-name'));
 for(const row of await list.locator('.so-card').all())expect((await row.boundingBox()).height).toBe(44);
 const card=await look(list.locator('.so-group-card').first());expect(card.borderWidth).toBe(await lineWidth(page));expect(card.radius).toBe('12px');expect(card.shadow).toBe('none');
 // 날짜는 기존 묶음 읽기 한 번(조직별 요청 없음). ORG-PC좌우: PC는 오른쪽 칸에 첫 조직 상세를 열고, 그 상세 기록 읽기는 따로 센다.
 expect(calls.updates).toBe(1);
 expect(await sameButtons(page,page.locator('#teamView'))).toEqual([]);
 await noOverflow(page);
 // 키보드로 상세 열기는 그대로.
 await list.locator('[data-so-org="o1"]').focus();await page.keyboard.press('Enter');await expect(page.locator('#wdModal')).toBeVisible();await expect(page.locator('#wdTitle')).toHaveText(orgs.find(o=>o.id==='o1').name);
 expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`자료실: 종류 색(확장자, 없으면 Drive 파일 종류)·목록 글자·필터·버튼 ${width}`,async({page})=>{
 const {errors}=await boot(page,width);
 await view(page,'library');
 const rows=page.locator('#documentList .lu-row');await expect(rows).toHaveCount(9);
 // LIB-토글트리: 줄을 보는 시험이라 토글을 모두 편다.
 await expandLibraryTree(page);
 const kinds=rows.locator('.lu-file-kind');
 await expect(kinds).toHaveText(['PDF','HWP','XLS','DOC','PPT','DOC','XLS','PDF','그림']);
 const expected=['pdf','hwp','xls','doc','ppt','doc','xls','pdf','img'];
 for(const [i,kind] of expected.entries()){
  await expect(kinds.nth(i)).toHaveAttribute('data-lu-kind',kind);
  const s=await look(kinds.nth(i)),name=kind==='other'?'--ds-kind-other':'--ds-file-'+kind;
  // UI-PC자료실 M2: 폰(760px 이하)은 종류를 상자 없이 색 글자로 이름 아래 작은 줄에 보인다. PC는 연한 바탕 + 진한 글자 상자.
  expect(s.bg,kind).toBe(width<761?'rgba(0, 0, 0, 0)':await token(page,name+'-soft'));expect(s.fg,kind).toBe(await token(page,name+'-ink'));
 }
 // 다섯 종류와 그림(LIB-그림형식)과 회색은 서로 다른 색.
 expect(new Set(await Promise.all(['pdf','hwp','xls','doc','ppt','img'].map(k=>token(page,'--ds-file-'+k+'-ink')).concat([token(page,'--ds-kind-other-ink')]))).size).toBe(7);
 await rowText(page,rows.locator('.lu-row-title'));await metaText(page,rows.locator('.lu-row-date'));
 // LIB-목록간격(2026-10-23): PC 자료 줄은 위아래 여백이 절반이라 한 줄 높이(27px 이상)이고, 폰은 두 줄이라 44px 이상.
 for(const row of await rows.all())expect((await row.boundingBox()).height).toBeGreaterThanOrEqual(width<761?44:27);
 const box=await look(page.locator('#libraryListCard'));expect(box.borderWidth).toBe(await lineWidth(page));expect(box.radius).toBe('12px');
 expect((await look(rows.nth(1))).borderWidth).toBe(await lineWidth(page));
 // 버튼·필터: 한 높이, 채운 버튼은 [+ 자료] 하나, 고른 필터는 테마 주 색(UI-선택표시통일).
 expect(await sameButtons(page,page.locator('#libraryView'))).toEqual(width<761?[]:['+ 자료 등록']);
 const selected=await look(page.locator('#libraryCategoryFilter [aria-pressed="true"]').first());
 expect(selected.bg).toBe(await token(page,'--ds-select-bg'));expect(selected.fg).toBe(await token(page,'--ds-select-ink'));
 const search=await look(page.locator('#documentSearch'));expect(search.height).toBe(46);expect(search.radius).toBe('8px');expect(search.borderWidth).toBe(await lineWidth(page));expect(search.border).toBe(await token(page,'--ds-line'));
 await noOverflow(page);
 expect(errors).toEqual([]);
});

// UI-PC회의: 줄 단위 목록은 1024 미만. PC 열 배치는 meeting-columns.spec.mjs.
for(const width of [390,1000])test(`회의: 줄 단위 목록·색 점 없음·필터·버튼 ${width}`,async({page})=>{
 const {errors}=await boot(page,width);
 await view(page,'meetings');
 // MTG-프로젝트합치기 3단계: 두 보고가 다른 주(10.14·10.10, 시계 10.16)라 [전체]로 모든 주를 본다. 주 줄의 작은 버튼도 아래 버튼 기준 검사에 든다.
 await showAllReportWeeks(page);
 const rows=page.locator('#meetingList .meeting-list-row');await expect(rows).toHaveCount(2);
 await rowText(page,rows.locator('h3'));await metaText(page,rows.locator('p'));
 for(const row of await rows.all()){const s=await look(row);expect(s.height).toBeGreaterThanOrEqual(44);expect(s.radius).toBe('0px');}
 expect((await look(rows.nth(1))).borderWidth).toBe(await lineWidth(page));
 // UI-화면폭넘침: 줄 앞 색 점은 없다(색은 필터 칩 점만).
 expect(await rows.first().locator('.meeting-list-title').evaluate(el=>getComputedStyle(el,'::before').content)).toBe('none');
 const box=await look(page.locator('#meetingsListCard'));expect(box.borderWidth).toBe(await lineWidth(page));expect(box.radius).toBe('12px');
 // UI-선택표시통일: 폰의 [+ 회의]는 동그란 [+](버튼 모양 검사 밖), PC는 채운 버튼 하나.
 expect(await sameButtons(page,page.locator('#meetingsView'))).toEqual(width<761?[]:['+ 사업 보고']);
 // 필터 고르기는 그대로 동작.
 await page.locator('#meetingTypeFilter [data-filter-value="정책위원회"]').click();
 await expect(rows).toHaveCount(1);await expect(rows.first().locator('h3')).toHaveText('정책위원회');
 await noOverflow(page);
 expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`프로젝트 목록 오른쪽은 D-day 하나·목록 글자 통일·정리함 칸 제목 ${width}`,async({page})=>{
 const {calls,errors}=await boot(page,width);
 await view(page,'projects');
 const list=page.locator('#projectGrid .ps3-plist');
 await expect(list.locator('[data-ps3-project="p1"] .ps3-prow-meta')).toHaveText('D-2');
 await expect(list.locator('[data-ps3-project="p1a"] .ps3-prow-meta')).toHaveText('');
 await expect(list.locator('[data-ps3-project="p2"] .ps3-prow-meta')).toHaveText('D-10');
 // 밀린 할 일 수(✓n)·마지막 기록 날짜는 목록에서 뺐다. 목록은 주요 일정만 한 번 읽는다.
 await expect(list.locator('.kptu-list-task-count,.ps3-prow-meta time')).toHaveCount(0);
 for(const meta of await list.locator('.ps3-prow-meta').all())expect(await meta.locator(':scope > *').count()).toBeLessThanOrEqual(1);
 expect(calls.spaces).toEqual(['id,milestones:app_project_milestones!project_id(start_at),progress:app_project_progress_updates!project_id(effective_on)']);
 // 메인 500, 하위 400, 모두 13px.
 await rowText(page,list.locator('.ps3-prow-main .kptu-list-name'),{weight:'500'});
 await rowText(page,list.locator('.ps3-kid-row .kptu-list-name'));
 // 바구니 목록 이름도 13px·400, 보조 줄 12px. [분류 요청] 뒤에 열리는 칸 이름은 [분류 결과 입력].
 await view(page,'basket');
 const basket=page.locator('#basketView');await expect(basket.locator('[data-basket-row]')).toHaveCount(1);
 await rowText(page,basket.locator('.basket-row .basket-title'));
 for(const meta of await basket.locator('.basket-row time').all())expect((await look(meta)).fontSize).toBe('12px');
 // BASKET-AI메뉴삭제: [분류 결과 입력] 칸은 없다. BASKET-정리함한화면: 칸 제목은 '챙길 것'·'업데이트' 두 개.
 await expect(basket.getByRole('heading',{level:3,name:'분류 결과 입력',exact:true})).toHaveCount(0);
 await expect(basket.locator('#inboxTodoTitle')).toContainText('챙길 것');await expect(basket.locator('#inboxUpdateTitle')).toContainText('업데이트');
 expect(errors).toEqual([]);
});

test('다크 모드(3/3 3부에서 켬): 기기 설정이 어두우면 담당조직·자료실·회의도 어둡다',async({page})=>{
 await page.emulateMedia({colorScheme:'dark'});
 const {errors}=await boot(page,390);
 const dark='rgb(22, 22, 19)';
 for(const name of ['team','library','meetings']){
  await view(page,name);
  expect(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),name).toBe(dark);
  expect(await page.evaluate(()=>getComputedStyle(document.documentElement).colorScheme),name).toContain('dark');
 }
 expect(errors).toEqual([]);
});
