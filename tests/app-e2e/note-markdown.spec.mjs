import { test, expect } from '@playwright/test';
import {openMdTool} from './helpers/md-tools.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { noteMenuAction } from './helpers/note-menu.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { expectNoteTitle } from './helpers/note-title.mjs';
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
  const pick=row=>(!q.get('kind')||'eq.'+row.kind===q.get('kind'))&&(!q.get('id')||'eq.'+row.id===q.get('id'))&&(!q.get('workspace_id')||'eq.'+row.workspace_id===q.get('workspace_id'));
  if(req.method()==='GET'){if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:rows.filter(pick).slice(Number(q.get('offset')||0))});}
  if(req.method()==='PATCH'){
   const body=req.postDataJSON();writes.push({query:Object.fromEntries(q),body});
   const hit=rows.filter(pick);for(const row of hit)Object.assign(row,body);
   return r.fulfill({json:hit});
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

 test(`edit form: the 마크다운 box follows the note and is saved per note with its other metadata ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  const detail=await openNote(page,'합성 쟁점 정리');
  await noteMenuAction(page,'data-note-edit');
  const box=detail.locator('[data-note-markdown]');await expect(box).toBeChecked();
  await box.uncheck();
  await detail.locator('[data-note-save]').click();
  await expect(page.locator('#toast')).toContainText('노트를 저장했습니다.');
  expect(f.writes).toHaveLength(1);expect(f.writes[0].query).toMatchObject({id:'eq.n-md',kind:'eq.note'});
  expect(f.writes[0].body.metadata).toEqual({markdown:false});
  const body=detail.locator('[data-basket-read-text]');
  await expect(body).toHaveAttribute('data-note-view','plain');await expect(body.locator('h2')).toHaveCount(0);
  await expect(body).toContainText('## 쟁점');
  // The plain note keeps its pin when its box is saved (other metadata keys stay).
  await detail.locator('[data-note-close]').click();
  await noteRow(page,'합성 통화 메모').click();
  await noteMenuAction(page,'data-note-edit');
  await expect(detail.locator('[data-note-markdown]')).not.toBeChecked();
  await detail.locator('[data-basket-text]').fill('고친 본문');
  await detail.locator('[data-note-save]').click();
  await expect(detail.locator('[data-note-editor]')).toBeHidden();await expect(detail.locator('[data-basket-read-text]')).toHaveText('고친 본문');
  expect(f.writes).toHaveLength(2);expect(f.writes[1].body.metadata).toEqual({pinned_at:'2026-10-19T00:00:00Z',markdown:false});
  expect(f.writes[1].query['metadata->>pinned_at']).toBe('eq.2026-10-19T00:00:00Z');
  expect(f.errors).toEqual([]);
 });

 test(`big window with 마크다운 off: one wide text box, letter buttons, the rest ask to turn it on ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  const detail=await openNote(page,'합성 통화 메모');
  await noteMenuAction(page,'data-note-edit');
  await detail.locator('[data-note-big-write]').click();
  const editor=page.locator('#mdEditor'),area=editor.locator('.md-editor-text'),box=editor.locator('[data-md-markdown]');
  await expect(editor).toBeVisible();await expect(box).not.toBeChecked();
  await expect(editor.locator('.md-editor-preview')).toBeHidden();await expect(editor.locator('.md-editor-modes')).toBeHidden();
  await expect(area).toHaveAccessibleName('본문');
  // The text box takes the whole width of the window.
  const [a,e]=await Promise.all([area.boundingBox(),editor.boundingBox()]);expect(e.width-a.width).toBeLessThan(2);
  // The format row stays; letter buttons put their letters in.
  await area.fill('사과');
  await (await openMdTool(editor,'글머리 목록')).click();await expect(area).toHaveValue('- 사과');
  await (await openMdTool(editor,'번호 목록')).click();await expect(area).toHaveValue('1. 사과');
  await (await openMdTool(editor,'체크 목록')).click();await expect(area).toHaveValue('☐ 사과');
  await (await openMdTool(editor,'구분선')).click();await expect(area).toHaveValue('☐ 사과\n\n────\n');
  // 굵게 needs markdown: it asks first. [그대로 두기] changes nothing.
  const ask=page.locator('#mdMarkdownSheet');
  await area.fill('굵은 말');await area.selectText();
  await editor.getByRole('button',{name:'굵게',exact:true}).click();
  await expect(ask).toHaveAttribute('open','');await expect(ask.locator('h2')).toHaveText('마크다운을 켤까요?');
  await ask.getByRole('button',{name:'그대로 두기',exact:true}).click();
  await expect(area).toHaveValue('굵은 말');await expect(box).not.toBeChecked();await expect(area).toBeFocused();
  // [마크다운 켜고 적용] turns it on and applies the button.
  await editor.getByRole('button',{name:'제목 단계 고르기'}).click();
  await expect(ask).toHaveAttribute('open','');
  await ask.getByRole('button',{name:'마크다운 켜고 적용',exact:true}).click();
  await expect(box).toBeChecked();
  // MD-서식줄묶음: the 제목 choices open under the button on a phone, as a row under the format row when wider.
  const headings=width<761?editor.getByRole('group',{name:'제목 단계 고르기'}):editor.locator('.md-editor-menu');await expect(headings).toBeVisible();
  await headings.getByRole('button',{name:'제목 2'}).click();
  await expect(area).toHaveValue('## 굵은 말');await expect(area).toHaveAccessibleName('마크다운 원문');
  if(width>=1024)await expect(editor.locator('.md-editor-preview h2')).toHaveText('굵은 말');
  else await expect(editor.locator('.md-editor-modes')).toBeVisible();
  // The edit form's box follows the window.
  await expect(detail.locator('[data-note-markdown]')).toBeChecked();
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
 });

 test(`big window save keeps the window, says 저장했어요; ✕ asks only with changes not saved ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  const detail=await openNote(page,'합성 통화 메모');
  await noteMenuAction(page,'data-note-edit');
  await detail.locator('[data-note-big-write]').click();
  const editor=page.locator('#mdEditor'),area=editor.locator('.md-editor-text'),status=editor.locator('.md-editor-status'),ask=page.locator('#mdCloseSheet');
  await area.fill('첫 저장 본문');
  await editor.locator('[data-md-save-icon]').click();
  await expect(status).toHaveText('저장했어요');await expect(editor).toBeVisible();await expect(area).toHaveValue('첫 저장 본문');
  expect(f.writes).toHaveLength(1);expect(f.writes[0].body).toMatchObject({raw_text:'첫 저장 본문',metadata:{pinned_at:'2026-10-19T00:00:00Z',markdown:false}});
  // Typing after the save clears the message; ✕ now asks once.
  await area.fill('첫 저장 본문\n더 쓴 줄');await expect(status).toBeHidden();
  await editor.locator('[data-close="mdEditor"]').click();
  await expect(ask).toHaveAttribute('open','');
  await ask.getByRole('button',{name:'계속 쓰기',exact:true}).click();
  await expect(editor).toBeVisible();await expect(area).toHaveValue('첫 저장 본문\n더 쓴 줄');
  // Escape asks the same way.
  await area.focus();await page.keyboard.press('Escape');
  await expect(ask).toHaveAttribute('open','');await page.keyboard.press('Escape');
  await expect(ask).not.toHaveAttribute('open','');await expect(editor).toBeVisible();
  // Saved again: ✕ closes at once and the note shows its read view.
  await editor.locator('[data-md-save-icon]').click();await expect(status).toHaveText('저장했어요');
  expect(f.writes).toHaveLength(2);expect(f.writes[1].body.raw_text).toBe('첫 저장 본문\n더 쓴 줄');
  expect(f.writes[1].body.metadata).toBeUndefined(); // the box is stored now: a plain text PATCH as before
  await editor.locator('[data-close="mdEditor"]').click();
  await expect(page.locator('#mdEditor')).toHaveCount(0);await expect(page.locator('#mdCloseSheet[open]')).toHaveCount(0);
  await expect(detail.locator('[data-note-editor]')).toBeHidden();
  await expect(detail.locator('[data-basket-read-text]')).toHaveText('첫 저장 본문\n더 쓴 줄');
  expect(f.errors).toEqual([]);
 });

 test(`a new note starts with 마크다운 off and reads as written ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await chooseBasketKind(page,'note');
  await page.locator('[data-note-list] [data-quick-big]').click();
  const editor=page.locator('#mdEditor'),box=editor.locator('[data-md-markdown]');
  await expect(box).toBeVisible();await expect(box).not.toBeChecked();await expect(editor.locator('.md-editor-preview')).toBeHidden();
  // [업데이트] is always markdown: the box hides there.
  await editor.locator('[data-md-kind="update"]').click();await expect(box).toBeHidden();
  await editor.locator('[data-md-kind="note"]').click();await expect(box).toBeVisible();
  await editor.locator('[data-md-title]').fill('합성 새 노트');
  await editor.locator('.md-editor-text').fill('1. 하나\n2026. 10. 21. 일정');
  await editor.locator('[data-md-save-icon]').click();
  await expect(page.locator('#mdEditor')).toHaveCount(0);
  expect(f.writes).toEqual([{method:'POST',body:{workspace_id:'w',kind:'note',title:'합성 새 노트',raw_text:'1. 하나\n2026. 10. 21. 일정',metadata:{markdown:false}}}]);
  const body=page.locator('[data-note-detail] [data-basket-read-text]');
  await expect(body).toHaveText('1. 하나\n2026. 10. 21. 일정');await expect(body.locator('ol,li')).toHaveCount(0);
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
