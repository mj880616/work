import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { noteAction } from './helpers/basket-more.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// BUG-뒤로가기: whatever is open, Back closes the top one first; only with nothing open does it reach the
// previous tab. Browser/PWA Back and Android back (KPTUNativeBack.handle) give the same result.
const ANDROID='Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/1.0';
const notes=Array.from({length:30},(_,i)=>({id:'n'+i,kind:'basket',title:null,raw_text:`메모 ${i}\n둘째 줄`,occurred_at:`2026-10-0${1+i%5}T0${i%10}:00:00Z`,updated_at:'2026-10-06T01:00:00Z',ai_export_allowed:true,attachments:[]}));
const noteDocs=Array.from({length:30},(_,i)=>({id:'d'+i,kind:'note',title:`노트 ${i}`,raw_text:`노트 본문 ${i}`,occurred_at:'2026-10-05T01:00:00Z',updated_at:`2026-10-${String(1+i).padStart(2,'0')}T01:00:00Z`,ai_export_allowed:true,attachments:[],metadata:{}}));

async function fixture(page){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.setViewportSize({width:390,height:844});
 await openHome(page);
 await page.route(SB+'/rest/v1/app_notes**',r=>r.request().method()==='GET'?r.fulfill({json:new URL(r.request().url()).searchParams.get('kind')==='eq.note'?noteDocs:notes}):r.fulfill({status:403,json:{}}));
 await page.route(SB+'/rest/v1/app_record_links?**',r=>new URL(r.request().url()).searchParams.has('note_id')?r.fulfill({json:[]}):r.fallback());
 return errors;
}
async function enterBasket(page){
 await page.locator('.mobile-tabs [data-view="basket"]').click();await expect(page.locator('#basketView')).toBeVisible();
 await page.locator('[data-basket-filter="all"]').click();await expect(page.locator('[data-basket-row]')).toHaveCount(notes.length);
}
const view=page=>page.evaluate(()=>KPTURouter.current);

for(const platform of ['browser','android'])test.describe(`Back closes the top open thing (${platform})`,()=>{
 if(platform==='android')test.use({userAgent:ANDROID});
 const back=async page=>{
  if(platform==='browser'){await page.evaluate(()=>history.back());return;}
  expect(await page.evaluate(()=>window.KPTUNativeBack?.version)).toBe(3);
  expect(await page.evaluate(()=>window.KPTUNativeBack.handle())).toBe(true);
 };

 test('memo opened from the list: Back returns to the list at the same scroll, and ‹ gives the same result',async({page})=>{
  const errors=await fixture(page);await enterBasket(page);
  const row=page.locator('[data-basket-row="n20"]');await row.scrollIntoViewIfNeeded();
  const scroll=await page.evaluate(()=>scrollY);expect(scroll).toBeGreaterThan(300);
  await row.click();await expect(page.locator('[data-basket-read-text]')).toContainText('메모 20');
  await back(page);
  await expect(page.locator('[data-basket-detail]')).toBeHidden();await expect(page.locator('[data-basket-list]')).toBeVisible();
  expect(await view(page)).toBe('basket');await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(scroll);
  // ‹ 바구니 closes the same entry: one more Back now leaves the basket for home.
  await row.click();await expect(page.locator('[data-basket-detail]')).toBeVisible();
  await page.locator('[data-basket-close]').click();await expect(page.locator('[data-basket-detail]')).toBeHidden();await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(scroll);
  await expect.poll(()=>page.evaluate(()=>history.state?.kptuLayers)).toBeUndefined();
  await back(page);await expect(page.locator('#homeView')).toBeVisible();
  expect(errors).toEqual([]);
 });

 test('note opened from the note list: Back returns to the note list at the same scroll, and ‹ gives the same result',async({page})=>{
  const errors=await fixture(page);await enterBasket(page);
  await page.locator('[data-basket-kind="note"]').click();await expect(page.locator('[data-note-host] [data-note-row]')).toHaveCount(noteDocs.length);
  const row=page.locator('[data-note-row="d5"]');await row.scrollIntoViewIfNeeded();
  const scroll=await page.evaluate(()=>scrollY);expect(scroll).toBeGreaterThan(300);
  await row.click();await expect(page.locator('[data-note-detail] [data-basket-read-text]')).toContainText('노트 본문 5');
  await back(page);
  await expect(page.locator('[data-note-detail]')).toBeHidden();await expect(page.locator('[data-note-list]')).toBeVisible();
  expect(await view(page)).toBe('basket');await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(scroll);
  await row.click();await expect(page.locator('[data-note-detail]')).toBeVisible();
  await page.locator('[data-note-close]').click();await expect(page.locator('[data-note-detail]')).toBeHidden();await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(scroll);
  await expect.poll(()=>page.evaluate(()=>history.state?.kptuLayers)).toBeUndefined();
  await back(page);await expect(page.locator('#homeView')).toBeVisible();
  expect(errors).toEqual([]);
 });

 test('a panel opened over a screen: Back closes only the panel',async({page})=>{
  const errors=await fixture(page);await enterBasket(page);
  await page.locator('#mobileMenuTab').click();await expect(page.locator('#mobileMenu')).toBeVisible();
  await back(page);
  await expect(page.locator('#mobileMenu')).toBeHidden();await expect(page.locator('#basketView')).toBeVisible();expect(await view(page)).toBe('basket');
  expect(errors).toEqual([]);
 });

 test('two stacked (memo, then its full-screen editor): Back twice closes them one by one',async({page})=>{
  const errors=await fixture(page);await enterBasket(page);
  await page.locator('[data-basket-row="n3"]').click();await noteAction(page,'[data-basket-edit]');
  await page.locator('[data-basket-big-write]').click();await expect(page.locator('.modal.md-editor:not(.hidden)')).toBeVisible();
  await expect(page.locator('.modal:not(.hidden)')).toHaveCount(1);
  await back(page);
  await expect(page.locator('.modal:not(.hidden)')).toHaveCount(0);await expect(page.locator('[data-basket-text]')).toBeVisible();expect(await view(page)).toBe('basket');
  await back(page);
  await expect(page.locator('[data-basket-detail]')).toBeHidden();await expect(page.locator('[data-basket-list]')).toBeVisible();expect(await view(page)).toBe('basket');
  expect(errors).toEqual([]);
 });

 test('with nothing open, Back reaches the previous tab',async({page})=>{
  const errors=await fixture(page);
  await page.locator('.mobile-tabs [data-view="calendar"]').click();await expect(page.locator('#calendarView')).toBeVisible();
  await page.locator('.mobile-tabs [data-view="projects"]').click();await expect(page.locator('#projectsView')).toBeVisible();
  await back(page);await expect(page.locator('#calendarView')).toBeVisible();
  await back(page);await expect(page.locator('#homeView')).toBeVisible();
  expect(errors).toEqual([]);
 });
});

test.describe('Android back at the first Web2 entry',()=>{
 test.use({userAgent:ANDROID});
 test('a deep link returns home, and home keeps the app open',async({page})=>{
  const errors=await fixture(page);
  await page.goto(new URL('/app/?view=calendar',page.url()).href);await expect(page.locator('#calendarView')).toBeVisible();
  expect(await page.evaluate(()=>KPTUNativeBack.handle())).toBe(true);
  await expect(page.locator('#homeView')).toBeVisible();await expect.poll(()=>new URL(page.url()).searchParams.get('view')).toBe(null);
  const url=page.url();
  expect(await page.evaluate(()=>KPTUNativeBack.handle())).toBe(true);
  await expect(page.locator('#homeView')).toBeVisible();expect(page.url()).toBe(url);
  expect(errors).toEqual([]);
 });
});
