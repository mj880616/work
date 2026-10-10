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
 test(`basket save edit AI archive filters keyboard touch and console ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000});const f=await fixture(page),q=quick(page);
  await expect(q).toHaveAttribute('data-mode','basket');await expect(q.locator('[data-quick-ai-excluded]')).not.toBeChecked();
  const aiLabel=await q.locator('[data-quick-basket-options]').boundingBox();expect(aiLabel.height).toBeLessThanOrEqual(44);
  await page.screenshot({path:info.outputPath(`home-basket-${width}.png`),fullPage:true});
  const raw=' 할일 자동 보내기 금지\n\n메모  ';
  await q.locator('[data-quick-input]').fill(raw);await q.locator('[data-quick-ai-excluded]').check();await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');
  expect(f.writes[0]).toMatchObject({method:'POST',body:{workspace_id:'w',raw_text:raw,ai_export_allowed:false}});
  expect(f.requests.filter(r=>r.action==='create')).toHaveLength(0);
  await expect(q.locator('[data-quick-ai-excluded]')).not.toBeChecked();
  if(width<761){await page.locator('#mobileMenuOpen').click();await page.locator('#mobileMenu [data-view="basket"]').click();}else await page.locator('.app-nav [data-view="basket"]').click();
  await expect(page.locator('[data-basket-row]')).toHaveCount(2);await expect(page.locator('[data-basket-row]').first()).toContainText('AI 제외');
  await page.locator('[data-basket-filter="all"]').click();await expect(page.locator('[data-basket-row]')).toHaveCount(3);
  const confirmed=page.locator('[data-basket-row="c"]');await expect(confirmed).toContainText('확정');await expect(confirmed).toContainText('테스트 프로젝트');await expect(confirmed).toContainText('테스트 조직');await expect(confirmed).toContainText('연결 대상 없음');
  await page.locator('[data-basket-row="new"]').focus();await page.keyboard.press('Enter');await expect(page.locator('[data-basket-text]')).toHaveValue(raw);const editor=await page.locator('[data-basket-text]').boundingBox();expect(editor.width).toBeGreaterThanOrEqual(width===1280?600:300);
  const revised=' 수정한 원문\n\n마지막  ';await page.locator('[data-basket-text]').fill(revised);await page.locator('[data-basket-save]').click();await expect(page.locator('[data-basket-status]')).toContainText('저장');expect(f.writes.at(-1).body.raw_text).toBe(revised);expect(f.writes.at(-1).body.updated_at).toBeTruthy();
  await page.locator('[data-basket-ai-excluded]').uncheck();await expect(page.locator('[data-basket-status]')).toContainText('AI 포함');expect(f.notes[0].ai_export_allowed).toBe(true);
  await page.locator('[data-basket-ai-excluded]').check();await expect(page.locator('[data-basket-status]')).toContainText('AI 제외');
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
 test(`basket validation and RLS failures keep draft and toggle state ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});const f=await fixture(page),q=quick(page),input=q.locator('[data-quick-input]');
  for(const text of [' \n ','가'.repeat(20001)]){await input.fill(text);await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-status]')).not.toBeEmpty();}expect(f.writes).toHaveLength(0);
  f.setDenied(true);await input.fill(' 원문 유지\n ');await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-status]')).toContainText('RLS 거부');await expect(input).toHaveValue(' 원문 유지\n ');
  f.setDenied(false);await input.fill('가'.repeat(20000));await q.locator('[data-quick-save]').click();await expect(input).toHaveValue('');
  await page.evaluate(()=>window.KPTURouter.go('basket'));await page.locator('[data-basket-row="n"]').click();
  for(const text of [' \n ','가'.repeat(20001)]){const before=f.writes.length;await page.locator('[data-basket-text]').fill(text);await page.locator('[data-basket-save]').click();await expect(page.locator('[data-basket-status]')).not.toBeEmpty();expect(f.writes).toHaveLength(before);}
  await page.locator('[data-basket-text]').fill(' 편집 실패\n ');f.setDenied(true);await page.locator('[data-basket-save]').click();await expect(page.locator('[data-basket-status]')).toContainText('RLS 거부');await expect(page.locator('[data-basket-text]')).toHaveValue(' 편집 실패\n ');
  await page.locator('[data-basket-ai-excluded]').uncheck();await expect(page.locator('[data-basket-status]')).toContainText('RLS 거부');await expect(page.locator('[data-basket-ai-excluded]')).toBeChecked();
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
