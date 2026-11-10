// UI-Esc로창닫기: PC에서 창(.modal)은 Esc로 닫힌다 — 그 창의 ✕와 같은 닫기(accessibility-dialog.js 공용 규칙).
// ② 안쪽 작은 것(⋯ 메뉴)이 열려 있으면 Esc는 그것만 닫고 창은 남는다. ③ 한글 입력 중(조합 중) Esc는 창을 닫지 않는다.
// 창 위에 뜬 작은 창(소속·타임라인)을 Esc로 닫으면 다음 Esc는 그 아래 창을 닫는다.
import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { openEmphasisFixture } from './helpers/calendar-task-emphasis.mjs';

test.use({timezoneId:'Asia/Seoul'});

const composingEsc=(page,selector)=>page.evaluate(sel=>{
  const el=document.querySelector(sel);el.focus();
  el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',isComposing:true,bubbles:true,cancelable:true}));
  el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',keyCode:229,bubbles:true,cancelable:true}));
},selector);

async function openGoogleEdit(page){
  await page.locator('#calendarGrid [data-google-event="blue-0"]').click();
  await expect(page.locator('#ciGoogleModal')).toBeVisible();
  await expect(page.locator('#ciGoogleSave')).toBeEnabled();
}

test('일정 수정 창: Esc = ✕, ⋯ 메뉴가 열려 있으면 메뉴만, 한글 조합 중에는 닫지 않음',async({page})=>{
  await page.setViewportSize({width:1280,height:844});
  const {external}=await openEmphasisFixture(page);
  const calendarUrl=page.url();
  await page.evaluate(()=>{window.qaPops=0;window.addEventListener('popstate',()=>window.qaPops++)});

  await openGoogleEdit(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#ciGoogleModal')).toBeHidden();
  await expect(page.locator('.modal:not(.hidden)')).toHaveCount(0);
  expect(await page.evaluate(()=>window.qaPops)).toBe(0); // PC: ✕처럼 기록 이동 없이 닫힘

  // ② ⋯ 메뉴가 열려 있으면 Esc는 메뉴만 닫는다. 다음 Esc가 창을 닫는다.
  await openGoogleEdit(page);
  await page.locator('#ciGoogleMore').click();
  await expect(page.locator('#ciGoogleMenu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#ciGoogleMenu')).toBeHidden();
  await expect(page.locator('#ciGoogleModal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#ciGoogleModal')).toBeHidden();

  // ③ 한글 조합 중 Esc는 창을 닫지 않는다. 조합이 끝난 뒤 Esc는 닫는다(고치던 내용은 ✕처럼 저장하지 않고 닫음).
  await openGoogleEdit(page);
  await page.locator('#ciGoogleTitle').fill('고치던 제목');
  await composingEsc(page,'#ciGoogleTitle');
  await expect(page.locator('#ciGoogleModal')).toBeVisible();
  await expect(page.locator('#ciGoogleTitle')).toHaveValue('고치던 제목');
  await page.keyboard.press('Escape');
  await expect(page.locator('#ciGoogleModal')).toBeHidden();
  // 다시 열면 원래 제목(저장하지 않음 — ✕와 같다)
  await openGoogleEdit(page);
  await expect(page.locator('#ciGoogleTitle')).not.toHaveValue('고치던 제목');
  await page.locator('#ciGoogleClose').click();
  await expect(page.locator('#ciGoogleModal')).toBeHidden();

  expect(page.url()).toBe(calendarUrl);
  expect(external).toEqual([]);
});

test('그날 일정 창: Esc로 닫히고, 그 창에서 연 일정 수정 창도 Esc로 닫힘',async({page})=>{
  await page.setViewportSize({width:1280,height:844});
  const {external}=await openEmphasisFixture(page);
  const openDay=async()=>{
    await page.locator('.cal-cell[data-date="2026-10-21"] .cal-day').first().click();
    await expect(page.locator('#calendarDayModal')).toBeVisible();
  };
  await openDay();
  await page.keyboard.press('Escape');
  await expect(page.locator('#calendarDayModal')).toBeHidden();

  await openDay();
  await page.locator('#calendarDayList [data-google-event="overflow-event"]').click();
  await expect(page.locator('#calendarDayModal')).toBeHidden();
  await expect(page.locator('#ciGoogleModal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#ciGoogleModal')).toBeHidden();
  await expect(page.locator('.modal:not(.hidden)')).toHaveCount(0);

  // ✕로 닫은 뒤 다시 열어도 Esc가 그대로 닫는다(공용 규칙에서 빠지지 않음).
  await openDay();
  await page.locator('#calendarDayModal [data-close="calendarDayModal"]').click();
  await expect(page.locator('#calendarDayModal')).toBeHidden();
  await openDay();
  await page.keyboard.press('Escape');
  await expect(page.locator('#calendarDayModal')).toBeHidden();
  expect(external).toEqual([]);
});

test('조직 창과 그 위 작은 창: Esc는 맨 위 창부터 하나씩 닫음',async({page})=>{
  await page.setViewportSize({width:1280,height:844});
  await page.goto(`${appOrigin}/tests/app-e2e/suborganization-filters-canonical-fixture.html`);
  await page.evaluate(()=>window.__KPTU_SUBORGANIZATIONS_READY__);
  const openRail=async()=>{
    await page.locator('[data-so-org="org-rail"]').click();
    await expect(page.locator('#wdModal')).toBeVisible();
  };
  await openRail();
  await page.keyboard.press('Escape');
  await expect(page.locator('#wdModal')).toBeHidden();

  await openRail();
  await page.locator('#wdMore [data-wd-tab="aff"]').click();
  await page.locator('#wdAffManage').click();
  await expect(page.locator('#wdAffModal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#wdAffModal')).toBeHidden();
  await expect(page.locator('#wdModal')).toBeVisible();

  await page.locator('#wdTime > summary').click();
  await page.locator('#wdAddTime').click();
  await expect(page.locator('#wdTimeModal')).toBeVisible();
  await composingEsc(page,'#wdTimeName');
  await expect(page.locator('#wdTimeModal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#wdTimeModal')).toBeHidden();
  await expect(page.locator('#wdModal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#wdModal')).toBeHidden();
});
