import { test, expect } from '@playwright/test';
import { openEmphasisFixture, taskChip, openTaskDay, BLUE_COLORS } from './helpers/calendar-task-emphasis.mjs';

import { expectGoogleDisplay } from './helpers/calendar-google-display.mjs';

test.use({timezoneId:'Asia/Seoul'});

async function expectPending(chip){
  await expect(chip).toHaveCSS('background-color','rgb(238, 244, 248)');
  await expect(chip).toHaveCSS('color','rgb(71, 83, 42)');
  await expect(chip).toHaveCSS('border-top-color','rgb(71, 83, 42)');
  await expect(chip).toHaveCSS('border-top-width','1px');
  await expect(chip).toHaveCSS('border-top-style','solid');
  await expect(chip).toHaveCSS('font-weight','800');
  await expect(chip).toHaveCSS('opacity','1');
  await expect(chip.locator('.cmv-task-mark')).toHaveText('');
  await expect(chip.locator('.cmv-task-mark')).toHaveCSS('border-top-style','solid');
  await expect(chip.locator('.cmv-task-mark')).toHaveCSS('border-top-left-radius','999px');
}

async function expectDone(chip,weight='400'){
  await expect(chip).toHaveCSS('background-color','rgb(255, 254, 250)');
  await expect(chip).toHaveCSS('color','rgb(42, 42, 35)');
  await expect(chip).toHaveCSS('border-top-color','rgb(207, 200, 182)');
  await expect(chip).toHaveCSS('font-weight',weight);
  await expect(chip).toHaveCSS('opacity','0.55');
  await expect(chip.locator('.cmv-event-title')).toHaveCSS('text-decoration-line','line-through');
  await expect(chip.locator('.cmv-task-mark')).toHaveText('✓');
}

for(const width of [390,1280]){
  test(`day-list pending styles and month blue events while completed and overdue states remain (${width}px)`,async({page})=>{
    await page.setViewportSize({width,height:844});
    const {calls,external}=await openEmphasisFixture(page);
    await openTaskDay(page);
    await expectPending(taskChip(page,'pending'));
    await expectDone(taskChip(page,'done'));
    await openTaskDay(page,'2026-10-10');
    const overdue=taskChip(page,'overdue');
    await expect(overdue).toHaveCSS('background-color','rgb(238, 244, 248)');
    await expect(overdue).toHaveCSS('color','rgb(71, 83, 42)');
    await expect(overdue).toHaveCSS('font-weight','800');
    await expect(overdue).toHaveCSS('border-top-color','rgb(180, 35, 24)');
    await expect(overdue.locator('.cmv-task-mark')).toHaveCSS('color','rgb(180, 35, 24)');
    await expect(overdue).toHaveAttribute('aria-label',/기한 지남$/);
    await page.locator('[data-close="calendarDayModal"]').click();
    await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBeUndefined();
    for(const [i,color] of BLUE_COLORS.entries()){
      const rgb=color.slice(1).match(/../g).map(x=>parseInt(x,16));
      const chip=page.locator(`#calendarGrid [data-google-event="blue-${i}"]`);
      expect(await chip.evaluate(el=>el.style.backgroundColor)).toBe(`rgb(${rgb.join(', ')})`);
      await expectGoogleDisplay(chip,{stripe:width>=1024?4:0,tint:width>=1024?.08:.15});
    }
    await openTaskDay(page);
    await taskChip(page,'pending').click();
    await expect(page.locator('#gtTaskModal')).toBeVisible();
    await expect(page.locator('#gtTaskHeading')).toHaveText('Google 할 일 수정');
    await expect(page.locator('#gtEditDue')).toHaveValue('2026-10-20');
    expect(calls.some(c=>c.action==='toggle')).toBeFalsy();
    expect(external).toEqual([]);
  });
}

test('the task-count day list keeps pending and completed task styles',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {calls}=await openEmphasisFixture(page);
  await page.locator('.cal-cell[data-date="2026-10-21"] .cmv-task-count').click();
  await expect(page.locator('#calendarDayModal')).toBeVisible();
  await expectPending(taskChip(page,'overflow-pending','#calendarDayList'));
  // The existing day-list task button has weight 400; preserve it rather than imposing the month chip's 700.
  await expectDone(taskChip(page,'overflow-done','#calendarDayList'),'400');
  await page.evaluate(()=>{window.qaModalPops=0;window.addEventListener('popstate',()=>window.qaModalPops++)});
  await taskChip(page,'overflow-pending','#calendarDayList').click();
  await expect.poll(()=>page.evaluate(()=>window.qaModalPops)).toBe(1);
  await expect(page.locator('#calendarDayModal')).toBeHidden();
  await expect(page.locator('#gtTaskModal')).toBeVisible();
  await expect(page.locator('#gtTaskHeading')).toHaveText('Google 할 일 수정');
  expect(calls.some(c=>c.action==='toggle')).toBeFalsy();
});
