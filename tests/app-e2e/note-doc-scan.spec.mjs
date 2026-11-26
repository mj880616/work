import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { basketKindButton, openKindMenu } from './helpers/basket-kind.mjs';
import { noteMenuAction } from './helpers/note-menu.mjs';
import { edCmd } from './helpers/ed-tools.mjs';
// S69-98 NOTE-에버노트 ⑥(사용자 11/25 "좋아 모두 다 넣어!"): 노트 [넣기 ▾] → [문서 스캔] → 카메라(시험은 사진 고르기) → 네 모서리 맞추기 →
// [넣기] = 반듯하게 편 JPEG 한 장이 노트의 기존 [사진] 길(basket-files, 노트 첨부)로 올라가 글 안에 들어간다. 다시 그린 사진이라 EXIF가 없다.
// [취소]·뒤로가기는 아무것도 올리지 않는다. 합성 데이터, 390·1280.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const at='2026-10-22T01:00:00Z';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
async function paper(page){
 // 회색 바탕 위에 기운 흰 종이(글자 줄 몇 개) — 브라우저에서 그린 PNG(EXIF 없음, 위치 정보 없음).
 const b64=await page.evaluate(async()=>{const c=document.createElement('canvas');c.width=640;c.height=480;const g=c.getContext('2d');g.fillStyle='#555';g.fillRect(0,0,640,480);
  g.fillStyle='#eee';g.beginPath();g.moveTo(120,60);g.lineTo(540,90);g.lineTo(500,430);g.lineTo(90,400);g.closePath();g.fill();g.fillStyle='#222';for(let i=0;i<6;i++)g.fillRect(170,140+i*40,260,10);
  const blob=await new Promise(r=>c.toBlob(r,'image/png'));const buf=new Uint8Array(await blob.arrayBuffer());let s='';for(const x of buf)s+=String.fromCharCode(x);return btoa(s);});
 return Buffer.from(b64,'base64');
}
async function fixture(page,width){
 await page.setViewportSize({width,height:900});
 const notes=[{id:'n-text',workspace_id:'w',kind:'note',title:'스캔 노트',raw_text:'본문 첫 줄',occurred_at:at,created_at:at,updated_at:'2026-10-22T02:00:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},doc:null}];
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
 await page.route(SB+'/functions/v1/basket-files**',r=>{
  const req=r.request(),url=new URL(req.url());
  if(url.searchParams.get('action')==='photo')return r.fulfill({status:200,headers:{'content-type':'image/png'},body:PNG});
  if(url.searchParams.get('action')?.startsWith('ocr-'))return r.fulfill({status:404,json:{ok:false}});
  const raw=req.postDataBuffer()||Buffer.alloc(0),text=raw.toString('latin1');
  const noteId=text.match(/name="note_id"\r\n\r\n([^\r]+)/)?.[1],name=Buffer.from(text.match(/filename="([^"]*)"/)?.[1]||'','latin1').toString('utf8'),type=text.match(/Content-Type: (image\/[^\r]+)/)?.[1];
  const start=text.indexOf('\r\n\r\n',text.indexOf('filename='))+4,bytes=raw.subarray(start,start+4);
  uploads.push({noteId,name,type,jpeg:bytes[0]===0xff&&bytes[1]===0xd8,exif:text.slice(start,start+4096).includes('Exif')});
  const row=notes.find(n=>n.id===noteId);
  row.attachments=[...row.attachments,{drive_file_id:'scan_'+uploads.length,file_name:name,mime_type:'image/jpeg',size_bytes:100}];
  row.updated_at=`2026-10-22T05:00:${String(stamp++).padStart(2,'0')}Z`;
  return r.fulfill({json:{ok:true,note_id:row.id,attachments:row.attachments}});
 });
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await openKindMenu(page,'note');const kind=basketKindButton(page,'note');await expect(kind).toBeVisible();await kind.click();
 await expect(page.locator('[data-note-row="n-text"]')).toBeVisible();
 await page.locator('[data-note-row="n-text"]').click();
 await noteMenuAction(page,'data-note-edit',{width});
 const box=page.locator('[data-note-detail] [data-note-body-field]'),field=box.locator('.ProseMirror');
 await expect(field).toBeVisible();await field.click();await page.keyboard.press('Control+End');
 return {notes,uploads,errors,box,field};
}
const modal=page=>page.locator('#docScanModal');
for(const width of [390,1280]){
 test(`[문서 스캔]: 카메라로 찍기 → 네 모서리 맞추기 → 펴서 노트 사진으로 (${width})`,async({page})=>{
  test.setTimeout(60000);
  const f=await fixture(page,width),img=await paper(page);
  const chooser=page.waitForEvent('filechooser');
  await edCmd(f.box,'scan');
  const fc=await chooser;
  // 폰은 뒤 카메라로 바로 찍게(capture), 한 장만.
  expect(await fc.element().evaluate(el=>[el.getAttribute('capture'),el.accept,el.multiple])).toEqual(['environment','image/*',false]);
  await fc.setFiles([{name:'IMG_0001.png',mimeType:'image/png',buffer:img}]);
  await expect(modal(page)).toBeVisible();
  const dots=modal(page).locator('[data-dscan-dot]');
  await expect(dots).toHaveCount(4);
  await expect(modal(page).locator('[data-dscan-bright]')).toBeChecked();
  // 모서리 맞추기: 왼쪽 위 점을 끌고, 오른쪽 위 점은 키보드(화살표)로.
  const stage=await modal(page).locator('[data-dscan-stage]').boundingBox();
  const d0=await dots.nth(0).boundingBox();
  await page.mouse.move(d0.x+d0.width/2,d0.y+d0.height/2);await page.mouse.down();
  await page.mouse.move(stage.x+stage.width*0.19,stage.y+stage.height*0.13,{steps:5});await page.mouse.up();
  const moved=await dots.nth(0).boundingBox();
  expect(Math.abs(moved.x+moved.width/2-(stage.x+stage.width*0.19))).toBeLessThan(4);
  await dots.nth(1).focus();const k1=await dots.nth(1).boundingBox();await page.keyboard.press('ArrowLeft');
  expect((await dots.nth(1).boundingBox()).x).toBeLessThan(k1.x);
  // 창이 화면 밖으로 넘치지 않는다.
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await modal(page).locator('[data-sfm-ok]').click();
  await expect(modal(page)).toHaveCount(0);
  await expect(f.field.locator('img.ed-photo-img')).toHaveCount(1);
  // 사진은 스캔 전에 커서가 있던 자리(글 끝)에 들어간다.
  expect(await f.field.evaluate(el=>[...el.children].findIndex(n=>n.querySelector?.('img.ed-photo-img')||n.matches?.('img.ed-photo-img'))>[...el.children].findIndex(n=>n.textContent.includes('본문 첫 줄')))).toBe(true);
  expect(f.uploads).toHaveLength(1);
  expect(f.uploads[0]).toMatchObject({noteId:'n-text',type:'image/jpeg',jpeg:true,exif:false});
  expect(f.uploads[0].name).toMatch(/^스캔 \d{4}-\d{2}-\d{2} \d{4}\.jpg$/);
  expect(f.errors).toEqual([]);
 });
}
test('[문서 스캔] [취소]·뒤로가기: 아무것도 올리지 않고 글도 그대로 (390)',async({page})=>{
 const f=await fixture(page,390),img=await paper(page);
 for(const how of ['cancel','back']){
  const chooser=page.waitForEvent('filechooser');
  await edCmd(f.box,'scan');
  await (await chooser).setFiles([{name:'a.png',mimeType:'image/png',buffer:img}]);
  await expect(modal(page)).toBeVisible();
  if(how==='cancel')await modal(page).locator('[data-sfm-cancel]').click();else await page.goBack();
  await expect(modal(page)).toHaveCount(0);
 }
 await page.waitForTimeout(300);
 expect(f.uploads).toEqual([]);
 await expect(f.field.locator('img')).toHaveCount(0);
 await expect(page.locator('[data-note-detail] [data-note-body-field]')).toBeVisible();
 expect(f.errors).toEqual([]);
});
test('[문서 스캔]은 노트에만: 일기·공유 페이지 편집기에는 없다 (정적)',async()=>{
 const {readFileSync}=await import('node:fs');
 const src=readFileSync(new URL('../../app/ed-editor.js',import.meta.url),'utf8');
 expect(src).toContain("if (key === 'scan' && !photos?.scan) continue;");
});
