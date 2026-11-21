import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { expectGoogleDisplay } from './helpers/calendar-google-display.mjs';
import { toneColor } from '../../app/event-color.mjs';
const rgbOf=hex=>`rgb(${hex.slice(1).match(/../g).map(x=>parseInt(x,16)).join(', ')})`;
const fixture=`${appOrigin}/tests/app-e2e/calendar-month-view-fixture.html`;
test.use({timezoneId:'Asia/Seoul'});

for(const width of [390,1023,1024,1280]){
  test('month events are solid toned chips on phone and PC (S67-65 E1, '+width+'px)',async({page})=>{
    await page.setViewportSize({width,height:844});await page.goto(fixture);
    const desktop=width>=761;
    for(const id of ['app-1','recurring'])await expectGoogleDisplay(page.locator('[data-google-event="'+id+'"]'));
    await expect(page.locator('[data-google-event="app-1"]')).toHaveCSS('height',desktop?'18px':width<=760?'14px':'13px'); // S48-6: 폰(≤760) 막대 14px
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
  // S67-65 E1: 칠하는 색은 고른 구글 색을 톤 낮춘 값(event-color.mjs). 고르는 순서(일정 색 → 내 캘린더 색 → 캘린더 기본 색 → 기본 파랑)는 그대로.
  for(const [id,color] of [['event-override',rgbOf(toneColor('#8e24aa'))],['preference',rgbOf(toneColor('#f6bf26'))],['calendar-color',rgbOf(toneColor('#7cb342'))],['default-color',rgbOf(toneColor('#4285f4'))]]){
    const chip=page.locator('[data-google-event="'+id+'"]');
    expect(await chip.evaluate(el=>el.style.backgroundColor)).toBe(color);await expectGoogleDisplay(chip);
  }
});

test('the phone +N list uses solid event rows without compacting rows or changing task status marks',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto(fixture);
  await page.evaluate(()=>window.KPTUCalendarMonthView.setTasks([{id:'task-pending',date:'2026-09-03',title:'시험 항목'},{id:'task-overdue',date:'2026-09-03',title:'시험 항목',overdue:true},{id:'task-done',date:'2026-09-03',title:'시험 항목',done:true}]));
  await page.locator('.kptu-day-more').first().click();await expect(page.locator('#calendarDayModal')).toBeVisible();
  await expect(page.locator('#calendarDayList')).toHaveCSS('gap','5px');
  const event=page.locator('#calendarDayList [data-google-event="app-1"]');await expectGoogleDisplay(event);
  await expect(event).toHaveCSS('min-height','44px');expect(await event.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);await expect(event).toHaveCSS('font-size','14px');await expect(event.locator('.cmv-day-title')).toHaveCSS('font-weight','400');
  await expect(event.locator('.cmv-day-time')).toHaveCSS('font-weight','400');
  const task=id=>page.locator('#calendarDayList [data-calendar-task="'+id+'"]');
  await expect(task('task-pending')).toHaveCSS('font-weight','800');await expect(task('task-pending')).toHaveCSS('border-left-width','1px');
  await expect(task('task-pending')).toHaveCSS('background-color','rgb(238, 244, 248)');
  await expect(task('task-overdue')).toHaveCSS('border-left-color','rgb(154, 64, 72)');
  await expect(task('task-done')).toHaveCSS('opacity','0.55');await expect(task('task-done').locator('.cmv-event-title')).toHaveCSS('text-decoration-line','line-through');
});
