// FOLD-넓은화면 2차(S59-19, 요청함 11/06 01:18 ④): 펼친 폴드(공용 판정 600px~ — 기본 화면 약 690px은 폰 틀, '화면 크기 작게' 884px은 PC 틀)의
// 조직 보고·사업 보고는 '왼쪽 목록 | 오른쪽 상세' 두 칸이다.
// - 조직 보고: 884·PC와 같은 칸(처음 열면 마지막으로 본 조직, 없으면 첫 조직). 다른 줄은 같은 칸에서 바뀌고 뒤로가기 기록을 쌓지 않는다(뒤로 = 앞 화면).
// - 사업 보고: [회의]도 '날짜·이름 목록 | 결과' 두 칸(PC [전체] 칩과 같은 부품). 회의명은 위 [종류 ▾]의 '회의명' 묶음으로 거른다. ‹ › 주 넘기기는 두 칸 그대로.
// - 접은 폰(412)·PC(1280)는 그대로: 412는 목록 + 창, 1280 사업 보고 [회의]는 종류 | 차수 | 결과 세 칸.
// 서버는 가짜, 이름·글은 모두 합성 값.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {installBusinessNowServer} from './helpers/business-now-server.mjs';

test.use({timezoneId:'Asia/Seoul'});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z',owner='home-test';
const FOLD=[[690,1000],[750,1000],[884,1104]];
const box=locator=>locator.evaluate(e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),right:Math.round(r.right),bottom:Math.round(r.bottom)}});
const sideways=page=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
const current=page=>page.evaluate(()=>window.KPTURouter.current);
// 폰 틀(~760px): 화면 아래에 떠 있는 줄(하단바·전환 줄) 중 가장 위 줄의 윗선. 칸이 그 줄에 가리지 않는지 본다.
const dockTop=page=>page.evaluate(()=>Math.min(...[...document.querySelectorAll('.mobile-tabs,#soTeamTabs')].filter(e=>e.getClientRects().length&&getComputedStyle(e).position==='fixed').map(e=>Math.round(e.getBoundingClientRect().top)),innerHeight));

// ── 조직 보고 ──
const orgs=[
 {id:'oa',workspace_id:'w',name:'합성 가 지부',active:true,created_by:owner,updated_at:stamp},
 {id:'ob',workspace_id:'w',name:'합성 나 지부',active:true,created_by:owner,updated_at:stamp},
 {id:'oc',workspace_id:'w',name:'합성 다 지부',active:true,created_by:owner,updated_at:stamp}
];
async function orgFixture(page,width,height){
 await page.setViewportSize({width,height});
 const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 page.on('request',req=>{if(req.url().startsWith(SB+'/rest/')&&!['GET','HEAD','OPTIONS'].includes(req.method()))writes.push(req.method()+' '+new URL(req.url()).pathname)});
 const updates=Array.from({length:4},(_,i)=>({id:'u-'+i,organization_id:'oa',raw_text:'합성 기록 '+i,detail_text:null,occurred_at:`2026-09-2${8-i}T01:00:00Z`}));
 await page.route(SB+'/rest/v1/app_suborganizations?**',route=>{const q=new URL(route.request().url()).searchParams,id=q.get('id');return route.fulfill({json:id?orgs.filter(o=>'eq.'+o.id===id):orgs})});
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',route=>{const q=new URL(route.request().url()).searchParams;return route.fulfill({json:q.get('user_id')?[{user_id:owner}]:orgs.map(o=>({organization_id:o.id,user_id:owner}))})});
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',route=>{const q=new URL(route.request().url()).searchParams,id=q.get('organization_id')||'';return route.fulfill({json:updates.filter(u=>id==='eq.'+u.organization_id||id.startsWith('in.(')&&id.slice(4,-1).split(',').includes(u.organization_id))})});
 return {errors,writes};
}
const orgRow=(page,id)=>page.locator(`#soOrganizationList [data-so-org="${id}"]`);
const orgPane=page=>page.locator('#wdDetailPane');
const orgTitle=page=>page.locator('#wdTitle');

for(const [width,height] of FOLD){
 test(`폴드 ${width}: 조직 보고 — 왼쪽 목록 | 오른쪽 상세(창 아님), 다른 줄은 같은 칸·뒤로가기 기록 없음, 뒤로 = 앞 화면, [전체 표]는 두 칸 폭`,async({page})=>{
  const {errors,writes}=await orgFixture(page,width,height);
  await clickView(page,'team');
  // 처음 열면 첫 조직이 오른쪽 칸에 바로(884·PC와 같은 규칙). 창(dialog)이 아니라 칸(region)이고 닫기 ×는 없다.
  await expect(orgTitle(page)).toHaveText('합성 가 지부');
  const modal=page.locator('#wdModal');
  await expect(orgPane(page).locator('#wdModal')).toBeVisible();
  await expect(modal).toHaveAttribute('role','region');await expect(modal).not.toHaveAttribute('aria-modal','true');
  await expect(modal.locator('[data-wd-close="wdModal"]')).toBeHidden();
  await expect(modal.locator('#wdUpdates')).toContainText('합성 기록 0');
  const list=await box(page.locator('#soOrganizationList')),right=await box(orgPane(page));
  expect(right.x).toBeGreaterThanOrEqual(list.right+8);
  expect(Math.abs(right.y-list.y)).toBeLessThanOrEqual(1);
  expect(right.w).toBeGreaterThan(list.w);
  expect(list.w).toBeGreaterThanOrEqual(200);
  expect(await sideways(page)).toBeLessThanOrEqual(1);
  await expect(orgRow(page,'oa')).toHaveAttribute('aria-current','true');await expect(orgRow(page,'oa')).toHaveClass(/is-selected/);
  // 칸은 화면에 붙어 따라오고(공용 follow-pane.js), 폰 틀에서는 아래 떠 있는 줄(하단바·[목록|전체 표])에 가리지 않는다.
  await expect(orgPane(page)).toHaveClass(/kptu-follow-pane/);
  if(width<=760){await expect(orgPane(page)).toHaveClass(/kptu-follow-narrow/);await expect.poll(async()=>(await box(orgPane(page))).bottom-await dockTop(page)).toBeLessThanOrEqual(0)}
  else await expect(orgPane(page)).not.toHaveClass(/kptu-follow-narrow/);
  // 칸에 붙은 상세는 창이 아니라 뒤로가기 한 칸(창 기록)을 쌓지 않는다(mobile-modal-history.js role=region).
  expect(await page.evaluate(()=>[history.state?.kptuOverlay??null,document.querySelector('#wdModal').dataset.kptuHistoryOpen??null])).toEqual([null,null]);
  // 다른 줄: 같은 칸에서 바뀌고 뒤로가기 기록이 늘지 않는다.
  const length=await page.evaluate(()=>history.length);
  await orgRow(page,'ob').click();await expect(orgTitle(page)).toHaveText('합성 나 지부');
  await orgRow(page,'oc').click();await expect(orgTitle(page)).toHaveText('합성 다 지부');
  await expect(orgRow(page,'oc')).toHaveAttribute('aria-current','true');await expect(orgRow(page,'oa')).not.toHaveAttribute('aria-current','true');
  await expect(modal).toHaveAttribute('role','region');
  expect(await page.evaluate(()=>history.length)).toBe(length);
  // [전체 표]: 목록·상세 칸 대신 표가 두 칸 폭 전부. [목록]으로 돌아오면 고른 조직 그대로.
  const tabs=page.locator('#soTeamTabs');
  await tabs.getByRole('tab',{name:'전체 표'}).click();
  await expect(page.locator('#soOverview')).toBeVisible();await expect(orgPane(page)).toBeHidden();
  const table=await box(page.locator('#soOverview')),section=await box(page.locator('#soTeamSection'));
  expect(Math.abs(table.w-section.w)).toBeLessThanOrEqual(2);
  expect(await sideways(page)).toBeLessThanOrEqual(1);
  await tabs.getByRole('tab',{name:'목록'}).click();
  await expect(orgPane(page).locator('#wdModal')).toBeVisible();await expect(orgTitle(page)).toHaveText('합성 다 지부');
  // 뒤로가기 = 앞 화면(홈). 칸은 창이 아니라 닫힐 것이 없다.
  await page.goBack();
  await expect.poll(()=>current(page)).toBe('home');
  await expect(page.locator('#wdModal')).toBeHidden();
  // 다시 오면 마지막으로 본 조직.
  await clickView(page,'team');await expect(orgTitle(page)).toHaveText('합성 다 지부');
  expect(writes).toEqual([]);expect(errors).toEqual([]);
 });
}

test('폴드 690 ↔ 884 ↔ 접은 폰 412: 조직 상세는 폭에 맞춰 칸(폰 틀은 아래 줄만큼 짧게) ↔ 창으로 옮겨 간다',async({page})=>{
 const {errors}=await orgFixture(page,884,1104);
 await clickView(page,'team');await expect(orgTitle(page)).toHaveText('합성 가 지부');
 await orgRow(page,'ob').click();await expect(orgTitle(page)).toHaveText('합성 나 지부');
 await expect(orgPane(page)).not.toHaveClass(/kptu-follow-narrow/);
 await page.setViewportSize({width:690,height:1000});
 await expect(orgPane(page)).toHaveClass(/kptu-follow-narrow/);
 await expect(orgPane(page).locator('#wdModal')).toBeVisible();await expect(orgTitle(page)).toHaveText('합성 나 지부');
 // 접으면(600px 미만) 지금처럼 창.
 await page.setViewportSize({width:412,height:915});
 await expect(page.locator('#wdModal')).toHaveAttribute('role','dialog');
 await expect(orgPane(page).locator('#wdModal')).toHaveCount(0);
 expect(errors).toEqual([]);
});

for(const [width,height] of [[412,915],[599,900]]){
 test(`접은 폰 ${width}: 조직 보고는 지금처럼 목록 + 상세 창(칸 없음, 처음에 열지 않음), 뒤로가기로 창 닫기`,async({page})=>{
  const {errors}=await orgFixture(page,width,height);
  await clickView(page,'team');
  await expect(orgRow(page,'oa')).toBeVisible();
  await expect(orgPane(page)).toBeHidden();await expect(page.locator('#wdModal')).toBeHidden();
  await orgRow(page,'ob').click();
  const modal=page.locator('#wdModal');
  await expect(orgTitle(page)).toHaveText('합성 나 지부');
  await expect(modal).toHaveAttribute('role','dialog');await expect(orgPane(page).locator('#wdModal')).toHaveCount(0);
  await page.goBack();
  await expect(modal).toBeHidden();
  expect(await current(page)).toBe('team');
  expect(errors).toEqual([]);
 });
}

// ── 사업 보고 ──
// 시계 2026-11-10(화) 10:00(서울) → 이번 주 11.9~11.15에 보고 셋, 지난주에 하나.
const NOW='2026-11-10T01:00:00Z';
function bizState(){
 const s=baseState();
 const row=(id,title,round,at)=>({id,workspace_id:s.workspace.id,title,series_name:title,round_no:round,meeting_at:at,transcript_text:'합성 결과 '+id,activity_kind:'meeting',business_area_id:'child-a1',next_plan:'',created_by:s.user.id,created_at:at,updated_at:at,notes:'',decisions:''});
 s.meetings=[row('m-a','합성 상집',46,'2026-11-10T00:00:00Z'),row('m-b','합성 집행위',12,'2026-11-09T05:00:00Z'),row('m-c','합성 대표자회의',3,'2026-11-11T06:00:00Z'),row('m-d','합성 상집',45,'2026-11-03T00:00:00Z')];
 return s;
}
async function bizFixture(page,width,height,{start='reports'}={}){
 await page.setViewportSize({width,height});
 await page.clock.setFixedTime(new Date(NOW));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const s=bizState();
 await mockApp(page,s);
 await page.route(`${SB}/rest/v1/app_weekly_exec_requests**`,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
 await installBusinessNowServer(page,{});
 await signIn(page,testOrigin+'/app/?view='+start);
 if(start!=='reports'){await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});await clickView(page,'meetings')}
 await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
 await expect(page.locator('#meetingsView #bizWeekBox')).toBeVisible();
 return {errors,state:s};
}
const bizList=page=>page.locator('#meetingList');
const bizRow=(page,id)=>bizList(page).locator(`[data-meeting-round="${id}"]`);
const bizPane=page=>bizList(page).locator('.mcol-result');
const shownReport=page=>bizPane(page).locator('#meetingRoundDetailModal.mrd-docked');

for(const [width,height] of FOLD){
 test(`폴드 ${width}: 사업 보고 [회의] — '날짜·이름 목록 | 결과' 두 칸, 줄을 누르면 같은 칸, 회의명 거르기·주 넘기기 그대로, 뒤로 = 앞 화면`,async({page})=>{
  const {errors}=await bizFixture(page,width,height,{start:'home'});
  // 두 칸(세 칸의 종류 칸 없음). 가장 최근 보고(m-c 11.11)가 오른쪽 결과 칸에.
  await expect(bizList(page).locator('.mcol-layout.mcol-two')).toBeVisible();
  await expect(bizList(page).locator('.mcol-three,.mcol-kinds')).toHaveCount(0);
  await expect(bizList(page).locator('[data-meeting-round]')).toHaveCount(3);
  await expect(bizRow(page,'m-c')).toHaveAttribute('aria-current','true');
  await expect(shownReport(page)).toBeVisible();
  await expect(shownReport(page)).toHaveAttribute('role','region');
  // 결과 칸은 화면에 붙어 따라오므로(follow-pane.js) 화면 맨 위에서, 두 칸을 한 번에 잰다(위 '이번 주 주간보고' 칸이 늦게 채워지며 아래 칸들이 함께 내려간다).
  const pair=()=>page.evaluate(()=>{scrollTo({top:0,behavior:'instant'});const b=e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),right:Math.round(r.right),bottom:Math.round(r.bottom)}};
   return {rounds:b(document.querySelector('#meetingList .mcol-rounds')),pane:b(document.querySelector('#meetingList .mcol-result'))}});
  await expect.poll(async()=>{const {rounds,pane}=await pair();return Math.abs(pane.y-rounds.y)}).toBeLessThanOrEqual(1);
  const {rounds,pane}=await pair();
  expect(pane.x).toBeGreaterThanOrEqual(rounds.right+8);
  expect(pane.w).toBeGreaterThan(rounds.w);
  expect(rounds.w).toBeGreaterThanOrEqual(200);
  expect(await sideways(page)).toBeLessThanOrEqual(1);
  // 목록 줄: 이름 + 날짜·차수가 잘리지 않고 보인다(사업영역 이름이 날짜·차수를 밀어내지 않음).
  await expect(bizRow(page,'m-a')).toContainText('합성 상집');await expect(bizRow(page,'m-a').locator('.mcol-when')).toBeVisible();
  await expect(bizRow(page,'m-a')).toContainText('46차');
  expect(await bizRow(page,'m-a').locator('.mcol-when').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await expect(bizPane(page)).toHaveClass(/kptu-follow-pane/);
  // 칸 최대 높이는 칸 자리가 바뀌면(위 주간보고 칸이 채워짐) 다시 잰다(follow-pane.js) — 다 잰 뒤에 본다.
  if(width<=760){await expect(bizPane(page)).toHaveClass(/kptu-follow-narrow/);await expect.poll(async()=>(await box(bizPane(page))).bottom-await dockTop(page)).toBeLessThanOrEqual(0)}
  // 칸에 붙은 보고는 창이 아니라 뒤로가기 한 칸(창 기록)을 쌓지 않는다(mobile-modal-history.js role=region).
  expect(await page.evaluate(()=>[history.state?.kptuOverlay??null,document.querySelector('#meetingRoundDetailModal').dataset.kptuHistoryOpen??null])).toEqual([null,null]);
  // 다른 줄: 같은 칸에서 그 보고로 바뀌고 뒤로가기 기록이 늘지 않는다.
  const length=await page.evaluate(()=>history.length);
  await bizRow(page,'m-b').click();
  await expect(bizRow(page,'m-b')).toHaveAttribute('aria-current','true');
  await expect(page.locator('#meetingRoundDetailModal')).toHaveAttribute('data-meeting-id','m-b');
  await expect(shownReport(page)).toContainText('합성 결과 m-b');
  await bizRow(page,'m-a').click();
  await expect(page.locator('#meetingRoundDetailModal')).toHaveAttribute('data-meeting-id','m-a');
  await expect(shownReport(page)).toHaveAttribute('role','region');
  expect(await page.evaluate(()=>history.length)).toBe(length);
  // 회의명 거르기: 위 [종류 ▾] 상자에 '회의명' 묶음이 있고(폴드는 종류 칸이 없으므로), 고르면 목록이 그 회의만.
  const kind=page.locator('#reportKindSelect');
  await expect(kind.locator('option',{hasText:'합성 집행위'})).toHaveCount(1);
  const nameValue=await kind.locator('option',{hasText:'합성 집행위'}).getAttribute('value');
  await kind.selectOption(nameValue);
  await expect(bizList(page).locator('[data-meeting-round]')).toHaveCount(1);
  await expect(bizRow(page,'m-b')).toHaveAttribute('aria-current','true');
  await expect(bizList(page).locator('.mcol-head .mcol-name')).toHaveText('합성 집행위');
  await expect(page.locator('#meetingRoundDetailModal')).toHaveAttribute('data-meeting-id','m-b');
  const all=await kind.locator('option').first().getAttribute('value');
  await kind.selectOption(all);
  await expect(bizList(page).locator('[data-meeting-round]')).toHaveCount(3);
  // ‹ 주 넘기기: 지난주 보고 하나가 목록·결과 칸에(두 칸 그대로), › 로 돌아오면 이번 주.
  const prev=page.locator('#reportWeekFilter [data-report-week="prev"]');
  await prev.click();
  await expect(bizList(page).locator('[data-meeting-round]')).toHaveCount(1);
  await expect(bizRow(page,'m-d')).toHaveAttribute('aria-current','true');
  await expect(page.locator('#meetingRoundDetailModal')).toHaveAttribute('data-meeting-id','m-d');
  await expect(bizList(page).locator('.mcol-layout.mcol-two')).toBeVisible();
  const next=page.locator('#reportWeekFilter [data-report-week="next"]');
  await next.click();
  await expect(bizList(page).locator('[data-meeting-round]')).toHaveCount(3);
  expect(await sideways(page)).toBeLessThanOrEqual(1);
  // 뒤로가기 = 앞 화면(홈). 결과 칸은 창이 아니라 닫힐 것이 없다.
  await page.goBack();
  await expect.poll(()=>current(page)).toBe('home');
  expect(errors).toEqual([]);
 });
}

test('PC 1280: 사업 보고 [회의]는 그대로 종류 | 차수 | 결과 세 칸, 회의명 묶음은 위 상자에 없다',async({page})=>{
 const {errors}=await bizFixture(page,1280,900);
 await expect(bizList(page).locator('.mcol-layout.mcol-three')).toBeVisible();
 await expect(bizList(page).locator('.mcol-kinds [data-meeting-kind]')).toHaveCount(3);
 await expect(page.locator('#reportKindSelect option',{hasText:'합성 집행위'})).toHaveCount(0);
 await bizList(page).locator('.mcol-kinds [data-meeting-kind]').filter({hasText:'합성 집행위'}).click();
 await bizRow(page,'m-b').click();
 await expect(page.locator('#meetingRoundDetailModal')).toHaveAttribute('data-meeting-id','m-b');
 await expect(shownReport(page)).toBeVisible();
 expect(errors).toEqual([]);
});

test('접은 폰 412: 사업 보고는 그대로 한 줄 목록 + 보고 창, 뒤로가기로 창 닫기',async({page})=>{
 const {errors}=await bizFixture(page,412,915);
 await expect(bizList(page).locator('.mcol-layout')).toHaveCount(0);
 const row=bizList(page).locator('[data-mrd-meeting="m-b"]');
 await expect(row).toBeVisible();
 await row.click();
 const modal=page.locator('#meetingRoundDetailModal');
 await expect(modal).toBeVisible();await expect(modal).toHaveAttribute('role','dialog');
 await expect(modal).toHaveAttribute('data-meeting-id','m-b');
 await page.goBack();
 await expect(modal).toBeHidden();
 expect(await current(page)).toBe('meetings');
 expect(errors).toEqual([]);
});
