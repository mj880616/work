import {testOrigin} from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({hasTouch:true});
const LONG='첫 줄 제목\n\n'+'아주 긴 둘째 문단입니다. '.repeat(20)+'\n마지막 줄';
async function fixture(page,{query=''}={}){
 const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const notes=[{id:'n',raw_text:LONG,occurred_at:'2026-10-06T01:00:00Z',updated_at:'2026-10-06T01:00:00Z',ai_export_allowed:true,attachments:[{drive_file_id:'file_1',file_name:'회의.txt',size_bytes:12,mime_type:'text/plain'}]}];
 let denied=false;
 await openHome(page);
 await page.route(SB+'/rest/v1/app_notes**',r=>{
  const req=r.request(),u=new URL(req.url());if(req.method()==='GET')return r.fulfill({json:notes});
  const body=req.postDataJSON();writes.push({method:req.method(),body});
  if(denied)return r.fulfill({status:403,json:{message:'RLS 거부'}});
  if(req.method()==='POST'){const n={id:'new'+writes.length,occurred_at:'2026-10-06T04:00:00Z',...body};notes.unshift(n);return r.fulfill({json:[n]});}
  const n=notes.find(n=>'eq.'+n.id===u.searchParams.get('id'));Object.assign(n,body,{updated_at:'2026-10-06T02:00:00Z'});return r.fulfill({json:[n]});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',r=>new URL(r.request().url()).searchParams.has('note_id')?r.fulfill({json:[]}):r.fallback());
 if(query)await page.goto(testOrigin+'/app/'+query);
 return {notes,writes,errors,setDenied:v=>denied=v};
}
const noDialog=page=>page.on('dialog',d=>{throw new Error('unexpected dialog: '+d.message());});
async function press(page,locator,width){
 await expect(locator).toBeVisible();
 if(width<761){const b=await locator.boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}else await locator.click();
}
async function enterBasket(page,width){await press(page,page.locator('#homeView [data-goto="basket"]'),width);await expect(page.locator('[data-basket-row]')).toHaveCount(1);}
const editableFocused=page=>page.evaluate(()=>!!document.activeElement?.matches('input:not([type=button]),textarea,[contenteditable="true"]'));

for(const width of [390,1280]){
 test(`basket memo opens in read view and edits only after 수정 ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page),detail=page.locator('[data-basket-detail]');
  await enterBasket(page,width);
  await press(page,page.locator('[data-basket-row="n"]'),width);
  const read=detail.locator('[data-basket-read-text]');
  await expect(read).toBeVisible();expect(await read.innerText()).toBe(LONG);
  await expect(detail.locator('time')).toContainText('2026');await expect(detail.locator('[data-basket-attachments]')).toContainText('회의.txt');
  await expect(detail.locator('[data-basket-attachments] a')).toHaveText('Drive에서 열기');
  await expect(detail.locator('[data-basket-text]')).toBeHidden();await expect(detail.locator('[data-basket-save]')).toBeHidden();await expect(detail.locator('[data-basket-upload]')).toBeHidden();
  for(const name of ['수정','연결하기','할 일 만들기','보관','삭제','목록으로'])await expect(detail.getByRole('button',{name,exact:true})).toBeVisible();
  // One AI handoff on the read view: the toolbar's, scoped to this memo.
  await expect(detail.getByRole('button',{name:'AI에게 맡기기'})).toHaveCount(0);await expect(page.locator('#basketView').getByRole('button',{name:'AI에게 맡기기',exact:true})).toHaveCount(1);
  expect(await editableFocused(page)).toBe(false);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`basket-read-${width}.png`),fullPage:true});
  await press(page,detail.locator('[data-basket-edit]'),width);
  const text=detail.locator('[data-basket-text]');await expect(text).toBeFocused();await expect(text).toHaveValue(LONG);
  await expect(read).toBeHidden();await expect(detail.locator('[data-basket-archive]')).toBeHidden();await expect(detail.locator('[data-basket-cancel]')).toBeVisible();await expect(detail.locator('[data-basket-upload]')).toBeVisible();
  await page.screenshot({path:info.outputPath(`basket-edit-${width}.png`),fullPage:true});
  await text.fill('고친 원문\n둘째 줄');await press(page,detail.locator('[data-basket-save]'),width);
  await expect(read).toBeVisible();expect(await read.innerText()).toBe('고친 원문\n둘째 줄');await expect(text).toBeHidden();
  await expect(detail.locator('[data-basket-status]')).toContainText('수정한 글을 저장했습니다');expect(f.writes.at(-1)).toMatchObject({method:'PATCH',body:{raw_text:'고친 원문\n둘째 줄'}});
  expect(await editableFocused(page)).toBe(false);
  noDialog(page);await press(page,detail.locator('[data-basket-close]'),width);await expect(page.locator('[data-basket-row="n"]')).toContainText('고친 원문');
  expect(f.errors).toEqual([]);
 });

 test(`basket edit cancel returns to reading and save failure keeps the editor ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page),detail=page.locator('[data-basket-detail]'),text=detail.locator('[data-basket-text]'),read=detail.locator('[data-basket-read-text]');
  await enterBasket(page,width);await press(page,page.locator('[data-basket-row="n"]'),width);
  // Unchanged: cancel returns at once without a question.
  const dialogs=[];page.on('dialog',d=>{dialogs.push(d.message());void(dialogs.accept?d.accept():d.dismiss());});
  await press(page,detail.locator('[data-basket-edit]'),width);await press(page,detail.locator('[data-basket-cancel]'),width);
  await expect(read).toBeVisible();expect(dialogs).toEqual([]);
  // Changed: the first answer keeps editing, the second discards.
  await press(page,detail.locator('[data-basket-edit]'),width);await text.fill('버릴 글');
  await press(page,detail.locator('[data-basket-cancel]'),width);expect(dialogs).toHaveLength(1);await expect(text).toBeVisible();await expect(text).toHaveValue('버릴 글');
  dialogs.accept=true;await press(page,detail.locator('[data-basket-cancel]'),width);expect(dialogs).toHaveLength(2);
  await expect(read).toBeVisible();expect(await read.innerText()).toBe(LONG);await expect(text).toHaveValue(LONG);
  // Failure keeps the editor and the typed text.
  f.setDenied(true);await press(page,detail.locator('[data-basket-edit]'),width);await text.fill('실패해도 남는 글');await press(page,detail.locator('[data-basket-save]'),width);
  await expect(detail.locator('[data-basket-status]')).toContainText('저장하지 못했어요');await expect(text).toBeVisible();await expect(text).toHaveValue('실패해도 남는 글');await expect(read).toBeHidden();
  // While editing, leaving the note still asks first.
  dialogs.accept=false;await press(page,detail.locator('[data-basket-close]'),width);expect(dialogs).toHaveLength(3);await expect(text).toHaveValue('실패해도 남는 글');
  expect(f.errors.filter(e=>!e.includes('403'))).toEqual([]);
 });

 test(`basket quick input takes taps and typing after entering from home ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await enterBasket(page,width);
  const input=page.locator('#basketView [data-quick-input]'),b=await input.boundingBox();
  // The save button's enlarged hit area must stay on the button, not over the input.
  expect(await page.evaluate(([x,y])=>document.elementFromPoint(x,y)?.matches('[data-quick-input]'),[b.x+b.width/2,b.y+b.height/2])).toBe(true);
  await press(page,input,width);await expect(input).toBeFocused();expect(await input.evaluate(el=>({readOnly:el.readOnly,disabled:el.disabled}))).toEqual({readOnly:false,disabled:false});
  await page.keyboard.type('홈에서 들어와 쓴 메모');await expect(input).toHaveValue('홈에서 들어와 쓴 메모');
  await press(page,page.locator('#basketView [data-quick-save]'),width);await expect(input).toHaveValue('');
  expect(f.writes.at(-1)).toMatchObject({method:'POST',body:{raw_text:'홈에서 들어와 쓴 메모'}});expect(f.errors).toEqual([]);
 });
}

test('basket quick input takes taps and typing when the basket opens directly',async({page})=>{
 await page.setViewportSize({width:390,height:900});const f=await fixture(page,{query:'?view=basket'});
 await expect(page.locator('[data-basket-row]')).toHaveCount(1);
 const input=page.locator('#basketView [data-quick-input]');await press(page,input,390);await expect(input).toBeFocused();
 await page.keyboard.type('바로 연 바구니 메모');await press(page,page.locator('#basketView [data-quick-save]'),390);await expect(input).toHaveValue('');
 expect(f.writes.at(-1)).toMatchObject({method:'POST',body:{raw_text:'바로 연 바구니 메모'}});expect(f.errors).toEqual([]);
});

test('basket address restores a note in the read view without a keyboard',async({page})=>{
 await page.setViewportSize({width:390,height:900});await fixture(page,{query:'?view=basket&note=n'});
 const read=page.locator('[data-basket-read-text]');await expect(read).toBeVisible();expect(await read.innerText()).toBe(LONG);
 await expect(page.locator('[data-basket-text]')).toBeHidden();expect(await editableFocused(page)).toBe(false);
 noDialog(page);await page.locator('[data-basket-close]').click();await expect(page.locator('[data-basket-row="n"]')).toBeVisible();
});

test('basket quick input explains a lock below the input and offers a new memo',async({page})=>{
 await page.setViewportSize({width:390,height:900});const f=await fixture(page,{query:'?view=basket'});
 await expect(page.locator('[data-basket-row]')).toHaveCount(1);
 let calls=0;await page.route(SB+'/functions/v1/basket-files',r=>++calls===1?r.fulfill({json:{ok:true,note_id:'n',attachments:[]}}):r.fulfill({status:503,json:{error:'첨부를 저장하지 못했습니다.',code:'note_save_result_unknown',note_id:'n'}}));
 const q=page.locator('#basketView [data-home-quick]'),input=q.locator('[data-quick-input]'),lock=q.locator('[data-quick-lock]');
 await expect(lock).toBeHidden();
 await input.fill('첨부와 함께 쓴 글');await q.locator('input[type=file]').setInputFiles(['a.txt','b.txt'].map(name=>({name,mimeType:'text/plain',buffer:Buffer.from(name)})));
 await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-status]')).toContainText('바구니에서 확인');
 await expect(lock).toBeVisible();await expect(q.locator('[data-quick-lock-reason]')).toContainText('입력창을 잠갔어요');await expect(q.locator('[data-quick-new-note]')).toBeVisible();
 expect(await input.evaluate(el=>el.readOnly)).toBe(true);
 const inputBox=await input.boundingBox(),lockBox=await lock.boundingBox();expect(lockBox.y).toBeGreaterThanOrEqual(inputBox.y+inputBox.height);expect(lockBox.y-(inputBox.y+inputBox.height)).toBeLessThan(24);
 page.once('dialog',d=>d.accept());await press(page,q.locator('[data-quick-new-note]'),390);
 await expect(lock).toBeHidden();await expect(input).toBeFocused();await expect(input).toHaveValue('');expect(await input.evaluate(el=>el.readOnly)).toBe(false);
 await page.keyboard.type('새로 쓰는 메모');await expect(input).toHaveValue('새로 쓰는 메모');
 expect(f.errors.filter(e=>!e.includes('503'))).toEqual([]);
});
