import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { openBasketMore } from './helpers/basket-more.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// JOURNAL-일기 1차: [일정] [달력|할 일|일지|일기]. The mock keeps one app_notes store, honours PostgREST filters and
// the diary checks the database has (kind=diary needs journal_day and ai_export_allowed=false, text or a photo, one per day),
// models basket-files upload (note_id, 20 per row), photo view (?action=photo) and note-delete. The clock is 2026-10-06 KST.
const at='2026-10-05T01:00:00Z';
const photo=(id,name=id+'.jpg')=>({drive_file_id:id,file_name:name,mime_type:'image/jpeg',size_bytes:1200});
function store(){
 return [
  {id:'b1',workspace_id:'w',kind:'basket',title:null,journal_day:null,raw_text:'합성 바구니 메모',occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}},
  {id:'d3',workspace_id:'w',kind:'diary',title:null,journal_day:'2026-10-03',raw_text:'가을 산책 DIARY_TEXT_SECRET',occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:false,attachments:[photo('pa'),photo('pb')],metadata:{}},
  {id:'d4',workspace_id:'w',kind:'diary',title:null,journal_day:'2026-10-04',raw_text:'글만 쓴 날',occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:false,attachments:[],metadata:{}},
 ];
}
// Small images for the photo view: a coloured PNG per Drive id.
async function pngFor(page,color,w=40,h=30){
 const url=await page.evaluate(([c,w,h])=>{const k=document.createElement('canvas');k.width=w;k.height=h;const x=k.getContext('2d');x.fillStyle=c;x.fillRect(0,0,w,h);return k.toDataURL('image/png');},[color,w,h]);
 return Buffer.from(url.split(',')[1],'base64');
}
function jpegSize(buffer){
 for(let i=2;i<buffer.length-9;){
  if(buffer[i]!==0xff){i++;continue;}
  const marker=buffer[i+1],len=buffer.readUInt16BE(i+2);
  if([0xc0,0xc1,0xc2].includes(marker))return {height:buffer.readUInt16BE(i+5),width:buffer.readUInt16BE(i+7)};
  i+=2+len;
 }
 return null;
}
function valid(row){
 if(row.kind==='diary'&&(!row.journal_day||row.ai_export_allowed!==false))return false;
 if(row.kind!=='note'&&!(row.raw_text?.length>=1||row.attachments?.length>=1))return false;
 return (row.attachments||[]).length<=20;
}
async function fixture(page,{rows=store(),failUploadAt=0,photoView=true,width=390}={}){
 const writes=[],uploads=[],photoReads=[],deletes=[],errors=[];let uploadCount=0;
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
 await page.setViewportSize({width,height:900});
 await openHome(page);
 const img=await pngFor(page,'#7a5cc0');
 const match=(row,q)=>{
  for(const [k,v] of q.entries()){
   if(['select','order','limit','offset'].includes(k))continue;
   const [op,...rest]=v.split('.'),val=rest.join('.');
   const cell=k==='attachments'?JSON.stringify(row.attachments):row[k];
   if(op==='eq'&&String(cell)!==val)return false;
   if(op==='gte'&&!(String(cell)>=val))return false;
   if(op==='lte'&&!(String(cell)<=val))return false;
  }
  return true;
 };
 await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
  const req=r.request(),q=new URL(req.url()).searchParams,method=req.method();
  if(method==='GET'){if(q.get('metadata'))return r.fulfill({json:[]});return r.fulfill({json:rows.filter(row=>match(row,q)).slice(Number(q.get('offset')||0))});}
  if(method==='POST'){
   const body=req.postDataJSON();writes.push({method,body});
   const row={id:'d-new-'+writes.length,title:null,journal_day:null,occurred_at:at,created_at:at,updated_at:'2026-10-06T01:00:0'+writes.length+'Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{},kind:'basket',...body};
   if(rows.some(x=>x.kind==='diary'&&x.journal_day===row.journal_day&&row.kind==='diary'))return r.fulfill({status:409,json:{code:'23505',message:'duplicate key'}});
   if(!valid(row))return r.fulfill({status:400,json:{code:'23514'}});
   rows.push(row);return r.fulfill({status:201,json:[row]});
  }
  if(method==='PATCH'){
   const body=req.postDataJSON();writes.push({method,query:Object.fromEntries(q),body});
   const hit=rows.filter(row=>match(row,q));
   for(const row of hit){const next={...row,...body};if(!valid(next))return r.fulfill({status:400,json:{code:'23514'}});Object.assign(row,next);}
   return r.fulfill({json:hit});
  }
  if(method==='DELETE'){
   const hit=rows.filter(row=>match(row,q));deletes.push(Object.fromEntries(q));
   for(const row of hit)rows.splice(rows.indexOf(row),1);
   return r.fulfill({json:hit.map(row=>({id:row.id}))});
  }
  return r.fulfill({status:500,json:{}});
 });
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/basket-files',async r=>{
  const req=r.request(),u=new URL(req.url());
  if(req.method()==='GET'&&u.searchParams.get('action')==='photo'){
   photoReads.push(Object.fromEntries(u.searchParams));
   if(!photoView)return r.fulfill({status:400,json:{error:'bad',code:'OCR_REQUEST_INVALID'}});
   const row=rows.find(x=>x.id===u.searchParams.get('note_id'));
   if(!row?.attachments.some(a=>a.drive_file_id===u.searchParams.get('file_id')))return r.fulfill({status:404,json:{action:'photo',ok:false,code:'photo_not_found'}});
   return r.fulfill({status:200,contentType:'image/png',headers:{'cache-control':'private, max-age=3600'},body:img});
  }
  if(req.method()==='POST'&&u.searchParams.get('action')==='note-delete'){
   const body=req.postDataJSON(),row=rows.find(x=>x.id===body.note_id);
   if(!row)return r.fulfill({status:404,json:{action:'note-delete',note_id:body.note_id,attachments_total:0,trashed:0,failed:0,unknown:0,ok:false,note_deleted:false,code:'note_not_found'}});
   rows.splice(rows.indexOf(row),1);deletes.push({note_delete:body.note_id});
   return r.fulfill({json:{action:'note-delete',note_id:body.note_id,attachments_total:row.attachments.length,trashed:row.attachments.length,failed:0,unknown:0,ok:true,note_deleted:true}});
  }
  if(req.method()==='POST'){
   uploadCount++;
   const raw=req.postDataBuffer(),text=raw.toString('latin1');
   const id=text.match(/name="note_id"\r\n\r\n([^\r]+)/)?.[1];
   const head=text.match(/name="file"; filename="([^"]+)"\r\nContent-Type: ([^\r]+)\r\n\r\n/);
   const start=text.indexOf(head[0])+head[0].length,end=text.indexOf('\r\n--',start);
   const bytes=raw.subarray(start,end);
   uploads.push({note_id:id,name:head[1],type:head[2],size:jpegSize(bytes),raw_text:/name="raw_text"/.test(text)});
   if(failUploadAt&&uploadCount===failUploadAt)return r.fulfill({status:503,json:{error:'첨부를 저장하지 못했습니다.',code:'drive_folder_failed'}});
   const row=rows.find(x=>x.id===id);
   if(!row)return r.fulfill({status:404,json:{code:'note_not_found'}});
   if(row.attachments.length>=20)return r.fulfill({status:400,json:{code:'too_many_attachments'}});
   row.attachments=[...row.attachments,{drive_file_id:'up'+uploadCount,file_name:head[1],mime_type:head[2],size_bytes:bytes.length}];
   row.updated_at=`2026-10-06T02:00:${String(uploadCount).padStart(2,'0')}Z`;
   return r.fulfill({json:{ok:true,note_id:id,attachments:row.attachments}});
  }
  return r.fulfill({status:500,json:{}});
 });
 return {rows,writes,uploads,photoReads,deletes,errors};
}
async function openDiary(page,width){
 if(width<=760){
  await page.locator('.mobile-tabs [data-mobile-schedule-tab]').click();
  await expect(page.locator('#calendarView')).toBeVisible();
  await page.locator('#calendarView .schedule-switch [data-view="diary"]').click();
 }else await page.locator('.app-nav [data-view="diary"]').click();
 await expect(page.locator('#diaryView')).toBeVisible();
 await expect(page.locator('#diaryRoot [data-diary-title]')).toHaveText('2026년 10월');
}
const cell=(page,day)=>page.locator(`#diaryRoot [data-diary-day="${day}"]`);
async function photoFiles(page,n,{w=3000,h=1500}={}){
 const out=[];for(let i=0;i<n;i++)out.push({name:`IMG_${i+1}.png`,mimeType:'image/png',buffer:await pngFor(page,['#e85','#5a8','#58e'][i%3],w,h)});return out;
}

test('[일정] 머리줄 [달력|할 일|일지|일기]: 높이 32·고른 쪽 회색, [일지] 준비 중, 탭은 마지막으로 본 쪽',async({page})=>{
 const f=await fixture(page);
 await page.locator('.mobile-tabs [data-mobile-schedule-tab]').click();
 const sw=page.locator('#calendarView .schedule-switch');
 await expect(sw).toBeVisible();await expect(sw.locator('button')).toHaveText(['달력','할 일','일지','일기']);
 // UI-버튼작게 ③: 폰은 아래 탭 바로 위 한 줄.
 const box=await sw.boundingBox(),tabs=await page.locator('.mobile-tabs').boundingBox();
 expect(Math.round(box.height)).toBe(32);expect(Math.round(tabs.y-(box.y+box.height))).toBe(6);expect(box.x+box.width).toBeLessThanOrEqual(390);
 await sw.locator('[data-view="journal"]').click();
 await expect(page.locator('#journalView')).toBeVisible();await expect(page.locator('#journalView')).toContainText('준비 중이에요');
 const pressed=page.locator('#journalView .schedule-switch [aria-pressed="true"]');await expect(pressed).toHaveText('일지');
 expect(await pressed.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(await page.evaluate(()=>{const e=document.createElement('span');e.style.backgroundColor='var(--ds-kind-other-soft)';document.body.append(e);const c=getComputedStyle(e).backgroundColor;e.remove();return c;}));
 await page.locator('#journalView .schedule-switch [data-view="diary"]').click();await expect(page.locator('#diaryView')).toBeVisible();
 await page.locator('.mobile-tabs [data-view="home"]').click();await page.locator('.mobile-tabs [data-mobile-schedule-tab]').click();
 await expect(page.locator('#diaryView')).toBeVisible();await expect(page).toHaveURL(/view=diary/);
 await expect(page.locator('.mobile-tabs [data-mobile-schedule-tab]')).toHaveAttribute('aria-current','page');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

for(const width of [390,1280]){
 test(`[일기] 달력: 사진 있는 날은 첫 사진이 칸을 채우고 글만 있는 날은 점, 날짜 누르면 크게·옆으로·[별표] 안내, 뒤로가기 ${width}`,async({page})=>{
  const rows=store();rows[1].attachments=['pa','pb','pc','pd','pe','pf'].map(id=>photo(id));
  const f=await fixture(page,{width,rows});await openDiary(page,width);
  const photoDay=cell(page,'2026-10-03');
  await expect(photoDay.locator('.diary-photo img')).toBeVisible();
  const [c,i]=await Promise.all([photoDay.boundingBox(),photoDay.locator('img').boundingBox()]);
  expect(Math.abs(c.width-i.width)).toBeLessThan(3);expect(Math.abs(c.height-i.height)).toBeLessThan(3);
  await expect(photoDay).toHaveAttribute('aria-label','10월 3일, 사진 6장');
  await expect(cell(page,'2026-10-04').locator('[data-diary-dot]')).toBeVisible();await expect(cell(page,'2026-10-04').locator('img')).toHaveCount(0);
  await expect(cell(page,'2026-10-05').locator('[data-diary-dot],img')).toHaveCount(0);
  await expect(cell(page,'2026-10-06')).toHaveAttribute('aria-current','date');
  expect(f.photoReads.every(r=>r.size==='small')).toBe(true);
  await photoDay.click();
  const detail=page.locator('#diaryRoot [data-diary-detail]');
  await expect(detail.locator('h3')).toHaveText('10월 3일 토요일');
  // 작은 정사각 격자(폰 한 줄 4칸, PR 1의 "작게"), 그 아래 글.
  const grid=detail.locator('[data-diary-grid] .diary-grid-item');
  await expect(grid).toHaveCount(6);await expect(grid.locator('img').first()).toBeVisible();
  const boxes=await grid.evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:r.width,h:r.height};}));
  if(width<=760)expect(boxes.filter(b=>b.y===boxes[0].y)).toHaveLength(4);
  for(const b of boxes)expect(Math.abs(b.w-b.h)).toBeLessThan(1.5);
  expect(f.photoReads.some(r=>r.size==='large')).toBe(false);
  expect(await detail.evaluate(el=>{const g=el.querySelector('[data-diary-grid]').getBoundingClientRect(),t=el.querySelector('[data-diary-text-view]').getBoundingClientRect();return t.top>=g.bottom-1;})).toBe(true);
  await expect(detail.locator('[data-diary-text-view]')).toHaveText('가을 산책 DIARY_TEXT_SECRET');
  // 누르면 화면 가득 크게(PR 1의 "크게"), 옆으로 넘기기·"3 / 6"·☆ 안내, 뒤로가기는 크게 보기부터 닫는다.
  await grid.nth(2).click();
  const viewer=page.locator('#diaryRoot [data-diary-viewer]');
  await expect(viewer).toBeVisible();
  const vb=await viewer.boundingBox();expect(vb.width).toBe(width);expect(vb.height).toBe(900);
  await expect(viewer.locator('[data-diary-viewer-count]')).toHaveText('3 / 6');
  await expect(viewer.locator('.diary-slide').nth(2).locator('img')).toBeVisible();
  expect(f.photoReads.some(r=>r.size==='large'&&r.note_id==='d3'&&r.file_id==='pc')).toBe(true);
  const vstrip=viewer.locator('[data-diary-viewer-strip]');
  await vstrip.evaluate(el=>el.scrollTo({left:el.clientWidth*3}));
  await expect(viewer.locator('[data-diary-viewer-count]')).toHaveText('4 / 6');
  await page.keyboard.press('ArrowRight');await expect(viewer.locator('[data-diary-viewer-count]')).toHaveText('5 / 6');
  await viewer.locator('[data-diary-star]').click();
  await expect(viewer.locator('[data-diary-viewer-note]')).toHaveText('원드라이브 연결 뒤 쓸 수 있어요');
  await page.goBack();
  await expect(viewer).toHaveCount(0);await expect(detail).toBeVisible();
  await grid.nth(0).click();await expect(viewer.locator('[data-diary-viewer-count]')).toHaveText('1 / 6');
  await viewer.locator('[data-diary-viewer-close]').click();
  await expect(viewer).toHaveCount(0);await expect(grid.nth(0)).toBeFocused();
  const all=detail.locator('[data-diary-source="all"]'),star=detail.locator('[data-diary-source="star"]');
  await expect(all).toHaveAttribute('aria-pressed','true');
  await star.click();
  await expect(detail.locator('[data-diary-star-note]')).toHaveText('원드라이브 연결 뒤 쓸 수 있어요');await expect(detail.locator('[data-diary-grid]')).toHaveCount(0);
  await detail.locator('[data-diary-source="all"]').click();await expect(grid).toHaveCount(6);
  // 뒤로가기는 열린 날짜부터 닫는다.
  await page.goBack();
  await expect(detail).toBeHidden();await expect(page.locator('#diaryView')).toBeVisible();
  // 다음 달로 넘기면 그 달만 읽는다.
  await page.locator('#diaryRoot [data-diary-next]').click();
  await expect(page.locator('#diaryRoot [data-diary-title]')).toHaveText('2026년 11월');
  await expect(page.locator('#diaryRoot [data-diary-status]')).toContainText('아직 일기가 없어요');
  await page.locator('#diaryRoot [data-diary-prev]').click();await expect(cell(page,'2026-10-03').locator('img')).toBeVisible();
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
 });
}

test('사진 보기가 아직 안 되면(배포 전) 칸은 사진 표시, 크게 보기는 "Drive에서 열기" 링크',async({page})=>{
 const f=await fixture(page,{photoView:false});await openDiary(page,390);
 await expect(cell(page,'2026-10-03').locator('.diary-photo-mark')).toHaveText('사진');
 await expect(cell(page,'2026-10-03').locator('a')).toHaveCount(0);
 await cell(page,'2026-10-03').click();
 await expect(page.locator('#diaryRoot [data-diary-grid] .diary-photo-mark')).toHaveCount(2);
 await page.locator('#diaryRoot [data-diary-grid] .diary-grid-item').first().click();
 const links=page.locator('#diaryRoot [data-diary-viewer] a.diary-photo-link');
 await expect(links).toHaveCount(2);await expect(links.first()).toHaveAttribute('href','https://drive.google.com/file/d/pa/view');
 await expect(links.first()).toHaveText('Drive에서 열기');
 expect(f.errors).toEqual([]);
});

test('쓰기 — 사진만: 그날 행을 먼저 만들고(일기·AI 끔) 2048px JPEG로 줄인 사진을 note_id로 한 장씩, 칸에 첫 사진',async({page})=>{
 const f=await fixture(page);await openDiary(page,390);
 const plus=page.locator('#diaryRoot #newDiaryBtn');
 expect(await plus.evaluate(el=>getComputedStyle(el).position)).toBe('fixed');
 await plus.click();
 const ed=page.locator('#diaryRoot [data-diary-editor]');
 await expect(ed.locator('h3')).toHaveText('일기 쓰기');await expect(ed.locator('[data-diary-date]')).toHaveValue('2026-10-06');
 // 사진 고르기가 글보다 앞.
 const [pick,text]=await Promise.all([ed.locator('[data-diary-pick]').boundingBox(),ed.locator('[data-diary-text]').boundingBox()]);expect(pick.y).toBeLessThan(text.y);
 await ed.locator('[data-diary-input]').setInputFiles(await photoFiles(page,2));
 await expect(ed.locator('.diary-thumb.pending')).toHaveCount(2);await expect(ed.locator('[data-diary-count]')).toContainText('2/20장');
 await ed.locator('[data-diary-save]').click();
 await expect(ed).toBeHidden();
 await expect(page.locator('#diaryRoot [data-diary-status]')).toHaveText('일기를 저장했어요.');
 const post=f.writes.find(w=>w.method==='POST');
 expect(post.body).toMatchObject({workspace_id:'w',kind:'diary',journal_day:'2026-10-06',ai_export_allowed:false});
 expect(f.uploads).toHaveLength(2);
 for(const u of f.uploads){expect(u.note_id).toBe(post.body.id??'d-new-1');expect(u.type).toBe('image/jpeg');expect(u.name).toMatch(/^IMG_\d\.jpg$/);expect(u.size).toEqual({width:2048,height:1024});expect(u.raw_text).toBe(false);}
 // 사진이 붙은 뒤 자리 지킴 글(공백 하나)은 지운다.
 const row=f.rows.find(r=>r.journal_day==='2026-10-06');expect(row.raw_text).toBe('');expect(row.attachments).toHaveLength(2);
 await expect(cell(page,'2026-10-06').locator('img')).toBeVisible();
 await expect(page.locator('#diaryRoot [data-diary-detail] h3')).toHaveText('10월 6일 화요일');
 await expect(page.locator('#diaryRoot [data-diary-detail] .diary-grid-item')).toHaveCount(2);
 expect(f.errors).toEqual([]);
});

test('쓰기 — 글만 / 둘 다: 글만이면 점, 둘 다면 사진과 글',async({page})=>{
 const f=await fixture(page);await openDiary(page,390);
 await cell(page,'2026-10-01').click();
 // UI-일기손질 ③: no button in the day box; the shared [+] writes the chosen day.
 await expect(page.locator('#diaryRoot [data-diary-detail] button.primary')).toHaveCount(0);
 await page.locator('#diaryRoot #newDiaryBtn').click();
 const ed=page.locator('#diaryRoot [data-diary-editor]');await expect(ed.locator('[data-diary-date]')).toHaveValue('2026-10-01');
 await ed.locator('[data-diary-text]').fill('글만 남긴 하루');await ed.locator('[data-diary-save]').click();
 await expect(cell(page,'2026-10-01').locator('[data-diary-dot]')).toBeVisible();
 expect(f.writes.filter(w=>w.method==='POST').at(-1).body).toMatchObject({kind:'diary',journal_day:'2026-10-01',raw_text:'글만 남긴 하루',ai_export_allowed:false});
 expect(f.uploads).toHaveLength(0);
 await page.locator('#diaryRoot [data-diary-detail-close]').click();
 await page.locator('#diaryRoot #newDiaryBtn').click();
 await ed.locator('[data-diary-date]').fill('2026-10-02');
 await ed.locator('[data-diary-input]').setInputFiles(await photoFiles(page,1,{w:800,h:600}));
 await ed.locator('[data-diary-text]').fill('사진과 글');await ed.locator('[data-diary-save]').click();
 await expect(cell(page,'2026-10-02').locator('img')).toBeVisible();
 await expect(page.locator('#diaryRoot [data-diary-text-view]')).toHaveText('사진과 글');
 expect(f.uploads.at(-1).size).toEqual({width:800,height:600});
 expect(f.rows.find(r=>r.journal_day==='2026-10-02').raw_text).toBe('사진과 글');
 expect(f.errors).toEqual([]);
});

test('같은 날은 하나: [+]는 있는 날을 고치기로, 날짜를 있는 날로 바꾸면 고치기로, 서버 409도 고치기로',async({page})=>{
 const f=await fixture(page);await openDiary(page,390);
 await cell(page,'2026-10-03').click();
 await page.locator('#diaryRoot #newDiaryBtn').click();
 const ed=page.locator('#diaryRoot [data-diary-editor]');
 await expect(ed.locator('h3')).toHaveText('일기 고치기');await expect(ed.locator('[data-diary-text]')).toHaveValue('가을 산책 DIARY_TEXT_SECRET');
 await expect(ed.locator('[data-diary-date]')).toBeDisabled();await expect(ed.locator('[data-diary-thumb]')).toHaveCount(2);
 await ed.locator('[data-diary-text]').fill('가을 산책, 고쳐 씀');await ed.locator('[data-diary-save]').click();
 await expect(page.locator('#diaryRoot [data-diary-text-view]')).toHaveText('가을 산책, 고쳐 씀');
 expect(f.writes.filter(w=>w.method==='POST')).toHaveLength(0);
 expect(f.writes.at(-1)).toMatchObject({method:'PATCH',query:{kind:'eq.diary',id:'eq.d3'},body:{raw_text:'가을 산책, 고쳐 씀'}});
 // 새로 쓰다 날짜를 이미 있는 날로 바꾸면 고치기로 열리고 쓰던 글은 아래에 붙는다.
 await page.locator('#diaryRoot [data-diary-detail-close]').click();
 await page.locator('#diaryRoot #newDiaryBtn').click();await expect(ed.locator('h3')).toHaveText('일기 쓰기');
 await ed.locator('[data-diary-text]').fill('덧붙일 말');await ed.locator('[data-diary-date]').fill('2026-10-04');
 await expect(ed.locator('h3')).toHaveText('일기 고치기');await expect(ed.locator('[data-diary-editor-status]')).toHaveText('이 날 일기가 이미 있어 고치기로 열었어요.');
 await expect(ed.locator('[data-diary-text]')).toHaveValue('글만 쓴 날\n\n덧붙일 말');
 page.once('dialog',d=>d.accept());await ed.locator('[data-diary-editor-close]').click();
 // 다른 곳에서 먼저 같은 날을 만들었으면(409) 저장하지 않고 고치기로 연다.
 await page.locator('#diaryRoot #newDiaryBtn').click();await ed.locator('[data-diary-text]').fill('늦게 쓴 글');
 f.rows.push({id:'d6',workspace_id:'w',kind:'diary',title:null,journal_day:'2026-10-06',raw_text:'다른 기기에서 쓴 글',occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:false,attachments:[],metadata:{}});
 await ed.locator('[data-diary-save]').click();
 await expect(ed.locator('h3')).toHaveText('일기 고치기');await expect(ed.locator('[data-diary-editor-status]')).toHaveText('이 날 일기가 이미 있어요. 고치기로 열게요.');
 await expect(ed.locator('[data-diary-text]')).toHaveValue('다른 기기에서 쓴 글\n\n늦게 쓴 글');
 expect(f.rows.filter(r=>r.journal_day==='2026-10-06')).toHaveLength(1);
 expect(f.errors).toEqual([]);
});

test('21장째는 넣지 않고 안내, 중간에 실패하면 올린 사진은 남고 [저장]으로 이어 올림',async({page})=>{
 const rows=store();rows[1].attachments=Array.from({length:18},(_,i)=>photo('p'+i));
 const f=await fixture(page,{rows,failUploadAt:2});await openDiary(page,390);
 await cell(page,'2026-10-03').click();await page.locator('#diaryRoot [data-diary-edit]').click();
 const ed=page.locator('#diaryRoot [data-diary-editor]');
 await ed.locator('[data-diary-input]').setInputFiles(await photoFiles(page,3,{w:300,h:200}));
 await expect(ed.locator('[data-diary-editor-status]')).toHaveText('일기 사진은 하루 20장까지예요. 1장은 넣지 않았어요.');
 await expect(ed.locator('.diary-thumb.pending')).toHaveCount(2);await expect(ed.locator('[data-diary-count]')).toContainText('20/20장');
 await expect(ed.locator('[data-diary-pick]')).toBeDisabled();
 await ed.locator('[data-diary-save]').click();
 await expect(ed.locator('[data-diary-editor-status]')).toContainText("1장은 올렸어요. 'IMG_2.png'부터 올리지 못했어요.");
 await expect(ed).toBeVisible();await expect(ed.locator('.diary-thumb.pending')).toHaveCount(1);
 expect(f.rows[1].attachments).toHaveLength(19);
 await ed.locator('[data-diary-save]').click();
 await expect(ed).toBeHidden();expect(f.rows[1].attachments).toHaveLength(20);
 expect(f.uploads.map(u=>u.note_id)).toEqual(['d3','d3','d3']);
 expect(f.errors).toEqual([]);
});

test('고치기에서 사진 하나 빼기, 글 없는 일기의 마지막 사진은 막고, [일기 지우기]는 note-delete(휴지통)',async({page})=>{
 const rows=store();rows.push({id:'d5',workspace_id:'w',kind:'diary',title:null,journal_day:'2026-10-05',raw_text:'',occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:false,attachments:[photo('only')],metadata:{}});
 const f=await fixture(page,{rows});await openDiary(page,390);
 await cell(page,'2026-10-03').click();await page.locator('#diaryRoot [data-diary-edit]').click();
 const ed=page.locator('#diaryRoot [data-diary-editor]');
 page.once('dialog',d=>{expect(d.message()).toContain('Drive "Web2 바구니" 폴더의 파일은 그대로 남아요');d.accept();});
 await ed.locator('[data-diary-remove="pa"]').click();
 await expect(ed.locator('[data-diary-thumb]')).toHaveCount(1);await expect(ed.locator('[data-diary-editor-status]')).toHaveText('사진을 뺐어요.');
 expect(f.writes.at(-1)).toMatchObject({method:'PATCH',query:{id:'eq.d3',kind:'eq.diary',updated_at:'eq.'+at},body:{attachments:[photo('pb')]}});
 await ed.locator('[data-diary-editor-close]').click();
 await cell(page,'2026-10-05').click();await page.locator('#diaryRoot [data-diary-edit]').click();
 page.once('dialog',d=>d.accept());await ed.locator('[data-diary-remove="only"]').click();
 await expect(ed.locator('[data-diary-editor-status]')).toContainText('사진 한 장만 있는 일기라 이 사진은 뺄 수 없어요');
 expect(f.rows.find(r=>r.id==='d5').attachments).toHaveLength(1);
 let asked='';page.once('dialog',d=>{asked=d.message();d.accept();});
 await ed.locator('[data-diary-delete]').click();
 await expect(ed).toBeHidden();
 expect(asked).toBe('10월 5일 일기를 지웁니다. 사진 1장은 Drive 휴지통으로 옮깁니다(30일 안에 복구 가능).');
 await expect(page.locator('#diaryRoot [data-diary-status]')).toHaveText('일기를 지우고 첨부를 Drive 휴지통으로 옮겼어요.');
 expect(f.deletes).toContainEqual({note_delete:'d5'});await expect(cell(page,'2026-10-05').locator('img')).toHaveCount(0);
 expect(f.errors).toEqual([]);
});

test('폰 뒤로가기: 쓰기 창 → 날짜 순서로 닫힘',async({page})=>{
 const f=await fixture(page);await openDiary(page,390);
 await cell(page,'2026-10-03').click();await page.locator('#diaryRoot [data-diary-edit]').click();
 const ed=page.locator('#diaryRoot [data-diary-editor]'),detail=page.locator('#diaryRoot [data-diary-detail]');
 await expect(ed).toBeVisible();await expect(page.locator('#diaryRoot [data-diary-cal]')).toBeHidden();
 await page.goBack();await expect(ed).toBeHidden();await expect(detail).toBeVisible();await expect(page.locator('#diaryRoot [data-diary-cal]')).toBeVisible();
 await page.goBack();await expect(detail).toBeHidden();await expect(page.locator('#diaryView')).toBeVisible();
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

test('일기는 바구니 목록·AI 분류 요청 복사에 나오지 않는다',async({page})=>{
 const f=await fixture(page);
 await page.evaluate(()=>{window.__copied=[];const keep=t=>{window.__copied.push(String(t));return Promise.resolve();};navigator.clipboard.writeText=keep;navigator.clipboard.write=async items=>keep(await (await items[0].getType('text/plain')).text());});
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 await expect(page.locator('[data-basket-row="b1"]')).toBeVisible();await expect(page.locator('[data-basket-row]')).toHaveCount(1);
 await expect(page.locator('#basketView')).not.toContainText('DIARY_TEXT_SECRET');
 await openBasketMore(page);await page.locator('#basketMoreMenu [data-handoff-copy]').click();
 await expect.poll(()=>page.evaluate(()=>window.__copied.length)).toBeGreaterThan(0);
 const copied=await page.evaluate(()=>window.__copied.join('\n'));
 expect(copied).toContain('합성 바구니 메모');expect(copied).not.toContain('DIARY_TEXT_SECRET');expect(copied).not.toContain('글만 쓴 날');
 expect(f.errors).toEqual([]);
});

test('[달력] 날짜 목록 맨 위에 그날 일기 첫 사진 작게, 누르면 [일기]의 그날',async({page})=>{
 const f=await fixture(page);
 await page.locator('.mobile-tabs [data-mobile-schedule-tab]').click();await expect(page.locator('#calendarView')).toBeVisible();
 await page.locator('#calendarView [data-calendar-view="month"]').click();
 await page.locator('#calendarGrid .cmv-date-list[data-date="2026-10-03"]').click();
 const preview=page.locator('#calendarDayList #calendarDayDiary [data-diary-preview="2026-10-03"]');
 await expect(preview).toBeVisible();await expect(preview.locator('img')).toBeVisible();await expect(preview).toContainText('가을 산책');
 const list=await page.locator('#calendarDayList').boundingBox(),pb=await preview.boundingBox();expect(pb.y-list.y).toBeLessThan(12);
 const thumb=await preview.locator('img').boundingBox();expect(thumb.width).toBeLessThanOrEqual(48.5);
 await preview.click();
 await expect(page.locator('#calendarDayModal')).toBeHidden();
 await expect(page.locator('#diaryView')).toBeVisible();
 await expect(page.locator('#diaryRoot [data-diary-detail] h3')).toHaveText('10월 3일 토요일');
 await expect(cell(page,'2026-10-03')).toHaveAttribute('aria-pressed','true');
 // 일기 없는 날은 미리보기 없음.
 await page.locator('#diaryView .schedule-switch [data-view="calendar"]').click();
 await page.locator('#calendarGrid .cmv-date-list[data-date="2026-10-05"]').click();
 await expect(page.locator('#calendarDayModal')).toBeVisible();await expect(page.locator('#calendarDayDiary')).toHaveCount(0);
 expect(f.errors).toEqual([]);
});

// BUG-오늘버튼: [오늘] goes to this month and chooses today (its detail opens), like tapping the day.
for(const width of [390,1280]){
 test(`[일기] [오늘]: 이번 달에서 다른 날을 골랐어도, 다른 달에서도 오늘이 골라지고 상세가 열린다 ${width}`,async({page})=>{
  const rows=store();rows.push({id:'d6',workspace_id:'w',kind:'diary',title:null,journal_day:'2026-10-06',raw_text:'오늘 쓴 일기',occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:false,attachments:[],metadata:{}});
  const f=await fixture(page,{width,rows});await openDiary(page,width);
  const today=page.locator('#diaryRoot [data-diary-today]'),detail=page.locator('#diaryRoot [data-diary-detail]'),title=page.locator('#diaryRoot [data-diary-title]');
  // 아무 날도 안 고른 상태 → 오늘.
  await today.click();
  await expect(cell(page,'2026-10-06')).toHaveAttribute('aria-pressed','true');
  await expect(detail.locator('h3')).toHaveText('10월 6일 화요일');await expect(detail.locator('[data-diary-text-view]')).toHaveText('오늘 쓴 일기');
  // 이미 오늘이 골라져 있으면 그대로(닫히지 않음).
  await today.click();
  await expect(detail).toBeVisible();await expect(cell(page,'2026-10-06')).toHaveAttribute('aria-pressed','true');
  // 이번 달에서 다른 날을 고른 뒤 → 오늘로 바뀜.
  await cell(page,'2026-10-03').click();await expect(detail.locator('h3')).toHaveText('10월 3일 토요일');
  await today.click();
  await expect(detail.locator('h3')).toHaveText('10월 6일 화요일');
  await expect(cell(page,'2026-10-06')).toHaveAttribute('aria-pressed','true');await expect(cell(page,'2026-10-03')).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('#diaryRoot [data-diary-day][aria-pressed="true"]')).toHaveCount(1);
  // 다른 달 → 이번 달로 오고 오늘이 골라짐.
  await page.locator('#diaryRoot [data-diary-prev]').click();await page.locator('#diaryRoot [data-diary-prev]').click();
  await expect(title).toHaveText('2026년 8월');await expect(detail).toBeHidden();
  await today.click();
  await expect(title).toHaveText('2026년 10월');
  await expect(cell(page,'2026-10-06')).toHaveAttribute('aria-pressed','true');
  await expect(detail.locator('h3')).toHaveText('10월 6일 화요일');await expect(detail.locator('[data-diary-text-view]')).toHaveText('오늘 쓴 일기');
  // 뒤로가기는 열린 날짜 하나만 닫는다(기록이 겹쳐 쌓이지 않음).
  await page.goBack();await expect(detail).toBeHidden();await expect(page.locator('#diaryView')).toBeVisible();
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
 });
}

test('[일기] [오늘]: 오늘 일기가 없으면 "이 날 일기가 없어요", [+]는 오늘을 쓴다',async({page})=>{
 const f=await fixture(page);await openDiary(page,390);
 await page.locator('#diaryRoot [data-diary-next]').click();await expect(page.locator('#diaryRoot [data-diary-title]')).toHaveText('2026년 11월');
 await page.locator('#diaryRoot [data-diary-today]').click();
 const detail=page.locator('#diaryRoot [data-diary-detail]');
 await expect(page.locator('#diaryRoot [data-diary-title]')).toHaveText('2026년 10월');
 await expect(detail.locator('h3')).toHaveText('10월 6일 화요일');await expect(detail).toContainText('이 날 일기가 없어요');
 await page.locator('#diaryRoot [data-diary-new]').click();
 await expect(page.locator('#diaryRoot [data-diary-date]')).toHaveValue('2026-10-06');
 expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
});

for(const scheme of ['light','dark'])for(const width of [390,1280]){
 test(`캡처 ${width} ${scheme}`,async({page},info)=>{
  await page.emulateMedia({colorScheme:scheme});
  const f=await fixture(page,{width});await openDiary(page,width);
  await expect(cell(page,'2026-10-03').locator('img')).toBeVisible();
  await cell(page,'2026-10-03').click();await expect(page.locator('#diaryRoot [data-diary-grid] img').first()).toBeVisible();
  await page.screenshot({path:info.outputPath(`diary-${width}-${scheme}.png`),fullPage:true});
  await page.locator('#diaryRoot [data-diary-grid] .diary-grid-item').nth(1).click();await expect(page.locator('#diaryRoot [data-diary-viewer] .diary-slide').nth(1).locator('img')).toBeVisible();
  await page.screenshot({path:info.outputPath(`diary-view-${width}-${scheme}.png`)});
  await page.locator('#diaryRoot [data-diary-viewer-close]').click();
  await page.locator('#diaryRoot #newDiaryBtn').click();
  await page.locator('#diaryRoot [data-diary-editor] [data-diary-input]').setInputFiles(await photoFiles(page,2,{w:400,h:300}));
  await page.screenshot({path:info.outputPath(`diary-edit-${width}-${scheme}.png`),fullPage:true});
  expect(f.errors).toEqual([]);
 });
}
