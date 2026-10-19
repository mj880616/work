import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { noteAction,showBasketRow} from './helpers/basket-more.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// MEMO-노트 PR 3: [메모 | 노트] in the basket tab. The mock keeps one app_notes store and honours the kind/id
// filters, so every list and write is checked against the row kind the screen showed.
function store(){
 return [
  {id:'m1',workspace_id:'w',kind:'basket',title:null,raw_text:'회의 준비 메모 첫 줄\n둘째 줄 내용',occurred_at:'2026-10-17T01:00:00Z',created_at:'2026-10-17T01:00:00Z',updated_at:'2026-10-17T01:00:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}},
  {id:'n-old',workspace_id:'w',kind:'note',title:'오래된 노트',raw_text:'옛 본문',occurred_at:'2026-10-01T01:00:00Z',created_at:'2026-10-01T01:00:00Z',updated_at:'2026-10-02T01:00:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}},
  {id:'n-new',workspace_id:'w',kind:'note',title:'임금협상 정리',raw_text:'## 쟁점\n\n- **기본급** 인상\n- 수당 정비',occurred_at:'2026-10-05T01:00:00Z',created_at:'2026-10-05T01:00:00Z',updated_at:'2026-10-16T01:00:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}},
 ];
}
async function fixture(page){
 const rows=store(),writes=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await openHome(page);
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams;
  const pick=row=>(!q.get('kind')||'eq.'+row.kind===q.get('kind'))&&(!q.get('id')||'eq.'+row.id===q.get('id'))&&(!q.get('workspace_id')||'eq.'+row.workspace_id===q.get('workspace_id'));
  if(req.method()==='GET'){if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:rows.filter(pick).slice(Number(q.get('offset')||0))});}
  if(req.method()==='PATCH'){
   const body=req.postDataJSON();writes.push({query:Object.fromEntries(q),body});
   const hit=rows.filter(pick);
   for(const row of hit){
    const next={...row,...body};
    if(next.kind==='basket'&&(next.title!==null||!next.raw_text&&!next.attachments.length))return r.fulfill({status:400,json:{code:'23514'}});
    if(next.kind==='note'&&!String(next.title||'').trim())return r.fulfill({status:400,json:{code:'23514'}});
    Object.assign(row,next);
   }
   return r.fulfill({json:hit});
  }
  if(req.method()==='POST'){
   const body=req.postDataJSON();writes.push({method:'POST',body});
   const at='2026-10-17T05:00:00Z',row={id:body.kind==='note'?'n-created':'m-created',kind:'basket',title:null,occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},...body};
   if(row.kind==='note'?!String(row.title||'').trim():row.title!==null||!row.raw_text)return r.fulfill({status:400,json:{code:'23514'}});
   rows.push(row);return r.fulfill({status:201,json:[row]});
  }
  return r.fulfill({status:500,json:{}});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',r=>{
  const q=new URL(r.request().url()).searchParams;if(!q.has('note_id'))return r.fallback();
  const ids=(q.get('note_id').match(/^in\.\((.*)\)$/)?.[1]||'').split(',');
  return r.fulfill({json:ids.includes('n-new')?[{note_id:'n-new',status:'confirmed',project_id:'p1',organization_id:null,meeting_id:null,document_id:null,project:{name:'합성 임금 프로젝트'}}]:[]});
 });
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await expect(page.locator('[data-basket-row="m1"]')).toBeVisible();
 return {rows,writes,errors};
}
const noteList=page=>page.locator('[data-note-host] [data-note-row]');

for(const width of [390,1280]){
 test(`[메모 | 노트] switch lists notes by last change with search, dot and link chip ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  const memo=page.locator('[data-basket-kind="memo"]'),note=page.locator('[data-basket-kind="note"]');
  await expect(memo).toHaveAttribute('aria-pressed','true');await expect(note).toHaveAttribute('aria-pressed','false');
  const [a,b]=await Promise.all([memo.boundingBox(),note.boundingBox()]);expect(Math.abs(a.width-b.width)).toBeLessThan(1);
  await note.click();
  await expect(note).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-basket-list]')).toBeHidden();
  await expect(noteList(page)).toHaveCount(2);
  await expect(noteList(page).nth(0)).toContainText('임금협상 정리');await expect(noteList(page).nth(1)).toContainText('오래된 노트');
  await expect(noteList(page).nth(0).locator('.note-dot')).toBeVisible();
  await expect(noteList(page).nth(0)).toContainText('합성 임금 프로젝트');
  await expect(page.locator('[data-note-host]')).not.toContainText('회의 준비 메모');
  await page.locator('[data-note-search]').fill('기본급');
  await expect(noteList(page)).toHaveCount(1);await expect(noteList(page)).toContainText('임금협상 정리');
  await page.locator('[data-note-search]').fill('없는 말');
  await expect(noteList(page)).toHaveCount(0);await expect(page.locator('[data-note-list-status]')).toHaveText('찾는 노트가 없어요');
  await memo.click();
  await expect(page.locator('[data-basket-row="m1"]')).toBeVisible();await expect(page.locator('[data-note-host]')).toBeHidden();
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
 });

 test(`note reads as markdown, edits title and body through the kind=note PATCH ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await page.locator('[data-basket-kind="note"]').click();
  await noteList(page).filter({hasText:'임금협상 정리'}).click();
  const detail=page.locator('[data-note-detail]');
  await expect(page.locator('[data-basket-kind-switch]')).toBeHidden();
  await expect(detail.locator('[data-note-read-title]')).toHaveText('임금협상 정리');
  await expect(detail.locator('[data-basket-read-text] h2')).toHaveText('쟁점');
  await expect(detail.locator('[data-basket-read-text] strong')).toHaveText('기본급');
  for(const label of ['수정','텔레그램용 복사','연결하기'])await expect(detail.getByRole('button',{name:label,exact:true})).toBeVisible();
  await detail.getByRole('button',{name:'수정',exact:true}).click();
  await expect(detail.locator('[data-note-title-input]')).toHaveValue('임금협상 정리');
  await detail.locator('[data-note-title-input]').fill('');
  await detail.locator('[data-note-save]').click();
  await expect(detail.locator('[data-basket-status]')).toHaveText('노트 제목을 입력해 주세요.');expect(f.writes).toEqual([]);
  await detail.locator('[data-note-title-input]').fill('임금협상 정리 v2');
  await detail.locator('[data-basket-text]').fill('## 쟁점\n\n- 기본급 5% 인상');
  await detail.locator('[data-note-save]').click();
  await expect(detail.locator('[data-basket-status]')).toHaveText('노트를 저장했습니다.');
  await expect(detail.locator('[data-note-read-title]')).toHaveText('임금협상 정리 v2');
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0].query).toMatchObject({id:'eq.n-new',workspace_id:'eq.w',kind:'eq.note'});
  expect(f.writes[0].body).toMatchObject({title:'임금협상 정리 v2',raw_text:'## 쟁점\n\n- 기본급 5% 인상'});
  await detail.locator('[data-note-close]').click();
  await expect(page.locator('[data-basket-kind-switch]')).toBeVisible();
  await expect(noteList(page).nth(0)).toContainText('임금협상 정리 v2');
  expect(f.errors).toEqual([]);
 });

 test(`basket memo moves to a note with the first line as title, and back to the basket ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await page.locator('[data-basket-row="m1"]').click();
  await noteAction(page,'[data-basket-to-note]');
  const form=page.locator('[data-basket-to-note-form]');
  await expect(form).toBeVisible();await expect(page.locator('[data-basket-read-actions]')).toBeHidden();
  await expect(form.locator('[data-basket-to-note-title]')).toHaveValue('회의 준비 메모 첫 줄');
  await form.locator('[data-basket-to-note-save]').click();
  await expect(page.locator('[data-basket-kind="note"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-note-read-title]')).toHaveText('회의 준비 메모 첫 줄');
  expect(f.writes[0].query).toMatchObject({id:'eq.m1',kind:'eq.basket'});expect(f.writes[0].body).toMatchObject({kind:'note',title:'회의 준비 메모 첫 줄'});
  expect(f.rows.find(r=>r.id==='m1').raw_text).toBe('회의 준비 메모 첫 줄\n둘째 줄 내용');
  // Back to the basket from the note menu, after a confirmation.
  page.once('dialog',d=>d.accept());
  await page.locator('[data-note-more]').click();await page.locator('#noteDocMenu [data-note-to-basket]').click();
  await expect(page.locator('[data-note-list-status]')).toHaveText('바구니로 돌렸어요.');
  expect(f.writes[1].query).toMatchObject({id:'eq.m1',kind:'eq.note'});expect(f.writes[1].body).toMatchObject({kind:'basket',title:null});
  await expect(noteList(page)).toHaveCount(2);
  await page.locator('[data-basket-kind="memo"]').click();
  await expect(page.locator('[data-basket-row="m1"]')).toBeVisible();
  expect(f.errors).toEqual([]);
 });
}

for(const width of [390,1280]){
 test(`[+] writes a new note: saved as kind=note, read view, top of the list, not a basket memo ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await page.locator('[data-basket-kind="note"]').click();
  await expect(noteList(page)).toHaveCount(2);
  const add=page.getByRole('button',{name:'새 노트',exact:true});
  await expect(add).toBeVisible();
  // Phone: the same round [+] as the other screens, above the bottom tabs.
  if(width<=760){const s=await add.evaluate(el=>{const c=getComputedStyle(el);return {position:c.position,radius:c.borderRadius,width:el.getBoundingClientRect().width};});
   expect(s.position).toBe('fixed');expect(s.radius).toBe('50%');expect(Math.round(s.width)).toBe(36);}
  await add.click();
  const detail=page.locator('[data-note-detail]');
  await expect(page.locator('[data-note-list]')).toBeHidden();
  await expect(detail.locator('[data-note-title-input]')).toBeFocused();
  await expect(detail.locator('[data-note-title-input]')).toHaveValue('');await expect(detail.locator('[data-basket-text]')).toHaveValue('');
  await expect(detail.getByRole('button',{name:'큰 창에서 수정',exact:true})).toBeVisible();
  await expect(detail.locator('[data-note-more-wrap]')).toBeHidden();await expect(detail.locator('[data-note-read-actions]')).toBeHidden();
  await detail.locator('[data-note-title-input]').fill('단체교섭 준비');
  await detail.locator('[data-basket-text]').fill('## 할 일\n\n- 요구안 정리');
  await detail.locator('[data-note-save]').click();
  await expect(detail.locator('[data-basket-status]')).toHaveText('노트를 저장했습니다.');
  await expect(detail.locator('[data-note-read-title]')).toHaveText('단체교섭 준비');
  await expect(detail.locator('[data-basket-read-text] h2')).toHaveText('할 일');
  await expect(detail.locator('[data-note-read-actions]')).toBeVisible();
  expect(f.writes).toEqual([{method:'POST',body:{workspace_id:'w',kind:'note',title:'단체교섭 준비',raw_text:'## 할 일\n\n- 요구안 정리'}}]);
  await detail.locator('[data-note-close]').click();
  await expect(noteList(page)).toHaveCount(3);
  await expect(noteList(page).nth(0)).toContainText('단체교섭 준비');
  await page.locator('[data-basket-kind="memo"]').click();
  await expect(page.locator('[data-basket-row="m1"]')).toBeVisible();
  await expect(page.locator('[data-basket-rows]')).not.toContainText('단체교섭 준비');
  await expect(page.locator('[data-basket-row="n-created"]')).toHaveCount(0);
  expect(f.errors).toEqual([]);
 });
}

test('an empty new note is not saved; a body-only note takes its first line as title',async({page})=>{
 await page.setViewportSize({width:390,height:900});const f=await fixture(page);
 await page.locator('[data-basket-kind="note"]').click();
 await page.getByRole('button',{name:'새 노트',exact:true}).click();
 const detail=page.locator('[data-note-detail]');
 await detail.locator('[data-note-title-input]').fill('   ');await detail.locator('[data-basket-text]').fill('  \n ');
 await detail.locator('[data-note-save]').click();
 await expect(detail.locator('[data-basket-status]')).toHaveText('제목이나 본문을 써 주세요.');
 expect(f.writes).toEqual([]);
 await detail.locator('[data-note-title-input]').fill('');await detail.locator('[data-basket-text]').fill('\n  첫 줄 메모  \n둘째 줄');
 await detail.locator('[data-note-save]').click();
 await expect(detail.locator('[data-note-read-title]')).toHaveText('첫 줄 메모');
 expect(f.writes).toHaveLength(1);expect(f.writes[0].body).toMatchObject({kind:'note',title:'첫 줄 메모',raw_text:'\n  첫 줄 메모  \n둘째 줄'});
 expect(f.errors).toEqual([]);
});

test('phone back on an unsaved new note asks before closing; an untouched one just closes',async({page})=>{
 await page.setViewportSize({width:390,height:900});const f=await fixture(page);
 await page.locator('[data-basket-kind="note"]').click();
 const add=page.getByRole('button',{name:'새 노트',exact:true}),detail=page.locator('[data-note-detail]');
 await add.click();await expect(detail).toBeVisible();
 await page.goBack();
 await expect(page.locator('[data-note-list]')).toBeVisible();await expect(add).toBeFocused();
 await add.click();
 await detail.locator('[data-basket-text]').fill('쓰던 글');
 const asked=[];page.on('dialog',d=>{asked.push(d.message());asked.length===1?d.dismiss():d.accept();});
 await page.goBack();
 await expect.poll(()=>asked.length).toBe(1);expect(asked[0]).toBe('저장 안 하고 닫을까요?');
 await expect(detail.locator('[data-basket-text]')).toHaveValue('쓰던 글');
 await detail.locator('[data-note-cancel]').click();
 await expect.poll(()=>asked.length).toBe(2);expect(asked[1]).toBe('저장 안 하고 닫을까요?');
 await expect(page.locator('[data-note-list]')).toBeVisible();await expect(noteList(page)).toHaveCount(2);
 // Closing the new note stays in the basket tab.
 expect(await page.evaluate(()=>window.KPTURouter.current)).toBe('basket');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('a note without body cannot go back to the basket and nothing is written',async({page})=>{
 await page.setViewportSize({width:390,height:900});const f=await fixture(page);
 f.rows.find(r=>r.id==='n-old').raw_text='';
 await page.locator('[data-basket-kind="note"]').click();
 await noteList(page).filter({hasText:'오래된 노트'}).click();
 await expect(page.locator('[data-note-detail] [data-basket-read-text]')).toHaveText('본문이 없는 노트입니다.');
 page.once('dialog',d=>d.accept());
 await page.locator('[data-note-more]').click();await page.locator('#noteDocMenu [data-note-to-basket]').click();
 await expect(page.locator('[data-note-detail] [data-basket-status]')).toContainText('바구니로 돌릴 수 없어요');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('note edit draft is protected when leaving with Escape',async({page})=>{
 await page.setViewportSize({width:1280,height:900});const f=await fixture(page);
 await page.locator('[data-basket-kind="note"]').click();
 await noteList(page).filter({hasText:'오래된 노트'}).click();
 await page.locator('[data-note-edit]').click();
 await page.locator('[data-note-detail] [data-basket-text]').fill('고치는 중');
 let asked=0;page.on('dialog',d=>{asked++;d.dismiss();});
 await page.keyboard.press('Escape');
 expect(asked).toBe(1);await expect(page.locator('[data-note-detail] [data-basket-text]')).toHaveValue('고치는 중');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

// UI-키보드하단바: menu [쓰기] head in one row = [× 닫기] [메모|노트] [쓰기|미리보기] … [내보내기] [저장], 32px buttons.
async function openWriter(page,width){
 if(width<761){await page.locator('#mobileMenuTab').click();await page.locator('#mobileMenu [data-menu-write]').click();}
 else await page.locator('#appView>.app-nav [data-menu-write]').click();
 const editor=page.locator('#mdEditor');await expect(editor).toBeVisible();return editor;
}
// The [메모|노트] box is the shared 32px segment (its buttons sit inside its 1px line); every other head button is 32px itself.
async function headHeights(editor){return editor.locator('.md-editor-head :is(.md-editor-kinds, button:not(.md-editor-kinds button)):visible').evaluateAll(list=>list.map(b=>[b.textContent,Math.round(b.getBoundingClientRect().height)]));}
for(const width of [390,1280]){
 test(`menu [쓰기] → [노트] saves a kind=note row and opens it; the 메모 list stays clean ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  const editor=await openWriter(page,width),kinds=editor.locator('.md-editor-kinds');
  await expect(kinds.getByRole('button')).toHaveText(['메모','노트']);
  await expect(kinds.getByRole('button',{name:'메모'})).toHaveAttribute('aria-pressed','true');
  // Left: × then the switch. Right: 내보내기 · 저장, in that order, one row, all 32px tall (the press area stays 44px).
  const [c,k,x,sv]=await Promise.all([editor.locator('[data-close="mdEditor"]'),kinds,editor.getByRole('button',{name:'내보내기'}),editor.locator('[data-md-save]')].map(l=>l.boundingBox()));
  expect(c.x).toBeLessThan(k.x);expect(k.x).toBeLessThan(x.x);expect(x.x).toBeLessThan(sv.x);expect(Math.abs(k.y-x.y)).toBeLessThan(2);expect(Math.abs(c.y-sv.y)).toBeLessThan(2);
  for(const [label,h] of await headHeights(editor))expect(h,label).toBe(32);
  expect(await editor.getByRole('button',{name:'노트'}).evaluate(el=>getComputedStyle(el,'::after').height)).toBe('44px');
  const pressed=await kinds.getByRole('button',{name:'메모'}).evaluate(el=>getComputedStyle(el).backgroundColor),plain=await kinds.getByRole('button',{name:'노트'}).evaluate(el=>getComputedStyle(el).backgroundColor);
  expect(pressed).not.toBe(plain);
  await kinds.getByRole('button',{name:'노트'}).click();
  await expect(kinds.getByRole('button',{name:'노트'})).toHaveAttribute('aria-pressed','true');
  await expect(editor.locator('[data-md-save]')).toHaveAttribute('aria-label','새 노트로 저장');
  await editor.locator('[data-md-save]').click();
  await expect(editor.locator('.md-editor-status')).toHaveText('글을 입력해 주세요.');expect(f.writes).toEqual([]);
  await editor.locator('.md-editor-text').fill('# 회의 정리\n\n- 다음 일정 확인');
  await editor.locator('[data-md-save]').click();
  await expect(page.locator('#mdEditor')).toHaveCount(0);
  expect(f.writes).toEqual([{method:'POST',body:{workspace_id:'w',kind:'note',title:'회의 정리',raw_text:'# 회의 정리\n\n- 다음 일정 확인'}}]);
  const detail=page.locator('[data-note-detail]');
  await expect(page.locator('[data-basket-kind="note"]')).toHaveAttribute('aria-pressed','true');
  await expect(detail.locator('[data-note-read-title]')).toHaveText('회의 정리');
  await expect(detail.locator('[data-basket-read-text] h1')).toHaveText('회의 정리');
  await detail.locator('[data-note-close]').click();
  await expect(noteList(page).nth(0)).toContainText('회의 정리');
  await page.locator('[data-basket-kind="memo"]').click();
  await expect(page.locator('[data-basket-row="m1"]')).toBeVisible();await expect(page.locator('[data-basket-rows]')).not.toContainText('회의 정리');
  expect(f.errors).toEqual([]);
 });
}

test('menu [쓰기] → [메모] still saves one basket memo (no kind, no title)',async({page})=>{
 await page.setViewportSize({width:390,height:900});const f=await fixture(page);
 const editor=await openWriter(page,390);
 await expect(editor.locator('[data-md-save]')).toHaveAttribute('aria-label','바구니에 새 메모로 저장');
 await editor.locator('.md-editor-text').fill('쓰기 메모');
 await editor.locator('[data-md-save]').click();
 await expect(page.locator('#mdEditor')).toHaveCount(0);await expect(page.locator('#toast')).toContainText('바구니에 저장했어요.');
 expect(f.writes).toEqual([{method:'POST',body:{workspace_id:'w',raw_text:'쓰기 메모'}}]);
 await showBasketRow(page,'m-created');
 await expect(page.locator('[data-basket-row="m-created"]')).toContainText('쓰기 메모');
 await expect(page.locator('[data-basket-kind="memo"]')).toHaveAttribute('aria-pressed','true');
 expect(f.errors).toEqual([]);
});

test('[내보내기] opens the shared choice sheet: 텔레그램·한글 copy, HWP says it is not ready',async({page})=>{
 await page.setViewportSize({width:390,height:900});const f=await fixture(page);
 const editor=await openWriter(page,390),sheet=page.locator('#mdExportSheet'),status=editor.locator('.md-editor-status');
 await page.evaluate(()=>{navigator.clipboard.writeText=async text=>{window.__copied=text;};navigator.clipboard.write=async items=>{window.__rich=await Promise.all(items[0].types.map(async t=>[t,await (await items[0].getType(t)).text()]));};});
 await editor.locator('.md-editor-text').fill('**굵게** 글');
 const exportButton=editor.getByRole('button',{name:'내보내기',exact:true});
 await exportButton.click();
 await expect(sheet).toHaveAttribute('open','');await expect(exportButton).toHaveAttribute('aria-expanded','true');
 await expect(sheet.locator('h2')).toHaveText('내보내기');
 const rows=sheet.locator('[data-sheet-value]');
 await expect(rows).toHaveText(['텔레그램용 복사','한글용 복사','HWP 파일로 받기']);
 for(const row of await rows.all())await expect(row).toBeEnabled();
 await rows.nth(0).click();
 await expect(status).toHaveText('텔레그램용 글을 복사했어요. 텔레그램에 붙여 넣으세요.');
 expect(await page.evaluate(()=>window.__copied)).toBe('굵게 글');
 await expect(sheet).not.toHaveAttribute('open','');await expect(editor).toBeVisible();await expect(exportButton).toBeFocused();
 await exportButton.click();await rows.nth(1).click();
 await expect(status).toHaveText('한글용 글을 복사했어요. 한글에 붙여 넣으세요.');
 expect(await page.evaluate(()=>window.__rich)).toEqual([['text/html','<p style="margin:0"><b>굵게</b> 글</p>'],['text/plain','굵게 글']]);
 await exportButton.click();await rows.nth(2).click();
 await expect(status).toHaveText('HWP 파일로 받기는 준비 중이에요.');
 // Escape and phone back close the sheet only; the editor and its text stay.
 await exportButton.click();await expect(sheet).toHaveAttribute('open','');
 await page.keyboard.press('Escape');await expect(sheet).not.toHaveAttribute('open','');
 await exportButton.click();await expect(sheet).toHaveAttribute('open','');
 await page.goBack();await expect(sheet).not.toHaveAttribute('open','');
 await expect(editor).toBeVisible();await expect(editor.locator('.md-editor-text')).toHaveValue('**굵게** 글');
 // Back once more closes the editor itself.
 await page.goBack();await expect(page.locator('#mdEditor')).toHaveCount(0);
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('the editor opened to change a note has no [메모|노트] switch, and the same 32px head',async({page})=>{
 await page.setViewportSize({width:390,height:900});const f=await fixture(page);
 await page.locator('[data-basket-kind="note"]').click();
 await noteList(page).filter({hasText:'오래된 노트'}).click();
 await page.locator('[data-note-edit]').click();
 await page.locator('[data-note-big-write]').click();
 const editor=page.locator('#mdEditor');await expect(editor).toBeVisible();
 await expect(editor.locator('.md-editor-kinds')).toHaveCount(0);await expect(editor.locator('[data-md-save]')).toHaveCount(0);
 await expect(editor).toHaveAccessibleName('큰 창에서 수정');await expect(editor.getByRole('button',{name:'내보내기',exact:true})).toBeVisible();
 await expect(editor.getByRole('button',{name:'텔레그램용 복사',exact:true})).toHaveCount(0);
 for(const [label,h] of await headHeights(editor))expect(h,label).toBe(32);
 // The note read view keeps its own [텔레그램용 복사] this time.
 await editor.locator('[data-close="mdEditor"]').click();await page.locator('[data-note-cancel]').click();
 await expect(page.locator('[data-note-detail]').getByRole('button',{name:'텔레그램용 복사',exact:true})).toBeVisible();
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

for(const width of [360,390,412,870,1280]){
 test(`note edit buttons [큰 창에서 수정][저장][취소] sit on one uncut line at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await page.locator('[data-basket-kind="note"]').click();
  await noteList(page).filter({hasText:'오래된 노트'}).click();
  await page.locator('[data-note-edit]').click();
  const bar=page.locator('[data-note-edit-actions]');await expect(bar).toBeVisible();
  const boxes=[];
  for(const name of ['큰 창에서 수정','저장','취소']){
   const b=bar.getByRole('button',{name,exact:true});await expect(b).toBeVisible();
   const m=await b.evaluate(el=>{const r=el.getBoundingClientRect();return {top:r.top,left:r.left,right:r.right,height:r.height,cut:el.scrollWidth>el.clientWidth+1};});
   expect(m.cut,name).toBe(false);expect(m.height,name).toBeGreaterThanOrEqual(44);boxes.push(m);
  }
  expect(boxes[1].top).toBe(boxes[0].top);expect(boxes[2].top).toBe(boxes[0].top);
  expect(boxes[0].left).toBeLessThan(boxes[1].left);expect(boxes[1].left).toBeLessThan(boxes[2].left);
  expect(boxes[2].right).toBeLessThanOrEqual(width);
  await expect(bar.locator('[data-note-save]')).toHaveClass(/primary/);
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
 });
}

// UI-노트편집버튼 ②: the big window's save icon sits right beside [닫기] and runs the opening screen's own [저장].
const SAVE_ICON='[data-md-save-icon]';
async function headBox(locator){return locator.evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,height:r.height,after:getComputedStyle(el,'::after').height};});}
async function expectIconNextToClose(editor){
 const icon=editor.locator(SAVE_ICON);await expect(icon).toBeVisible();await expect(icon).toHaveAccessibleName('저장');
 const close=await headBox(editor.locator('[data-close="mdEditor"]')),save=await headBox(icon);
 expect(save.left).toBeGreaterThanOrEqual(close.right);expect(save.left-close.right).toBeLessThan(16);expect(save.top).toBe(close.top);
 expect(Math.round(save.height)).toBe(32);expect(save.after).toBe('44px');
}
for(const width of [390,1280]){
 test(`big window save icon saves a note through [저장], closes, and keeps the window when the save fails ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await page.locator('[data-basket-kind="note"]').click();
  await noteList(page).filter({hasText:'오래된 노트'}).click();
  const detail=page.locator('[data-note-detail]');
  await detail.locator('[data-note-edit]').click();
  await detail.locator('[data-note-big-write]').click();
  const editor=page.locator('#mdEditor');await expect(editor).toBeVisible();
  await expectIconNextToClose(editor);
  await editor.locator('.md-editor-text').fill('큰 창에서 고친 본문');
  // A failed save keeps the window, the text and the message.
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>r.request().method()==='PATCH'?r.fulfill({status:500,json:{}}):r.fallback(),{times:1});
  await editor.locator(SAVE_ICON).click();
  await expect(editor.locator('.md-editor-status')).toContainText('저장하지 못했어요');
  await expect(editor).toBeVisible();await expect(editor.locator('.md-editor-text')).toHaveValue('큰 창에서 고친 본문');
  await expect(editor.locator(SAVE_ICON)).toBeEnabled();expect(f.writes).toEqual([]);
  // The second press goes the same path as [저장]: PATCH, the window closes, the read view shows the new text.
  await editor.locator(SAVE_ICON).click();
  await expect(page.locator('#mdEditor')).toHaveCount(0);
  await expect(detail.locator('[data-basket-status]')).toHaveText('노트를 저장했습니다.');
  await expect(detail.locator('[data-basket-read-text]')).toContainText('큰 창에서 고친 본문');
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0].query).toMatchObject({id:'eq.n-old',kind:'eq.note'});expect(f.writes[0].body.raw_text).toBe('큰 창에서 고친 본문');
  expect(f.errors.filter(e=>!/500/.test(e))).toEqual([]);
 });

 test(`big window save icon on a new note creates it and returns to its read view ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await page.locator('[data-basket-kind="note"]').click();
  await page.locator('[data-note-new]').click();
  const detail=page.locator('[data-note-detail]');
  await detail.locator('[data-note-big-write]').click();
  const editor=page.locator('#mdEditor');await expect(editor).toBeVisible();
  await expectIconNextToClose(editor);
  // Nothing written: the shared [저장] message shows in the window and nothing is sent.
  await editor.locator(SAVE_ICON).click();
  await expect(editor.locator('.md-editor-status')).toContainText('제목이나 본문을 써 주세요.');expect(f.writes).toEqual([]);
  await editor.locator('.md-editor-text').fill('새 노트 첫 줄\n둘째 줄');
  await editor.locator(SAVE_ICON).click();
  await expect(page.locator('#mdEditor')).toHaveCount(0);
  await expect(detail.locator('[data-basket-status]')).toHaveText('노트를 저장했습니다.');
  expect(f.writes).toHaveLength(1);expect(f.writes[0].method).toBe('POST');
  expect(f.writes[0].body).toMatchObject({kind:'note',title:'새 노트 첫 줄',raw_text:'새 노트 첫 줄\n둘째 줄'});
  expect(f.errors).toEqual([]);
 });

 test(`big window save icon on a memo runs the memo's [수정 저장] ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await page.locator('[data-basket-row="m1"]').click();
  await noteAction(page,'[data-basket-edit]');
  const detail=page.locator('[data-basket-detail]');
  await detail.locator('[data-basket-big-write]').click();
  const editor=page.locator('#mdEditor');await expect(editor).toBeVisible();
  await expectIconNextToClose(editor);
  await editor.locator('.md-editor-text').fill('큰 창에서 고친 메모');
  await editor.locator(SAVE_ICON).click();
  await expect(page.locator('#mdEditor')).toHaveCount(0);
  await expect(detail.locator('[data-basket-status]')).toHaveText('수정한 글을 저장했습니다.');
  await expect(detail.locator('[data-basket-read-text]')).toContainText('큰 창에서 고친 메모');
  expect(f.writes).toHaveLength(1);expect(f.writes[0].body).toEqual({raw_text:'큰 창에서 고친 메모'});
  expect(f.errors).toEqual([]);
 });
}

test('[닫기] in the big window hands the text back to the edit field and the menu write window has no save icon',async({page})=>{
 await page.setViewportSize({width:390,height:900});const f=await fixture(page);
 await page.locator('[data-basket-kind="note"]').click();
 await noteList(page).filter({hasText:'오래된 노트'}).click();
 const detail=page.locator('[data-note-detail]');
 await detail.locator('[data-note-edit]').click();await detail.locator('[data-note-big-write]').click();
 const editor=page.locator('#mdEditor');await editor.locator('.md-editor-text').fill('닫아도 남는 글');
 await editor.locator('[data-close="mdEditor"]').click();
 await expect(page.locator('#mdEditor')).toHaveCount(0);await expect(detail.locator('[data-basket-text]')).toHaveValue('닫아도 남는 글');
 page.once('dialog',d=>d.accept());await detail.locator('[data-note-cancel]').click();
 const writer=await openWriter(page,390);
 await expect(writer.locator('[data-md-save]')).toBeVisible();await expect(writer.locator(SAVE_ICON)).toHaveCount(0);
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});
