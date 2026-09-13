import { test, expect } from '@playwright/test';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const now=()=>new Date().toISOString();
const idFilter=url=>String(url.searchParams.get('id')||'').replace(/^eq\./,'');
const projectFilter=url=>String(url.searchParams.get('project_id')||'').replace(/^eq\./,'');

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
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'프로젝트 관리자'}]);
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);
    if(path==='/rest/v1/app_space_members')return ok([]);
    if(path==='/rest/v1/app_spaces'){
      if(method==='GET')return ok(state.spaces);
      if(method==='POST'){
        const row={...(body||{}),id:`v2-${state.spaces.length+1}`,created_at:now(),updated_at:now()};state.spaces.push(row);return ok([row]);
      }
      return ok([]);
    }
    if(path==='/rest/v1/app_project_modules'){
      const pid=projectFilter(url);
      if(method==='GET')return ok(state.modules.filter(x=>!pid||x.project_id===pid));
      if(method==='POST'){
        const rows=(Array.isArray(body)?body:[body]).map((x,i)=>({...x,id:`module-${state.modules.length+i+1}`,created_at:now(),updated_at:now()}));state.modules.push(...rows);return ok(rows);
      }
      if(method==='PATCH'){const row=state.modules.find(x=>x.id===idFilter(url));if(row)Object.assign(row,body||{});return ok([])}
    }
    if(path==='/rest/v1/app_project_workstreams'){
      const pid=projectFilter(url);
      if(method==='GET')return ok(state.workstreams.filter(x=>!pid||x.project_id===pid));
      if(method==='POST'){
        const rows=(Array.isArray(body)?body:[body]).map((x,i)=>({...x,id:`ws-${state.workstreams.length+i+1}`,created_at:now(),updated_at:now()}));state.workstreams.push(...rows);return ok(rows);
      }
      if(method==='PATCH'){const row=state.workstreams.find(x=>x.id===idFilter(url));if(row)Object.assign(row,body||{});return ok([])}
      if(method==='DELETE'){const id=idFilter(url);state.workstreams=state.workstreams.filter(x=>x.id!==id);return ok([])}
    }
    if(path==='/rest/v1/app_project_progress_updates'){
      const pid=projectFilter(url);
      if(method==='GET')return ok(state.progress.filter(x=>!pid||x.project_id===pid));
      if(method==='POST'){const row={...(body||{}),id:`progress-${state.progress.length+1}`,created_at:now(),updated_at:now()};state.progress.unshift(row);return ok([row])}
    }
    if(path==='/rest/v1/app_project_milestones')return ok(state.milestones.filter(x=>!projectFilter(url)||x.project_id===projectFilter(url)));
    if(path==='/rest/v1/app_project_decisions')return ok(state.decisions.filter(x=>!projectFilter(url)||x.project_id===projectFilter(url)));
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
  await expect(page.locator('#emailAuthToggle')).toBeVisible({timeout:10000});
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('owner@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
}

test('legacy snapshots stay preserved while a normalized V2 project is created and progressed',async({page})=>{
  const state={
    user:{id:'user-1',email:'owner@example.org',user_metadata:{display_name:'프로젝트 관리자'}},
    workspace:{id:'workspace-1',slug:'team',name:'공공기관사업팀 Workspace'},
    spaces:[{id:'legacy-1',workspace_id:'workspace-1',name:'기존 인력확충 이식본',description:'참고용',parent_id:null,status:'active',owner_id:'user-1',sort_order:10,metadata:{legacy_snapshot:true,migration_source:'/work/workforce/'}}],
    modules:[],workstreams:[],progress:[],milestones:[],decisions:[]
  };
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);
  await page.locator('[data-view="projects"]').click();

  await expect(page.locator('.pm2-legacy-box')).toContainText('기존 이식본 1개');
  await expect(page.locator('[data-project="legacy-1"]')).toHaveCount(0);

  await page.locator('#newProjectBtn').click();
  await expect(page.locator('#pm2CreateModal')).toBeVisible();
  await expect(page.locator('[data-pm2-type]')).toHaveCount(5);
  await page.locator('[data-pm2-type="campaign"]').click();
  await page.locator('#pm2Name').fill('공공기관 인력확충 투쟁 V2');
  await page.locator('#pm2Objective').fill('안전·공공서비스 인력확충과 2% 감축기조 철회');
  await page.locator('#pm2Create').click();

  await expect.poll(()=>state.spaces.filter(x=>x.metadata?.project_system==='v2').length).toBe(1);
  await expect.poll(()=>state.modules.length).toBe(8);
  await expect.poll(()=>state.workstreams.length).toBe(5);
  await expect(page.locator('#pm2DetailModal')).toBeVisible({timeout:10000});
  await expect(page.locator('#pm2DetailTitle')).toHaveText('공공기관 인력확충 투쟁 V2');
  await expect(page.locator('#pm2-mod-progress')).toContainText('정부·정책 대응');
  await expect(page.locator('#pm2-mod-progress')).toContainText('현장 조직화');

  await page.locator('[data-pm2-progress-ws]').first().click();
  await expect(page.locator('#pm2ProgressModal')).toBeVisible();
  await page.locator('#pm2ProgressSummary').fill('9월 기자회견과 공동투쟁 준비 진행');
  await page.locator('#pm2ProgressNext').fill('10월 정부 협의 준비');
  await page.locator('#pm2SaveProgress').click();
  await expect.poll(()=>state.progress.length).toBe(1);
  await expect(page.locator('#pm2-mod-progress')).toContainText('9월 기자회견과 공동투쟁 준비 진행');
  await expect(page.locator('#pm2-mod-progress')).toContainText('10월 정부 협의 준비');
});
