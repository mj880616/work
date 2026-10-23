// LIB-수정파일교체 (docs/design/library-replace-file.md): the library [수정] dialog can swap the file itself. Synthetic server only
// (no real Supabase, Drive or OpenAI): library-files replace branch, document-text, ai-assist tidy. Fake documents, 390 and 1280.
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
      const raw=(req.postDataBuffer()||Buffer.from('')).toString('utf8');
      const names=[...raw.matchAll(/(?<![a-z])name="([^"]+)"/g)].map(m=>m[1]);
      const field=name=>raw.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`))?.[1]??null;
      const fileName=raw.match(/filename="([^"]*)"/)?.[1]||'file';
      state.log.push('replace');state.replaces.push({names,id:field('replace_document_id'),fileName});
      if(state.replaceMode==='conflict')return ok({error:'자료의 파일이 그 사이 바뀌었습니다. 자료실을 새로 읽은 뒤 다시 시도해 주세요.',message:'자료의 파일이 그 사이 바뀌었습니다. 자료실을 새로 읽은 뒤 다시 시도해 주세요.',code:'document_changed',stage:'db_update',retryable:false},409);
      if(state.replaceMode==='gateway')return ok({error:'timeout'},504);
      const d=state.docs.find(x=>x.id===field('replace_document_id'));
      if(!d)return ok({error:'없음',code:'document_not_found'},404);
      // The same rules as the real server: only the file columns move; the old file goes to previous_files; text is cleared; the mark is set.
      d.previous_files=[...d.previous_files,{file_id:d.file_id,file_name:d.file_name,mime_type:d.mime_type,file_size:d.file_size,drive_url:d.drive_url,replaced_at:now()}];
      Object.assign(d,{file_id:'newDriveFile',file_name:fileName,mime_type:'application/pdf',file_size:18,drive_url:'https://drive.google.com/file/d/newDriveFile/view',
        reclassify_needed:true,extracted_text:null,extraction_status:null,updated_at:now()});
      return ok({ok:true,replaced:true,document:d});
    }
    if(path==='/functions/v1/document-actions'){state.log.push('text');state.texts.push(body);const d=state.docs.find(x=>x.id===body?.document_id);if(d){d.extraction_status='ready';d.extracted_text='새 글자'}return ok({ok:true,status:'ready',reason:'ok'})}
    if(path==='/functions/v1/ai-assist'){
      state.log.push('tidy');state.tidies.push(body);
      let updated=0;
      for(const id of body.document_ids||[]){
        const d=state.docs.find(x=>x.id===id);
        if(!d||!d.reclassify_needed)continue;
        // Server rule: only empty fields that are not the person's; then the mark goes off.
        for(const [f,v] of Object.entries(AI)){if(d.field_origin[f]==='user'||d[f])continue;d[f]=v;d.field_origin={...d.field_origin,[f]:'ai'};updated++}
        d.reclassify_needed=false;d.updated_at=now();
      }
      return ok({ok:true,kind:'library_fill',mode:'tidy',updated:updated?1:0,fields:updated,skipped:0});
    }
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'workspace-1',user_id:state.user.id,role:'owner',workspace:state.workspace,created_at:now()}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'자료실 관리자',document_categories:['교섭','투쟁','교육','선전','정책','회의','기타']}]);
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);
    if(path==='/rest/v1/app_meetings')return ok([]);
    if(path==='/rest/v1/app_library_classify_attempts')return state.attemptsReady?ok([]):ok({message:'not found'},404);
    if(path==='/rest/v1/app_documents'){
      const id=eq(url,'id');
      if(method==='GET')return ok(state.docs.filter(x=>(!id||x.id===id)&&(!url.searchParams.has('or')||!['ready','error'].includes(x.extraction_status))));
      if(method==='PATCH'){
        state.log.push('patch');state.patches.push({id,body});
        const rows=state.docs.filter(row=>row.id===id);rows.forEach(row=>Object.assign(row,body||{}));
        return ok(rows);
      }
    }
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}
async function boot(page,{width=390,docs,attemptsReady=false}={}){
  await page.setViewportSize({width,height:900});
  const state=baseState(docs);state.attemptsReady=attemptsReady;await mockApp(page,state);
  await page.goto(`${appOrigin}/app/?view=library`);
  await enterLogin(page);await signInWithSession(page,'owner@example.org');
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('[data-lu-document]')).toHaveCount(state.docs.length);
  return state;
}
async function openEdit(page,n=1){
  await revealLibraryRow(page,DOC(n));
  await page.locator(`[data-lu-document="${DOC(n)}"] .lu-more-trigger`).click();
  await page.locator('[data-lu-edit]').click();
  await expect(page.locator('#libraryEditModal')).toBeVisible();
}
const pdf=(name='새 파일.pdf')=>({name,mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 synthetic')});

for(const width of [390,1280]){
  test(`menu says [수정]; the dialog shows the current file with a small [파일 교체] and no 이전 파일 yet (${width})`,async({page})=>{
    await boot(page,{width});
    await revealLibraryRow(page,DOC(1));
    await page.locator(`[data-lu-document="${DOC(1)}"] .lu-more-trigger`).click();
    await expect(page.locator('[data-lu-edit]')).toHaveText('수정');
    expect(await page.locator('#libraryView').innerText()).not.toContain('정보 수정');
    await page.locator('[data-lu-edit]').click();
    await expect(page.locator('#libraryEditModal h2').first()).toHaveText('자료 수정');
    const line=page.locator('#libraryEditFileLine');
    await expect(line).toContainText('옛 파일.hwpx');
    const button=line.locator('[data-lu-replace-pick]');
    await expect(button).toHaveText('파일 교체');
    // A small button (UI-버튼기준): visible height at most 32px, touch target 44px.
    const box=await button.boundingBox();expect(box.height).toBeLessThanOrEqual(33);
    await expect(page.locator('#libraryEditPrev')).toBeHidden();
    // No horizontal overflow of the dialog.
    expect(await page.locator('#libraryEditModal .modal-card').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  });

  test(`replacing the file keeps title, kind and links; the old file shows under 이전 파일; AI refills only empty fields (${width})`,async({page})=>{
    const state=await boot(page,{width});
    await openEdit(page);
    await page.locator('#libraryEditReplaceInput').setInputFiles(pdf());
    await expect(page.locator('#libraryEditFileLine')).toContainText('새 파일.pdf');
    await expect(page.locator('#libraryEditFileLine')).toContainText('교체 예정');
    await expect(page.locator('.library-edit-file-note')).toContainText('지우지 않고 이전 파일에 남깁니다');
    // Choosing alone sends nothing.
    expect(state.log).toEqual([]);
    await page.locator('#libraryEditSave').click();
    await expect(page.locator('#libraryEditModal')).toBeHidden();
    // One replace request carrying only the file and the id; no info save (no field changed); then text read and one re-judgement.
    expect(state.replaces).toEqual([{names:['file','replace_document_id'],id:DOC(1),fileName:'새 파일.pdf'}]);
    expect(state.patches).toEqual([]);
    await expect.poll(()=>state.tidies.length).toBe(1);
    expect(state.log).toEqual(['replace','text','tidy']);
    expect(state.texts).toEqual([{action:'document-text',document_id:DOC(1)}]);
    expect(state.tidies[0]).toEqual({kind:'library_fill',mode:'tidy',document_ids:[DOC(1)]});
    const d=state.docs[0];
    expect([d.title,d.category,d.project_id,d.organization_id]).toEqual(['고친 제목','교섭',PROJECT,ORG]);
    expect([d.document_date,d.source]).toEqual(['2026-10-20','공공운수노조']);
    expect(d.reclassify_needed).toBe(false);
    // No AI marker anywhere; the list still shows the same title.
    await expect(page.locator('.lu-row-title',{hasText:'고친 제목'})).toHaveCount(1);
    expect(await page.locator('#libraryView').innerText()).not.toMatch(/AI|자동 ?채움|✨/);
    // Reopen: the old file is listed under 이전 파일 ▾ with a link that opens it through the file rules (PDF/photo: Drive view, others: download).
    await openEdit(page);
    await expect(page.locator('#libraryEditFileLine')).toContainText('새 파일.pdf');
    const prev=page.locator('#libraryEditPrev');
    await expect(prev).toBeVisible();
    await expect(prev.locator('summary')).toHaveText('이전 파일 ▾');
    await prev.locator('summary').click();
    const link=prev.locator('.library-edit-prev-file');
    await expect(link).toHaveText('옛 파일.hwpx');
    await expect(link).toHaveAttribute('href','https://drive.google.com/file/d/oldDriveFile1/view');
    await expect(link).toHaveAttribute('data-fa-id','oldDriveFile1');
    await expect(link).toHaveAttribute('data-fa-press','');
    expect(await page.locator('#libraryEditModal .modal-card').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  });
}

test('replacing together with an edited title: file first, then the info save (title marked as the person\'s), then the background re-judgement',async({page})=>{
  const state=await boot(page);
  await openEdit(page);
  await page.locator('#libraryEditReplaceInput').setInputFiles(pdf());
  await page.locator('#libraryEditTitle').fill('다시 고친 제목');
  await page.locator('#libraryEditSave').click();
  await expect(page.locator('#libraryEditModal')).toBeHidden();
  await expect.poll(()=>state.log.join(',')).toBe('replace,patch,text,tidy');
  const patch=state.patches[0].body;
  expect(patch.title).toBe('다시 고친 제목');
  expect(patch.field_origin.title).toBe('user');
  expect('file_id' in patch||'previous_files' in patch||'reclassify_needed' in patch).toBe(false);
  expect(state.docs[0].title).toBe('다시 고친 제목');
  expect(state.docs[0].file_name).toBe('새 파일.pdf');
});

test('dropping a file on the dialog stages it (several files: the first one, with a note); × cancels; closing the dialog forgets it',async({page})=>{
  const state=await boot(page,{width:1280});
  await openEdit(page);
  const dt=await page.evaluateHandle(()=>{const d=new DataTransfer();d.items.add(new File(['a'],'첫째.pdf',{type:'application/pdf'}));d.items.add(new File(['b'],'둘째.pdf',{type:'application/pdf'}));return d});
  await page.locator('#libraryEditModal .modal-card').dispatchEvent('drop',{dataTransfer:dt});
  await expect(page.locator('#libraryEditFileLine')).toContainText('첫째.pdf');
  await expect(page.locator('#libraryEditStatus')).toContainText('하나만');
  await page.locator('[data-lu-replace-clear]').click();
  await expect(page.locator('#libraryEditFileLine')).toContainText('옛 파일.hwpx');
  await expect(page.locator('#libraryEditFileLine')).not.toContainText('교체 예정');
  await page.locator('#libraryEditReplaceInput').setInputFiles(pdf());
  await page.locator('#libraryEditClose').click();
  await expect(page.locator('#libraryEditModal')).toBeHidden();
  await openEdit(page);
  await expect(page.locator('#libraryEditFileLine')).toContainText('옛 파일.hwpx');
  await expect(page.locator('#libraryEditFileLine')).not.toContainText('교체 예정');
  expect(state.log).toEqual([]);
});

test('a refused replace (the file changed meanwhile) keeps the dialog, the chosen file and the typed edits; nothing else is sent',async({page})=>{
  const state=await boot(page);state.replaceMode='conflict';
  await openEdit(page);
  await page.locator('#libraryEditReplaceInput').setInputFiles(pdf());
  await page.locator('#libraryEditTitle').fill('쓰던 제목');
  await page.locator('#libraryEditSave').click();
  await expect(page.locator('#libraryEditStatus')).toContainText('그 사이 바뀌었습니다');
  await expect(page.locator('#libraryEditModal')).toBeVisible();
  await expect(page.locator('#libraryEditTitle')).toHaveValue('쓰던 제목');
  await expect(page.locator('#libraryEditFileLine')).toContainText('새 파일.pdf');
  await expect(page.locator('#libraryEditSave')).toBeEnabled();
  expect(state.log).toEqual(['replace']);
  expect(state.docs[0].file_name).toBe('옛 파일.hwpx');
});

test('an unknown outcome (gateway timeout) drops the chosen file, asks to check the list, and never resends by itself',async({page})=>{
  const state=await boot(page);state.replaceMode='gateway';
  await openEdit(page);
  await page.locator('#libraryEditReplaceInput').setInputFiles(pdf());
  await page.locator('#libraryEditSave').click();
  await expect(page.locator('#libraryEditStatus')).toContainText('확인');
  await expect(page.locator('#libraryEditFileLine')).not.toContainText('교체 예정');
  await expect(page.locator('#libraryEditSave')).toBeEnabled();
  expect(state.log).toEqual(['replace']);
});

test('before the DB columns exist the dialog has no file line and no 이전 파일',async({page})=>{
  const old=doc(1);delete old.previous_files;delete old.reclassify_needed;
  await boot(page,{docs:[old]});
  await openEdit(page);
  await expect(page.locator('#libraryEditFile')).toBeHidden();
  await expect(page.locator('#libraryEditTitle')).toHaveValue('고친 제목');
});

test('safety net: a document still marked for re-judgement is read and re-judged when the library opens',async({page})=>{
  const state=await boot(page,{docs:[doc(1,{reclassify_needed:true,extraction_status:null,extracted_text:null,file_name:'새 파일.pdf'})],attemptsReady:true});
  await expect.poll(()=>state.tidies.length).toBe(1);
  expect(state.log).toEqual(['text','tidy']);
  expect(state.docs[0].reclassify_needed).toBe(false);
  expect([state.docs[0].document_date,state.docs[0].title]).toEqual(['2026-10-20','고친 제목']);
});
