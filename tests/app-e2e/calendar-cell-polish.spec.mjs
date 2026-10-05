import { test, expect } from '@playwright/test';
import { expectGoogleDisplay } from './helpers/calendar-google-display.mjs';
const fixture='http://127.0.0.1:8123/tests/app-e2e/calendar-month-view-fixture.html';
test.use({timezoneId:'Asia/Seoul'});

for(const width of [390,1023,1024,1280]){
  test('month events use A below the PC boundary and C on PC ('+width+'px)',async({page})=>{
    await page.setViewportSize({width,height:844});await page.goto(fixture);
    const desktop=width>=1024;
    for(const id of ['app-1','recurring'])await expectGoogleDisplay(page.locator('[data-google-event="'+id+'"]'),{stripe:desktop?4:0,tint:desktop?.08:.15});
    await expect(page.locator('[data-google-event="app-1"]')).toHaveCSS('height',desktop?'18px':'13px');
    const multi=page.locator('[data-google-event="multi"]');await expect(multi).toHaveCount(2);
    await expect(multi.first()).toHaveClass(/cmv-continues-right/);await expect(multi.nth(1)).toHaveClass(/cmv-continues-left/);
    await expect(multi.first()).toHaveCSS('border-top-right-radius','0px');
    await expect(multi.nth(1)).toHaveCSS('border-top-left-radius','0px');
  });
}

test('bright event colors remain readable and resolved color precedence is preserved',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto(fixture);
  await page.evaluate(()=>window.KPTUCalendarMonthView.render({year:2026,month:8,googleState:{colors:{custom:'#f6bf26'},calendars:[{id:'custom',backgroundColor:'#d50000'},{id:'calendar',backgroundColor:'#7cb342'}]},googleEvents:[
    {id:'event-override',calendarId:'custom',title:'시험 일정',start:'2026-09-20T09:00:00+09:00',end:'2026-09-20T10:00:00+09:00',color:'#8e24aa'},
    {id:'preference',calendarId:'custom',title:'시험 일정',start:'2026-09-21T09:00:00+09:00',end:'2026-09-21T10:00:00+09:00'},
    {id:'calendar-color',calendarId:'calendar',title:'시험 일정',start:'2026-09-22T09:00:00+09:00',end:'2026-09-22T10:00:00+09:00'},
    {id:'default-color',calendarId:'unknown',title:'시험 일정',start:'2026-09-23T09:00:00+09:00',end:'2026-09-23T10:00:00+09:00'}
  ]}));
  for(const [id,color] of [['event-override','rgb(142, 36, 170)'],['preference','rgb(246, 191, 38)'],['calendar-color','rgb(124, 179, 66)'],['default-color','rgb(66, 133, 244)']]){
    const chip=page.locator('[data-google-event="'+id+'"]');
    expect(await chip.evaluate(el=>el.style.backgroundColor)).toBe(color);await expectGoogleDisplay(chip);
  }
});

test('the phone +N list uses C without compacting rows or changing task status marks',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto(fixture);
  await page.evaluate(()=>window.KPTUCalendarMonthView.setTasks([{id:'task-pending',date:'2026-09-03',title:'시험 항목'},{id:'task-overdue',date:'2026-09-03',title:'시험 항목',overdue:true},{id:'task-done',date:'2026-09-03',title:'시험 항목',done:true}]));
  await page.locator('.kptu-day-more').first().click();await expect(page.locator('#calendarDayModal')).toBeVisible();
  await expect(page.locator('#calendarDayList')).toHaveCSS('gap','5px');
  const event=page.locator('#calendarDayList [data-google-event="app-1"]');await expectGoogleDisplay(event,{stripe:4,tint:.08});
  await expect(event).toHaveCSS('height','34px');await expect(event.locator('.cmv-day-title')).toHaveCSS('font-weight','400');
  await expect(event.locator('.cmv-day-time')).toHaveCSS('font-weight','400');
  const task=id=>page.locator('#calendarDayList [data-calendar-task="'+id+'"]');
  await expect(task('task-pending')).toHaveCSS('font-weight','800');await expect(task('task-pending')).toHaveCSS('border-left-width','1px');
  await expect(task('task-pending')).toHaveCSS('background-color','rgb(238, 244, 248)');
  await expect(task('task-overdue')).toHaveCSS('border-left-color','rgb(154, 64, 72)');
  await expect(task('task-done')).toHaveCSS('opacity','0.55');await expect(task('task-done').locator('.cmv-event-title')).toHaveCSS('text-decoration-line','line-through');
});
