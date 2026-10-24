import { test, expect } from '@playwright/test';
import {openMdTool} from './helpers/md-tools.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { noteMenuAction } from './helpers/note-menu.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { expectNoteTitle } from './helpers/note-title.mjs';
import { noteField, edWin, edWinText } from './helpers/note-editor.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// NOTE-마크다운선택·NOTE-큰창저장유지 (합성 데이터). One app_notes store honours the kind/id filters, like basket-notes.spec.mjs.
const LONG='https://example.org/'+'아주긴주소'.repeat(40);
function store(){
 const at='2026-10-20T01:00:00Z',row=(id,kind,title,raw_text,metadata={},updated=at)=>({id,workspace_id:'w',kind,title,raw_text,occurred_at:at,created_at:at,updated_at:updated,archived_at:null,ai_export_allowed:true,attachments:[],metadata});
 return [
  // An old note without a stored choice and no markdown marks → read as written.
  row('n-plain','note','합성 통화 메모','1. 첫째 할 일\n- 둘째 줄\n2026. 10. 21. 교섭 일정\n    들여 쓴 줄\n'+LONG,{pinned_at:'2026-10-19T00:00:00Z'},'2026-10-20T03:00:00Z'),
  // An old note with markdown marks → read as markdown (date line still not a list).
  row('n-md','note','합성 쟁점 정리','## 쟁점\n\n2026. 10. 21. 교섭\n\n- **기본급** 인상',{},'2026-10-20T02:00:00Z'),
  row('m-date','basket',null,'2026.10.21. 14:30 합성지부 통화\n통화 내용 첫 줄\n둘째 줄'),
 ];
}
async function fixture(page){
 const rows=store(),writes=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await openHome(page);
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams;
  const pick=row=>(!q.get('kind')||'eq.'+row.kind===q.get('kind'))&&(!q.get('id')||'eq.'+row.id===q.get('id'))&&(!q.get('workspace_id')||'eq.'+row.workspace_id===q.get('workspace_id'))&&(!q.get('updated_at')||'eq.'+row.updated_at===q.get('updated_at'));
  if(req.method()==='GET'){if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:rows.filter(pick).slice(Number(q.get('offset')||0))});}
  if(req.method()==='PATCH'){
   const body=req.postDataJSON();writes.push({query:Object.fromEntries(q),body});
   const hit=rows.filter(pick);for(const row of hit)Object.assign(row,body);
   return r.fulfill({json:hit.map(x=>structuredClone(x))});
  }
  if(req.method()==='POST'){
   const body=req.postDataJSON();writes.push({method:'POST',body});
   const at='2026-10-21T05:00:00Z',row={id:'n-created',kind:'basket',title:null,occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},...body};
   rows.push(row);return r.fulfill({status:201,json:[row]});
  }
  return r.fulfill({status:500,json:{}});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',r=>{const q=new URL(r.request().url()).searchParams;if(!q.has('note_id'))return r.fallback();return r.fulfill({json:[]});});
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await expect(page.locator('[data-basket-row="m-date"]')).toBeVisible();
 return {rows,writes,errors};
}
const noteRow=(page,text)=>page.locator('[data-note-host] [data-note-row]').filter({hasText:text});
async function openNote(page,text){await chooseBasketKind(page,'note');await noteRow(page,text).click();return page.locator('[data-note-detail]');}
const noOverflow=el=>el.evaluate(n=>n.scrollWidth<=n.clientWidth+1&&n.getBoundingClientRect().right<=document.documentElement.clientWidth+1);

for(const width of [390,1280]){
 test(`an old plain note reads as written: no list, no indent, nothing out of the box ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  const detail=await openNote(page,'합성 통화 메모'),body=detail.locator('[data-basket-read-text]');
  await expect(body).toHaveAttribute('data-note-view','plain');
  await expect(body).toHaveText(f.rows.find(r=>r.id==='n-plain').raw_text);
  await expect(body.locator('ol,ul,li,pre,code,h1,h2')).toHaveCount(0);
  expect(await noOverflow(body)).toBe(true);
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
 });

 test(`an old note with markdown marks reads as markdown; its date line is not a numbered list ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  const detail=await openNote(page,'합성 쟁점 정리'),body=detail.locator('[data-basket-read-text]');
  await expect(body.locator('h2')).toHaveText('쟁점');await expect(body.locator('strong')).toHaveText('기본급');
  await expect(body.locator('ol')).toHaveCount(0);await expect(body.locator('p').first()).toHaveText('2026. 10. 21. 교섭');
  expect(f.errors).toEqual([]);
 });

 // ED③ 노트 (결정 11 가): the [마크다운] box is gone. A note opens in the new editor: an old markdown note as format, an old note written as is
 // with its letters and line breaks unchanged. Saving writes the letters (raw_text) and the saved form (doc) in one write guarded by the
 // version the edit opened (updated_at); metadata (pin, folder, the old markdown value) is not written, so nothing of it is lost.
 test(`edit: an old markdown note opens as format and saves letters without marks + doc; the pin stays ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  const detail=await openNote(page,'합성 쟁점 정리');
  await noteMenuAction(page,'data-note-edit');
  await expect(detail.locator('[data-note-markdown]')).toHaveCount(0);
  const field=noteField(page);
  await expect(field.locator('.ed-h2')).toHaveText('쟁점');await expect(field.locator('li strong')).toHaveText('기본급');
  // The date line stays a line of letters (not a numbered list), as the old read view showed it.
  await expect(field.locator('ol')).toHaveCount(0);await expect(field).toContainText('2026. 10. 21. 교섭');
  await field.locator('li').click();await page.keyboard.press('End');await page.keyboard.insertText(' 요구');
  await detail.locator('[data-note-save]').click();
  await expect(page.locator('#toast')).toContainText('노트를 저장했습니다.');
  expect(f.writes).toHaveLength(1);expect(f.writes[0].query).toMatchObject({id:'eq.n-md',kind:'eq.note',updated_at:'eq.2026-10-20T02:00:00Z'});
  expect(f.writes[0].body.raw_text).toBe('쟁점\n\n2026. 10. 21. 교섭\n\n- 기본급 인상 요구');
  expect(f.writes[0].body.doc.v).toBe('ed1');expect(f.writes[0].body.metadata).toBeUndefined();
  const body=detail.locator('[data-basket-read-text]');
  await expect(body).toHaveAttribute('data-note-view','doc');await expect(body.locator('.ed-h2')).toHaveText('쟁점');await expect(body.locator('strong')).toHaveText('기본급');
  expect(f.errors).toEqual([]);
 });

 test(`edit: an old note written as is keeps its letters; opening and saving unchanged writes nothing ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  const detail=await openNote(page,'합성 통화 메모');
  await noteMenuAction(page,'data-note-edit');
  const field=noteField(page);await expect(field).toBeVisible();
  await expect(field.locator('ol,ul,li,h2,h3')).toHaveCount(0);
  await expect(field).toContainText('1. 첫째 할 일');await expect(field).toContainText('- 둘째 줄');
  await detail.locator('[data-note-save]').click();
  await expect(page.locator('#toast')).toContainText('저장된 노트입니다.');expect(f.writes).toEqual([]);
  await noteMenuAction(page,'data-note-edit');await expect(noteField(page)).toBeVisible();
  await noteField(page).click();await page.keyboard.press('Control+End');await page.keyboard.press('Shift+Enter');await page.keyboard.insertText('덧붙인 줄');
  await detail.locator('[data-note-save]').click();
  await expect(page.locator('#toast')).toContainText('노트를 저장했습니다.');
  const raw=f.rows.find(r=>r.id==='n-plain');
  expect(f.writes).toHaveLength(1);
  // Every written line is the same letters as before ("1." "-" and the date stay letters), plus the new line.
  expect(f.writes[0].body.raw_text).toBe(store().find(r=>r.id==='n-plain').raw_text+'\n덧붙인 줄');
  expect(raw.metadata).toEqual({pinned_at:'2026-10-19T00:00:00Z'});
  await expect(detail.locator('[data-basket-read-text] ol')).toHaveCount(0);
  expect(f.errors).toEqual([]);
 });

 test(`markdown shortcuts at a line start: ## 제목, - 목록, 1. 번호, > 인용, **굵게**; one undo gives the marks back ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  const detail=await openNote(page,'합성 통화 메모');
  await noteMenuAction(page,'data-note-edit');
  const field=noteField(page);await expect(field).toBeVisible();
  await field.click();await page.keyboard.press('Control+A');await page.keyboard.press('Backspace');
  await page.keyboard.type('## 쟁점');await expect(field.locator('.ed-h2')).toHaveText('쟁점');
  await page.keyboard.press('Enter');await page.keyboard.type('### 세부');await expect(field.locator('.ed-h3')).toHaveText('세부');
  await page.keyboard.press('Enter');await page.keyboard.type('- 사과');await expect(field.locator('ul > li')).toHaveText('사과');
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');
  await page.keyboard.type('* 배');await expect(field.locator('ul > li')).toHaveCount(2);
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');
  await page.keyboard.type('1. 하나');await expect(field.locator('ol > li')).toHaveText('하나');
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');
  await page.keyboard.type('> 인용 글');await expect(field.locator('blockquote')).toHaveText('인용 글');
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');
  await page.keyboard.type('아주 **굵은**');await expect(field.locator('strong')).toHaveText('굵은');
  // Undo right after a shortcut puts the typed marks back as letters (Ctrl+Z here; Backspace right after a line rule below).
  await page.keyboard.press('Control+Z');await expect(field.locator('strong')).toHaveCount(0);await expect(field).toContainText('아주 **굵은**');
  // Typed again it is bold again, and the text goes on after it unbolded.
  await page.keyboard.press('Backspace');await page.keyboard.type('*');await expect(field.locator('strong')).toHaveText('굵은');
  await page.keyboard.type(' 말');await expect(field).toContainText('아주 굵은 말');await expect(field.locator('strong')).toHaveText('굵은');
  await page.keyboard.press('Enter');await page.keyboard.type('## ');await expect(field.locator('.ed-h2')).toHaveCount(2);
  await page.keyboard.press('Backspace');await expect(field.locator('.ed-h2')).toHaveCount(1);await expect(field).toContainText('## ');
  // Inside a list item or a heading a "- " is letters (only a plain line starts a list).
  await field.locator('.ed-h2').click();await page.keyboard.press('End');await page.keyboard.type(' - 끝');
  await expect(field.locator('.ed-h2')).toHaveText('쟁점 - 끝');
  // "1." "-" in the middle of a line stay letters.
  await page.keyboard.press('Control+End');await page.keyboard.press('Enter');await page.keyboard.type('2026. 10. 21. 일정 - 확인');
  await expect(field).toContainText('2026. 10. 21. 일정 - 확인');
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
 });

 test(`a 한글 composition at a line start does not set off a shortcut until it is committed ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await openNote(page,'합성 통화 메모');
  await noteMenuAction(page,'data-note-edit');
  const field=noteField(page);await expect(field).toBeVisible();
  await field.click();await page.keyboard.press('Control+A');await page.keyboard.press('Backspace');
  await page.keyboard.type('## ');await expect(field.locator('.ed-h2')).toHaveCount(1);
  const cdp=await page.context().newCDPSession(page);
  // Simulated IME (Chromium input method events): composing 한 → 한글 inside the new heading.
  await cdp.send('Input.imeSetComposition',{text:'ㅎ',selectionStart:1,selectionEnd:1});
  await cdp.send('Input.imeSetComposition',{text:'한',selectionStart:1,selectionEnd:1});
  await cdp.send('Input.imeSetComposition',{text:'한ㄱ',selectionStart:2,selectionEnd:2});
  await cdp.send('Input.insertText',{text:'한글'});
  await expect(field.locator('.ed-h2')).toHaveText('한글');
  // A Korean keyboard types "-" and the space as plain keys (not composed): the list starts, then 가 is composed inside the item.
  // (Edge case, see PR: when an IME itself commits "- " and the next composition starts at once, the engine skips the rule — the letters
  // stay as typed, never a wrong format.)
  await page.keyboard.press('Enter');
  await page.keyboard.type('- ');await expect(field.locator('ul > li')).toHaveCount(1);
  await cdp.send('Input.imeSetComposition',{text:'ㄱ',selectionStart:1,selectionEnd:1});
  await cdp.send('Input.imeSetComposition',{text:'가',selectionStart:1,selectionEnd:1});
  // While composing, the item does not turn into anything else; the committed syllable lands in the item.
  await expect(field.locator('ul > li')).toHaveCount(1);
  await cdp.send('Input.insertText',{text:'가'});
  await expect(field.locator('ul > li')).toHaveText('가');
  // A "## " composed and committed at a line start (with nothing composed after it) still becomes a heading once.
  await page.keyboard.press('Enter');await page.keyboard.press('Enter');
  await cdp.send('Input.imeSetComposition',{text:'#',selectionStart:1,selectionEnd:1});
  await cdp.send('Input.insertText',{text:'### '});
  await expect(field.locator('.ed-h3')).toHaveCount(1);
  await expect(field.locator('.ed-h2')).toHaveText('한글');
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
 });

 test(`a table and a colour saved, then opened again, come back the same; a note changed in another tab is not overwritten ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  const detail=await openNote(page,'합성 통화 메모');
  await noteMenuAction(page,'data-note-edit');
  const field=noteField(page);await expect(field).toBeVisible();
  await field.click();await page.keyboard.press('Control+A');await page.keyboard.press('Backspace');
  await page.keyboard.insertText('빨간 글');await page.keyboard.press('Shift+Home');
  await page.evaluate(()=>{});
  const tools=detail.locator('[data-note-body-field] .ed-tools');
  if(width<761){await tools.locator('[data-ed-cmd="gText"]').click();}
  await detail.locator('[data-note-body-field] [data-ed-cmd="color"]').click();
  await detail.locator('[data-note-body-field] [data-ed-color="red"]').click();
  await expect(field.locator('.ed-c-red')).toHaveText('빨간 글');
  await page.keyboard.press('End');await page.keyboard.press('Enter');
  if(width<761){await tools.locator('[data-ed-cmd="gInsert"]').click();}
  await detail.locator('[data-note-body-field] [data-ed-cmd="table"]').click();
  await detail.locator('[data-note-body-field] [data-ed-grid-r="2"][data-ed-grid-c="2"]').click();
  await expect(field.locator('table')).toHaveCount(1);
  await field.locator('table td, table th').first().click();await page.keyboard.insertText('칸 하나');
  await detail.locator('[data-note-save]').click();
  await expect(page.locator('#toast')).toContainText('노트를 저장했습니다.');
  const saved=f.writes[0].body.doc;
  expect(JSON.stringify(saved)).toContain('"color":"red"');expect(saved.doc.content.some(n=>n.type==='table')).toBe(true);
  const body=detail.locator('[data-basket-read-text]');
  await expect(body.locator('.ed-c-red')).toHaveText('빨간 글');await expect(body.locator('table :is(td,th)').first()).toHaveText('칸 하나');
  // Opened again: the same saved form (nothing lost, nothing written by opening).
  await noteMenuAction(page,'data-note-edit');await expect(noteField(page).locator('table')).toHaveCount(1);
  await expect(noteField(page).locator('.ed-c-red')).toHaveText('빨간 글');
  // Another tab saves the note meanwhile (its updated_at moves): this save is refused and nothing is overwritten.
  f.rows.find(r=>r.id==='n-plain').updated_at='2026-10-24T09:00:00Z';
  await noteField(page).locator('table :is(td,th)').first().click();await page.keyboard.press('End');await page.keyboard.insertText(' 더');
  await detail.locator('[data-note-save]').click();
  await expect(detail.locator('[data-basket-status]')).toHaveText('노트가 그사이 바뀌었어요. 다시 불러온 뒤 저장해 주세요.');
  await expect(detail.locator('[data-note-reload]')).toBeVisible();
  expect(f.writes).toHaveLength(2);expect(f.rows.find(r=>r.id==='n-plain').doc).toEqual(saved);
  expect(f.errors.filter(e=>!/Failed to load resource/.test(e))).toEqual([]);
 });

 test(`pasting an AI answer in a note keeps the letters, [서식으로 바꾸기] converts once (결정 3 가) ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  const detail=await openNote(page,'합성 통화 메모');
  await noteMenuAction(page,'data-note-edit');
  const field=noteField(page);await expect(field).toBeVisible();
  await field.click();await page.keyboard.press('Control+A');
  await page.evaluate(()=>{const dt=new DataTransfer();dt.setData('text/plain','## 결론\n\n- **임금** 인상');document.querySelector('[data-note-body-field] .ProseMirror').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));});
  await expect(field).toContainText('## 결론');await expect(field.locator('.ed-h2')).toHaveCount(0);
  const offer=detail.locator('[data-note-body-field] .ed-suggest');await expect(offer).toBeVisible();
  await offer.getByRole('button',{name:'서식으로 바꾸기'}).click();
  await expect(field.locator('.ed-h2')).toHaveText('결론');await expect(field.locator('li strong')).toHaveText('임금');
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
 });

 test(`a new note has no [마크다운] box and saves its saved form; typed "1." and dates stay letters ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await chooseBasketKind(page,'note');
  await page.locator('[data-note-list] [data-quick-big]').click();
  const editor=edWin(page);await expect(editor).toBeVisible();
  await expect(editor.locator('[data-md-markdown]')).toHaveCount(0);
  await editor.locator('[data-edw-title]').fill('합성 새 노트');
  await edWinText(page).click();await page.keyboard.insertText('1.하나');await page.keyboard.press('Shift+Enter');await page.keyboard.insertText('2026. 10. 21. 일정');
  await editor.locator('[data-edw-save]').click();
  await expect(edWin(page)).toHaveCount(0);
  expect(f.writes).toHaveLength(1);expect(f.writes[0]).toMatchObject({method:'POST',body:{workspace_id:'w',kind:'note',title:'합성 새 노트',raw_text:'1.하나\n2026. 10. 21. 일정',metadata:{markdown:false}}});
  expect(f.writes[0].body.doc.v).toBe('ed1');
  const body=page.locator('[data-note-detail] [data-basket-read-text]');
  await expect(body).toHaveAttribute('data-note-view','doc');await expect(body.locator('ol,li')).toHaveCount(0);await expect(body).toContainText('2026. 10. 21. 일정');
  expect(f.errors).toEqual([]);
 });

 test(`[노트로 옮기기]: the date·time first line becomes the title and is not repeated in the body ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await page.locator('[data-basket-row="m-date"]').click();
  await page.locator('[data-basket-read-actions] [data-basket-to-note]').click();
  await expect(page.locator('#toast')).toHaveText('노트로 옮겼어요.');
  const detail=page.locator('[data-note-detail]');
  await expectNoteTitle(page,'2026.10.21. 14:30 합성지부 통화');
  await expect(detail.locator('[data-basket-read-text]')).toHaveText('통화 내용 첫 줄\n둘째 줄');
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0].body).toMatchObject({kind:'note',title:'2026.10.21. 14:30 합성지부 통화',raw_text:'통화 내용 첫 줄\n둘째 줄'});
  expect(f.errors).toEqual([]);
 });
}
