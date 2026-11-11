import { test, expect } from '@playwright/test';
import http from 'node:http';
import { openHome } from './helpers/home-entry.mjs';
import { basketKindButton, openKindMenu } from './helpers/basket-kind.mjs';
import { noteMenuAction } from './helpers/note-menu.mjs';
// UI-올리기진행표시(S52-15, 요청함 11/07 11:40, 시안 docs/design/mockups/upload-progress.html): 파일·사진을 올리면 막대와 %가
// 실제로 보낸 양으로 차오르고, ✕ 취소·실패 [다시]·다른 화면에서는 하단바 위 한 줄로 끝남을 알 수 있다.
// 보낸 양이 진짜여야 하므로 올리기(basket-files POST)만 이 시험 안의 느린 서버(127.0.0.1)로 보낸다: 서버가 받은 만큼만 브라우저의
// upload.onprogress가 오른다(화면 코드는 그대로, 주소만 바꿈). 나머지 요청은 흉내 낸 Supabase. 합성 데이터만.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const at='2026-10-22T01:00:00Z';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const MB=1048576;
const bigJpeg=(mb=12)=>Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.alloc(mb*MB,7),Buffer.from([0xff,0xd9])]);
test.setTimeout(90000);

// 느린 서버: 조각마다 pauseMs 쉬며 읽는다. cutAt 바이트에서 연결을 끊는 실패(한 번), holdMs = 다 받은 뒤 답까지(마무리 중…).
function slowServer(onBody){
 const state={pauseMs:60,holdMs:0,cutOnce:0,done:0,aborted:0};
 const server=http.createServer((req,res)=>{
  res.setHeader('access-control-allow-origin','*');res.setHeader('access-control-allow-headers','authorization,apikey,content-type');res.setHeader('access-control-allow-methods','POST,OPTIONS');
  if(req.method==='OPTIONS'){res.end();return;}
  const parts=[];let n=0,cut=state.cutOnce;state.cutOnce=0;
  req.on('data',d=>{parts.push(d);n+=d.length;if(cut&&n>=cut){state.aborted++;req.socket.destroy();return;}req.pause();setTimeout(()=>req.resume(),state.pauseMs);});
  req.on('aborted',()=>{state.aborted++;});
  req.on('end',async()=>{
   if(cut)return;
   await new Promise(r=>setTimeout(r,state.holdMs));
   state.done++;
   const reply=onBody(Buffer.concat(parts));
   res.setHeader('content-type','application/json');res.end(JSON.stringify(reply));
  });
 });
 return new Promise(r=>server.listen(0,'127.0.0.1',()=>r({state,server,base:`http://127.0.0.1:${server.address().port}`})));
}
const multipart=raw=>{
 const text=raw.toString('latin1');
 return {noteId:text.match(/name="note_id"\r\n\r\n([^\r]+)/)?.[1],name:Buffer.from(text.match(/filename="([^"]*)"/)?.[1]||'','latin1').toString('utf8'),
  type:text.match(/name="file"; filename="[^"]*"\r\nContent-Type: ([^\r]+)/)?.[1]||'',bytes:raw.length};
};
// 화면 코드의 XMLHttpRequest는 그대로 두고, basket-files 올리기 주소만 느린 서버로 바꾼다.
async function sendUploadsTo(page,base){
 await page.addInitScript(target=>{
  const open=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(method,url,...rest){
   if(String(method).toUpperCase()==='POST'&&/\/functions\/v1\/basket-files(\?|$)/.test(String(url)))url=target+'/basket-files';
   return open.call(this,method,url,...rest);
  };
 },base);
}
const errorsOf=page=>{const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource|net::ERR/.test(m.text()))errors.push(m.text());});return errors;};
// 몇 번 읽은 % 숫자들(같은 값은 한 번).
async function percents(locator,ms){
 const seen=[];const end=Date.now()+ms;
 while(Date.now()<end){const t=await locator.first().textContent().catch(()=>'');const m=/(\d+)%/.exec(t||'');if(m){const v=Number(m[1]);if(seen.at(-1)!==v)seen.push(v);}await new Promise(r=>setTimeout(r,120));}
 return seen;
}
const rising=list=>list.every((v,i)=>!i||v>=list[i-1]);

async function noteFixture(page,{width=412}={}){
 const notes=[{id:'n-edit',workspace_id:'w',kind:'note',title:'현장 노트',raw_text:'본문 첫 줄',occurred_at:at,created_at:at,updated_at:'2026-10-22T02:00:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},doc:null}];
 const uploads=[];let stamp=10;
 const srv=await slowServer(raw=>{
  const sent=multipart(raw);uploads.push(sent);
  const row=notes.find(n=>n.id===sent.noteId);
  row.attachments=[...row.attachments,{drive_file_id:'up_'+uploads.length,file_name:sent.name,mime_type:sent.type,size_bytes:sent.bytes}];
  row.updated_at=`2026-10-22T05:00:${String(stamp++).padStart(2,'0')}Z`;
  return {ok:true,note_id:row.id,attachments:row.attachments};
 });
 const errors=errorsOf(page);page.on('close',()=>srv.server.close());
 await sendUploadsTo(page,srv.base);
 await openHome(page);
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams,method=req.method();
  const pick=row=>(!q.get('kind')||'eq.'+row.kind===q.get('kind'))&&(!q.get('id')||'eq.'+row.id===q.get('id'))&&(!q.get('updated_at')||'eq.'+row.updated_at===q.get('updated_at'));
  if(method==='GET'){if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:notes.filter(pick).slice(Number(q.get('offset')||0)).map(x=>structuredClone(x))});}
  if(method==='PATCH'){const body=req.postDataJSON();const hit=notes.filter(pick);for(const row of hit)Object.assign(row,body);return r.fulfill({json:hit.map(x=>structuredClone(x))});}
  return r.fulfill({status:500,json:{}});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',r=>new URL(r.request().url()).searchParams.has('note_id')?r.fulfill({json:[]}):r.fallback());
 await page.route(SB+'/functions/v1/basket-files**',r=>r.fulfill({status:200,headers:{'content-type':'image/png'},body:PNG}));
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await openKindMenu(page,'note');const kind=basketKindButton(page,'note');await expect(kind).toBeVisible();await kind.click();
 await page.locator('[data-note-row="n-edit"]').click();
 await noteMenuAction(page,'data-note-edit',{width});
 const box=page.locator('[data-note-detail] [data-note-body-field]'),field=box.locator('.ProseMirror');
 await expect(field).toBeVisible();
 await field.click();await page.keyboard.press('Control+End');
 return {notes,uploads,errors,box,field,srv};
}
async function insertVia(page,box,cmd,files){
 const wide=await page.evaluate(()=>innerWidth>760);
 if(!wide||await box.locator('[data-ed-cmd="gInsert"]').isVisible())await box.locator('[data-ed-cmd="gInsert"]').click();
 const chooser=page.waitForEvent('filechooser');
 await box.locator(`[data-ed-cmd="${cmd}"]`).click();
 await (await chooser).setFiles(files);
}

test.describe('폰 412',()=>{
 test.use({hasTouch:true,isMobile:true,viewport:{width:412,height:915}});

 test('노트 [넣기] → [사진]: 흐린 미리보기 위 막대·%가 실제 보낸 양으로 오르고, 다 보내면 마무리 중…, 끝나면 사진이 들어간다',async({page})=>{
  const f=await noteFixture(page);f.srv.state.holdMs=1500;
  await insertVia(page,f.box,'photo',[{name:'현장.jpg',mimeType:'image/jpeg',buffer:bigJpeg()}]);
  const tile=f.box.locator('.ed-uploads .up-row.up-tile');
  await expect(tile).toBeVisible();
  await expect(tile.locator('img.up-tile-img')).toHaveCount(1); // 흐린 미리보기
  const seen=await percents(tile.locator('.up-pc'),3000);
  expect(seen.length).toBeGreaterThan(1); // 한 번에 100이 아니라 여러 번 오른다
  expect(rising(seen)).toBe(true);
  expect(seen.every(v=>v<100)).toBe(true); // 다 보내기 전에는 100%를 쓰지 않는다
  const now=Number(await tile.locator('.up-bar').getAttribute('aria-valuenow'));
  expect(now).toBeGreaterThan(0);
  await expect(tile.locator('.up-pc')).toHaveText('마무리 중…',{timeout:30000});
  await expect(f.field.locator('img.ed-photo-img')).toHaveCount(1,{timeout:20000});
  await expect(f.box.locator('.ed-uploads')).toBeHidden({timeout:5000}); // '✓ 완료' 1초 뒤 줄이 빠진다
  expect(f.uploads.map(u=>[u.noteId,u.name])).toEqual([['n-edit','현장.jpg']]);
  await expect(page.locator('#uploadDock')).toBeHidden();
  expect(f.errors).toEqual([]);
 });

 test('노트 [넣기] → [파일]: 보내는 중 ✕로 취소하면 서버에 닿지 않고 카드도 들어가지 않는다',async({page})=>{
  const f=await noteFixture(page);f.srv.state.pauseMs=120;
  await insertVia(page,f.box,'file',[{name:'큰 자료.pdf',mimeType:'application/pdf',buffer:Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(12*MB,32)])}]);
  const row=f.box.locator('.ed-uploads .up-row');
  await expect(row).toContainText('큰 자료.pdf');
  await expect(row.locator('.up-pc')).toHaveText(/^\d+%$/);
  await row.getByRole('button',{name:'큰 자료.pdf 올리기 취소'}).click();
  await expect(f.box.locator('.ed-uploads')).toBeHidden();
  await page.waitForTimeout(800);
  await expect(f.field.locator('.ed-file')).toHaveCount(0);
  expect(f.srv.state.done).toBe(0);
  expect(f.uploads).toEqual([]);
  await expect(page.locator('[data-note-detail]')).not.toContainText('올리지 못했어요');
  expect(f.errors).toEqual([]);
 });

 test('노트 [넣기] → [사진]: 보내다 연결이 끊기면 실패 + [다시], [다시]를 누르면 다시 올라가 들어간다',async({page})=>{
  const f=await noteFixture(page);f.srv.state.cutOnce=6*MB;f.srv.state.pauseMs=20;
  await insertVia(page,f.box,'photo',[{name:'끊김.jpg',mimeType:'image/jpeg',buffer:bigJpeg()}]);
  // UX-알림하나로(S59-21): 실패·[다시 올리기]는 하단바 위 한 줄 하나 — 글 위 올리는 줄은 '실패 [다시]'를 따로 그리지 않는다.
  const dock=page.locator('#uploadDock:not([hidden])');
  await expect(dock.locator('.up-dock-text')).toHaveText('사진을 올리지 못했어요',{timeout:30000});
  await expect(f.box.locator('.ed-uploads .up-row')).toHaveCount(0);
  await expect(page.locator('#kptuNotice:not([hidden])')).toHaveCount(0);
  const again=dock.getByRole('button',{name:'못 올린 사진 다시 올리기'});
  await expect(again).toBeVisible();
  expect(f.uploads).toEqual([]);
  await again.click();
  await expect(f.field.locator('img.ed-photo-img')).toHaveCount(1,{timeout:30000});
  expect(f.uploads.map(u=>u.name)).toEqual(['끊김.jpg']);
  await expect(f.box.locator('.ed-uploads')).toBeHidden({timeout:5000});
 });

 test('올리는 동안 다른 화면으로 가면 하단바 위 한 줄(n개 올리는 중 %) → 끝나면 n개 올림 · [보기]로 돌아간다',async({page})=>{
  const f=await noteFixture(page);f.srv.state.pauseMs=90;
  await insertVia(page,f.box,'photo',[{name:'이동.jpg',mimeType:'image/jpeg',buffer:bigJpeg()}]);
  await expect(f.box.locator('.ed-uploads .up-row')).toBeVisible();
  await expect(page.locator('#uploadDock')).toBeHidden(); // 올리는 화면에 있는 동안은 한 줄이 없다
  await page.evaluate(()=>window.KPTURouter.go('home'));
  const dock=page.locator('#uploadDock');
  await expect(dock).toBeVisible();
  await expect(dock).toContainText('사진 1개 올리는 중');
  await expect(dock.locator('.up-dock-pc')).toHaveText(/\d+%|마무리 중…/);
  // 하단바 위(가리지 않음)
  const tabs=await page.locator('.mobile-tabs').boundingBox(),box=await dock.boundingBox();
  if(tabs)expect(box.y+box.height).toBeLessThanOrEqual(tabs.y+1);
  await expect(dock).toContainText('1개 올림',{timeout:30000});
  await dock.getByRole('button',{name:'올린 화면 보기'}).click();
  await expect(page.locator('#basketView')).toBeVisible();
  await expect(dock).toBeHidden();
  expect(f.uploads.map(u=>u.name)).toEqual(['이동.jpg']);
  expect(f.errors).toEqual([]);
 });
});

test.describe('PC 1440',()=>{
 test.use({viewport:{width:1440,height:900}});
 test('일기 사진: 고른 사진 칸 위 막대·%와 합계 줄이 실제 보낸 양으로 오르고, 끝나면 저장된다',async({page})=>{
  const rows=[],uploads=[];let n=0;
  const srv=await slowServer(raw=>{
   const sent=multipart(raw);uploads.push(sent);
   const row=rows.find(x=>x.id===sent.noteId);
   row.attachments=[...row.attachments,{drive_file_id:'up'+uploads.length,file_name:sent.name,mime_type:sent.type,size_bytes:sent.bytes}];
   row.updated_at='2026-10-06T02:00:0'+uploads.length+'Z';
   return {ok:true,note_id:row.id,attachments:row.attachments};
  });
  srv.state.pauseMs=60;
  const errors=errorsOf(page);
  await sendUploadsTo(page,srv.base);
  await openHome(page);
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
   const req=r.request(),q=new URL(req.url()).searchParams,method=req.method();
   const match=row=>[...q.entries()].every(([k,v])=>{if(['select','order','limit','offset'].includes(k))return true;const [op,...rest]=v.split('.'),val=rest.join('.'),cell=k==='attachments'?JSON.stringify(row.attachments):row[k];return op==='eq'?String(cell)===val:op==='gte'?String(cell)>=val:op==='lte'?String(cell)<=val:true;});
   if(method==='GET'){if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:rows.filter(match)});}
   if(method==='POST'){const body=req.postDataJSON();const row={id:'d-new-'+(++n),title:null,occurred_at:at,created_at:at,updated_at:'2026-10-06T01:00:0'+n+'Z',archived_at:null,attachments:[],metadata:{},...body};rows.push(row);return r.fulfill({status:201,json:[row]});}
   if(method==='PATCH'){const body=req.postDataJSON();const hit=rows.filter(match);for(const row of hit)Object.assign(row,body);return r.fulfill({json:hit});}
   return r.fulfill({status:500,json:{}});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/basket-files',r=>r.fulfill({status:200,contentType:'image/png',body:PNG}));
  // 줄이지 않고 그대로 보내는 큰 JPEG(가로세로가 작아 다시 그리지 않음): 보낸 양이 충분히 크다.
  await page.evaluate(()=>window.KPTURouter.go('diary'));
  await expect(page.locator('#diaryView')).toBeVisible();
  await page.locator('#diaryRoot #newDiaryBtn').click();
  const ed=page.locator('#diaryRoot [data-diary-editor]');
  const jpeg=Buffer.from((await page.evaluate(async()=>{const k=document.createElement('canvas');k.width=2000;k.height=1500;const x=k.getContext('2d');const img=x.createImageData(2000,1500);let s=7;for(let i=0;i<img.data.length;i++){s=(s*1103515245+12345)>>>0;img.data[i]=i%4===3?255:s>>>24;}x.putImageData(img,0,0);return k.toDataURL('image/jpeg',1);})).split(',')[1],'base64');
  expect(jpeg.length).toBeGreaterThan(5*MB);
  await ed.locator('[data-diary-input]').setInputFiles([{name:'일기.jpg',mimeType:'image/jpeg',buffer:jpeg}]);
  await expect(ed.locator('.diary-thumb.pending')).toHaveCount(1);
  await ed.locator('[data-diary-save]').click();
  const over=ed.locator('.diary-thumb.pending .up-tile-over');
  await expect(over).toBeVisible();
  await expect(ed.locator('[data-diary-uploads] .up-sum')).toContainText('올리는 중 1개');
  const seen=await percents(over.locator('.up-pc'),2000);
  expect(seen.length).toBeGreaterThan(0);
  expect(rising(seen)).toBe(true);
  await expect(ed).toBeHidden({timeout:30000});
  await expect(page.locator('#diaryRoot [data-diary-status]')).toHaveText('일기를 저장했어요.');
  expect(uploads).toHaveLength(1);
  expect(errors).toEqual([]);
  srv.server.close();
 });
});
