import {showBasketRow} from './helpers/basket-more.mjs';
import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';

// UI-바구니첨부메모 PR 1: 글 없는 첨부 메모 화면(①~⑥), 프로젝트 [자료로 넣기](⑦⑧), 프로젝트 [자료] 묶음·전체 보기(⑩),
// 분류 7개 칩·꼬리표(⑪, 저장 값은 그대로). Supabase REST·Edge 경계만 합성이고 화면은 실제 앱이다.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-10-06T01:00:00Z';
const ONLY='10000000-0000-4000-8000-000000000001',TEXT='10000000-0000-4000-8000-000000000002';
const P='20000000-0000-4000-8000-000000000001',OLD='20000000-0000-4000-8000-000000000002',O='30000000-0000-4000-8000-000000000001';
const HWP={drive_file_id:'drive-hwp',file_name:'임단협 요구안.hwp',mime_type:'application/x-hwp',size_bytes:2048};
const PDF={drive_file_id:'drive-pdf',file_name:'공문.pdf',mime_type:'application/pdf',size_bytes:4096};
const reviewDir=process.env.UI_REVIEW_DIR||'';
const matching=(rows,query)=>rows.filter(row=>[...query].every(([key,value])=>['select','order','limit','offset'].includes(key)||(value.startsWith('eq.')?String(row[key]??'')===value.slice(3):value.startsWith('in.(')?value.slice(4,-1).split(',').includes(String(row[key])):value==='is.null'?row[key]==null:value==='not.is.null'?row[key]!=null:true)));

async function fixture(page,{width=390,scheme='light',docs=null}={}){
 await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:scheme});
 await openHome(page);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});
 const note=(id,raw,attachments)=>({id,workspace_id:'w',kind:'basket',occurred_at:stamp,updated_at:stamp,raw_text:raw,ai_export_allowed:true,archived_at:null,attachments,metadata:{}});
 const space=(id,name)=>({id,workspace_id:'w',owner_id:'home-test',created_by:'home-test',name,status:'active',visibility:'private',sort_order:10,parent_id:null,created_at:stamp,updated_at:stamp,metadata:{project_system:'v2'}});
 const tables={
  app_notes:[note(ONLY,'',[HWP,PDF]),note(TEXT,'10/20 교섭 결과\n2차 교섭 일정 합의',[PDF])],
  app_spaces:[space(P,'합성 임단협'),space(OLD,'합성 지난 교섭')],
  app_suborganizations:[{id:O,workspace_id:'w',name:'합성 한빛지부',active:true}],
  app_suborganization_assignees:[{organization_id:O,user_id:'home-test'}],
  app_documents:docs||[{id:'doc-hwp',workspace_id:'w',project_id:OLD,meeting_id:null,title:'임단협 요구안',file_id:'drive-hwp',file_name:'임단협 요구안.hwp',mime_type:'application/x-hwp',category:'교섭자료',document_date:'2026-09-14',drive_url:'https://example.org/hwp',created_at:'2026-09-14T01:00:00Z'}],
  app_record_links:[],app_project_modules:[],app_project_workstreams:[],app_project_progress_updates:[],app_project_milestones:[],app_project_comments:[],app_suborganization_updates:[],
 };
 const state={tables,requests:[],rpc:[],sends:[],errors};
 state.calls=(table,method)=>state.requests.filter(r=>r.table===table&&r.method===method);
 await page.route(SB+'/rest/v1/**',async route=>{
  const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').pop(),method=req.method();
  if(table==='app_basket_confirm_links'){
   const body=req.postDataJSON();state.rpc.push(body);
   for(const t of body.p_targets)tables.app_record_links.push({id:'40000000-0000-4000-8000-'+String(tables.app_record_links.length+1).padStart(12,'0'),workspace_id:'w',note_id:body.p_note_id,status:'confirmed',summary:t.summary,[t.kind==='project'?'project_id':'organization_id']:t.target_id});
   return route.fulfill({json:{ok:true,created:body.p_targets.length,existing:0}});
  }
  if(!Object.hasOwn(tables,table))return route.fallback();
  const body=method==='GET'?null:req.postDataJSON();state.requests.push({table,method,query:Object.fromEntries(url.searchParams),body});
  let rows=matching(tables[table],url.searchParams);
  if(method==='PATCH')rows.forEach(row=>Object.assign(row,body));
  if(table==='app_record_links'&&method==='GET'){
   const spaceName=id=>tables.app_spaces.find(s=>s.id===id)?.name;
   rows=rows.filter(r=>!url.searchParams.has('google_task_id')).map(r=>({...r,note:tables.app_notes.find(n=>n.id===r.note_id),project:r.project_id?{name:spaceName(r.project_id)}:null,organization:r.organization_id?{name:'합성 한빛지부'}:null}));
  }
  const offset=Number(url.searchParams.get('offset')||0);
  return route.fulfill({json:method==='GET'?rows.slice(offset):rows});
 });
 // register-basket-attachment: the server makes one library document per Drive file.
 await page.route(SB+'/functions/v1/document-actions',route=>{
  const body=route.request().postDataJSON();state.sends.push(body);
  const found=tables.app_documents.find(d=>d.file_id===body.drive_file_id);
  if(found)return route.fulfill({json:{ok:true,result:'exists',document:{id:found.id,title:found.title}}});
  const file=[HWP,PDF].find(f=>f.drive_file_id===body.drive_file_id);
  const doc={id:'doc-'+body.drive_file_id.slice(6),workspace_id:'w',project_id:null,meeting_id:null,title:file.file_name.replace(/\.[^.]+$/,''),file_id:file.drive_file_id,file_name:file.file_name,mime_type:file.mime_type,category:'기타',document_date:null,drive_url:'https://example.org/'+file.drive_file_id,created_at:'2026-10-06T01:00:00Z'};
  tables.app_documents.push(doc);return route.fulfill({json:{ok:true,result:'created',document:{id:doc.id,title:doc.title}}});
 });
 return state;
}
async function tap(page,locator,width){await expect(locator).toBeVisible();if(width<761){await locator.scrollIntoViewIfNeeded();const b=await locator.boundingBox();await page.touchscreen.tap(b.x+b.width/2,b.y+b.height/2);}else await locator.click();}
async function openNote(page,id,width){
 await page.evaluate(()=>window.KPTURouter.go('basket'));await showBasketRow(page,id);
 await tap(page,page.locator(`[data-basket-row="${id}"]`),width);
 const detail=page.locator('[data-basket-detail]');await expect(detail.locator('[data-basket-attachments]')).not.toBeEmpty();return detail;
}
async function pick(page,detail,kind,name,width){
 await tap(page,detail.locator(`[data-manual-pick="${kind}"]`),width);
 const sheet=page.locator('#basketLinkChoiceSheet');await expect(sheet).toBeVisible();
 await tap(page,sheet.getByRole('button',{name,exact:true}),width);await expect(sheet).toBeHidden();
}
async function capture(page,info,name,locator=null){
 const path=reviewDir?`${reviewDir}/${name}.png`:info.outputPath(name+'.png');
 if(reviewDir)mkdirSync(reviewDir,{recursive:true});
 if(locator){await locator.scrollIntoViewIfNeeded();await locator.screenshot({path});}else await page.screenshot({path,fullPage:true});
}
const noWideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);

for(const width of [390,1280])for(const scheme of ['light','dark'])test(`a memo with only attachments puts its files first ${width} ${scheme}`,async({page},info)=>{
 const f=await fixture(page,{width,scheme}),detail=await openNote(page,ONLY,width);
 // ① no text box and no "글 없이 첨부만" notice.
 await expect(detail.locator('[data-basket-read-text]')).toBeHidden();
 await expect(detail).not.toContainText('글 없이 첨부만 있는 메모입니다');
 // ② one line per file: kind color, name, size · in the library.
 const hwp=detail.locator('[data-basket-file-card="drive-hwp"]'),pdf=detail.locator('[data-basket-file-card="drive-pdf"]');
 await expect(hwp.locator('.file-kind')).toHaveText('HWP');await expect(hwp.locator('.file-kind')).toHaveAttribute('data-kind','hwp');
 await expect(hwp.locator('.file-line-main b')).toHaveText('임단협 요구안.hwp');
 await expect(hwp.locator('.file-line-main small')).toHaveText('2.0 KiB · 자료실에 있음 ✓');
 await expect(pdf.locator('.file-kind')).toHaveText('PDF');await expect(pdf.locator('.file-line-main small')).toHaveText('4.0 KiB');
 // ③ two big buttons that fit the kind; ④ the rest sits in the file's ⋯.
 await expect(hwp.locator('.basket-file-actions').getByRole('button')).toHaveText(['HWP 편집']);
 await expect(hwp.locator('.basket-file-actions > *')).toHaveText(['HWP 편집','Drive에서 열기']);
 await expect(pdf.locator('.basket-file-actions > *')).toHaveText(['Drive에서 열기','자료실로 보내기']);
 await expect(pdf.locator('[data-basket-file-more]')).toHaveCount(0);
 const more=hwp.locator('[data-basket-file-more]');await expect(more.getByRole('link',{name:'임단협 요구안.hwp 자료실에서 보기'})).toBeHidden();
 await tap(page,more.locator('summary'),width);await expect(more.getByRole('link',{name:'임단협 요구안.hwp 자료실에서 보기'})).toBeVisible();
 // UI-바구니작은버튼: 보이는 높이는 공용 작은 버튼(32px), 누르는 범위는 위아래 44px까지.
 for(const box of await detail.locator('.basket-file-actions > *').all()){const b=await box.boundingBox();expect(b.height).toBe(32);
  const hit=await box.evaluate(el=>{const r=el.getBoundingClientRect(),x=r.left+r.width/2,cy=r.top+r.height/2;const ok=dy=>{const t=document.elementFromPoint(x,cy+dy);return t===el||el.contains(t)};return {up:ok(-20),down:ok(20)}});
  expect(hit).toEqual({up:true,down:true});}
 await page.keyboard.press('Escape');await expect(more).not.toHaveAttribute('open','');await expect(detail).toBeVisible();
 // ⑥ "state · 날짜" is one line under the files; [연결하기]·[할 일 만들기] stay at the bottom.
 // BUG-자료넣기미분류: the HWP is already a document of 합성 지난 교섭, so the state is that place, not 미분류.
 const meta=detail.locator('.basket-note-meta'),cards=detail.locator('[data-basket-attachments]');
 await expect(meta).toContainText('합성 지난 교섭 · 자료');await expect(meta).not.toContainText('미분류');expect((await meta.boundingBox()).y).toBeGreaterThan((await cards.boundingBox()).y+(await cards.boundingBox()).height-1);
 await expect(detail.locator('[data-basket-read-actions] button')).toHaveText(['연결하기','할 일 만들기']);
 expect(await noWideScroll(page)).toBe(true);
 await capture(page,info,`memo-files-${width}-${scheme}`);
 // ⑤ sending shows the library state in the file line, without the "자료실로 보냈어요" sentence.
 await tap(page,pdf.getByRole('button',{name:'공문.pdf 자료실로 보내기'}),width);
 await expect(pdf.locator('.file-line-main small')).toHaveText('4.0 KiB · 자료실에 있음 ✓');
 await expect(pdf.locator('.basket-file-actions > *')).toHaveText(['Drive에서 열기','자료실에서 보기']);
 await expect(detail).not.toContainText('자료실로 보냈어요');
 expect(f.sends).toEqual([{action:'register-basket-attachment',note_id:ONLY,drive_file_id:'drive-pdf'}]);
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`[자료로 넣기] puts the files into the project without a progress record ${width}`,async({page},info)=>{
 const f=await fixture(page,{width}),detail=await openNote(page,ONLY,width);
 await tap(page,detail.getByRole('button',{name:'연결하기'}),width);
 await expect(detail.locator('#basketManualLinkTitle')).toHaveText('조직·프로젝트 자료로 넣기');
 await expect(detail.locator('[data-manual-original]')).toHaveCount(0);
 await expect(detail.getByRole('button',{name:'자료로 넣기',exact:true})).toBeVisible();
 await pick(page,detail,'project','합성 임단협',width);
 const target=detail.locator(`[data-manual-target="project:${P}"]`);
 await expect(target.locator('textarea')).toHaveCount(0);
 await expect(target.locator('[data-manual-file-note]')).toHaveText('파일 2개를 이 프로젝트 자료로 넣어요. 합성 지난 교섭에서 옮겨요.');
 await expect(target.getByRole('button',{name:'기록도 남기기'})).toHaveAttribute('aria-pressed','false');
 expect(await noWideScroll(page)).toBe(true);
 if(width===390)await capture(page,info,'put-panel-390');
 await tap(page,detail.getByRole('button',{name:'자료로 넣기',exact:true}),width);
 await expect(detail.locator('[data-basket-status]')).toHaveText('파일 2개를 합성 임단협 자료로 넣었어요.');
 await expect(detail.locator('[data-manual-link]')).toHaveCount(0);
 // No record (progress list) is made; one Drive file stays one library document (no copy).
 expect(f.rpc).toEqual([]);expect(f.tables.app_record_links).toEqual([]);
 expect(f.sends).toEqual([{action:'register-basket-attachment',note_id:ONLY,drive_file_id:'drive-pdf'}]);
 expect(f.calls('app_documents','PATCH').map(c=>[c.query.id,c.body.project_id])).toEqual([['eq.doc-hwp',P],['eq.doc-pdf',P]]);
 expect(f.tables.app_documents.map(d=>[d.file_id,d.project_id])).toEqual([['drive-hwp',P],['drive-pdf',P]]);
 await expect(detail.locator('[data-basket-file-card="drive-pdf"] .file-line-main small')).toHaveText('4.0 KiB · 자료실에 있음 ✓');
 // The project detail shows them in [자료] with a category tag, and nothing in its progress.
 await clickView(page,'projects');await page.evaluate(()=>window.__KPTU_PROJECT_V3_READY__);
 await page.locator(`[data-ps3-project="${P}"]`).first().click();
 const docs=page.locator('#ps3-documents');await expect(docs.locator('.ps3-doc-row')).toHaveCount(2);
 await expect(docs.locator('.doc-category-tag')).toHaveText(['교섭','기타']);
 await expect(docs.getByRole('button',{name:'전체 2개 보기'})).toBeVisible();
 await expect(page.locator('#ps3Body')).not.toContainText('임단협 요구안.hwp 기록');
 expect(f.errors).toEqual([]);
});

// BUG-자료넣기미분류: [자료로 넣기] makes no record link, yet the memo leaves [미분류] and shows "○○ · 자료".
const filedChip=(scope,project=P)=>scope.locator(`[data-basket-filed="${project}"]`);
for(const width of [390,1280])test(`[자료로 넣기] takes the memo out of 미분류 with a "project · 자료" line, also after a reload ${width}`,async({page})=>{
 // The HWP is in the library but in no project yet, so both memos start 미분류.
 const f=await fixture(page,{width,docs:[{id:'doc-hwp',workspace_id:'w',project_id:null,meeting_id:null,title:'임단협 요구안',file_id:'drive-hwp',file_name:'임단협 요구안.hwp',category:'교섭자료',created_at:'2026-09-14T01:00:00Z'}]});
 // The text memo gets its own Drive file here (the shared fixture reuses the same PDF, which would file it too).
 f.tables.app_notes[1].attachments=[{...PDF,drive_file_id:'drive-pdf-text'}];
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 const unclassified=page.locator('[data-basket-filter="unclassified"]');
 await expect(page.locator(`[data-basket-row="${ONLY}"]`)).toBeVisible();
 await expect(page.locator('[data-basket-filter-count]')).toHaveText(' 2');
 const detail=await openNote(page,ONLY,width);
 await tap(page,detail.getByRole('button',{name:'연결하기'}),width);await pick(page,detail,'project','합성 임단협',width);
 await tap(page,detail.getByRole('button',{name:'자료로 넣기',exact:true}),width);
 await expect(detail.locator('[data-basket-status]')).toHaveText('파일 2개를 합성 임단협 자료로 넣었어요.');
 expect(f.tables.app_record_links).toEqual([]);
 // The note screen line says where the files went, instead of 미분류.
 await expect(filedChip(detail.locator('[data-basket-state]'))).toHaveText('프로젝트 자료: 합성 임단협 · 자료');
 await expect(detail.locator('.basket-note-meta')).not.toContainText('미분류');
 await tap(page,detail.locator('[data-basket-close]'),width);
 await expect(page.locator('[data-basket-filter-count]')).toHaveText(' 1');
 await tap(page,unclassified,width);
 await expect(page.locator(`[data-basket-row="${ONLY}"]`)).toHaveCount(0);
 await expect(page.locator(`[data-basket-row="${TEXT}"]`)).toBeVisible();
 await page.locator('[data-basket-filter="classified"]').click();
 const row=page.locator(`[data-basket-row-item="${ONLY}"]`);
 await expect(row.locator('.basket-row')).toContainText('분류 완료');
 await expect(filedChip(row)).toHaveText('프로젝트 자료: 합성 임단협 · 자료');
 // A fresh load reads the same state from the documents alone (no stored flag).
 await page.reload();await page.waitForFunction(()=>!!window.KPTURouter?.go);await page.evaluate(()=>window.KPTURouter.go('basket'));
 await expect(page.locator(`[data-basket-row="${TEXT}"]`)).toBeVisible();
 await expect(page.locator(`[data-basket-row="${ONLY}"]`)).toHaveCount(0);
 await expect(page.locator('[data-basket-filter-count]')).toHaveText(' 1');
 await page.locator('[data-basket-filter="classified"]').click();
 await expect(filedChip(page.locator(`[data-basket-row-item="${ONLY}"]`))).toHaveText('프로젝트 자료: 합성 임단협 · 자료');
 expect(f.errors).toEqual([]);
});

test('an already filed memo (no record link) is not 미분류 on load, and follows its documents when they move or leave',async({page})=>{
 const docs=[{id:'doc-hwp',workspace_id:'w',project_id:OLD,meeting_id:null,title:'임단협 요구안',file_id:'drive-hwp',file_name:'임단협 요구안.hwp',category:'교섭자료',created_at:'2026-09-14T01:00:00Z'},{id:'doc-pdf',workspace_id:'w',project_id:OLD,meeting_id:null,title:'공문',file_id:'drive-pdf',file_name:'공문.pdf',category:'기타',created_at:'2026-09-15T01:00:00Z'}];
 const f=await fixture(page,{width:1280,docs});
 await page.evaluate(()=>window.KPTURouter.go('basket'));
 // ONLY's files are both in OLD; TEXT's single PDF is too, so both memos are classified.
 await expect(page.locator('[data-basket-filter-count]')).toHaveText(' 0');
 await page.locator('[data-basket-filter="classified"]').click();
 const only=page.locator(`[data-basket-row-item="${ONLY}"]`);
 await expect(filedChip(only,OLD)).toHaveText('프로젝트 자료: 합성 지난 교섭 · 자료');
 await expect(only.locator('[data-basket-filed]')).toHaveCount(1);
 // Moved to another project (library edit): the line follows on the next read.
 f.tables.app_documents[0].project_id=P;
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:documents-changed')));
 await expect(only.locator('[data-basket-filed]')).toHaveText(['프로젝트 자료: 합성 임단협 · 자료','프로젝트 자료: 합성 지난 교섭 · 자료']);
 // Taken out of every project: back to 미분류.
 for(const doc of f.tables.app_documents)doc.project_id=null;
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:documents-changed')));
 await expect(only.locator('[data-basket-filed]')).toHaveCount(0);
 await expect(page.locator('[data-basket-filter-count]')).toHaveText(' 2');
 // UI-바구니거르기: it leaves [분류] and is back in [미분류].
 await expect(only).toHaveCount(0);
 await page.locator('[data-basket-filter="unclassified"]').click();await expect(only.locator('.basket-row')).toContainText('미분류');
 expect(f.calls('app_documents','PATCH')).toEqual([]);
 expect(f.errors).toEqual([]);
});

test('[기록도 남기기] adds a required summary and also records the memo',async({page})=>{
 const f=await fixture(page,{width:1280}),detail=await openNote(page,ONLY,1280);
 await detail.getByRole('button',{name:'연결하기'}).click();await pick(page,detail,'project','합성 임단협',1280);
 const target=detail.locator(`[data-manual-target="project:${P}"]`);
 await target.getByRole('button',{name:'기록도 남기기'}).click();
 await expect(target.getByRole('button',{name:'기록도 남기기'})).toHaveAttribute('aria-pressed','true');
 await expect(target.locator('textarea')).toBeFocused();
 await expect(detail.getByRole('button',{name:'연결',exact:true})).toBeVisible();
 await detail.getByRole('button',{name:'연결',exact:true}).click();
 await expect(detail.locator('[data-manual-status]')).toContainText('요약');expect(f.rpc).toEqual([]);expect(f.calls('app_documents','PATCH')).toEqual([]);
 await target.locator('textarea').fill('10/6 요구안 최종본 공유');
 await detail.getByRole('button',{name:'연결',exact:true}).click();
 await expect(detail.locator('[data-basket-status]')).toHaveText('1곳에 연결했어요. 파일 2개를 합성 임단협 자료로 넣었어요.');
 expect(f.rpc).toHaveLength(1);expect(f.rpc[0].p_targets).toEqual([{kind:'project',target_id:P,reason:'직접 연결',summary:'10/6 요구안 최종본 공유'}]);
 expect(f.calls('app_documents','PATCH')).toHaveLength(2);
 await expect(detail.locator('[data-basket-state]')).toContainText('프로젝트: 합성 임단협');
 expect(f.errors).toEqual([]);
});

test('a memo with text still needs a summary, and its attachment goes into that project automatically',async({page})=>{
 const f=await fixture(page,{width:1280}),detail=await openNote(page,TEXT,1280);
 await expect(detail.locator('[data-basket-read-text]')).toContainText('10/20 교섭 결과');
 await expect(detail.locator('[data-basket-file-card]')).toHaveCount(0);
 await detail.getByRole('button',{name:'연결하기'}).click();
 await expect(detail.locator('#basketManualLinkTitle')).toHaveText('조직·프로젝트에 연결');
 await pick(page,detail,'project','합성 임단협',1280);
 const target=detail.locator(`[data-manual-target="project:${P}"]`);
 await expect(target.getByRole('button',{name:'기록도 남기기'})).toHaveCount(0);
 await expect(target.locator('[data-manual-file-note]')).toHaveText('파일 1개를 이 프로젝트 자료로 넣어요.');
 await target.locator('textarea').fill('2차 교섭 일정 합의');
 await detail.getByRole('button',{name:'연결',exact:true}).click();
 await expect(detail.locator('[data-basket-status]')).toHaveText('1곳에 연결했어요. 파일 1개를 합성 임단협 자료로 넣었어요.');
 expect(f.rpc[0].p_targets).toEqual([{kind:'project',target_id:P,reason:'직접 연결',summary:'2차 교섭 일정 합의'}]);
 expect(f.tables.app_documents.find(d=>d.file_id==='drive-pdf').project_id).toBe(P);
 expect(f.errors).toEqual([]);
});

// UI-바구니첨부메모 PR 3 ⑨: 담당조직도 프로젝트와 같은 흐름이다(자세한 검사는 attach-memo-org.spec.mjs).
test('an organization takes the files as its documents with no record, like a project',async({page})=>{
 const f=await fixture(page,{width:390}),detail=await openNote(page,ONLY,390);
 await tap(page,detail.getByRole('button',{name:'연결하기'}),390);await pick(page,detail,'organization','합성 한빛지부',390);
 const target=detail.locator(`[data-manual-target="organization:${O}"]`);
 await expect(target.locator('textarea')).toHaveCount(0);
 await expect(target.locator('[data-manual-file-note]')).toHaveText('파일 2개를 이 담당조직 자료로 넣어요.');
 await tap(page,detail.getByRole('button',{name:'자료로 넣기',exact:true}),390);
 await expect(detail.locator('[data-basket-status]')).toHaveText('파일 2개를 합성 한빛지부 자료로 넣었어요.');
 expect(f.rpc).toEqual([]);expect(f.tables.app_record_links).toEqual([]);
 expect(f.calls('app_documents','PATCH').map(c=>[c.query.id,c.body.organization_id,c.body.project_id])).toEqual([['eq.doc-hwp',O,undefined],['eq.doc-pdf',O,undefined]]);
 expect(f.errors).toEqual([]);
});

test('a refused send keeps the panel open so the person can try again',async({page})=>{
 const f=await fixture(page,{width:1280});
 await page.route(SB+'/functions/v1/document-actions',route=>{f.sends.push(route.request().postDataJSON());return route.fulfill({status:400,json:{error:'Drive 원본이 휴지통에 있어 보내지 않았습니다.',code:'DRIVE_FILE_TRASHED'}});});
 const detail=await openNote(page,ONLY,1280);
 await detail.getByRole('button',{name:'연결하기'}).click();await pick(page,detail,'project','합성 임단협',1280);
 await detail.getByRole('button',{name:'자료로 넣기',exact:true}).click();
 await expect(detail.locator('[data-manual-status]')).toHaveText('자료실로 보내지 못했어요. 아무것도 바뀌지 않았어요. Drive 원본이 휴지통에 있어 보내지 않았습니다.');
 await expect(detail.locator('[data-manual-link]')).toBeVisible();await expect(detail.getByRole('button',{name:'자료로 넣기',exact:true})).toBeEnabled();
 // The HWP already in the library moved before the refused PDF; nothing was recorded.
 expect(f.rpc).toEqual([]);expect(f.calls('app_documents','PATCH')).toHaveLength(1);
});

for(const width of [390,1280])for(const scheme of ['light','dark'])test(`library: 7 category chips, a small tag per row, newest first by month ${width} ${scheme}`,async({page},info)=>{
 const doc=(id,title,category,date,project=P,file='a.pdf')=>({id,workspace_id:'w',project_id:project,meeting_id:null,title,file_id:'f-'+id,file_name:file,mime_type:'',category,document_date:date,drive_url:'https://example.org/'+id,created_at:'2026-08-01T01:00:00Z',tags:[]});
 const docs=[doc('d1','국토부 지침','정부자료','2026-09-02'),doc('d2','교섭 요구안','교섭자료','2026-10-05',P,'b.hwp'),doc('d3','기자회견 웹자보','선전·언론자료','2026-10-01'),doc('d4','집회 계획','투쟁',null),doc('d5','다른 프로젝트 자료','회의결과','2026-10-04',OLD),doc('d6','회의 메모','기타','2026-09-20')];
 await fixture(page,{width,scheme,docs});
 await clickView(page,'projects');await page.evaluate(()=>window.__KPTU_PROJECT_V3_READY__);
 await page.locator(`[data-ps3-project="${P}"]`).first().click();
 const section=page.locator('#ps3-documents');await expect(section.locator('.ps3-doc-row')).toHaveCount(5);
 if(width===390)await capture(page,info,`project-docs-390-${scheme}`,section);
 await section.getByRole('button',{name:'전체 5개 보기'}).click();
 await expect(page.locator('#libraryView')).toBeVisible();await expect(page.locator('#documentProject')).toHaveJSProperty('value',P);
 const chips=page.locator('#libraryCategoryFilter');
 await expect(chips.getByRole('radio')).toHaveText(['전체','교섭','투쟁','교육','선전','정책','회의','기타']);
 // Newest first, grouped by month (a missing document date uses the registration day).
 await expect(page.locator('#documentList > *')).toHaveText([/^2026년 10월$/,/교섭 요구안/,/기자회견 웹자보/,/^2026년 9월$/,/회의 메모/,/국토부 지침/,/^2026년 8월$/,/집회 계획/]);
 await expect(page.locator('[data-lu-document="d2"] .lu-file-kind')).toHaveText('HWP');
 await expect(page.locator('[data-lu-document="d2"] .lu-row-meta')).toHaveText('교섭 10.05');
 await expect(page.locator('#documentList .doc-category-tag')).toHaveText(['교섭','선전','기타','정책','투쟁']);
 expect(await noWideScroll(page)).toBe(true);
 await capture(page,info,`library-${width}-${scheme}`);
 await chips.getByRole('radio',{name:'정책'}).click();await expect(page.locator('.lu-row')).toHaveCount(1);await expect(page.locator('.lu-row')).toContainText('국토부 지침');
 await chips.getByRole('radio',{name:'투쟁'}).click();await expect(page.locator('.lu-row')).toHaveText([/집회 계획/]);
 await chips.getByRole('radio',{name:'전체'}).click();await page.locator('#documentSearch').fill('선전');await expect(page.locator('.lu-row')).toHaveText([/기자회견 웹자보/]);
});

test('the library forms choose one of the 7 categories; an old value is shown as its match and kept unless changed',async({page})=>{
 const docs=[{id:'d1',workspace_id:'w',project_id:null,meeting_id:null,title:'국토부 지침',file_id:'f1',file_name:'a.pdf',category:'정부자료',document_date:'2026-09-02',drive_url:'https://example.org/d1',created_at:stamp,tags:[]}];
 const f=await fixture(page,{width:1280,docs});
 await clickView(page,'library');await expect(page.locator('[data-lu-document="d1"]')).toBeVisible();
 await page.locator('#newDocumentBtn').click();
 await expect(page.locator('#docCategory option')).toHaveText(['자동 분류','교섭','투쟁','교육','선전','정책','회의','기타']);await expect(page.locator('#docCategory')).toHaveValue('');
 await page.locator('[data-close="documentModal"]').click();
 await page.locator('[data-lu-document="d1"] .lu-more-trigger').click();await page.locator('#luMorePanel [data-lu-edit]').click();
 await expect(page.locator('#libraryEditModal')).toBeVisible();await expect(page.locator('#libraryEditCategory')).toHaveValue('정책');
 await page.locator('#libraryEditTitle').fill('국토부 지침(정리)');await page.locator('#libraryEditSave').click();
 await expect.poll(()=>f.calls('app_documents','PATCH').length).toBe(1);
 expect(f.calls('app_documents','PATCH')[0].body.category).toBe('정부자료');
 await page.locator('[data-lu-document="d1"] .lu-more-trigger').click();await page.locator('#luMorePanel [data-lu-edit]').click();
 await page.locator('#libraryEditCategory').selectOption('교섭');await page.locator('#libraryEditSave').click();
 await expect.poll(()=>f.calls('app_documents','PATCH').length).toBe(2);
 expect(f.calls('app_documents','PATCH')[1].body.category).toBe('교섭');
});
