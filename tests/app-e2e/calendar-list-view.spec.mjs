import { test, expect } from '@playwright/test';
import { openEmphasisFixture } from './helpers/calendar-task-emphasis.mjs';
test.use({timezoneId:'Asia/Seoul'});
async function open(page,width=360,view='default'){
  await page.setViewportSize({width,height:844});
  return openEmphasisFixture(page,{view});
}
test('phone defaults to 14 date groups with empty days and separate tasks',async({page})=>{
  await open(page);
  await expect(page.locator('.clv-day')).toHaveCount(14);
  await expect(page.locator('.clv-day').first()).toContainText('오늘 · 10월 15일 목');
  await expect(page.locator('.clv-day').first()).toContainText('일정 없음');
  await expect(page.locator('.clv-day[data-date="2026-10-20"] .clv-tasks')).toHaveText('할 일 2개 ›');
  await expect(page.locator('#calendarList [data-calendar-task]')).toHaveCount(0);
  await page.locator('.clv-day[data-date="2026-10-20"] .clv-tasks').click();
  await expect(page.locator('#calendarDayEvents .cal-event')).toHaveCount(1);
  await expect(page.locator('#calendarDayTasks [data-calendar-task]')).toHaveCount(2);
  await expect(page.locator('#calendarDayTasks h3')).toHaveText('할 일');
  await expect(page.locator('#calendarDayModal')).not.toContainText('DAY SCHEDULE');
});
test('bottom loads another 14 days and navigation resets the range',async({page})=>{
  await open(page);
  await expect(page.locator('.clv-day')).toHaveCount(14);
  await page.locator('#calendarListMore').scrollIntoViewIfNeeded();
  await expect(page.locator('.clv-day')).toHaveCount(28);
  await page.locator('#nextMonthBtn').click();
  await expect(page.locator('.clv-day')).toHaveCount(14);
  await expect(page.locator('.clv-day').first()).toHaveAttribute('data-date','2026-10-29');
  await page.locator('#calendarTodayBtn').click();
  await expect(page.locator('.clv-day').first()).toHaveAttribute('data-date','2026-10-15');
});
for(const view of ['week','invalid'])test(`hidden or invalid ${view} falls back on phone`,async({page})=>{
  await open(page,360,view);
  await expect(page.locator('#calendarList')).toBeVisible();
});
test('chosen view survives reload; PC default stays month',async({page})=>{
  await open(page,1280);
  await expect(page.locator('#calendarGrid')).toBeVisible();
  await page.getByRole('button',{name:'목록',exact:true}).click();
  await expect(page.locator('#calendarList')).toBeVisible();
  await page.reload();
  await expect(page.locator('#calendarList')).toBeVisible();
  await page.getByRole('button',{name:'월간',exact:true}).click();
  await page.reload();
  await expect(page.locator('#calendarGrid')).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('kptu-calendar-view'))).toBe('month');
});

test('failed next page keeps the shown days and retries the same 14 day interval',async({page})=>{
  const {calls}=await open(page);
  await expect(page.locator('.clv-day')).toHaveCount(14);
  let failures=1;
  await page.route('**/functions/v1/google-calendar?action=events*',route=>{
    if(failures-->0)return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'QA read failure'})});
    return route.fallback();
  });
  await page.locator('#calendarListMore').scrollIntoViewIfNeeded();
  await expect(page.getByRole('button',{name:'다시 불러오기'})).toBeVisible();
  await expect(page.locator('.clv-day')).toHaveCount(14);
  await page.getByRole('button',{name:'다시 불러오기'}).click();
  await expect(page.locator('.clv-day')).toHaveCount(28);
  const last=calls.filter(c=>c.action==='events').at(-1);
  expect(last.min).toBe('2026-10-28T15:00:00.000Z');
  expect(last.max).toBe('2026-11-11T15:00:00.000Z');
  await expect(page.locator('.clv-day[data-date="2026-10-20"] [data-google-event="blue-0"]')).toHaveCount(1);
});
test('exclusive ends, all-day first, timed order and multi-day rows share the home boundaries',async({page})=>{
  await page.setViewportSize({width:360,height:844});
  const ev=(id,start,end,allDay=false)=>({id,title:'QA event',calendarId:'qa-cal',start,end,allDay,color:'#4285f4'});
  await openEmphasisFixture(page,{view:'default',events:[
    ev('late','2026-10-15T11:00:00+09:00','2026-10-15T12:00:00+09:00'),
    ev('early','2026-10-15T09:00:00+09:00','2026-10-16T00:00:00+09:00'),
    ev('span','2026-10-15','2026-10-17',true)
  ]});
  const first=page.locator('.clv-day').first();
  await expect(first.locator('[data-google-event]')).toHaveCount(3);
  expect(await first.locator('[data-google-event]').evaluateAll(rows=>rows.map(r=>r.dataset.googleEvent))).toEqual(['span','early','late']);
  await expect(page.locator('.clv-day[data-date="2026-10-16"] [data-google-event]')).toHaveCount(1);
  await expect(page.locator('.clv-day[data-date="2026-10-17"] [data-google-event]')).toHaveCount(0);
  const size=await first.locator('.clv-event').first().evaluate(el=>({height:el.getBoundingClientRect().height,font:getComputedStyle(el.querySelector('.clv-title')).fontSize,stripe:el.querySelector('.clv-color').getBoundingClientRect().toJSON()}));
  expect(size.height).toBeGreaterThanOrEqual(44);expect(size.font).toBe('14px');expect(size.stripe.width).toBe(4);expect(size.stripe.height).toBe(18);
  await first.locator('[data-google-event="early"]').click();
  await expect(page.locator('#ciGoogleModal')).toBeVisible();
});

test('forced refresh replaces old events while a next-page read is pending',async({page})=>{
  await open(page);await expect(page.locator('.clv-day')).toHaveCount(14);
  let release;const hold=new Promise(r=>release=r);let count=0;
  await page.route('**/functions/v1/google-calendar?action=events*',async route=>{
    if(++count===1)await hold;
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({events:[]})});
  });
  await page.evaluate(()=>document.querySelector('#calendarListMore').click());
  await expect.poll(()=>count).toBe(1);
  await page.evaluate(()=>window.__KPTU_RELOAD_GOOGLE_EVENTS__());
  await expect(page.locator('#calendarList [data-google-event]')).toHaveCount(0);
  await expect(page.locator('.clv-day')).toHaveCount(28);
  release();await expect(page.locator('#calendarListMore')).toBeEnabled();
  await expect(page.locator('#calendarList [data-google-event]')).toHaveCount(0);
});
test('disconnect unlocks pending pagination and discards its late response',async({page})=>{
  await open(page);await expect(page.locator('.clv-day')).toHaveCount(14);
  let release;const hold=new Promise(r=>release=r);let requested=false;
  await page.route('**/functions/v1/google-calendar?action=events*',async route=>{requested=true;await hold;return route.fallback()});
  await page.evaluate(()=>document.querySelector('#calendarListMore').click());
  await expect.poll(()=>requested).toBe(true);
  await page.evaluate(()=>window.KPTUCalendarPersistence.disconnected());
  await expect(page.locator('#calendarListMore')).toBeEnabled();
  release();await expect(page.locator('.clv-day')).toHaveCount(14);
  await expect(page.locator('#calendarList [data-google-event]')).toHaveCount(0);
});
test('background task refresh keeps the focused list control',async({page})=>{
  await open(page);await expect(page.locator('.clv-day[data-date="2026-10-20"] .clv-tasks')).toBeVisible();
  await page.locator('.clv-day[data-date="2026-10-20"] .clv-tasks').focus();
  await page.evaluate(()=>window.KPTUCalendarTasks.refresh());
  await expect(page.locator('.clv-day[data-date="2026-10-20"] .clv-tasks')).toBeFocused();
});
test('storage denied still opens the phone default and permits switching',async({page})=>{
  await page.addInitScript(()=>{const get=Storage.prototype.getItem,set=Storage.prototype.setItem;Storage.prototype.getItem=function(key){if(key==='kptu-calendar-view')throw new Error('QA storage denied');return get.call(this,key)};Storage.prototype.setItem=function(key,value){if(key==='kptu-calendar-view')throw new Error('QA storage denied');return set.call(this,key,value)}});
  await open(page);await expect(page.locator('#calendarList')).toBeVisible();
  await page.getByRole('button',{name:'월간',exact:true}).click();
  await expect(page.locator('#calendarGrid')).toBeVisible();
});

test('list today and query boundaries agree with home in another browser timezone',async({browser})=>{
  const context=await browser.newContext({timezoneId:'America/Los_Angeles',viewport:{width:360,height:844}}),page=await context.newPage();
  try{const {calls}=await openEmphasisFixture(page,{view:'default'});await expect(page.locator('.clv-day').first()).toHaveAttribute('data-date','2026-10-15');await expect(page.locator('.clv-day').first()).toContainText('오늘 · 10월 15일 목');await expect.poll(()=>calls.filter(c=>c.action==='events').length).toBeGreaterThan(0);expect(calls.find(c=>c.action==='events').min).toBe('2026-10-14T15:00:00.000Z')}finally{await context.close()}
});
