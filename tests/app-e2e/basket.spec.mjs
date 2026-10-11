import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
test.use({hasTouch:true});
const quick=page=>page.locator('[data-home-quick]');
async function fixture(page){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const home=await openHome(page),writes=[];
 const notes=[{id:'a',raw_text:' 보관 원문\n ',occurred_at:'2026-10-06T03:00:00Z',archived_at:'2026-10-06',ai_export_allowed:true},{id:'c',raw_text:'확정 원문',occurred_at:'2026-10-06T02:00:00Z',ai_export_allowed:true},{id:'n',raw_text:' 첫 줄\n\n둘째 줄  ',occurred_at:'2026-10-06T01:00:00Z',updated_at:'2026-10-06T01:00:00Z',ai_export_allowed:false}];
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
  return r.fulfill({json:[{note_id:'c',status:'confirmed',project_id:'p',project:{name:'테스트 프로젝트'}},{note_id:'c',status:'confirmed',organization_id:'o',organization:{name:'테스트 조직'}},{note_id:'c',status:'confirmed',document_id:'d',document:null},{note_id:'n',status:'suggested',project_id:'p',project:{name:'제안 프로젝트'}}]});
 });
 return {...home,notes,writes,errors,setDenied:v=>denied=v,setEmpty:v=>empty=v,setLinksDenied:v=>linksDenied=v};
}
async function enter(page,width,count=1){if(width<761){await page.locator('#mobileMenuOpen').click();await page.locator('#mobileMenu [data-view="basket"]').click();}else await page.locator('.app-nav [data-view="basket"]').click();await expect(page.locator('#basketView')).toBeVisible();await expect(page.locator('[data-basket-row]')).toHaveCount(count);}
for(const width of [390,1280]){
 test(`basket save edit AI hidden archive filters keyboard touch and console ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});const f=await fixture(page),q=quick(page);
  await expect(q).toHaveAttribute('data-mode','basket');await expect(q.locator('[data-quick-ai-excluded]')).toHaveCount(0);
  await expect(q).not.toContainText('AI 제외');
  await page.screenshot({path:info.outputPath(`home-basket-${width}.png`),fullPage:true});
  const raw=' 할일 자동 보내기 금지\n\n메모  ';
  await q.locator('[data-quick-input]').fill(raw);await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');
  expect(f.writes[0]).toMatchObject({method:'POST',body:{workspace_id:'w',raw_text:raw}});
  expect(f.requests.filter(r=>r.action==='create')).toHaveLength(0);expect(f.writes[0].body).not.toHaveProperty('ai_export_allowed');
  await expect(q.locator('[data-quick-ai-excluded]')).toHaveCount(0);
  if(width<761){await page.locator('#mobileMenuOpen').click();await page.locator('#mobileMenu [data-view="basket"]').click();}else await page.locator('.app-nav [data-view="basket"]').click();
  await expect(page.locator('[data-basket-row]')).toHaveCount(2);await expect(page.locator('#basketView')).not.toContainText('AI 제외');
  await page.locator('[data-basket-filter="all"]').click();await expect(page.locator('[data-basket-row]')).toHaveCount(3);
  const confirmed=page.locator('[data-basket-row="c"]');await expect(confirmed).toContainText('확정');await expect(confirmed).toContainText('테스트 프로젝트');await expect(confirmed).toContainText('테스트 조직');await expect(confirmed).toContainText('연결 대상 없음');
  await page.locator('[data-basket-row="new"]').focus();await page.keyboard.press('Enter');await expect(page.locator('[data-basket-text]')).toHaveValue(raw);const editor=await page.locator('[data-basket-text]').boundingBox();expect(editor.width).toBeGreaterThanOrEqual(width===1280?600:300);
  const revised=' 수정한 원문\n\n마지막  ';await page.locator('[data-basket-text]').fill(revised);await page.locator('[data-basket-save]').click();await expect(page.locator('[data-basket-status]')).toContainText('저장');expect(f.writes.at(-1).body.raw_text).toBe(revised);expect(f.writes.at(-1).body.updated_at).toBeTruthy();
  await expect(page.locator('[data-basket-ai-excluded]')).toHaveCount(0);expect(f.writes.at(-1).body).not.toHaveProperty('ai_export_allowed');expect(f.notes.find(n=>n.id==='n').ai_export_allowed).toBe(false);
  await page.locator('[data-basket-archive]').click();await expect(page.locator('[data-basket-archive]')).toHaveText('보관 해제');expect(f.notes[0].archived_at).toBeTruthy();
  await page.locator('[data-basket-close]').click();await page.locator('[data-basket-filter="archived"]').click();await expect(page.locator('[data-basket-row]')).toHaveCount(2);await expect(page.locator('[data-basket-row="new"]')).toContainText('보관');
  await page.locator('[data-basket-row="new"]').click();await page.locator('[data-basket-archive]').click();await expect(page.locator('[data-basket-archive]')).toHaveText('보관');expect(f.notes[0].archived_at).toBeNull();await page.screenshot({path:info.outputPath(`basket-detail-${width}.png`),fullPage:true});await page.locator('[data-basket-close]').click();
  await page.locator('[data-basket-filter="all"]').click();await page.screenshot({path:info.outputPath(`basket-${width}.png`),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const b=await page.locator('[data-basket-row="new"]').boundingBox();expect(b.height).toBeGreaterThanOrEqual(44);
  if(width===390){await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);await expect(page.locator('[data-basket-text]')).toHaveValue(revised);await page.keyboard.press('Escape');await expect(page.locator('[data-basket-row="new"]')).toBeFocused();}
  expect(await page.locator('#basketView').getByRole('button',{name:'삭제',exact:true}).count()).toBe(0);
  await page.evaluate(()=>window.KPTURouter.go('home'));await enter(page,width,2);
  await expect(page.locator('[data-basket-filter="unclassified"]')).toHaveAttribute('aria-pressed','true');
  expect(f.errors).toEqual([]);expect(f.writes.every(w=>w.method!=='DELETE')).toBe(true);
 });
 test(`basket validation and RLS failures keep draft and AI hidden ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});const f=await fixture(page),q=quick(page),input=q.locator('[data-quick-input]');
  for(const text of [' \n ','가'.repeat(20001)]){await input.fill(text);await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-status]')).not.toBeEmpty();}expect(f.writes).toHaveLength(0);
  f.setDenied(true);await input.fill(' 원문 유지\n ');await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-status]')).toContainText('RLS 거부');await expect(input).toHaveValue(' 원문 유지\n ');
  f.setDenied(false);await input.fill('가'.repeat(20000));await q.locator('[data-quick-save]').click();await expect(input).toHaveValue('');
  await page.evaluate(()=>window.KPTURouter.go('basket'));await page.locator('[data-basket-row="n"]').click();
  for(const text of [' \n ','가'.repeat(20001)]){const before=f.writes.length;await page.locator('[data-basket-text]').fill(text);await page.locator('[data-basket-save]').click();await expect(page.locator('[data-basket-status]')).not.toBeEmpty();expect(f.writes).toHaveLength(before);}
  await page.locator('[data-basket-text]').fill(' 편집 실패\n ');f.setDenied(true);await page.locator('[data-basket-save]').click();await expect(page.locator('[data-basket-status]')).toContainText('RLS 거부');await expect(page.locator('[data-basket-text]')).toHaveValue(' 편집 실패\n ');
  await expect(page.locator('[data-basket-ai-excluded]')).toHaveCount(0);expect(f.notes.find(n=>n.id==='n').ai_export_allowed).toBe(false);expect(f.writes.every(w=>!Object.hasOwn(w.body,'ai_export_allowed'))).toBe(true);
  await page.locator('[data-basket-archive]').click();await expect(page.locator('[data-basket-status]')).toContainText('RLS 거부');await expect(page.locator('[data-basket-archive]')).toHaveText('보관');
  f.setDenied(false);f.setEmpty(true);await page.locator('[data-basket-save]').click();await expect(page.locator('[data-basket-status]')).toContainText('확인');await expect(page.locator('[data-basket-text]')).toHaveValue(' 편집 실패\n ');
 });
}
test('basket links failure shows error and retry rather than false unclassified list',async({page})=>{const f=await fixture(page);f.setLinksDenied(true);await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-list-status]')).toContainText('연결 조회 거부');await expect(page.locator('[data-basket-row]')).toHaveCount(0);f.setLinksDenied(false);await page.locator('[data-basket-retry]').click();await expect(page.locator('[data-basket-row]')).toHaveCount(1);});
test('basket raw text and drafts never enter permanent browser storage',async({page})=>{await fixture(page);await quick(page).locator('[data-quick-input]').fill('BASKET_PRIVATE_DRAFT');await quick(page).locator('[data-quick-save]').click();await expect(quick(page).locator('[data-quick-input]')).toHaveValue('');await quick(page).locator('[data-quick-input]').fill('BASKET_PRIVATE_UNSAVED');await page.evaluate(()=>window.KPTURouter.go('basket'));await page.locator('[data-basket-row="new"]').click();await page.locator('[data-basket-text]').fill('BASKET_PRIVATE_EDIT');const cdp=await page.context().newCDPSession(page);const stored=JSON.stringify(await Promise.all([true,false].map(isLocalStorage=>cdp.send('DOMStorage.getDOMStorageItems',{storageId:{securityOrigin:'http://127.0.0.1:8123',isLocalStorage}}))));expect(stored).not.toContain('BASKET_PRIVATE');});
test('basket direct URL and home return refresh new notes without saving view choice',async({page})=>{
 const f=await fixture(page);await page.goto('http://127.0.0.1:8123/app/?view=basket');await expect(page.locator('#basketView')).toBeVisible();await expect(page.locator('[data-basket-row]')).toHaveCount(1);
 await page.locator('[data-basket-filter="archived"]').click();await expect(page.locator('[data-basket-row="a"]')).toBeVisible();
 await page.reload();await expect(page.locator('[data-basket-filter="unclassified"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-basket-row="n"]')).toBeVisible();
 await page.locator('#basketView [data-goto="home"]').click();await quick(page).locator('[data-quick-input]').fill('새 글');await quick(page).locator('[data-quick-save]').click();await expect(quick(page).locator('[data-quick-input]')).toHaveValue('');
 await quick(page).locator('[data-goto="basket"]').click();await expect(page.locator('[data-basket-row]')).toHaveCount(2);expect(f.writes).toHaveLength(1);
});
test('basket save lock blocks duplicate home posts and detail patches, reload guard keeps pending edits',async({page})=>{
 const f=await fixture(page);let release;let pending=new Promise(r=>release=r);
 await page.route(SB+'/rest/v1/app_notes**',async r=>{if(r.request().method()==='GET')return r.fallback();await pending;return r.fallback();});
 const q=quick(page);await q.locator('[data-quick-input]').fill('잠긴 저장');await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toBeDisabled();await q.locator('[data-quick-save]').dispatchEvent('click');release();await expect(q.locator('[data-quick-input]')).toHaveValue('');expect(f.writes).toHaveLength(1);
 await q.locator('[data-goto="basket"]').click();await page.locator('[data-basket-row="new"]').click();await page.locator('[data-basket-text]').fill('수정 중 글');
 expect(await page.evaluate(()=>{const detail={otherDraft:false};window.dispatchEvent(new CustomEvent('kptu:before-reload',{cancelable:true,detail}));return detail.otherDraft;})).toBe(true);
 pending=new Promise(r=>release=r);await page.locator('[data-basket-save]').click();await expect(page.locator('[data-basket-text]')).toBeDisabled();await page.locator('[data-basket-save]').dispatchEvent('click');
 expect(await page.evaluate(()=>{const e=new CustomEvent('kptu:before-reload',{cancelable:true,detail:{}});window.dispatchEvent(e);return e.defaultPrevented;})).toBe(true);
 release();await expect(page.locator('[data-basket-status]')).toContainText('저장');expect(f.writes).toHaveLength(2);
});
test('session scope change clears basket content and prevents a delayed response from restoring it',async({page})=>{
 await fixture(page);let release;const pending=new Promise(r=>release=r);
 await page.route(SB+'/rest/v1/app_notes?**',async r=>{await pending;await r.fulfill({json:[{id:'stale',raw_text:'BASKET_STALE_PRIVATE',occurred_at:'2026-10-06'}]});});
 await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-list-status]')).toContainText('불러오는 중');
 await page.evaluate(()=>{const rt=window.KPTURuntime;const c=rt.context.read();rt.context.set({...c,user:{...c.user,id:'different'}});window.dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:rt.session.read()}}));});release();
 await expect(page.locator('[data-basket-row]')).toHaveCount(0);await expect(page.locator('#basketView')).not.toContainText('BASKET_STALE_PRIVATE');
});
test('unsaved detail survives canceled list/Escape dismissal and navigation until explicit discard',async({page})=>{
 await fixture(page);await quick(page).locator('[data-goto="basket"]').click();await page.locator('[data-basket-filter="all"]').click();await page.locator('[data-basket-row="n"]').click();const input=page.locator('[data-basket-text]');await input.fill('수정 중인 원문');
 page.once('dialog',d=>d.dismiss());await page.locator('[data-basket-close]').click();await expect(input).toHaveValue('수정 중인 원문');
 page.once('dialog',d=>d.dismiss());await input.press('Escape');await expect(input).toHaveValue('수정 중인 원문');
 await page.evaluate(()=>window.KPTURouter.go('home'));await quick(page).locator('[data-goto="basket"]').click();await expect(input).toHaveValue('수정 중인 원문');
 page.once('dialog',d=>d.accept());await page.locator('[data-basket-close]').click();await expect(page.locator('[data-basket-row="n"]')).toBeFocused();await expect(page.locator('[data-basket-filter="unclassified"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-basket-row]')).toHaveCount(1);await page.locator('[data-basket-row="n"]').click();await expect(input).toHaveValue(' 첫 줄\n\n둘째 줄  ');
});
test('explicit task and update modes still save directly when preference storage is blocked',async({page})=>{
 const f=await fixture(page),q=quick(page);await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('blocked');};});
 await q.locator('[data-quick-mode="task"]').click();await expect(q).toHaveAttribute('data-mode','task');await q.locator('[data-quick-input]').fill('할 일 직접 저장');await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');expect(f.requests.filter(r=>r.action==='create')).toHaveLength(1);expect(f.writes).toHaveLength(0);
 await q.locator('[data-quick-mode="update"]').click();await expect(q).toHaveAttribute('data-mode','update');await q.locator('[data-quick-input]').fill('조직 직접 저장');await q.locator('[data-quick-org]').click();await page.getByRole('dialog').getByRole('button',{name:'테스트 조직',exact:true}).first().click();const bodies=[];
 await page.route(SB+'/rest/v1/app_suborganization_updates',r=>{bodies.push(r.request().postDataJSON());return r.fulfill({json:[]});});await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');expect(bodies[0]).toEqual({organization_id:'o',raw_text:'조직 직접 저장',created_by:'home-test'});expect(f.writes).toHaveLength(0);
});
test('opening and saving unchanged CRLF text does not rewrite original or create a false dirty draft',async({page})=>{
 const f=await fixture(page);f.notes.find(n=>n.id==='n').raw_text=' first\r\n\r\nlast \r';await quick(page).locator('[data-goto="basket"]').click();await page.locator('[data-basket-row="n"]').click();await expect(page.locator('[data-basket-text]')).toHaveValue(' first\n\nlast \n');
 expect(await page.evaluate(()=>{const detail={otherDraft:false};window.dispatchEvent(new CustomEvent('kptu:before-reload',{cancelable:true,detail}));return detail.otherDraft;})).toBe(false);
 await page.locator('[data-basket-save]').click();await expect(page.locator('[data-basket-status]')).toContainText('저장');expect(f.writes).toHaveLength(0);expect(f.notes.find(n=>n.id==='n').raw_text).toBe(' first\r\n\r\nlast \r');
});
const uploadFiles = names => names.map(name=>({name,mimeType:'text/plain',buffer:Buffer.from('fixture file')}));
async function basketUploadFixture(page,f){
 const calls=[];let response=null,release=null;
 await page.route(SB+'/functions/v1/basket-files',async r=>{
  const raw=r.request().postDataBuffer().toString();calls.push(raw);
  if(release)await release;
  if(response)return r.fulfill({status:response.status,json:{error:'첨부를 저장하지 못했습니다.',code:response.code,note_id:'uploaded'}});
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
  let finish;u.setPending(new Promise(r=>finish=r));await q.locator('[data-quick-save]').click();await expect(q.locator('[data-basket-file]').first()).toContainText('업로드 중');await expect(q.locator('[data-basket-file]').nth(1)).toContainText('대기');await expect.poll(()=>u.calls.length).toBe(1);await q.locator('[data-quick-save]').dispatchEvent('click');
  finish();u.setPending(null);await expect(q.locator('.success')).toHaveCount(3);expect(u.calls).toHaveLength(3);expect(u.calls[0]).toContain('name="raw_text"');expect(u.calls[0]).not.toContain('name="note_id"');for(const raw of u.calls.slice(1)){expect(raw).toContain('name="note_id"\r\n\r\nuploaded');expect(raw).not.toContain('name="raw_text"');}expect(f.writes).toHaveLength(0);
  await q.locator('[data-quick-save]').click();expect(u.calls).toHaveLength(3);await expect(page.locator('#toast')).toHaveClass(/hidden/);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:info.outputPath(`basket-upload-home-${width}.png`),fullPage:true});
  await q.locator('[data-goto="basket"]').click();await expect(page.locator('[data-basket-row="uploaded"]')).toContainText('첨부 3개');await page.locator('[data-basket-row="uploaded"]').click();await expect(page.locator('[data-basket-attachments] a')).toHaveCount(3);await expect(page.locator('[data-basket-attachments] a').first()).toHaveAttribute('href','https://drive.google.com/file/d/file_1/view');
  const picker=page.locator('[data-basket-detail] .library-dropzone');await picker.focus();await expect(picker).toBeFocused();const chooser=page.waitForEvent('filechooser');await picker.press('Enter');await (await chooser).setFiles(uploadFiles(['four.txt']));
  const btn=page.locator('[data-basket-upload]');await btn.scrollIntoViewIfNeeded();const b=await btn.boundingBox();expect(b.height).toBeGreaterThanOrEqual(44);if(width===390)await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);else await btn.click();
  await expect(page.locator('[data-basket-attachments] a')).toHaveCount(4);expect(u.calls.at(-1)).toContain('name="note_id"\r\n\r\nuploaded');expect(u.calls.at(-1)).not.toContain('name="raw_text"');await expect(page.locator('#toast')).toHaveClass(/hidden/);await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:info.outputPath(`basket-upload-detail-${width}.png`),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(f.errors).toEqual([]);
 });
 test(`basket file only and copy failure no requests ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});const f=await fixture(page),u=await basketUploadFixture(page,f),q=quick(page);
  await q.locator('input[type=file]').setInputFiles(uploadFiles(['only.txt']));await q.locator('[data-quick-save]').click();await expect(q.locator('.success')).toHaveCount(1);expect(u.calls[0]).not.toContain('name="raw_text"');expect(f.writes).toHaveLength(0);
  await q.locator('[data-quick-new-note]').click();await q.locator('input[type=file]').setInputFiles(uploadFiles(['bad.txt','later.txt']));await page.evaluate(()=>{window.KPTURuntime.copyUploadFile=async()=>{throw Object.assign(Error('read'),{code:'file_read_failed'});};});await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-status]')).toContainText('파일을 읽지');expect(u.calls).toHaveLength(1);await expect(q.locator('[data-basket-file]').nth(1)).toContainText('대기');expect(f.errors).toEqual([]);
 });
 for(const [status,code,message] of [[503,'note_save_result_unknown','저장 결과를 확인하지 못했습니다. 바구니에서 확인 후 다시 시도하세요'],[409,'note_changed','메모를 다시 불러'],[401,'unauthorized','로그인'],[413,'file_too_large','100MiB']])test(`basket ${status} keeps completed files stops queue ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});const f=await fixture(page),u=await basketUploadFixture(page,f),q=quick(page);await q.locator('input[type=file]').setInputFiles(uploadFiles(['done.txt']));await q.locator('[data-quick-save]').click();await expect(q.locator('.success')).toHaveCount(1);
  u.setError({status,code});await q.locator('input[type=file]').setInputFiles(uploadFiles(['bad.txt','later.txt']));await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-status]')).toContainText(message);expect(u.calls).toHaveLength(2);await expect(q.locator('.success')).toHaveCount(1);await expect(q.locator('[data-basket-file]').last()).toContainText('대기');
  await q.locator('[data-quick-save]').dispatchEvent('click');if(status===503||status===409){expect(u.calls).toHaveLength(2);await expect(q.locator('input[type=file]')).toBeDisabled();}else {await expect.poll(()=>u.calls.length).toBe(3);}const expectedHTTP=`Failed to load resource: the server responded with a status of ${status} (${({503:'Service Unavailable',409:'Conflict',401:'Unauthorized',413:'Payload Too Large'})[status]})`;await expect.poll(()=>f.errors).toEqual(Array(status===503||status===409?1:2).fill(expectedHTTP));
 });
}
test('basket attachment preflight, invalid link and file-only unchanged edit',async({page})=>{
 const f=await fixture(page),u=await basketUploadFixture(page,f),q=quick(page);await q.locator('input[type=file]').setInputFiles(uploadFiles(Array.from({length:21},(_,i)=>i+'.txt')));await expect(q.locator('[data-quick-status]')).toContainText('20개');await expect(q.locator('[data-basket-file]')).toHaveCount(0);expect(u.calls).toHaveLength(0);
 await q.locator('input[type=file]').evaluate(el=>{const d=new DataTransfer();d.items.add(new File([new Uint8Array(104857601)],'large'));el.files=d.files;el.dispatchEvent(new Event('change'));});await expect(q.locator('[data-quick-status]')).toContainText('100MiB');expect(u.calls).toHaveLength(0);
 f.notes.find(n=>n.id==='n').raw_text='';f.notes.find(n=>n.id==='n').attachments=[{file_name:'invalid.txt',size_bytes:1024,drive_file_id:'bad/id'}];await q.locator('[data-goto="basket"]').click();await page.locator('[data-basket-row="n"]').click();await expect(page.locator('[data-basket-attachments]')).toContainText('invalid.txt');await expect(page.locator('[data-basket-attachments]')).toContainText('1.0 KiB');await expect(page.locator('[data-basket-attachments] a')).toHaveCount(0);await page.locator('[data-basket-save]').click();expect(f.writes).toHaveLength(0);
});
test('basket text+one file preserves raw text and first 503 blocks whole queue until explicit reset',async({page})=>{
 const f=await fixture(page),u=await basketUploadFixture(page,f),q=quick(page),raw=' 첫 파일 원문\n ';
 await q.locator('[data-quick-input]').fill(raw);await q.locator('input[type=file]').setInputFiles(uploadFiles(['one.txt']));await q.locator('[data-quick-save]').click();await expect(q.locator('.success')).toHaveCount(1);// Native multipart canonicalizes text newlines to CRLF; retain all spaces and lines.
 expect(f.notes.find(n=>n.id==='uploaded').raw_text).toBe(raw.replace(/\n/g,'\r\n'));expect(u.calls).toHaveLength(1);
 await q.locator('[data-quick-new-note]').click();u.setError({status:503,code:'note_save_result_unknown'});await q.locator('input[type=file]').setInputFiles(uploadFiles(['unknown.txt','later.txt']));await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-status]')).toContainText('바구니에서 확인 후 다시 시도하세요');await expect(q.locator('[data-basket-file]').last()).toContainText('대기');await q.locator('[data-quick-save]').click();expect(u.calls).toHaveLength(2);await expect(q.locator('input[type=file]')).toBeDisabled();
 page.once('dialog',d=>d.dismiss());await q.locator('[data-quick-new-note]').click();await expect(q.locator('[data-basket-file]')).toHaveCount(2);page.once('dialog',d=>d.accept());await q.locator('[data-quick-new-note]').click();await expect(q.locator('[data-basket-file]')).toHaveCount(0);expect(u.calls).toHaveLength(2);
});
test('basket detail 409 reload preserves existing AI setting and unsaved text until explicit confirmation',async({page})=>{
 const f=await fixture(page),u=await basketUploadFixture(page,f),q=quick(page);await q.locator('[data-goto="basket"]').click();await page.locator('[data-basket-row="n"]').click();await page.locator('[data-basket-text]').fill('미저장 수정');await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['one.txt']));await page.locator('[data-basket-upload]').click();await expect(page.locator('[data-basket-status]')).toContainText('첨부를 저장했습니다');await expect(page.locator('[data-basket-text]')).toHaveValue('미저장 수정');expect(f.notes.find(n=>n.id==='n').ai_export_allowed).toBe(false);
 u.setError({status:409,code:'note_changed'});await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['conflict.txt']));await page.locator('[data-basket-upload]').click();await expect(page.locator('[data-basket-status]')).toContainText('메모를 다시 불러');await page.locator('[data-basket-upload]').click();expect(u.calls).toHaveLength(2);
 f.notes.find(n=>n.id==='n').raw_text='외부에서 바뀐 원문';page.once('dialog',d=>d.dismiss());await page.locator('[data-basket-reload]').click();await expect(page.locator('[data-basket-text]')).toHaveValue('미저장 수정');page.once('dialog',d=>d.accept());await page.locator('[data-basket-reload]').click();await expect(page.locator('[data-basket-text]')).toHaveValue('외부에서 바뀐 원문');await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1);await expect(page.locator('[data-basket-file]')).toHaveCount(0);expect(u.calls).toHaveLength(2);expect(f.writes).toHaveLength(0);
});
test('basket scope change while reading a file drops draft and sends no stale upload',async({page})=>{
 const f=await fixture(page),u=await basketUploadFixture(page,f),q=quick(page);await q.locator('[data-quick-input]').fill('private draft');await q.locator('input[type=file]').setInputFiles(uploadFiles(['private.txt']));await page.evaluate(()=>{const rt=window.KPTURuntime,copy=rt.copyUploadFile;rt.copyUploadFile=f=>new Promise(resolve=>{window.releaseBasketCopy=()=>copy(f).then(resolve);});});await q.locator('[data-quick-save]').click();await expect(q.locator('[data-basket-file]')).toContainText('업로드 중');await page.evaluate(()=>{const rt=window.KPTURuntime;rt.context.set({...rt.context.read(),workspace:{id:'different'}});window.dispatchEvent(new CustomEvent('kptu:session-changed'));window.releaseBasketCopy();});await expect(q.locator('[data-quick-input]')).toHaveValue('');await expect(q.locator('[data-basket-file]')).toHaveCount(0);await expect(q.locator('[data-quick-save]')).toBeEnabled();expect(u.calls).toHaveLength(0);expect(f.errors).toEqual([]);
});
test('basket attachment save invalidates an earlier list read and keeps counts when reopened',async({page})=>{
 const f=await fixture(page),u=await basketUploadFixture(page,f),q=quick(page);await q.locator('[data-goto="basket"]').click();await page.locator('[data-basket-row="n"]').click();await page.locator('[data-basket-close]').click();
 let release;const pending=new Promise(r=>release=r),old=structuredClone(f.notes);
 await page.route(SB+'/rest/v1/app_notes?**',async r=>{await pending;return r.fulfill({json:old});});await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-list-status]')).toContainText('불러오는 중');
 await page.locator('[data-basket-row="n"]').click();await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['fresh.txt']));await page.locator('[data-basket-upload]').click();await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1);const linksDone=page.waitForResponse(r=>r.url().includes('app_record_links')&&r.url().includes('note_id'));release();await linksDone;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect(page.locator('[data-basket-row="n"]')).toContainText('첨부 1개');await page.locator('[data-basket-close]').click();await page.locator('[data-basket-row="n"]').click();await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1);expect(u.calls).toHaveLength(1);expect(f.errors).toEqual([]);
});
test('basket opening detail invalidates older reads that finish before attachment save',async({page})=>{
 const f=await fixture(page),u=await basketUploadFixture(page,f),q=quick(page);await q.locator('[data-goto="basket"]').click();await page.locator('[data-basket-row="n"]').click();await page.locator('[data-basket-close]').click();
 let release;const pending=new Promise(r=>release=r),old=structuredClone(f.notes);
 await page.route(SB+'/rest/v1/app_notes?**',async r=>{await pending;return r.fulfill({json:old});});await page.evaluate(()=>window.KPTURouter.go('basket'));await expect(page.locator('[data-basket-list-status]')).toContainText('불러오는 중');await page.locator('[data-basket-row="n"]').click();
 const linksDone=page.waitForResponse(r=>r.url().includes('app_record_links')&&r.url().includes('note_id'));release();await linksDone;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.locator('#detailBasketFiles').setInputFiles(uploadFiles(['fresh.txt']));await page.locator('[data-basket-upload]').click();await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1);await expect(page.locator('[data-basket-row="n"]')).toContainText('첨부 1개');await page.locator('[data-basket-close]').click();await page.locator('[data-basket-row="n"]').click();await expect(page.locator('[data-basket-attachments] a')).toHaveCount(1);expect(u.calls).toHaveLength(1);expect(f.errors).toEqual([]);
});
