import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
import { loginEntry } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { appOrigin } from './helpers/test-origin.mjs';

// UI-우클릭메뉴 (2026-10-22 사용자 확정): on a PC (761px~) a right-click on a card or record opens that card's own ⋯ menu at the
// pointer (context-menu.js; same items, same handlers). The browser's own menu stays inside inputs, with a text selection, and on
// a card without a ⋯. A phone-width window (390) is unchanged. Esc / outside press close it, and it stays inside the window.
// Card types checked at 1280: basket update row, Google task card, project detail (<details> ⋯) and a project progress record.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const APP_ORIGIN = appOrigin;
const NOW = '2026-09-28T03:00:00.000Z';

const pstamp='2026-09-15T01:00:00Z';
const pnote={id:'10000000-0000-4000-8000-0000000000aa',workspace_id:'w',kind:'basket',occurred_at:pstamp,updated_at:pstamp,raw_text:'합성 바구니 원문',ai_export_allowed:true,archived_at:null,attachments:[]};
const pspaces=[
 {id:'pa',workspace_id:'w',owner_id:'home-test',name:'합성 정책 사업',status:'active',sort_order:10,metadata:{project_system:'v2',color:'green'}},
 {id:'pc',workspace_id:'w',owner_id:'home-test',name:'합성 하위 토론회',parent_id:'pa',status:'active',sort_order:20,metadata:{project_system:'v2'}},
 {id:'pb',workspace_id:'w',owner_id:'home-test',name:'합성 조직 사업',status:'active',sort_order:30,metadata:{project_system:'v2',color:'blue'}}
];
const day=i=>`2026-09-${String(30-i).padStart(2,'0')}`;
async function projectFixture(page,{width=1280,blockStorage=false}={}){
 await page.setViewportSize({width,height:800});
 if(blockStorage)await page.addInitScript(()=>{const deny=()=>{throw new DOMException('blocked','SecurityError')};const s=Storage.prototype,get=s.getItem,set=s.setItem;s.getItem=function(k){return String(k).includes('project-last')?deny():get.call(this,k)};s.setItem=function(k,v){return String(k).includes('project-last')?deny():set.call(this,k,v)}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const f=await openHome(page);
 const state={spaces:structuredClone(pspaces),patches:[],progress:Array.from({length:28},(_,i)=>({id:'pr-'+i,project_id:'pa',workstream_id:null,summary:'합성 기록 '+i,effective_on:day(i),created_at:day(i)+'T00:00:00Z'})),
  links:[{id:'l-p',workspace_id:'w',note_id:pnote.id,project_id:'pa',organization_id:null,status:'confirmed',summary:'합성 연결 요약'},{id:'l-o',workspace_id:'w',note_id:pnote.id,project_id:null,organization_id:'o',status:'confirmed',summary:'합성 조직 연결 요약'}]};
 const list=(route,rows)=>{const q=new URL(route.request().url()).searchParams;return route.fulfill({json:rows.slice(Number(q.get('offset')||0),Number(q.get('offset')||0)+Number(q.get('limit')||rows.length||1))})};
 await page.route(SB+'/rest/v1/app_spaces?**',route=>{
  const req=route.request(),q=new URL(req.url()).searchParams;
  if(req.method()==='PATCH'){const id=q.get('id').slice(3),row=state.spaces.find(x=>x.id===id),body=req.postDataJSON();state.patches.push({id,body});Object.assign(row,body);return route.fulfill({json:[row]})}
  if(q.get('select')?.includes('milestones:'))return route.fulfill({json:state.spaces.map(x=>({id:x.id,milestones:[]}))});
  return route.fulfill({json:state.spaces});
 });
 await page.route(SB+'/rest/v1/app_project_progress_updates?**',route=>{const pid=new URL(route.request().url()).searchParams.get('project_id')?.slice(3);return list(route,state.progress.filter(x=>x.project_id===pid))});
 await page.route(SB+'/rest/v1/app_notes?**',route=>list(route,[pnote]));
 await page.route(SB+'/rest/v1/app_record_links?**',route=>{
  const q=new URL(route.request().url()).searchParams;if(q.has('google_task_id'))return route.fulfill({json:[]});
  let rows=state.links;for(const key of ['project_id','organization_id']){const v=q.get(key);if(v?.startsWith('in.('))rows=rows.filter(x=>v.slice(4,-1).split(',').includes(x[key]));}
  const v=q.get('note_id');if(v?.startsWith('eq.'))rows=rows.filter(x=>x.note_id===v.slice(3));
  return list(route,rows.map(row=>({...row,note:pnote,organization:{name:'테스트 조직'},project:{name:'합성 정책 사업'}})));
 });
 return {f,state,errors};
}
const stamp = '2026-10-06T01:00:00Z';
const A = '10000000-0000-4000-8000-0000000000a1', B = '10000000-0000-4000-8000-0000000000b2', C = '10000000-0000-4000-8000-0000000000c3';
async function basketFixture(page, width, {archived = null} = {}) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], writes = [], posts = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await openHome(page);
  const base = { workspace_id: 'w', kind: 'basket', title: null, created_at: stamp, updated_at: stamp, archived_at: null, ai_export_allowed: true, metadata: {} };
  const rows = [
    { ...base, id: A, raw_text: '합성 교섭 결과 공유\n다음 회의 10/27', occurred_at: '2026-10-06T03:00:00Z', attachments: [{ drive_file_id: 'f1', file_name: '합성.txt', mime_type: 'text/plain', size_bytes: 10 }] },
    { ...base, id: B, raw_text: '합성 둘째 업데이트', occurred_at: '2026-10-06T02:00:00Z', attachments: [], archived_at: archived },
    { ...base, id: C, raw_text: '', occurred_at: '2026-10-06T01:00:00Z', attachments: [{ drive_file_id: 'f2', file_name: '첨부만.pdf', mime_type: 'application/pdf', size_bytes: 10 }] },
  ];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = row => (!q.get('kind') || 'eq.' + row.kind === q.get('kind')) && (!q.get('id') || 'eq.' + row.id === q.get('id'));
    if (req.method() === 'GET') { if (q.get('metadata')) return r.fulfill({ json: [] }); return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)) }); }
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push({ query: Object.fromEntries(q), body }); const hit = rows.filter(pick); hit.forEach(row => Object.assign(row, body)); return r.fulfill({ json: hit }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') || q.has('google_task_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  for (const t of ['app_documents', 'app_suborganizations', 'app_suborganization_assignees', 'app_spaces']) await page.route(SB + '/rest/v1/' + t + '?**', r => r.fulfill({ json: [] }));
  await page.route(u => u.href === SB + '/functions/v1/basket-files?action=note-delete', r => {
    const body = JSON.parse(r.request().postData()); posts.push(body);
    const i = rows.findIndex(row => row.id === body.note_id), total = i < 0 ? 0 : rows[i].attachments.length; if (i >= 0) rows.splice(i, 1);
    return r.fulfill({ json: { action: 'note-delete', note_id: body.note_id, attachments_total: total, trashed: total, failed: 0, unknown: 0, ok: true, note_deleted: i >= 0 } });
  });
  await page.evaluate(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => window.__copied.push(t), write: async () => {} } }); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await expect(page.locator(`[data-basket-row="${A}"]`)).toBeVisible();
  return { rows, writes, posts, errors };
}
const task=(id,extra={})=>({id,title:id,taskListId:'l1',taskListTitle:'QA',due:'2026-09-28T00:00:00.000Z',status:'needsAction',completed:null,source:'google-task',...extra});
const ok=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
const row=(page,id)=>page.locator(`#gtTaskBody [data-google-task="${id}"]`);

async function deleteTask(page,id){await row(page,id).locator('[data-gt-menu]').click();await page.locator('#gtTaskMenu [data-gt-menu-action="delete"]').click();}

async function openTasks(browser,{width=1280,onDelete,onOverview,onToggle,filesGate,reducedMotion='no-preference'}={}){
  // UI-PC할일: 묶음 목록 시험은 목록이 그대로인 중간 폭(900px)에서 본다(1024px 이상은 기한별 열, tasks-pc-columns.spec.mjs).
  const context=await browser.newContext({timezoneId:'Asia/Seoul',reducedMotion,viewport:{width,height:800}});
  const page=await context.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  const google={a:task('a'),b:task('b'),c:task('c',{status:'completed',completed:NOW})};
  const calls={deletes:[],overviews:0};
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname,action=u.searchParams.get('action');
    if(p==='/auth/v1/token')return ok(route,{access_token:'qa',refresh_token:'qa',expires_in:3600,expires_at:4102444800,user:{id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}}});
    if(p==='/auth/v1/user')return ok(route,{id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}});
    if(p==='/rest/v1/app_workspace_members')return ok(route,[{workspace_id:'qa-ws',user_id:'qa-user',role:'owner'}]);
    if(p==='/rest/v1/app_workspaces')return ok(route,[{id:'qa-ws',name:'QA Workspace'}]);
    if(p==='/rest/v1/app_profiles')return ok(route,[{user_id:'qa-user',display_name:'QA'}]);
    if(p==='/functions/v1/google-calendar')return ok(route,{connected:false,enabled:false,calendars:[],events:[]});
    if(p==='/functions/v1/google-tasks'&&action==='overview'){
      calls.overviews++;
      const snapshot=Object.values(google).map(t=>({...t}));
      return onOverview?onOverview(route,snapshot,calls.overviews):ok(route,{connected:true,authorized:true,tasks:snapshot});
    }
    if(p==='/functions/v1/google-tasks'&&action==='delete'){
      const body=JSON.parse(req.postData()||'{}');calls.deletes.push(body);
      if(onDelete)return onDelete(route,body,google);
      delete google[body.task_id];return ok(route,{ok:true});
    }
    if(p==='/functions/v1/google-tasks'&&action==='toggle'){
      const body=JSON.parse(req.postData()||'{}');
      if(onToggle)return onToggle(route,body,google);
      google[body.task_id]={...google[body.task_id],status:body.completed?'completed':'needsAction',completed:body.completed?NOW:null};
      return ok(route,{ok:true,task:google[body.task_id]});
    }
    if(p==='/rest/v1/app_task_attachments'&&filesGate){await filesGate;return ok(route,[])}
    if(p.startsWith('/rest/v1/')||p.startsWith('/functions/v1/'))return ok(route,[]);
    return ok(route,{});
  });
  await page.goto(loginEntry(`${APP_ORIGIN}/app/`));
  await signInWithSession(page,'qa@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:10000});
  await expect.poll(()=>page.evaluate(()=>typeof window.KPTURouter?.go==='function'),{timeout:10000}).toBeTruthy();
  await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await expect(row(page,'a')).toBeVisible({timeout:10000});
  return {context,page,google,calls};
}


// Records, in order, whether each contextmenu event reached the window still un-prevented (true = the browser's menu stays).
const watch = page => page.evaluate(() => { window.__ctxKept = []; window.addEventListener('contextmenu', e => window.__ctxKept.push(!e.defaultPrevented)); });
const kept = page => page.evaluate(() => window.__ctxKept);
const box = async l => (await l.boundingBox());
async function rightClickAt(page, locator, fx = 0.5, fy = 0.5) {
  const b = await box(locator), x = Math.round(b.x + b.width * fx), y = Math.round(b.y + b.height * fy);
  await page.mouse.move(x, y); await page.mouse.click(x, y, { button: 'right' });
  return { x, y };
}
// The menu opens at the pointer: left edge within 12px of x, and its top (below) or bottom (flipped above) within 12px of y.
async function expectAtPointer(page, menu, { x, y }) {
  await expect(menu).toBeVisible();
  const b = await box(menu), vw = page.viewportSize().width, vh = page.viewportSize().height;
  expect(Math.abs(b.x - x), `left ${b.x} vs ${x}`).toBeLessThanOrEqual(12);
  expect(Math.min(Math.abs(b.y - y), Math.abs(b.y + b.height - y)), `top ${b.y} h ${b.height} vs ${y}`).toBeLessThanOrEqual(12);
  expect(b.x).toBeGreaterThanOrEqual(0); expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(vw); expect(b.y + b.height).toBeLessThanOrEqual(vh);
}
const labels = menu => menu.locator('button').allTextContents().then(a => a.map(s => s.trim()));
const selectAll = (page, locator) => locator.evaluate(el => { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });

// ---- basket update row (button ⋯, #basketRowMenu) ----
test('1280 update row: right-click opens its ⋯ menu at the pointer with the same items; Esc and outside press close it', async ({ page }) => {
  const f = await basketFixture(page, 1280); await watch(page);
  const row = page.locator(`[data-basket-row="${A}"]`), more = page.locator(`[data-basket-row-more="${A}"]`), menu = page.locator('#basketRowMenu');
  await more.click(); await expect(menu).toBeVisible(); const viaButton = await labels(menu), base = await box(menu); await page.keyboard.press('Escape'); await expect(menu).toBeHidden();
  const at = await rightClickAt(page, row, 0.3, 0.5);
  await expectAtPointer(page, menu, at);
  expect(await labels(menu)).toEqual(viaButton);
  expect(await kept(page)).toEqual([false]);
  await expect(page.locator(`[data-basket-row="${A}"]`)).toBeVisible(); // the row did not open its detail
  await page.keyboard.press('Escape'); await expect(menu).toBeHidden(); await expect(more).toBeFocused();
  // Another row, then an outside press; the ⋯ button itself still opens under itself afterwards.
  const at2 = await rightClickAt(page, page.locator(`[data-basket-row="${B}"]`), 0.6, 0.4); await expectAtPointer(page, menu, at2);
  await page.mouse.click(5, 5); await expect(menu).toBeHidden();
  await more.click(); await expect(menu).toBeVisible();
  const mb = await box(menu); expect([mb.x, mb.y]).toEqual([base.x, base.y]); // back under the ⋯ exactly as before
  expect(await more.evaluate(el => Object.hasOwn(el, 'getBoundingClientRect'))).toBe(false); await page.keyboard.press('Escape');
  expect(f.errors).toEqual([]);
});
test('1280 update row: browser menu stays with a text selection, outside any card, and keeps the menu closed', async ({ page }) => {
  await basketFixture(page, 1280); await watch(page);
  const row = page.locator(`[data-basket-row="${A}"]`), menu = page.locator('#basketRowMenu');
  await selectAll(page, row); await rightClickAt(page, row, 0.3, 0.5); await expect(menu).toBeHidden();
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.mouse.click(1270, 890, { button: 'right' }); await expect(menu).toBeHidden();
  expect(await kept(page)).toEqual([true, true]);
});
test('1280 update row: right-click on a link inside the card keeps the browser menu (no ⋯ menu); beside the link the ⋯ menu still opens', async ({ page }) => {
  await basketFixture(page, 1280); await watch(page);
  const row = page.locator(`[data-basket-row="${A}"]`), menu = page.locator('#basketRowMenu');
  await row.evaluate(el => { const a = document.createElement('a'); a.href = 'https://example.org/x'; a.id = 'ctxLink'; a.textContent = '합성 링크'; a.style.cssText = 'display:inline-block;padding:4px 8px'; el.appendChild(a); });
  const link = page.locator('#ctxLink');
  await link.click({ button: 'right' }); await expect(menu).toBeHidden();
  expect(await kept(page)).toEqual([true]);
  const at = await rightClickAt(page, row, 0.3, 0.5); await expectAtPointer(page, menu, at);
});
test('1280 project detail: a record line that is itself a link (next to its ⋯) still opens the ⋯ menu', async ({ page }) => {
  await projectFixture(page); await clickView(page, 'projects'); await expect(page.locator('#ps3Title')).toHaveText('합성 정책 사업');
  const rec = page.locator('#ps3Body [data-basket-link="l-p"]'), menu = page.locator('#ps3RecordMenu');
  await expect(rec.locator('a[href]')).toHaveCount(1);
  await rec.locator('[data-ps3-record-menu]').click(); await expect(menu).toBeVisible(); await page.keyboard.press('Escape'); await expect(menu).toBeHidden();
  const at = await rightClickAt(page, rec.locator('a[href]'), 0.5, 0.5); await expectAtPointer(page, menu, at);
});
test('1280 update row: the menu stays inside a short window (bottom edge)', async ({ page }) => {
  await basketFixture(page, 1280); await watch(page);
  await page.setViewportSize({ width: 1280, height: 420 });
  const row = page.locator(`[data-basket-row="${C}"]`); await row.scrollIntoViewIfNeeded();
  const at = await rightClickAt(page, row, 0.9, 0.8); await expect(page.locator('#basketRowMenu')).toBeVisible();
  const b = await box(page.locator('#basketRowMenu')); expect(b.y).toBeGreaterThanOrEqual(0); expect(b.y + b.height).toBeLessThanOrEqual(420); expect(b.x + b.width).toBeLessThanOrEqual(1280);
  void at;
});
test('390 update row: right-click changes nothing (browser menu, no ⋯ menu)', async ({ page }) => {
  await basketFixture(page, 390); await watch(page);
  await rightClickAt(page, page.locator(`[data-basket-row="${A}"]`), 0.3, 0.5);
  await expect(page.locator('#basketRowMenu')).toBeHidden(); expect(await kept(page)).toEqual([true]);
});

// ---- Google task card (#gtTaskMenu) ----
test('1280 task card: right-click opens the task ⋯ menu at the pointer with the same items; browser menu with a selection', async ({ browser }) => {
  const { context, page } = await openTasks(browser, { width: 1280 }); await watch(page);
  const card = row(page, 'a'), menu = page.locator('#gtTaskMenu');
  await card.locator('[data-gt-menu]').click(); await expect(menu).toBeVisible(); const viaButton = await labels(menu); await page.keyboard.press('Escape'); await expect(menu).toBeHidden();
  const at = await rightClickAt(page, card, 0.4, 0.5);
  await expectAtPointer(page, menu, at); expect(await labels(menu)).toEqual(viaButton);
  await page.mouse.click(5, 5); await expect(menu).toBeHidden();
  await selectAll(page, card); await rightClickAt(page, card, 0.4, 0.5); await expect(menu).toBeHidden();
  expect(await kept(page)).toEqual([false, true]);
  await context.close();
});
test('390 task card: right-click changes nothing', async ({ browser }) => {
  const { context, page } = await openTasks(browser, { width: 390 }); await watch(page);
  await page.evaluate(() => document.querySelectorAll('#gtTaskBody details').forEach(d => { d.open = true; }));
  await rightClickAt(page, page.locator('#gtTaskBody [data-google-task="a"]:visible').first(), 0.4, 0.5); await expect(page.locator('#gtTaskMenu')).toBeHidden(); expect(await kept(page)).toEqual([true]);
  await context.close();
});
// TEST-우클릭시험안정화: one list load renders again when the attachment answer arrives (and for source notes and link names). When
// the markup is unchanged the rows on screen stay the same elements, so a right-click aimed at a row never lands on a row that was
// just replaced (the 390 test above failed 4 in 6 runs that way). The held answer makes the late render happen after the check.
test('390 task card: a later render with the same markup keeps the rows on screen (no replaced copies)', async ({ browser }) => {
  let release; const filesGate = new Promise(r => { release = r; });
  const { context, page } = await openTasks(browser, { width: 390, filesGate });
  // Every replacement of the list's children is counted; the held answer is the only render still to come.
  await page.evaluate(() => { window.__gtRow = document.querySelector('#gtTaskBody [data-google-task="a"]'); window.__gtSwaps = 0; new MutationObserver(ms => { window.__gtSwaps += ms.filter(m => m.type === 'childList').length; }).observe(document.querySelector('#gtTaskBody'), { childList: true }); document.querySelector('#gtCompleted').open = true; });
  const answered = page.waitForResponse(r => new URL(r.url()).pathname === '/rest/v1/app_task_attachments');
  release(); await answered;
  // The render that follows the answer runs in the same task chain; one frame later it has run.
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))));
  expect(await page.evaluate(() => ({ same: document.querySelector('#gtTaskBody [data-google-task="a"]') === window.__gtRow, swaps: window.__gtSwaps }))).toEqual({ same: true, swaps: 0 });
  await expect(page.locator('#gtCompleted')).toHaveAttribute('open', '');
  // A real change still paints: completing "a" moves it to the completed fold as a new row.
  await row(page, 'a').locator('[data-gt-toggle]').click();
  await expect.poll(() => page.evaluate(() => document.querySelector('#gtTaskBody [data-google-task="a"]') !== window.__gtRow)).toBe(true);
  await context.close();
});

// ---- project detail: <details> ⋯ and a progress record's ⋯ ----
test('1280 project detail: right-click on the detail head opens the ⋯ panel at the pointer; Esc and outside press close it', async ({ page }) => {
  const { errors } = await projectFixture(page); await watch(page);
  await clickView(page, 'projects'); await expect(page.locator('#ps3Title')).toHaveText('합성 정책 사업');
  const head = page.locator('#ps3Title'), more = page.locator('#ps3Menu details.ps3-more'), panel = more.locator('.ps3-more-panel');
  const at = await rightClickAt(page, head, 0.2, 0.5);
  await expect(more).toHaveAttribute('open', ''); await expect(panel).toBeVisible();
  expect(await labels(panel)).toEqual(['완료', '수정', '보관', '삭제']);
  const b = await box(panel); expect(Math.abs(b.x - at.x)).toBeLessThanOrEqual(12); expect(b.x + b.width).toBeLessThanOrEqual(1280); expect(b.y + b.height).toBeLessThanOrEqual(800);
  expect(Math.min(Math.abs(b.y - at.y), Math.abs(b.y + b.height - at.y))).toBeLessThanOrEqual(12);
  expect(await kept(page)).toEqual([false]);
  await page.keyboard.press('Escape'); await expect(more).not.toHaveAttribute('open', ''); await expect(more.locator('summary')).toBeFocused();
  await rightClickAt(page, head, 0.2, 0.5); await expect(more).toHaveAttribute('open', '');
  await page.mouse.click(5, 790); await expect(more).not.toHaveAttribute('open', '');
  // The panel's own items work as from the ⋯ (수정 opens the edit window).
  await rightClickAt(page, head, 0.2, 0.5); await panel.locator('[data-ps3-edit-project]').click(); await expect(page.locator('#ps3CreateModal')).toBeVisible();
  expect(errors).toEqual([]);
});
test('1280 project detail: a record line opens the record ⋯ menu; browser menu stays inside the record input', async ({ page }) => {
  await projectFixture(page); await watch(page);
  await clickView(page, 'projects'); await expect(page.locator('#ps3Title')).toHaveText('합성 정책 사업');
  const rec = page.locator('#ps3Body [data-basket-link="l-p"]'), menu = page.locator('#ps3RecordMenu');
  await rec.locator('[data-ps3-record-menu]').click(); await expect(menu).toBeVisible(); const viaButton = await labels(menu); await page.keyboard.press('Escape'); await expect(menu).toBeHidden();
  const at = await rightClickAt(page, rec, 0.5, 0.5); await expectAtPointer(page, menu, at); expect(await labels(menu)).toEqual(viaButton);
  await page.keyboard.press('Escape'); await expect(menu).toBeHidden();
  const input = page.locator('#ps3Body [data-ps3-record-input] textarea, #ps3Body textarea, #ps3Body input[type="text"]').first();
  await expect(input).toBeAttached(); await input.scrollIntoViewIfNeeded(); await rightClickAt(page, input, 0.5, 0.5); await expect(menu).toBeHidden(); expect(await kept(page)).toEqual([false, true]);
});
test('390 project detail: right-click changes nothing', async ({ page }) => {
  await projectFixture(page, { width: 390 }); await watch(page);
  await clickView(page, 'projects');
  const first = page.locator('#projectGrid [data-ps3-project="pa"]').first(); await first.click();
  await expect(page.locator('#ps3Title')).toHaveText('합성 정책 사업');
  await rightClickAt(page, page.locator('#ps3Title'), 0.2, 0.5);
  await expect(page.locator('#ps3Menu details.ps3-more')).not.toHaveAttribute('open', ''); expect(await kept(page)).toEqual([true]);
});
