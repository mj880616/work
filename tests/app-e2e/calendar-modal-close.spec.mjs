import { test, expect } from '@playwright/test';
import { openEmphasisFixture, taskChip, openTaskDay } from './helpers/calendar-task-emphasis.mjs';

test.use({timezoneId:'Asia/Seoul'});

async function openList(page,width){
  await page.setViewportSize({width,height:844});
  const fixture=await openEmphasisFixture(page);
  await expect.poll(()=>page.evaluate(()=>!!window.__KPTU_MOBILE_MODAL_HISTORY__)).toBe(true);
  const calendarUrl=page.url();
  await page.evaluate(()=>{window.qaModalPops=0;window.addEventListener('popstate',()=>window.qaModalPops++)});
  await page.locator('.cal-cell[data-date="2026-10-21"] .cmv-task-count').click();
  await expect(page.locator('#calendarDayModal')).toBeVisible();
  if(width<=760)await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBe('calendarDayModal');
  return {...fixture,calendarUrl};
}

for(const kind of ['task','google']){
  for(const width of [390,900]){
    test(`task-count day list ${kind} editor stays open after list history closes (${width}px)`,async({page})=>{
      const {external,calendarUrl}=await openList(page,width);
      const selector=kind==='task'?'#gtTaskModal':'#ciGoogleModal';
      if(kind==='task')await taskChip(page,'overflow-pending','#calendarDayList').click();
      else await page.locator('#calendarDayList [data-google-event="overflow-event"]').click();
      if(width<=760){
        await expect.poll(()=>page.evaluate(()=>window.qaModalPops)).toBe(1);
        await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBe(selector.slice(1));
      }
      await expect(page.locator('#calendarDayModal')).toBeHidden();
      await expect(page.locator(selector)).toBeVisible();
      if(kind==='task')await expect(page.locator('#gtEditDue')).toHaveValue('2026-10-21');
      else await expect(page.locator('#ciGoogleSave')).toBeEnabled();
      if(width<=760){
        await page.evaluate(()=>history.back());
        await expect.poll(()=>page.evaluate(()=>window.qaModalPops)).toBe(2);
        await expect(page.locator(selector)).toBeHidden();
        await expect(page.locator('#calendarView')).toBeVisible();
        await expect(page.locator('.modal:not(.hidden)')).toHaveCount(0);
        expect(await page.evaluate(()=>history.state?.kptuOverlay)).toBeUndefined();
        expect(page.url()).toBe(calendarUrl);
        expect(await page.evaluate(()=>window.KPTURouter.current)).toBe('calendar');
      }
      expect(external).toEqual([]);
    });
  }
}

test('normal mobile calendar task editor closes with one back and keeps the calendar',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {external}=await openEmphasisFixture(page);
  const calendarUrl=page.url();
  await openTaskDay(page);
  await taskChip(page,'pending').click();
  await expect(page.locator('#gtTaskModal')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBe('gtTaskModal');
  await page.evaluate(()=>history.back());
  await expect(page.locator('#gtTaskModal')).toBeHidden();
  await expect(page.locator('#calendarView')).toBeVisible();
  expect(page.url()).toBe(calendarUrl);
  expect(external).toEqual([]);
});


test('normal desktop Google calendar editor opens and closes without history traversal',async({page})=>{
  await page.setViewportSize({width:1280,height:844});
  const {external}=await openEmphasisFixture(page);
  const calendarUrl=page.url();
  await page.evaluate(()=>{window.qaModalPops=0;window.addEventListener('popstate',()=>window.qaModalPops++)});
  await page.locator('#calendarGrid [data-google-event="blue-0"]').click();
  await expect(page.locator('#ciGoogleModal')).toBeVisible();
  await expect(page.locator('#ciGoogleSave')).toBeEnabled();
  await page.locator('#ciGoogleClose').click();
  await expect(page.locator('#ciGoogleModal')).toBeHidden();
  await expect(page.locator('#calendarView')).toBeVisible();
  expect(page.url()).toBe(calendarUrl);
  expect(await page.evaluate(()=>window.qaModalPops)).toBe(0);
  expect(external).toEqual([]);
});


for(const kind of ['task','google']){
  test(`task-count day list ${kind} editor waits for the actual list history traversal`,async({page})=>{
    await openList(page,390);
    await page.evaluate(()=>{
      const back=history.back.bind(history);
      window.qaHeldBack=null;
      history.back=()=>{window.qaHeldBack=back};
    });
    const modal=page.locator(kind==='task'?'#gtTaskModal':'#ciGoogleModal');
    if(kind==='task')await taskChip(page,'overflow-pending','#calendarDayList').click();
    else await page.locator('#calendarDayList [data-google-event="overflow-event"]').click();
    await expect.poll(()=>page.evaluate(()=>typeof window.qaHeldBack)).toBe('function');
    await expect(page.locator('#calendarDayModal')).toBeHidden();
    await expect(modal).toBeHidden();
    await page.evaluate(()=>{history.back=window.qaHeldBack;history.back()});
    await expect.poll(()=>page.evaluate(()=>window.qaModalPops)).toBe(1);
    await expect(modal).toBeVisible();
  });
}
