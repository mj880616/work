import { test, expect } from '@playwright/test';

const fixture='http://127.0.0.1:8123/tests/app-e2e/calendar-persistence-race-fixture.html';

test('rapid calendar preference changes persist the latest state',async({page})=>{
  await page.goto(fixture);
  await page.evaluate(()=>window.__KPTU_CALENDAR_PERSISTENCE_READY__);
  const a=page.locator('[data-google-cal="cal-a"]'),b=page.locator('[data-google-cal="cal-b"]');
  await a.uncheck();
  await b.check();
  await expect.poll(()=>page.evaluate(()=>window.__preferenceCalls),{timeout:3000}).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(300);
  expect(await page.evaluate(()=>window.__serverPrefs.calendar_ids)).toEqual(['cal-b']);
});

test('Google events load into the unified renderer data path without a retired visibility toggle',async({page})=>{
  await page.goto(fixture);
  await page.evaluate(()=>window.__KPTU_CALENDAR_PERSISTENCE_READY__);
  await expect(page.locator('#showGoogleCalendar')).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>window.__eventCalls)).toBeGreaterThan(0);
  await expect.poll(()=>page.evaluate(()=>window.__KPTU_GOOGLE_EVENTS__?.length||0)).toBe(3);
  expect(await page.evaluate(()=>window.__KPTU_GOOGLE_EVENTS__.map(x=>x.title))).toEqual(['A all-day','A timed','A recurring']);
  const range=await page.evaluate(()=>window.__eventRanges.at(-1));
  expect((new Date(range.timeMax)-new Date(range.timeMin))/86400000).toBe(35);
});

test('multiple, single and zero calendar selections update only Google event state',async({page})=>{
  await page.goto(fixture);
  await page.evaluate(()=>window.__KPTU_CALENDAR_PERSISTENCE_READY__);
  const a=page.locator('[data-google-cal="cal-a"]'),b=page.locator('[data-google-cal="cal-b"]');
  await b.check();
  await expect.poll(()=>page.evaluate(()=>window.__serverPrefs.calendar_ids)).toEqual(['cal-a','cal-b']);
  await expect.poll(()=>page.evaluate(()=>window.__KPTU_GOOGLE_EVENTS__?.length||0)).toBe(4);
  await a.uncheck();
  await expect.poll(()=>page.evaluate(()=>window.__serverPrefs.calendar_ids)).toEqual(['cal-b']);
  expect(await page.evaluate(()=>window.__KPTU_GOOGLE_EVENTS__.map(x=>x.title))).toEqual(['B timed']);
  await b.uncheck();
  await expect.poll(()=>page.evaluate(()=>window.__serverPrefs.calendar_ids)).toEqual([]);
  await expect.poll(()=>page.evaluate(()=>window.__KPTU_GOOGLE_EVENTS__?.length||0)).toBe(0);
});

test('month refresh requests the actual five or six week visible range',async({page})=>{
  await page.goto(fixture);
  await page.evaluate(()=>window.__KPTU_CALENDAR_PERSISTENCE_READY__);
  const before=await page.evaluate(()=>window.__eventCalls);
  await page.evaluate(async()=>{document.querySelector('#monthTitle').textContent='2026년 8월';await window.KPTUCalendarPersistence.refresh()});
  await expect.poll(()=>page.evaluate(()=>window.__eventCalls)).toBeGreaterThan(before);
  const range=await page.evaluate(()=>window.__eventRanges.at(-1));
  expect((new Date(range.timeMax)-new Date(range.timeMin))/86400000).toBe(42);
});

test('late Google responses are discarded after session ownership changes',async({page})=>{
  await page.goto(fixture);
  await page.evaluate(()=>window.__KPTU_CALENDAR_PERSISTENCE_READY__);
  await expect.poll(()=>page.evaluate(()=>window.__KPTU_GOOGLE_EVENTS__?.length||0)).toBe(3);
  await page.evaluate(()=>{
    window.__eventDelay=180;
    window.KPTUCalendarPersistence.refresh();
    setTimeout(()=>{
      window.__session={user:{id:'user-b'}};
      window.dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:window.__session}}));
    },20);
  });
  await page.waitForTimeout(260);
  expect(await page.evaluate(()=>window.__KPTU_GOOGLE_EVENTS__)).toEqual([]);
});

test('Google event state remains stable at supported mobile widths',async({page})=>{
  await page.goto(fixture);
  await page.evaluate(()=>window.__KPTU_CALENDAR_PERSISTENCE_READY__);
  for(const width of [360,390,412,430]){
    await page.setViewportSize({width,height:844});
    await expect.poll(()=>page.evaluate(()=>window.__KPTU_GOOGLE_EVENTS__?.length||0)).toBe(3);
  }
});
