import {testOrigin} from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import {noteAction} from './helpers/basket-more.mjs';
import {answerAsk} from './helpers/small-notice.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { pickBasketView, expectBasketView } from './helpers/forget-view.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({hasTouch:true});
const quick=page=>page.locator('#homeView [data-home-quick]');
async function fixture(page){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const home=await openHome(page),writes=[];
 const notes=[{id:'s',raw_text:'제안 원문',occurred_at:'2026-10-06T05:00:00Z',ai_export_allowed:true},{id:'a',raw_text:' 보관 원문\n ',occurred_at:'2026-10-06T03:00:00Z',archived_at:'2026-10-06',ai_export_allowed:true},{id:'c',raw_text:'확정 원문',occurred_at:'2026-10-06T02:00:00Z',ai_export_allowed:true},{id:'n',raw_text:' 첫 줄\n\n둘째 줄  ',occurred_at:'2026-10-06T01:00:00Z',updated_at:'2026-10-06T01:00:00Z',ai_export_allowed:false}];
 let denied=false,empty=false,linksDenied=false;
 await page.route(SB+'/rest/v1/app_notes**',async r=>{
  const req=r.request(),u=new URL(req.url());if(req.method()==='GET')return r.fulfill({json:notes.slice(Number(u.searchParams.get('offset')||0),Number(u.searchParams.get('offset')||0)+100)});
  const body=req.postDataJSON();writes.push({method:req.method(),body,url:req.url()});
  if(denied)return r.fulfill({status:403,json:{message:'RLS 거부'}});
  if(empty)return r.fulfill({json:[]});
  if(req.method()==='POST'){const n={id:'new',occurred_at:'2026-10-06T04:00:00Z',...body};notes.unshift(n);return r.fulfill({json:[n]});}
  const n=notes.find(n=>'eq.'+n.id===u.searchParams.get('id'));Object.assign(n,body);return r.fulfill({json:[n]});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',r=>{
  if(!new URL(r.request().url()).searchParams.has('note_id'))return r.fallback();
  if(linksDenied)return r.fulfill({status:403,json:{message:'연결 조회 거부'}});
  return r.fulfill({json:[{note_id:'c',status:'confirmed',project_id:'p',project:{name:'테스트 프로젝트'}},{note_id:'c',status:'confirmed',organization_id:'o',organization:{name:'테스트 조직'}},{note_id:'c',status:'confirmed',document_id:'d',document:null},{note_id:'s',status:'suggested',project_id:'p',project:{name:'제안 프로젝트'}}]});
 });
 return {...home,notes,writes,errors,setDenied:v=>denied=v,setEmpty:v=>empty=v,setLinksDenied:v=>linksDenied=v};
}
async function enter(page,width,count=2){if(width<761){await page.locator('.mobile-tabs [data-view="basket"]').click();}else await page.locator('.app-nav [data-view="basket"]').click();await expect(page.locator('#basketView')).toBeVisible();await expect(page.locator('[data-basket-row]')).toHaveCount(count);}
for(const width of [390,1280]){
 test(`basket save edit AI hidden archive filters keyboard touch and console ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});const f=await fixture(page),q=quick(page);
  await expect(q).toHaveAttribute('data-mode','basket');await expect(q.locator('[data-quick-ai-excluded]')).toHaveCount(0);
  await expect(q).not.toContainText('AI 제외');
  await page.screenshot({path:info.outputPath(`home-basket-${width}.png`),fullPage:true});
  const raw=' 할일 자동 보내기 금지\n\n메모  ';
  await q.locator('[data-quick-input]').fill(raw);/* UI-빠른입력Ctrl엔터: 정리함 빠른 입력도 Ctrl+엔터 = [추가] */await q.locator('[data-quick-input]').press('Control+Enter');await expect(q.locator('[data-quick-input]')).toHaveValue('');
  expect(f.writes[0]).toMatchObject({method:'POST',body:{workspace_id:'w',raw_text:raw}});
  expect(f.requests.filter(r=>r.action==='create')).toHaveLength(0);expect(f.writes[0].body).not.toHaveProperty('ai_export_allowed');
  await expect(q.locator('[data-quick-ai-excluded]')).toHaveCount(0);
  if(width<761){await page.locator('.mobile-tabs [data-view="basket"]').click();}else await page.locator('.app-nav [data-view="basket"]').click();
  // UI-바구니거르기: [미분류] holds the new memo, the plain one and the one with only a stored suggestion; [분류] the linked one.
  await expect(page.locator('[data-basket-row]')).toHaveCount(3);await expect(page.locator('#basketView')).not.toContainText('AI 제외');
  await expect(page.locator('[data-basket-row-item="s"]')).toContainText('정리 제안 있음');
  await pickBasketView(page,'classified');await expect(page.locator('[data-basket-row]')).toHaveCount(1);
  await expect(page.locator('[data-basket-place-filter]')).toBeVisible();
  // BUG-바구니연결해제: link chips sit under the row button, inside the row item.
  const confirmed=page.locator('[data-basket-row-item="c"]');await expect(confirmed).toContainText('분류 완료');await expect(confirmed).toContainText('테스트 프로젝트');await expect(confirmed).toContainText('테스트 조직');await expect(confirmed).toContainText('연결 대상 없음');
  await pickBasketView(page,'unclassified');await expect(page.locator('[data-basket-place-filter]')).toBeHidden();
  await page.locator('[data-basket-row="new"]').focus();await page.keyboard.press('Enter');await expect(page.locator('[data-basket-read-text]')).toHaveText(raw.trim());await expect(page.locator('[data-basket-text]')).toBeHidden();await page.locator('[data-basket-note-more]').press('Enter');await expect(page.locator('#basketNoteMenu [data-basket-edit]')).toBeFocused();await page.keyboard.press('Enter');await expect(page.locator('[data-basket-text]')).toBeFocused();await expect(page.locator('[data-basket-text]')).toHaveValue(raw);const editor=await page.locator('[data-basket-text]').boundingBox();expect(editor.width).toBeGreaterThanOrEqual(width===1280?600:300);
  const revised=' 수정한 원문\n\n마지막  ';await page.locator('[data-basket-text]').fill(revised);await page.locator('[data-basket-save]').click();await expect(page.locator('#toast')).toContainText('저장');expect(f.writes.at(-1).body.raw_text).toBe(revised);expect(f.writes.at(-1).body.updated_at).toBeTruthy();
  await expect(page.locator('[data-basket-ai-excluded]')).toHaveCount(0);expect(f.writes.at(-1).body).not.toHaveProperty('ai_export_allowed');expect(f.notes.find(n=>n.id==='n').ai_export_allowed).toBe(false);
  await noteAction(page,'[data-basket-archive]');await expect(page.locator('[data-basket-archive]')).toHaveText('보류 해제');expect(f.notes[0].archived_at).toBeTruthy();
  await page.locator('[data-basket-close]').click();await pickBasketView(page,'archived');await expect(page.locator('[data-basket-row]')).toHaveCount(2);await expect(page.locator('[data-basket-row-item="new"]')).toContainText('보류');
  await page.locator('[data-basket-row="new"]').click();await noteAction(page,'[data-basket-archive]');await expect(page.locator('[data-basket-archive]')).toHaveText('보류로');expect(f.notes[0].archived_at).toBeNull();await page.screenshot({path:info.outputPath(`basket-detail-${width}.png`),fullPage:true});await page.locator('[data-basket-close]').click();
  await pickBasketView(page,'unclassified');await page.screenshot({path:info.outputPath(`basket-${width}.png`),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const b=await page.locator('[data-basket-row="new"]').boundingBox();expect(await page.locator('[data-basket-row="new"]').evaluate(el=>parseFloat(getComputedStyle(el,'::after').height))).toBeGreaterThanOrEqual(44); // S52-20: 한 목록 줄 내용 버튼(③ 글자 버튼), 누르는 범위 44px
  if(width===390){await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);await expect(page.locator('[data-basket-read-text]')).toHaveText(revised.trim());await expect(page.locator('[data-basket-text]')).toBeHidden();await page.keyboard.press('Escape');await expect(page.locator('[data-basket-row="new"]')).toBeFocused();}
  expect(await page.locator('#basketView').getByRole('button',{name:'삭제',exact:true}).count()).toBe(0);
  await page.evaluate(()=>window.KPTURouter.go('home'));await enter(page,width,3);
  await expectBasketView(page,'unclassified');
  expect(f.errors).toEqual([]);expect(f.writes.every(w=>w.method!=='DELETE')).toBe(true);
 });
 test(`basket validation and RLS failures keep draft and AI hidden ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});const f=await fixture(page),q=quick(page),input=q.locator('[data-quick-input]');
  // UI-빈입력안내: blank text is a small hint under the input (no error status); too long text is still an error. Both keep the draft.
  await input.fill(' \n ');await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-hint]')).toHaveText('글을 입력해 주세요.');await expect(q.locator('[data-quick-status]')).toBeEmpty();await expect(input).toHaveValue(' \n ');
  await input.fill('가'.repeat(20001));await expect(q.locator('[data-quick-hint]')).toBeEmpty();await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-status]')).not.toBeEmpty();await expect(input).toHaveValue('가'.repeat(20001));expect(f.writes).toHaveLength(0);
  f.setDenied(true);await input.fill(' 원문 유지\n ');await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-status]')).toContainText('RLS 거부');await expect(input).toHaveValue(' 원문 유지\n ');
  f.setDenied(false);await input.fill('가'.repeat(20000));await q.locator('[data-quick-save]').click();await expect(input).toHaveValue('');
  await page.evaluate(()=>window.KPTURouter.go('basket'));await page.locator('[data-basket-row="n"]').click();
  f.setDenied(true);await noteAction(page,'[data-basket-archive]');await expect(page.locator('[data-basket-status]')).toHaveText('저장하지 못했어요. 다시 시도해 주세요.');await expect(page.locator('[data-basket-archive]')).toHaveText('보류로');f.setDenied(false);
  await noteAction(page,'[data-basket-edit]');
  for(const text of [' \n ','가'.repeat(20001)]){const before=f.writes.length;await page.locator('[data-basket-text]').fill(text);await page.locator('[data-basket-save]').click();await expect(page.locator('[data-basket-status]')).not.toBeEmpty();expect(f.writes).toHaveLength(before);}
  await page.locator('[data-basket-text]').fill(' 편집 실패\n ');f.setDenied(true);await page.locator('[data-basket-save]').click();await expect(page.locator('[data-basket-status]')).toHaveText('저장하지 못했어요. 다시 시도해 주세요.');await expect(page.locator('[data-basket-text]')).toHaveValue(' 편집 실패\n ');
  await expect(page.locator('[data-basket-ai-excluded]')).toHaveCount(0);expect(f.notes.find(n=>n.id==='n').ai_export_allowed).toBe(false);expect(f.writes.every(w=>!Object.hasOwn(w.body,'ai_export_allowed'))).toBe(true);
  f.setDenied(false);f.setEmpty(true);await page.locator('[data-basket-save]').click();await expect(page.locator('[data-basket-status]')).toHaveText('저장하지 못했어요. 다시 시도해 주세요.');await expect(page.locator('[data-basket-text]')).toHaveValue(' 편집 실패\n ');
 });
}
test('basket links failure shows error and retry rather than false unclassified list',async({page})=>{const f=await fixture(page);f.setLinksDenied(true);await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-list-status]')).toHaveText('업데이트를 불러오지 못했어요. 다시 시도해 주세요.');await expect(page.locator('[data-basket-row]')).toHaveCount(0);f.setLinksDenied(false);await page.locator('[data-basket-retry]').click();await expect(page.locator('[data-basket-row]')).toHaveCount(2);});
test('basket raw text and drafts never enter permanent browser storage',async({page})=>{await fixture(page);await quick(page).locator('[data-quick-input]').fill('BASKET_PRIVATE_DRAFT');await quick(page).locator('[data-quick-save]').click();await expect(quick(page).locator('[data-quick-input]')).toHaveValue('');await quick(page).locator('[data-quick-input]').fill('BASKET_PRIVATE_UNSAVED');await page.evaluate(()=>window.KPTURouter.go('basket'));await page.locator('[data-basket-row="new"]').click();await noteAction(page,'[data-basket-edit]');await page.locator('[data-basket-text]').fill('BASKET_PRIVATE_EDIT');const cdp=await page.context().newCDPSession(page);const stored=JSON.stringify(await Promise.all([true,false].map(isLocalStorage=>cdp.send('DOMStorage.getDOMStorageItems',{storageId:{securityOrigin:testOrigin,isLocalStorage}}))));expect(stored).not.toContain('BASKET_PRIVATE');});
test('basket direct URL and home return refresh new notes without saving view choice',async({page})=>{
 const f=await fixture(page);await page.goto(testOrigin+'/app/?view=basket');await expect(page.locator('#basketView')).toBeVisible();await expect(page.locator('[data-basket-row]')).toHaveCount(2);
 await pickBasketView(page,'archived');await expect(page.locator('[data-basket-row="a"]')).toBeVisible();
 await page.reload();await expectBasketView(page,'unclassified');await expect(page.locator('[data-basket-row="n"]')).toBeVisible();
 await page.locator('.mobile-tabs [data-view="home"]:visible,.app-nav [data-view="home"]:visible,.app-nav .sidebar-brand:visible').click();await quick(page).locator('[data-quick-input]').fill('새 글');await quick(page).locator('[data-quick-save]').click();await expect(quick(page).locator('[data-quick-input]')).toHaveValue('');
 await page.locator('#homeView [data-home-quick] [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').first().click();await expect(page.locator('[data-basket-row]')).toHaveCount(3);expect(f.writes).toHaveLength(1);
});
test('basket save lock blocks duplicate home posts and detail patches, reload guard keeps pending edits',async({page})=>{
 const f=await fixture(page);let release;let pending=new Promise(r=>release=r);
 await page.route(SB+'/rest/v1/app_notes**',async r=>{if(r.request().method()==='GET')return r.fallback();await pending;return r.fallback();});
 const q=quick(page);await q.locator('[data-quick-input]').fill('잠긴 저장');await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toBeDisabled();await q.locator('[data-quick-save]').dispatchEvent('click');release();await expect(q.locator('[data-quick-input]')).toHaveValue('');expect(f.writes).toHaveLength(1);
 await page.locator('#homeView [data-home-quick] [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').first().click();await page.locator('[data-basket-row="new"]').click();await noteAction(page,'[data-basket-edit]');await page.locator('[data-basket-text]').fill('수정 중 글');
 expect(await page.evaluate(()=>{const detail={otherDraft:false};window.dispatchEvent(new CustomEvent('kptu:before-reload',{cancelable:true,detail}));return detail.otherDraft;})).toBe(true);
 pending=new Promise(r=>release=r);await page.locator('[data-basket-save]').click();await expect(page.locator('[data-basket-text]')).toBeDisabled();await page.locator('[data-basket-save]').dispatchEvent('click');
 expect(await page.evaluate(()=>{const e=new CustomEvent('kptu:before-reload',{cancelable:true,detail:{}});window.dispatchEvent(e);return e.defaultPrevented;})).toBe(true);
 release();await expect(page.locator('#toast')).toContainText('저장');expect(f.writes).toHaveLength(2);
});
test('session scope change clears basket content and prevents a delayed response from restoring it',async({page})=>{
 await fixture(page);let release;const pending=new Promise(r=>release=r);
 await page.route(SB+'/rest/v1/app_notes?**',async r=>{await pending;await r.fulfill({json:[{id:'stale',raw_text:'BASKET_STALE_PRIVATE',occurred_at:'2026-10-06'}]});});
 await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-list-status] [data-wait]')).toHaveCount(1);
 await page.evaluate(()=>{const rt=window.KPTURuntime;const c=rt.context.read();rt.context.set({...c,user:{...c.user,id:'different'}});window.dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:rt.session.read()}}));});release();
 await expect(page.locator('[data-basket-row]')).toHaveCount(0);await expect(page.locator('#basketView')).not.toContainText('BASKET_STALE_PRIVATE');
});
test('unsaved detail survives canceled list/Escape dismissal and navigation until explicit discard',async({page})=>{
 await fixture(page);await page.locator('#homeView [data-home-quick] [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').first().click();await pickBasketView(page,'classified');await pickBasketView(page,'unclassified');await page.locator('[data-basket-row="n"]').click();await noteAction(page,'[data-basket-edit]');const input=page.locator('[data-basket-text]');await input.fill('수정 중인 원문');
 await page.locator('[data-basket-close]').click();await answerAsk(page,false);await expect(input).toHaveValue('수정 중인 원문');
 await input.press('Escape');await answerAsk(page,false);await expect(input).toHaveValue('수정 중인 원문');
 const address=page.url();page.once('dialog',d=>d.dismiss());await page.evaluate(()=>window.KPTURouter.go('home'));await expect(page.locator('#basketView')).toBeVisible();expect(page.url()).toBe(address);await expect(input).toHaveValue('수정 중인 원문');
 await page.locator('[data-basket-close]').click();await answerAsk(page,true);await expect(page.locator('[data-basket-row="n"]')).toBeFocused();await expectBasketView(page,'unclassified');await expect(page.locator('[data-basket-row]')).toHaveCount(2);await pickBasketView(page,'classified');await expect(page.locator('[data-basket-row]')).toHaveCount(1);await pickBasketView(page,'unclassified');await expectBasketView(page,'unclassified');await expect(page.locator('[data-basket-row]')).toHaveCount(2);await page.locator('[data-basket-row="n"]').click();await expect(page.locator('[data-basket-read-text]')).toHaveText(' 첫 줄\n\n둘째 줄  ');await expect(input).toBeHidden();await expect(input).toHaveValue(' 첫 줄\n\n둘째 줄  ');
});
test('explicit task and update modes still save directly when preference storage is blocked',async({page})=>{
 const f=await fixture(page),q=quick(page);await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('blocked');};});
 await q.locator('[data-quick-mode="task"]').click();await expect(q).toHaveAttribute('data-mode','task');await q.locator('[data-quick-input]').fill('할 일 직접 저장');await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');expect(f.requests.filter(r=>r.action==='create')).toHaveLength(1);expect(f.writes).toHaveLength(0);
 await q.locator('[data-quick-mode="update"]').click();await expect(q).toHaveAttribute('data-mode','basket');await q.locator('[data-quick-input]').fill('조직 직접 저장');await q.locator('[data-quick-org]').click();await page.getByRole('dialog').getByRole('button',{name:'테스트 조직',exact:true}).first().click();await page.getByRole('dialog').getByRole('button',{name:'저장',exact:true}).click();await expect(q).toHaveAttribute('data-mode','update');const bodies=[];
 await page.route(SB+'/rest/v1/app_suborganization_updates',r=>{bodies.push(r.request().postDataJSON());return r.fulfill({json:[]});});await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');expect(bodies[0]).toEqual({organization_id:'o',raw_text:'조직 직접 저장',created_by:'home-test'});expect(f.writes).toHaveLength(0);
});
test('opening and saving unchanged CRLF text does not rewrite original or create a false dirty draft',async({page})=>{
 const f=await fixture(page);f.notes.find(n=>n.id==='n').raw_text=' first\r\n\r\nlast \r';await page.locator('#homeView [data-home-quick] [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').first().click();await page.locator('[data-basket-row="n"]').click();await noteAction(page,'[data-basket-edit]');await expect(page.locator('[data-basket-text]')).toHaveValue(' first\n\nlast \n');
 expect(await page.evaluate(()=>{const detail={otherDraft:false};window.dispatchEvent(new CustomEvent('kptu:before-reload',{cancelable:true,detail}));return detail.otherDraft;})).toBe(false);
 await page.locator('[data-basket-save]').click();await expect(page.locator('#toast')).toContainText('저장');expect(f.writes).toHaveLength(0);expect(f.notes.find(n=>n.id==='n').raw_text).toBe(' first\r\n\r\nlast \r');
});
const uploadFiles = names => names.map(name=>({name,mimeType:'text/plain',buffer:Buffer.from('fixture file')}));
async function basketUploadFixture(page,f){
 const calls=[];let response=null,release=null;
 await page.route(SB+'/functions/v1/basket-files',async r=>{
  const raw=r.request().postDataBuffer().toString();calls.push(raw);
  if(release)await release;
  if(response && calls.length > (response.after || 0))return r.fulfill({status:response.status,json:{error:'첨부를 저장하지 못했어요.',code:response.code,note_id:'uploaded'}});
  const match=raw.match(/name="note_id"\r\n\r\n([^\r]+)/),id=match?.[1]||'uploaded';
  let n=f.notes.find(n=>n.id===id);if(!n){n={id,raw_text:raw.match(/name="raw_text"\r\n\r\n([\s\S]*?)\r\n--/)?.[1]||'',occurred_at:'2026-10-10T10:00:00Z',ai_export_allowed:true,attachments:[]};f.notes.unshift(n);}
  n.attachments||=[];n.attachments.push({drive_file_id:'file_'+calls.length,file_name:raw.match(/filename="([^"]+)"/)?.[1],size_bytes:12});
  return r.fulfill({json:{ok:true,note_id:id,attachments:n.attachments}});
 });
 return {calls,setError:v=>response=v,setPending:v=>release=v};
}
for(const width of [390,1280]){
 test(`basket text+file sequential upload then existing note attachment links ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});const f=await fixture(page),u=await basketUploadFixture(page,f),q=quick(page);
  await q.locator('[data-quick-input]').fill(' 글과 첨부\n ');await q.locator('input[type=file]').setInputFiles(uploadFiles(['one.txt','cancel.txt']));
  await expect(q.locator('[data-basket-file]')).toHaveCount(2);const cancel=q.getByRole('button',{name:'cancel.txt 선택 취소'});await cancel.focus();await page.keyboard.press('Enter');await expect(q.locator('[data-basket-file]')).toHaveCount(1);
  await q.locator('input[type=file]').setInputFiles(uploadFiles(['two.txt','three.txt']));
  // BIZ-저장먼저닫기 2차(S59-10): 글이 먼저 업데이트로 저장되고(POST 한 번) 입력칸은 바로 비고 풀린다. 파일 셋은 그 업데이트의 뒤 줄에서
  // 하나씩(note_id) 올라가고, 하단바 위 한 줄이 묶음 전체 → '업데이트에 파일 3개 올렸어요'.
  let finish;u.setPending(new Promise(r=>finish=r));await q.locator('[data-quick-save]').click();
  await expect(q.locator('[data-basket-file]')).toHaveCount(0);await expect(q.locator('[data-quick-input]')).toHaveValue('');await expect(q.locator('[data-quick-input]')).toBeEditable();
  await expect(page.locator('#toast')).toHaveText('잊지 말기에 저장했어요. 사진·파일은 올리는 중이에요.');
  expect(f.writes).toHaveLength(1);expect(f.writes[0]).toMatchObject({method:'POST',body:{raw_text:' 글과 첨부\n '}});
  const dock=page.locator('#uploadDock:not([hidden])');await expect(dock).toContainText('파일 3개 올리는 중');await expect.poll(()=>u.calls.length).toBe(1);
  await q.locator('[data-quick-save]').dispatchEvent('click');await expect(q.locator('[data-quick-hint]')).toContainText('글을 입력해 주세요');
  finish();u.setPending(null);await expect(dock).toContainText('업데이트에 파일 3개 올렸어요');
  expect(u.calls).toHaveLength(3);for(const raw of u.calls){expect(raw).toContain('name="note_id"\r\n\r\nnew');expect(raw).not.toContain('name="raw_text"');}expect(f.writes).toHaveLength(1);
  await q.locator('[data-quick-save]').click();expect(u.calls).toHaveLength(3);await expect(page.locator('#toast')).toHaveClass(/hidden/);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:info.outputPath(`basket-upload-home-${width}.png`),fullPage:true});
  await page.locator('#homeView [data-home-quick] [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').first().click();await expect(page.locator('[data-basket-row-item="new"]')).toContainText('첨부 3개');await page.locator('[data-basket-row="new"]').click();await noteAction(page,'[data-basket-edit]');await expect(page.locator('[data-basket-attachments] a')).toHaveCount(3);await expect(page.locator('[data-basket-attachments] a').first()).toHaveAttribute('href','https://drive.google.com/file/d/file_1/view');
  const picker=page.locator('[data-basket-detail]').getByRole('button', { name: '파일 첨부', exact: true });await picker.focus();await expect(picker).toBeFocused();const chooser=page.waitForEvent('filechooser');await picker.press('Enter');await (await chooser).setFiles(uploadFiles(['four.txt']));
  const btn=page.locator('[data-basket-upload]');await btn.scrollIntoViewIfNeeded();const b=await btn.boundingBox();expect(b.height).toBeGreaterThanOrEqual(32);expect(await btn.evaluate(el=>parseFloat(getComputedStyle(el,'::after').height))).toBe(44);/* UI-업데이트편집한줄: 작은 버튼(32px), 누르는 범위 44px */if(width===390)await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);else await btn.click();
  await expect(page.locator('[data-basket-attachments] a')).toHaveCount(4);expect(u.calls.at(-1)).toContain('name="note_id"\r\n\r\nnew');expect(u.calls.at(-1)).not.toContain('name="raw_text"');await expect(page.locator('#toast')).toHaveClass(/hidden/);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:info.outputPath(`basket-upload-detail-${width}.png`),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(f.errors).toEqual([]);
 });
 test(`basket file only and copy failure no requests ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});const f=await fixture(page),u=await basketUploadFixture(page,f),q=quick(page);
  // BIZ-저장먼저닫기 2차(S59-10): 파일만이면 앞에서 저장할 글이 없다 — 입력칸은 바로 풀리고 첫 파일이 뒤에서 업데이트를 만든다.
  await q.locator('input[type=file]').setInputFiles(uploadFiles(['only.txt']));await q.locator('[data-quick-save]').click();await expect(q.locator('[data-basket-file]')).toHaveCount(0);await expect.poll(()=>u.calls.length).toBe(1);expect(u.calls[0]).not.toContain('name="raw_text"');expect(u.calls[0]).not.toContain('name="note_id"');await expect(page.locator('#uploadDock:not([hidden])')).toContainText('업데이트에 파일 1개 올렸어요');expect(f.writes).toHaveLength(0);
  // UPD-사진여러장: a file is read as soon as it is chosen; one that cannot be read leaves the list with a plain line and sends nothing.
  await page.evaluate(()=>{window.KPTURuntime.copyUploadFile=async()=>{throw Object.assign(Error('read'),{code:'file_read_failed'});};});await q.locator('input[type=file]').setInputFiles(uploadFiles(['bad.txt','later.txt']));await expect(q.locator('[data-quick-status]')).toContainText('사진을 못 받았어요');await expect(q.locator('[data-basket-file]')).toHaveCount(0);await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-hint]')).toContainText('사진을 못 받았어요');expect(u.calls).toHaveLength(1);expect(f.errors).toEqual([]);
 });
 // BIZ-저장먼저닫기 2차(S59-10): 글은 먼저 저장되고 입력칸은 바로 풀린다. 뒤 줄에서 둘째 파일이 실패하면 그 뒤 파일은 보내지 않고, 하단바 위 한 줄에
// '업데이트에 파일 2개 못 올렸어요' + 올라간 것·까닭. 결과를 모르거나(503) 글이 바뀐(409) 실패는 [다시 올리기]가 없고, 나머지는 못 올린 것만 다시 보낸다.
for(const [status,code,message] of [[503,'note_save_result_unknown','저장 결과를 확인하지 못했어요. 잊지 말기에서 확인 후 다시 시도하세요'],[409,'note_changed','업데이트를 다시 불러'],[401,'unauthorized','로그인'],[413,'file_too_large','100MiB']])test(`basket ${status} keeps completed files stops queue ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});const f=await fixture(page),u=await basketUploadFixture(page,f),q=quick(page);await q.locator('[data-quick-input]').fill('중간 실패 시 원문 유지');await q.locator('input[type=file]').setInputFiles(uploadFiles(['done.txt','bad.txt','later.txt']));
  u.setError({status,code,after:1});await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');await expect(q.locator('[data-basket-file]')).toHaveCount(0);
  expect(f.writes).toHaveLength(1);expect(f.writes[0].body.raw_text).toBe('중간 실패 시 원문 유지');
  const dock=page.locator('#uploadDock:not([hidden])'),retry=dock.getByRole('button',{name:'못 올린 파일 다시 올리기'});
  await expect(dock).toContainText('업데이트에 파일 2개 못 올렸어요');await expect(dock).toContainText('파일 1개 올렸어요');await expect(dock).toContainText(message);expect(u.calls).toHaveLength(2);
  if(status===503||status===409){await expect(retry).toHaveCount(0);expect(u.calls).toHaveLength(2);}else {await retry.click();await expect.poll(()=>u.calls.length).toBe(3);expect(u.calls[2]).toContain('filename="bad.txt"');expect(u.calls[2]).toContain('name="note_id"\r\n\r\nnew');}
  const expectedHTTP=`Failed to load resource: the server responded with a status of ${status} (${({503:'Service Unavailable',409:'Conflict',401:'Unauthorized',413:'Payload Too Large'})[status]})`;await expect.poll(()=>f.errors).toEqual(Array(status===503||status===409?1:2).fill(expectedHTTP));
 });
}
test('basket attachment preflight, invalid link and file-only unchanged edit',async({page})=>{
 const f=await fixture(page),u=await basketUploadFixture(page,f),q=quick(page);await q.locator('input[type=file]').setInputFiles(uploadFiles(Array.from({length:21},(_,i)=>i+'.txt')));await expect(q.locator('[data-quick-status]')).toContainText('20개');await expect(q.locator('[data-basket-file]')).toHaveCount(0);expect(u.calls).toHaveLength(0);
 await q.locator('input[type=file]').evaluate(el=>{const d=new DataTransfer();d.items.add(new File([new Uint8Array(104857601)],'large'));el.files=d.files;el.dispatchEvent(new Event('change'));});await expect(q.locator('[data-quick-status]')).toContainText('100MiB');expect(u.calls).toHaveLength(0);
 f.notes.find(n=>n.id==='n').raw_text='';f.notes.find(n=>n.id==='n').attachments=[{file_name:'invalid.txt',size_bytes:1024,drive_file_id:'bad/id'}];await page.locator('#homeView [data-home-quick] [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').first().click();await page.locator('[data-basket-row="n"]').click();await noteAction(page,'[data-basket-edit]');await expect(page.locator('[data-basket-attachments]')).toContainText('invalid.txt');await expect(page.locator('[data-basket-attachments]')).toContainText('1.0 KB');await expect(page.locator('[data-basket-attachments] a')).toHaveCount(0);await page.locator('[data-basket-save]').click();expect(f.writes).toHaveLength(0);
});
// BIZ-저장먼저닫기 2차(S59-10): 글은 쓴 그대로(앞뒤 빈칸·줄바꿈 포함) 먼저 저장되고, 파일은 그 업데이트로 올라간다. 결과를 모르는 실패(503)는
// 하단바 위 한 줄에 남되 다시 보내지 않는다. 입력칸은 잠그지 않으므로 바로 새 업데이트를 쓸 수 있다(옛 잠금·[새 업데이트 입력]은 없앰).
test('basket text+one file preserves raw text and a 503 behind is never sent again, while the input stays free',async({page})=>{
 const f=await fixture(page),u=await basketUploadFixture(page,f),q=quick(page),raw=' 첫 파일 원문\n ',dock=page.locator('#uploadDock:not([hidden])');
 await q.locator('[data-quick-input]').fill(raw);await q.locator('input[type=file]').setInputFiles(uploadFiles(['one.txt']));await q.locator('[data-quick-save]').click();await expect(q.locator('[data-basket-file]')).toHaveCount(0);await expect(q.locator('[data-quick-input]')).toHaveValue('');
 expect(f.writes.map(w=>w.body.raw_text)).toEqual([raw]);await expect(dock).toContainText('업데이트에 파일 1개 올렸어요');expect(u.calls).toHaveLength(1);expect(u.calls[0]).toContain('name="note_id"\r\n\r\nnew');
 await dock.getByRole('button',{name:'올리기 알림 닫기'}).click();await expect(dock).toHaveCount(0);
 u.setError({status:503,code:'note_save_result_unknown'});await q.locator('input[type=file]').setInputFiles(uploadFiles(['unknown.txt','later.txt']));await q.locator('[data-quick-save]').click();
 await expect(dock).toContainText('업데이트에 파일 2개 못 올렸어요');await expect(dock).toContainText('잊지 말기에서 확인 후 다시 시도하세요');await expect(dock.getByRole('button',{name:'못 올린 파일 다시 올리기'})).toHaveCount(0);expect(u.calls).toHaveLength(2);
 await expect(q.locator('[data-basket-file]')).toHaveCount(0);await expect(q.locator('input[type=file]')).toBeEnabled();await expect(q.locator('[data-quick-input]')).toBeEditable();
 u.setError(null);await q.locator('input[type=file]').setInputFiles(uploadFiles(['next.txt']));await q.locator('[data-quick-save]').click();await expect.poll(()=>u.calls.length).toBe(3);expect(u.calls[2]).toContain('filename="next.txt"');expect(u.calls[2]).not.toContain('name="note_id"');expect(u.calls.filter(c=>c.includes('unknown.txt')||c.includes('later.txt'))).toHaveLength(1);
});
test('basket detail 409 reload preserves existing AI setting and unsaved text until explicit confirmation',async({page})=>{
 const f=await fixture(page),u=await basketUploadFixture(page,f),q=quick(page);await page.locator('#homeView [data-home-quick] [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').first().click();await page.locator('[data-basket-row="n"]').click();await noteAction(page,'[data-basket-edit]');await page.locator('[data-basket-text]').fill('미저장 수정');await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['one.txt']));await page.locator('[data-basket-upload]').click();await expect(page.locator('#toast')).toContainText('첨부를 저장했습니다');await expect(page.locator('[data-basket-text]')).toHaveValue('미저장 수정');expect(f.notes.find(n=>n.id==='n').ai_export_allowed).toBe(false);
 u.setError({status:409,code:'note_changed'});await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['conflict.txt']));await page.locator('[data-basket-upload]').click();await expect(page.locator('[data-basket-status]')).toContainText('업데이트를 다시 불러');await page.locator('[data-basket-upload]').click();expect(u.calls).toHaveLength(2);
 f.notes.find(n=>n.id==='n').raw_text='외부에서 바뀐 원문';await page.locator('[data-basket-reload]').click();await answerAsk(page,false);await expect(page.locator('[data-basket-text]')).toHaveValue('미저장 수정');await page.locator('[data-basket-reload]').click();await answerAsk(page,true);await expect(page.locator('[data-basket-text]')).toHaveValue('외부에서 바뀐 원문');await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1);await expect(page.locator('[data-basket-file]')).toHaveCount(0);expect(u.calls).toHaveLength(2);expect(f.writes).toHaveLength(0);
});
test('basket scope change while reading a file drops draft and sends no stale upload',async({page})=>{
 const f=await fixture(page),u=await basketUploadFixture(page,f),q=quick(page);await q.locator('[data-quick-input]').fill('private draft');await page.evaluate(()=>{const rt=window.KPTURuntime,copy=rt.copyUploadFile;rt.copyUploadFile=f=>new Promise(resolve=>{window.releaseBasketCopy=()=>copy(f).then(resolve);});});await q.locator('input[type=file]').setInputFiles(uploadFiles(['private.txt']));await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');expect(f.writes).toHaveLength(1);await page.evaluate(()=>{const rt=window.KPTURuntime;rt.context.set({...rt.context.read(),workspace:{id:'different'}});window.dispatchEvent(new CustomEvent('kptu:session-changed'));window.releaseBasketCopy();});await expect(q.locator('[data-quick-input]')).toHaveValue('');await expect(q.locator('[data-basket-file]')).toHaveCount(0);await expect(q.locator('[data-quick-save]')).toBeEnabled();await page.waitForTimeout(300);expect(u.calls).toHaveLength(0);await expect(page.locator('#uploadDock:not([hidden])',{hasText:'못 올렸어요'})).toHaveCount(0);expect(f.errors).toEqual([]);
});
test('basket attachment save invalidates an earlier list read and keeps counts when reopened',async({page})=>{
 const f=await fixture(page),u=await basketUploadFixture(page,f),q=quick(page);await page.locator('#homeView [data-home-quick] [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').first().click();await page.locator('[data-basket-row="n"]').click();await page.locator('[data-basket-close]').click();
 let release;const pending=new Promise(r=>release=r),old=structuredClone(f.notes);
 await page.route(SB+'/rest/v1/app_notes?**',async r=>{await pending;return r.fulfill({json:old});});await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-list-status] [data-wait]')).toHaveCount(1);
 await page.locator('[data-basket-row="n"]').click();await noteAction(page,'[data-basket-edit]');await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['fresh.txt']));await page.locator('[data-basket-upload]').click();await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1);const linksDone=page.waitForResponse(r=>r.url().includes('app_record_links')&&r.url().includes('note_id'));release();await linksDone;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect(page.locator('[data-basket-row-item="n"]')).toContainText('첨부 1개');await page.locator('[data-basket-close]').click();await page.locator('[data-basket-row="n"]').click();await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1);expect(u.calls).toHaveLength(1);expect(f.errors).toEqual([]);
});
test('basket opening detail invalidates older reads that finish before attachment save',async({page})=>{
 const f=await fixture(page),u=await basketUploadFixture(page,f),q=quick(page);await page.locator('#homeView [data-home-quick] [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').first().click();await page.locator('[data-basket-row="n"]').click();await page.locator('[data-basket-close]').click();
 let release;const pending=new Promise(r=>release=r),old=structuredClone(f.notes);
 await page.route(SB+'/rest/v1/app_notes?**',async r=>{await pending;return r.fulfill({json:old});});await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-list-status] [data-wait]')).toHaveCount(1);await page.locator('[data-basket-row="n"]').click();await noteAction(page,'[data-basket-edit]');
 const linksDone=page.waitForResponse(r=>r.url().includes('app_record_links')&&r.url().includes('note_id'));release();await linksDone;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['fresh.txt']));await page.locator('[data-basket-upload]').click();await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1);await expect(page.locator('[data-basket-row-item="n"]')).toContainText('첨부 1개');await page.locator('[data-basket-close]').click();await page.locator('[data-basket-row="n"]').click();await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1);expect(u.calls).toHaveLength(1);expect(f.errors).toEqual([]);
});
for(const width of [390,1280])test(`basket all-success reset starts a fresh memo without reusing note_id ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});const f=await fixture(page),u=await basketUploadFixture(page,f),q=quick(page);
 for(const text of ['첫 메모','다음 메모']){
  await q.locator('[data-quick-input]').fill(text);await q.locator('input[type=file]').setInputFiles(uploadFiles([text+'.txt']));await q.locator('[data-quick-save]').click();
  // BIZ-저장먼저닫기 2차(S59-10): 저장마다 글이 제 업데이트로 먼저 저장되고(POST 하나씩) 파일은 그 업데이트로 — 앞 업데이트를 다시 쓰지 않는다.
  await expect(q.locator('[data-basket-file]')).toHaveCount(0);await expect(q.locator('[data-quick-input]')).toHaveValue('');await expect(q.locator('[data-quick-input]')).toBeEditable();await expect(page.locator('#toast')).toBeVisible();
  await expect.poll(()=>u.calls.length).toBe(f.writes.length);expect(f.writes.at(-1)).toMatchObject({method:'POST',body:{raw_text:text}});expect(u.calls.at(-1)).toContain('name="note_id"\r\n\r\nnew');expect(u.calls.at(-1)).not.toContain('name="raw_text"');
  await expect(page.locator('#uploadDock:not([hidden])')).toContainText('업데이트에 파일 1개 올렸어요');
  expect(await page.evaluate(()=>{const e=new CustomEvent('kptu:before-reload',{cancelable:true,detail:{}});window.dispatchEvent(e);return {blocked:e.defaultPrevented,draft:!!e.detail.otherDraft};})).toEqual({blocked:false,draft:false});
 }
 expect(u.calls).toHaveLength(2);expect(f.writes).toHaveLength(2);expect(f.errors).toEqual([]);
});
test('basket successful text save clears a native selection rejected by preflight',async({page})=>{
 const f=await fixture(page),u=await basketUploadFixture(page,f),q=quick(page),file=q.locator('input[type=file]');
 await file.setInputFiles({name:'empty.txt',mimeType:'text/plain',buffer:Buffer.alloc(0)});await expect(q.locator('[data-quick-status]')).toContainText('빈 파일');await expect(q.locator('[data-basket-file]')).toHaveCount(0);
 await q.locator('[data-quick-input]').fill('글만 저장');await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');expect(f.writes).toHaveLength(1);expect(u.calls).toHaveLength(0);
 expect(await file.evaluate(input=>({value:input.value,count:input.files.length}))).toEqual({value:'',count:0});await expect(q.locator('[data-quick-new-note]')).toBeHidden();expect(f.errors).toEqual([]);
});
for(const width of [390,1280])test(`basket original link opens the exact suggested or archived note after owner reads ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:1000});const f=await fixture(page);
 await page.goto(testOrigin+'/app/?view=basket&note=s');
 await expect(page.locator('[data-basket-text]')).toHaveValue('제안 원문');await expect(page.locator('[data-basket-state]')).toContainText('정리 제안 있음');
 await page.screenshot({path:info.outputPath(`basket3-suggested-${width}.png`),fullPage:true});
 await page.goto(testOrigin+'/app/?view=basket&note=a');await expect(page.locator('[data-basket-text]')).toHaveValue(' 보관 원문\n ');
 await page.goto(testOrigin+'/app/?view=basket&note=foreign');await expect(page.locator('[data-basket-list-status]')).toContainText('업데이트를 찾을 수 없어요');expect(f.writes).toHaveLength(0);
});
// UX-먼저묻고뒤에처리 3차 (2): [첨부 저장]한 파일은 그 업데이트 id로 뒤에서 올라간다. 예전에는 다 올라갈 때까지 상세의 모든 단추·입력과 뒤로가기를 잠갔다.
const toBasket=page=>page.locator('#homeView [data-home-quick] [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').first().click();
const fileOf=raw=>raw.match(/filename="([^"]+)"/)?.[1],noteOf=raw=>raw.match(/name="note_id"\r\n\r\n([^\r]+)/)?.[1];
for(const width of [412,1280]){
 test(`basket attachment goes up behind the screen: nothing is locked, the update closes, another opens, the file goes to its own update ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  const f=await fixture(page),u=await basketUploadFixture(page,f);let open;u.setPending(new Promise(r=>open=r));
  await toBasket(page);await page.locator('[data-basket-row="n"]').click();await noteAction(page,'[data-basket-edit]');
  await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['behind.txt']));await page.locator('[data-basket-upload]').click();
  await expect.poll(()=>u.calls.length).toBe(1);
  // 올리는 동안 잠기지 않는다: 고른 파일 줄은 비고, 클립·글 칸·[첨부 저장]을 쓸 수 있고, 올라가는 파일은 이 업데이트의 올리는 줄에 보인다.
  await expect(page.locator('[data-basket-file]')).toHaveCount(0);
  await expect(page.locator('#detailBasketFiles')).toBeEnabled();await expect(page.locator('[data-basket-text]')).toBeEnabled();await expect(page.locator('[data-basket-upload]')).toBeEnabled();
  await expect(page.locator('[data-basket-sent] .up-row')).toContainText('behind.txt');
  if(process.env.CAPTURE_DIR)await page.screenshot({path:`${process.env.CAPTURE_DIR}/basket-attach-${width}.png`});
  // 같은 업데이트를 바꾸는 일만 다 올라갈 때까지 기다리게 한다(서버가 올리는 사이 바뀐 글의 올리기를 거절하므로).
  await page.locator('[data-basket-text]').fill('올리는 중 수정');await page.locator('[data-basket-save]').click();
  await expect(page.locator('[data-basket-status]')).toContainText('첨부를 올리는 중이에요');expect(f.writes).toHaveLength(0);
  await page.locator('[data-basket-text]').fill(' 첫 줄\n\n둘째 줄  ');
  // 읽기 화면 → 목록 → 다른 업데이트. 예전에는 올리는 동안 닫기·뒤로가기를 받지 않았다.
  await page.locator('[data-basket-cancel]').click();await page.locator('[data-basket-close]').click();
  await page.locator('[data-basket-row="s"]').click();await expect(page.locator('[data-basket-read-text]')).toContainText('제안 원문');
  await expect(page.locator('#uploadDock')).toContainText('올리는 중');
  open();
  await expect(page.locator('#kptuNotice')).toContainText('업데이트에 behind.txt 올렸어요');
  expect(u.calls).toHaveLength(1);expect(noteOf(u.calls[0])).toBe('n');
  // 보고 있는 다른 업데이트는 그대로이고, 목록의 그 업데이트 줄에 첨부가 붙는다.
  await expect(page.locator('[data-basket-read-text]')).toContainText('제안 원문');await expect(page.locator('[data-basket-attachments] a')).toHaveCount(0);
  await expect(page.locator('[data-basket-row-item="n"]')).toContainText('첨부 1개');
  await page.locator('[data-basket-close]').click();await page.locator('[data-basket-row="n"]').click();await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1);
  expect(f.errors).toEqual([]);
 });
}
test('basket attachment that did not go up is told by the small notice, and [다시] sends only that file to the same update (412)',async({page})=>{
 await page.setViewportSize({width:412,height:1000});
 const f=await fixture(page),u=await basketUploadFixture(page,f);let open;u.setPending(new Promise(r=>open=r));u.setError({status:400,code:'bad_file',after:1});
 await toBasket(page);await page.locator('[data-basket-row="n"]').click();await noteAction(page,'[data-basket-edit]');
 await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['one.txt','two.txt']));await page.locator('[data-basket-upload]').click();
 await expect.poll(()=>u.calls.length).toBe(1);
 await page.locator('[data-basket-cancel]').click();await page.locator('[data-basket-close]').click();await expect(page.locator('[data-basket-row="s"]')).toBeVisible();
 open();
 const notice=page.locator('#kptuNotice');
 await expect(notice).toContainText('업데이트에 one.txt 올렸어요 · 1개 못 올렸어요');
 u.setError(null);await notice.getByRole('button',{name:'다시',exact:true}).click();
 await expect(notice).toContainText('업데이트에 two.txt 올렸어요');
 expect(u.calls.map(fileOf)).toEqual(['one.txt','two.txt','two.txt']);expect(u.calls.map(noteOf)).toEqual(['n','n','n']); // 올라간 파일은 다시 보내지 않는다
 await expect(page.locator('[data-basket-row-item="n"]')).toContainText('첨부 2개');
});
// 줄 선 묶음은 차례가 왔을 때의 첨부 목록에서 시작한다: 예전 코드는 고를 때의 목록으로 화면을 그려, 둘째가 올라가는 동안(실패하면 다시 읽을 때까지)
// 앞서 올라간 첨부가 사라졌다. 올리는 동안 큰 창 수정은 열지 않고(연 때의 판으로만 저장하므로 올리기가 끝나면 거절된다), 최신화는 예전 잠금 때처럼 막는다.
test('basket attachments in line keep what already went up on screen; the big editor and a refresh wait for the line (412)',async({page})=>{
 await page.setViewportSize({width:412,height:1000});
 const f=await fixture(page),u=await basketUploadFixture(page,f);let openFirst,openSecond;u.setPending(new Promise(r=>openFirst=r));
 const reloadAllowed=()=>page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:before-reload',{cancelable:true,detail:{projectDraft:false,otherDraft:false}})));
 await toBasket(page);await page.locator('[data-basket-row="n"]').click();await noteAction(page,'[data-basket-edit]');
 expect(await reloadAllowed()).toBe(true);
 await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['one.txt']));await page.locator('[data-basket-upload]').click();
 await expect.poll(()=>u.calls.length).toBe(1);
 expect(await reloadAllowed()).toBe(false); // 새로 고치면 줄에 선 파일이 알림 없이 사라진다
 await page.locator('[data-basket-big-write]').click();
 await expect(page.locator('[data-basket-status]')).toContainText('첨부를 올리는 중이에요');await expect(page.locator('#edWindow:not(.hidden)')).toHaveCount(0);
 await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['two.txt']));await expect(page.locator('[data-basket-file]')).toContainText('two.txt');
 await page.locator('[data-basket-upload]').click();await expect(page.locator('[data-basket-file]')).toHaveCount(0);
 // 첫 파일만 끝내고, 둘째는 붙잡아 둔 뒤 실패시킨다.
 u.setPending(new Promise(r=>openSecond=r));u.setError({status:400,code:'bad_file',after:1});openFirst();
 await expect.poll(()=>u.calls.length).toBe(2);
 await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1);
 await page.waitForTimeout(200);await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1); // 둘째가 올라가는 동안에도 첫 첨부는 그대로
 expect(await reloadAllowed()).toBe(false);
 openSecond();
 await expect(page.locator('#kptuNotice')).toContainText('첨부를 올리지 못했어요');
 await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1); // 둘째가 실패해도 첫 첨부는 남는다
 expect(u.calls.map(fileOf)).toEqual(['one.txt','two.txt']);expect(u.calls.map(noteOf)).toEqual(['n','n']);
 expect(await reloadAllowed()).toBe(true); // 줄이 끝났으면 막지 않는다(못 올린 파일은 알림 [다시])
});
// 올리는 중인 업데이트의 [노트로]는 줄 ⋯ 메뉴뿐 아니라 줄 단추(PC는 줄에 보임)로 눌러도 같은 잠금이다: 묻는 창을 띄우지 않고 까닭을 말한다.
test('basket row button [노트로] also waits while that update\'s attachment goes up (1280)',async({page})=>{
 await page.setViewportSize({width:1280,height:1000});
 const f=await fixture(page),u=await basketUploadFixture(page,f);let open;u.setPending(new Promise(r=>open=r));
 await toBasket(page);await page.locator('[data-basket-row="n"]').click();await noteAction(page,'[data-basket-edit]');
 await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['one.txt']));await page.locator('[data-basket-upload]').click();
 await expect.poll(()=>u.calls.length).toBe(1);
 await page.locator('[data-basket-cancel]').click();await page.locator('[data-basket-close]').click();
 // 줄 단추 [노트로]는 마우스가 있는 PC에서만 줄에 보인다(ui-standard.css: 좁은 창·마우스 없음이면 ⋯ 안). 이 시험 브라우저는 마우스 없음으로 잡히므로 그 단추의 누름을 직접 보낸다.
 await page.locator('[data-nbx-row="u:n"] [data-nbx-act="note"]').dispatchEvent('click');
 await expect(page.locator('[data-basket-list-status]')).toContainText('첨부를 올리는 중이에요');
 await expect(page.locator('.kptu-ask')).toHaveCount(0);await expect(page.locator('[data-basket-row="n"]')).toBeVisible();
 open();
 await expect(page.locator('[data-basket-row-item="n"]')).toContainText('첨부 1개');
 expect(f.writes).toHaveLength(0);expect(f.errors).toEqual([]);
});
test('basket attachments saved while the first goes up wait in the same line and reach the same update (412)',async({page})=>{
 await page.setViewportSize({width:412,height:1000});
 const f=await fixture(page),u=await basketUploadFixture(page,f);let open;u.setPending(new Promise(r=>open=r));
 await toBasket(page);await page.locator('[data-basket-row="n"]').click();await noteAction(page,'[data-basket-edit]');
 await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['one.txt']));await page.locator('[data-basket-upload]').click();
 await expect.poll(()=>u.calls.length).toBe(1);
 // 올리는 중에 더 고르고 [첨부 저장]: 거절하지 않고 받아 두고, 앞 파일이 끝난 뒤에 보낸다.
 await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['two.txt']));await expect(page.locator('[data-basket-file]')).toContainText('two.txt');
 await page.locator('[data-basket-upload]').click();await expect(page.locator('[data-basket-file]')).toHaveCount(0);
 await page.waitForTimeout(300);expect(u.calls).toHaveLength(1);
 open();
 await expect(page.locator('[data-basket-attachments] a')).toHaveCount(2);
 expect(u.calls.map(fileOf)).toEqual(['one.txt','two.txt']);expect(u.calls.map(noteOf)).toEqual(['n','n']);
 await expect(page.locator('#toast')).toContainText('첨부를 저장했습니다');
 expect(f.errors).toEqual([]);
});
