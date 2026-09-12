import { test, expect } from '@playwright/test';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const now=()=>new Date().toISOString();

async function mockApp(page,state){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const body=(()=>{try{return req.postDataJSON()}catch{return null}})();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    const idFrom=()=>String(url.searchParams.get('id')||'').replace(/^eq\./,'');

    if(path==='/auth/v1/token')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
    if(path==='/auth/v1/user')return ok(state.user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);

    if(path==='/rest/v1/app_workspace_members'){
      if(url.searchParams.has('user_id')&&url.searchParams.get('limit')==='1')return ok([{workspace_id:state.workspace.id,user_id:state.user.id,role:'owner',email:state.user.email}]);
      return ok([{workspace_id:state.workspace.id,user_id:state.user.id,role:'owner',email:state.user.email}]);
    }
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'프로젝트 관리자'}]);
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);
    if(path==='/rest/v1/app_spaces')return ok(state.spaces);
    if(path==='/rest/v1/app_space_members')return ok([]);
    if(path==='/rest/v1/app_tasks')return ok(state.tasks);
    if(path==='/rest/v1/app_events')return ok(state.events);
    if(path==='/rest/v1/app_meetings')return ok(state.meetings);
    if(path==='/rest/v1/app_documents')return ok(state.documents);
    if(path==='/rest/v1/app_pages')return ok(state.pages);

    if(path==='/rest/v1/app_project_sections'){
      if(method==='GET')return ok(state.sections);
      if(method==='POST'){
        const row={...(body||{}),id:`section-${state.sections.length+1}`,created_at:now(),updated_at:now()};
        state.sections.push(row);return ok([row]);
      }
      if(method==='PATCH'){
        const row=state.sections.find(x=>x.id===idFrom());if(row)Object.assign(row,body||{});return ok([]);
      }
      if(method==='DELETE'){
        const id=idFrom();state.sections=state.sections.filter(x=>x.id!==id);state.blocks=state.blocks.filter(x=>x.section_id!==id);return ok([]);
      }
    }
    if(path==='/rest/v1/app_project_blocks'){
      if(method==='GET')return ok(state.blocks);
      if(method==='POST'){
        const row={...(body||{}),id:`block-${state.blocks.length+1}`,created_at:now(),updated_at:now()};
        state.blocks.push(row);return ok([row]);
      }
      if(method==='PATCH'){
        const row=state.blocks.find(x=>x.id===idFrom());if(row)Object.assign(row,body||{});return ok([]);
      }
      if(method==='DELETE'){
        const id=idFrom();state.blocks=state.blocks.filter(x=>x.id!==id);return ok([]);
      }
    }

    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

function baseState(){
  return {
    user:{id:'user-1',email:'owner@example.org',user_metadata:{display_name:'프로젝트 관리자'}},
    workspace:{id:'workspace-1',slug:'team',name:'공공기관사업팀 Workspace'},
    spaces:[{id:'space-1',workspace_id:'workspace-1',name:'민자철도',description:'민자철도 운영기준·공영화·사업장별 대응',parent_id:null,status:'active',owner_id:'user-1',visibility:'team',legacy_path:'/work/private-rail/',metadata:{},sort_order:10}],
    tasks:[{id:'task-1',workspace_id:'workspace-1',project_id:'space-1',title:'국토부 협의 준비',status:'todo',assignee_id:'user-1',created_by:'user-1',created_at:now()}],
    events:[{id:'event-1',workspace_id:'workspace-1',project_id:'space-1',title:'국회 토론회',start_at:'2026-09-29T05:00:00Z',location:'국회'}],
    meetings:[{id:'meeting-1',workspace_id:'workspace-1',project_id:'space-1',title:'민자철도 간담회',meeting_at:'2026-09-20T05:00:00Z'}],
    documents:[{id:'doc-1',workspace_id:'workspace-1',project_id:'space-1',title:'운영기준 검토자료',category:'정책자료',drive_url:'https://drive.google.com/example',created_at:now()}],
    pages:[{id:'page-1',workspace_id:'workspace-1',space_id:'space-1',slug:'private-rail-brief',title:'민자철도 현황 공유',status:'published',visibility:'public',updated_at:now()}],
    sections:[],blocks:[]
  };
}

async function signIn(page){
  await expect(page.locator('#emailAuthToggle')).toBeVisible({timeout:10000});
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('owner@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
}

test('project hub provides common sections and editable status blocks',async({page})=>{
  const state=baseState();
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);

  await page.locator('[data-view="projects"]').click();
  const project=page.locator('[data-project="space-1"]').first();
  await expect(project).toBeVisible();
  await project.click();
  await expect(page.locator('#projectModal')).toBeVisible();
  await expect(page.locator('#pvHub')).toBeVisible();
  await expect(page.locator('#pvHub')).toContainText('PROJECT HUB');
  await expect(page.locator('#pvNav [data-pv-target]')).toHaveCount(6);
  await expect(page.locator('#pvEventsList')).toContainText('국회 토론회');
  await expect(page.locator('#pvMeetingsList')).toContainText('민자철도 간담회');
  await expect(page.locator('#pvDocsList')).toContainText('운영기준 검토자료');
  await expect(page.locator('#pvPagesList')).toContainText('민자철도 현황 공유');
  await expect(page.locator('#pvLegacyWrap')).toContainText('기존 웹 페이지 보기');

  await expect(page.locator('#pvAddSection')).toBeVisible();
  await page.locator('#pvAddSection').click();
  await page.locator('#pvSectionTitle').fill('사업장별 현황');
  await page.locator('#pvSaveSection').click();
  await expect.poll(()=>state.sections.length).toBe(1);
  await expect(page.locator('#pvSectionList')).toContainText('사업장별 현황');

  await page.locator('[data-pv-add-block="section-1"]').click();
  await page.locator('#pvBlockType').selectOption('table');
  await page.locator('#pvBlockTitle').fill('사업장 현황표');
  await page.locator('#pvBlockContent').fill('사업장 | 현황 | 이후 계획\n공항철도 | 교섭 중 | 인력 22명 충원 요구\nGTX-A | 쟁의 준비 | 근무체계 개선');
  await page.locator('#pvSaveBlock').click();
  await expect.poll(()=>state.blocks.length).toBe(1);
  await expect(page.locator('#pvSectionList table')).toContainText('공항철도');
  await expect(page.locator('#pvSectionList table')).toContainText('GTX-A');
});

test('project query deep link opens the requested project after login',async({page})=>{
  const state=baseState();
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/?project=space-1');
  await signIn(page);
  await expect(page.locator('#projectModal')).toBeVisible({timeout:10000});
  await expect(page.locator('#projectModalTitle')).toHaveText('민자철도');
  await expect(page.locator('#pvHub')).toContainText('PROJECT HUB');
  await expect(page).toHaveURL(/project=space-1/);
});
