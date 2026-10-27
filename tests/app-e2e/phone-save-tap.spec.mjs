import {showBasketRow} from './helpers/basket-more.mjs';
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// UI-폰저장버튼튐: on a phone, tapping a save button below a focused field blurs the field
// during the tap's mousedown. The keyboard layout must hold until the keyboard really closes,
// or the tab bar comes back under the finger and the click lands somewhere else.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00.123456+00:00';
const n='10000000-0000-4000-8000-000000000001';
const RAW=Array.from({length:30},(_,i)=>`${i+1}. 기자회견 준비 회의 메모 줄`).join('\n');
async function fixture(page,{width,height}){
 await page.setViewportSize({width,height});
 const home=await openHome(page),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 const note={id:n,workspace_id:'w',occurred_at:stamp,updated_at:stamp,raw_text:RAW,ai_export_allowed:true,archived_at:null,attachments:[],metadata:{}};
 for(const t of ['app_suborganizations','app_suborganization_assignees','app_spaces','app_record_links'])await page.route(SB+'/rest/v1/'+t+'?**',r=>r.fulfill({json:[]}));
 await page.route(SB+'/rest/v1/app_notes?**',r=>{
  const req=r.request(),q=new URL(req.url()).searchParams;
  if(req.method()==='PATCH'){note.metadata=req.postDataJSON().metadata;return r.fulfill({json:[{id:n,updated_at:note.updated_at,metadata:note.metadata}]});}
  if(q.get('metadata'))return r.fulfill({json:[]});
  return r.fulfill({json:[note].slice(Number(q.get('offset')||0))});
 });
 await page.evaluate(()=>window.KPTURouter.go('basket'));await showBasketRow(page,n);
 const row=page.locator(`[data-basket-row="${n}"]`);if(width<761)await row.tap();else await row.click();
 await expect(page.locator('[data-basket-read-text]')).toBeVisible();
 const detail=page.locator('[data-basket-detail]'),open=detail.getByRole('button',{name:'할 일 만들기'});
 if(width<761)await open.tap();else await open.click();
 await detail.locator('[data-manual-task-title]').fill('기자회견 장소 확정');
 return {home,errors,detail,save:detail.getByRole('button',{name:'할 일 만들기',exact:true})};
}
// Records where each phase of the next tap lands.
const watch=page=>page.evaluate(()=>{window.__tap=[];for(const type of ['touchstart','mousedown','click'])document.addEventListener(type,e=>__tap.push([type,e.target.closest?.('[data-manual-task-save],.mobile-tabs button')?.dataset?.view??(e.target.closest?.('[data-manual-task-save]')?'save':e.target.tagName)]),{capture:true});});
const done='Google 할 일을 만들었어요. 이 업데이트에 기록했어요.';

test('390 keyboard that shrinks the layout: a scrolled save tap stays on the save button',async({page})=>{
 const f=await fixture(page,{width:390,height:844});
 // The keyboard takes 320px off the layout viewport; the tab bar is hidden while it is open.
 await page.setViewportSize({width:390,height:524});
 await expect(page.locator('body')).toHaveClass(/kptu-mobile-keyboard/);await expect(page.locator('.mobile-tabs')).toBeHidden();
 // Scroll by hand so the save button sits right above the keyboard, where the tab bar would be.
 await page.evaluate(()=>{const r=document.querySelector('[data-manual-task-save]').getBoundingClientRect();scrollBy(0,r.bottom-(innerHeight-10));});
 const box=await f.save.boundingBox();expect(box.y+box.height).toBeGreaterThan(524-56);
 await watch(page);
 await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);
 expect(await page.evaluate(()=>__tap)).toEqual([['touchstart','save'],['mousedown','save'],['click','save']]);
 await expect(page.locator('[data-basket-status]')).toHaveText(done);expect(f.home.tasks).toHaveLength(6);
 expect(await page.evaluate(()=>window.KPTURouter.current)).toBe('basket');
 // The keyboard closes after the tap: the layout grows back and the tab bar returns.
 await page.setViewportSize({width:390,height:844});
 await expect(page.locator('body')).not.toHaveClass(/kptu-mobile-keyboard/);await expect(page.locator('.mobile-tabs')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(f.errors).toEqual([]);
});

test('390 keyboard over the page: blurring the field keeps the keyboard layout until the viewport grows',async({page})=>{
 const f=await fixture(page,{width:390,height:844});
 const keyboard=open=>page.evaluate(open=>{Object.defineProperty(window.visualViewport,'height',{configurable:true,value:open?444:innerHeight});visualViewport.dispatchEvent(new Event('resize'));},open);
 await keyboard(true);await expect(page.locator('body')).toHaveClass(/kptu-mobile-keyboard/);
 await f.save.scrollIntoViewIfNeeded();await watch(page);
 await f.save.tap();
 expect(await page.evaluate(()=>__tap.map(x=>x[1]))).toEqual(['save','save','save']);
 await expect(page.locator('[data-basket-status]')).toHaveText(done);
 // Focus left the field, but the keyboard is still on screen: the tab bar stays hidden.
 await expect(page.locator('body')).toHaveClass(/kptu-mobile-keyboard/);
 await keyboard(false);
 await expect(page.locator('body')).not.toHaveClass(/kptu-mobile-keyboard/);await expect(page.locator('.mobile-tabs')).toBeVisible();
 // A later field opens the keyboard state again from scratch.
 await page.locator('[data-basket-task-open]').tap();await page.locator('[data-manual-task-title]').focus();await keyboard(true);
 await expect(page.locator('body')).toHaveClass(/kptu-mobile-keyboard/);
 expect(f.errors).toEqual([]);
});

test('390 without an open keyboard a focused field does not hide the tab bar',async({page})=>{
 const f=await fixture(page,{width:390,height:844});
 await f.detail.locator('[data-manual-task-title]').focus();
 await expect(page.locator('body')).not.toHaveClass(/kptu-mobile-keyboard/);await expect(page.locator('.mobile-tabs')).toBeVisible();
 // Pinch zoom also shrinks the viewport but is not a keyboard.
 await page.evaluate(()=>{Object.defineProperty(window.visualViewport,'scale',{configurable:true,value:2});Object.defineProperty(window.visualViewport,'height',{configurable:true,value:422});visualViewport.dispatchEvent(new Event('resize'));});
 await expect(page.locator('body')).not.toHaveClass(/kptu-mobile-keyboard/);
 expect(f.errors).toEqual([]);
});

test('1280 the save click is unchanged and no keyboard layout is used',async({page})=>{
 const f=await fixture(page,{width:1280,height:900});
 await page.evaluate(()=>{Object.defineProperty(window.visualViewport,'height',{configurable:true,value:500});visualViewport.dispatchEvent(new Event('resize'));});
 await expect(page.locator('body')).not.toHaveClass(/kptu-mobile-keyboard/);
 await watch(page);await f.save.click();
 expect(await page.evaluate(()=>__tap.filter(x=>x[0]!=='touchstart').map(x=>x[1]))).toEqual(['save','save']);
 await expect(page.locator('[data-basket-status]')).toHaveText(done);expect(f.home.tasks).toHaveLength(6);
 expect(f.errors).toEqual([]);
});
