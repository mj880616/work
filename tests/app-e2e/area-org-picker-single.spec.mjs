// S52-01 ② UI-사업영역조직고르기창 전수 ②a: 하나만 고르는 곳(빠른 입력 [할 일]·일정 추가 [할 일] 사업영역)도
// 할 일 창과 같은 고르기 창(#areaOrgPickSheet) 하나로 열린다. 큰 묶음만 보이고 꺾쇠로 하위, 찾기, '사업영역 없음',
// 줄을 누르면 바로 고르고 닫힘([넣기] 없음). 저장 값(links:[{project_id}])은 전과 같다.
import { test, expect } from '@playwright/test';
import { openHome, createdTaskReply } from './helpers/home-entry.mjs';
import { SHEET, pressName } from './helpers/area-org-picker.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const quick=page=>page.locator('#homeView [data-home-quick]');
test.use({timezoneId:'Asia/Seoul'});

for(const width of [390,1280])test(`빠른 입력 [할 일] 사업영역 = 같은 선택 창, 하나만 선택됨 ${width}`,async({page})=>{
  await page.setViewportSize({width,height:844});await openHome(page);const q=quick(page);
  await q.locator('[data-quick-mode="task"]').click();await q.locator('[data-quick-input]').fill('QA 하나');
  const trigger=q.locator('[data-quick-project]');await trigger.click();
  const sheet=page.locator(SHEET);await expect(sheet).toBeVisible();await expect(sheet.locator('h2')).toHaveText('사업영역 선택');
  await expect(sheet).toHaveClass(width>=761?/home-choice-anchored/:/home-choice-sheet/);
  // 큰 묶음만: 하위는 접혀 있고 꺾쇠로 펼친다. 맨 위 '사업영역 없음', 찾기 칸(폰도), [넣기] 없음.
  const list=sheet.locator('.aop-list');
  await expect(list.locator('[data-sheet-value="p:child"]')).toBeHidden();
  await expect(list.locator('[data-sheet-value=""]')).toHaveText('사업영역 없음');await expect(list.locator('[data-sheet-value=""]')).toHaveAttribute('aria-pressed','true');
  await expect(sheet.getByRole('searchbox',{name:'찾기'})).toBeVisible();await expect(sheet.locator('[data-sheet-foot]')).toBeHidden();
  // 찾기는 접힌 하위도 찾는다.
  await sheet.getByRole('searchbox',{name:'찾기'}).fill('자식');await expect(list.locator('[data-sheet-value="p:child"]')).toBeVisible();await expect(list.locator('[data-sheet-value="p:p"]')).toBeHidden();
  await sheet.getByRole('searchbox',{name:'찾기'}).fill('');await expect(list.locator('[data-sheet-value="p:child"]')).toBeHidden();
  await list.locator('[data-aop-toggle]').click();await list.locator('[data-sheet-value="p:child"]').click();
  await expect(sheet).toBeHidden();await expect(trigger).toHaveText('자식 프로젝트 ▾');await expect(trigger).toHaveAttribute('title','테스트 프로젝트 › 자식 프로젝트');await expect(trigger).toBeFocused();
  // 다시 열면 고른 것이 든 묶음이 펼쳐져 있고 표시된다.
  await trigger.click();await expect(list.locator('[data-sheet-value="p:child"]')).toBeVisible();await expect(list.locator('[data-sheet-value="p:child"]')).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Escape');await expect(sheet).toBeHidden();await expect(trigger).toHaveText('자식 프로젝트 ▾');
  const bodies=[];await page.route(SB+'/functions/v1/google-tasks?action=create',r=>{bodies.push(r.request().postDataJSON());return r.fulfill({json:createdTaskReply(r.request().postDataJSON())});});
  await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');
  expect(bodies.map(b=>b.links)).toEqual([[{project_id:'child'}]]);
});

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
