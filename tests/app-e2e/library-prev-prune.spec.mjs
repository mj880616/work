// LIB-이전파일정리 (docs/design/library-replace-file.md 8절): the library [수정] dialog's [이전 파일 ▾] shows 'N일 뒤 삭제' and a small [계속 보관].
// Synthetic server only (no real Supabase or Drive): library-files previous-keep. Fake documents, 390 and 1280.
import { appOrigin } from './helpers/test-origin.mjs';
import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { revealLibraryRow } from './helpers/library-tree.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const now=()=>new Date().toISOString();
const eq=(url,key)=>String(url.searchParams.get(key)||'').replace(/^eq\./,'');
const DOC=n=>`e0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const PROJECT='22000000-0000-4000-8000-000000000001',ORG='23000000-0000-4000-8000-000000000001';
const AI={document_date:'2026-10-20',source:'공공운수노조'};

function doc(n,over={}){
  return {id:DOC(n),workspace_id:'workspace-1',project_id:PROJECT,organization_id:ORG,meeting_id:null,title:'고친 제목',category:'교섭',source:null,document_date:null,
    description:null,tags:[],file_id:'oldDriveFile'+n,file_name:'옛 파일.hwpx',mime_type:'application/x-hwp',file_size:2048,drive_url:'https://drive.google.com/file/d/oldDriveFile'+n+'/view',
    created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z',field_origin:{title:'user',project_id:'user',organization_id:'user'},classification_note:'사용자 수정',
    extracted_text:'옛 글자',extraction_status:'ready',previous_files:[],reclassify_needed:false,...over};
}
function baseState(docs){
  return {user:{id:'user-1',email:'owner@example.org',user_metadata:{display_name:'자료실 관리자'}},workspace:{id:'workspace-1',slug:'team',name:'웹2'},
    docs:docs||[doc(1)],log:[],replaces:[],patches:[],texts:[],tidies:[],replaceMode:'ok',attemptsReady:false};
}

const DAYMS=86400000;
const ago=days=>new Date(Date.now()-days*DAYMS).toISOString();
const entry=(file,days,extra={})=>({file_id:file,file_name:`이전 ${file}.pdf`,mime_type:'application/pdf',file_size:1024,drive_url:`https://drive.google.com/file/d/${file}/view`,replaced_at:ago(days),...extra});
async function mockApp(page,state){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const body=(()=>{try{return req.postDataJSON()}catch{return null}})();
    const ok=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:state.user});
    if(path==='/auth/v1/user')return ok(state.user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/library-files'){
      state.keeps.push(body);
      if(state.keepMode==='pruned')return ok({error:'이미 정리된 파일입니다.',message:'이미 정리된 파일입니다.',code:'previous_already_pruned'},409);
      const d=state.docs.find(x=>x.id===body?.document_id),f=d?.previous_files.find(x=>x.file_id===body?.file_id);
      if(!f)return ok({error:'없음',code:'previous_not_found'},404);
      // The same rule as the server: keep_at on that entry only; un-keep restarts the 30 days.
      if(body.keep){f.keep_at=new Date().toISOString();delete f.unkeep_at}else{delete f.keep_at;f.unkeep_at=new Date().toISOString()}
      return ok({ok:true,previous_files:d.previous_files});
    }
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'workspace-1',user_id:state.user.id,role:'owner',workspace:state.workspace,created_at:now()}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'자료실 관리자',document_categories:['교섭','투쟁','교육','선전','정책','회의','기타']}]);
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);
    if(path==='/rest/v1/app_meetings')return ok([]);
    if(path==='/rest/v1/app_library_classify_attempts')return ok({message:'not found'},404);
    if(path==='/rest/v1/app_documents'){
      const id=eq(url,'id');
      if(method==='GET')return ok(state.docs.filter(x=>(!id||x.id===id)&&(!url.searchParams.has('or')||!['ready','error'].includes(x.extraction_status))));
    }
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}
async function boot(page,{width=390,previous}={}){
  await page.setViewportSize({width,height:900});
  const state=baseState([doc(1,{previous_files:previous})]);state.keeps=[];state.keepMode='ok';await mockApp(page,state);
  await page.goto(`${appOrigin}/app/?view=library`);
  await enterLogin(page);await signInWithSession(page,'owner@example.org');
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('[data-lu-document]')).toHaveCount(1);
  await revealLibraryRow(page,DOC(1));
  await page.locator(`[data-lu-document="${DOC(1)}"] .lu-more-trigger`).click();
  await page.locator('[data-lu-edit]').click();
  await expect(page.locator('#libraryEditModal')).toBeVisible();
  await page.locator('#libraryEditPrev > summary').click();
  return state;
}
const previous=()=>[entry('A',18),entry('B',40,{pruned_at:ago(2),prune_result:'trashed'}),entry('C',60,{keep_at:ago(5)})];

for(const width of [390,1280]){
  test(`이전 파일 줄 끝에 남은 날과 작은 [계속 보관]이 보이고, 정리된 줄은 빠지며, 보관한 줄은 '보관' (${width})`,async({page})=>{
    await boot(page,{width,previous:previous()});
    const rows=page.locator('#libraryEditPrevList .library-edit-prev-row');
    await expect(rows).toHaveCount(2);
    const a=rows.filter({hasText:'이전 A.pdf'}),c=rows.filter({hasText:'이전 C.pdf'});
    await expect(a.locator('.library-edit-prev-del')).toHaveText('12일 뒤 삭제');
    await expect(a.locator('[data-lu-prev-keep]')).toHaveText('계속 보관');
    await expect(c.locator('.library-edit-prev-del')).toHaveText('보관');
    await expect(c.locator('[data-lu-prev-keep]')).toHaveText('해제');
    expect(await page.locator('#libraryEditPrevList').innerText()).not.toContain('이전 B.pdf');
    const box=await a.locator('[data-lu-prev-keep]').boundingBox();expect(box.height).toBeLessThanOrEqual(33);
    expect(await page.locator('#libraryEditModal .modal-card').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  });

  test(`[계속 보관]은 서버에 저장되고 '보관'으로 바뀌며, [해제]하면 다시 30일 (${width})`,async({page})=>{
    const state=await boot(page,{width,previous:previous()});
    const a=page.locator('#libraryEditPrevList .library-edit-prev-row',{hasText:'이전 A.pdf'});
    await a.locator('[data-lu-prev-keep]').click();
    await expect(a.locator('.library-edit-prev-del')).toHaveText('보관');
    expect(state.keeps).toEqual([{action:'previous-keep',document_id:DOC(1),file_id:'A',keep:true}]);
    await a.locator('[data-lu-prev-keep]').click();
    await expect(a.locator('.library-edit-prev-del')).toHaveText('30일 뒤 삭제');
    expect(state.keeps.at(-1)).toEqual({action:'previous-keep',document_id:DOC(1),file_id:'A',keep:false});
  });
}

test('서버가 이미 정리된 파일이라고 거절하면 안내를 보이고 줄은 그대로다',async({page})=>{
  const state=await boot(page,{previous:previous()});
  state.keepMode='pruned';
  const a=page.locator('#libraryEditPrevList .library-edit-prev-row',{hasText:'이전 A.pdf'});
  await a.locator('[data-lu-prev-keep]').click();
  await expect(page.locator('#libraryEditStatus')).toContainText('이미 정리된 파일');
  await expect(a.locator('.library-edit-prev-del')).toHaveText('12일 뒤 삭제');
});

test('모든 이전 파일이 정리돼 있으면 [이전 파일 ▾] 자체가 보이지 않는다',async({page})=>{
  await page.setViewportSize({width:390,height:900});
  const state=baseState([doc(1,{previous_files:[entry('B',40,{pruned_at:ago(2),prune_result:'trashed'})]})]);state.keeps=[];await mockApp(page,state);
  await page.goto(`${appOrigin}/app/?view=library`);
  await enterLogin(page);await signInWithSession(page,'owner@example.org');
  await expect(page.locator('[data-lu-document]')).toHaveCount(1);
  await revealLibraryRow(page,DOC(1));
  await page.locator(`[data-lu-document="${DOC(1)}"] .lu-more-trigger`).click();
  await page.locator('[data-lu-edit]').click();
  await expect(page.locator('#libraryEditModal')).toBeVisible();
  await expect(page.locator('#libraryEditPrev')).toBeHidden();
});
