import { test, expect } from '@playwright/test';
import http from 'node:http';
import { openHome } from './helpers/home-entry.mjs';
import { typeInto } from './helpers/note-editor.mjs';
import { answerAsk } from './helpers/small-notice.mjs';
// S52-21 DIARY-사진바로올리기(요청함 11/07 16:16): 일기 사진은 고르자마자 올라가고(사진 칸 위 막대·%), [저장]은 글·코멘트만 써서
// 바로 끝난다. 올리는 중에 [저장]을 누르면 '사진 1/2 올리는 중 64%'로 기다리는 것을 보이고, 저장하지 않고 닫으면 올린 사진을 다시 뺀다.
// 보낸 양이 진짜여야 하므로 올리기(basket-files POST, XMLHttpRequest)만 이 시험 안의 느린 서버(127.0.0.1)로 보낸다(느린 망 흉내).
// 나머지는 흉내 낸 Supabase. 합성 데이터만(사진은 캔버스로 만든 무늬, 이름은 IMG_n.jpg).
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const at='2026-10-05T01:00:00Z';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
test.setTimeout(90000);
test.use({hasTouch:true,isMobile:true,viewport:{width:412,height:915}});

function slowServer(onBody){
 const state={pauseMs:40,done:0,fail:null};
 const server=http.createServer((req,res)=>{
  res.setHeader('access-control-allow-origin','*');res.setHeader('access-control-allow-headers','authorization,apikey,content-type');res.setHeader('access-control-allow-methods','POST,OPTIONS');
  if(req.method==='OPTIONS'){res.end();return;}
  const parts=[];
  req.on('data',d=>{parts.push(d);req.pause();setTimeout(()=>req.resume(),state.pauseMs);});
  req.on('end',()=>{state.done++;const reply=onBody(Buffer.concat(parts));res.setHeader('content-type','application/json');res.writeHead(reply.status||200);res.end(JSON.stringify(reply.json));});
 });
 return new Promise(r=>server.listen(0,'127.0.0.1',()=>r({state,server,base:`http://127.0.0.1:${server.address().port}`})));
}
const multipart=raw=>{const text=raw.toString('latin1');return {noteId:text.match(/name="note_id"\r\n\r\n([^\r]+)/)?.[1],name:Buffer.from(text.match(/filename="([^"]*)"/)?.[1]||'','latin1').toString('utf8'),bytes:raw.length};};

async function fixture(page,{rows=[]}={}){
 const errors=[],uploads=[],writes=[],prunes=[],noteDeletes=[];let n=0,stamp=10;
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource|net::ERR/.test(m.text()))errors.push(m.text());});
 let srv=null;
 srv=await slowServer(raw=>{
  const sent=multipart(raw);uploads.push(sent);
  if(srv?.state.fail?.(sent.name,uploads.filter(u=>u.name===sent.name).length))return {status:400,json:{error:'Drive 저장 실패',code:'drive_upload_failed'}};
  const row=rows.find(x=>x.id===sent.noteId);
  if(!row)return {status:404,json:{code:'note_not_found'}};
  row.attachments=[...row.attachments,{drive_file_id:'up'+uploads.length,file_name:sent.name,mime_type:'image/jpeg',size_bytes:sent.bytes}];
  row.updated_at=`2026-10-06T02:00:${String(stamp++).padStart(2,'0')}Z`;
  return {json:{ok:true,note_id:row.id,attachments:row.attachments}};
 });
 page.on('close',()=>srv.server.close());
 await page.addInitScript(target=>{
  const open=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url,...rest){if(String(method).toUpperCase()==='POST'&&/\/functions\/v1\/basket-files(\?|$)/.test(String(url)))url=target+'/basket-files';return open.call(this,method,url,...rest);};
 },srv.base);
 await openHome(page);
 const match=(row,q)=>[...q.entries()].every(([k,v])=>{if(['select','order','limit','offset'].includes(k))return true;const [op,...rest]=v.split('.'),val=rest.join('.'),cell=k==='attachments'?JSON.stringify(row.attachments):row[k];return op==='eq'?String(cell)===val:op==='gte'?String(cell)>=val:op==='lte'?String(cell)<=val:true;});
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams,method=req.method();
  if(method==='GET'){if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:rows.filter(row=>match(row,q)).map(x=>structuredClone(x))});}
  if(method==='POST'){const body=req.postDataJSON();writes.push({method,body});const row={id:'d-new-'+(++n),title:null,occurred_at:at,created_at:at,updated_at:'2026-10-06T01:00:0'+n+'Z',archived_at:null,attachments:[],metadata:{},...body};
   if(rows.some(x=>x.kind==='diary'&&x.journal_day===row.journal_day))return r.fulfill({status:409,json:{code:'23505'}});rows.push(row);return r.fulfill({status:201,json:[structuredClone(row)]});}
  if(method==='PATCH'){const body=req.postDataJSON();writes.push({method,query:Object.fromEntries(q),body});const hit=rows.filter(row=>match(row,q));for(const row of hit)Object.assign(row,body);return r.fulfill({json:hit.map(x=>structuredClone(x))});}
  if(method==='DELETE'){const hit=rows.filter(row=>match(row,q));for(const row of hit)rows.splice(rows.indexOf(row),1);return r.fulfill({json:hit.map(row=>({id:row.id}))});}
  return r.fulfill({status:500,json:{}});
 });
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_record_links',r=>r.fulfill({json:[]}));
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/basket-files',async r=>{
  const req=r.request(),u=new URL(req.url()),action=u.searchParams.get('action');
  if(action==='photo-prune'){const body=req.postDataJSON();prunes.push(body.file_ids);return r.fulfill({json:{action:'photo-prune',ok:true,trashed:body.file_ids.length,kept:0,failed:0,unknown:0}});}
  if(action==='note-delete'){const body=req.postDataJSON(),row=rows.find(x=>x.id===body.note_id);noteDeletes.push(body.note_id);
   if(!row)return r.fulfill({status:404,json:{action:'note-delete',note_id:body.note_id,attachments_total:0,trashed:0,failed:0,unknown:0,ok:false,note_deleted:false,code:'note_not_found'}});
   rows.splice(rows.indexOf(row),1);return r.fulfill({json:{action:'note-delete',note_id:body.note_id,attachments_total:row.attachments.length,trashed:row.attachments.length,failed:0,unknown:0,ok:true,note_deleted:true}});}
  return r.fulfill({status:200,contentType:'image/png',body:PNG});
 });
 await page.evaluate(()=>window.KPTURouter.go('diary'));
 await expect(page.locator('#diaryView')).toBeVisible();
 return {rows,uploads,writes,prunes,noteDeletes,errors,srv};
}
// 줄이지 않고 그대로 보내는 JPEG(긴 변 2048 이하): 보낸 양이 충분히 커서 느린 서버에서 몇 초 걸린다.
async function photos(page,count){
 const list=[];
 for(let i=1;i<=count;i++){
  const data=await page.evaluate(seed=>{const k=document.createElement('canvas');k.width=1600;k.height=1200;const x=k.getContext('2d');const img=x.createImageData(1600,1200);let s=seed;for(let j=0;j<img.data.length;j++){s=(s*1103515245+12345)>>>0;img.data[j]=j%4===3?255:s>>>24;}x.putImageData(img,0,0);return k.toDataURL('image/jpeg',0.95);},i*7);
  list.push({name:`IMG_${i}.jpg`,mimeType:'image/jpeg',buffer:Buffer.from(data.split(',')[1],'base64')});
 }
 return list;
}
const editorOf=page=>page.locator('#diaryRoot [data-diary-editor]');
const field=ed=>ed.locator('[data-diary-text] .ProseMirror');

test('새 일기: 사진 2장을 고르자마자 막대·%가 차오르고, 글을 다 쓴 뒤 [저장]은 글 저장 시간 안에 끝난다(폰 412·느린 망)',async({page})=>{
 const f=await fixture(page);
 await page.locator('#diaryRoot #newDiaryBtn').click();
 const ed=editorOf(page);
 await ed.locator('[data-diary-input]').setInputFiles(await photos(page,2));
 // [저장]을 누르지 않았는데 첫 사진 칸 위에 막대와 %가 보인다.
 const over=ed.locator('.diary-thumb .up-tile-over').first();
 await expect(over).toBeVisible();
 await expect(over.locator('[role="progressbar"]')).toBeVisible();
 await expect(over.locator('.up-pc')).toHaveText(/\d+%|마무리 중…/);
 // 그 날 일기를 먼저 만들어(글 없이) 거기에 올린다.
 await expect.poll(()=>f.writes.filter(w=>w.method==='POST').length).toBe(1);
 expect(f.writes[0].body).toMatchObject({kind:'diary',ai_export_allowed:false});
 await typeInto(page,field(ed),'오늘 쓴 합성 일기');
 // 글을 쓰는 동안 사진 두 장이 다 올라간다(점선이 빠짐).
 await expect.poll(()=>f.uploads.length,{timeout:30000}).toBe(2);
 await expect(ed.locator('.diary-thumb.pending')).toHaveCount(0);
 await expect(ed.locator('.up-tile-over')).toHaveCount(0);
 const started=Date.now();
 await ed.locator('[data-diary-save]').click();
 await expect(ed).toBeHidden();
 expect(Date.now()-started).toBeLessThan(2000);
 await expect(page.locator('#diaryRoot [data-diary-status]')).toHaveText('일기를 저장했어요.');
 const row=f.rows.find(r=>r.kind==='diary');
 expect(row.raw_text).toBe('오늘 쓴 합성 일기');
 expect(row.attachments.map(a=>a.file_name)).toEqual(['IMG_1.jpg','IMG_2.jpg']);
 expect(f.uploads.map(u=>u.noteId)).toEqual([row.id,row.id]);
 expect(f.errors).toEqual([]);
});

// BIZ-저장먼저닫기 3차(S59-18): 올리는 중에 [저장]해도 남은 사진을 다 기다리지 않는다. 지금 보내는 한 장만 끝나면 글이 저장되고 창이 닫히며,
// 남은 사진은 그 일기로 뒤에서 이어 올라간다(아래 한 줄 '사진 n장 올리는 중' → '○월 ○일 일기에 사진 n장 올렸어요'). 예전에는 '사진 1/2 올리는 중'으로 다 기다렸다.
async function saveWhileUploading(page){
 const f=await fixture(page);f.srv.state.pauseMs=80;
 await page.locator('#diaryRoot #newDiaryBtn').click();
 const ed=editorOf(page);
 await ed.locator('[data-diary-input]').setInputFiles(await photos(page,3));
 await expect(ed.locator('.diary-thumb .up-tile-over').first()).toBeVisible();
 await typeInto(page,field(ed),'합성 일기 글');
 await ed.locator('[data-diary-comment],[data-diary-pending-comment]').nth(2).fill('셋째 사진 코멘트');
 await ed.locator('[data-diary-save]').click();
 await expect(ed).toBeHidden({timeout:15000});
 // 글은 이미 저장됐고 남은 사진은 아직 다 올라가지 않았다.
 const row=f.rows.find(r=>r.kind==='diary');
 expect(row.raw_text).toBe('합성 일기 글');
 expect(f.uploads.length).toBeLessThan(3);
 await expect(page.locator('#diaryRoot [data-diary-status]')).toHaveText('일기를 저장했어요.');
 return {f,row};
}
for(const width of [412,1280]){
 test.describe(`${width}`,()=>{
  if(width===1280)test.use({hasTouch:false,isMobile:false,viewport:{width:1280,height:900}});
  test(`올리는 중에 [저장]: 글이 먼저 저장되고 창이 닫히며, 남은 사진은 다른 화면으로 가도 그 일기로 끝까지 올라간다(${width})`,async({page})=>{
   const {f,row}=await saveWhileUploading(page);
   await page.evaluate(()=>window.KPTURouter.go('home',{source:'test'}));
   const dock=page.locator('#uploadDock');
   await expect(dock).toContainText('올리는 중');
   await expect(dock).toContainText(/일기에 사진 \d장 올렸어요/,{timeout:45000});
   expect(f.uploads).toHaveLength(3);
   expect(f.uploads.map(u=>u.noteId)).toEqual([row.id,row.id,row.id]);
   expect(row.attachments.map(a=>a.file_name)).toEqual(['IMG_1.jpg','IMG_2.jpg','IMG_3.jpg']);
   // 뒤에서 올라간 사진의 코멘트도 그 사진에 붙는다.
   await expect.poll(()=>row.metadata?.photo_comments?.[row.attachments[2].drive_file_id]).toBe('셋째 사진 코멘트');
   expect(row.raw_text).toBe('합성 일기 글');
   // 위쪽 작은 알림은 겹쳐 뜨지 않는다.
   await expect(page.locator('#toast')).not.toContainText('사진');
   expect(f.errors).toEqual([]);
  });
  test(`뒤에서 못 올린 사진은 아래 한 줄에 남고 [다시 올리기]는 그 사진만 같은 일기로 보낸다(${width})`,async({page})=>{
   const {f,row}=await saveWhileUploadingFail(page);
   const dock=page.locator('#uploadDock');
   await expect(dock).toContainText('사진 1장 못 올렸어요',{timeout:45000});
   await page.waitForTimeout(6500);
   await expect(dock).toContainText('사진 1장 못 올렸어요');
   await dock.getByRole('button',{name:'못 올린 사진 다시 올리기'}).click();
   await expect(dock).toContainText('사진 1장 올렸어요',{timeout:30000});
   expect(f.uploads.map(u=>u.name)).toEqual(['IMG_1.jpg','IMG_2.jpg','IMG_3.jpg','IMG_3.jpg']);
   expect(row.attachments.map(a=>a.file_name)).toEqual(['IMG_1.jpg','IMG_2.jpg','IMG_3.jpg']);
   expect(f.errors).toEqual([]);
  });
 });
}
async function saveWhileUploadingFail(page){
 const f=await fixture(page);f.srv.state.pauseMs=120;f.srv.state.fail=(name,n)=>name==='IMG_3.jpg'&&n===1;
 await page.locator('#diaryRoot #newDiaryBtn').click();
 const ed=editorOf(page);
 await ed.locator('[data-diary-input]').setInputFiles(await photos(page,3));
 await typeInto(page,field(ed),'합성 글');
 await ed.locator('[data-diary-save]').click();
 await expect(ed).toBeHidden({timeout:15000});
 return {f,row:f.rows.find(r=>r.kind==='diary')};
}
test('글 저장이 실패하면 창은 그대로이고, 사진은 창에서 이어 올린다(글을 다시 [저장]할 수 있음)',async({page})=>{
 const rows=[{id:'d5',workspace_id:'w',kind:'diary',title:null,journal_day:'2026-10-05',raw_text:'합성 글',doc:null,occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:false,attachments:[],metadata:{}}];
 const f=await fixture(page,{rows});
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{if(r.request().method()==='PATCH'&&r.request().postDataJSON()?.raw_text!==undefined)return r.fulfill({status:500,json:{message:'오류'}});return r.fallback();});
 await page.locator('#diaryRoot [data-diary-day="2026-10-05"]').first().click();
 await page.locator('#diaryRoot [data-diary-edit]').click();
 const ed=editorOf(page);
 await ed.locator('[data-diary-input]').setInputFiles(await photos(page,1));
 await typeInto(page,field(ed),' 더함');
 await ed.locator('[data-diary-save]').click();
 await expect(ed.locator('[data-diary-editor-status]')).toContainText('저장하지 못했어요');
 await expect(ed).toBeVisible();
 await expect.poll(()=>f.uploads.length,{timeout:30000}).toBe(1);
 expect(rows[0].raw_text).toBe('합성 글');
 await expect(page.locator('#uploadDock',{hasText:'일기에'})).toHaveCount(0);
 expect(f.errors.filter(e=>!/500/.test(e))).toEqual([]);
});

test('저장하지 않고 닫으면 이 창에서 올린 사진을 다시 뺀다: 있던 일기는 그 사진만 빼고 Drive 휴지통, 새 일기는 일기째 지움',async({page})=>{
 const rows=[{id:'d3',workspace_id:'w',kind:'diary',title:null,journal_day:'2026-10-03',raw_text:'합성 글',doc:null,occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:false,attachments:[{drive_file_id:'pa',file_name:'a.jpg',mime_type:'image/jpeg',size_bytes:10}],metadata:{}}];
 const f=await fixture(page,{rows});
 // 있던 일기: 사진 한 장을 올린 뒤 [취소].
 await page.evaluate(()=>window.KPTURouter.go('diary'));
 await page.locator('#diaryRoot [data-diary-day="2026-10-03"]').first().click();
 await page.locator('#diaryRoot [data-diary-edit]').click();
 const ed=editorOf(page);
 await ed.locator('[data-diary-input]').setInputFiles(await photos(page,1));
 await expect.poll(()=>f.uploads.length,{timeout:30000}).toBe(1);
 await expect(ed.locator('.diary-thumb.pending')).toHaveCount(0);
 expect(rows[0].attachments).toHaveLength(2);
 await ed.locator('.diary-actions [data-diary-editor-close]').click();await answerAsk(page,true);
 await expect(ed).toBeHidden();
 await expect.poll(()=>rows[0].attachments.map(a=>a.drive_file_id)).toEqual(['pa']);
 await expect.poll(()=>f.prunes).toEqual([['up1']]);
 expect(rows[0].raw_text).toBe('합성 글');
 // 새 일기: 사진만 올린 뒤 [취소] → 만든 일기째 지운다(note-delete, 사진은 Drive 휴지통).
 await page.locator('#diaryRoot [data-diary-detail-close]').click().catch(()=>{});
 await page.locator('#diaryRoot #newDiaryBtn').click();
 await ed.locator('[data-diary-input]').setInputFiles(await photos(page,1));
 await expect.poll(()=>f.uploads.length,{timeout:30000}).toBe(2);
 const made=f.rows.find(r=>r.id!=='d3');expect(made).toBeTruthy();
 await ed.locator('.diary-actions [data-diary-editor-close]').click();await answerAsk(page,true);
 await expect.poll(()=>f.noteDeletes).toEqual([made.id]);
 expect(f.rows.map(r=>r.id)).toEqual(['d3']);
 expect(f.errors).toEqual([]);
});

test('글 칸에 사진을 붙여 넣으면(폰 복사처럼 파일 이름 글자가 함께 와도) 이름 글자가 아니라 일기 사진으로 들어간다',async({page})=>{
 const f=await fixture(page);
 await page.locator('#diaryRoot #newDiaryBtn').click();
 const ed=editorOf(page);
 await typeInto(page,field(ed),'합성 글');
 const [file]=await photos(page,1);
 await field(ed).evaluate((el,b64)=>{
  const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
  const dt=new DataTransfer();dt.items.add(new File([bytes],'20261107_161200.jpg',{type:'image/jpeg'}));dt.setData('text/plain','20261107_161200.jpg');
  el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
 },file.buffer.toString('base64'));
 await expect(ed.locator('[data-diary-pending]')).toHaveCount(1);
 await expect(field(ed)).toHaveText('합성 글');
 await expect.poll(()=>f.uploads.length,{timeout:30000}).toBe(1);
 await ed.locator('[data-diary-save]').click();
 await expect(ed).toBeHidden();
 const row=f.rows.find(r=>r.kind==='diary');
 expect(row.raw_text).toBe('합성 글');expect(row.raw_text).not.toContain('.jpg');
 expect(row.attachments).toHaveLength(1);
 expect(f.errors).toEqual([]);
});
