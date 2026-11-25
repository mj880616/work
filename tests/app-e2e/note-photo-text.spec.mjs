import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { basketKindButton, openKindMenu } from './helpers/basket-kind.mjs';
import { noteMenuAction } from './helpers/note-menu.mjs';
import { edCmd } from './helpers/ed-tools.mjs';
// S69-98 NOTE-에버노트 ④(명진 11/25 "좋아 모두 다 넣어!"): 노트에 넣은 사진도 업데이트 사진처럼 글자를 읽어(basket-files OCR) 검색에 걸리게 한다.
// - 사진은 올라가자마자 글 안에 보인다(글자 읽기를 기다리지 않음). 읽기는 그 뒤에 따로, 새로 올라간 사진만 한 번.
// - 읽은 글자가 저장되면 노트를 다시 읽어, 열린 고치기는 그 판을 기준으로 저장한다(거절되지 않음).
// 글자 읽기 모듈(basket-ocr.js)은 흉내(실제 서버 계약은 tests/security/basket-ocr.test.mjs). 합성 데이터, 390·1280.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const at='2026-10-22T01:00:00Z', OCR_AT='2026-10-22T06:00:00Z';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const fakeOcr=`export const BASKET_OCR_ENABLED=true;
export function createBasketOcr(){
 const calls=window.noteOcrCalls=[];
 return {get state(){return {enabled:true,busy:false,capabilities:null,snapshot:null,outcome:null};},
  capabilities:async()=>{calls.push(['capabilities']);return {ok:true};},
  status:async()=>({ok:false,code:'OCR_UNSUPPORTED'}),reconcile:async()=>({ok:false}),cleanup:async()=>({ok:false}),
  read:async(id,file)=>{calls.push(['read',id,file]);const r=await fetch('${SB}/functions/v1/basket-files',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'ocr-read',note_id:id,drive_file_id:file})});const j=await r.json();
   return {ok:true,note_id:id,drive_file_id:file,updated_at:j.updated_at,attachment:j.attachment};}};
}`;
async function fixture(page,width){
 await page.setViewportSize({width,height:900});
 await page.route('**/app/basket-ocr.js*',r=>r.fulfill({contentType:'text/javascript',body:fakeOcr}));
 const notes=[{id:'n-text',workspace_id:'w',kind:'note',title:'사진 노트',raw_text:'본문 첫 줄',occurred_at:at,created_at:at,updated_at:'2026-10-22T02:00:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},doc:null}];
 const writes=[],uploads=[],reads=[],errors=[];let stamp=10,release=null;const held=new Promise(r=>{release=r;});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
 await openHome(page);
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams,method=req.method();
  const pick=row=>(!q.get('kind')||'eq.'+row.kind===q.get('kind'))&&(!q.get('id')||'eq.'+row.id===q.get('id'))&&(!q.get('updated_at')||'eq.'+row.updated_at===q.get('updated_at'));
  if(method==='GET'){if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:notes.filter(pick).slice(Number(q.get('offset')||0)).map(x=>structuredClone(x))});}
  if(method==='PATCH'){const body=req.postDataJSON();writes.push({query:Object.fromEntries(q),body});const hit=notes.filter(pick);for(const row of hit)Object.assign(row,body);return r.fulfill({json:hit.map(x=>structuredClone(x))});}
  return r.fulfill({status:500,json:{}});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',r=>new URL(r.request().url()).searchParams.has('note_id')?r.fulfill({json:[]}):r.fallback());
 await page.route(SB+'/functions/v1/basket-files**',async r=>{
  const req=r.request(),url=new URL(req.url());
  if(url.searchParams.get('action')==='photo')return r.fulfill({status:200,headers:{'content-type':'image/png'},body:PNG});
  if((req.headers()['content-type']||'').includes('application/json')){
   const b=req.postDataJSON();reads.push(b);await held;
   const row=notes.find(n=>n.id===b.note_id),i=row.attachments.findIndex(a=>a.drive_file_id===b.drive_file_id);
   row.attachments[i]={...row.attachments[i],ocr:{state:'done',text:'현장 안내판 글자',original_file_id:b.drive_file_id,attempt_id:'22222222-2222-4222-8222-222222222222',temp_document_id:'temp_1',cleanup_state:'deleted'}};
   row.updated_at=OCR_AT;
   return r.fulfill({json:{updated_at:row.updated_at,attachment:row.attachments[i]}});
  }
  const raw=req.postDataBuffer()?.toString('latin1')||'';
  const noteId=raw.match(/name="note_id"\r\n\r\n([^\r]+)/)?.[1],name=Buffer.from(raw.match(/filename="([^"]*)"/)?.[1]||'','latin1').toString('utf8');
  uploads.push({noteId,name});
  const row=notes.find(n=>n.id===noteId);
  row.attachments=[...row.attachments,{drive_file_id:'photo_'+uploads.length,file_name:name,mime_type:'image/png',size_bytes:PNG.length}];
  row.updated_at=`2026-10-22T05:00:${String(stamp++).padStart(2,'0')}Z`;
  return r.fulfill({json:{ok:true,note_id:row.id,attachments:row.attachments}});
 });
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await openKindMenu(page,'note');const kind=basketKindButton(page,'note');await expect(kind).toBeVisible();await kind.click();
 await expect(page.locator('[data-note-row="n-text"]')).toBeVisible();
 return {notes,writes,uploads,reads,errors,release};
}
for(const width of [390,1280]){
 test(`노트 사진 글자 읽기: 사진은 바로 보이고, 글자는 뒤에서 읽어 노트에 저장, 열린 고치기는 새 판으로 저장 ${width}`,async({page})=>{
  const f=await fixture(page,width);
  await page.locator('[data-note-row="n-text"]').click();
  await noteMenuAction(page,'data-note-edit',{width});
  const box=page.locator('[data-note-detail] [data-note-body-field]'),field=box.locator('.ProseMirror');
  await expect(field).toBeVisible();
  await field.click();await page.keyboard.press('Control+End');
  const chooser=page.waitForEvent('filechooser');
  await edCmd(box,'photo');
  await (await chooser).setFiles([{name:'현장.png',mimeType:'image/png',buffer:PNG}]);
  // 글자 읽기가 아직 끝나지 않았어도(서버가 잡고 있음) 사진은 글 안에 바로 들어간다.
  await expect(field.locator('img.ed-photo-img')).toHaveCount(1);
  expect(f.uploads).toEqual([{noteId:'n-text',name:'현장.png'}]);
  await expect.poll(()=>f.reads.length).toBe(1);
  expect(f.reads[0]).toMatchObject({action:'ocr-read',note_id:'n-text',drive_file_id:'photo_1'});
  expect(f.notes[0].attachments[0].ocr).toBeUndefined();
  // 읽기가 끝나면 노트에 글자가 저장되고(판이 바뀜), 화면이 노트를 다시 읽는다.
  f.release();
  await expect.poll(()=>f.notes[0].attachments[0].ocr?.text).toBe('현장 안내판 글자');
  await expect.poll(()=>page.evaluate(()=>(window.noteOcrCalls||[]).filter(c=>c[0]==='read').length)).toBe(1);
  await page.waitForTimeout(300);
  // 열린 고치기의 저장은 거절되지 않고, 글자를 읽은 판(OCR_AT)을 기준으로 한다.
  await page.locator('[data-note-detail] [data-note-save]').click();
  await expect(page.locator('#toast')).toContainText('노트를 저장했습니다.');
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0].query.updated_at).toBe('eq.'+OCR_AT);
  expect(JSON.stringify(f.writes[0].body.doc)).toContain('"src":"drive:photo_1"');
  // 같은 사진은 다시 읽지 않는다.
  await page.waitForTimeout(300);
  expect(f.reads).toHaveLength(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(f.errors).toEqual([]);
 });
}
