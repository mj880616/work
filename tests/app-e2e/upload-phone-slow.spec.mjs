import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { basketKindButton, openKindMenu } from './helpers/basket-kind.mjs';
import { noteMenuAction } from './helpers/note-menu.mjs';
// UPLOAD-올리기안됨(S52-13, 요청함 11/07 11:41 ★급★): 폰 크기(412)에서 노트 수정 화면 [넣기] → [사진]·[파일], 일기 사진을
// 큰 사진(수 MB)·느린 서버(보내고 답을 받기까지 불러오기 기본 한도 15초보다 오래)로 올려도 끊기지 않고 들어간다.
// 올리기는 불러오기 한도가 아니라 크기에 맞춘 공용 올리기 한도(app/upload-budget.mjs)를 쓴다. 합성 데이터만.
test.use({hasTouch:true, isMobile:true, viewport:{width:412, height:915}});
test.setTimeout(120000);
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const at='2026-10-22T01:00:00Z';
const SLOW_MS=17000; // 불러오기 기본 한도(15초)를 넘는다.
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
// 큰 사진 대신: JPEG 머리 + 6MB 채움(서버 흉내는 내용을 읽지 않는다).
const bigJpeg=()=>Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(6*1048576,7),Buffer.from([0xff,0xd9])]);
const multipart=req=>{
 const raw=req.postDataBuffer()?.toString('latin1')||'';
 return {noteId:raw.match(/name="note_id"\r\n\r\n([^\r]+)/)?.[1],name:Buffer.from(raw.match(/filename="([^"]*)"/)?.[1]||'','latin1').toString('utf8'),
  type:raw.match(/name="file"; filename="[^"]*"\r\nContent-Type: ([^\r]+)/)?.[1]||'',bytes:raw.length};
};

async function noteFixture(page){
 const notes=[{id:'n-edit',workspace_id:'w',kind:'note',title:'현장 노트',raw_text:'본문 첫 줄',occurred_at:at,created_at:at,updated_at:'2026-10-22T02:00:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},doc:null}];
 const uploads=[],errors=[];let stamp=10;
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
 await openHome(page);
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams,method=req.method();
  const pick=row=>(!q.get('kind')||'eq.'+row.kind===q.get('kind'))&&(!q.get('id')||'eq.'+row.id===q.get('id'))&&(!q.get('updated_at')||'eq.'+row.updated_at===q.get('updated_at'));
  if(method==='GET'){if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:notes.filter(pick).slice(Number(q.get('offset')||0)).map(x=>structuredClone(x))});}
  if(method==='PATCH'){const body=req.postDataJSON();const hit=notes.filter(pick);for(const row of hit)Object.assign(row,body);return r.fulfill({json:hit.map(x=>structuredClone(x))});}
  return r.fulfill({status:500,json:{}});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',r=>new URL(r.request().url()).searchParams.has('note_id')?r.fulfill({json:[]}):r.fallback());
 await page.route(SB+'/functions/v1/basket-files**',async r=>{
  const url=new URL(r.request().url());
  if(url.searchParams.get('action')==='photo')return r.fulfill({status:200,headers:{'content-type':'image/png'},body:PNG});
  const sent=multipart(r.request());uploads.push(sent);
  await new Promise(done=>setTimeout(done,SLOW_MS));
  const row=notes.find(n=>n.id===sent.noteId);
  row.attachments=[...row.attachments,{drive_file_id:'up_'+uploads.length,file_name:sent.name,mime_type:sent.type,size_bytes:sent.bytes}];
  row.updated_at=`2026-10-22T05:00:${String(stamp++).padStart(2,'0')}Z`;
  return r.fulfill({json:{ok:true,note_id:row.id,attachments:row.attachments}});
 });
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await openKindMenu(page,'note');const kind=basketKindButton(page,'note');await expect(kind).toBeVisible();await kind.click();
 await page.locator('[data-note-row="n-edit"]').click();
 await noteMenuAction(page,'data-note-edit',{width:412});
 const box=page.locator('[data-note-detail] [data-note-body-field]'),field=box.locator('.ProseMirror');
 await expect(field).toBeVisible();
 await field.click();await page.keyboard.press('Control+End');
 return {notes,uploads,errors,box,field};
}
async function insertVia(page,box,cmd,files){
 await box.locator('[data-ed-cmd="gInsert"]').click();
 const chooser=page.waitForEvent('filechooser');
 await box.locator(`[data-ed-cmd="${cmd}"]`).click();
 await (await chooser).setFiles(files);
}

test('폰 412 노트 수정 화면: [넣기] → [사진] 큰 사진이 느린 서버(15초 넘게)에서도 들어간다',async({page})=>{
 const f=await noteFixture(page);
 await insertVia(page,f.box,'photo',[{name:'현장.jpg',mimeType:'image/jpeg',buffer:bigJpeg()}]);
 await expect(f.field.locator('img.ed-photo-img')).toHaveCount(1,{timeout:SLOW_MS+20000});
 expect(f.uploads.map(u=>[u.noteId,u.name,u.type])).toEqual([['n-edit','현장.jpg','image/jpeg']]);
 expect(f.uploads[0].bytes).toBeGreaterThan(6*1048576);
 await expect(page.locator('[data-note-detail]')).not.toContainText('올리지 못했어요');
 expect(f.errors).toEqual([]);
});

test('폰 412 노트 수정 화면: [넣기] → [파일]이 느린 서버(15초 넘게)에서도 카드로 들어간다',async({page})=>{
 const f=await noteFixture(page);
 await insertVia(page,f.box,'file',[{name:'회의자료.pdf',mimeType:'application/pdf',buffer:Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(3*1048576,32)])}]);
 await expect(f.field.locator('.ed-file')).toHaveCount(1,{timeout:SLOW_MS+20000});
 await expect(f.field.locator('.ed-file')).toContainText('회의자료.pdf');
 expect(f.uploads.map(u=>[u.noteId,u.name])).toEqual([['n-edit','회의자료.pdf']]);
 expect(f.errors).toEqual([]);
});

test('폰 412 일기: 큰 사진(4000×3000)이 느린 서버(15초 넘게)에서도 들어간다',async({page})=>{
 const rows=[],uploads=[],errors=[];let n=0;
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
 await openHome(page);
 const big=Buffer.from((await page.evaluate(()=>{const k=document.createElement('canvas');k.width=4000;k.height=3000;const x=k.getContext('2d');for(let i=0;i<40;i++){x.fillStyle=`hsl(${i*9},60%,50%)`;x.fillRect(i*100,0,100,3000);}return k.toDataURL('image/png');})).split(',')[1],'base64');
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams,method=req.method();
  const match=row=>[...q.entries()].every(([k,v])=>{if(['select','order','limit','offset'].includes(k))return true;const [op,...rest]=v.split('.'),val=rest.join('.'),cell=k==='attachments'?JSON.stringify(row.attachments):row[k];return op==='eq'?String(cell)===val:op==='gte'?String(cell)>=val:op==='lte'?String(cell)<=val:true;});
  if(method==='GET'){if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:rows.filter(match)});}
  if(method==='POST'){const body=req.postDataJSON();const row={id:'d-new-'+(++n),title:null,occurred_at:at,created_at:at,updated_at:'2026-10-06T01:00:0'+n+'Z',archived_at:null,attachments:[],metadata:{},...body};rows.push(row);return r.fulfill({status:201,json:[row]});}
  if(method==='PATCH'){const body=req.postDataJSON();const hit=rows.filter(match);for(const row of hit)Object.assign(row,body);return r.fulfill({json:hit});}
  return r.fulfill({status:500,json:{}});
 });
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/basket-files',async r=>{
  const req=r.request(),u=new URL(req.url());
  if(req.method()==='GET'&&u.searchParams.get('action')==='photo')return r.fulfill({status:200,contentType:'image/png',body:PNG});
  if(req.method()!=='POST'||u.searchParams.get('action'))return r.fulfill({json:{ok:true}});
  const sent=multipart(req);uploads.push(sent);
  await new Promise(done=>setTimeout(done,SLOW_MS));
  const row=rows.find(x=>x.id===sent.noteId);
  row.attachments=[...row.attachments,{drive_file_id:'up'+uploads.length,file_name:sent.name,mime_type:sent.type,size_bytes:sent.bytes}];
  row.updated_at='2026-10-06T02:00:0'+uploads.length+'Z';
  return r.fulfill({json:{ok:true,note_id:row.id,attachments:row.attachments}});
 });
 await page.locator('.mobile-tabs [data-mobile-schedule-tab]').click();
 await expect(page.locator('#calendarView')).toBeVisible();
 await page.locator('#calendarView .schedule-switch [data-view="diary"]').click();
 await expect(page.locator('#diaryView')).toBeVisible();
 await page.locator('#diaryRoot #newDiaryBtn').click();
 const ed=page.locator('#diaryRoot [data-diary-editor]');
 await ed.locator('[data-diary-input]').setInputFiles([{name:'IMG_1.png',mimeType:'image/png',buffer:big}]);
 await expect(ed.locator('.diary-thumb.pending')).toHaveCount(1);
 await ed.locator('[data-diary-save]').click();
 await expect(ed).toBeHidden({timeout:SLOW_MS+20000});
 await expect(page.locator('#diaryRoot [data-diary-status]')).toHaveText('일기를 저장했어요.');
 expect(uploads).toHaveLength(1);expect(uploads[0].type).toBe('image/jpeg');expect(uploads[0].noteId).toBe('d-new-1');
 expect(rows[0].attachments).toHaveLength(1);
 expect(errors).toEqual([]);
});
