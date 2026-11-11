import {test,expect} from '@playwright/test';
import {start as startFiles,openFiles} from './helpers/files-server.mjs';
import {start as startNews,openNews} from './helpers/news-server.mjs';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {showAllReportWeeks} from './helpers/report-week.mjs';

// S51-27 UI-PC우클릭 ②: 목록 화면 PC 우클릭 = 그 줄의 메뉴(공용 줄 메뉴 row-menu.js 또는 그 줄의 기존 ⋯ 메뉴)를 누른 자리에.
// 파일 목록 줄(예전: 고르기만 켜짐), News 글 줄(예전: 크롬 메뉴), 사업 보고 목록 줄(예전: 오른쪽 칸에 떠 있던 다른 보고의 메뉴).
test.use({timezoneId:'Asia/Seoul'});
const menu=page=>page.locator('#rowMenu');
const labels=loc=>loc.locator('button').allTextContents().then(a=>a.map(s=>s.trim()));
// 다시 그려지는 줄도 기다렸다가 누른다(locator.click이 보일 때까지 기다림). 돌려주는 값 = 누른 화면 자리.
// 보인 뒤 줄이 다시 그려지면 boundingBox가 잠깐 null일 수 있어, 상자를 얻을 때까지 다시 잰다(CI 간헐 실패 원인, S52-22에서 발견).
async function rightAt(page,loc){await expect(loc).toBeVisible();let b=null;await expect.poll(async()=>(b=await loc.boundingBox())!==null).toBe(true);const dx=Math.round(Math.min(b.width/2,60)),dy=Math.round(b.height/2);await loc.click({button:'right',position:{x:dx,y:dy}});return {x:Math.round(b.x)+dx,y:Math.round(b.y)+dy}}
const keepLog=page=>page.evaluate(()=>{window.__kept=[];window.addEventListener('contextmenu',e=>window.__kept.push(!e.defaultPrevented))});

test('파일 1280: 목록 줄 우클릭 → 그 줄 메뉴(고르기 아님), 폴더는 [이 폴더로 들어가기]로 들어가기',async({page})=>{
  test.setTimeout(90000);
  const {errors}=await startFiles(page,1280);
  await openFiles(page,1280);
  const row=page.locator('#filesRoot [data-fx-list] [data-fx-row="od:OD!1"]');
  await expect(row).toBeVisible();
  await keepLog(page);
  const {x}=await rightAt(page,row);
  await expect(menu(page)).toBeVisible();
  const items=await labels(menu(page));
  expect(items[0]).toBe('이 폴더로 들어가기');expect(items).toContain('이름 바꾸기');expect(items.at(-1)).toBe('휴지통');
  await expect(menu(page).locator('.row-menu-title')).toHaveText('가짜 문서함');
  expect(Math.abs((await menu(page).boundingBox()).x-x)).toBeLessThanOrEqual(14);
  expect(await page.evaluate(()=>window.__kept)).toEqual([false]);
  await expect(page.locator('#filesRoot [data-fx-row="od:OD!1"][aria-pressed="true"], #filesRoot .fx-picked')).toHaveCount(0);
  await menu(page).getByRole('button',{name:'이 폴더로 들어가기',exact:true}).click();
  await expect(page.locator('#filesRoot [data-fx-list] [data-fx-row="od:OD!11"]')).toBeVisible();
  // 파일 줄: [열기][자료실로 보내기][복사][옮기기][이름 바꾸기][경로 복사][별표] … [휴지통] (FILES-자료실로보내기 S52-26, S52-43 ③ 경로 복사)
  await rightAt(page,page.locator('#filesRoot [data-fx-list] [data-fx-row="od:OD!11"]'));
  expect(await labels(menu(page))).toEqual(['열기','자료실로 보내기','복사','옮기기','이름 바꾸기','경로 복사','별표','휴지통']);
  await page.keyboard.press('Escape');await expect(menu(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test('News 1440: 글 줄 우클릭 → [보관][숨기기](줄 위 단추와 같음), [숨기기] 실행',async({page})=>{
  test.setTimeout(90000);
  const {errors,server}=await startNews(page,1440);
  await openNews(page,1440);
  const c1=page.locator('#newsRoot [data-nc-item="c1"]');
  await expect(c1).toBeVisible();
  await keepLog(page);
  await rightAt(page,c1.locator('.nw-title'));
  await expect(menu(page)).toBeVisible();
  expect(await labels(menu(page))).toEqual(['보관','숨기기']);
  expect(await page.evaluate(()=>window.__kept)).toEqual([false]);
  await menu(page).getByRole('button',{name:'숨기기'}).click();
  await expect(page.locator('#newsRoot [data-nc-item="c1"]')).toHaveCount(0);
  expect(server.calls.filter(c=>c.what==='app_news_items'&&c.method==='PATCH').at(-1).body.hidden_at).toBeTruthy();
  expect(errors).toEqual([]);
});

function meetingState(){
  const s=baseState();s.meetingWrites=[];
  const row=(id,name,round,at)=>({id,workspace_id:s.workspace.id,title:name,series_name:name,round_no:round,meeting_at:at,transcript_text:'원문',created_by:s.user.id});
  s.meetings=[row('rail-1','궤도협의회',1,'2026-09-01T01:00:00Z'),row('rail-2','궤도협의회',2,'2026-09-02T01:00:00Z')];
  return s;
}
test('사업 보고 1280: 목록 줄 우클릭 → 그 보고를 고르고 그 보고의 ⋯ 메뉴(다른 보고 메뉴가 아님)',async({page})=>{
  await page.setViewportSize({width:1280,height:900});await mockApp(page,meetingState());
  await signIn(page,testOrigin+'/app/?view=meetings');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await showAllReportWeeks(page);
  await page.locator('#meetingList [data-meeting-kind="궤도협의회"]').click();
  await page.locator('#meetingList [data-meeting-round="rail-2"]').click();
  await expect(page.locator('#meetingList #mcolResult')).toHaveAttribute('data-meeting-result','rail-2');
  await keepLog(page);
  await rightAt(page,page.locator('#meetingList [data-meeting-round="rail-1"]'));
  await expect(page.locator('#meetingList #mcolResult')).toHaveAttribute('data-meeting-result','rail-1');
  const more=page.locator('#mrdMoreMenu');
  await expect(more).toBeVisible();
  expect(await labels(more)).toContain('수정');
  await expect(page.locator('#meetingRoundDetailModal')).toHaveAttribute('data-meeting-id','rail-1');
  expect(await page.evaluate(()=>window.__kept)).toEqual([false]);
});
