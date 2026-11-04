import { test, expect } from '@playwright/test';
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

// S49-35 (요청함 11/04 14:48): 버튼에 Ctrl+↵가 적힌 서식 편집 화면은 본문에 커서가 있어도 Ctrl+Enter(Mac ⌘+Enter) = [저장].
// 원인: 서식 편집기가 쓰지 않는 Enter를 먼저 막아(preventDefault) 공용 엔터 저장 규칙(app/enter-save.js)이 '이미 쓰인 키'로 건너뛰었다.
// 서식 편집기는 공용 규칙이 캡처 단계에서 먼저 읽는다. 저장 요청은 한 번, Enter·Shift+Enter는 줄바꿈, 한글 조합 중에는 저장 안 함.
const composingCtrlEnter=loc=>loc.evaluate(el=>{const e=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,cancelable:true,composed:true,isComposing:true,ctrlKey:true});Object.defineProperty(e,'keyCode',{get:()=>229});el.dispatchEvent(e);});
for(const width of [1440,412]){
 test(`노트 편집: 본문 Ctrl+Enter = 저장 한 번, Enter·조합 중은 저장 안 함 ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  const detail=await openNote(page,'합성 쟁점 정리');
  await noteMenuAction(page,'data-note-edit');
  const field=noteField(page);await field.locator('li').click();await page.keyboard.press('End');await page.keyboard.insertText(' 요구');
  await page.keyboard.press('Enter');await page.keyboard.press('Shift+Enter');
  await composingCtrlEnter(field);await page.waitForTimeout(300);expect(f.writes).toEqual([]);
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('#toast')).toContainText('노트를 저장했습니다.');
  expect(f.writes).toHaveLength(1);expect(f.writes[0].body.raw_text).toContain('기본급 인상 요구');
  expect(f.errors).toEqual([]);
 });
 test(`노트 편집: 큰 창에서 수정에서도 본문 Ctrl+Enter = 저장 ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});const f=await fixture(page);
  await openNote(page,'합성 쟁점 정리');
  await noteMenuAction(page,'data-note-edit');
  await expect(noteField(page)).toBeVisible();await page.locator('[data-note-detail] [data-note-big-write]').click();
  await expect(edWin(page)).toBeVisible();
  const box=edWinText(page);await box.click();await page.keyboard.press('Control+End');await page.keyboard.insertText(' 큰창');
  await page.keyboard.press('Control+Enter');
  await expect.poll(()=>f.writes.length).toBe(1);
  expect(f.writes[0].body.raw_text).toContain('큰창');
  expect(f.errors).toEqual([]);
 });
}
