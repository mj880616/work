import { test, expect } from '@playwright/test';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const now=()=>new Date().toISOString();

async function mockApp(page,state){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const body=(()=>{try{return req.postDataJSON()}catch{return null}})();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
    if(path==='/auth/v1/user')return ok(state.user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[]});
    if(path==='/functions/v1/google-tasks')return ok({tasks:[],needs_reconnect:false});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,count:0,public_key:'qa'});
    if(path==='/functions/v1/library-files'){
      if(!state.documents.some(x=>x.id==='doc-upload'))state.documents.unshift({id:'doc-upload',workspace_id:state.workspace.id,project_id:'space-1',title:'새 현장자료',file_name:'new-reference.txt',category:'기타',document_date:null,extraction_status:null,created_at:now()});
      return ok({ok:true,document:state.documents.find(x=>x.id==='doc-upload')});
    }
    if(path==='/functions/v1/document-ai-index'){
      for(const id of body?.document_ids||[])state.indexed.add(id);
      return ok({ok:true,documents:(body?.document_ids||[]).map(id=>({document_id:id,status:'indexed',summary:'저장된 요약',keywords:['인력'],chunk_count:2}))});
    }
    if(path==='/functions/v1/page-ai-draft'){
      state.lastPageAi=body;
      return ok({draft:{title:'AI 업무현황',summary:'이번 사업의 핵심 진행상황을 공유합니다.',body:'## 현재 상황\n- 선택한 회의와 자료를 바탕으로 핵심 일정 진행 중\n- 현장 의견 취합 중\n\n## 다음 계획\n- 후속 협의 준비',design:{layout:'dashboard',hero:'band',accent:'green',section_style:'cards',density:'compact'}},used_sources:[{type:'project',id:'space-1',label:'인력확충'},{type:'meeting',id:'meeting-1',label:'인력확충 점검회의'},{type:'document',id:'doc-1',label:'인력확충 자료'},{type:'document',id:'doc-upload',label:'새 현장자료'}]});
    }
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path==='/rest/v1/rpc/app_save_page_v2'){
      const row={id:'page-new',workspace_id:state.workspace.id,space_id:body?.p_space||null,slug:body?.p_slug,title:body?.p_title,summary:body?.p_summary,body:body?.p_body,status:body?.p_status,visibility:body?.p_visibility,owner_id:state.user.id,metadata:state.newPageMetadata||{},created_at:now(),updated_at:now()};
      state.pages=[row];return ok(row);
    }
    if(path==='/rest/v1/rpc/app_public_post'){
      const page=state.pages.find(x=>x.slug===body?.p_slug&&x.status==='published'&&x.visibility==='public');
      return ok(page?[{title:page.title,summary:page.summary,body:page.body,page_design:page.metadata?.page_design||{},updated_at:page.updated_at}]:[]);
    }
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members'){
      if(url.searchParams.has('user_id')&&url.searchParams.get('limit')==='1')return ok([{workspace_id:state.workspace.id,user_id:state.user.id,role:'owner'}]);
      return ok([{workspace_id:state.workspace.id,user_id:state.user.id,role:'owner',email:state.user.email}]);
    }
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'페이지 작성자'}]);
    if(path==='/rest/v1/app_spaces')return ok(state.spaces);
    if(path==='/rest/v1/app_meetings')return ok(state.meetings);
    if(path==='/rest/v1/app_documents')return ok(state.documents);
    if(path==='/rest/v1/app_document_ai_index')return ok([...state.indexed].map(document_id=>({document_id})));
    if(path==='/rest/v1/app_pages'){
      if(method==='GET')return ok(state.pages);
      if(method==='PATCH'){
        const id=(url.searchParams.get('id')||'').replace(/^eq\./,'');
        const row=state.pages.find(x=>x.id===id);if(row)Object.assign(row,body||{});return ok([]);
      }
    }
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

test('page builder selects project, meeting and document references, indexes uploads, generates and saves source metadata',async({page})=>{
  const state={
    user:{id:'user-1',email:'writer@example.org',user_metadata:{display_name:'페이지 작성자'}},
    workspace:{id:'workspace-1',slug:'team',name:'공공기관사업팀 Workspace'},
    spaces:[{id:'space-1',workspace_id:'workspace-1',name:'인력확충',status:'active',parent_id:null,owner_id:'user-1',sort_order:10}],
    meetings:[{id:'meeting-1',workspace_id:'workspace-1',project_id:'space-1',title:'인력확충 점검회의',meeting_at:'2026-09-13T05:00:00Z',result_status:'final'}],
    documents:[{id:'doc-1',workspace_id:'workspace-1',project_id:'space-1',title:'인력확충 자료',file_name:'workforce.pdf',category:'정책자료',document_date:'2026-09-12',extraction_status:null,created_at:'2026-09-12T00:00:00Z'}],
    indexed:new Set(),pages:[],lastPageAi:null
  };
  await mockApp(page,state);
  const returnTo='http://127.0.0.1:8123/app/';
  await page.goto(`http://127.0.0.1:8123/app/login/?return=${encodeURIComponent(returnTo)}`);
  await expect(page.locator('#emailAuthToggle')).toBeVisible({timeout:10000});
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('writer@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});

  await page.locator('[data-view="pages"]').click();
  await page.locator('#newPageBtn').click();
  await expect(page.locator('#editorModal')).toBeVisible();
  await expect(page.locator('#pageBuilderPanel')).toBeVisible();
  await expect(page.locator('[data-pb-template]')).toHaveCount(5);
  await page.locator('#pageSpace').selectOption('space-1');
  await page.locator('[data-pb-template="status"]').click();
  await page.locator('#pbSourceToggle').click();
  await expect(page.locator('#pbSourcePicker')).toBeVisible();
  await page.locator('[data-pb-source="project"]').check();
  await page.locator('[data-pb-source="project_updates"]').check();
  await page.locator('[data-pb-source="project_milestones"]').check();
  await page.locator('[data-pb-meeting="meeting-1"]').check();
  await page.locator('[data-pb-document="doc-1"]').check();
  await expect(page.locator('#pbSourceSummary')).toContainText('5개 참고 범위 선택');

  await page.locator('#pbSourceUpload').setInputFiles({name:'new-reference.txt',mimeType:'text/plain',buffer:Buffer.from('인력확충 현장자료 본문')});
  await expect.poll(()=>state.indexed.has('doc-upload')).toBe(true);
  await expect(page.locator('[data-pb-document="doc-upload"]')).toBeChecked();
  await expect(page.locator('#pbSourceSummary')).toContainText('6개 참고 범위 선택');

  await page.locator('#pbPrompt').fill('선택한 인력확충 프로젝트와 회의결과, 자료를 근거로 현장 공유 페이지를 작성해줘');
  await page.locator('#pbGenerate').click();
  await expect(page.locator('#pageTitle')).toHaveValue('AI 업무현황');
  await expect(page.locator('#pageBody')).toHaveValue(/선택한 회의와 자료/);
  await expect(page.locator('#pbPreview')).toBeVisible();
  await expect(page.locator('#pbDesignSummary')).toContainText('대시보드형');
  await expect(page.locator('#pbDesignSummary')).toContainText('카드');
  await expect(page.locator('#pbDesignSummary')).toContainText('그린');
  await expect.poll(()=>state.indexed.has('doc-1')).toBe(true);
  await expect.poll(()=>state.lastPageAi?.sources?.project).toBe(true);
  await expect.poll(()=>state.lastPageAi?.sources?.meeting_ids).toEqual(['meeting-1']);
  await expect.poll(()=>new Set(state.lastPageAi?.sources?.document_ids||[])).toEqual(new Set(['doc-1','doc-upload']));

  await page.locator('#pageStatus').selectOption('published');
  await page.locator('#pageVisibility').selectOption('public');
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#savePageBtn').click();
  await expect.poll(()=>state.pages.length).toBe(1);
  await expect.poll(()=>state.pages[0]?.metadata?.page_design?.version).toBe(2);
  await expect.poll(()=>state.pages[0]?.metadata?.page_design?.layout).toBe('dashboard');
  await expect.poll(()=>state.pages[0]?.metadata?.ai_sources?.project).toBe(true);
  await expect.poll(()=>state.pages[0]?.metadata?.ai_sources?.project_updates).toBe(true);
  await expect.poll(()=>state.pages[0]?.metadata?.ai_sources?.project_milestones).toBe(true);
  await expect.poll(()=>state.pages[0]?.metadata?.ai_sources?.meeting_ids).toEqual(['meeting-1']);
  await expect.poll(()=>new Set(state.pages[0]?.metadata?.ai_sources?.document_ids||[])).toEqual(new Set(['doc-1','doc-upload']));

  await page.goto(`http://127.0.0.1:8123/p/?slug=${encodeURIComponent(state.pages[0].slug)}`);
  await expect(page.locator('#paper')).toHaveClass(/pd-layout-dashboard/);
  await expect(page.locator('#paper')).toHaveClass(/pd-hero-band/);
  await expect(page.locator('#paper')).toHaveClass(/pd-accent-green/);
  await expect(page.locator('#paper .pd-section')).toHaveCount(2);
  await expect(page.locator('#paper')).toContainText('후속 협의 준비');
});

test('page builder keeps imported source metadata when metadata read fails after body save',async({page})=>{
  const state={
    user:{id:'user-1',email:'writer@example.org'},
    workspace:{id:'workspace-1',slug:'team',name:'공공기관사업팀 Workspace'},
    spaces:[],meetings:[],documents:[],indexed:new Set(),pages:[],
    newPageMetadata:{web1_source_id:'2in1/index.html',web1_parent_source_id:null}
  };
  await mockApp(page,state);
  let metadataPatches=0;
  await page.route(`${SB}/rest/v1/app_pages?*`,route=>{
    const req=route.request(),url=new URL(req.url());
    if(req.method()==='GET'&&url.searchParams.get('select')==='metadata')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'metadata unavailable'})});
    if(req.method()==='PATCH')metadataPatches++;
    return route.fallback();
  });
  await page.goto('http://127.0.0.1:8123/app/');
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('writer@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible();
  await page.locator('[data-view="pages"]').click();
  await page.locator('#newPageBtn').click();
  await page.locator('#pageTitle').fill('2인1조 사업현황');
  await page.locator('#savePageBtn').click();
  await expect(page.locator('#editorStatus')).toContainText('일부 부가설정 저장에 실패했습니다.');
  expect(metadataPatches).toBe(0);
  expect(state.pages[0].metadata).toEqual(state.newPageMetadata);
});
