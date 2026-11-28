// S52-01 ② UI-사업영역조직고르기창 전수 ②a: 하나만 고르는 곳(빠른 입력 [할 일]·일정 추가 [할 일] 사업영역)도
// 할 일 창과 같은 고르기 창(#areaOrgPickSheet) 하나로 열린다. 큰 묶음만 보이고 꺾쇠로 하위, 찾기, '사업영역 없음',
// 줄을 누르면 바로 고르고 닫힘([넣기] 없음). 저장 값(links:[{project_id}])은 전과 같다.
import { test, expect } from '@playwright/test';
import { openHome, createdTaskReply, pickQuickMode } from './helpers/home-entry.mjs';
import { SHEET, pressName } from './helpers/area-org-picker.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const quick=page=>page.locator('#homeView [data-home-quick]');
test.use({timezoneId:'Asia/Seoul'});


test('일정 추가 [할 일] 사업영역 = 같은 선택 창, \'상위 › 하위\' 칸, 사업영역 없음으로 비움, 저장 값 그대로',async({page})=>{
  await page.setViewportSize({width:390,height:844});await openHome(page,{query:'?view=calendar'});
  await page.waitForFunction(()=>window.KPTUCalendarPlus&&window.KPTUCalendarTasks);await page.locator('#newEventBtn').click();
  await page.locator('[data-event-mode="task"]').click();await page.locator('#eventTitle').fill('QA 일정 할 일');
  const b=page.locator('#eventTaskProject');await b.click();const sheet=page.locator(SHEET);await expect(sheet).toBeVisible();
  await expect(page.locator('#eventModal')).toBeVisible();
  await pressName(page,'자식 프로젝트');await expect(sheet).toBeHidden();
  await expect(b).toContainText('테스트 프로젝트 › 자식 프로젝트');await expect(b).toHaveAttribute('aria-label','사업영역: 테스트 프로젝트 › 자식 프로젝트');
  await b.click();await pressName(page,'사업영역 없음');await expect(b).toContainText('선택 안 함');
  await b.click();await pressName(page,'자식 프로젝트');
  const bodies=[];await page.route(SB+'/functions/v1/google-tasks?action=create',r=>{bodies.push(r.request().postDataJSON());return r.fulfill({json:{ok:true,task:{id:'created',...r.request().postDataJSON()},links:r.request().postDataJSON().links.map(x=>({...x,status:'confirmed'})),meeting_links:[]}});});
  await page.locator('#saveEventBtn').click();await expect(page.locator('#eventModal')).toBeHidden();
  expect(bodies.map(x=>x.links)).toEqual([[{project_id:'child'}]]);
});
