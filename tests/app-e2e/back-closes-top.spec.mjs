import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import {noteAction} from './helpers/basket-more.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { closeNote } from './helpers/note-close.mjs';
import { pickBasketView } from './helpers/forget-view.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// BUG-뒤로가기: whatever is open, Back closes the top one first; only with nothing open does it reach the
// previous tab. Browser/PWA Back and Android back (KPTUNativeBack.handle) give the same result.
const ANDROID='Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/1.0';
const notes=Array.from({length:30},(_,i)=>({id:'n'+i,kind:'basket',title:null,raw_text:`메모 ${i}\n둘째 줄`,occurred_at:`2026-10-0${1+i%5}T0${i%10}:00:00Z`,updated_at:'2026-10-06T01:00:00Z',ai_export_allowed:true,attachments:[]}));
const noteDocs=Array.from({length:30},(_,i)=>({id:'d'+i,kind:'note',title:`노트 ${i}`,raw_text:`노트 본문 ${i}`,occurred_at:'2026-10-05T01:00:00Z',updated_at:`2026-10-${String(1+i).padStart(2,'0')}T01:00:00Z`,ai_export_allowed:true,attachments:[],metadata:{}}));

async function fixture(page,{query=''}={}){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.setViewportSize({width:390,height:844});
 await openHome(page,{query});
 await page.route(SB+'/rest/v1/app_notes**',r=>r.request().method()==='GET'?r.fulfill({json:new URL(r.request().url()).searchParams.get('kind')==='eq.note'?noteDocs:notes}):r.fulfill({status:403,json:{}}));
 await page.route(SB+'/rest/v1/app_record_links?**',r=>new URL(r.request().url()).searchParams.has('note_id')?r.fulfill({json:[]}):r.fallback());
 return errors;
}
async function enterBasket(page){
 await page.locator('.mobile-tabs [data-view="basket"]').click();await expect(page.locator('#basketView')).toBeVisible();
 await pickBasketView(page,'unclassified');await expect(page.locator('[data-basket-row]')).toHaveCount(notes.length);
}
const view=page=>page.evaluate(()=>KPTURouter.current);

for(const platform of ['browser','android'])test.describe(`Back closes the top open thing (${platform})`,()=>{
 if(platform==='android')test.use({userAgent:ANDROID});
 const back=async page=>{
  if(platform==='browser'){await page.evaluate(()=>history.back());return;}
  expect(await page.evaluate(()=>window.KPTUNativeBack?.version)).toBe(3);
  expect(await page.evaluate(()=>window.KPTUNativeBack.handle())).toBe(true);
 };

 test('memo opened from the list: Back returns to the list at the same scroll, and Esc gives the same result',async({page})=>{
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

 test('note opened from the note list: Back returns to the note list at the same scroll, and Esc gives the same result',async({page})=>{
  const errors=await fixture(page);await enterBasket(page);
  await chooseBasketKind(page,'note');await expect(page.locator('[data-note-host] [data-note-row]')).toHaveCount(noteDocs.length);
  const row=page.locator('[data-note-row="d5"]');await row.scrollIntoViewIfNeeded();
  const scroll=await page.evaluate(()=>scrollY);expect(scroll).toBeGreaterThan(300);
  await row.click();await expect(page.locator('[data-note-detail] [data-basket-read-text]')).toContainText('노트 본문 5');
  await back(page);
  await expect(page.locator('[data-note-detail]')).toBeHidden();await expect(page.locator('[data-note-list]')).toBeVisible();
  expect(await view(page)).toBe('basket');await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(scroll);
  await row.click();await expect(page.locator('[data-note-detail]')).toBeVisible();
  await closeNote(page);await expect(page.locator('[data-note-detail]')).toBeHidden();await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(scroll);
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
  await page.locator('[data-basket-big-write]').click();await expect(page.locator('#edWindow:not(.hidden)')).toBeVisible();
  await expect(page.locator('.modal:not(.hidden)')).toHaveCount(1);
  await back(page);
  await expect(page.locator('.modal:not(.hidden)')).toHaveCount(0);await expect(page.locator('[data-basket-text]')).toBeVisible();expect(await view(page)).toBe('basket');
  await back(page);
  await expect(page.locator('[data-basket-detail]')).toBeHidden();await expect(page.locator('[data-basket-list]')).toBeVisible();expect(await view(page)).toBe('basket');
  expect(errors).toEqual([]);
 });

 test('a memo left open by a tab change does not cost an extra Back',async({page})=>{
  const errors=await fixture(page);await enterBasket(page);
  await page.locator('[data-basket-row="n3"]').click();await expect(page.locator('[data-basket-detail]')).toBeVisible();
  await page.locator('.mobile-tabs [data-view="calendar"]').click();await expect(page.locator('#calendarView')).toBeVisible();
  await back(page);await expect(page.locator('#basketView')).toBeVisible();await expect(page.locator('[data-basket-detail]')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>history.state?.kptuLayers)).toBeUndefined();
  await back(page);await expect(page.locator('#homeView')).toBeVisible();
  expect(errors).toEqual([]);
 });

 test('with nothing open, Back reaches the previous tab',async({page})=>{
  const errors=await fixture(page);
  await page.locator('.mobile-tabs [data-view="calendar"]').click();await expect(page.locator('#calendarView')).toBeVisible();
  await page.locator('.mobile-tabs [data-view="meetings"]').click();await expect(page.locator('#meetingsView')).toBeVisible();
  await back(page);await expect(page.locator('#calendarView')).toBeVisible();
  await back(page);await expect(page.locator('#homeView')).toBeVisible();
  expect(errors).toEqual([]);
 });
});

test.describe('Android back at the first Web2 entry',()=>{
 test.use({userAgent:ANDROID});
 test('a deep link returns home, and home keeps the app open',async({page})=>{
  // 깊은 주소가 정말 첫 Web2 기록이어야 한다: 로그인 화면에서 곧바로 ?view=calendar로 들어온다. 홈을 연 뒤 page.goto로 옮기면
  // 아래에 홈 기록(/app/)이 남아, #2306(CALL-상세뒤로가기) 뒤로는 그 홈 문서로 돌아가는 다른 경우를 보게 된다
  // (그 문서 전환이 달력 문서의 읽던 요청을 끊어 'suborganizations init' 네트워크 오류가 간헐로 남았다, STAB-main간헐실패3).
  const errors=await fixture(page,{query:'?view=calendar'});await expect(page.locator('#calendarView')).toBeVisible();
  expect(await page.evaluate(()=>navigation.entries().filter(e=>new URL(e.url).pathname==='/app/').length)).toBe(1);
  await page.evaluate(()=>{window.__firstEntryDoc=true}); // 첫 기록에서는 같은 문서 안에서 홈으로 간다(기록 이동 없음)
  expect(await page.evaluate(()=>KPTUNativeBack.handle())).toBe(true);
  await expect(page.locator('#homeView')).toBeVisible();expect(await page.evaluate(()=>window.__firstEntryDoc)).toBe(true);
  await expect.poll(()=>new URL(page.url()).searchParams.get('view')).toBe(null);
  const url=page.url();
  expect(await page.evaluate(()=>KPTUNativeBack.handle())).toBe(true);
  await expect(page.locator('#homeView')).toBeVisible();expect(page.url()).toBe(url);
  expect(errors).toEqual([]);
 });
});
