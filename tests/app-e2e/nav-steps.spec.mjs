import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// NAV-PC앞뒤통일(요청함 10/30 05:39, 결정 A): PC 위쪽 줄 ‹ › 는 폰·브라우저 뒤로/앞으로와 같은 길이다.
// ‹ 는 열린 것(노트·상세·창)부터 하나씩 닫고 그다음 이전 화면, › 는 그 반대(닫은 것을 다시 연다). 폰 412·884의 뒤로/앞으로도 같은 결과.
// 이름·본문은 모두 합성 값.
const notes=Array.from({length:8},(_,i)=>({id:'n'+i,kind:'basket',title:null,raw_text:`메모 ${i}\n둘째 줄`,occurred_at:`2026-10-0${1+i%5}T0${i}:00:00Z`,updated_at:'2026-10-06T01:00:00Z',ai_export_allowed:true,attachments:[]}));
const noteDocs=Array.from({length:8},(_,i)=>({id:'d'+i,kind:'note',title:`노트 ${i}`,raw_text:`노트 본문 ${i}`,occurred_at:'2026-10-05T01:00:00Z',updated_at:`2026-10-${String(1+i).padStart(2,'0')}T01:00:00Z`,ai_export_allowed:true,attachments:[],metadata:{}}));

async function fixture(page,width){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width,height:860});
 await openHome(page);
 await page.route(SB+'/rest/v1/app_notes**',r=>r.request().method()==='GET'?r.fulfill({json:new URL(r.request().url()).searchParams.get('kind')==='eq.note'?noteDocs:notes}):r.fulfill({status:403,json:{}}));
 await page.route(SB+'/rest/v1/app_record_links?**',r=>new URL(r.request().url()).searchParams.has('note_id')?r.fulfill({json:[]}):r.fallback());
 return errors;
}
// PC는 위쪽 줄 ‹ ›, 폰·중간 폭은 브라우저 뒤로/앞으로(폰 뒤로가기와 같은 기록).
const stepper=(page,width)=>width>=761
 ?{back:()=>page.locator('[data-history-step="back"]').click(),forward:()=>page.locator('[data-history-step="forward"]').click()}
 :{back:()=>page.evaluate(()=>history.back()),forward:()=>page.evaluate(()=>history.forward())};
const noteDetail=page=>page.locator('#basketView [data-note-detail]');
const memoDetail=page=>page.locator('#basketView [data-basket-detail]');

for(const width of [1440,412,884]){
 test(`${width}: 노트 열기 → ‹ 노트 목록 → › 그 노트 → ‹‹ 홈`,async({page})=>{
  const errors=await fixture(page,width),step=stepper(page,width);
  await chooseBasketKind(page,'note');
  const row=page.locator('#basketView [data-note-row="d5"]:visible').first();
  await expect(row).toBeVisible();await row.click();
  await expect(noteDetail(page)).toBeVisible();await expect(noteDetail(page)).toContainText('노트 본문 5');
  await step.back();
  await expect(noteDetail(page)).toBeHidden();await expect(page.locator('#basketView [data-note-row="d5"]:visible').first()).toBeVisible();
  expect(await page.evaluate(()=>KPTURouter.current)).toBe('basket');
  await step.forward();
  await expect(noteDetail(page)).toBeVisible();await expect(noteDetail(page)).toContainText('노트 본문 5');
  await expect(page).toHaveURL(/doc=d5/);
  await step.back();await expect(noteDetail(page)).toBeHidden();
  await step.back();await expect(page.locator('#homeView')).toBeVisible();
  if(width>=761)await expect(page.locator('[data-history-step="back"]')).toBeDisabled();
  expect(errors).toEqual([]);
 });

 test(`${width}: 정리함 업데이트 열기 → ‹ 목록 → › 그 업데이트`,async({page})=>{
  const errors=await fixture(page,width),step=stepper(page,width);
  await clickView(page,'basket');await expect(page.locator('#basketView')).toBeVisible();
  await page.locator('[data-basket-filter="unclassified"]').click();
  const row=page.locator('[data-basket-row="n3"]');await expect(row).toBeVisible();await row.click();
  await expect(memoDetail(page)).toBeVisible();await expect(page.locator('#basketView [data-basket-read-text]')).toContainText('메모 3');
  await step.back();
  await expect(memoDetail(page)).toBeHidden();await expect(row).toBeVisible();
  await step.forward();
  await expect(memoDetail(page)).toBeVisible();await expect(page.locator('#basketView [data-basket-read-text]')).toContainText('메모 3');
  expect(errors).toEqual([]);
 });
}

// 메뉴 화면 한 바퀴: 홈 → 화면 → ‹ 홈 → › 그 화면. 폰 폭은 같은 기록을 브라우저 뒤로/앞으로가 같은 결과로 지난다.
const SCREENS=['basket','library','tasks','calendar','journal','meetings','team'];
for(const width of [1440,884]){
 test(`${width}: 메뉴 화면마다 ‹ 는 이전 화면, › 는 다시 그 화면`,async({page})=>{
  await fixture(page,width);const step=stepper(page,width);
  for(const view of SCREENS){
   await page.evaluate(v=>window.KPTURouter.go(v,{source:'delegated'}),view);
   await expect(page.locator(`#${view}View`)).toBeVisible();
   await step.back();await expect(page.locator('#homeView'),view).toBeVisible();
   await step.forward();await expect(page.locator(`#${view}View`),view).toBeVisible();
   await page.evaluate(()=>window.KPTURouter.go('home',{source:'delegated'}));await expect(page.locator('#homeView')).toBeVisible();
  }
 });
}

test('router: canBack / canForward follow the history position and stop at Web2’s first entry',async({page})=>{
 await fixture(page,1440);
 expect(await page.evaluate(()=>[KPTURouter.canBack(),KPTURouter.canForward()])).toEqual([false,false]);
 await page.evaluate(()=>KPTURouter.go('library',{source:'delegated'}));await expect(page.locator('#libraryView')).toBeVisible();
 expect(await page.evaluate(()=>[KPTURouter.canBack(),KPTURouter.canForward()])).toEqual([true,false]);
 expect(await page.evaluate(()=>KPTURouter.back())).toBe(true);await expect(page.locator('#homeView')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>[KPTURouter.canBack(),KPTURouter.canForward()])).toEqual([false,true]);
 // 첫 기록에서 더 뒤로는 아무 일도 없다.
 expect(await page.evaluate(()=>KPTURouter.back())).toBe(false);
 expect(await page.evaluate(()=>KPTURouter.forward())).toBe(true);await expect(page.locator('#libraryView')).toBeVisible();
});
