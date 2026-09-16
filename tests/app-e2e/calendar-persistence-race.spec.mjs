import { test, expect } from '@playwright/test';

test('rapid calendar preference changes persist the latest state',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/calendar-persistence-race-fixture.html');
  await page.evaluate(()=>window.__KPTU_CALENDAR_PERSISTENCE_READY__);
  const a=page.locator('[data-google-cal="cal-a"]'),b=page.locator('[data-google-cal="cal-b"]');
  await a.uncheck();
  await b.check();
  await expect.poll(()=>page.evaluate(()=>window.__preferenceCalls),{timeout:3000}).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(300);
  expect(await page.evaluate(()=>window.__serverPrefs.calendar_ids)).toEqual(['cal-b']);
});
