import {test,expect} from '@playwright/test';
import {openHome, openQuickBox, pickQuickMode, placeTrigger } from './helpers/home-entry.mjs';
import {expectChoiceAtButton} from './helpers/choice-anchor.mjs';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {bootLibrary,libFolder,libDoc} from './helpers/library-folder-server.mjs';
import {pickReportKind} from './helpers/report-filter.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {showAllReportWeeks} from './helpers/report-week.mjs';
// S54-05 UI-고르기창버튼아래 ②(11/08 명진 결정): 공용 고르기 창(app/choice-sheet.js)도 버튼으로 연 경우 폰(390)·폴드(884)·PC(1280) 모두
// 누른 버튼 바로 아래 작은 창이다(아래 자리가 모자라면 위). 위치는 anchored-popup.js의 공용 함수가 정하고 창마다 따로 고치지 않았다.
// 이 시험이 지키는 것(helpers/choice-anchor.mjs): 버튼 아래(또는 위)에 붙음 · 아래 메뉴 줄·화면 밖으로 나가지 않음 · 열자마자 첫 줄이 다 보임.
// 대표 4곳: 사업영역·담당조직 고르기, 자료실 [분류 ▾], 보고 종류 고르기, 홈 빠른 입력 고르기. 이름은 모두 합성 값.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const WIDTHS=[390,884,1280];
const NAMES=['전국철도노동조합','서울교통공사노동조합','부산지하철노동조합','대구교통공사노동조합'];
async function orgRoutes(page){
 await page.route(SB+'/rest/v1/app_suborganizations?**',r=>r.fulfill({json:NAMES.map((name,i)=>({id:'o'+i,name,active:true}))}));
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',r=>r.fulfill({json:NAMES.map((_,i)=>({organization_id:'o'+i}))}));
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',r=>r.fulfill({json:[]}));
}

for(const width of WIDTHS)test(`${width}: 홈 빠른 입력 [기록할 곳]·[프로젝트] 고르기 창이 누른 버튼 아래`,async({page})=>{
 await page.setViewportSize({width,height:844});await openHome(page);await orgRoutes(page);await page.reload();await openQuickBox(page);
 const q=page.locator('#homeView [data-home-quick]');
 await pickQuickMode(page,'task');await q.locator('[data-quick-input]').fill('QA');
 const project=q.locator('[data-quick-project]');
 await project.click();
 await expectChoiceAtButton(page,page.getByRole('dialog'),project);
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toBeHidden();
 await pickQuickMode(page,'update');
 const org=await placeTrigger(page);// HOME-입력칸두모양: 폰은 [종류 ▾] → 기록할 곳 선택, 창은 그 단추 곁
 await pickQuickMode(page,'org');
 // 넓은 화면(761px~)의 [기록할 곳]은 담당조직·프로젝트가 나란한 넓은 목록(최대 880px)이다.
 await expectChoiceAtButton(page,page.getByRole('dialog'),org,{maxWidth:width>=761?880:480});
});

for(const width of WIDTHS)test(`${width}: 할 일 연결의 사업영역·담당조직 고르기 창이 누른 줄 아래, 첫 줄이 다 보임`,async({page})=>{
 await page.setViewportSize({width,height:844});await openHome(page);await orgRoutes(page);
 await page.waitForFunction(()=>window.KPTUGoogleTasks?.openEditor);await page.evaluate(()=>window.KPTUGoogleTasks.openEditor());
 for(const kind of ['area','org']){
  const line=page.locator(`#gtEditLinkBody [data-aop-line="${kind}"]`);
  await line.locator(`[data-aop-add="${kind}"]`).click();
  const sheet=page.locator('#areaOrgPickSheet');
  await expectChoiceAtButton(page,sheet,line);
  await page.keyboard.press('Escape');await expect(sheet).toBeHidden();
 }
});

// 자료실 [분류 ▾]는 LIB-위쪽한줄(11/09)로 폰·폴드·PC 모두 위 줄에 있다.
for(const width of [390,884,1440])test(`${width}: 자료실 [분류 ▾] 창이 누른 버튼 아래`,async({page})=>{
 await bootLibrary(page,width,{folders:[libFolder('fa','top-a',{name:'가상 A'})],items:[{document_id:'a-1',folder_id:'fa'}],
  docs:[libDoc('a-1','top-a',{category:'정책'}),libDoc('a-2','top-a',{category:'투쟁'}),libDoc('m-1',null,{category:'회의'})]});
 const pick=page.locator('#libraryCategoryPick');await expect(pick).toBeVisible();
 await pick.click();
 await expectChoiceAtButton(page,page.locator('#libraryCategorySheet'),pick);
});

for(const width of WIDTHS)test(`${width}: 보고 [+] 종류 고르기 창이 누른 버튼 아래`,async({page})=>{
 const s=baseState();
 s.meetings=[{id:'m-1',workspace_id:s.workspace.id,title:'합성 정기 회의',series_name:'합성 정기 회의',round_no:1,meeting_at:'2026-10-08T01:00:00Z',transcript_text:'합성 결과',created_by:s.user.id,activity_kind:'meeting'}];
 await page.setViewportSize({width,height:900});await mockApp(page,s);
 await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
 await expect(page.locator('#meetingsView')).toBeVisible();await showAllReportWeeks(page);
 await pickReportKind(page,'전체');
 const add=page.locator('#newMeetingBtn');await add.click();
 await expectChoiceAtButton(page,page.locator('#reportKindSheet'),add);
});

// 버튼 아래 자리가 모자라면 위로: 화면 아래쪽에 있는 버튼에서도 창이 아래 바를 덮지 않는다.
test('390: 화면 아래쪽 버튼에서 열어도 창은 아래 메뉴 줄 위에서 끝나고 버튼 위나 아래에 붙음',async({page})=>{
 await page.setViewportSize({width:390,height:640});await openHome(page);await orgRoutes(page);await page.reload();await openQuickBox(page);
 const q=page.locator('#homeView [data-home-quick]');
 await pickQuickMode(page,'update');
 const org=await placeTrigger(page);await pickQuickMode(page,'org');
 await expectChoiceAtButton(page,page.getByRole('dialog'),org);
});
