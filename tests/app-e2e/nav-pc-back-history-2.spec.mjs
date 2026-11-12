// NAV-PC뒤로직전2(S60-24, 명진 결정 11/11 15:37 '직전 화면 무조건 직전화면'): #2454가 남긴 화면 — 아스날 경기, 텔레그램 날짜별 상세,
// 사업 보고, 자료실 폴더, 사진 폴더. PC에서 사람이 누른 항목 = 뒤로 한 칸(A → B → C 에서 ‹ = B, ‹ = A, ‹ = 앞), › 는 같은 기록.
// 기록은 라우터 한 곳(KPTURouter.pick). 폰 뒤로가기(겹·창)는 그대로. 이름·내용은 모두 지어낸 것.
import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
import {installTgServer,telegramRows} from './helpers/tg-room-day-server.mjs';
import {bootLibrary,libFolder} from './helpers/library-folder-server.mjs';
import {installViewPrefsServer} from './helpers/view-prefs-server.mjs';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {installBusinessNowServer} from './helpers/business-now-server.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const topBack=page=>page.locator('[data-history-step="back"]');
const topForward=page=>page.locator('[data-history-step="forward"]');
const watchErrors=page=>{const errors=[];page.on('pageerror',e=>errors.push(e.message));return errors};

// ── 아스날 ──
const ctx={window:{}};
runInNewContext(readFileSync(new URL('../../app/arsenal/matches.js',import.meta.url),'utf8'),ctx);
const MATCHES=ctx.window.ARSENAL_MATCHES.filter(m=>m.upcoming!==true).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
const arsRow=(page,id)=>page.locator(`#arsenalRoot [data-ars-row="${id}"]`);
const arsPicked=(page,id)=>expect(arsRow(page,id)).toHaveAttribute('aria-pressed','true');

test('PC 1280 아스날: 경기 B → C → D 에서 ‹ = C, ‹ = B, ‹ = 그 전 화면, › = B → C',async({page})=>{
 const errors=watchErrors(page);
 await page.setViewportSize({width:1280,height:900});
 await openHome(page);
 await clickView(page,'calendar');await expect(page.locator('#calendarView')).toBeVisible();
 await page.evaluate(()=>window.KPTURouter.go('arsenal'));
 const [a,b,c,d]=MATCHES;
 await arsPicked(page,a.id); // 화면이 스스로 보여 준 첫 경기는 한 칸이 아니다.
 const start=await page.evaluate(()=>history.length);
 for(const m of [b,c,d]){await arsRow(page,m.id).click();await arsPicked(page,m.id)}
 expect(await page.evaluate(()=>history.length)).toBe(start+2);
 await expect(page).toHaveURL(new RegExp(`[?&]match=${d.id}(?:&|$)`));
 await topBack(page).click();await arsPicked(page,c.id);
 await page.goBack();await arsPicked(page,b.id);
 await topBack(page).click();await expect(page.locator('#calendarView')).toBeVisible();
 await topForward(page).click();await expect(page.locator('#arsenalView')).toBeVisible();await arsPicked(page,b.id);
 await topForward(page).click();await arsPicked(page,c.id);
 expect(errors).toEqual([]);
});

test('폰 412 아스날: 리뷰는 겹 하나 — 뒤로 = 목록, 고른 경기 기록은 쌓지 않는다',async({page})=>{
 const errors=watchErrors(page);
 await page.setViewportSize({width:412,height:900});
 await openHome(page);
 await page.evaluate(()=>window.KPTURouter.go('arsenal'));
 await arsRow(page,MATCHES[1].id).click();
 await expect(page.locator('#arsenalRoot [data-ars-review]')).toBeVisible();
 expect(await page.evaluate(()=>history.state?.kptuPick||null)).toBe(null);
 await page.goBack();
 await expect(page.locator('#arsenalRoot [data-ars-review]')).toBeHidden();await expect(page.locator('#arsenalView')).toBeVisible();
 expect(errors).toEqual([]);
});

// ── 텔레그램 날짜별 ──
const A6='room-a|2026-10-06',B6='room-b|2026-10-06',A5='room-a|2026-10-05';
async function openTelegram(page,width){
 await page.setViewportSize({width,height:860});
 await openHome(page,{beforeLoad:async()=>{
  for(const path of ['app_tg_senders','app_tg_day_senders'])await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/'+path,r=>r.fulfill({json:[]}));
  await installTgServer(page,{items:telegramRows(),writes:[],calls:[]});
 }});
 await page.evaluate(()=>window.KPTURouter.go('calendar'));await expect(page.locator('#calendarView')).toBeVisible();
 await page.evaluate(()=>window.KPTURouter.go('telegram'));
 await expect(page.locator('#telegramView [data-tg-rd]').first()).toBeVisible();
}
const tgRow=(page,key)=>page.locator(`#telegramView [data-tg-rd="${key}"]`);
const tgOpen=(page,key)=>tgRow(page,key).locator('.feed-rdb');
const tgPicked=(page,key)=>expect(tgRow(page,key)).toHaveClass(/is-selected/);

test('PC 1280 텔레그램 날짜별: A → B → C 에서 ‹ = B, ‹ = A, ‹ = 목록만, ‹ = 그 전 화면, › = 목록 → A, 주소 rday',async({page})=>{
 const errors=watchErrors(page);
 await openTelegram(page,1280);
 const detail=page.locator('#tgDetail');
 await expect(detail).toBeHidden();
 for(const key of [A6,B6,A5]){await tgOpen(page,key).click();await tgPicked(page,key)}
 await expect(page).toHaveURL(/[?&]rday=room-a%3A2026-10-05(?:&|$)|[?&]rday=room-a:2026-10-05(?:&|$)/);
 await topBack(page).click();await tgPicked(page,B6);
 await page.goBack();await tgPicked(page,A6);
 await topBack(page).click();await expect(detail).toBeHidden();await expect(page).not.toHaveURL(/[?&]rday=/);
 await topBack(page).click();await expect(page.locator('#calendarView')).toBeVisible();
 await topForward(page).click();await expect(page.locator('#telegramView')).toBeVisible();await expect(detail).toBeHidden();
 await topForward(page).click();await tgPicked(page,A6);await expect(detail.locator('[data-tg-daybox]')).toBeVisible();
 // 새로고침해도 같은 날이 열린다(주소 rday).
 await page.reload();await tgPicked(page,A6);
 expect(errors).toEqual([]);
});

test('폰 412 텔레그램 날짜별: 상세는 겹 하나 — 뒤로 = 목록, 고른 날 기록은 쌓지 않는다',async({page})=>{
 const errors=watchErrors(page);
 await openTelegram(page,412);
 await tgOpen(page,A6).click();
 await expect(page.locator('#tgDetail [data-tg-back]')).toBeVisible();
 expect(await page.evaluate(()=>history.state?.kptuPick||null)).toBe(null);
 await page.goBack();
 await expect(page.locator('#tgDetail [data-tg-back]')).toBeHidden();await expect(page.locator('#telegramView')).toBeVisible();
 expect(errors).toEqual([]);
});

// ── 자료실 폴더 ──
const LIB_FOLDERS=[libFolder('fa','top-a',{name:'가상 A',sort_order:1024}),libFolder('fc','child-a1',{name:'가상 C',parent_id:'fa',sort_order:0}),libFolder('fn',null,{name:'가상 N',sort_order:2048})];
const LIB_ITEMS=[{document_id:'a-1',folder_id:'fc'},{document_id:'n-1',folder_id:'fa'}];
const libTops=page=>page.locator('#documentList > details').evaluateAll(xs=>xs.map(x=>x.dataset.luNode));
const libNav=page=>page.locator('#libraryFolderNav');

test('PC 1280 자료실 폴더: C → N 에서 ‹ = C, ‹ = 자료실(맨 위), › = C → N (폴더 밖으로 한 번에 나가지 않는다)',async({page})=>{
 test.setTimeout(90000);
 const {s,errors}=await bootLibrary(page,1280,{folders:LIB_FOLDERS,items:LIB_ITEMS});
 await page.locator('#libraryGroupBy').selectOption({label:'폴더'});
 await libNav(page).locator('[data-lu-nav="fa"]').click();await expect(libNav(page).locator('[data-lu-nav="fc"]')).toBeVisible();
 await libNav(page).locator('[data-lu-nav="fc"]').click();await expect.poll(()=>libTops(page)).toEqual(['f:fc']);
 await libNav(page).locator('[data-lu-nav="fn"]').click();await expect.poll(()=>libTops(page)).toEqual(['f:fn']);
 await expect(page).toHaveURL(/[?&]folder=fn(?:&|$)/);
 await topBack(page).click();await expect.poll(()=>libTops(page)).toEqual(['f:fc']);await expect(page).toHaveURL(/[?&]folder=fc(?:&|$)/);
 await page.goBack();await expect.poll(()=>libTops(page)).toEqual(['x:out','f:fa','f:fn']);await expect(page).not.toHaveURL(/[?&]folder=/);
 await expect(page.locator('#libraryView')).toBeVisible();
 await topForward(page).click();await expect.poll(()=>libTops(page)).toEqual(['f:fc']);
 await topForward(page).click();await expect.poll(()=>libTops(page)).toEqual(['f:fn']);
 expect(s.writes).toEqual([]);expect(errors).toEqual([]);
});

test.describe('폰 412 자료실',()=>{test.use({hasTouch:true});
test('폰 412 자료실 폴더: 들어간 폴더는 겹 하나 — 뒤로 = 한 단계 위(지금 그대로), 고른 폴더 기록은 쌓지 않는다',async({page})=>{
 test.setTimeout(90000);
 const {errors}=await bootLibrary(page,412,{folders:LIB_FOLDERS,items:LIB_ITEMS});
 await page.locator('#libraryGroupBy').selectOption({label:'폴더'});
 await page.locator('#documentList details[data-lu-node="f:fn"] > summary').tap();
 await expect.poll(()=>libTops(page)).toEqual(['f:fn']);
 expect(await page.evaluate(()=>history.state?.kptuPick||null)).toBe(null);
 await page.goBack();
 await expect.poll(()=>libTops(page)).toEqual(['x:out','f:fa','f:fn']);await expect(page.locator('#libraryView')).toBeVisible();
 expect(errors).toEqual([]);
});
});

// ── 사진 폴더(PC 1440: 왼쪽 나무 | 사진) ──
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==','base64');
const media=(id,parent,day)=>({id,parent,name:id+'.jpg',day,taken_at:`${day}T03:00:00.000Z`,approx:false,kind:'photo',screenshot:false,duration_ms:null});
async function photosFixture(page,width){
 const folders=[{id:'S1',name:'2026',parent_id:'T'},{id:'S2',name:'여행',parent_id:'T'},{id:'S21',name:'제주',parent_id:'S2'}];
 const all=[media('A1','T','2026-10-05'),media('B1','S1','2026-10-03'),media('C1','S21','2026-09-20')];
 await page.setViewportSize({width,height:900});
 await openHome(page);
 await installViewPrefsServer(page);
 for(const t of ['app_diary_stars','app_photo_tags','app_photo_tag_items'])await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/'+t,r=>r.fulfill({json:[]}));
 const total=id=>all.filter(m=>m.parent===id).length+folders.filter(f=>f.parent_id===id).reduce((n,f)=>n+total(f.id),0);
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/onedrive-photos',async r=>{
  const body=r.request().postDataJSON();
  if(body.action==='photo')return r.fulfill({status:200,contentType:'image/png',body:PNG});
  if(body.action==='status')return r.fulfill({json:{configured:true,connected:true,folder:{name:'카메라'},can_delete:true}});
  if(body.action==='sync')return r.fulfill({json:{more:false,indexing:false}});
  if(body.action==='months')return r.fulfill({json:{months:{'2026-10':2,'2026-09':1},total:3}});
  if(body.action==='library'){const list=all.filter(m=>body.folder_id?m.parent===body.folder_id:true).map(({parent,...m})=>m);return r.fulfill({json:{items:list,next_cursor:null,indexing:false}})}
  if(body.action==='folders-tree')return r.fulfill({json:{top:{id:'T',name:'카메라',count:1,total:total('T')},folders:folders.map(f=>({...f,enabled:true,count:all.filter(m=>m.parent===f.id).length,total:total(f.id)})),indexing:false}});
  return r.fulfill({status:400,json:{error:'action_invalid'}});
 });
}
const photoTree=page=>page.locator('#photosRoot [data-photos-fx-tree]');
const photoAt=(page,id)=>expect(photoTree(page).locator(`[data-photos-folder="${id}"]`)).toHaveClass(/nx-current/);

test('PC 1440 사진 폴더: 2026 → 제주 에서 ‹ = 2026, ‹ = [사진], › = 2026 → 제주 (폴더 밖으로 한 번에 나가지 않는다)',async({page})=>{
 const errors=watchErrors(page);
 await photosFixture(page,1440);
 await clickView(page,'photos');await expect(page.locator('#photosView')).toBeVisible();
 const chip=page.locator('#photosRoot [data-photos-view]');
 await chip.selectOption('folders');await expect(chip).toHaveValue('folders');
 await expect(photoTree(page).locator('.nx-name')).toHaveText(['카메라','2026','여행']);
 await photoTree(page).locator('[data-photos-fx-open="S1"]').click();await photoAt(page,'S1');
 await photoTree(page).locator('[data-photos-fx-tog="S2"]').click();
 await photoTree(page).locator('[data-photos-fx-open="S21"]').click();await photoAt(page,'S21');
 await expect(page).toHaveURL(/[?&]pf=o(?::|%3A)S21(?:&|$)/);
 await topBack(page).click();await photoAt(page,'S1');await expect(chip).toHaveValue('folders');
 await page.goBack();await expect(chip).toHaveValue('all');
 await topForward(page).click();await expect(chip).toHaveValue('folders');await photoAt(page,'S1');
 await topForward(page).click();await photoAt(page,'S21');
 expect(errors).toEqual([]);
});

// ── 사업 보고(PC 회의 칸 | 보고 | 결과) ──
async function openReports(page,width){
 const st=baseState();
 const row=(id,title,round,at)=>({id,workspace_id:st.workspace.id,title,series_name:title,round_no:round,meeting_at:at,transcript_text:'합성 결과 글',activity_kind:'meeting',business_area_id:'child-a1',next_plan:'',created_by:st.user.id,created_at:at,updated_at:at,notes:'',decisions:''});
 st.meetings=[row('m-a','합성 상집',46,'2026-11-10T00:00:00Z'),row('m-b','합성 집행위',12,'2026-11-09T05:00:00Z'),row('m-c','합성 상집',45,'2026-11-09T00:00:00Z')];
 await page.setViewportSize({width,height:900});
 await page.clock.setFixedTime(new Date('2026-11-10T01:00:00Z'));
 await mockApp(page,st);
 await page.route(`${SB}/rest/v1/app_weekly_exec_requests**`,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
 await installBusinessNowServer(page,{});
 await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
 await expect(page.locator('#meetingsView #bizWeekBox')).toBeVisible();
}
const kindBtn=(page,name)=>page.locator('#meetingList .mcol-kinds [data-meeting-kind]').filter({hasText:name});
const roundBtn=(page,id)=>page.locator(`#meetingList [data-meeting-round="${id}"]`);
const reportAt=(page,id)=>expect(roundBtn(page,id)).toHaveAttribute('aria-current','true');

test.describe('사업 보고',()=>{test.use({timezoneId:'Asia/Seoul'});
test('PC 1280 사업 보고: (스스로 연 상집 46) → 상집 45 → [집행위] 12 에서 ‹ = 상집 45, ‹ = 그 전 화면, › = 상집 45 → 집행위 12',async({page})=>{
 const errors=watchErrors(page);
 await openReports(page,1280);
 await clickView(page,'calendar');await expect(page.locator('#calendarView')).toBeVisible();
 await clickView(page,'meetings');
 // 화면이 스스로 연 첫 보고(가장 최근 상집 46)는 한 칸이 아니다.
 await reportAt(page,'m-a');
 const start=await page.evaluate(()=>history.length);
 await roundBtn(page,'m-c').click();await reportAt(page,'m-c');
 // 회의 칸을 바꾸면 그 칸의 보고가 열린다 — 사람이 누른 것이라 한 칸.
 await kindBtn(page,'합성 집행위').click();await reportAt(page,'m-b');
 expect(await page.evaluate(()=>history.length)).toBe(start+1);
 await expect(page).toHaveURL(/[?&]report=m-b(?:&|$)/);
 await topBack(page).click();await reportAt(page,'m-c');await expect(page).toHaveURL(/[?&]report=m-c(?:&|$)/);
 await page.goBack();await expect(page.locator('#calendarView')).toBeVisible();
 await topForward(page).click();await expect(page.locator('#meetingsView')).toBeVisible();await reportAt(page,'m-c');
 await topForward(page).click();await reportAt(page,'m-b');
 // 같은 보고를 다시 누르면 기록이 늘지 않는다.
 const now=await page.evaluate(()=>history.length);
 await roundBtn(page,'m-b').click();expect(await page.evaluate(()=>history.length)).toBe(now);
 expect(errors).toEqual([]);
});
});
