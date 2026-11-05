import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { basketKindButton, openKindMenu } from './helpers/basket-kind.mjs';
import { noteMenuAction } from './helpers/note-menu.mjs';
import { edWin, edWinText } from './helpers/note-editor.mjs';
// NOTE-파일그림넣기 (요청함 11/05): 노트 편집기 [넣기]에서 파일·그림 붙이기.
// ① 새 노트 창: [넣기] → [사진]·[파일]이 저장 전에도 들어간다(창 메모리에서 기다림, 그림은 그 기기 사본으로 보임). 저장하면 노트를 만든 뒤
//    기다리던 파일을 그 노트 id로 basket-files에 하나씩 올리고, 글 안 자리를 진짜 drive:<id>로 바꿔 한 번 더 쓴다(버전 검사).
//    저장 안 하고 닫으면 아무것도 올라가지 않는다.
// ② 읽기 화면: 글 안 그림을 누르면(또는 Enter) 첨부 카드와 같은 크게 보기가 열린다.
// ③ 노트 편집 칸(폰)의 [넣기]에 [사진]·[파일]이 있다(S48-21 회귀 확인).
// 합성 데이터, 폰 412 · PC 1280.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const at='2026-11-05T01:00:00Z';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
async function fixture(page,width){
 await page.setViewportSize({width,height:900});
 const notes=[{id:'n-text',workspace_id:'w',kind:'note',title:'글 노트',raw_text:'본문 첫 줄',occurred_at:at,created_at:at,updated_at:'2026-11-05T02:00:00Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},doc:null}];
 const writes=[],uploads=[],photos=[],errors=[];let stamp=10;
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
 await openHome(page);
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams,method=req.method();
  const pick=row=>(!q.get('kind')||'eq.'+row.kind===q.get('kind'))&&(!q.get('id')||'eq.'+row.id===q.get('id'))&&(!q.get('updated_at')||'eq.'+row.updated_at===q.get('updated_at'));
  if(method==='GET'){if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:notes.filter(pick).slice(Number(q.get('offset')||0)).map(x=>structuredClone(x))});}
  if(method==='POST'){const body=req.postDataJSON();writes.push({method,body});const row={id:'new-'+writes.length,occurred_at:at,created_at:at,updated_at:`2026-11-05T04:00:${String(stamp++).padStart(2,'0')}Z`,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},doc:null,...body};notes.unshift(row);return r.fulfill({status:201,json:[structuredClone(row)]});}
  if(method==='PATCH'){const body=req.postDataJSON();writes.push({method,query:Object.fromEntries(q),body});const hit=notes.filter(pick);for(const row of hit)Object.assign(row,body);return r.fulfill({json:hit.map(x=>structuredClone(x))});}
  return r.fulfill({status:500,json:{}});
 });
 await page.route(SB+'/rest/v1/app_record_links?**',r=>new URL(r.request().url()).searchParams.has('note_id')?r.fulfill({json:[]}):r.fallback());
 await page.route(SB+'/functions/v1/note-ai-title**',r=>r.fulfill({json:{ok:true}}));
 await page.route(SB+'/functions/v1/basket-files**',r=>{
  const url=new URL(r.request().url());
  if(url.searchParams.get('action')==='photo'){photos.push(Object.fromEntries(url.searchParams));return r.fulfill({status:200,headers:{'content-type':'image/png'},body:PNG});}
  const raw=r.request().postDataBuffer()?.toString('latin1')||'';
  const noteId=raw.match(/name="note_id"\r\n\r\n([^\r]+)/)?.[1],name=raw.match(/filename="([^"]*)"/)?.[1],type=raw.match(/Content-Type: ([^\r]+)/)?.[1];
  const shown=Buffer.from(name||'','latin1').toString('utf8');uploads.push({noteId,name:shown});
  const row=notes.find(n=>n.id===noteId);
  if(!row)return r.fulfill({status:404,json:{error:'없음',code:'note_not_found'}});
  row.attachments=[...row.attachments,{drive_file_id:'up_'+uploads.length,file_name:shown,mime_type:type||'application/octet-stream',size_bytes:4}];
  row.updated_at=`2026-11-05T05:00:${String(stamp++).padStart(2,'0')}Z`;
  return r.fulfill({json:{ok:true,note_id:row.id,attachments:row.attachments}});
 });
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await openKindMenu(page,'note');const kind=basketKindButton(page,'note');await expect(kind).toBeVisible();await kind.click();
 await expect(page.locator('[data-note-row="n-text"]')).toBeVisible();
 return {notes,writes,uploads,photos,errors};
}
async function insertPick(page,scope,width,cmd,files){
 if(width<761)await scope.locator('[data-ed-cmd="gInsert"]').click();
 const chooser=page.waitForEvent('filechooser');
 await scope.locator(`[data-ed-cmd="${cmd}"]`).click();
 await (await chooser).setFiles(files);
}
const noFrameWidth=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

for(const width of [412,1280]){
 test(`새 노트 창: [넣기] 사진·파일이 저장 전에 들어가고, 저장하면 그 노트 첨부로 올라가 글 안 자리가 진짜 id로 바뀐다 ${width}`,async({page})=>{
  const f=await fixture(page,width);
  await page.locator('[data-note-list] [data-quick-input]').fill('현장 점검');
  await page.locator('[data-note-list] [data-quick-big]').click();
  const win=edWin(page);await expect(win).toBeVisible();
  await edWinText(page).click();await page.keyboard.press('Control+End');
  await insertPick(page,win,width,'photo',[{name:'현장.png',mimeType:'image/png',buffer:PNG}]);
  const img=edWinText(page).locator('img.ed-photo-img');
  await expect(img).toHaveCount(1);
  expect(await img.getAttribute('src')).toMatch(/^blob:/);
  await insertPick(page,win,width,'file',[{name:'점검표.pdf',mimeType:'application/pdf',buffer:Buffer.alloc(2048,1)}]);
  await expect(edWinText(page).locator('.ed-file')).toContainText('점검표.pdf');
  // 저장 전에는 아무것도 올라가지 않는다.
  expect(f.uploads).toEqual([]);expect(f.writes).toEqual([]);
  expect(await noFrameWidth(page)).toBe(true);
  if(process.env.CAPTURE_DIR)await page.screenshot({path:`${process.env.CAPTURE_DIR}/note-new-insert-${width}.png`});
  await win.locator('[data-edw-save]').click();
  await expect(edWin(page)).toHaveCount(0);await expect(page.locator('#toast')).toContainText('노트로 저장했어요.');
  // 1) 노트 만들기: 기다리는 자리 없이(글자도 [사진]·[파일] 없이).
  expect(f.writes[0].method).toBe('POST');
  expect(JSON.stringify(f.writes[0].body.doc)).not.toMatch(/wait_|blob:|"image"|"file"/);
  expect(f.writes[0].body.raw_text).toBe('현장 점검');
  // 2) 그 노트 id로 하나씩 올림(글 순서).
  expect(f.uploads).toEqual([{noteId:'new-1',name:'현장.png'},{noteId:'new-1',name:'점검표.pdf'}]);
  // 3) 글 안 자리를 진짜 id로 바꿔 올린 뒤 버전으로 한 번 더 씀.
  const patch=f.writes.find(w=>w.method==='PATCH');
  expect(patch.query).toMatchObject({id:'eq.new-1',updated_at:'eq.2026-11-05T05:00:12Z'});
  const saved=JSON.stringify(patch.body.doc);
  expect(saved).toContain('"src":"drive:up_1"');expect(saved).toContain('"src":"drive:up_2"');expect(saved).not.toMatch(/wait_|blob:|https?:/);
  expect(patch.body.raw_text).toBe('현장 점검\n\n[사진]\n\n[파일: 점검표.pdf (2.0 KB)]');
  // 읽기 화면: 그림은 글 안에, 파일은 아래 카드로.
  const detail=page.locator('[data-note-detail]');
  await expect(detail.locator('[data-basket-read-text] img.ed-photo-img')).toHaveCount(1);
  await expect(detail.locator('[data-note-attachments] .file-line')).toHaveCount(2);
  // ② 글 안 그림을 누르면 크게 보기.
  const fig=detail.locator('[data-basket-read-text] [data-ed-zoom]');
  await expect(fig).toHaveAttribute('role','button');await expect(fig).toHaveAccessibleName('현장.png 크게 보기');
  await fig.click();
  const big=page.getByRole('dialog',{name:'현장.png'});
  await expect(big).toBeVisible();
  await big.locator('[data-basket-photo-close]').click();await expect(big).toHaveCount(0);
  // 키보드로도 연다(Enter).
  await fig.focus();await page.keyboard.press('Enter');await expect(page.getByRole('dialog',{name:'현장.png'})).toBeVisible();
  expect(f.errors).toEqual([]);
 });
}

test('새 노트 창: 사진을 넣고 저장하지 않고 닫으면 아무것도 올라가지 않는다',async({page})=>{
 const f=await fixture(page,412);
 await page.locator('[data-note-list] [data-quick-big]').click();
 const win=edWin(page);await expect(win).toBeVisible();
 await edWinText(page).click();
 await insertPick(page,win,412,'photo',[{name:'a.png',mimeType:'image/png',buffer:PNG}]);
 await expect(edWinText(page).locator('img.ed-photo-img')).toHaveCount(1);
 await win.locator('[data-close="edWindow"]').click();
 await page.getByRole('button',{name:'저장하지 않고 닫기'}).click();
 await expect(edWin(page)).toHaveCount(0);
 expect(f.uploads).toEqual([]);expect(f.writes).toEqual([]);
});

test('노트 편집 칸(폰 412): [넣기]에 [사진]·[파일]이 있고 [파일]은 그 노트 첨부로 올라가 글 안 카드가 된다',async({page})=>{
 const f=await fixture(page,412);
 await page.locator('[data-note-row="n-text"]').click();
 await noteMenuAction(page,'data-note-edit',{width:412});
 const box=page.locator('[data-note-detail] [data-note-body-field]');
 await expect(box.locator('.ProseMirror')).toBeVisible();
 await box.locator('[data-ed-cmd="gInsert"]').click();
 const menu=box.getByRole('group',{name:'넣을 것'});
 await expect(menu.locator('[data-ed-cmd="photo"]')).toBeVisible();await expect(menu.locator('[data-ed-cmd="file"]')).toBeVisible();
 await box.locator('[data-ed-cmd="gInsert"]').click();
 await box.locator('.ProseMirror').click();
 await insertPick(page,box,412,'file',[{name:'회의록.pdf',mimeType:'application/pdf',buffer:Buffer.alloc(100,1)}]);
 await expect(box.locator('.ed-file')).toContainText('회의록.pdf');
 expect(f.uploads).toEqual([{noteId:'n-text',name:'회의록.pdf'}]);
 expect(f.errors).toEqual([]);
});
