import {test,expect} from '@playwright/test';
import {openHome, openQuickBox, pickQuickMode } from './helpers/home-entry.mjs';
import {openWriteFromEntry} from './helpers/write-opener.mjs';
import {typeInto} from './helpers/note-editor.mjs';
// BUG-업데이트첨부연결(사용자 요청 2026-10-23 10:39·10:40): 홈 [업데이트 ▾]에서 담당조직·프로젝트를 골라도 첨부(📎·끌어 놓기)가
// 그대로 되고, 고르기 전에 넣은 파일도 사라지지 않는다. [추가]하면 바구니에서 나중에 [연결하기]/[자료로 넣기]한 것과 같은 결과:
// 글·파일은 바구니 업데이트 하나 → 글이 있으면 고른 곳 모두에 확정 연결(app_basket_confirm_links) → 파일은 처음 고른
// 프로젝트·처음 고른 담당조직 자료(document-actions register-basket-attachment + app_documents 수정). 추가 뒤 바구니·첨부 비움.
// BIZ-저장먼저닫기 2차(S59-10): 글이 있으면 글이 먼저 업데이트로 저장·연결되고(app_notes POST → 연결) 입력칸이 바로 비며, 파일은 뒤에서
// 그 업데이트로(note_id) 올라간 뒤 자료로 들어간다. 글 없이 파일만이면 첫 파일이 업데이트를 만든다(예전 길).
// Supabase 경계만 합성이고 화면은 실제 앱이다. 이름·ID는 모두 가짜 값.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const NAMES=['합성노동조합','시험지부'];
const ID=i=>`00000000-0000-4000-8000-00000000000${i}`;
const PID='00000000-0000-4000-8000-0000000000aa';
const quick=page=>page.locator('#homeView [data-home-quick]');
const dialog=page=>page.getByRole('dialog');
async function setup(page,width,{linkReply={ok:true,created:1,existing:0}}={}){
 await page.setViewportSize({width,height:width<761?844:800});await openHome(page);
 const f={uploads:[],notes:[],orgs:[],projects:[],links:[],sends:[],patches:[],docs:[],docs2:[],errors:[],note:null,linkReply};
 page.on('pageerror',e=>f.errors.push(e.message));
 await page.route(SB+'/rest/v1/app_suborganizations?**',r=>r.fulfill({json:NAMES.map((name,i)=>({id:ID(i),name,active:true}))}));
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',r=>r.fulfill({json:NAMES.map((_,i)=>({organization_id:ID(i)}))}));
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',r=>r.fulfill({json:[]}));
 await page.route(SB+'/rest/v1/app_spaces?**',r=>r.fulfill({json:[{id:PID,name:'합성 프로젝트',owner_id:'home-test',status:'active',metadata:{project_system:'v2'}}]}));
 await page.route(SB+'/rest/v1/app_suborganization_updates',r=>{f.orgs.push(r.request().postDataJSON());return r.fulfill({json:[]});});
 await page.route(SB+'/rest/v1/app_project_progress_updates',r=>{f.projects.push(r.request().postDataJSON());return r.fulfill({json:[]});});
 // basket-files: one basket update; with note_id the file joins that update (the letters saved first), without it the first file makes it.
 await page.route(SB+'/functions/v1/basket-files',r=>{
  const raw=r.request().postDataBuffer()?.toString('utf8')||'';f.uploads.push(raw);
  const name=raw.match(/filename="([^"]+)"/)?.[1]||'file',id='drive-'+f.uploads.length,noteId=raw.match(/name="note_id"\r\n\r\n([^\r]+)/)?.[1];
  if(noteId&&f.note?.id!==noteId)return r.fulfill({status:404,json:{error:'없음',code:'note_not_found'}});
  if(!f.note)f.note={id:'note-up',kind:'basket',raw_text:raw.match(/name="raw_text"\r\n\r\n([^\r]*)/)?.[1]||'',updated_at:'2026-10-23T01:00:00.000001Z',archived_at:null,ai_export_allowed:true,attachments:[],metadata:{}};
  f.note.attachments=[...f.note.attachments,{drive_file_id:id,file_name:name,mime_type:'text/plain',size_bytes:4}];f.note.updated_at=`2026-10-23T01:00:0${f.uploads.length}.000001Z`;
  return r.fulfill({json:{ok:true,note_id:f.note.id,attachments:f.note.attachments}});
 });
 await page.route(SB+'/rest/v1/app_notes**',r=>{
  const req=r.request(),url=new URL(req.url());
  if(req.method()==='POST'){const body=req.postDataJSON();f.notes.push(body);f.note={id:'note-'+f.notes.length,kind:'basket',updated_at:'2026-10-23T01:00:00Z',ai_export_allowed:true,archived_at:null,attachments:[],metadata:{},...body};return r.fulfill({status:201,json:[structuredClone(f.note)]});}
  if(req.method()==='GET'&&f.note&&url.searchParams.get('id')==='eq.'+f.note.id)return r.fulfill({json:[f.note]});
  // ED③ 업데이트: the saved form is put on the update the file upload made (only a basket row that has none yet).
  if(req.method()==='PATCH'&&url.searchParams.get('doc')==='is.null'){f.docs2.push({id:url.searchParams.get('id'),body:req.postDataJSON()});return r.fulfill({json:[{id:url.searchParams.get('id').slice(3),updated_at:'2026-10-23T01:00:09Z'}]});}
  return r.fallback();
 });
 await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',r=>{f.links.push(r.request().postDataJSON());return r.fulfill({json:f.linkReply});});
 await page.route(SB+'/functions/v1/document-actions',r=>{
  const body=r.request().postDataJSON();f.sends.push(body);
  const doc={id:'doc-'+body.drive_file_id,file_id:body.drive_file_id,project_id:null,organization_id:null};f.docs.push(doc);
  return r.fulfill({json:{ok:true,result:'created',document:{id:doc.id,title:'합성 파일'}}});
 });
 await page.route(SB+'/rest/v1/app_documents**',r=>{
  const req=r.request();if(req.method()!=='PATCH')return r.fallback();
  const url=new URL(req.url()),id=url.searchParams.get('id').slice(3),body=req.postDataJSON(),doc=f.docs.find(d=>d.id===id);
  f.patches.push({id,project_id:body.project_id,organization_id:body.organization_id});Object.assign(doc,body);
  return r.fulfill({json:[{id:doc.id,project_id:doc.project_id,organization_id:doc.organization_id,file_id:doc.file_id}]});
 });
 await page.reload();await openQuickBox(page);
 const q=quick(page);await pickQuickMode(page,'update');
 return {q,f};
}
const org=(page,name)=>dialog(page).locator('[data-sheet-all]').getByRole('button',{name,exact:true});
const project=page=>dialog(page).locator('[data-sheet-projects]').getByRole('button',{name:'합성 프로젝트',exact:true});
const save=page=>dialog(page).getByRole('button',{name:'저장',exact:true});
const choose=(q,name)=>q.locator('[data-quick-file-picker] input[type=file]').setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from('합성')});
async function drop(page,q,name){
 const dt=await page.evaluateHandle(n=>{const d=new DataTransfer();d.items.add(new File(['합성'],n,{type:'text/plain'}));return d;},name);
 await q.dispatchEvent('dragenter',{dataTransfer:dt});await q.dispatchEvent('dragover',{dataTransfer:dt});await q.dispatchEvent('drop',{dataTransfer:dt});
}
const fileRows=q=>q.locator('[data-quick-files] [data-basket-file]');

for(const width of [390,1280])test(`첨부 → 조직 고르기: 파일이 남고, [추가]하면 조직 기록(연결) + 조직 자료, 뒤에 정리함·첨부 비움 ${width}`,async({page})=>{
 const {q,f}=await setup(page,width);
 await q.locator('[data-quick-input]').fill('합성 조직 소식');
 await choose(q,'회의자료.txt');await expect(fileRows(q)).toHaveCount(1);
 await pickQuickMode(page,'org');await org(page,'시험지부').click();await save(page).click();await expect(dialog(page)).toBeHidden();
 await expect(q).toHaveAttribute('data-mode','update');
 // The file stays chosen and the clip stays usable (phone: inside the input; PC: [📎 첨부] left of [추가]).
 await expect(fileRows(q)).toHaveCount(1);await expect(fileRows(q).first()).toContainText('회의자료.txt');
 const clip=q.getByRole('button',{name:'파일 첨부',exact:true});await expect(clip).toBeVisible();await expect(clip).toBeEnabled();
 await expect(q.locator('[data-basket-count]')).toHaveText('1');
 if(width<761){const [c,i]=await Promise.all([clip.boundingBox(),q.locator('[data-quick-input]').evaluate(el=>parseFloat(getComputedStyle(el).paddingLeft))]);expect(i).toBeGreaterThanOrEqual(c.width-2);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await q.locator('[data-quick-save]').click();
 await expect(page.locator('#toast')).toContainText('기록을 저장했어요.');
 // The letters first (one basket update, linked to the organization), then the file up to that update and into its documents.
 expect(f.notes).toHaveLength(1);expect(f.notes[0].raw_text).toBe('합성 조직 소식');
 expect(f.links).toEqual([{p_note_id:'note-1',p_note_updated_at:'2026-10-23T01:00:00Z',p_targets:[{kind:'organization',target_id:ID(1),reason:'직접 연결',origin:'record_input'}]}]);
 await expect(page.locator('#uploadDock:not([hidden])')).toContainText('시험지부 기록에 파일 1개 올렸어요');
 expect(f.uploads).toHaveLength(1);expect(f.uploads[0]).toContain('filename="회의자료.txt"');expect(f.uploads[0]).toContain('name="note_id"\r\n\r\nnote-1');expect(f.uploads[0]).not.toContain('name="raw_text"');
 expect(f.sends).toEqual([{action:'register-basket-attachment',note_id:'note-1',drive_file_id:'drive-1'}]);
 expect(f.patches).toEqual([{id:'doc-drive-1',project_id:undefined,organization_id:ID(1)}]);
 expect(f.orgs).toEqual([]);
 // UI-기록할곳되돌리기: back to the basket, and the attachments are cleared too.
 await expect(q).toHaveAttribute('data-mode','basket');await expect(q.locator('[data-quick-input]')).toHaveValue('');
 await expect(fileRows(q)).toHaveCount(0);await expect(q.locator('[data-basket-count]')).toBeHidden();
 await expect(q.locator('[data-quick-status]')).toHaveText('');
 expect(f.errors).toEqual([]);
});

test('조직을 먼저 고른 뒤 PC 끌어 놓기도 된다(클립 보임), 프로젝트 자료로',async({page})=>{
 const {q,f}=await setup(page,1280);
 await pickQuickMode(page,'org');await project(page).click();await save(page).click();
 await expect(q).toHaveAttribute('data-mode','update');
 await expect(q.getByRole('button',{name:'파일 첨부',exact:true})).toBeVisible();
 await drop(page,q,'끌어온 파일.txt');await expect(fileRows(q)).toHaveCount(1);
 await q.locator('[data-quick-input]').fill('합성 프로젝트 진행');
 await q.locator('[data-quick-save]').click();await expect(q).toHaveAttribute('data-mode','basket');
 expect(f.links[0].p_targets).toEqual([{kind:'project',target_id:PID,reason:'직접 연결',origin:'record_input'}]);
 await expect.poll(()=>f.patches).toEqual([{id:'doc-drive-1',project_id:PID,organization_id:undefined}]);
 expect(f.uploads).toHaveLength(1);expect(f.uploads[0]).toContain('filename="끌어온 파일.txt"');
 expect(f.projects).toEqual([]);await expect(fileRows(q)).toHaveCount(0);
 expect(f.errors).toEqual([]);
});

for(const width of [390,1280])test(`여러 곳 + 파일 두 개: 연결은 고른 곳 모두, 파일은 처음 고른 조직·프로젝트 자료 ${width}`,async({page})=>{
 const {q,f}=await setup(page,width);
 await q.locator('[data-quick-input]').fill('여러 곳 소식');
 await choose(q,'가.txt');await choose(q,'나.txt');await expect(fileRows(q)).toHaveCount(2);
 await pickQuickMode(page,'org');await org(page,'합성노동조합').click();await org(page,'시험지부').click();await project(page).click();await save(page).click();
 await expect(q.locator('[data-quick-mode="update"]')).toHaveText('합성노동조합 외 2');await expect(fileRows(q)).toHaveCount(2);
 await q.locator('[data-quick-save]').click();await expect(q).toHaveAttribute('data-mode','basket');
 expect(f.links).toHaveLength(1);expect(f.links[0].p_note_updated_at).toBe('2026-10-23T01:00:00Z');
 expect(f.links[0].p_targets.map(t=>[t.kind,t.target_id])).toEqual([['organization',ID(0)],['organization',ID(1)],['project',PID]]);
 await expect.poll(()=>f.sends.map(s=>s.drive_file_id)).toEqual(['drive-1','drive-2']);
 expect(f.uploads).toHaveLength(2);for(const raw of f.uploads)expect(raw).toContain('name="note_id"\r\n\r\nnote-1');
 await expect.poll(()=>f.patches).toEqual([{id:'doc-drive-1',project_id:PID,organization_id:ID(0)},{id:'doc-drive-2',project_id:PID,organization_id:ID(0)}]);
 await expect(fileRows(q)).toHaveCount(0);await expect(q.locator('[data-quick-input]')).toHaveValue('');
 expect(f.errors).toEqual([]);
});

test('글 없이 파일만 + 조직: 기록(연결) 없이 자료로만 넣는다(정리함 [자료로 넣기]와 같음)',async({page})=>{
 const {q,f}=await setup(page,1280);
 await choose(q,'자료만.txt');
 await pickQuickMode(page,'org');await org(page,'합성노동조합').click();await save(page).click();
 await q.locator('[data-quick-save]').click();await expect(page.locator('#toast')).not.toContainText('올리는 중'); // UX-알림하나로: 진행은 하단바 위 한 줄 하나
 await expect.poll(()=>f.patches).toEqual([{id:'doc-drive-1',project_id:undefined,organization_id:ID(0)}]);
 expect(f.uploads).toHaveLength(1);expect(f.uploads[0]).not.toContain('name="raw_text"');expect(f.uploads[0]).not.toContain('name="note_id"');
 expect(f.links).toEqual([]);expect(f.notes).toEqual([]);
 await expect(q).toHaveAttribute('data-mode','basket');await expect(fileRows(q)).toHaveCount(0);
 expect(f.errors).toEqual([]);
});

test('연결이 거절되면 업데이트·파일은 정리함에 남고 안내, 다시 보내지 않음',async({page})=>{
 const {q,f}=await setup(page,1280,{linkReply:{ok:false,error:'TARGET_UNSELECTABLE',created:0,existing:0}});
 await q.locator('[data-quick-input]').fill('거절될 기록');await choose(q,'파일.txt');
 await pickQuickMode(page,'org');await org(page,'시험지부').click();await save(page).click();
 await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');
 await expect(q.locator('[data-quick-status]')).toContainText('선택한 곳에 연결하지 못했어요');
 await expect(page.locator('#toast')).toContainText('잊지 말기에 저장했어요.');
 await expect.poll(()=>f.uploads.length).toBe(1);expect(f.links).toHaveLength(1);
 await expect(q).toHaveAttribute('data-mode','basket');await expect(fileRows(q)).toHaveCount(0);
});

test('첨부 없는 한 곳 저장은 예전 그대로 그 곳 기록 표(정리함·연결 없음)',async({page})=>{
 const {q,f}=await setup(page,1280);
 await q.locator('[data-quick-input]').fill('첨부 없는 기록');
 await pickQuickMode(page,'org');await org(page,'시험지부').click();await save(page).click();
 await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');
 expect(f.orgs).toEqual([{organization_id:ID(1),raw_text:'첨부 없는 기록',created_by:'home-test'}]);expect(f.uploads).toEqual([]);expect(f.links).toEqual([]);
});

test('홈 [크게]에서 조직 + 홈 입력의 파일: 같은 결과(연결 + 자료), 창이 닫히고 입력·첨부 비움',async({page})=>{
 const {q,f}=await setup(page,1280);
 await q.locator('[data-quick-input]').fill('큰 창 기록');await choose(q,'큰창.txt');
 await q.locator('[data-quick-big]').click();const e=page.locator('#edWindow');await expect(e).toBeVisible();
 await e.locator('[data-edw-place]').click();const sheet=page.locator('#edwPlaceSheet');
 await sheet.locator('[data-sheet-all]').getByRole('button',{name:'시험지부',exact:true}).click();await sheet.getByRole('button',{name:'저장',exact:true}).click();
 await e.locator('[data-edw-save]').click();await expect(e).toHaveCount(0);
 // ED③ 업데이트: the saved form goes with the letters (BIZ-저장먼저닫기 2차: the letters are saved first, in the same insert).
 expect(f.notes).toHaveLength(1);expect(f.notes[0].doc).toMatchObject({v:'ed1'});expect(f.docs2).toEqual([]);
 expect(f.links[0].p_targets).toEqual([{kind:'organization',target_id:ID(1),reason:'직접 연결',origin:'record_input'}]);
 await expect.poll(()=>f.patches).toEqual([{id:'doc-drive-1',project_id:undefined,organization_id:ID(1)}]);expect(f.uploads).toHaveLength(1);
 await expect(q.locator('[data-quick-input]')).toHaveValue('');await expect(fileRows(q)).toHaveCount(0);await expect(q).toHaveAttribute('data-mode','basket');
 expect(f.errors).toEqual([]);
});

test('메뉴 [쓰기] 창의 자체 첨부 + 프로젝트: 같은 길로 연결 + 자료',async({page})=>{
 const {f}=await setup(page,1280);
 await openWriteFromEntry(page,1280);const e=page.locator('#edWindow');await expect(e).toBeVisible();
 await typeInto(page,e.locator('.ed-window-body .ProseMirror'),'쓰기 창 기록');
 await page.locator('#edwUpdateAttach').setInputFiles({name:'쓰기.txt',mimeType:'text/plain',buffer:Buffer.from('합성')});
 await e.locator('[data-edw-place]').click();const sheet=page.locator('#edwPlaceSheet');
 await sheet.locator('[data-sheet-projects]').getByRole('button',{name:'합성 프로젝트',exact:true}).click();await sheet.getByRole('button',{name:'저장',exact:true}).click();
 await e.locator('[data-edw-save]').click();await expect(e).toHaveCount(0);
 await expect(page.locator('#toast')).toContainText('합성 프로젝트 기록에 저장했어요.');
 expect(f.links[0].p_targets).toEqual([{kind:'project',target_id:PID,reason:'직접 연결',origin:'record_input'}]);
 await expect.poll(()=>f.patches).toEqual([{id:'doc-drive-1',project_id:PID,organization_id:undefined}]);expect(f.uploads).toHaveLength(1);expect(f.projects).toEqual([]);
 await expect(page.locator('#uploadDock:not([hidden])')).toContainText('합성 프로젝트 기록에 파일 1개 올렸어요');
 expect(f.errors).toEqual([]);
});
