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
async function fixture(page,{rows=store(),failUploadAt=0,photoView=true,width=390,height=900,photoSizes=null}={}){
 const writes=[],uploads=[],photoReads=[],deletes=[],errors=[];let uploadCount=0;
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource/.test(m.text()))errors.push(m.text());});
 await page.setViewportSize({width,height});
 await openHome(page);
 const img=await pngFor(page,'#7a5cc0');
 // 크게 보기 검사용: 사진마다 다른 크기(세로·가로·정사각)의 합성 이미지를 파일 순서대로 돌려 쓴다.
 const sized=photoSizes?await Promise.all(photoSizes.map(([w,h],i)=>pngFor(page,['#e85','#5a8','#58e'][i%3],w,h))):null;
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
   const nth=row.attachments.findIndex(a=>a.drive_file_id===u.searchParams.get('file_id'));
   return r.fulfill({status:200,contentType:'image/png',headers:{'cache-control':'private, max-age=3600'},body:sized&&u.searchParams.get('size')==='large'?sized[nth%sized.length]:img});
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

test('[일정] 머리줄 [달력|할 일|업무일지|일기]: 높이 32·고른 쪽 회색, [업무일지] 화면, 탭은 마지막으로 본 쪽',async({page})=>{
 const f=await fixture(page);
 await page.locator('.mobile-tabs [data-mobile-schedule-tab]').click();
 const sw=page.locator('#calendarView .schedule-switch');
 await expect(sw).toBeVisible();await expect(sw.locator('button')).toHaveText(['달력','할 일','업무일지','일기']);
 // UI-버튼작게 ③: 폰은 아래 탭 바로 위 한 줄.
 const box=await sw.boundingBox(),tabs=await page.locator('.mobile-tabs').boundingBox();
 expect(Math.round(box.height)).toBe(32);expect(Math.round(tabs.y-(box.y+box.height))).toBe(6);expect(box.x+box.width).toBeLessThanOrEqual(390);
 await sw.locator('[data-view="journal"]').click();
 await expect(page.locator('#journalView')).toBeVisible();await expect(page.locator('#journalRoot [data-journal-input]')).toBeVisible();await expect(page.locator('#journalView')).not.toContainText('준비 중');
 const pressed=page.locator('#journalView .schedule-switch [aria-pressed="true"]');await expect(pressed).toHaveText('업무일지');
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
 await expect(ed.locator('h3')).toHaveText('일기 수정');await expect(ed.locator('[data-diary-text]')).toHaveValue('가을 산책 DIARY_TEXT_SECRET');
 await expect(ed.locator('[data-diary-date]')).toBeDisabled();await expect(ed.locator('[data-diary-thumb]')).toHaveCount(2);
 await ed.locator('[data-diary-text]').fill('가을 산책, 고쳐 씀');await ed.locator('[data-diary-save]').click();
 await expect(page.locator('#diaryRoot [data-diary-text-view]')).toHaveText('가을 산책, 고쳐 씀');
 expect(f.writes.filter(w=>w.method==='POST')).toHaveLength(0);
 expect(f.writes.at(-1)).toMatchObject({method:'PATCH',query:{kind:'eq.diary',id:'eq.d3'},body:{raw_text:'가을 산책, 고쳐 씀'}});
 // 새로 쓰다 날짜를 이미 있는 날로 바꾸면 고치기로 열리고 쓰던 글은 아래에 붙는다.
 await page.locator('#diaryRoot [data-diary-detail-close]').click();
 await page.locator('#diaryRoot #newDiaryBtn').click();await expect(ed.locator('h3')).toHaveText('일기 쓰기');
 await ed.locator('[data-diary-text]').fill('덧붙일 말');await ed.locator('[data-diary-date]').fill('2026-10-04');
 await expect(ed.locator('h3')).toHaveText('일기 수정');await expect(ed.locator('[data-diary-editor-status]')).toHaveText('이 날 일기가 이미 있어 수정으로 열었어요.');
 await expect(ed.locator('[data-diary-text]')).toHaveValue('글만 쓴 날\n\n덧붙일 말');
 page.once('dialog',d=>d.accept());await ed.locator('[data-diary-editor-close]').click();
 // 다른 곳에서 먼저 같은 날을 만들었으면(409) 저장하지 않고 고치기로 연다.
 await page.locator('#diaryRoot #newDiaryBtn').click();await ed.locator('[data-diary-text]').fill('늦게 쓴 글');
 f.rows.push({id:'d6',workspace_id:'w',kind:'diary',title:null,journal_day:'2026-10-06',raw_text:'다른 기기에서 쓴 글',occurred_at:at,created_at:at,updated_at:at,archived_at:null,ai_export_allowed:false,attachments:[],metadata:{}});
 await ed.locator('[data-diary-save]').click();
 await expect(ed.locator('h3')).toHaveText('일기 수정');await expect(ed.locator('[data-diary-editor-status]')).toHaveText('이 날 일기가 이미 있어요. 수정으로 열게요.');
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

// UI-일기사진 ②: [사진 고르기]는 촬영 전용이 아니라 시스템 사진 선택창(여러 장)으로 열린다.
test('사진 고르기: capture 속성 없이 image/*·여러 장 선택',async({page})=>{
 const f=await fixture(page);await openDiary(page,390);
 await page.locator('#diaryRoot #newDiaryBtn').click();
 const input=page.locator('#diaryRoot [data-diary-editor] [data-diary-input]');
 await expect(input).toHaveAttribute('accept','image/*');await expect(input).toHaveAttribute('multiple','');
 expect(await input.evaluate(el=>el.hasAttribute('capture'))).toBe(false);
 expect(f.errors).toEqual([]);
});

// UI-일기사진 ③: 사진별 코멘트(선택, 200자)는 기존 metadata jsonb(photo_comments)에만 저장한다. 새 열·표·Edge 변경 없음.
// The editor moves focus to its heading one frame after it opens (diary.js openEditor). Wait for that focus before
// typing: a fill that lands first loses focus to the heading, and the typed value can miss the editor state.
async function openEditor(page){
 await page.locator('#diaryRoot #newDiaryBtn').click();
 await expect(page.locator('#diaryRoot #diaryEditorTitle')).toBeFocused();
}
for(const width of [390,1280]){
 test(`사진별 코멘트: 쓰기·보기·크게 보기·빼면 함께 제거·코멘트 없는 기존 일기는 그대로 ${width}`,async({page})=>{
  const f=await fixture(page,{width});await openDiary(page,width);
  await cell(page,'2026-10-03').click();
  // 코멘트 없는 기존 일기: 보기에 코멘트 줄이 없다.
  const detail=page.locator('#diaryRoot [data-diary-detail]');
  await expect(detail.locator('[data-diary-grid] .diary-grid-item')).toHaveCount(2);await expect(detail.locator('[data-diary-captions]')).toHaveCount(0);
  await openEditor(page);
  const ed=page.locator('#diaryRoot [data-diary-editor]');
  const inputs=ed.locator('[data-diary-comment]');await expect(inputs).toHaveCount(2);
  await expect(inputs.first()).toHaveAttribute('maxlength','200');await expect(inputs.first()).toHaveAttribute('aria-label','사진 1 코멘트');
  // 글만 고치면 metadata는 건드리지 않는다.
  await ed.locator('[data-diary-text]').fill('글만 고침');await ed.locator('[data-diary-save]').click();
  await expect(page.locator('#diaryRoot [data-diary-text-view]')).toHaveText('글만 고침');
  expect(f.writes.every(w=>!('metadata' in (w.body||{})))).toBe(true);
  // 코멘트 쓰기: 사진 1·2에 달고, 사진 1은 앞뒤 공백과 줄바꿈을 한 줄로 정리.
  await openEditor(page);
  await inputs.first().fill('  단풍 길  ');await inputs.nth(1).fill('둘째 사진');
  // 새 사진 한 장에도 코멘트를 달 수 있고, 저장하면 올라간 사진 id로 이어진다.
  await ed.locator('[data-diary-input]').setInputFiles(await photoFiles(page,1,{w:800,h:600}));
  const pend=ed.locator('[data-diary-pending-comment]');await expect(pend).toHaveCount(1);await pend.fill('새로 올린 사진');
  // 다시 그려져도(사진 고르기) 쓰던 코멘트가 남는다.
  await expect(inputs.first()).toHaveValue('  단풍 길  ');
  await ed.locator('[data-diary-save]').click();
  await expect(detail.locator('[data-diary-captions] li')).toHaveCount(3);
  await expect(detail.locator('[data-diary-captions] li').first()).toHaveText('사진 1 단풍 길');
  const row=f.rows.find(r=>r.id==='d3');
  expect(row.metadata.photo_comments).toEqual({pa:'단풍 길',pb:'둘째 사진',up1:'새로 올린 사진'});
  expect(row.attachments.map(a=>a.drive_file_id)).toEqual(['pa','pb','up1']);
  expect(Object.keys(row)).not.toContain('photo_comments');
  // 크게 보기: 사진 아래에 그 사진의 코멘트.
  await detail.locator('.diary-grid-item').nth(1).click();
  const viewer=page.locator('#diaryRoot [data-diary-viewer]');
  await expect(viewer.locator('[data-diary-viewer-caption]')).toHaveText('둘째 사진');
  await page.keyboard.press('ArrowRight');
  await expect(viewer.locator('[data-diary-viewer-count]')).toHaveText('3 / 3');await expect(viewer.locator('[data-diary-viewer-caption]')).toHaveText('새로 올린 사진');
  await viewer.locator('[data-diary-viewer-close]').click();
  // 고치기: 저장된 코멘트가 입력칸에 보이고, 지우면 코멘트가 빠진다.
  await openEditor(page);
  await expect(inputs.nth(1)).toHaveValue('둘째 사진');
  await inputs.nth(1).fill('');await ed.locator('[data-diary-save]').click();
  await expect(detail.locator('[data-diary-captions] li')).toHaveCount(2);
  expect(f.rows.find(r=>r.id==='d3').metadata.photo_comments).toEqual({pa:'단풍 길',up1:'새로 올린 사진'});
  // 사진을 빼면 그 사진의 코멘트도 같은 저장에서 빠진다.
  await openEditor(page);
  page.once('dialog',d=>d.accept());await ed.locator('[data-diary-remove="pa"]').click();
  await expect(ed.locator('[data-diary-editor-status]')).toHaveText('사진을 뺐어요.');
  const removal=f.writes.at(-1);
  expect(removal.body.attachments.map(a=>a.drive_file_id)).toEqual(['pb','up1']);expect(removal.body.metadata.photo_comments).toEqual({up1:'새로 올린 사진'});
  expect(f.rows.find(r=>r.id==='d3').metadata.photo_comments).toEqual({up1:'새로 올린 사진'});
  expect(f.errors).toEqual([]);
 });
}

// BUG-일기사진크게: 크게 보기에서 세로·가로·정사각 사진이 비율대로 화면 안에 전체가 들어온다(contain, 잘림 없음).
for(const [width,height] of [[390,844],[720,900],[880,1000],[1280,800]]){
 test(`크게 보기: 세로·가로·정사각 사진 전체가 비율 유지로 화면 안에 들어온다 ${width}x${height}`,async({page})=>{
  const sizes=[[1200,1800],[1800,1200],[1500,1500],[600,2400],[2400,600]];
  const rows=store();rows[1].attachments=['pa','pb','pc','pd','pe'].map(id=>photo(id));
  const f=await fixture(page,{width,height,rows,photoSizes:sizes});await openDiary(page,width);
  await cell(page,'2026-10-03').click();
  await page.locator('#diaryRoot [data-diary-grid] .diary-grid-item').first().click();
  const viewer=page.locator('#diaryRoot [data-diary-viewer]');
  await expect(viewer).toBeVisible();
  for(let i=0;i<sizes.length;i++){
   if(i)await page.keyboard.press('ArrowRight');
   await expect(viewer.locator('[data-diary-viewer-count]')).toHaveText(`${i+1} / ${sizes.length}`);
   const img=viewer.locator('.diary-slide').nth(i).locator('img');
   await expect(img).toBeVisible();
   await expect.poll(()=>img.evaluate(el=>el.complete&&el.naturalWidth>0)).toBe(true);
   await page.waitForTimeout(450);
   const m=await page.evaluate(([i])=>{
    const v=document.querySelector('[data-diary-viewer]'),s=v.querySelector('[data-diary-viewer-strip]'),img=v.querySelectorAll('.diary-slide img')[i];
    const r=img.getBoundingClientRect(),sr=s.getBoundingClientRect();
    return {x:r.x,y:r.y,w:r.width,h:r.height,sx:sr.x,sy:sr.y,sw:sr.width,sh:sr.height,nw:img.naturalWidth,nh:img.naturalHeight,fit:getComputedStyle(img).objectFit};
   },[i]);
   // 전체가 보인다: 상자가 줄 영역 안에 있고(위아래·좌우 넘침 없음), 실제 그려지는 사진(contain)은 원본 비율이며
   // 한 변이 줄 영역에 닿을 만큼 크게 보인다.
   expect(m.fit).toBe('contain');
   expect(m.x).toBeGreaterThanOrEqual(m.sx-1);expect(m.x+m.w).toBeLessThanOrEqual(m.sx+m.sw+1);
   expect(m.y).toBeGreaterThanOrEqual(m.sy-1);expect(m.y+m.h).toBeLessThanOrEqual(m.sy+m.sh+1);
   expect(m.w).toBeGreaterThan(20);expect(m.h).toBeGreaterThan(20);
   const scale=Math.min(m.w/m.nw,m.h/m.nh),cw=m.nw*scale,ch=m.nh*scale;
   expect(cw).toBeLessThanOrEqual(m.sw+1);expect(ch).toBeLessThanOrEqual(m.sh+1);
   expect(Math.max(cw/m.sw,ch/m.sh)).toBeGreaterThan(0.95);
  }
  expect(f.errors).toEqual([]);
 });
}

// UI-일기뒤로가기: 날짜 패널 위에 크게 보기가 열린 채 폰 뒤로가기 한 번은 크게 보기만 닫고 그날 패널은 남긴다.
// 브라우저 뒤로(goBack)와 앱 뒤로(KPTURouter.back, 안드로이드 뒤로가 부르는 것)를 둘 다 본다.
for(const [how,back] of [['브라우저 뒤로',page=>page.goBack()],['앱 뒤로',page=>page.evaluate(()=>window.KPTURouter.back())]]){
 test(`폰 ${how}: 크게 보기 → 크게 보기만 닫힘, 한 번 더 → 날짜 패널 닫힘 (사진 넘김·×·다시 열기·고치기 저장 뒤에도)`,async({page})=>{
  const rows=store();rows[1].attachments=['pa','pb','pc','pd'].map(id=>photo(id));
  const f=await fixture(page,{width:390,rows});await openDiary(page,390);
  const detail=page.locator('#diaryRoot [data-diary-detail]'),viewer=page.locator('#diaryRoot [data-diary-viewer]'),grid=detail.locator('[data-diary-grid] .diary-grid-item');
  const layers=()=>page.evaluate(()=>history.state?.kptuLayers||[]);
  const settle=()=>page.waitForTimeout(250);
  // 크게 보기만 닫혀야 하는 한 번의 뒤로: 패널·격자·글이 그대로이고 기록은 [날짜]까지만 남는다.
  const backClosesViewerOnly=async()=>{
   await expect(viewer).toBeVisible();await back(page);
   await expect(viewer).toHaveCount(0);await settle();
   await expect(detail).toBeVisible();await expect(detail.locator('h3')).toHaveText('10월 3일 토요일');await expect(grid).toHaveCount(4);
   await expect(page.locator('#diaryView')).toBeVisible();expect(await layers()).toEqual(['diary-day']);
  };
  await cell(page,'2026-10-03').click();await expect(detail).toBeVisible();expect(await layers()).toEqual(['diary-day']);
  // 1) 바로 뒤로.
  await grid.nth(1).click();expect(await layers()).toEqual(['diary-day','diary-photo']);await backClosesViewerOnly();
  // 2) 사진을 옆으로 넘긴 뒤 뒤로.
  await grid.nth(0).click();await page.keyboard.press('ArrowRight');await expect(viewer.locator('[data-diary-viewer-count]')).toHaveText('2 / 4');await page.keyboard.press('ArrowRight');
  await expect(viewer.locator('[data-diary-viewer-count]')).toHaveText('3 / 4');await backClosesViewerOnly();
  // 3) ×로 닫은 뒤 다시 열고 뒤로, 그리고 ×·뒤로를 번갈아 반복해도 기록이 늘거나 어긋나지 않는다.
  await grid.nth(2).click();await viewer.locator('[data-diary-viewer-close]').click();await expect(viewer).toHaveCount(0);await settle();
  expect(await layers()).toEqual(['diary-day']);await expect(detail).toBeVisible();
  const entries=()=>page.evaluate(()=>navigation.currentEntry.index);
  const at=await entries();
  for(let n=0;n<3;n++){
   await grid.nth(n).click();await expect(viewer).toBeVisible();expect(await entries()).toBe(at+1);
   if(n%2)await backClosesViewerOnly();else{await viewer.locator('[data-diary-viewer-close]').click();await expect(viewer).toHaveCount(0);await settle();}
   expect(await entries()).toBe(at);expect(await layers()).toEqual(['diary-day']);
  }
  await grid.nth(3).click();await backClosesViewerOnly();
  // 4) 같은 날 [고치기] → 저장 뒤에 다시 열어도 마찬가지.
  await detail.locator('[data-diary-edit]').click();await expect(page.locator('#diaryRoot [data-diary-editor]')).toBeVisible();
  await page.locator('#diaryRoot [data-diary-save]').click();await expect(page.locator('#diaryRoot [data-diary-editor]')).toBeHidden();await settle();
  await expect(detail).toBeVisible();await grid.nth(1).click();await backClosesViewerOnly();
  // 한 번 더 뒤로: 그제야 날짜 패널이 닫히고 일기 달력만 남는다(일기 화면은 그대로).
  await back(page);await expect(detail).toBeHidden();await expect(page.locator('#diaryView')).toBeVisible();
  await expect(page.locator('#diaryRoot [data-diary-cal]')).toBeVisible();expect(await layers()).toEqual([]);
  expect(f.errors).toEqual([]);
 });
}

// UI-PC일기 ①: a same-owner sign-in refresh (new token only) fires kptu:session-changed. It used to revoke every cached
// photo object URL, including photos still being read (ensure() itself refreshes the token), so they broke while the
// box said "shown". Now: the same owner keeps the photos; "shown" means the browser really drew it (naturalWidth > 0).
for(const width of [390,1280]){
 test(`사진: 같은 사용자 로그인 갱신(토큰만 바뀜) 중·뒤에도 사진이 그려지고 상태가 맞다 ${width}`,async({page})=>{
  const f=await fixture(page,{width});
  let release,waiting=0;const gate=new Promise(resolve=>{release=resolve;});
  await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/basket-files'&&u.searchParams.get('action')==='photo',async r=>{waiting++;await gate;await r.fallback();});
  await openDiary(page,width);
  const box=cell(page,'2026-10-03').locator('.diary-photo');
  await expect(box).toHaveAttribute('data-state','loading');
  await expect.poll(()=>waiting).toBeGreaterThan(0);
  // The token is refreshed for the same owner while the photo read is still on its way.
  await page.evaluate(()=>{const s=window.KPTURuntime.session.read();window.KPTURuntime.session.write({...s,access_token:s.access_token+'-refreshed',expires_at:Math.floor(Date.now()/1000)+3600});});
  release();
  await expect(box).toHaveAttribute('data-state','shown');
  const drawn=()=>box.locator('img').evaluate(img=>img.complete&&img.naturalWidth>0);
  expect(await drawn()).toBe(true);
  // Another same-owner refresh after the photo is up: it stays drawn, and opening the day reuses the copy.
  await page.evaluate(()=>{const s=window.KPTURuntime.session.read();window.KPTURuntime.session.write({...s,access_token:s.access_token+'-again'});});
  await cell(page,'2026-10-03').click();
  const grid=page.locator('#diaryRoot [data-diary-grid] .diary-photo');
  await expect(grid.first()).toHaveAttribute('data-state','shown');
  expect(await grid.first().locator('img').evaluate(img=>img.complete&&img.naturalWidth>0)).toBe(true);
  expect(await drawn()).toBe(true);
  expect(f.photoReads.filter(r=>r.file_id==='pa'&&r.size==='small')).toHaveLength(1);
  expect(f.writes).toEqual([]);expect(f.errors).toEqual([]);
 });
}

test('사진: 브라우저가 그리지 못한 사진은 한 번 다시 읽고, 또 실패하면 사진 표시(달력 칸)로 바뀐다',async({page})=>{
 const f=await fixture(page);
 // The photo view answers "image/png" but the bytes cannot be decoded.
 await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/basket-files'&&u.searchParams.get('action')==='photo'&&u.searchParams.get('file_id')==='pa',async r=>{
  f.photoReads.push(Object.fromEntries(new URL(r.request().url()).searchParams));
  await r.fulfill({status:200,contentType:'image/png',body:Buffer.from('not an image')});
 });
 await openDiary(page,390);
 const box=cell(page,'2026-10-03').locator('.diary-photo');
 await expect(box).toHaveAttribute('data-state','link');
 await expect(box.locator('img')).toHaveCount(0);
 await expect(box.locator('.diary-photo-mark')).toHaveText('사진');
 expect(f.photoReads.filter(r=>r.file_id==='pa'&&r.size==='small')).toHaveLength(2);
 expect(f.writes).toEqual([]);
});

// UI-PC일기 ②: on a PC the diary uses the whole body beside the sidebar (same width rule as [달력]); the phone keeps its look.
for(const width of [390,1280]){
 test(`달력 폭: PC는 사이드바 옆 본문 폭을 다 쓰고, 폰은 그대로 ${width}`,async({page})=>{
  const f=await fixture(page,{width});await openDiary(page,width);
  const m=await page.evaluate(()=>{
   const r=e=>e.getBoundingClientRect(),diary=r(document.querySelector('#diaryRoot')),view=document.querySelector('#diaryView'),cs=getComputedStyle(view);
   const panel={width:view.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight)};
   const cells=[...document.querySelectorAll('#diaryRoot .diary-days > *')].map(r);
   const last=cells[6];
   return {diary:diary.width,panel:panel.width,right:diary.right,cellW:cells[0].width,cellH:cells[0].height,rowRight:last.right,doc:document.documentElement.scrollWidth,vw:innerWidth};
  });
  expect(m.doc).toBeLessThanOrEqual(m.vw);
  expect(Math.abs(m.diary-m.panel)).toBeLessThan(2);
  expect(Math.abs(m.rowRight-m.right)).toBeLessThan(2);
  if(width<=760){
   // Phone: the square cells as before.
   expect(Math.abs(m.cellW-m.cellH)).toBeLessThan(1.5);
  }else{
   // PC: well beyond the old 760px cap, the right edge near the window edge, a month still inside the window.
   expect(m.diary).toBeGreaterThan(860);
   expect(m.vw-m.right).toBeLessThan(60);
   expect(m.cellH).toBeLessThan(m.cellW);
   const bottom=await page.locator('#diaryRoot .diary-days').evaluate(el=>el.getBoundingClientRect().bottom);
   expect(bottom).toBeLessThanOrEqual(900);
  }
  expect(f.errors).toEqual([]);
 });
}

// DIARY-목록색: 이 달 일기 목록(달력 아래, 최신 날짜 먼저, 날짜 + 첫 줄), 날짜를 고르면 같은 자리에 그날 일기, 달력 표시는 테마 대표색.
for(const width of [390,1280]){
 test(`[일기] 이 달 목록: 최신 날짜 먼저, 날짜 누르면 같은 자리에 그날 일기, 닫으면 목록, 표시색은 테마 대표색 ${width}`,async({page})=>{
  const rows=store();rows[2].raw_text='\n첫 줄 글\n둘째 줄';
  const f=await fixture(page,{width,rows});await openDiary(page,width);
  const list=page.locator('#diaryRoot [data-diary-list]'),detail=page.locator('#diaryRoot [data-diary-detail]');
  await expect(list).toBeVisible();
  const items=list.locator('[data-diary-list-day]');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('10월 4일');await expect(items.nth(0)).toContainText('첫 줄 글');await expect(items.nth(0)).not.toContainText('둘째 줄');
  await expect(items.nth(1)).toContainText('10월 3일');await expect(items.nth(1)).toContainText('가을 산책');
  const calBottom=await page.locator('#diaryRoot [data-diary-cal]').evaluate(el=>el.getBoundingClientRect().bottom);
  const listTop=await list.evaluate(el=>el.getBoundingClientRect().top);
  expect(listTop).toBeGreaterThanOrEqual(calBottom-1);
  await items.nth(1).click();
  await expect(detail.locator('h3')).toHaveText('10월 3일 토요일');await expect(list).toBeHidden();
  expect(Math.abs(await detail.evaluate(el=>el.getBoundingClientRect().top)-listTop)).toBeLessThan(2);
  await page.locator('#diaryRoot [data-diary-detail-close]').click();
  await expect(detail).toBeHidden();await expect(list).toBeVisible();
  await cell(page,'2026-10-04').click();
  await expect(detail.locator('h3')).toHaveText('10월 4일 일요일');await expect(list).toBeHidden();
  await page.locator('#diaryRoot [data-diary-detail-close]').click();
  // 표시색: 글만 있는 날 점·오늘 동그라미·고른 날 테두리는 --kptu-primary-ink, 사진 칸 바탕은 --kptu-primary-soft.
  const color=(token)=>page.evaluate(t=>{const e=document.createElement('span');e.style.color=`var(${t})`;document.body.append(e);const c=getComputedStyle(e).color;e.remove();return c;},token);
  const ink=await color('--kptu-primary-ink');
  expect(await cell(page,'2026-10-04').locator('[data-diary-dot]').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(ink);
  expect(await cell(page,'2026-10-06').locator('.diary-num').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(ink);
  await cell(page,'2026-10-04').click();
  expect(await cell(page,'2026-10-04').evaluate(el=>getComputedStyle(el).borderTopColor)).toBe(ink);
  expect(f.errors).toEqual([]);
 });
}
