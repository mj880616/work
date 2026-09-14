import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const now=()=>new Date().toISOString();
const eq=(url,key)=>String(url.searchParams.get(key)||'').replace(/^eq\./,'');

async function mockApp(page,state){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const body=(()=>{try{return req.postDataJSON()}catch{return null}})();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
    if(path==='/auth/v1/user')return ok(state.user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:state.workspace.id,user_id:state.user.id,role:'owner',email:state.user.email}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'프로젝트 관리자',job_title:'국장'}]);
    if(path==='/rest/v1/app_profile_workplaces')return ok([]);
    if(path==='/rest/v1/app_profile_report_projects')return ok([]);
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);
    if(path==='/rest/v1/app_space_members')return ok([]);
    if(path==='/rest/v1/app_spaces'){
      if(method==='GET'){
        let rows=[...state.spaces];
        const id=eq(url,'id'),status=eq(url,'status');
        if(id)rows=rows.filter(x=>x.id===id);
        if(status)rows=rows.filter(x=>x.status===status);
        return ok(rows);
      }
      if(method==='PATCH'){
        const id=eq(url,'id');const row=state.spaces.find(x=>x.id===id);if(row)Object.assign(row,body||{});return ok([]);
      }
      return ok([]);
    }
    if(path==='/rest/v1/app_project_modules')return ok(state.modules.filter(x=>!eq(url,'project_id')||x.project_id===eq(url,'project_id')));
    if(path==='/rest/v1/app_project_workstreams')return ok([]);
    if(path==='/rest/v1/app_project_progress_updates')return ok([]);
    if(path==='/rest/v1/app_project_milestones')return ok([]);
    if(path==='/rest/v1/app_project_decisions')return ok([]);
    if(path==='/rest/v1/app_project_comments')return ok([]);
    if(path==='/rest/v1/app_tasks')return ok([]);
    if(path==='/rest/v1/app_events')return ok([]);
    if(path==='/rest/v1/app_event_attendees')return ok([]);
    if(path==='/rest/v1/app_meetings')return ok([]);
    if(path==='/rest/v1/app_documents')return ok([]);
    if(path==='/rest/v1/app_pages')return ok([]);
    if(path==='/rest/v1/app_groups')return ok([]);
    if(path==='/rest/v1/app_notifications')return ok([]);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

async function signIn(page){
  await page.goto(loginEntry(page.url()));
  await expect(page.locator('#emailAuthToggle')).toBeVisible({timeout:10000});
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('owner@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
}

test('V2 project can be archived, reviewed in profile, and restored to Live',async({page})=>{
  const state={
    user:{id:'user-1',email:'owner@example.org',user_metadata:{display_name:'프로젝트 관리자'}},
    workspace:{id:'workspace-1',slug:'team',name:'공공기관사업팀 Workspace'},
    spaces:[{id:'project-1',workspace_id:'workspace-1',name:'인력확충 투쟁',description:'안전·공공서비스 인력확충',parent_id:null,status:'active',owner_id:'user-1',sort_order:10,updated_at:now(),metadata:{project_system:'v2',management_version:2,project_type:'campaign',objective:'안전·공공서비스 인력확충'}}],
    modules:[{id:'module-1',project_id:'project-1',module_key:'overview',title:'개요',enabled:true,sort_order:10},{id:'module-2',project_id:'project-1',module_key:'progress',title:'진행상황',enabled:true,sort_order:20}]
  };
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);
  await page.locator('[data-view="projects"]').click();
  await expect(page.locator('[data-pm2-project="project-1"]')).toBeVisible({timeout:10000});
  await page.locator('[data-pm2-project="project-1"]').click();
  await expect(page.locator('#pm2DetailModal')).toBeVisible();
  await expect(page.locator('[data-pa-archive="project-1"]')).toBeVisible({timeout:5000});
  page.once('dialog',d=>d.accept());
  await page.locator('[data-pa-archive="project-1"]').click();
  await expect.poll(()=>state.spaces[0].status).toBe('archived');

  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  const profileButton=page.locator('[data-view="profile"]');
  await expect(profileButton).toBeVisible({timeout:10000});
  await profileButton.click();
  await expect(page.locator('#paArchivedProjectsPanel')).toContainText('인력확충 투쟁',{timeout:10000});
  await expect(page.locator('[data-pa-restore="project-1"]')).toHaveText('Live 프로젝트로 복구');
  await page.locator('[data-pa-restore="project-1"]').click();
  await expect.poll(()=>state.spaces[0].status).toBe('active');

  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await page.locator('[data-view="projects"]').click();
  await expect(page.locator('[data-pm2-project="project-1"]')).toBeVisible({timeout:10000});
});
