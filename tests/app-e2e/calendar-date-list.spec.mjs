import { test, expect } from '@playwright/test';
import { openEmphasisFixture, taskChip } from './helpers/calendar-task-emphasis.mjs';

test.use({timezoneId:'Asia/Seoul'});
const dateButton=(page,date)=>page.locator(`.cmv-date-list[data-date="${date}"]`);
async function open(page,width=390){
  await page.setViewportSize({width,height:844});
  const fixture=await openEmphasisFixture(page);
  await expect.poll(()=>page.evaluate(()=>!!window.__KPTU_MOBILE_MODAL_HISTORY__)).toBe(true);
  return fixture;
}
async function closeList(page){
  await page.locator('[data-close="calendarDayModal"]').click();
  await expect(page.locator('#calendarDayModal')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBeUndefined();
}
async function movement(page,dx,dy=0,date='2026-10-21'){
  return dateButton(page,date).evaluate((el,{dx,dy})=>{
    const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    const fire=(type,px,py)=>{
      const e=new Event(type,{bubbles:true,cancelable:true});
      Object.defineProperty(e,'touches',{value:type==='touchend'?[]:[{clientX:px,clientY:py}]});
      Object.defineProperty(e,'changedTouches',{value:[{clientX:px,clientY:py}]});
      el.dispatchEvent(e);return e.defaultPrevented;
    };
    fire('touchstart',x,y);const prevented=fire('touchmove',x+dx,y+dy);
    const transform=el.closest('.view-panel').style.transform;
    fire('touchend',x+dx,y+dy);el.click();return {prevented,transform};
  },{dx,dy});
}

// Losing the number route must open creation instead of the complete day list.
for(const [date,count] of [['2026-10-21',19],['2026-10-23',0]]){
  test(`number tap opens the full day list (${count?'busy':'empty'})`,async({page})=>{
    const {external}=await open(page);
    const button=dateButton(page,date);
    await expect(button).toHaveAccessibleName(`${Number(date.slice(5,7))}월 ${Number(date.slice(8))}일 목록 보기`);
    await button.click();
    await expect(page.locator('#calendarDayModal')).toBeVisible();
    await expect(page.locator('#calendarDayList .cal-event')).toHaveCount(count);
    if(!count)await expect(page.locator('#calendarDayList')).toContainText('일정 없음');
    await expect(page.locator('#eventModal')).toBeHidden();
    expect(external).toEqual([]);
  });
}
for(const edge of ['left','right','bottom']){
  test(`number ${edge} edge belongs to the day list`,async({page})=>{
    await open(page);
    const button=dateButton(page,'2026-10-21'),box=await button.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(32);
    const position=edge==='left'?{x:1,y:16}:edge==='right'?{x:box.width-1,y:16}:{x:box.width/2,y:box.height-1};
    await button.click({position});
    await expect(page.locator('#calendarDayModal')).toBeVisible();
    await expect(page.locator('#eventModal')).toBeHidden();
  });
}
test('blank creates on its date; event and overflow retain their editors and list',async({page})=>{
  await open(page);
  await page.locator('.cal-cell[data-date="2026-10-23"]').click({position:{x:10,y:60}});
  await expect(page.locator('#eventModal')).toBeVisible();
  await expect(page.locator('#eventStartDate')).toHaveValue('2026-10-23');
  await page.locator('[data-close="eventModal"]').click();
  await expect(page.locator('#eventModal')).toBeHidden();
  await page.locator('#calendarGrid [data-google-event="blue-0"]').click();
  await expect(page.locator('#ciGoogleModal')).toBeVisible();
  await expect(page.locator('#ciGoogleSave')).toBeEnabled();
  await page.locator('#ciGoogleClose').click();
  await expect(page.locator('#ciGoogleModal')).toBeHidden();
  await page.getByRole('button',{name:/10월 21일 일정 \d+개 더 보기/}).click();
  await expect(page.locator('#calendarDayModal')).toBeVisible();
  await expect(page.locator('#calendarDayList .cal-event')).toHaveCount(19);
});
test('the first event wins at the number area boundary',async({page})=>{
  await open(page);
  const button=await dateButton(page,'2026-10-20').boundingBox();
  const event=page.locator('#calendarGrid [data-google-event="blue-0"]'),box=await event.boundingBox();
  expect(Math.abs(box.y-(button.y+button.height))).toBeLessThanOrEqual(1);
  await page.mouse.click(box.x+box.width/2,box.y);
  await expect(page.locator('#ciGoogleModal')).toBeVisible();
  await expect(page.locator('#calendarDayModal')).toBeHidden();
});
test('12px jitter stays a tap; larger moves suppress clicks and preserve menu swipes',async({page})=>{
  await open(page);
  await page.clock.install();
  for(const [dx,dy] of [[12,0],[-12,0],[0,12],[0,-12],[12,12]]){
    expect(await movement(page,dx,dy)).toEqual({prevented:false,transform:''});
    await expect(page.locator('#calendarDayModal')).toBeVisible();
    await closeList(page);
  }
  for(const [dx,dy] of [[13,0],[0,13],[-170,0]]){
    await movement(page,dx,dy);
    await expect(page.locator('#calendarDayModal')).toBeHidden();
    if(dx===-170)await expect(page.locator('#tasksView')).toBeVisible();
    else{
      expect(await page.evaluate(()=>KPTUCalendarMonthView.suppressClick())).toBe(true);
      await page.clock.fastForward(350);
      expect(await page.evaluate(()=>KPTUCalendarMonthView.suppressClick())).toBe(false);
    }
  }
});
test('zoomed numbers still open lists and movement leaves navigation to viewport pan',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Asia/Seoul'});
  const page=await context.newPage();
  try{
    await open(page);
    const cdp=await context.newCDPSession(page);
    await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:2});
    await expect.poll(()=>page.evaluate(()=>visualViewport.scale)).toBeGreaterThan(1.01);
    await expect.poll(()=>dateButton(page,'2026-09-27').evaluate(el=>getComputedStyle(el).touchAction)).toBe('auto');
    await test.step('tap a visible zoomed number',()=>dateButton(page,'2026-09-27').tap({timeout:5000}));
    await expect(page.locator('#calendarDayModal')).toBeVisible();
    await page.evaluate(()=>history.back());
    await expect(page.locator('#calendarDayModal')).toBeHidden();
    for(const [dx,dy] of [[-170,0],[170,0],[0,100]]){
      expect(await movement(page,dx,dy,'2026-09-27')).toEqual({prevented:false,transform:''});
      await expect(page.locator('#calendarDayModal')).toBeHidden();
      expect(await page.evaluate(()=>KPTURouter.current)).toBe('calendar');
    }
    const before=await page.evaluate(()=>({left:visualViewport.pageLeft,top:visualViewport.pageTop,month:document.querySelector('#monthTitle').textContent}));
    const point=await dateButton(page,'2026-09-29').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+16}});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
    for(const dx of [40,80])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x-dx,y:point.y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect.poll(()=>page.evaluate(()=>visualViewport.pageLeft)).toBeGreaterThan(before.left);
    expect(await page.evaluate(()=>KPTURouter.current)).toBe('calendar');
    await expect(page.locator('#monthTitle')).toHaveText(before.month);
    await expect(page.locator('.modal:not(.hidden)')).toHaveCount(0);
  }finally{await context.close().catch(()=>{})}
});
test('number buttons support keyboard activation without nested buttons',async({page})=>{
  await open(page);
  await expect(page.locator('#calendarGrid button button')).toHaveCount(0);
  const number=dateButton(page,'2026-10-23');
  const size=await number.evaluate(el=>({button:el.getBoundingClientRect().width,cell:el.closest('.cal-cell').getBoundingClientRect().width}));
  expect(size.button).toBe(size.cell);
  await number.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#calendarDayModal')).toBeVisible();
});
for(const width of [761,1280]){
  test(`desktop keeps numbers inside the existing create button (${width}px)`,async({page})=>{
    await open(page,width);
    await expect(page.locator('.cmv-date-list')).toHaveCount(0);
    await page.locator('.cal-cell[data-date="2026-10-23"] .cal-day').click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await expect(page.locator('#eventStartDate')).toHaveValue('2026-10-23');
  });
}
for(const kind of ['task','google']){
  test(`number list uses closeThen before opening its ${kind} editor`,async({page})=>{
    await open(page);
    const calendarUrl=page.url();
    await dateButton(page,'2026-10-21').click();
    await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBe('calendarDayModal');
    await page.evaluate(()=>{window.qaBack=history.back.bind(history);history.back=()=>{window.qaHeld=true}});
    const modal=page.locator(kind==='task'?'#gtTaskModal':'#ciGoogleModal');
    if(kind==='task')await taskChip(page,'overflow-pending','#calendarDayList').click();
    else await page.locator('#calendarDayList [data-google-event="overflow-event"]').click();
    await expect.poll(()=>page.evaluate(()=>window.qaHeld)).toBe(true);
    await expect(modal).toBeHidden();
    await page.evaluate(()=>{history.back=window.qaBack;history.back()});
    await expect(modal).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBe(kind==='task'?'gtTaskModal':'ciGoogleModal');
    await page.evaluate(()=>history.back());
    await expect(modal).toBeHidden();
    await expect(page.locator('#calendarView')).toBeVisible();
    expect(page.url()).toBe(calendarUrl);
  });
}
test('number list closes with one back and toolbar plus uses today after another day',async({page})=>{
  await open(page);
  const calendarUrl=page.url();
  await dateButton(page,'2026-10-21').click();
  await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay)).toBe('calendarDayModal');
  await page.evaluate(()=>history.back());
  await expect(page.locator('#calendarDayModal')).toBeHidden();
  expect(page.url()).toBe(calendarUrl);
  await page.locator('#newEventBtn').click();
  await expect(page.locator('#eventStartDate')).toHaveValue('2026-10-15');
  await expect(page.locator('#eventStartTime')).toHaveValue('12:00');
});

test('release clicks remain guarded while the optional menu module is unavailable',async({page})=>{
  await open(page);
  await page.clock.install();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.evaluate(()=>{delete window.KPTUMobileSwipeNavigation});
  await movement(page,20);
  expect(errors).toEqual([]);
  expect(await page.evaluate(()=>KPTUCalendarMonthView.suppressClick())).toBe(true);
  await expect(page.locator('#calendarDayModal')).toBeHidden();
  await page.clock.fastForward(350);
  await dateButton(page,'2026-10-21').click();
  await expect(page.locator('#calendarDayModal')).toBeVisible();
});

test('short six-week mobile rows keep events and overflow inside their own dates',async({page})=>{
  await page.setViewportSize({width:390,height:400});
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/calendar-month-view-fixture.html');
  await page.evaluate(()=>window.renderDensityFixture({year:2026,month:7,dateCounts:{'2026-08-13':2}}));
  await expect(page.locator('.cmv-week')).toHaveCount(6);
  const metrics=await page.locator('.cmv-week').evaluateAll(weeks=>weeks.flatMap(week=>{
    const wb=week.getBoundingClientRect();
    return [...week.querySelectorAll('.cmv-event,.kptu-day-more')].map(item=>{
      const b=item.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.bottom-1);
      return {bottom:b.bottom,weekBottom:wb.bottom,hitMatches:item.contains(hit)};
    });
  }));
  expect(metrics.length).toBeGreaterThan(0);
  for(const m of metrics){expect(m.bottom).toBeLessThanOrEqual(m.weekBottom);expect(m.hitMatches).toBe(true)}
  await expect(page.locator('.kptu-day-more')).toHaveText('+2');
  await page.locator('.kptu-day-more').click();
  await expect(page.locator('#calendarDayTitle')).toContainText('8월 13일');
  await expect(page.locator('#calendarDayList .cal-event')).toHaveCount(2);
});
