import { test, expect } from '@playwright/test';
import { openEmphasisFixture, taskChip, BLUE_COLORS } from './helpers/calendar-task-emphasis.mjs';

import { expectGoogleDisplay } from './helpers/calendar-google-display.mjs';

test.use({timezoneId:'Asia/Seoul'});

async function expectPending(chip){
  await expect(chip).toHaveCSS('background-color','rgb(238, 244, 248)');
  await expect(chip).toHaveCSS('color','rgb(53, 95, 134)');
  await expect(chip).toHaveCSS('border-top-color','rgb(53, 95, 134)');
  await expect(chip).toHaveCSS('border-top-width','1px');
  await expect(chip).toHaveCSS('border-top-style','solid');
  await expect(chip).toHaveCSS('font-weight','800');
  await expect(chip).toHaveCSS('opacity','1');
  await expect(chip.locator('.cmv-task-mark')).toHaveText('');
  await expect(chip.locator('.cmv-task-mark')).toHaveCSS('border-top-style','solid');
  await expect(chip.locator('.cmv-task-mark')).toHaveCSS('border-top-left-radius','999px');
}

async function expectDone(chip,weight='700'){
  await expect(chip).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(chip).toHaveCSS('color','rgb(31, 41, 51)');
  await expect(chip).toHaveCSS('border-top-color','rgb(207, 214, 220)');
  await expect(chip).toHaveCSS('font-weight',weight);
  await expect(chip).toHaveCSS('opacity','0.55');
  await expect(chip.locator('.cmv-event-title')).toHaveCSS('text-decoration-line','line-through');
  await expect(chip.locator('.cmv-task-mark')).toHaveText('✓');
}

for(const width of [390,1280]){
  test(`pending tasks stand out beside blue events while completed and overdue states remain (${width}px)`,async({page})=>{
    await page.setViewportSize({width,height:844});
    const {calls,external}=await openEmphasisFixture(page);
    await expectPending(taskChip(page,'pending'));
    await expectDone(taskChip(page,'done'));
    const overdue=taskChip(page,'overdue');
    await expect(overdue).toHaveCSS('background-color','rgb(238, 244, 248)');
    await expect(overdue).toHaveCSS('color','rgb(53, 95, 134)');
    await expect(overdue).toHaveCSS('font-weight','800');
    await expect(overdue).toHaveCSS('border-top-color','rgb(154, 64, 72)');
    await expect(overdue.locator('.cmv-task-mark')).toHaveCSS('color','rgb(154, 64, 72)');
    await expect(overdue).toHaveAttribute('aria-label',/기한 지남$/);
    for(const [i,color] of BLUE_COLORS.entries()){
      const rgb=color.slice(1).match(/../g).map(x=>parseInt(x,16));
      const chip=page.locator(`#calendarGrid [data-google-event="blue-${i}"]`);
      expect(await chip.evaluate(el=>el.style.backgroundColor)).toBe(`rgb(${rgb.join(', ')})`);
      await expectGoogleDisplay(chip,{stripe:width>=1024?4:0,tint:width>=1024?.08:.15});
    }
    await taskChip(page,'pending').click();
    await expect(page.locator('#gtTaskModal')).toBeVisible();
    await expect(page.locator('#gtTaskHeading')).toHaveText('Google 할 일 수정');
    await expect(page.locator('#gtEditDue')).toHaveValue('2026-10-20');
    expect(calls.some(c=>c.action==='toggle')).toBeFalsy();
    expect(external).toEqual([]);
  });
}

test('the +N list shares pending and completed task styles',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const {calls}=await openEmphasisFixture(page);
  await page.getByRole('button',{name:/10월 21일 일정 \d+개 더 보기/}).click();
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
