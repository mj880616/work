import {testOrigin} from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import {noteAction} from './helpers/basket-more.mjs';
import {answerAsk} from './helpers/small-notice.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({hasTouch:true});
const LONG='첫 줄 제목\n\n'+'아주 긴 둘째 문단입니다. '.repeat(20)+'\n마지막 줄';
// MD-표시: the formatted reading drops spaces before a line break; [원문 그대로 보기] shows the stored text exactly.
const SHOWN=LONG.replace(/ +\n/g,'\n');
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
 // The formatted reading view can be taller than the screen: bring the target above the fixed bottom tabs first.
 if(width<761){await locator.evaluate(el=>el.scrollIntoView({block:'center'}));const b=await locator.boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}else await locator.click();
}
async function enterBasket(page,width){await press(page,page.locator('#homeView [data-home-quick] [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').first(),width);await expect(page.locator('[data-basket-row]')).toHaveCount(1);}
const editableFocused=page=>page.evaluate(()=>!!document.activeElement?.matches('input:not([type=button]),textarea,[contenteditable="true"]'));

for(const width of [390,1280]){
 test(`basket memo opens in read view and edits only after 수정 ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page),detail=page.locator('[data-basket-detail]');
  await enterBasket(page,width);
  await press(page,page.locator('[data-basket-row="n"]'),width);
  const read=detail.locator('[data-basket-read-text]');
  await expect(read).toBeVisible();await expect.poll(()=>read.innerText()).toBe(SHOWN);
  // UI-바구니상세개편: the 원문 toggle is a small icon near the text (not in [⋯]); formatted is the default.
  const raw=detail.locator('[data-basket-read-raw]');await expect(raw).toHaveAttribute('aria-pressed','false');
  await press(page,raw,width);await expect(raw).toHaveAccessibleName('정리해서 보기');await expect(raw).toHaveAttribute('aria-pressed','true');expect(await read.innerText()).toBe(LONG);
  await press(page,raw,width);await expect(raw).toHaveAccessibleName('원문 그대로 보기');expect(await read.innerText()).toBe(SHOWN);
  await expect(detail.locator('time')).toContainText('2026');await expect(detail.locator('[data-basket-attachments]')).toContainText('회의.txt');
  await expect(detail.locator('[data-basket-attachments] a')).toHaveText('Drive에서 열기');await expect(detail.locator('[data-basket-attachments]')).toContainText(/\d B|KB|MB/);
  await expect(detail.locator('[data-basket-text]')).toBeHidden();await expect(detail.locator('[data-basket-save]')).toBeHidden();await expect(detail.locator('[data-basket-upload]')).toBeHidden();
  // UI-디자인손질 6: big buttons [연결하기]·[할 일 만들기], "‹ 바구니" back, the rest in the note's [⋯]; no list menu on a note.
  for(const name of ['연결하기','할 일 만들기','잊지 말기 목록으로','이 업데이트 메뉴'])await expect(detail.getByRole('button',{name,exact:true})).toBeVisible();
  for(const name of ['수정','보류로','삭제'])await expect(detail.getByRole('button',{name,exact:true})).toBeHidden();
  await expect(page.locator('#basketView [data-basket-more]')).toBeHidden();await expect(page.locator('#basketView').getByRole('button',{name:'AI 분류 요청',exact:true})).toHaveCount(0);
  expect(await editableFocused(page)).toBe(false);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`basket-read-${width}.png`),fullPage:true});
  await noteAction(page,'[data-basket-edit]',{press:l=>press(page,l,width)});
  const text=detail.locator('[data-basket-text]');await expect(text).toBeFocused();await expect(text).toHaveValue(LONG);
  await expect(read).toBeHidden();await expect(detail.locator('[data-basket-archive]')).toBeHidden();await expect(detail.locator('[data-basket-cancel]')).toBeVisible();/* UI-업데이트편집한줄: [첨부 저장]은 파일을 고른 뒤에만 */await expect(detail.locator('[data-basket-upload]')).toBeHidden();await expect(detail.locator('[data-basket-edit-actions]').getByRole('button',{name:'파일 첨부',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath(`basket-edit-${width}.png`),fullPage:true});
  await text.fill('수정한 원문\n둘째 줄');await press(page,detail.locator('[data-basket-save]'),width);
  await expect(read).toBeVisible();expect(await read.innerText()).toBe('수정한 원문\n둘째 줄');await expect(text).toBeHidden();
  await expect(page.locator('#toast')).toContainText('수정한 글을 저장했습니다');expect(f.writes.at(-1)).toMatchObject({method:'PATCH',body:{raw_text:'수정한 원문\n둘째 줄'}});
  expect(await editableFocused(page)).toBe(false);
  noDialog(page);await press(page,detail.locator('[data-basket-close]'),width);await expect(page.locator('[data-basket-row-item="n"]')).toContainText('수정한 원문');
  expect(f.errors).toEqual([]);
 });

 test(`basket edit cancel returns to reading and save failure keeps the editor ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page),detail=page.locator('[data-basket-detail]'),text=detail.locator('[data-basket-text]'),read=detail.locator('[data-basket-read-text]');
  await enterBasket(page,width);await press(page,page.locator('[data-basket-row="n"]'),width);
  // Taps use screen positions, so wait until the formatted text has replaced the plain text.
  await expect(read).toHaveClass(/md-body/);
  // Unchanged: cancel returns at once without a question.
  // S48-28: 버릴지 묻는 것은 공용 작은 확인창(asked). 브라우저 기본 창은 뜨지 않아야 한다(dialogs).
  const dialogs=[],asked=[];page.on('dialog',d=>{dialogs.push(d.message());void d.dismiss();});
  await noteAction(page,'[data-basket-edit]',{press:l=>press(page,l,width)});
  // UI-디자인기준 1/3 보완: with 46px buttons this page now ends with [수정 저장]·[취소] at the bottom of the scroll.
  // There the swipe module's touchstart (will-change on the panel) lets Chromium's scroll anchoring move the
  // page 64px before the click, so the tap lands on the attachment link. That pre-existing interaction is
  // reported separately (UI-디자인기준-1보완 원장 행); keep this test about cancel semantics.
  if(width<761)await page.addStyleTag({content:'html,body{overflow-anchor:none}'});
  await press(page,detail.locator('[data-basket-cancel]'),width);
  await expect(read).toBeVisible();expect(dialogs).toEqual([]);await expect(page.locator('.kptu-ask')).toHaveCount(0);
  // Changed: the first answer keeps editing, the second discards.
  await noteAction(page,'[data-basket-edit]',{press:l=>press(page,l,width)});await text.fill('버릴 글');
  await press(page,detail.locator('[data-basket-cancel]'),width);asked.push(await answerAsk(page,false));expect(asked).toHaveLength(1);await expect(text).toBeVisible();await expect(text).toHaveValue('버릴 글');
  await press(page,detail.locator('[data-basket-cancel]'),width);asked.push(await answerAsk(page,true));expect(asked).toHaveLength(2);
  await expect(read).toBeVisible();await expect.poll(()=>read.innerText()).toBe(SHOWN);await expect(text).toHaveValue(LONG);
  // Failure keeps the editor and the typed text.
  f.setDenied(true);await noteAction(page,'[data-basket-edit]',{press:l=>press(page,l,width)});await text.fill('실패해도 남는 글');await press(page,detail.locator('[data-basket-save]'),width);
  await expect(detail.locator('[data-basket-status]')).toContainText('저장하지 못했어요');await expect(text).toBeVisible();await expect(text).toHaveValue('실패해도 남는 글');await expect(read).toBeHidden();
  // While editing, leaving the note still asks first.
  await press(page,detail.locator('[data-basket-close]'),width);asked.push(await answerAsk(page,false));expect(asked).toHaveLength(3);expect(dialogs).toEqual([]);await expect(text).toHaveValue('실패해도 남는 글');
  expect(f.errors.filter(e=>!e.includes('403'))).toEqual([]);
 });

 test(`basket quick input takes taps and typing after entering from home ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await enterBasket(page,width);
  const input=page.locator('#basketView [data-basket-list] [data-quick-input]'),b=await input.boundingBox();
  // The save button's enlarged hit area must stay on the button, not over the input.
  expect(await page.evaluate(([x,y])=>document.elementFromPoint(x,y)?.matches('[data-quick-input]'),[b.x+b.width/2,b.y+b.height/2])).toBe(true);
  await press(page,input,width);await expect(input).toBeFocused();expect(await input.evaluate(el=>({readOnly:el.readOnly,disabled:el.disabled}))).toEqual({readOnly:false,disabled:false});
  await page.keyboard.type('홈에서 들어와 쓴 메모');await expect(input).toHaveValue('홈에서 들어와 쓴 메모');
  await press(page,page.locator('#basketView [data-basket-list] [data-quick-save]'),width);await expect(input).toHaveValue('');
  expect(f.writes.at(-1)).toMatchObject({method:'POST',body:{raw_text:'홈에서 들어와 쓴 메모'}});expect(f.errors).toEqual([]);
 });
}

test('basket quick input takes taps and typing when the basket opens directly',async({page})=>{
 await page.setViewportSize({width:390,height:900});const f=await fixture(page,{query:'?view=basket'});
 await expect(page.locator('[data-basket-row]')).toHaveCount(1);
 const input=page.locator('#basketView [data-basket-list] [data-quick-input]');await press(page,input,390);await expect(input).toBeFocused();
 await page.keyboard.type('바로 연 정리함 메모');await press(page,page.locator('#basketView [data-basket-list] [data-quick-save]'),390);await expect(input).toHaveValue('');
 expect(f.writes.at(-1)).toMatchObject({method:'POST',body:{raw_text:'바로 연 정리함 메모'}});expect(f.errors).toEqual([]);
});

test('basket address restores a note in the read view without a keyboard',async({page})=>{
 await page.setViewportSize({width:390,height:900});await fixture(page,{query:'?view=basket&note=n'});
 const read=page.locator('[data-basket-read-text]');await expect(read).toBeVisible();await expect.poll(()=>read.innerText()).toBe(SHOWN);
 await expect(page.locator('[data-basket-text]')).toBeHidden();expect(await editableFocused(page)).toBe(false);
 noDialog(page);await page.locator('[data-basket-close]').click();await expect(page.locator('[data-basket-row="n"]')).toBeVisible();
});

// BIZ-저장먼저닫기 2차(S59-10): 글과 파일을 [추가]하면 글이 먼저 업데이트로 저장되고 입력칸은 바로 풀린다(잠그지 않는다 — 옛 잠금 안내·[새 업데이트 입력]은 없앰).
// 파일은 그 업데이트의 뒤 줄에서 올라가고, 결과를 모르는 실패(이미 붙었을 수 있음)는 하단바 위 한 줄에 남되 [다시 올리기]는 두지 않는다.
test('basket quick input never locks: a result-unknown upload behind is said on the line above the bottom bar, without a retry',async({page})=>{
 await page.setViewportSize({width:390,height:900});const f=await fixture(page,{query:'?view=basket'});
 await expect(page.locator('[data-basket-row]')).toHaveCount(1);
 let calls=0;await page.route(SB+'/functions/v1/basket-files',r=>{if(r.request().method()!=='POST')return r.fallback();const raw=r.request().postDataBuffer()?.toString('utf8')||'',id=raw.match(/name="note_id"\r\n\r\n([^\r]+)/)?.[1];return ++calls===1?r.fulfill({json:{ok:true,note_id:id,attachments:[{drive_file_id:'d1',file_name:'a.txt',mime_type:'text/plain',size_bytes:5}]}}):r.fulfill({status:503,json:{error:'첨부를 저장하지 못했어요.',code:'note_save_result_unknown',note_id:id}});});
 const q=page.locator('#basketView [data-basket-list] [data-home-quick]'),input=q.locator('[data-quick-input]');
 await expect(q.locator('[data-quick-lock],[data-quick-new-note]')).toHaveCount(0);
 await input.fill('첨부와 함께 쓴 글');await q.locator('input[type=file]').setInputFiles(['a.txt','b.txt'].map(name=>({name,mimeType:'text/plain',buffer:Buffer.from(name)})));
 await q.locator('[data-quick-save]').click();
 await expect(input).toHaveValue('');expect(await input.evaluate(el=>el.readOnly)).toBe(false);await expect(q.locator('[data-basket-file]')).toHaveCount(0);
 const dock=page.locator('#uploadDock:not([hidden])');
 await expect(dock).toContainText('업데이트에 파일 1개 못 올렸어요');await expect(dock).toContainText('파일 1개 올렸어요');
 await expect(dock.getByRole('button',{name:'못 올린 파일 다시 올리기'})).toHaveCount(0);
 expect(calls).toBe(2);expect(f.writes.filter(w=>w.method==='POST')).toHaveLength(1);
 await input.click();await page.keyboard.type('새로 쓰는 메모');await expect(input).toHaveValue('새로 쓰는 메모');
 expect(f.errors.filter(e=>!e.includes('503'))).toEqual([]);
});
