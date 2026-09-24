import {test,expect} from '@playwright/test';

const url='http://127.0.0.1:8123/tests/app-e2e/calendar-month-view-fixture.html';

test('five-week month uses 35 dense date cells with adjacent-month dates',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(url);
  await expect(page.locator('.cal-cell')).toHaveCount(35);
  await expect(page.locator('.cmv-week')).toHaveCount(5);
  await expect(page.locator('.cal-cell.other')).not.toHaveCount(0);
  await expect(page.locator('.cal-head')).toHaveCount(7);
});

test('six-week month expands to 42 cells without a separate renderer',async({page})=>{
  await page.goto(url);
  await page.evaluate(()=>window.renderMonth(2026,7));
  await expect(page.locator('.cmv-week')).toHaveCount(6);
  await expect(page.locator('.cal-cell')).toHaveCount(42);
});

test('Web2 and Google schedules share the same month renderer and preserve colors',async({page})=>{
  await page.goto(url);
  await expect(page.locator('.cm-app[data-app-event="app-1"]')).toHaveCount(1);
  await expect(page.locator('.cp-event[data-google-event="recurring"]')).toHaveCount(1);
  expect(await page.locator('.cm-app[data-app-event="app-1"]').evaluate(el=>el.style.background)).not.toBe('');
  expect(await page.locator('.cp-event[data-google-event="recurring"]').evaluate(el=>el.style.background)).not.toBe('');
});

test('multi-day schedule renders as continuous weekly segments across a week boundary',async({page})=>{
  await page.goto(url);
  const multi=page.locator('[data-google-event="multi"]');
  await expect(multi).toHaveCount(2);
  await expect(multi.first()).toHaveClass(/cmv-continues-right/);
  await expect(multi.nth(1)).toHaveClass(/cmv-continues-left/);
  expect(await multi.first().evaluate(el=>el.style.gridColumn)).toContain('span 2');
});

test('overflow indicator opens the full day schedule instead of growing the date cell',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(url);
  const more=page.locator('.kptu-day-more').first();
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.locator('#calendarDayModal')).toBeVisible();
  await expect(page.locator('#calendarDayList .cal-event')).toHaveCount(8);
});

test('horizontal swipe changes month while vertical movement does not',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(url);
  await page.locator('#calendarGrid').evaluate(el=>{
    const fire=(type,x,y,key='touches')=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,key,{value:[{clientX:x,clientY:y}]});el.dispatchEvent(e)};
    fire('touchstart',330,360);fire('touchend',90,365,'changedTouches');
  });
  await expect.poll(()=>page.evaluate(()=>window.__navDelta)).toBe(1);
  await page.evaluate(()=>window.__navDelta=0);
  await page.locator('#calendarGrid').evaluate(el=>{
    const fire=(type,x,y,key='touches')=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,key,{value:[{clientX:x,clientY:y}]});el.dispatchEvent(e)};
    fire('touchstart',220,250);fire('touchend',210,430,'changedTouches');
  });
  expect(await page.evaluate(()=>window.__navDelta)).toBe(0);
});

test('month view fills the remaining viewport at supported mobile widths',async({page})=>{
  await page.goto(url);
  for(const width of [360,390,412,430]){
    await page.setViewportSize({width,height:844});
    await expect(page.locator('.cal-cell')).toHaveCount(35);
    const size=await page.locator('#calendarGrid').evaluate(el=>{
      const box=el.getBoundingClientRect(),vv=window.visualViewport;
      return {right:box.right,left:box.left,bottom:box.bottom,viewport:innerWidth,viewportBottom:(vv?.offsetTop||0)+(vv?.height||innerHeight),scroll:document.documentElement.scrollWidth};
    });
    expect(size.left).toBeGreaterThanOrEqual(-13);
    expect(size.right).toBeLessThanOrEqual(size.viewport+13);
    expect(size.scroll).toBeLessThanOrEqual(size.viewport+1);
    expect(Math.abs(size.viewportBottom-size.bottom)).toBeLessThanOrEqual(2);
  }
});

test('today is indicated on the date number instead of filling the whole cell',async({page})=>{
  await page.goto(url);
  const today=page.locator('.cal-cell.today');
  if(await today.count()){
    await expect(today.locator('.cal-day')).toBeVisible();
    const radius=await today.locator('.cal-day').evaluate(el=>getComputedStyle(el).borderRadius);
    expect(radius).not.toBe('0px');
  }
});


test('five and six week months divide the same available height naturally',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(url);
  const five=await page.locator('.cmv-week').first().evaluate(el=>el.getBoundingClientRect().height);
  const fiveGrid=await page.locator('#calendarGrid').evaluate(el=>el.getBoundingClientRect().height);
  await page.evaluate(()=>window.renderMonth(2026,7));
  await expect(page.locator('.cmv-week')).toHaveCount(6);
  const six=await page.locator('.cmv-week').first().evaluate(el=>el.getBoundingClientRect().height);
  const sixGrid=await page.locator('#calendarGrid').evaluate(el=>el.getBoundingClientRect().height);
  expect(five).toBeGreaterThan(six+10);
  expect(Math.abs(fiveGrid-sixGrid)).toBeLessThanOrEqual(2);
});

test('taller viewport exposes more schedules before overflow',async({page})=>{
  await page.setViewportSize({width:390,height:640});
  await page.goto(url);
  const busyWeek=page.locator('.cmv-week').first();
  const shortVisible=await busyWeek.locator('.cmv-event').count();
  const shortMore=Number((await busyWeek.locator('.kptu-day-more').first().textContent()).replace('+',''));
  const shortHeight=Number(await page.locator('#calendarGrid').getAttribute('data-cmv-viewport-height'));

  await page.setViewportSize({width:390,height:844});
  await expect.poll(async()=>Number(await page.locator('#calendarGrid').getAttribute('data-cmv-viewport-height'))).toBeGreaterThan(shortHeight);
  const tallVisible=await page.locator('.cmv-week').first().locator('.cmv-event').count();
  const tallMore=Number((await page.locator('.cmv-week').first().locator('.kptu-day-more').first().textContent()).replace('+',''));
  expect(tallVisible).toBeGreaterThan(shortVisible);
  expect(tallMore).toBeLessThan(shortMore);
});

test('empty month remains clean and long titles keep ellipsis behavior',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(url);
  const title=page.locator('.cm-app[data-app-event="app-1"] .cmv-event-title');
  await expect(title).toBeVisible();
  const style=await title.evaluate(el=>({overflow:getComputedStyle(el).overflow,textOverflow:getComputedStyle(el).textOverflow,whiteSpace:getComputedStyle(el).whiteSpace}));
  expect(style.overflow).toBe('hidden');
  expect(style.textOverflow).toBe('ellipsis');
  expect(style.whiteSpace).toBe('nowrap');

  await page.evaluate(()=>window.KPTUCalendarMonthView.render({year:2026,month:8,appEvents:[],googleEvents:[],googleState:{}}));
  await expect(page.locator('.cmv-event')).toHaveCount(0);
  await expect(page.locator('.kptu-day-more')).toHaveCount(0);
});

test('desktop month view is viewport-based but capped to avoid oversized rows',async({page})=>{
  await page.setViewportSize({width:1280,height:1000});
  await page.goto(url);
  const metrics=await page.locator('#calendarGrid').evaluate(el=>({height:el.getBoundingClientRect().height,viewport:innerHeight}));
  expect(metrics.height).toBeLessThanOrEqual(metrics.viewport*.72+2);
  expect(metrics.height).toBeGreaterThan(300);
});
