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
async function press(page){await page.locator('[data-handoff-copy]').focus();await page.keyboard.press('Enter');}
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
  const {result}=await cdp.send('Runtime.evaluate',{expression:"Boolean(document.querySelector('[data-handoff-status]')?.textContent.includes('복사했어요') || document.querySelector('[data-handoff-fallback]')?.hidden === false)",returnByValue:true,userGesture:false});
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
  await expect(page.locator('[data-handoff-status]')).toContainText('복사했어요');expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain(note.raw_text);
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
  await expect(page.locator('[data-handoff-status]')).toContainText('복사했어요',{timeout:15000});
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
  await close.focus();await page.keyboard.press('Enter');await cleared(page);await expect(page.locator('[data-handoff-copy]')).toBeFocused();
  await press(page);await expect(text).toBeVisible();note.raw_text='합성 새 메모';
  let release;const held=new Promise(resolve=>release=resolve);await page.route(SB+'/rest/v1/app_notes?**',async r=>{await held;await r.fallback();});
  await press(page);await expect(text).toHaveValue('');await expect(text).toBeHidden();release();await expect(text).toHaveValue(/합성 새 메모/);expect(await text.inputValue()).not.toContain('합성 비공개 첫 메모');await page.unroute(SB+'/rest/v1/app_notes?**');
  await page.route(SB+'/rest/v1/app_notes?**',r=>r.fulfill({json:[note]}));
  for(const control of ['[data-basket-filter="all"]','[data-classification-open]','[data-basket-row]','.mobile-tabs [data-view="home"]:visible,.app-nav [data-view="home"]:visible']){
   await page.locator(control).click();await cleared(page);
   if(control.includes('classification')){await press(page);await expect(text).toBeVisible();await page.locator('[data-classification-close]').click();await cleared(page);}
   if(control.includes('basket-row')){await press(page);await expect(text).toBeVisible();await page.locator('[data-basket-close]').click();await cleared(page);}
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

for(const width of [390,1280])for(const [control,target,source] of [
 ['[data-basket-filter="all"]','[data-basket-filter="all"][aria-pressed="true"]'],
 ['[data-classification-open]','[data-classification-panel]'],
 ['[data-basket-row]','[data-basket-detail]'],
 ['[data-classification-close]','[data-basket-list]','[data-classification-open]'],
 ['[data-basket-close]','[data-basket-list]','[data-basket-row]'],
]){
 test(`handoff pending read cancelled by ${control} ${width}`,async({page})=>{
  const {errors}=await setup(page,width);await denied(page);if(source)await page.locator(source).click();
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
 await expect(page.locator('[data-handoff-status]')).toContainText('복사했어요');await expect(page.locator('[data-handoff-fallback]')).toBeHidden();await expect(page.locator('[data-handoff-text]')).toHaveValue('');
 await page.context().grantPermissions(['clipboard-read']);expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain(note.raw_text);expect(errors).toEqual([]);
});

for(const width of [390,1280])test(`handoff gesture-required native clipboard completes with a fresh tap when needed ${width}`,async({page})=>{
 const {note,errors}=await setup(page,width);await gestureWriteAllowed(page);
 await page.route(SB+'/rest/v1/app_notes?**',async r=>{await new Promise(resolve=>setTimeout(resolve,6100));await r.fallback();});
 await press(page);await new Promise(resolve=>setTimeout(resolve,6800));await settledCopy(page);
 if(await page.locator('[data-handoff-fallback]').isVisible())await page.locator('[data-handoff-retry]').tap();
 await expect(page.locator('[data-handoff-status]')).toContainText('복사했어요');await expect(page.locator('[data-handoff-text]')).toBeHidden();await expect(page.locator('[data-handoff-text]')).toHaveValue('');
 await page.context().grantPermissions(['clipboard-read']);expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain(note.raw_text);expect(errors).toEqual([]);
});
