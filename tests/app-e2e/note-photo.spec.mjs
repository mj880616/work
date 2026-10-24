import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { basketKindButton } from './helpers/basket-kind.mjs';
import { noteMenuAction } from './helpers/note-menu.mjs';
// ED③ 노트: 사진 넣기 in a note (the same [사진] button as share pages). The picture goes up as one of the note's attachments through the
// note's own basket-files upload (Drive "노트 첨부", owner only), is put in the text as drive:<file id>, and is shown through the owner-only
// photo view (basket-files?action=photo). No other address is used; the saved form keeps only the id. 합성 데이터, 390·1280.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const at='2026-10-22T01:00:00Z';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
async function fixture(page,width,doc=null){
 await page.setViewportSize({width,height:900});
 const notes=[{id:'n-text',workspace_id:'w',kind:'note',title:'사진 노트',raw_text:'본문 첫 줄',occurred_at:at,created_at:at,updated_at:'2026-10-22T02:00:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},doc:null}];
 if(doc){notes[0].doc=doc.doc;notes[0].raw_text=doc.raw_text;}
 const writes=[],uploads=[],photos=[],errors=[];let stamp=10;
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
 await page.route(SB+'/functions/v1/basket-files**',r=>{
  const url=new URL(r.request().url());
  if(url.searchParams.get('action')==='photo'){photos.push(Object.fromEntries(url.searchParams));return r.fulfill({status:200,headers:{'content-type':'image/png'},body:PNG});}
  const raw=r.request().postDataBuffer()?.toString('latin1')||'';
  const noteId=raw.match(/name="note_id"\r\n\r\n([^\r]+)/)?.[1],name=raw.match(/filename="([^"]*)"/)?.[1];
  const shown=Buffer.from(name||'','latin1').toString('utf8');uploads.push({noteId,name:shown});
  const row=notes.find(n=>n.id===noteId);
  row.attachments=[...row.attachments,{drive_file_id:'photo_'+uploads.length,file_name:shown,mime_type:'image/png',size_bytes:PNG.length}];
  row.updated_at=`2026-10-22T05:00:${String(stamp++).padStart(2,'0')}Z`;
  return r.fulfill({json:{ok:true,note_id:row.id,attachments:row.attachments}});
 });
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 const kind=basketKindButton(page,'note');await expect(kind).toBeVisible();await kind.click();
 await expect(page.locator('[data-note-row="n-text"]')).toBeVisible();
 return {notes,writes,uploads,photos,errors};
}
for(const width of [390,1280]){
 test(`사진 넣기: the photo goes up as the note's attachment, drive:<id> in the text, shown through the owner-only view ${width}`,async({page})=>{
  const f=await fixture(page,width);
  await page.locator('[data-note-row="n-text"]').click();
  await noteMenuAction(page,'data-note-edit',{width});
  const box=page.locator('[data-note-detail] [data-note-body-field]'),field=box.locator('.ProseMirror');
  await expect(field).toBeVisible();
  await field.click();await page.keyboard.press('Control+End');
  // The [사진] button: on a phone it is in the [넣기 ▾] group.
  if(width<761)await box.locator('[data-ed-cmd="gInsert"]').click();
  const chooser=page.waitForEvent('filechooser');
  await box.locator('[data-ed-cmd="photo"]').click();
  await (await chooser).setFiles([{name:'현장.png',mimeType:'image/png',buffer:PNG}]);
  await expect(field.locator('img.ed-photo-img')).toHaveCount(1);
  expect(f.uploads).toEqual([{noteId:'n-text',name:'현장.png'}]);
  expect(f.photos.every(p=>p.note_id==='n-text'&&p.file_id==='photo_1')).toBe(true);
  // The upload moved the note's version: the save is still this edit's (guarded by the new version, not refused).
  await page.locator('[data-note-detail] [data-note-save]').click();
  await expect(page.locator('#toast')).toContainText('노트를 저장했습니다.');
  expect(f.writes).toHaveLength(1);expect(f.writes[0].query.updated_at).toBe('eq.2026-10-22T05:00:10Z');
  const saved=JSON.stringify(f.writes[0].body.doc);
  expect(saved).toContain('"src":"drive:photo_1"');expect(saved).not.toMatch(/https?:|blob:/);
  expect(f.writes[0].body.raw_text).toBe('본문 첫 줄\n\n[사진]');
  // The read view shows it from the note's own attachment, and the attachment card is there too.
  const read=page.locator('[data-note-detail] [data-basket-read-text]');
  await expect(read.locator('img.ed-photo-img')).toHaveCount(1);
  await expect(page.locator('[data-note-detail] [data-note-attachments] .file-line')).toContainText('현장.png');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(f.errors).toEqual([]);
 });
}
test('a drive: photo that is not one of this note\'s attachments shows as a place and asks for nothing',async({page})=>{
 const f=await fixture(page,1280,{doc:{v:'ed1',doc:{type:'doc',content:[{type:'paragraph',attrs:{style:'body2'},content:[{type:'text',text:'글'}]},{type:'image',attrs:{src:'drive:other_note_file',alt:'남의 사진'}}]}},raw_text:'글\n\n[사진: 남의 사진]'});
 await page.locator('[data-note-row="n-text"]').click();
 const read=page.locator('[data-note-detail] [data-basket-read-text]');
 await expect(read).toHaveAttribute('data-note-view','doc');
 await expect(read.locator('.ed-photo.is-place')).toHaveCount(1);await expect(read.locator('img')).toHaveCount(0);
 expect(f.photos).toEqual([]);expect(f.errors).toEqual([]);
});
