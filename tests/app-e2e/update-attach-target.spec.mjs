import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
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
 await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
 return {f};
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
