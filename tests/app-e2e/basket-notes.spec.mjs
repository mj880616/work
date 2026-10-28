import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import {noteAction} from './helpers/basket-more.mjs';
import { noteMenuAction } from './helpers/note-menu.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { expectNoteTitle } from './helpers/note-title.mjs';
import { noteField, edWin, edWinText, typeInto } from './helpers/note-editor.mjs';
import { closeNote } from './helpers/note-close.mjs';
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
  const pick=row=>(!q.get('kind')||'eq.'+row.kind===q.get('kind'))&&(!q.get('id')||'eq.'+row.id===q.get('id'))&&(!q.get('workspace_id')||'eq.'+row.workspace_id===q.get('workspace_id'))&&(!q.get('updated_at')||'eq.'+row.updated_at===q.get('updated_at'));
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
// BASKET-노트입력창: the note list's own input (the basket update input in its note mode): [크게] and [추가].
const noteInput=page=>page.locator('[data-note-list] [data-quick-input]');
const noteBig=page=>page.locator('[data-note-list] [data-quick-big]');
const noteAdd=page=>page.locator('[data-note-list] [data-quick-save]');

for(const width of [390,1280]){
 test(`[메모 | 노트] switch lists notes by last change with search, no dot and link chip ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  // BASKET-정리함이름: the screen has no [업데이트 | 노트] switch on any width; [노트] is its own menu item.
  await expect(page.locator('#basketView')).toHaveAttribute('data-kind','memo');await expect(page.locator('[data-basket-kind-switch]')).toHaveCount(0);
  await chooseBasketKind(page,'note');
  await expect(page.locator('#basketView')).toHaveAttribute('data-kind','note');await expect(page.locator('[data-basket-list]')).toBeHidden();
  await expect(noteList(page)).toHaveCount(2);
  await expect(noteList(page).nth(0)).toContainText('임금협상 정리');await expect(noteList(page).nth(1)).toContainText('오래된 노트');
  // BASKET-노트입력창: no blue dot before a note title (a pinned note keeps its pin).
  await expect(page.locator('[data-note-host] .note-dot')).toHaveCount(0);
  // NOTE-탐색기 ②: a note row is one line (title + date); link chips are not drawn in the list (the open note still shows them).
  await expect(noteList(page).nth(0)).not.toContainText('합성 임금 프로젝트');
  await expect(page.locator('[data-note-host]')).not.toContainText('회의 준비 메모');
  await page.locator('[data-note-search]').fill('기본급');
  await expect(noteList(page)).toHaveCount(1);await expect(noteList(page)).toContainText('임금협상 정리');
  await page.locator('[data-note-search]').fill('없는 말');
  await expect(noteList(page)).toHaveCount(0);await expect(page.locator('[data-note-list-status]')).toHaveText('찾는 노트가 없어요');
  await chooseBasketKind(page,'memo');
  await expect(page.locator('[data-basket-row="m1"]')).toBeVisible();await expect(page.locator('[data-note-host]')).toBeHidden();
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
 });

 test(`note reads as markdown, edits title and body through the kind=note PATCH ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await chooseBasketKind(page,'note');
  await noteList(page).filter({hasText:'임금협상 정리'}).click();
  const detail=page.locator('[data-note-detail]');
  await expect(page.locator('[data-basket-kind-switch]')).toBeHidden();
  await expectNoteTitle(page,'임금협상 정리');
  await expect(detail.locator('[data-basket-read-text] h2')).toHaveText('쟁점');
  await expect(detail.locator('[data-basket-read-text] strong')).toHaveText('기본급');
  // UI-바구니상세개편: [텔레그램용 복사] became the small [복사] icon beside the title.
  // UI-노트메뉴정리: the head line is ‹ 노트 · 제목 · [복사] · [⋯]; [수정]·[연결하기] are no longer buttons under the body, they are in the ⋯.
  await expect(detail.getByRole('button',{name:'복사',exact:true})).toBeVisible();
  await expect(detail.getByRole('button',{name:'이 노트 메뉴',exact:true})).toBeVisible();
  for(const label of ['수정','연결하기'])await expect(detail.getByRole('button',{name:label,exact:true})).toHaveCount(0);
  await expect(detail.locator('[data-note-read-actions]')).toHaveCount(0);
  await noteMenuAction(page,'data-note-edit');
  await expect(detail.locator('[data-note-title-input]')).toHaveValue('임금협상 정리');
  await detail.locator('[data-note-title-input]').fill('');
  await detail.locator('[data-note-save]').click();
  await expect(detail.locator('[data-basket-status]')).toHaveText('노트 제목을 입력해 주세요.');expect(f.writes).toEqual([]);
  await detail.locator('[data-note-title-input]').fill('임금협상 정리 v2');
  // ED③ 노트: the old markdown note opens in the new editor as format (heading, list); the save writes the letters and the saved form.
  await expect(noteField(page).locator('.ed-h2')).toHaveText('쟁점');
  await expect(noteField(page).locator('li strong')).toHaveText('기본급');
  await typeInto(page,noteField(page),'쟁점\n\n기본급 5% 인상');
  await detail.locator('[data-note-save]').click();
  await expect(page.locator('#toast')).toContainText('노트를 저장했습니다.');
  await expectNoteTitle(page,'임금협상 정리 v2');
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0].query).toMatchObject({id:'eq.n-new',workspace_id:'eq.w',kind:'eq.note',updated_at:'eq.2026-10-16T01:00:00Z'});
  expect(f.writes[0].body).toMatchObject({title:'임금협상 정리 v2',raw_text:'쟁점\n\n기본급 5% 인상'});
  expect(f.writes[0].body.doc.v).toBe('ed1');expect(f.writes[0].body.metadata).toBeUndefined();
  await expect(detail.locator('[data-basket-read-text]')).toHaveAttribute('data-note-view','doc');
  await closeNote(page);
  await expect(page.locator('[data-basket-kind-switch]')).toHaveCount(0);
  await expect(noteList(page).nth(0)).toContainText('임금협상 정리 v2');
  expect(f.errors).toEqual([]);
 });

 test(`basket memo moves to a note with the first line as title, and back to the basket ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await page.locator('[data-basket-row="m1"]').click();
  // UI-바구니상세개편: [노트로 옮기기] is in the card's last row and moves at once, without a title form. The database needs a
  // one-line title on a note, so the first line is saved as the title (as the old form pre-filled it).
  await expect(page.locator('#basketNoteMenu [data-basket-to-note]')).toHaveCount(0);
  await page.locator('[data-basket-read-actions] [data-basket-to-note]').click();
  await expect(page.locator('[data-basket-to-note-form]')).toHaveCount(0);
  await expect(page.locator('#toast')).toHaveText('노트로 옮겼어요.');
  await expect(page.locator('#basketView')).toHaveAttribute('data-kind','note');
  await expectNoteTitle(page,'회의 준비 메모 첫 줄');
  expect(f.writes[0].query).toMatchObject({id:'eq.m1',workspace_id:'eq.w'});expect(f.writes[0].body).toMatchObject({kind:'note',title:'회의 준비 메모 첫 줄'});
  expect(f.rows.find(r=>r.id==='m1').raw_text).toBe('회의 준비 메모 첫 줄\n둘째 줄 내용');
  // Back to the basket from the note menu, after a confirmation.
  // UI-알림창정리(노트): 브라우저 기본 확인창 대신 공용 작은 확인창(small-notice.js askConfirm)에서 [돌리기].
  await page.locator('[data-note-more]').click();await page.locator('#noteDocMenu [data-note-to-basket]').click();
  await page.locator('.kptu-ask button',{hasText:'돌리기'}).click();
  await expect(page.locator('[data-note-list-status]')).toHaveText('정리함으로 돌렸어요.');
  expect(f.writes[1].query).toMatchObject({id:'eq.m1',kind:'eq.note'});expect(f.writes[1].body).toMatchObject({kind:'basket',title:null});
  await expect(noteList(page)).toHaveCount(2);
  await chooseBasketKind(page,'memo');
  await expect(page.locator('[data-basket-row="m1"]')).toBeVisible();
  expect(f.errors).toEqual([]);
 });
}

// BASKET-노트입력창 (2026-10-22): notes are added like updates. The note list has the update input (phone: docked above the
// tabs; PC: at the top). One line + [추가] saves a note titled by that line (마크다운 off) and the list stays; [크게] opens the
// one write window (same as menu [쓰기]) with [노트] chosen on the typed text, which saves, closes and opens the new note.
for(const width of [390,1280]){
 test(`note input: one line + [추가] adds a note titled by that line; no [+ 노트]·⊕ ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await chooseBasketKind(page,'note');
  await expect(noteList(page)).toHaveCount(2);
  await expect(page.locator('#newNoteBtn,[data-note-new]')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'새 노트',exact:true})).toHaveCount(0);
  const input=noteInput(page),add=noteAdd(page),big=noteBig(page);
  await expect(input).toBeVisible();await expect(input).toHaveAttribute('placeholder','노트를 입력하세요');await expect(input).toHaveAccessibleName('노트 입력');
  await expect(big).toBeVisible();await expect(add).toBeVisible();
  // NOTE-파일붙이기: the note input has the update input's clip too (phone: inside the input at its left; PC: [📎 첨부] before [추가]).
  const clip=page.locator('[data-note-list] [data-quick-file-picker] .basket-clip');await expect(clip).toBeVisible();
  const folder=page.locator('[data-note-list] [data-quick-folder]');await expect(folder).toBeVisible();
  const [ib,bb,ab,cb,fb]=await Promise.all([input.boundingBox(),big.boundingBox(),add.boundingBox(),clip.boundingBox(),folder.boundingBox()]);
  // [크게] sits at the right end of the input, right before [추가] (on a PC with the clip between them); one row.
  expect(bb.x+bb.width).toBeLessThanOrEqual(ab.x+1);expect(Math.abs((bb.y+bb.height/2)-(ib.y+Math.min(ib.height,46)/2))).toBeLessThan(24);
  if(width<=760){expect(ab.x-(bb.x+bb.width)).toBeLessThan(16);expect(cb.x+cb.width).toBeLessThanOrEqual(bb.x);
   // Phone: [폴더 ▾] is a small row of its own right above the input, left-aligned, not overlapping it.
   expect(fb.y+fb.height).toBeLessThanOrEqual(ib.y+1);expect(ib.y-(fb.y+fb.height)).toBeLessThan(16);expect(Math.abs(fb.x-ib.x)).toBeLessThan(2);}
  else{
   // PC row: input ([크게] at its end) → [폴더 ▾] → [📎 첨부] → [추가], in that order, each gap small (8px by design; < 16).
   expect(fb.x).toBeGreaterThanOrEqual(bb.x+bb.width-1);expect(cb.x).toBeGreaterThanOrEqual(fb.x+fb.width-1);expect(ab.x).toBeGreaterThanOrEqual(cb.x+cb.width-1);
   for(const gap of [fb.x-(bb.x+bb.width),cb.x-(fb.x+fb.width),ab.x-(cb.x+cb.width)]){expect(gap).toBeGreaterThanOrEqual(-1);expect(gap).toBeLessThan(16);}
   expect(fb.height).toBeLessThanOrEqual(36);expect(Math.abs((fb.y+fb.height/2)-(ab.y+ab.height/2))).toBeLessThan(8);
  }
  const listTop=(await noteList(page).nth(0).boundingBox()).y;
  if(width<=760){
   // Phone: docked above the bottom tabs, like the update input.
   const dock=await page.locator('[data-note-list] [data-home-quick]').evaluate(el=>({position:getComputedStyle(el).position,bottom:el.getBoundingClientRect().bottom}));
   expect(dock.position).toBe('fixed');
   const tabsBox=await page.locator('.mobile-tabs').boundingBox();expect(dock.bottom).toBeLessThanOrEqual(tabsBox.y+1);
  }else{
   // PC: the top row of the note list, above the notes (like the update input).
   expect(ib.y).toBeLessThan(listTop);
  }
  // Empty → a small hint, nothing saved.
  await add.click();await expect(page.locator('[data-note-list] [data-quick-hint]')).toHaveText('글을 입력해 주세요.');expect(f.writes).toEqual([]);
  await input.fill('교섭 준비 메모');
  await add.click();
  await expect(page.locator('#toast')).toContainText('노트를 추가했습니다.');
  expect(f.writes).toEqual([{method:'POST',body:{workspace_id:'w',kind:'note',title:'교섭 준비 메모',raw_text:'교섭 준비 메모',metadata:{markdown:false}}}]);
  await expect(input).toHaveValue('');
  await expect(noteList(page)).toHaveCount(3);await expect(noteList(page).filter({hasText:'교섭 준비 메모'})).toHaveCount(1);
  await expect(page.locator('[data-note-detail]')).toBeHidden();
  // Several lines: the first line is the title, the whole text is the body.
  await input.fill('둘째 노트 제목\n본문 둘째 줄');await add.click();
  await expect(page.locator('#toast')).toContainText('노트를 추가했습니다.');
  expect(f.writes[1].body).toMatchObject({kind:'note',title:'둘째 노트 제목',raw_text:'둘째 노트 제목\n본문 둘째 줄',metadata:{markdown:false}});
  await chooseBasketKind(page,'memo');
  await expect(page.locator('[data-basket-row="m1"]')).toBeVisible();await expect(page.locator('[data-basket-rows]')).not.toContainText('교섭 준비 메모');
  expect(f.errors).toEqual([]);
 });

 test(`[크게] on the note input writes a new note in the write window: kind=note, read view, top of the list ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await chooseBasketKind(page,'note');
  await expect(noteList(page)).toHaveCount(2);
  await noteInput(page).fill('단체교섭 준비');
  await noteBig(page).click();
  // ED③ 노트: the note's new big window (no [업데이트|노트] switch, no [마크다운] box); the line shortcuts make the format.
  const detail=page.locator('[data-note-detail]'),editor=edWin(page);
  await expect(editor).toBeVisible();await expect(editor).toHaveAccessibleName('새 노트');
  await expect(editor.locator('[data-edw-title]')).toBeVisible();await expect(editor.locator('[data-edw-title]')).toHaveValue('');await expect(edWinText(page)).toHaveText('단체교섭 준비');
  await expect(editor.locator('[data-edw-save]')).toHaveAccessibleName('새 노트로 저장');
  await editor.locator('[data-edw-title]').fill('단체교섭 준비');
  await edWinText(page).click();await page.keyboard.press('Control+A');await page.keyboard.press('Backspace');
  await page.keyboard.type('## 할 일');await page.keyboard.press('Enter');await page.keyboard.type('- 요구안 정리');
  await expect(edWinText(page).locator('.ed-h2')).toHaveText('할 일');await expect(edWinText(page).locator('ul li')).toHaveText('요구안 정리');
  await editor.locator('[data-edw-save]').click();
  await expect(edWin(page)).toHaveCount(0);await expect(page.locator('#toast')).toContainText('노트로 저장했어요.');
  await expectNoteTitle(page,'단체교섭 준비');
  await expect(detail.locator('[data-basket-read-text] .ed-h2')).toHaveText('할 일');
  await expect(detail.locator('[data-note-more]')).toBeVisible();await expect(detail.locator('[data-note-read-actions]')).toHaveCount(0);
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]).toMatchObject({method:'POST',body:{workspace_id:'w',kind:'note',title:'단체교섭 준비',raw_text:'할 일\n\n- 요구안 정리',metadata:{markdown:false}}});
  expect(f.writes[0].body.doc.doc.content.map(n=>n.type)).toEqual(['heading','bullet_list','paragraph']);
  await closeNote(page);
  await expect(noteList(page)).toHaveCount(3);
  await expect(noteList(page).nth(0)).toContainText('단체교섭 준비');
  await expect(noteInput(page)).toHaveValue('');
  await chooseBasketKind(page,'memo');
  await expect(page.locator('[data-basket-row="m1"]')).toBeVisible();
  await expect(page.locator('[data-basket-rows]')).not.toContainText('단체교섭 준비');
  await expect(page.locator('[data-basket-row="n-created"]')).toHaveCount(0);
  expect(f.errors).toEqual([]);
 });
}

test('an empty new note is not saved; a body-only note takes its first line as title',async({page})=>{
 await page.setViewportSize({width:390,height:900});const f=await fixture(page);
 await chooseBasketKind(page,'note');
 await noteBig(page).click();
 const detail=page.locator('[data-note-detail]'),editor=edWin(page);
 await editor.locator('[data-edw-title]').fill('   ');await typeInto(page,edWinText(page),'  ');
 await editor.locator('[data-edw-save]').click();
 await expect(editor.locator('.ed-window-status')).toHaveText('제목이나 본문을 써 주세요.');
 expect(f.writes).toEqual([]);
 await editor.locator('[data-edw-title]').fill('');await typeInto(page,edWinText(page),'첫 줄 메모\n둘째 줄');
 await editor.locator('[data-edw-save]').click();
 await expectNoteTitle(page,'첫 줄 메모');
 expect(f.writes).toHaveLength(1);expect(f.writes[0].body).toMatchObject({kind:'note',title:'첫 줄 메모',raw_text:'첫 줄 메모\n둘째 줄'});
 expect(f.errors).toEqual([]);
});

test('phone back closes the new-note window and hands its text back to the note input; a bottom tab with text asks before leaving',async({page})=>{
 await page.setViewportSize({width:390,height:900});const f=await fixture(page);
 await chooseBasketKind(page,'note');
 const add=noteBig(page),editor=edWin(page);
 await add.click();await expect(editor).toBeVisible();
 await page.goBack();
 await expect(edWin(page)).toHaveCount(0);await expect(page.locator('[data-note-list]')).toBeVisible();await expect(noteInput(page)).toBeFocused();
 await add.click();
 await typeInto(page,edWinText(page),'쓰던 글');
 await page.locator('.mobile-tabs [data-view="meetings"]').click();
 const leave=page.locator('#edwCloseSheet');await expect(leave).toHaveAttribute('open','');
 await leave.getByRole('button',{name:'계속 쓰기',exact:true}).click();
 await expect(edWinText(page)).toHaveText('쓰던 글');
 // Back (or ×) closes without saving; the text goes back into the note input (this tab's memory only).
 await page.goBack();
 await expect(edWin(page)).toHaveCount(0);
 await expect(noteInput(page)).toHaveValue('쓰던 글');
 await add.click();await expect(edWinText(page)).toHaveText('쓰던 글');
 await page.goBack();
 await expect(edWin(page)).toHaveCount(0);
 await expect(page.locator('[data-note-list]')).toBeVisible();await expect(noteList(page)).toHaveCount(2);
 // Closing the new note stays in the basket tab.
 expect(await page.evaluate(()=>window.KPTURouter.current)).toBe('basket');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('a note without body cannot go back to the basket and nothing is written',async({page})=>{
 await page.setViewportSize({width:390,height:900});const f=await fixture(page);
 f.rows.find(r=>r.id==='n-old').raw_text='';
 await chooseBasketKind(page,'note');
 await noteList(page).filter({hasText:'오래된 노트'}).click();
 await expect(page.locator('[data-note-detail] [data-basket-read-text]')).toHaveText('본문이 없는 노트입니다.');
 await page.locator('[data-note-more]').click();await page.locator('#noteDocMenu [data-note-to-basket]').click();
 await page.locator('.kptu-ask button',{hasText:'돌리기'}).click();
 await expect(page.locator('[data-note-detail] [data-basket-status]')).toContainText('정리함으로 돌릴 수 없어요');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('note edit draft is protected when leaving with Escape',async({page})=>{
 await page.setViewportSize({width:1280,height:900});const f=await fixture(page);
 await chooseBasketKind(page,'note');
 await noteList(page).filter({hasText:'오래된 노트'}).click();
 await noteMenuAction(page,'data-note-edit');
 await typeInto(page,noteField(page),'고치는 중');
 let asked=0;page.on('dialog',d=>{asked++;d.dismiss();});
 await page.keyboard.press('Escape');
 expect(asked).toBe(1);await expect(noteField(page)).toHaveText('고치는 중');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

// ED③ 순서 6: the old menu [쓰기] window tests (head order, [업데이트|노트] switch, export sheet) went with the old window; the new window's are in ed-window.spec.mjs and update-window.spec.mjs.
test('the editor opened to change a note has no [업데이트|노트] switch, and the same 32px head',async({page})=>{
 await page.setViewportSize({width:390,height:900});const f=await fixture(page);
 await chooseBasketKind(page,'note');
 await noteList(page).filter({hasText:'오래된 노트'}).click();
 await noteMenuAction(page,'data-note-edit');
 await expect(noteField(page)).toBeVisible();
 await page.locator('[data-note-big-write]').click();
 const editor=edWin(page);await expect(editor).toBeVisible();
 await expect(editor.locator('[data-edw-save]')).toHaveCount(1);
 await expect(editor).toHaveAccessibleName('큰 창에서 수정');await expect(editor.getByRole('button',{name:'내보내기',exact:true})).toBeVisible();
 await expect(editor.getByRole('button',{name:'텔레그램용 복사',exact:true})).toHaveCount(0);
 for(const h of await editor.locator('.ed-window-head > button').evaluateAll(list=>list.map(b=>Math.round(b.getBoundingClientRect().height))))expect(h).toBe(32);
 // The note read view keeps its own copy (UI-바구니상세개편: the small [복사] icon, same 텔레그램 conversion).
 await editor.locator('[data-close="edWindow"]').click();await expect(edWin(page)).toHaveCount(0);await page.locator('[data-note-cancel]').click();
 await expect(page.locator('[data-note-detail]').getByRole('button',{name:'복사',exact:true})).toBeVisible();
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

for(const width of [360,390,412,870,1280]){
 test(`note edit buttons [큰 창에서 수정] ... [취소][저장] sit on one uncut line at ${width}px, 저장 at the right end (UI-저장자리)`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await chooseBasketKind(page,'note');
  await noteList(page).filter({hasText:'오래된 노트'}).click();
  await noteMenuAction(page,'data-note-edit');
  const bar=page.locator('[data-note-edit-actions]');await expect(bar).toBeVisible();
  await expect(noteField(page)).toBeVisible();
  const boxes=[];
  for(const name of ['큰 창에서 수정','취소','저장']){
   const b=bar.getByRole('button',{name,exact:true});await expect(b).toBeVisible();
   // UI-버튼전수조사(2026-10-24): 보이는 높이는 작은 버튼 32px(채운 [저장]은 36px), 누르는 범위(::after)는 44px.
   const m=await b.evaluate(el=>{const r=el.getBoundingClientRect(),a=getComputedStyle(el,'::after');return {top:r.top+r.height/2,left:r.left,right:r.right,height:r.height,touch:a.content==='none'?r.height:Math.max(r.height,parseFloat(a.height)||0,parseFloat(a.minHeight)||0),cut:el.scrollWidth>el.clientWidth+1};});
   expect(m.cut,name).toBe(false);expect(m.height,name).toBe(name==='저장'?36:32);expect(m.touch,name).toBeGreaterThanOrEqual(44);boxes.push(m);
  }
  expect(boxes[1].top).toBe(boxes[0].top);expect(boxes[2].top).toBe(boxes[0].top);
  expect(boxes[0].left).toBeLessThan(boxes[1].left);expect(boxes[1].left).toBeLessThan(boxes[2].left);
  expect(boxes[2].right).toBeLessThanOrEqual(width);
  // UI-저장자리: 저장은 줄 맨 오른쪽, 큰 창에서 수정은 맨 왼쪽(취소·저장 사이에 빈칸).
  const barBox=await bar.boundingBox();expect(barBox.x+barBox.width-boxes[2].right).toBeLessThanOrEqual(4);expect(boxes[0].left-barBox.x).toBeLessThanOrEqual(4);
  await expect(bar.locator('[data-note-save]')).toHaveClass(/primary/);
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
 });
}

// UI-노트편집버튼 ② (BASKET-업데이트통합 PR 2): the big window's one save icon sits right beside [닫기] and runs the opening screen's own [저장] (저장하고 닫기).
// ED③ 노트·업데이트: a note's and an update's big window is the new one (#edWindow, data-edw-save).
const EDW_SAVE='[data-edw-save]';
async function headBox(locator){return locator.evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,height:r.height,after:getComputedStyle(el,'::after').height};});}
// UI-저장자리(2026-10-27): 큰 창의 [저장]은 머리줄 아이콘이 아니라 창 맨 아래 줄 오른쪽 아래, 그 왼쪽에 [취소].
async function expectIconNextToClose(editor,name){
 const icon=editor.locator(EDW_SAVE);await expect(icon).toBeVisible();await expect(icon).toHaveAccessibleName(name);
 const cancel=editor.locator('[data-edw-cancel]');await expect(cancel).toBeVisible();
 const win=await headBox(editor.locator('.ed-window-actions')),save=await headBox(icon),can=await headBox(cancel);
 const card=await editor.evaluate(el=>{const r=el.getBoundingClientRect();return {right:r.right,bottom:r.bottom};});
 expect(card.right-save.right).toBeLessThanOrEqual(16);
 expect(card.bottom-(win.top+win.height)).toBeLessThanOrEqual(2);
 expect(can.right).toBeLessThanOrEqual(save.left);expect(Math.abs(save.top+save.height/2-(can.top+can.height/2))).toBeLessThanOrEqual(1);
}
for(const width of [390,1280]){
 test(`big window save icon saves a note through [저장] and keeps the window open (NOTE-큰창저장유지), also when the save fails ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await chooseBasketKind(page,'note');
  await noteList(page).filter({hasText:'오래된 노트'}).click();
  const detail=page.locator('[data-note-detail]');
  await noteMenuAction(page,'data-note-edit');
  await expect(noteField(page)).toBeVisible();
  await detail.locator('[data-note-big-write]').click();
  const editor=edWin(page);await expect(editor).toBeVisible();
  await expectIconNextToClose(editor,'노트 저장');
  await typeInto(page,edWinText(page),'큰 창에서 고친 본문');
  // A failed save keeps the window, the text and the message.
  let failed=false;
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>{if(r.request().method()==='PATCH'&&!failed){failed=true;return r.fulfill({status:500,json:{}});}return r.fallback();});
  await editor.locator(EDW_SAVE).click();
  await expect(editor.locator('.ed-window-status')).toContainText('저장하지 못했어요');
  await expect(editor).toBeVisible();await expect(edWinText(page)).toHaveText('큰 창에서 고친 본문');
  await expect(editor.locator(EDW_SAVE)).toBeEnabled();expect(f.writes).toEqual([]);
  // The second press goes the same path as [저장]: PATCH, and the window stays with a short 저장했어요.
  await editor.locator(EDW_SAVE).click();
  await expect(editor.locator('.ed-window-status')).toHaveText('저장했어요');
  await expect(editor).toBeVisible();await expect(edWinText(page)).toHaveText('큰 창에서 고친 본문');
  // ✕ right after the save closes without asking, and the note shows its read view with the new text.
  await editor.locator('[data-close="edWindow"]').click();
  await expect(edWin(page)).toHaveCount(0);
  await expect(page.locator('#edwCloseSheet[open]')).toHaveCount(0);
  await expect(detail.locator('[data-basket-read-text]')).toContainText('큰 창에서 고친 본문');
  await expect(detail.locator('[data-note-editor]')).toBeHidden();
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0].query).toMatchObject({id:'eq.n-old',kind:'eq.note'});expect(f.writes[0].body.raw_text).toBe('큰 창에서 고친 본문');
  expect(f.errors.filter(e=>!/500/.test(e))).toEqual([]);
 });

 test(`big window save icon on a new note creates it and returns to its read view ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await chooseBasketKind(page,'note');
  await noteBig(page).click();
  const detail=page.locator('[data-note-detail]');
  // [크게] on the empty note input opens the write window itself (no small form in between).
  const editor=edWin(page);await expect(editor).toBeVisible();await expect(edWinText(page)).toBeVisible();
  await expectIconNextToClose(editor,'새 노트로 저장');
  // Nothing written: the message shows in the window and nothing is sent.
  await editor.locator(EDW_SAVE).click();
  await expect(editor.locator('.ed-window-status')).toContainText('제목이나 본문을 써 주세요.');expect(f.writes).toEqual([]);
  await typeInto(page,edWinText(page),'새 노트 첫 줄\n둘째 줄');
  await editor.locator(EDW_SAVE).click();
  await expect(edWin(page)).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('노트로 저장했어요.');await expectNoteTitle(page,'새 노트 첫 줄');
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
  // ED③ 업데이트: an update's big window is the new one too. Letters and the saved form go in one PATCH that applies only to the version read.
  const editor=edWin(page);await expect(editor).toBeVisible();
  await expectIconNextToClose(editor,'업데이트 저장');
  await typeInto(page,edWinText(page),'큰 창에서 고친 메모');
  await editor.locator(EDW_SAVE).click();
  await expect(edWin(page)).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('수정한 글을 저장했습니다.');
  await expect(detail.locator('[data-basket-read-text]')).toContainText('큰 창에서 고친 메모');
  expect(f.writes).toHaveLength(1);expect(f.writes[0].body).toMatchObject({raw_text:'큰 창에서 고친 메모'});expect(f.writes[0].body.doc).toMatchObject({v:'ed1'});
  expect(f.writes[0].query).toMatchObject({id:'eq.m1',workspace_id:'eq.w',kind:'eq.basket',updated_at:'eq.2026-10-17T01:00:00Z'});
  expect(f.errors).toEqual([]);
 });
}

test('[닫기] in the big window asks once, then hands the text back to the edit field',async({page})=>{
 await page.setViewportSize({width:390,height:900});const f=await fixture(page);
 await chooseBasketKind(page,'note');
 await noteList(page).filter({hasText:'오래된 노트'}).click();
 const detail=page.locator('[data-note-detail]');
 await noteMenuAction(page,'data-note-edit');await expect(noteField(page)).toBeVisible();await detail.locator('[data-note-big-write]').click();
 const editor=edWin(page);await typeInto(page,edWinText(page),'닫아도 남는 글');
 // NOTE-큰창저장유지: changes not saved → ✕ asks once. [계속 쓰기] keeps the window; [저장하지 않고 닫기] closes it.
 const ask=page.locator('#edwCloseSheet');
 await editor.locator('[data-close="edWindow"]').click();
 await expect(ask).toHaveAttribute('open','');await expect(ask.locator('h2')).toHaveText('저장하지 않고 닫을까요?');
 await ask.getByRole('button',{name:'계속 쓰기',exact:true}).click();
 await expect(ask).not.toHaveAttribute('open','');await expect(editor).toBeVisible();
 await editor.locator('[data-close="edWindow"]').click();
 await ask.getByRole('button',{name:'저장하지 않고 닫기',exact:true}).click();
 await expect(edWin(page)).toHaveCount(0);await expect(noteField(page)).toHaveText('닫아도 남는 글');
 page.once('dialog',d=>d.accept());await detail.locator('[data-note-cancel]').click();
 await closeNote(page);
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});
