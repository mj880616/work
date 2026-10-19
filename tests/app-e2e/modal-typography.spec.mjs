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
// Compare retained styles on the same calendar day in both the historical device-time app and KST app.
const fixtureNow=new Date('2026-10-05T03:00:00Z');
const fixtureTaskDay=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(fixtureNow);
async function boot(page,tasks=[{id:'font-task',title:'Typography QA task',notes:'Typography QA notes',due:fixtureTaskDay(),status:'needsAction',taskListId:'@default',taskListTitle:'QA',source:'google-task'}],calendarEvents=[{id:'font-event',calendarId:'primary',title:'Typography QA event',start:fixtureTaskDay()+'T12:00:00+09:00',end:fixtureTaskDay()+'T13:00:00+09:00',color:'var(--kptu-primary)'}]){
 await page.clock.setFixedTime(fixtureNow);
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


// UI-디자인기준 2/3(8-9d): 일정·할 일·프로젝트 목록은 새 기준(ui-standard.css)으로 바뀌어 옛 main과의 전체 계산 스타일 비교에서 뺀다.
// 이 세 화면의 새 모양은 각 화면 검사(button-sizing·calendar-toolbar-one-row·project-system-v3·task-screen-cleanup 등)가 맡고,
// 대화상자 검사(audit)는 그대로 한다.
// UI-디자인기준 3/3 1부(8-9e-1): 담당조직·자료실·회의도 새 기준으로 바뀌어 같은 방식으로 뺀다. 새 모양은 ui-standard-3a 검사가 맡고,
// 아래 필터 검사는 홈 빠른 입력 탭과 비교로 되돌린다. 남은 화면(성명·게시판)은 2부에서 옮긴다.
// UI-디자인기준 3/3 3부(8-9e-3, 마지막): 성명·게시판도 새 기준으로 옮겼다. 옛 main 비교에서 뺀 화면은 이제 모두
// 새 기준과 비교한다(2/3 원장 ② 되돌림): 보이는 글자의 굵기는 400·500 두 가지, 버튼 모양 컨트롤은 높이 하나(46px)·13px(UI-버튼크기부터 필터 칩·보조 버튼은 32px).
// 일정 월간·주간 칸(#calendarGrid·#calendarWeek)과 글 본문(.md-body)은 내용 표시라 뺀다.
const DS_VIEWS=new Set(['projects','tasks','calendar','team','library','meetings','media','pages']);
const newStandard=p=>p.evaluate(()=>{
 const view=document.querySelector('.view-panel:not(.hidden)'),bad=[];
 for(const e of view.querySelectorAll('*')){
  if(!e.checkVisibility()||e.closest('#calendarGrid,#calendarWeek,.md-body,.a11y-only'))continue;
  const s=getComputedStyle(e),text=[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim());
  if(text&&!['400','500'].includes(s.fontWeight))bad.push([e.tagName,e.className,s.fontWeight].join(' '));
  if(e.matches('button.primary,button.secondary,button.mini,.filter-chips button,.w1p-filter')&&!e.matches('.icon-btn,#newEventBtn,#newTaskBtn,#newProjectBtn,#newDocumentBtn,.calendar-toolbar *')&&(innerWidth>760||!e.matches('.so-add-link,#newMeetingBtn'))){
   // UI-버튼크기: 필터 칩·보조 버튼([분류 수정])은 32px, 나머지 버튼은 46px.
   const h=Math.round(e.getBoundingClientRect().height),want=e.matches('.filter-chips button,.w1p-filter,#manageLibraryBtn')?32:46;if(h!==want||s.fontSize!=='13px')bad.push([e.tagName,e.id||e.className,h,s.fontSize].join(' '));
  }
 }
 return bad;
});
for(const width of [390,1440])test('D-3e modal roles and excluded list computed styles '+width,async({page,browser})=>{
 await page.setViewportSize({width,height:900});await boot(page);
 const original=await browser.newPage({viewport:{width,height:900}});await baseline(original,'b9dbcaee0b8e92bd8d80334bf97999f561deef94');await boot(original);
 for(const name of ['projects','meetings','media','pages','team','tasks','calendar','library']){
  for(const p of [page,original])await view(p,name);
  // Empty headings disappear; retained headings keep the established style.
  // The changed task region gets explicit D-할일화면정리 roles below.
  if(name==='tasks'){
    const style=el=>{const s=getComputedStyle(el);return [el.tagName,el.className,s.fontSize,s.color,s.fontWeight,s.lineHeight]};
    await expect(original.locator('#gt-week-head')).toBeVisible();
    // UI-디자인기준 2/3(8-9d): 기한 묶음 이름은 섹션 이름(13px·500·할 일 색 --ds-kind-task-ink).
    await expect.poll(()=>page.locator('#gt-today-head').evaluate(style)).toEqual(['H4','gt-group-head','13px','rgb(15, 110, 86)','500','20.15px']);
    await expect(page.locator('#gt-week-head')).toHaveCount(0);
    await expect(page.locator('[data-gt-count]')).toHaveText('할 일 1개');
    await expect(page.locator('[data-gt-count]')).toHaveCSS('font-size','12px');
    await expect(page.locator('#gtTaskBody .gt-main b')).toHaveCSS('font-size','13px');
    await expect(page.locator('#gtTaskBody .gt-main b')).toHaveCSS('-webkit-line-clamp','2');
    await expect(page.locator('#gtTaskBody .gt-meta')).toHaveCSS('font-size','12px');
    await expect(page.locator('#gtTaskBody .gt-meta')).toHaveCSS('color',await page.locator('[data-gt-count]').evaluate(el=>getComputedStyle(el).color));
    // UI-할일입력: no [+ 할 일]; the always-visible input's [추가] is one control height (46px·13px) on phone and PC.
    await expect(page.locator('#newTaskBtn')).toHaveCount(0);await expect(page.locator('#tasksView .home-quick [data-quick-save]')).toHaveCSS('height','46px');await expect(page.locator('#tasksView .home-quick [data-quick-save]')).toHaveCSS('font-size','13px');
    for(const selector of ['[data-gt-info]','[data-gt-menu]']){
      const box=await page.locator(selector).boundingBox();expect(box.width).toBe(44);expect(box.height).toBe(44);
    }
    await page.locator('[data-gt-info]').click();await audit(page,'gtScopeModal');await expect(page.locator('#gtScopeModal .gt-scope-note')).toHaveCSS('font-size','14px');await page.locator('[data-gt-scope-close]').click();
  }
  // UI-필터알약 replaces these list controls; compare their new roles with home below.
  // Every retained list role and the unchanged modal audits still compare in full.
  const snapshot=async p=>p.locator('#'+name+'View').evaluate(el=>[...el.querySelectorAll('*')].filter(e=>!(e.id==='gt-week-head'&&el.querySelector('#gt-today-head'))&&!e.closest('#gtTaskSection,.calendar-view-switch,#calendarTodayBtn,.cmv-task-count,[data-calendar-task],#meetingTypeFilter,label[for="meetingTypeFilter"],#documentProject,label[for="documentProject"],#libraryViewFilter')&&e.checkVisibility()&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>{const s=getComputedStyle(e);const title=e.closest('#monthTitle');if(title)return ['B','',e.id==='monthTitle'&&innerWidth<=760?'20px':s.fontSize,s.color,s.fontWeight,e.id==='monthTitle'&&innerWidth<=760?'24px':s.lineHeight];if(e.id==='prevMonthBtn'||e.id==='nextMonthBtn')return [e.tagName,e.className,'calendar-arrow','muted',s.fontWeight,'1'];return [e.tagName,e.className,s.fontSize,s.color,s.fontWeight,s.lineHeight]}));
  const expected=await snapshot(original);
  if(name==='projects'){
    // D-project-list changes exactly these retained list roles; other views and all dialog audits remain.
    const muted=await original.evaluate(()=>{const e=document.createElement('span');e.style.color='var(--kptu-muted)';document.body.append(e);const color=getComputedStyle(e).color;e.remove();return color});
    const heading=expected.findIndex(row=>row[0]==='H2');expect(heading).toBe(0);
    expected[heading]=['SPAN','muted','12px',muted,'400','18px'];
    const archive=expected.findIndex(row=>row[1]==='secondary ps3-toolbar-btn');expect(archive).toBeGreaterThan(heading);
    expected[archive]=['BUTTON','ps3-archive-link','12px',muted,'400','18.6px'];
    const nameIndex=expected.findIndex(row=>row[1]==='ps3-prow-name');expect(nameIndex).toBeGreaterThan(archive);
    expected[nameIndex]=['SPAN','ps3-prow-name kptu-list-name','16px',expected[nameIndex][3],'750','21.6px'];
    const oldZero=expected.findIndex((row,i)=>i>nameIndex&&row[0]==='SPAN'&&row[1]==='');expect(oldZero).toBeGreaterThan(nameIndex);
    expected[oldZero]=['SPAN','kptu-list-chevron','20px',muted,'400','20px'];
    await expect(page.locator('#projectGrid .add-list-head h2')).toHaveCount(0);
    await expect(page.locator('[data-ps3-total]')).toHaveText('프로젝트 1개');
    await expect(page.locator('#projectGrid .ps3-prow-meta .ps3-dday')).toHaveText('일정 없음');
  }
  if(name==='team'){
    // D-담당조직목록 intentionally replaces only the type role with a group heading above the retained name.
    const typeIndex=expected.findIndex(row=>row[1]==='sof-type');expect(typeIndex).toBeGreaterThan(0);
    expected.splice(typeIndex,1);
    const nameIndex=expected.findIndex(row=>row[0]==='H4');expect(nameIndex).toBeGreaterThan(0);
    expected[nameIndex][1]='kptu-list-name';
    const chevron=expected.findIndex(row=>row[1]==='so-chevron');expect(chevron).toBeGreaterThan(nameIndex);expected[chevron][1]='so-chevron kptu-list-chevron';
    const muted=await original.evaluate(()=>{const e=document.createElement('span');e.style.color='var(--kptu-muted)';document.body.append(e);const color=getComputedStyle(e).color;e.remove();return color});
    expected.splice(nameIndex,0,['DIV','so-group-heading','12px',muted,'400','18px']);
    await expect(page.locator('#soOrganizationList .sof-type')).toHaveCount(0);
    // UI-디자인기준 3/3: 묶음 이름 왼쪽, 오른쪽 "N곳".
    await expect(page.locator('#soOrganizationList .so-group-heading > span')).toHaveText(['그 외','1곳']);
  }
  if(!DS_VIEWS.has(name))expect(await snapshot(page),name).toEqual(expected);
  else expect(await newStandard(page),name+' new standard').toEqual([]);
  if(name==='meetings'||name==='library'){
    const groups=page.locator('#'+name+'View .filter-chips');
    // UI-바구니첨부메모 ⑪: 자료실은 프로젝트에 분류 7개 칩 줄이 더해진다. UI-바구니거르기: 자료 종류([일반 자료|회의자료만]) 줄은 없앴다.
    await expect(groups).toHaveCount(name==='meetings'?1:2);
    // The home view is hidden here, so its tabs (height:auto) are compared by their declared min-height; the filters' real height is checked too.
    const style=el=>{const s=getComputedStyle(el);return [s.fontSize,s.fontWeight,s.lineHeight,s.minHeight,s.paddingLeft,s.paddingRight,s.color,s.backgroundColor,s.borderRadius]};
    // UI-버튼크기(2026-10-17): meeting/library filters are pill chips (32px, 999px corners, 13px/500, 12px side padding),
    // no longer copies of the home quick-input tabs (those became a small segment). Unselected chips are white with ink text,
    // the selected one is gray (종류 색 '그 밖'). The touch target stays 44px through ::after.
    const tokens=await page.evaluate(()=>Object.fromEntries(['--kptu-ink','--kptu-surface','--ds-kind-other-ink','--ds-kind-other-soft'].map(n=>{const e=document.createElement('span');e.style.color=`var(${n})`;document.body.append(e);const c=getComputedStyle(e).color;e.remove();return [n,c];})));
    for(const group of await groups.all()){
      await expect(group).toHaveAttribute('role','radiogroup');
      await expect(group.locator('[role="radio"][aria-checked="true"]')).toHaveCount(1);
      for(const radio of await group.getByRole('radio').all()){
        const selected=await radio.getAttribute('aria-checked')==='true';
        const [fontSize,fontWeight,,minHeight,paddingLeft,paddingRight,color,background,radius]=await radio.evaluate(style);
        expect([fontSize,fontWeight,minHeight,paddingLeft,paddingRight,radius],name+' filter chip style').toEqual(['13px','500','32px','12px','12px','999px']);
        expect([color,background],name+' filter chip color').toEqual(selected?[tokens['--ds-kind-other-ink'],tokens['--ds-kind-other-soft']]:[tokens['--kptu-ink'],tokens['--kptu-surface']]);
        expect((await radio.boundingBox()).height,name+' filter height').toBe(32);
        expect(await radio.evaluate(el=>parseFloat(getComputedStyle(el,'::after').height)),name+' filter touch').toBe(44);
      }
    }
  }
  if(name==='calendar'){for(const id of ['prevMonthBtn','nextMonthBtn']){await expect(page.locator('#'+id)).toHaveCSS('font-size','24px');await expect(page.locator('#'+id)).toHaveCSS('line-height','24px');}}
  if(name==='calendar'&&width<=760){await expect(page.locator('#monthTitle')).toHaveCSS('font-size','18px');await expect(page.locator('#monthTitle')).toHaveCSS('line-height','24px');}

 }
 await view(page,'projects');await page.locator('#ps3ArchiveBtn').click();await audit(page,'ps3ArchiveModal');await page.locator('[data-ps3-close="ps3ArchiveModal"]').click();await page.locator('#newProjectBtn').click();await audit(page,'ps3CreateModal');await page.locator('[data-ps3-close="ps3CreateModal"]').click();await page.locator('[data-ps3-project="type-project"]').first().click();await expect(page.locator('#ps3Title')).toHaveText('Fixture project');await audit(page,'ps3DetailModal');await page.evaluate(()=>window.KPTUGoogleTasks.openLinkPicker({project_id:'type-project'}));await audit(page,'gtPickModal');await page.locator('[data-gt-pick-close]').click();await page.locator('[data-ps3-close="ps3DetailModal"]').click();
 await view(page,'meetings');await page.locator('#newMeetingBtn').click();await audit(page,'meetingModal');await page.locator('#meetingModal').evaluate(el=>el.classList.add('hidden'));
 await view(page,'team');// UI-조직추가숨김: no add button on screen, so open the same dialog through the edit delegate.
 await page.evaluate(()=>{const b=document.createElement('button');b.id='soTestOpenEdit';b.setAttribute('data-so-edit','');document.body.append(b)});await page.locator('#soTestOpenEdit').dispatchEvent('click');await audit(page,'soEditModal');await page.locator('[data-so-close="soEditModal"]').click();
 await view(page,'library');await page.locator('#newDocumentBtn').click();await audit(page,'documentModal');await page.locator('#documentModal').evaluate(el=>el.classList.add('hidden'));
 await view(page,'calendar');await page.locator('#newEventBtn').click();await audit(page,'eventModal');await page.locator('#eventModal').evaluate(el=>el.classList.add('hidden'));
 // UI-디자인기준 3/3 3부(8-9e-3): 화면 색 창 줄은 목록 줄 이름 13px.
 await expect(page.locator('.theme-choices button').first()).toHaveCSS('font-size','13px');await original.close();
});
async function audit(page,id){
 const modal=page.locator('#'+id);await expect(modal).toBeVisible();
 const small=await modal.evaluate(root=>[...root.querySelectorAll('*')].filter(e=>e.checkVisibility()&&!e.closest('button,.icon-btn,[aria-hidden="true"]')&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())&&parseFloat(getComputedStyle(e).fontSize)<12).map(e=>({tag:e.tagName,id:e.id,class:e.className,size:getComputedStyle(e).fontSize})));
 expect(small,id).toEqual([]);
 for(const input of await modal.locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]),textarea,select').all())await expect(input).toHaveCSS('font-size','14px');
 // UI-회의결과창정리: 자료 등록 창 [📎 파일 고르기]는 label이지만 보조 버튼(13px)이다.
 for(const label of await modal.locator('label:not(.secondary):not(.primary):not(.library-pick-button)').all())await expect(label).toHaveCSS('font-size','12px');
 // UI-디자인기준 3/3 3부(8-9e-3): 창 제목은 새 기준 18px(--ds-text-title).
 for(const h2 of await modal.locator('.modal-head h2,.w1b-detail-head h2').all())await expect(h2).toHaveCSS('font-size','18px');
}

const modalIds=['ps3DetailModal','ps3CreateModal','ps3WorkstreamModal','ps3ProgressModal','ps3MilestoneModal','ps3ArchiveModal','ps3DeleteModal','meetingModal','meetingRoundDetailModal','wfMeetingAiModal','wdModal','wdAffModal','wdTimeModal','soEditModal','soAssignModal','pressDetailModal','web1BoardDetailModal','documentModal','libraryEditModal','libraryManageModal','eventModal','ciGoogleModal','taskModal','gtTaskModal','gtPickModal','gtScopeModal','themeModal','warDraftModal','polManageModal'];
for(const width of [390,1440])test('D-3e installed dialog templates use role sizes '+width,async({page},testInfo)=>{
 await page.setViewportSize({width,height:900});await boot(page);
 for(const name of ['projects','meetings','team','library','tasks','calendar','media','pages'])await view(page,name);
 await view(page,'tasks');await page.locator('[data-gt-info]').click();await page.locator('[data-gt-scope-close]').click();
 const inventory=await page.evaluate(ids=>{
  const result={present:[],notInstalled:[],counts:{},violations:[]};
  // Synchronous template measurement avoids adding overlay history entries while walking closed templates.
  for(const id of ids){const root=document.getElementById(id);if(!root){result.notInstalled.push(id);continue}result.present.push(id);
   const className=root.className,aria=root.getAttribute('aria-hidden');root.classList.remove('hidden');root.setAttribute('aria-hidden','false');
   const text=[...root.querySelectorAll('*')].filter(e=>!e.closest('button,.icon-btn,[aria-hidden="true"]')&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()));
   result.counts[id]=text.length;
   for(const e of text){const size=parseFloat(getComputedStyle(e).fontSize);if(size<12)result.violations.push({id,element:e.id||e.className||e.tagName,size})}
   for(const e of root.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]),textarea,select'))if(getComputedStyle(e).fontSize!=='14px')result.violations.push({id,element:e.id,size:getComputedStyle(e).fontSize,want:14});
   for(const e of root.querySelectorAll('label:not(.secondary):not(.primary):not(.library-pick-button)'))if(getComputedStyle(e).fontSize!=='12px')result.violations.push({id,element:e.id||e.className,size:getComputedStyle(e).fontSize,want:12});
   for(const e of root.querySelectorAll('.modal-head h2,.w1b-detail-head h2'))if(getComputedStyle(e).fontSize!=='18px')result.violations.push({id,element:e.id,size:getComputedStyle(e).fontSize,want:18});root.className=className;if(aria===null)root.removeAttribute('aria-hidden');else root.setAttribute('aria-hidden',aria);
  }return result;
 },modalIds);
 expect(inventory.violations).toEqual([]);
 await testInfo.attach('dialog-inventory',{body:JSON.stringify({width,...inventory},null,2),contentType:'application/json'});
});

for(const width of [390,1440])test('D-4b month task style contract moves to retained day rows '+width,async({page,browser})=>{
 await page.setViewportSize({width,height:900});await boot(page);await view(page,'calendar');
   const dayOriginal=await browser.newPage({viewport:{width,height:900}});
   await baseline(dayOriginal,'5c81cfd845ee9d08f9e337ce1d0cb378d20c4169');await boot(dayOriginal);await view(dayOriginal,'calendar');
   for(const p of [page,dayOriginal]){
    const date=fixtureTaskDay();
    await expect.poll(()=>p.evaluate(date=>window.KPTUCalendarMonthView?.dayEvents(date).filter(e=>e.source==='task').length,date)).toBe(1);
    await p.evaluate(date=>KPTUCalendarDayOverflow.open(new Date(date+'T12:00:00'),KPTUCalendarMonthView.dayEvents(date)),date);
    await expect(p.locator('#calendarDayList [data-calendar-task="font-task"]')).toBeVisible();
   }
   // Compare every pre-existing task role unchanged, then check the added metadata role.
   const taskStyles=async p=>p.locator('#calendarDayList [data-calendar-task="font-task"]').evaluate(el=>[el,el.querySelector('.cmv-task-mark'),el.querySelector('.cmv-event-title')].map(e=>{const s=getComputedStyle(e);return [e.tagName,e.className,s.fontSize,s.color,s.fontWeight,s.lineHeight,s.backgroundColor,s.borderColor,s.opacity,s.textDecorationLine]}));
   // UI-디자인손질 2 (2026-10-16 사용자 결정): the day rows keep the same elements and roles, but are drawn as plain rows
   // (no fill or border, check circle, name 13px·400). Compare the roles with the baseline, then check the new look.
   const roles=rows=>rows.map(([tag,cls])=>[tag,cls]);
   expect(roles(await taskStyles(page)),'calendar day task retained roles').toEqual(roles(await taskStyles(dayOriginal)));
   const row=page.locator('#calendarDayList [data-calendar-task="font-task"]');
   await expect(row).toHaveCSS('background-color','rgba(0, 0, 0, 0)');await expect(row).toHaveCSS('border-left-width','0px');
   await expect(row.locator('.cmv-event-title')).toHaveCSS('font-size','13px');await expect(row.locator('.cmv-event-title')).toHaveCSS('font-weight','400');
   await expect(page.locator('#calendarDayTasks .gt-day-main')).toHaveCount(1);
   await expect(page.locator('#calendarDayTasks .gt-meta')).toHaveCSS('font-size','12px');
   await expect(page.locator('#calendarDayTasks .gt-due')).not.toBeEmpty();
   await expect(page.locator('#calendarDayTasks')).not.toContainText('연결 안 됨');
   for(const p of [page,dayOriginal]){
    await p.locator('[data-close="calendarDayModal"]').click();
    await expect(p.locator('#calendarDayModal')).toBeHidden();
    await expect.poll(()=>p.evaluate(()=>history.state?.kptuOverlay)).toBeUndefined();
   }
   await dayOriginal.close();
});

// D-6b compares the exact pre-cleanup main, independent of future origin/main movement.
const d6bMain='23f5b87241a6a8b2db4f6bb552237ef4d41a3139';
const d6bSource=path=>execFileSync('git',['show',d6bMain+':app/'+path],{encoding:'utf8'});
const d6bSelectors=d6bSource('base-ui.css').split('\n').slice(194,210).map(line=>line.split('{')[0]);
// PRJ-기록입력: main line 202 styled the progress line (.ps3-pg-summary/.ps3-pg-next) and the header line under the title (#ps3Objective).
// The progress line is gone; the header line is now #ps3Summary with the same role, so the current page is read through that selector.
const d6bProgressLine='#ps3DetailModal :is(.ps3-pg-summary,.ps3-pg-next,#ps3Objective)',d6bHeaderLine='#ps3DetailModal #ps3Summary';
const d6bCurrentSelectors=d6bSelectors.map(selector=>selector===d6bProgressLine?d6bHeaderLine:selector);
// UI-회의결과창정리: 업로드 상자 글자(#documentModal .library-dropzone strong)와 회의자료 라벨 설명은 화면에서 없어졌다.
const d6bRetired=['#documentModal .library-dropzone strong','#meetingModal .meeting-materials-block label span'];

async function d6bPrepare(page,source){
 await boot(page);
 for(const name of ['projects','meetings','team','library','tasks','calendar','media','pages'])await view(page,name);
 await view(page,'projects');await page.locator('#ps3ArchiveBtn').click();await page.locator('[data-ps3-close="ps3ArchiveModal"]').click();
 await page.locator('[data-ps3-project="type-project"]').first().click();
 await expect(page.locator('#ps3DetailModal')).toBeVisible();
 await expect(page.locator('#ps3Body [data-ps3-gtasks] .gt-row')).toHaveCount(1);
 await page.evaluate(()=>KPTUGoogleTasks.openLinkPicker({project_id:'type-project'}));
 await expect(page.locator('#gtPickModal')).toBeVisible();
 // Render the retained but unloaded workflow markup without loading or executing its module.
 const workflow=source('workflow-ai-v3.js');
 const ai=workflow.match(/function installMeetingAi\(\).*?insertAdjacentHTML\('beforeend',`([^`]+)`/s)[1];
 const rule=workflow.match(/<p id="wfTaskRule"[^>]+>[^<]+<\/p>/)[0];
 await page.evaluate(({ai,rule})=>{
  document.body.insertAdjacentHTML('beforeend',ai);document.querySelector('#taskModal').insertAdjacentHTML('beforeend',rule);
  // Deferred/retained roles whose normal templates need additional API data, or no longer render.
  // Same structural markup on both sides, including status variants overridden by D-3e metadata color.
  const deferred={
   ps3DetailModal:'<div class="ps3-summary"><b>목표</b></div><div class="ps3-stat-grid"><b>1</b><span>개수</span></div><div class="ps3-row-main"><b>제목</b></div><div class="ps3-row-title"><b>제목</b></div><div class="ps3-type-row"><b>유형</b><small>설명</small></div><span class="badge published">완료</span>',
   ps3CreateModal:'<div class="ps3-type-row"><b>유형</b><small>설명</small></div>',
   wdModal:'<div class="wd-year">2026년</div><span class="wd-aff-chip taskforce">소속</span>',
   documentModal:'<div class="library-selected-file error"><span class="library-upload-state">실패</span></div><div class="library-selected-file unknown"><span class="library-upload-state">확인</span></div>'
  };
  for(const [id,html] of Object.entries(deferred))document.getElementById(id).insertAdjacentHTML('beforeend',html);
 },{ai,rule});
}

async function d6bSnapshot(page,selectors=d6bSelectors){
 return page.evaluate(selectors=>selectors.map((selector,index)=>({line:index+195,elements:[...document.querySelectorAll(selector)].map(el=>{
  const style=getComputedStyle(el);return {tag:el.tagName,id:el.id,class:el.className,fontSize:style.fontSize,color:style.color};
 })})),selectors);
}

for(const width of [390,1280])test('D-6b all 16 rules preserve main font-size and color '+width,async({page,browser},testInfo)=>{
 const fs=await import('node:fs');
 await page.setViewportSize({width,height:900});
 const original=await browser.newPage({viewport:{width,height:900}});
 try{
  await baseline(original,d6bMain);
  await d6bPrepare(original,d6bSource);await d6bPrepare(page,path=>fs.readFileSync('app/'+path,'utf8'));
  // Compare the new meeting field under both style sets, retaining every existing element.
  // This keeps the full 16-rule comparison and also covers the added label/select.
  const meetingField=await page.locator('#libraryEditMeeting').evaluate(el=>el.closest('label').outerHTML);
  await original.locator('#libraryEditProject').evaluate((el,html)=>el.closest('label').insertAdjacentHTML('afterend',html),meetingField);
  // Compare the added record region under both style sets too; exclude no existing nodes.
  // PRJ-기록입력 rebuilt the project detail (one record list, small +, line lists) and removed the progress dialog.
  // Main's header line under the title keeps its size; then the same current markup is compared under main's and current styles.
  const mainHeaderSize=await original.locator('#ps3Objective').evaluate(el=>getComputedStyle(el).fontSize);
  for(const id of ['ps3DetailModal','ps3WorkstreamModal']){const html=await page.locator('#'+id).evaluate(el=>el.outerHTML);await original.locator('#'+id).evaluate((el,html)=>{el.outerHTML=html},html)}
  await original.locator('#ps3ProgressModal').evaluate(el=>el.remove());await expect(page.locator('#ps3ProgressModal')).toHaveCount(0);
  // BASKET-할일출처 added the task editor's source-note line; compare it under both style sets too.
  const sourceNote=await page.locator('#gtSourceNote').evaluate(el=>el.outerHTML);
  await original.locator('#gtMeetingLinks').evaluate((el,html)=>el.insertAdjacentHTML('afterend',html),sourceNote);
  // UI-디자인손질 1 (2026-10-16 사용자 결정): "차수" has no separate "선택" tag any more; drop that removed node from
  // the baseline only. Every other optional tag (특이사항·약칭 etc.) is still compared.
  await original.evaluate(()=>document.querySelectorAll('#meetingRoundNo,#mrdEditRound').forEach(input=>input.closest('label')?.querySelector(':scope > .optional')?.remove()));
  // PRJ-색 added the project color field (hidden value input + choices); compare it under both style sets too.
  const colorField=await page.locator('#ps3CreateColorField').evaluate(el=>el.outerHTML);
  await original.locator('#ps3CreateParent').evaluate((el,html)=>el.closest('label').insertAdjacentHTML('afterend',html),colorField);
  // FORM-시간입력 turned each date-time field into a date picker + 4-digit time cell; compare those fields under both style sets.
  for(const id of ['meetingAt','mrdEditAt','ps3MilestoneAt']){const html=await page.locator('#'+id).evaluate(el=>el.closest('label').outerHTML);await original.locator('#'+id).evaluate((el,html)=>{el.closest('label').outerHTML=html},html)}
  // FORM-시간입력 added the place field to the event edit window; compare it under both style sets too.
  const placeField=await page.locator('#ciGoogleLocation').evaluate(el=>el.closest('label').outerHTML);
  await original.locator('#ciGoogleEndTime').evaluate((el,html)=>el.closest('.ci-date-grid').insertAdjacentHTML('afterend',html),placeField);
  // UI-회의결과창정리(2026-10-17 사용자 결정): 회의 결과 창(만들기·수정)의 첨부·후속 묶음과 자료 등록 창 업로드 칸을 작은 묶음으로 바꿨다.
  // 바뀐 부분은 현재 마크업을 main 쪽에도 넣어 양쪽 스타일로 비교한다. 없어진 두 요소(업로드 상자 글자·회의자료 라벨 설명)의 규칙은 아래에서 뺀다.
  for(const [from,to] of [['#meetingModal fieldset:has(#meetingActionList)','#meetingModal fieldset:has(#meetingActionList)'],['#mrdView .mrd-followup-section','#mrdView .mrd-followup-section'],['#mrdView .mrd-material-section','#mrdView .mrd-material-section'],['#mrdView .mrd-result-section','#mrdView .mrd-result-section'],['#documentModal .library-file-block','#documentModal .library-file-block']]){const html=await page.locator(from).evaluate(el=>el.outerHTML);await original.locator(to).evaluate((el,html)=>{el.outerHTML=html},html)}
  // MEET-기록보내기 1단계: 회의 결과 원문 줄에 [바구니에 담기] 버튼·안내·상태 줄이 생겼다. 위 묶음 비교에 결과 구역도 함께 넣어 양쪽 스타일로 비교한다.
  // UI-바구니첨부메모(2026-10-18 사용자 결정): 자료 등록·수정 창의 분류는 자유 입력 대신 7개 중 고르기. 현재 칸을 main 쪽에도 넣어 양쪽 스타일로 비교한다.
  for(const id of ['docCategory','libraryEditCategory']){const html=await page.locator('#'+id).evaluate(el=>el.outerHTML);await original.locator('#'+id).evaluate((el,html)=>{el.outerHTML=html},html)}
  // MEET-파일로만들기(2026-10-17 사용자 결정): 회의 [+] 창에 [직접 쓰기 | 파일·글로 만들기] 전환과 파일·글 칸이 생겼다. 현재 마크업을 main 쪽에도 넣어 양쪽 스타일로 비교한다.
  const filesPanel=await page.locator('#meetingModal').evaluate(el=>[el.querySelector('.meeting-create-modes').outerHTML,el.querySelector('#mffPanel').outerHTML].join(''));
  await original.locator('#meetingModal .modal-head').evaluate((el,html)=>el.insertAdjacentHTML('afterend',html),filesPanel);
  // UI-바구니첨부메모 PR 3(2026-10-19): 담당조직 상세에 [자료] 묶음이 생기고, 자료실 [분류 수정] 창에 분류 목록 편집 칸과 '자료별 분류' 제목이 생겼다.
  // 현재 마크업을 main 쪽에도 넣어 양쪽 스타일로 비교한다(기존 요소는 하나도 빼지 않는다).
  const orgDocs=await page.locator('#wdModal #wdDocs').evaluate(el=>el.outerHTML);
  await original.locator('#wdModal #wdTasks').evaluate((el,html)=>el.insertAdjacentHTML('afterend',html),orgDocs);
  const manageParts=await page.locator('#libraryManageModal').evaluate(el=>[el.querySelector('#libraryCategoryEditor').outerHTML,el.querySelector('.library-manage-title').outerHTML].join(''));
  await original.locator('#libraryManageList').evaluate((el,html)=>el.insertAdjacentHTML('beforebegin',html),manageParts);
  const before=await d6bSnapshot(original,d6bCurrentSelectors),after=await d6bSnapshot(page,d6bCurrentSelectors);
  // Line 202: main styled #ps3Objective by this rule; the same header line (#ps3Summary) keeps that font size.
  const headerRow=before[d6bSelectors.indexOf(d6bProgressLine)];
  expect(headerRow.elements.map(el=>el.id)).toEqual(['ps3Summary']);headerRow.elements[0].fontSize=mainHeaderSize;
  // Two new elements carry their own PRJ-기록입력 rules that main never had: the header line (compared above on line 202)
  // and the empty-list text (project-record-input.spec). Drop exactly those from the generic dialog rows on both sides.
  // UI-회의결과창정리: 묶음 설명(.mtg-note 12px)과 빈 상태(.mtg-empty 13px)도 자기 규칙이 있다(meeting-entry.spec에서 크기 확인).
  const generic=el=>!(el.class==='ps3-rec-empty'||el.class==='mtg-note'||el.class==='mtg-empty'||el.id==='ps3Summary');
  for(const rows of [before,after])rows.forEach((row,i)=>{if(i!==d6bSelectors.indexOf(d6bProgressLine))row.elements=row.elements.filter(generic)});
  // UI-디자인기준 3/3 3부(8-9e-3): 창 제목(h2)만 새 기준 18px. 나머지 15개 규칙과 색은 그대로 비교한다.
  for(const row of before)for(const el of row.elements)if(el.tag==='H2')el.fontSize='18px';
  expect(before).toHaveLength(16);
  for(const [i,row] of before.entries())if(!d6bRetired.includes(d6bSelectors[i]))expect(row.elements.length,'main line '+row.line+' is covered').toBeGreaterThan(0);
  for(const [i,row] of after.entries())if(d6bRetired.includes(d6bSelectors[i]))expect(row.elements,'retired main line '+row.line).toEqual([]);
  expect(after).toEqual(before);
  await testInfo.attach('d6b-main-style-comparison',{body:JSON.stringify({main:d6bMain,width,before,after},null,2),contentType:'application/json'});
 }finally{await original.close()}
});

test('D-6b keeps hide priorities and removes only dialog priorities',async()=>{
 const fs=await import('node:fs'),css=fs.readFileSync('app/base-ui.css','utf8');
 expect(css.match(/!important/g)).toHaveLength(4);
 expect(css.split('\n').slice(54,57)).toEqual(d6bSource('base-ui.css').split('\n').slice(54,57));
 const owners=['workspace-ui.css','project-system-v3.css','workplace-detail.css','library-upload.css','meeting-ui.css','google-tasks.css','web1-board.css'];
 const owned=owners.map(path=>{
  const current=fs.readFileSync('app/'+path,'utf8');
  expect((current.match(/!important/g)||[]).length,path+' adds no priorities').toBeLessThanOrEqual((d6bSource(path).match(/!important/g)||[]).length);
  return current;
 }).join('\n');
 for(const selector of d6bSelectors.filter(selector=>!d6bRetired.includes(selector))){
  const rule=owned.split('\n').find(line=>line.startsWith((selector===d6bProgressLine?d6bHeaderLine:selector)+'{'));
  expect(rule,selector+' stays explicit').toBeDefined();expect(rule).not.toContain('!important');
 }
});
