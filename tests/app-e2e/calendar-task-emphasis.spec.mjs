import { test, expect } from '@playwright/test';
import { openEmphasisFixture, taskChip, openTaskDay, BLUE_COLORS } from './helpers/calendar-task-emphasis.mjs';

import { expectGoogleDisplay } from './helpers/calendar-google-display.mjs';

test.use({timezoneId:'Asia/Seoul'});

// UI-디자인손질 2: in the day list a task is a plain row — no fill, no border, name 13px·400 — with a check circle;
// a completed one keeps the faded, struck style with ✓. The month chips keep their own look (tested elsewhere).
async function expectPending(chip){
  await expect(chip).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(chip).toHaveCSS('border-left-width','0px');
  await expect(chip).toHaveCSS('border-right-width','0px');
  await expect(chip).toHaveCSS('opacity','1');
  await expect(chip.locator('.cmv-event-title')).toHaveCSS('color','rgb(42, 42, 35)');
  await expect(chip.locator('.cmv-event-title')).toHaveCSS('font-size','13px');
  await expect(chip.locator('.cmv-event-title')).toHaveCSS('font-weight','400');
  await expect(chip.locator('.cmv-task-mark')).toHaveText('');
  await expect(chip.locator('.cmv-task-mark')).toHaveCSS('border-top-style','solid');
  await expect(chip.locator('.cmv-task-mark')).toHaveCSS('border-top-left-radius','999px');
  await expect(chip.locator('.kptu-day-overdue')).toHaveCount(0);
}
async function expectDone(chip){
  await expect(chip).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
  await expect(chip).toHaveCSS('border-left-width','0px');
  await expect(chip).toHaveCSS('opacity','0.55');
  await expect(chip.locator('.cmv-event-title')).toHaveCSS('font-weight','400');
  await expect(chip.locator('.cmv-event-title')).toHaveCSS('text-decoration-line','line-through');
  await expect(chip.locator('.cmv-task-mark')).toHaveText('✓');
  // The ✓ stays readable: light glyph on the filled circle.
  const mark=await chip.locator('.cmv-task-mark').evaluate(el=>{const s=getComputedStyle(el);return [s.color,s.backgroundColor];});
  expect(mark[0]).not.toBe(mark[1]);
}

for(const width of [390,1280]){
  test(`day-list pending styles and month blue events while completed and overdue states remain (${width}px)`,async({page})=>{
    await page.setViewportSize({width,height:844});
    const {calls,external}=await openEmphasisFixture(page);
    await openTaskDay(page);
    await expectPending(taskChip(page,'pending'));
    await expectDone(taskChip(page,'done'));
    await openTaskDay(page,'2026-10-10');
    // Overdue: no red border; only a small red "지남" on the right.
    const overdue=taskChip(page,'overdue');
    await expect(overdue).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
    await expect(overdue).toHaveCSS('border-left-width','0px');
    await expect(overdue.locator('.kptu-day-overdue')).toHaveText('지남');
    await expect(overdue.locator('.kptu-day-overdue')).toHaveCSS('color','rgb(180, 35, 24)');
    const [row,badge]=await Promise.all([overdue.boundingBox(),overdue.locator('.kptu-day-overdue').boundingBox()]);
    expect(row.x+row.width-(badge.x+badge.width)).toBeLessThanOrEqual(2);
    await expect(overdue).toHaveAttribute('aria-label',/기한 지남$/);
    await page.locator('[data-close="calendarDayModal"]').click();
    await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBeUndefined();
    for(const [i,color] of BLUE_COLORS.entries()){
      const rgb=color.slice(1).match(/../g).map(x=>parseInt(x,16));
      const chip=page.locator(`#calendarGrid [data-google-event="blue-${i}"]`);
      expect(await chip.evaluate(el=>el.style.backgroundColor)).toBe(`rgb(${rgb.join(', ')})`);
      await expectGoogleDisplay(chip,{stripe:width>=761?4:0,tint:width>=761?.08:.15});
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
  await expectDone(taskChip(page,'overflow-done','#calendarDayList'));
  await page.evaluate(()=>{window.qaModalPops=0;window.addEventListener('popstate',()=>window.qaModalPops++)});
  await taskChip(page,'overflow-pending','#calendarDayList').click();
  await expect.poll(()=>page.evaluate(()=>window.qaModalPops)).toBe(1);
  await expect(page.locator('#calendarDayModal')).toBeHidden();
  await expect(page.locator('#gtTaskModal')).toBeVisible();
  await expect(page.locator('#gtTaskHeading')).toHaveText('Google 할 일 수정');
  expect(calls.some(c=>c.action==='toggle')).toBeFalsy();
});
