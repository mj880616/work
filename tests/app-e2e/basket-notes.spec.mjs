import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { noteAction } from './helpers/basket-more.mjs';
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
 const notesApi=async r=>{
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
   const body=req.postDataJSON(),now=new Date().toISOString();writes.push({method:'POST',query:Object.fromEntries(q),body});
   if(body.kind==='note'&&!String(body.title||'').trim())return r.fulfill({status:400,json:{code:'23514'}});
   const row={id:'n-created',title:null,occurred_at:now,created_at:now,updated_at:now,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},...body};
   rows.push(row);return r.fulfill({status:201,json:[row]});
  }
  return r.fulfill({status:500,json:{}});
 };
 // A new note POSTs to the bare path; reads and PATCHes carry filters.
 await page.route(SB+'/rest/v1/app_notes?**',notesApi);await page.route(SB+'/rest/v1/app_notes',notesApi);
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
  for(const label of ['고치기','텔레그램용 복사','연결하기'])await expect(detail.getByRole('button',{name:label,exact:true})).toBeVisible();
  await detail.getByRole('button',{name:'고치기',exact:true}).click();
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

// MEMO-노트 후속: [+] on the [노트] list writes a new kind=note row through the same owner-RLS POST.
for(const width of [390,1280]){
 test(`[+] writes a new note, opens it and lists it first, never in the memo list ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await page.locator('[data-basket-kind="note"]').click();
  await expect(noteList(page)).toHaveCount(2);
  const add=page.locator('#newNoteDocBtn');
  await expect(add).toBeVisible();await expect(add).toHaveAccessibleName('노트 추가');
  const box=await add.boundingBox();
  if(width===390){
   // The same round [+] as the other tabs: fixed at the bottom right, 36px circle.
   expect(await add.evaluate(el=>getComputedStyle(el).position)).toBe('fixed');
   expect(Math.round(box.width)).toBe(36);expect(Math.round(box.height)).toBe(36);
   expect(box.x+box.width).toBeGreaterThan(width-60);
  } else await expect(add).toHaveText('+ 노트');
  await add.click();
  const detail=page.locator('[data-note-detail]');
  await expect(page.locator('[data-note-list]')).toBeHidden();await expect(page.locator('[data-basket-kind-switch]')).toBeHidden();
  await expect(detail.locator('[data-note-title-input]')).toBeFocused();await expect(detail.locator('[data-note-title-input]')).toHaveValue('');
  await expect(detail.locator('[data-basket-text]')).toHaveValue('');
  for(const hidden of ['[data-note-read]','[data-note-read-actions]','[data-note-more-wrap]'])await expect(detail.locator(hidden)).toBeHidden();
  await expect(detail.getByRole('button',{name:'큰 창에서 수정',exact:true})).toBeVisible();
  await detail.locator('[data-note-title-input]').fill('새로 쓴 노트');
  await detail.locator('[data-basket-text]').fill('## 할 말\n\n- 첫째');
  await detail.locator('[data-note-save]').click();
  await expect(detail.locator('[data-basket-status]')).toHaveText('노트를 저장했습니다.');
  await expect(detail.locator('[data-note-read-title]')).toHaveText('새로 쓴 노트');
  await expect(detail.locator('[data-basket-read-text] h2')).toHaveText('할 말');
  await expect(detail.locator('[data-note-read-actions]')).toBeVisible();
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]).toMatchObject({method:'POST',body:{workspace_id:'w',kind:'note',title:'새로 쓴 노트',raw_text:'## 할 말\n\n- 첫째'}});
  await detail.locator('[data-note-close]').click();
  await expect(noteList(page)).toHaveCount(3);await expect(noteList(page).nth(0)).toContainText('새로 쓴 노트');
  await page.locator('[data-basket-kind="memo"]').click();
  await expect(page.locator('[data-basket-row="m1"]')).toBeVisible();
  await expect(page.locator('[data-basket-row="n-created"]')).toHaveCount(0);
  await expect(page.locator('[data-basket-list]')).not.toContainText('새로 쓴 노트');
  expect(f.writes).toHaveLength(1);expect(f.errors).toEqual([]);
 });
}

test('an empty new note is not saved; a body-only note takes its first line as title',async({page})=>{
 await page.setViewportSize({width:390,height:900});const f=await fixture(page);
 await page.locator('[data-basket-kind="note"]').click();await expect(noteList(page)).toHaveCount(2);
 await page.locator('#newNoteDocBtn').click();
 const detail=page.locator('[data-note-detail]');
 await detail.locator('[data-note-title-input]').fill('   ');await detail.locator('[data-basket-text]').fill('  \n ');
 await detail.locator('[data-note-save]').click();
 await expect(detail.locator('[data-basket-status]')).toHaveText('제목이나 본문을 써 주세요.');
 expect(f.writes).toEqual([]);
 await detail.locator('[data-note-title-input]').fill('');await detail.locator('[data-basket-text]').fill('\n  본문 첫 줄  \n둘째 줄');
 await detail.locator('[data-note-save]').click();
 await expect(detail.locator('[data-note-read-title]')).toHaveText('본문 첫 줄');
 expect(f.writes).toHaveLength(1);expect(f.writes[0].body).toMatchObject({kind:'note',title:'본문 첫 줄',raw_text:'\n  본문 첫 줄  \n둘째 줄'});
 expect(f.errors).toEqual([]);
});

test('leaving an unsaved new note asks first; Back closes it, an untouched one closes without asking',async({page})=>{
 await page.setViewportSize({width:390,height:900});const f=await fixture(page);
 await page.locator('[data-basket-kind="note"]').click();await expect(noteList(page)).toHaveCount(2);
 const detail=page.locator('[data-note-detail]'),asked=[];
 let answer=false;page.on('dialog',d=>{asked.push(d.message());answer?d.accept():d.dismiss();});
 // Untouched: closes at once and focus returns to [+].
 await page.locator('#newNoteDocBtn').click();
 await detail.locator('[data-note-cancel]').click();
 await expect(page.locator('[data-note-list]')).toBeVisible();await expect(page.locator('#newNoteDocBtn')).toBeFocused();
 expect(asked).toEqual([]);
 await page.locator('#newNoteDocBtn').click();
 await detail.locator('[data-basket-text]').fill('쓰는 중');
 await page.goBack();
 await expect.poll(()=>asked.length).toBe(1);expect(asked[0]).toBe('저장 안 하고 닫을까요?');
 await expect(detail.locator('[data-basket-text]')).toHaveValue('쓰는 중');
 await page.keyboard.press('Escape');
 await expect.poll(()=>asked.length).toBe(2);await expect(detail.locator('[data-basket-text]')).toHaveValue('쓰는 중');
 answer=true;await page.goBack();
 await expect(page.locator('[data-note-list]')).toBeVisible();await expect(noteList(page)).toHaveCount(2);
 expect(asked).toEqual(['저장 안 하고 닫을까요?','저장 안 하고 닫을까요?','저장 안 하고 닫을까요?']);
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});
