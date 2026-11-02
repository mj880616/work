// S48-30 화면 다듬기 2 (요청함 11/02 00:38 놓친 작업 17·21·C5, 10/28 17:16·10/22 14:06·10/28 20:03 C5): 새로고침해도 사업 보고의
// 고른 칸·보고가 그대로(주소 ?chip=·?report=), 위쪽 줄 '사업 보고 › 칸 › 항목'의 칸을 누르면 그 칸으로, 폰 하단바는 칸 없는 화면에서
// [메뉴]를 칠하지 않는다. 모든 이름·글은 합성 값.
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {showAllReportWeeks} from './helpers/report-week.mjs';

test.use({timezoneId:'Asia/Seoul'});

function state(){
  const s=baseState();s.meetingWrites=[];
  const row=(id,name,at,extra={})=>({id,workspace_id:s.workspace.id,title:name,series_name:name,round_no:null,meeting_at:at,transcript_text:'합성 결과 '+id,created_by:s.user.id,...extra});
  s.meetings=[
    row('m-1','합성 정기 회의','2026-10-08T01:00:00Z',{round_no:2,activity_kind:'meeting'}),
    row('p-1','합성 출정 기자회견','2026-10-21T01:00:00Z',{activity_kind:'press'}),
    row('p-2','합성 두번째 기자회견','2026-10-20T01:00:00Z',{activity_kind:'press'})
  ];
  return s;
}
async function open(page,width){
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width,height:900});await mockApp(page,state());
  await signIn(page,testOrigin+'/app/?view=reports');await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#meetingsView')).toBeVisible();
  await showAllReportWeeks(page);
  return errors;
}
const chip=(page,name)=>page.locator('#reportKindFilter').getByRole('radio',{name,exact:true});

test('PC 1280: 사업 보고 칸·고른 보고가 주소에 적히고 새로고침 뒤 그대로, 위쪽 줄에 칸 중간 단계',async({page})=>{
  const errors=await open(page,1280);
  await chip(page,'언론').click();
  await expect(chip(page,'언론')).toHaveAttribute('aria-checked','true');
  await expect(page).toHaveURL(/[?&]chip=press(?:&|$)/);
  // 두 번째 보고를 고르면 ?report=가 그 보고로 바뀐다.
  await page.locator('#meetingList [data-meeting-round="p-2"]').first().click();
  await expect(page).toHaveURL(/[?&]report=p-2(?:&|$)/);
  // 위쪽 줄: 사업 보고 › 언론 › 합성 두번째 기자회견
  const where=page.locator('.app-topline [data-topline-where]');
  await expect(where.locator('li')).toHaveText(['사업 보고','언론','합성 두번째 기자회견']);
  await page.reload();await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(chip(page,'언론')).toHaveAttribute('aria-checked','true');
  await expect(page).toHaveURL(/[?&]report=p-2(?:&|$)/);
  await expect(page.locator('#meetingList [data-meeting-round="p-2"]').first()).toHaveAttribute('aria-current',/true|page/);
  await expect(where.locator('li')).toHaveText(['사업 보고','언론','합성 두번째 기자회견']);
  // 중간 단계 '언론'은 그 칸으로 가는 버튼이다(같은 칸이면 칩에 초점).
  await where.getByRole('button',{name:'언론',exact:true}).click();
  await expect(chip(page,'언론')).toBeFocused();
  // [회의]로 가면 칸 칸이 주소에서 빠진다(기본 칸은 적지 않음).
  await chip(page,'회의').click();
  await expect(page).not.toHaveURL(/[?&]chip=/);
  await expect(page).toHaveURL(/[?&]report=m-1(?:&|$)/);
  expect(errors).toEqual([]);
});

test('폰 390: 하단바에 칸이 없는 화면(자료실)에서는 아무 칸도 칠하지 않는다(UI-화면정리 C5)',async({page})=>{
  const errors=await open(page,390);
  const tabs=page.locator('#appView>.mobile-tabs');
  // 사업 보고는 하단바 칸이 있어 그 칸 하나.
  await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);await expect(tabs.locator('[aria-current="page"]')).toContainText('사업 보고');
  await page.evaluate(()=>window.KPTURouter.go('library'));await expect(page.locator('#libraryView')).toBeVisible();
  await expect(tabs.locator('[aria-current="page"]')).toHaveCount(0);
  await expect(page.locator('[data-mobile-view-name]')).toHaveText('자료실');
  expect(errors).toEqual([]);
});
