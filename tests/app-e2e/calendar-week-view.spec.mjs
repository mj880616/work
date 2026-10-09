import {test,expect} from '@playwright/test';
import {openEmphasisFixture} from './helpers/calendar-task-emphasis.mjs';

test.use({timezoneId:'Asia/Seoul'});
async function open(page,width=1280,view='default',events){
  await page.setViewportSize({width,height:844});
  const result=await openEmphasisFixture(page,{view,...(events?{events}:{})});
  await page.evaluate(()=>window.__KPTU_CALENDAR_PERSISTENCE_READY__);
  return result;
}
test('PC default week has Monday through Sunday and one KST seven-day request',async({page})=>{
  const {calls}=await open(page);
  await expect(page.locator('#calendarWeek')).toBeVisible();
  await expect(page.locator('.cwv-day')).toHaveCount(7);
  expect(await page.locator('.cwv-date').allTextContents()).toEqual(['월 12','화 13','수 14','목 15','금 16','토 17','일 18']);
  await expect(page.locator('#monthTitle .calendar-title-full')).toHaveText('10월 12일 – 18일');
  await expect.poll(()=>calls.filter(c=>c.action==='events').length).toBe(1);
  const request=calls.find(c=>c.action==='events');
  expect(request.min).toBe('2026-10-11T15:00:00.000Z');
  expect(request.max).toBe('2026-10-18T15:00:00.000Z');
  await expect(page.locator('#calendarListMore')).not.toBeVisible();
  const current=page.locator('.cwv-day[data-date="2026-10-15"]');
  await expect(current).toHaveClass(/cwv-today/);
  await expect(current).toContainText('일정 없음');
  const colors=await current.evaluate(el=>({background:getComputedStyle(el).backgroundColor,expected:getComputedStyle(document.documentElement).getPropertyValue('--kptu-primary-soft').trim(),weight:getComputedStyle(el.querySelector('.cwv-date')).fontWeight}));
  expect(colors.weight).toBe('700');
  expect(colors.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(await page.locator('.cwv-date').first().evaluate(el=>el.getBoundingClientRect().width)).toBe(72);
});
test('phone defaults to list; chosen week survives reload and has 56px dates',async({page})=>{
  await open(page,360);
  await expect(page.locator('#calendarList')).toBeVisible();
  for(const name of ['목록 보기','주간 보기','월간 보기'])await expect(page.getByRole('button',{name,exact:true})).toBeVisible();
  await page.getByRole('button',{name:'주간 보기',exact:true}).click();
  await expect(page.locator('#calendarWeek')).toBeVisible();
  expect(await page.evaluate(()=>localStorage.getItem('kptu-calendar-view'))).toBe('week');
  await page.reload();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  await expect(page.locator('#calendarWeek')).toBeVisible();
  await expect(page.locator('.cwv-day')).toHaveCount(7);
  expect(await page.locator('.cwv-date').first().evaluate(el=>el.getBoundingClientRect().width)).toBe(56);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(360);
});
for(const [width,view,expected] of [[360,'week','Week'],[1280,'week','Week'],[360,'month','Grid'],[1280,'invalid','Week'],[360,'invalid','List'],[760,'default','List'],[761,'default','Week']]){
  test(`saved ${view} at ${width} opens ${expected}`,async({page})=>{
    await open(page,width,view);await expect(page.locator('#calendar'+expected)).toBeVisible();
  });
}
test('week arrows move seven days, titles truncate across months and today resets to this week',async({page})=>{
  const {calls}=await open(page,360,'week');
  await page.locator('#nextMonthBtn').click();
  await expect(page.locator('.cwv-day').first()).toHaveAttribute('data-date','2026-10-19');
  await expect.poll(()=>calls.filter(c=>c.action==='events').length).toBe(2);
  for(let i=0;i<3;i++)await page.locator('#prevMonthBtn').click();
  await expect(page.locator('#monthTitle .calendar-title-compact')).toHaveText('9월');
  await expect(page.locator('#monthTitle')).toHaveAccessibleName('2026년 9월 28일 – 2026년 10월 4일');
  const title=await page.locator('#monthTitle').evaluate(el=>({height:el.getBoundingClientRect().height,line:parseFloat(getComputedStyle(el).lineHeight),space:getComputedStyle(el).whiteSpace,overflow:getComputedStyle(el).textOverflow}));
  expect(title.height).toBeLessThanOrEqual(title.line+0.5);expect(title.space).toBe('nowrap');expect(title.overflow).toBe('ellipsis');
  await page.locator('#calendarTodayBtn').click();
  await expect(page.locator('.cwv-day').first()).toHaveAttribute('data-date','2026-10-12');
});
test('week shares event ordering, exclusive ends, task links and existing dialogs',async({page})=>{
  const ev=(id,start,end,allDay=false)=>({id,title:'QA event',calendarId:'qa-cal',start,end,allDay,color:'#4285f4'});
  await open(page,360,'week',[
    ev('late','2026-10-15T11:00:00+09:00','2026-10-15T12:00:00+09:00'),
    ev('early','2026-10-15T09:00:00+09:00','2026-10-16T00:00:00+09:00'),
    ev('span','2026-10-15','2026-10-17',true),
    ...Array.from({length:16},(_,i)=>ev('dense-'+i,'2026-10-20','2026-10-21',true))
  ]);
  const day=page.locator('.cwv-day[data-date="2026-10-15"]');
  await expect(day.locator('[data-google-event]')).toHaveCount(3);
  expect(await day.locator('[data-google-event]').evaluateAll(rows=>rows.map(r=>r.dataset.googleEvent))).toEqual(['span','early','late']);
  await expect(page.locator('.cwv-day[data-date="2026-10-16"] [data-google-event]')).toHaveCount(1);
  await expect(page.locator('.cwv-day[data-date="2026-10-17"] [data-google-event]')).toHaveCount(0);
  const geometry=await day.locator('.clv-event').first().evaluate(el=>({height:el.getBoundingClientRect().height,title:getComputedStyle(el.querySelector('.clv-title')).fontSize,time:getComputedStyle(el.querySelector('.clv-time')).fontSize,stripe:el.querySelector('.clv-color').getBoundingClientRect().toJSON()}));
  expect(geometry.height).toBeGreaterThanOrEqual(44);expect(geometry.title).toBe('14px');expect(geometry.time).toBe('12px');expect(geometry.stripe.width).toBe(4);expect(geometry.stripe.height).toBe(18);
  await day.locator('[data-google-event="early"]').click();await expect(page.locator('#ciGoogleModal')).toBeVisible();
  await page.locator('#ciGoogleClose').first().click();
  await page.locator('#nextMonthBtn').click();
  const dense=page.locator('.cwv-day[data-date="2026-10-20"]');
  await expect(dense.locator('.clv-event')).toHaveCount(16);
  await expect(dense.locator('.clv-tasks')).toHaveText('할 일 1개 ›');
  expect(await dense.evaluate(el=>el.getBoundingClientRect().height)).toBeGreaterThan(16*44);
  await expect(page.locator('.cwv-day[data-date="2026-10-21"] .clv-tasks')).toHaveText('일정 없음 · 할 일 17개 ›');
  await page.locator('.cwv-day[data-date="2026-10-21"] .clv-tasks').click();
  await expect(page.locator('#calendarDayModal')).toBeVisible();
  await expect(page.locator('#calendarDayTasks [data-calendar-task]')).toHaveCount(18);
});
test('KST week start agrees with home on an overseas device',async({browser})=>{
  const context=await browser.newContext({timezoneId:'America/Los_Angeles',viewport:{width:1280,height:844}}),page=await context.newPage();
  try{const {calls}=await openEmphasisFixture(page,{view:'week'});await expect(page.locator('.cwv-day').first()).toHaveAttribute('data-date','2026-10-12');expect(calls.find(c=>c.action==='events').min).toBe('2026-10-11T15:00:00.000Z')}finally{await context.close()}
});

test('week keeps keyboard focus during task refresh',async({page})=>{
  await open(page,360,'week');await page.locator('#nextMonthBtn').click();
  const link=page.locator('.cwv-day[data-date="2026-10-20"] .clv-tasks');
  await expect(link).toBeVisible();await link.focus();
  await page.evaluate(()=>window.KPTUCalendarTasks.refresh());
  await expect(link).toBeFocused();
});
test('late previous-week response cannot replace the latest week',async({page})=>{
  await open(page,360,'week');
  let release,count=0;const hold=new Promise(r=>release=r);
  await page.route('**/functions/v1/google-calendar?action=events*',async route=>{
    const old=++count===1;if(old)await hold;
    const date=old?'2026-10-20':'2026-10-27';
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({events:[{id:old?'old-week':'latest-week',calendarId:'qa-cal',title:'QA event',start:date,end:old?'2026-10-21':'2026-10-28',allDay:true}]})});
  });
  await page.locator('#nextMonthBtn').click();await expect.poll(()=>count).toBe(1);
  await page.locator('#nextMonthBtn').click();
  await expect(page.locator('#calendarWeek [data-google-event="latest-week"]')).toBeVisible();
  const oldResponse=page.waitForResponse(response=>response.url().includes('action=events')&&new URL(response.url()).searchParams.get('timeMin')==='2026-10-18T15:00:00.000Z');
  release();await (await oldResponse).finished();
  await expect(page.locator('.cwv-day').first()).toHaveAttribute('data-date','2026-10-26');
  await expect(page.locator('#calendarWeek [data-google-event="latest-week"]')).toHaveCount(1);
  await expect(page.locator('#calendarWeek [data-google-event="old-week"]')).toHaveCount(0);
});
test('phone swipe keeps week dates while navigating the bottom tabs',async({page})=>{
  await open(page,360,'week');
  await expect.poll(()=>page.evaluate(()=>!!window.__KPTU_MOBILE_SWIPE_NAV__)).toBe(true);
  const before=await page.locator('#monthTitle').textContent();
  await page.locator('.cwv-day').first().evaluate(el=>{
    const r=el.getBoundingClientRect(),y=r.top+r.height/2;
    for(const [type,x] of [['touchstart',280],['touchmove',180],['touchend',100]]){
      const event=new Event(type,{bubbles:true,cancelable:true}),point={clientX:x,clientY:y};
      Object.defineProperty(event,'touches',{value:type==='touchend'?[]:[point]});
      Object.defineProperty(event,'changedTouches',{value:[point]});el.dispatchEvent(event);
    }
  });
  await expect(page.locator('#tasksView')).toBeVisible();
  await page.evaluate(()=>window.KPTURouter.go('calendar',{source:'test'}));
  await expect(page.locator('#monthTitle')).toHaveText(before);
});
