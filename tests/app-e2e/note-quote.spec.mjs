import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { noteMenuAction } from './helpers/note-menu.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { noteField } from './helpers/note-editor.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// NOTE-인용해서쓰기 (standard-interactions.md Q1, 합성 데이터): 노트 수정 중 글을 고르면 [인용] → 인용 블록 + 코멘트 줄. 저장한 뒤 다시 열어도 인용 그대로
// (기존 인용 서식 blockquote 그대로 저장 — 새 저장 형식 없음).
function store(){
 const at='2026-10-20T01:00:00Z';
 return [{id:'n-q',workspace_id:'w',kind:'note',title:'합성 인용 노트',raw_text:'첫 문단은 그대로 둔다\n\n이 문장에 코멘트를 단다\n\n끝 문단',occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}}];
}
async function fixture(page){
 const rows=store(),writes=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await openHome(page);
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams;
  const pick=row=>(!q.get('kind')||'eq.'+row.kind===q.get('kind'))&&(!q.get('id')||'eq.'+row.id===q.get('id'))&&(!q.get('workspace_id')||'eq.'+row.workspace_id===q.get('workspace_id'))&&(!q.get('updated_at')||'eq.'+row.updated_at===q.get('updated_at'));
  if(req.method()==='GET'){if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:rows.filter(pick).slice(Number(q.get('offset')||0))});}
  if(req.method()==='PATCH'){const body=req.postDataJSON();writes.push(body);const hit=rows.filter(pick);for(const row of hit)Object.assign(row,body);return r.fulfill({json:hit.map(x=>structuredClone(x))});}
  return r.fulfill({status:500,json:{}});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',r=>{const q=new URL(r.request().url()).searchParams;if(!q.has('note_id'))return r.fallback();return r.fulfill({json:[]});});
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await chooseBasketKind(page,'note');
 return {rows,writes,errors};
}
const chooseText=(page,word)=>page.evaluate(word=>{
 for(const p of document.querySelectorAll('[data-note-detail] [data-note-body-field] .ProseMirror p')){
  const n=[...p.childNodes].find(c=>c.nodeType===3&&c.data.includes(word));if(!n)continue;
  const i=n.data.indexOf(word),range=document.createRange();range.setStart(n,i);range.setEnd(n,i+word.length);
  const s=getSelection();s.removeAllRanges();s.addRange(range);p.closest('.ProseMirror').dispatchEvent(new KeyboardEvent('keyup',{bubbles:true}));return true;
 }
 throw new Error('없음 '+word);
},word);

for(const width of [1280,412]){
 test.describe(`${width}`,()=>{
 test.use({viewport:{width,height:900},hasTouch:width<761});
 test(`Q1 노트 수정: 글 고르기 → [인용] → 코멘트 → 저장 → 다시 열어도 인용 유지 ${width}`,async({page})=>{
  const f=await fixture(page);
  const row=page.locator('[data-note-host] [data-note-row]').filter({hasText:'합성 인용 노트'});
  if(width<761)await row.tap();else await row.click();
  await noteMenuAction(page,'data-note-edit',{width});
  const field=noteField(page);await expect(field).toBeVisible();
  await field.focus();
  await chooseText(page,'코멘트를 단다');
  const quote=page.locator('[data-note-detail] .ed-qmenu').getByRole('menuitem',{name:'고른 글 인용'});
  await expect(quote).toBeVisible();
  if(width<761)await quote.tap();else await quote.click();
  await expect(field.locator('blockquote.ed-quote')).toHaveText('코멘트를 단다');
  await expect(field).toBeFocused();
  await page.keyboard.insertText('내 생각 한 줄');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#toast')).toContainText('노트를 저장했습니다.');
  expect(f.writes).toHaveLength(1);
  const types=f.writes[0].doc.doc.content.map(n=>n.type);
  expect(types).toEqual(['paragraph','paragraph','blockquote','paragraph','paragraph']);
  expect(f.writes[0].raw_text).toContain('코멘트를 단다');expect(f.writes[0].raw_text).toContain('내 생각 한 줄');
  // 읽기 화면과 다시 [수정]에서 인용 그대로.
  await expect(page.locator('[data-note-detail] blockquote')).toHaveText('코멘트를 단다');
  await noteMenuAction(page,'data-note-edit',{width});
  await expect(noteField(page).locator('blockquote.ed-quote')).toHaveText('코멘트를 단다');
  await expect(noteField(page).locator('blockquote.ed-quote + p')).toHaveText('내 생각 한 줄');
  expect(f.errors).toEqual([]);
 });
 });
}
