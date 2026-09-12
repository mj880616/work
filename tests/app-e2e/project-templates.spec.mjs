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
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'일반 사용자'}]);
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);
    if(path==='/rest/v1/app_spaces')return ok(state.spaces);
    if(path==='/rest/v1/app_space_members')return ok([]);
    if(path==='/rest/v1/app_tasks')return ok([]);
    if(path==='/rest/v1/app_events')return ok([]);
    if(path==='/rest/v1/app_meetings')return ok([]);
    if(path==='/rest/v1/app_documents')return ok([]);
    if(path==='/rest/v1/app_pages')return ok([]);

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

async function signIn(page){
  await expect(page.locator('#emailAuthToggle')).toBeVisible({timeout:10000});
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('member@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
}

test('editable project exposes design gallery and applies a reusable template',async({page})=>{
  const state={
    user:{id:'user-1',email:'member@example.org',user_metadata:{display_name:'일반 사용자'}},
    workspace:{id:'workspace-1',slug:'team',name:'팀 Workspace'},
    spaces:[{id:'space-1',workspace_id:'workspace-1',name:'새 프로젝트',description:'일반 사용자가 직접 만든 프로젝트',parent_id:null,status:'active',owner_id:'user-1',visibility:'team',metadata:{},sort_order:10}],
    sections:[],blocks:[]
  };
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);

  await page.locator('[data-view="projects"]').click();
  await page.locator('[data-project="space-1"]').first().click();
  await expect(page.locator('#projectModal')).toBeVisible();
  await expect(page.locator('#pvtOpen')).toBeVisible({timeout:10000});

  await page.locator('#pvtOpen').click();
  await expect(page.locator('#pvtModal')).toBeVisible();
  await expect(page.locator('[data-pvt-card]')).toHaveCount(6);
  await expect(page.locator('#pvtGrid')).toContainText('기본 사업현황');
  await expect(page.locator('#pvtGrid')).toContainText('정책·입법 대응');
  await expect(page.locator('#pvtGrid')).toContainText('행사·기자회견 준비');

  await page.locator('[data-pvt-apply="basic-status"]').click();
  await expect.poll(()=>state.sections.length).toBe(2);
  await expect.poll(()=>state.blocks.length).toBe(3);
  await expect(page.locator('#pvSectionList')).toContainText('핵심 현황');
  await expect(page.locator('#pvSectionList')).toContainText('핵심 지표');
  await expect(page.locator('#pvSectionList')).toContainText('현재 상황');
  await expect(page.locator('#pvSectionList')).toContainText('주요 일정');
  await expect(page.locator('#pvSectionList')).toContainText('내용을 입력하세요');

  const edit=page.locator('[data-pv-edit-block]').first();
  await edit.click();
  await expect(page.locator('#pvBlockModal')).toBeVisible();
  await page.locator('#pvBlockContent').fill('진행률 | 60% | 이번 달 기준\n핵심 과제 | 4건 | 주요 과제');
  await page.locator('#pvSaveBlock').click();
  await expect(page.locator('#pvSectionList')).toContainText('60%');
});
