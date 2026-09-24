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

test('month view stays within supported mobile widths',async({page})=>{
  await page.goto(url);
  for(const width of [360,390,412,430]){
    await page.setViewportSize({width,height:844});
    await expect(page.locator('.cal-cell')).toHaveCount(35);
    const size=await page.locator('#calendarGrid').evaluate(el=>({right:el.getBoundingClientRect().right,left:el.getBoundingClientRect().left,viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
    expect(size.left).toBeGreaterThanOrEqual(-13);
    expect(size.right).toBeLessThanOrEqual(size.viewport+13);
    expect(size.scroll).toBeLessThanOrEqual(size.viewport+1);
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
