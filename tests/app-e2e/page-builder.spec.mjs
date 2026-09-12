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
    if(path==='/functions/v1/team-ai')return ok({answer:JSON.stringify({title:'AI 업무현황',summary:'이번 사업의 핵심 진행상황을 공유합니다.',body:'## 현재 상황\n- 핵심 일정 진행 중\n- 현장 의견 취합 중\n\n## 다음 계획\n- 후속 협의 준비'})});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path==='/rest/v1/rpc/app_save_page_v2'){
      const row={id:'page-new',workspace_id:state.workspace.id,space_id:body?.p_space||null,slug:body?.p_slug,title:body?.p_title,summary:body?.p_summary,body:body?.p_body,status:body?.p_status,visibility:body?.p_visibility,owner_id:state.user.id,metadata:{},created_at:now(),updated_at:now()};
      state.pages=[row];return ok(row);
    }
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members'){
      if(url.searchParams.has('user_id')&&url.searchParams.get('limit')==='1')return ok([{workspace_id:state.workspace.id,user_id:state.user.id,role:'owner'}]);
      return ok([{workspace_id:state.workspace.id,user_id:state.user.id,role:'owner',email:state.user.email}]);
    }
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'페이지 작성자'}]);
    if(path==='/rest/v1/app_spaces')return ok(state.spaces);
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

test('page builder creates a designed AI draft and stores template metadata',async({page})=>{
  const state={
    user:{id:'user-1',email:'writer@example.org',user_metadata:{display_name:'페이지 작성자'}},
    workspace:{id:'workspace-1',slug:'team',name:'공공기관사업팀 Workspace'},
    spaces:[{id:'space-1',workspace_id:'workspace-1',name:'인력확충',status:'active',parent_id:null,owner_id:'user-1',sort_order:10}],
    pages:[]
  };
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/');
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
  await page.locator('[data-pb-template="status"]').click();
  await page.locator('#pbPrompt').fill('인력확충 사업의 현재 상황과 다음 계획을 공유하는 페이지');
  await page.locator('#pbGenerate').click();
  await expect(page.locator('#pageTitle')).toHaveValue('AI 업무현황');
  await expect(page.locator('#pageBody')).toContainText('현재 상황');
  await expect(page.locator('#pbPreview')).toBeVisible();
  await expect(page.locator('#pbPreview')).toHaveClass(/status/);
  await expect(page.locator('#pbPreview .pb-paper')).toContainText('다음 계획');

  await page.locator('#pageStatus').selectOption('published');
  await page.locator('#pageVisibility').selectOption('public');
  await page.locator('#savePageBtn').click();
  await expect.poll(()=>state.pages.length).toBe(1);
  await expect.poll(()=>state.pages[0]?.metadata?.page_design?.template).toBe('status');
});
