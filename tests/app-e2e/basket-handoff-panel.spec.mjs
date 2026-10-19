import {testOrigin} from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {openBasketMore} from './helpers/basket-more.mjs';
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
async function setup(page,width){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.setViewportSize({width,height:1000});await openHome(page);await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
 const note={id:'10000000-0000-4000-8000-000000000001',workspace_id:'w',raw_text:'합성 비공개 첫 메모',occurred_at:'2026-10-11T01:00:00Z',updated_at:'2026-10-11T01:00:00Z',ai_export_allowed:true,attachments:[]};
 await page.route(SB+'/rest/v1/app_notes?**',r=>r.fulfill({json:[note]}));
 await page.route(SB+'/rest/v1/app_record_links?**',r=>r.fulfill({json:[]}));
 await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-row]')).toHaveCount(1);await openBasketMore(page);
 return {note,errors};
}
// 8-9e-2: [분류 요청]은 [⋯] 메뉴 안. 메뉴를 열면 첫 항목([분류 요청])에 초점이 간다.
async function press(page){await openBasketMore(page);await expect(page.locator('#basketMoreMenu [data-handoff-copy]')).toBeFocused();await page.keyboard.press('Enter');}
// #577: 복사되면 한 줄 알림(바구니 머리줄 아래)과 함께 [분류 결과 입력] 창이 곧바로 열린다.
const copiedLine=page=>page.locator('[data-basket-handoff-scope]');
async function denied(page){
 const cdp=await page.context().newCDPSession(page);
 const {targetInfo}=await cdp.send('Target.getTargetInfo');
 await cdp.send('Browser.setPermission',{permission:{name:'clipboard-read'},setting:'denied',browserContextId:targetInfo.browserContextId,origin:testOrigin});
 await cdp.send('Browser.setPermission',{permission:{name:'clipboard-write'},setting:'denied',browserContextId:targetInfo.browserContextId,origin:testOrigin});
}
async function settledCopy(page){
 // CDP polling must not renew the gesture while deferred clipboard data is pending.
 const cdp=await page.context().newCDPSession(page);
 try{await expect.poll(async()=>{
  const {result}=await cdp.send('Runtime.evaluate',{expression:"Boolean(document.querySelector('[data-basket-handoff-scope]')?.textContent.includes('복사했어요') || document.querySelector('[data-handoff-fallback]')?.hidden === false)",returnByValue:true,userGesture:false});
  return result.value;
 },{timeout:15000}).toBe(true);}finally{await cdp.detach();}
}
async function gestureWriteAllowed(page){
 await page.context().grantPermissions(['clipboard-write']);
 expect(await page.evaluate(async()=>(await navigator.permissions.query({name:'clipboard-write',allowWithoutGesture:false})).state)).toBe('granted');
 expect(await page.evaluate(async()=>(await navigator.permissions.query({name:'clipboard-write',allowWithoutGesture:true})).state)).toBe('denied');
}
async function requireFreshGesture(page){
 // A browser may check activation again when ClipboardItem's deferred data is ready.
 await page.evaluate(()=>{const original=navigator.clipboard.writeText.bind(navigator.clipboard);navigator.clipboard.write=async items=>{const text=await (await items[0].getType('text/plain')).text();return original(text);};});
}
async function trackPrepared(page){
 await page.evaluate(()=>{const Original=ClipboardItem;window.__handoffPreparedSettled=false;window.ClipboardItem=class extends Original{constructor(data){super(data);Promise.resolve(data['text/plain']).then(()=>window.__handoffPreparedSettled=true,()=>window.__handoffPreparedSettled=true);}};});
}
async function cleared(page){await expect(page.locator('[data-handoff-fallback]')).toBeHidden();await expect(page.locator('[data-handoff-text]')).toHaveValue('');await expect(page.locator('[data-handoff-status]')).toBeEmpty();}
for(const width of [390,1280]){
 test(`handoff real clipboard permission allowed ${width}`,async({page},info)=>{
  const {note,errors}=await setup(page,width);await page.context().grantPermissions(['clipboard-read','clipboard-write']);await press(page);
  await expect(copiedLine(page)).toHaveText('미분류 업데이트 1개 AI 분류 요청을 복사했어요. ChatGPT에 붙여 넣고, 받은 답을 아래 [분류 결과 입력]에 붙여 넣으세요.');await expect(page.locator('[data-classification-panel]')).toBeVisible();await expect(page.locator('[data-classification-input]')).toBeFocused();await expect(page.locator('[data-handoff-status]')).toBeEmpty();expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain(note.raw_text);
  await expect(page.locator('[data-handoff-fallback]')).toBeHidden();await expect(page.locator('[data-handoff-text]')).toHaveValue('');
  await page.screenshot({path:info.outputPath(`success-${width}.png`),fullPage:true});expect(errors).toEqual([]);
 });
 test(`handoff starts real clipboard before activation expires during slow reads ${width}`,async({page})=>{
  const {note,errors}=await setup(page,width);await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  // This gesture test needs a valid synthetic session at setup's fixed date.
  await page.evaluate(()=>{const rt=window.KPTURuntime;rt.session.write({...rt.session.read(),expires_at:Math.floor(Date.now()/1000)+3600});});
  expect(await page.evaluate(async()=>(await navigator.permissions.query({name:'clipboard-write',allowWithoutGesture:true})).state)).toBe('granted');
  await page.evaluate(()=>{window.__copyActivation=[];for(const method of ['write','writeText']){const original=navigator.clipboard[method].bind(navigator.clipboard);navigator.clipboard[method]=(...args)=>{const attempt={method,active:navigator.userActivation.isActive};window.__copyActivation.push(attempt);return original(...args).catch(error=>{attempt.error=error.name;throw error;});};}});
  await page.route(SB+'/rest/v1/app_notes?**',async r=>{await new Promise(resolve=>setTimeout(resolve,6100));await r.fallback();});
  await press(page);
  // Keep Playwright polling/evaluation from renewing Chromium's user gesture.
  await new Promise(resolve=>setTimeout(resolve,6800));
  expect(await page.evaluate(()=>window.__copyActivation)).toEqual([{method:'write',active:true}]);
  await expect(copiedLine(page)).toContainText('복사했어요',{timeout:15000});
  await page.context().grantPermissions(['clipboard-read']);expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain(note.raw_text);expect(errors).toEqual([]);
 });
 test(`handoff denied close replace navigation and private storage ${width}`,async({page},info)=>{
  const {note,errors}=await setup(page,width);await denied(page);await press(page);
  const text=page.locator('[data-handoff-text]'),close=page.locator('[data-handoff-close]');await expect(text).toBeVisible();await expect(text).toHaveAttribute('readonly','');await expect(text).toHaveValue(new RegExp(note.raw_text));
  await expect(page.locator('[data-handoff-status]')).toHaveText("아래 '복사하기'를 눌러 주세요");
  const retry=page.locator('[data-handoff-retry]');await expect(retry).toHaveClass(/quick-pill-primary/);
  await expect(page.locator('[data-handoff-fallback] button')).toHaveText(['복사하기','닫기']);
  await page.screenshot({path:info.outputPath(`fallback-${width}.png`),fullPage:true});
  for(const action of ['keyboard','touch']){
   // Collapse the first selection so retry must restore it, rather than inherit it.
   await text.evaluate(el=>el.setSelectionRange(0,0));expect(await text.evaluate(el=>el.selectionStart===el.selectionEnd)).toBe(true);
   if(action==='keyboard'){await retry.focus();await page.keyboard.press('Enter');}else await retry.tap();
   await expect(text).toBeVisible();await expect(text).toHaveValue(new RegExp(note.raw_text));await expect(page.locator('[data-handoff-copy]')).toBeEnabled();
   await expect(page.locator('[data-handoff-status]')).toHaveText('복사가 안 되면 길게 눌러 전체 선택 → 복사');
   await expect(text).toBeFocused();expect(await text.evaluate(el=>el.selectionStart===0&&el.selectionEnd===el.value.length)).toBe(true);
  }
  await page.screenshot({path:info.outputPath(`retry-failed-${width}.png`),fullPage:true});
  await close.focus();await page.keyboard.press('Enter');await cleared(page);await expect(page.locator('[data-basket-more]')).toBeFocused();await expect(copiedLine(page)).toBeHidden();
  await press(page);await expect(text).toBeVisible();note.raw_text='합성 새 메모';
  let release;const held=new Promise(resolve=>release=resolve);await page.route(SB+'/rest/v1/app_notes?**',async r=>{await held;await r.fallback();});
  await press(page);await expect(text).toHaveValue('');await expect(text).toBeHidden();release();await expect(text).toHaveValue(/합성 새 메모/);expect(await text.inputValue()).not.toContain('합성 비공개 첫 메모');await page.unroute(SB+'/rest/v1/app_notes?**');
  await page.route(SB+'/rest/v1/app_notes?**',r=>r.fulfill({json:[note]}));
  // [분류 결과 입력]을 따로 여는 버튼은 없다(#577: [분류 요청]이 복사 뒤 연다). 창 닫기는 아래 '취소' 표에서 다룬다.
  for(const control of ['[data-basket-filter="classified"]','[data-basket-row]','.mobile-tabs [data-view="home"]:visible,.app-nav [data-view="home"]:visible']){
   await page.locator(control).click();await cleared(page);
   // UI-바구니거르기: the memo is unclassified, so come back to [미분류] before the next control opens its row.
   if(control.includes('classified'))await page.locator('[data-basket-filter="unclassified"]').click();
   // UI-디자인손질 6: an open note has no list menu ([AI 분류 요청] is the list's), so go back to the list first.
   if(control.includes('basket-row')){await expect(page.locator('#basketView [data-basket-more]')).toBeHidden();await page.locator('[data-basket-close]').click();await cleared(page);}
   if(control.includes('home'))await page.evaluate(()=>window.KPTURouter.go('basket'));
   await press(page);await expect(text).toBeVisible();
  }
  await page.evaluate(()=>window.KPTURouter.go('calendar'));await cleared(page);await page.evaluate(()=>window.KPTURouter.go('basket'));await cleared(page);
  await press(page);await expect(text).toBeVisible();await close.tap();await cleared(page);
  const cdp=await page.context().newCDPSession(page);const stored=JSON.stringify(await Promise.all([true,false].map(isLocalStorage=>cdp.send('DOMStorage.getDOMStorageItems',{storageId:{securityOrigin:testOrigin,isLocalStorage}}))));expect(stored).not.toMatch(/합성 비공개 첫 메모|합성 새 메모/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
 });
 test(`handoff late read cannot reopen panel after navigation ${width}`,async({page})=>{
  const {errors}=await setup(page,width);await denied(page);await trackPrepared(page);
  let release;const held=new Promise(resolve=>release=resolve);await page.route(SB+'/rest/v1/app_notes?**',async r=>{await held;await r.fallback();});
  await press(page);await expect(page.locator('[data-handoff-copy]')).toBeDisabled();await page.evaluate(()=>window.KPTURouter.go('home'));await cleared(page);release();
  await page.waitForFunction(()=>window.__handoffPreparedSettled);await cleared(page);
  await expect(page.locator('[data-handoff-copy]')).toBeEnabled();await page.evaluate(()=>window.KPTURouter.go('basket'));await cleared(page);expect(errors).toEqual([]);
 });
}

// 창을 여는 것은 복사가 된 [분류 요청]뿐이므로, 창 닫기 경우는 먼저 허용된 복사로 창을 연 뒤 클립보드를 막는다.
const openSheet=async page=>{await page.context().grantPermissions(['clipboard-read','clipboard-write']);await press(page);await expect(page.locator('[data-classification-panel]')).toBeVisible();await denied(page);};
for(const width of [390,1280])for(const [control,target,source] of [
 ['[data-basket-filter="classified"]','[data-basket-filter="classified"][aria-pressed="true"]'],
 ['[data-basket-row]','[data-basket-detail]'],
 ['[data-classification-close]','[data-basket-list]',openSheet],
]){
 test(`handoff pending read cancelled by ${control} ${width}`,async({page})=>{
  const {errors}=await setup(page,width);if(typeof source==='function')await source(page);else{await denied(page);if(source)await page.locator(source).click();}
  // Await the real reader finishing as well as the HTTP response, to catch late UI restoration.
  await trackPrepared(page);
  let release;const held=new Promise(resolve=>release=resolve);await page.route(SB+'/rest/v1/app_notes?**',async r=>{await held;await r.fallback();});
  await press(page);await expect(page.locator('[data-handoff-copy]')).toBeDisabled();
  try{await page.locator(control).click();await expect(page.locator(target)).toBeVisible();await cleared(page);}finally{release();}
  await page.waitForFunction(()=>window.__handoffPreparedSettled);await cleared(page);await expect(page.locator('[data-handoff-copy]')).toBeEnabled();expect(errors).toEqual([]);
 });
}

for(const width of [390,1280])test(`handoff browser rechecks activation then prepared copy succeeds on second tap ${width}`,async({page})=>{
 const {note,errors}=await setup(page,width);note.raw_text='합성 원문\r\n둘째 줄';await gestureWriteAllowed(page);await requireFreshGesture(page);
 await page.route(SB+'/rest/v1/app_notes?**',async r=>{await new Promise(resolve=>setTimeout(resolve,6100));await r.fallback();});
 await press(page);await new Promise(resolve=>setTimeout(resolve,6800));await settledCopy(page);
 await expect(page.locator('[data-handoff-text]')).toBeVisible();await expect(page.locator('[data-handoff-text]')).toHaveValue(new RegExp(note.raw_text.replace(/\r\n?/g,'\n')));
 const retry=page.locator('[data-handoff-retry]');await expect(retry).toBeVisible();await retry.tap();
 await expect(copiedLine(page)).toContainText('복사했어요');await expect(page.locator('[data-handoff-fallback]')).toBeHidden();await expect(page.locator('[data-handoff-text]')).toHaveValue('');
 await page.context().grantPermissions(['clipboard-read']);expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain(note.raw_text);expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`handoff gesture-required native clipboard completes with a fresh tap when needed ${width}`,async({page})=>{
 const {note,errors}=await setup(page,width);await gestureWriteAllowed(page);
 await page.route(SB+'/rest/v1/app_notes?**',async r=>{await new Promise(resolve=>setTimeout(resolve,6100));await r.fallback();});
 await press(page);await new Promise(resolve=>setTimeout(resolve,6800));await settledCopy(page);
 if(await page.locator('[data-handoff-fallback]').isVisible())await page.locator('[data-handoff-retry]').tap();
 await expect(copiedLine(page)).toContainText('복사했어요');await expect(page.locator('[data-handoff-text]')).toBeHidden();await expect(page.locator('[data-handoff-text]')).toHaveValue('');
 await page.context().grantPermissions(['clipboard-read']);expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain(note.raw_text);expect(errors).toEqual([]);
});
