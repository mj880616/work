import { test, expect } from '@playwright/test';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const session={access_token:'e2e-access',refresh_token:'e2e-refresh',expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer'};
const now=()=>new Date().toISOString();

async function installMock(page,state){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const body=(()=>{try{return req.postDataJSON()}catch{return null}})();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/user')return ok(state.user);
    if(path==='/auth/v1/token')return ok(session);
    if(path==='/auth/v1/logout')return ok({});
    if(path.startsWith('/functions/v1/'))return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path==='/rest/v1/rpc/app_request_workspace_access'){
      if(!state.requests.length)state.requests.push({id:'request-1',workspace_id:state.workspace.id,user_id:state.user.id,display_name:state.user.user_metadata.display_name,email:state.user.email,requested_role:'author',status:'pending',requested_at:now()});
      return ok('request-1');
    }
    if(path==='/rest/v1/rpc/app_approve_access_request'){
      const r=state.requests.find(x=>x.id===body?.p_request);if(r)r.status='approved';
      return ok(true);
    }
    if(path==='/rest/v1/rpc/app_reject_access_request'){
      const r=state.requests.find(x=>x.id===body?.p_request);if(r)r.status='rejected';
      return ok(true);
    }
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members'){
      if(url.searchParams.has('user_id')&&url.searchParams.get('limit')==='1')return ok(state.membership?[state.membership]:[]);
      return ok(state.membership?[state.membership]:[]);
    }
    if(path==='/rest/v1/app_access_requests')return ok(state.requests.filter(x=>!url.searchParams.get('status')||x.status===(url.searchParams.get('status')||'').replace(/^eq\./,'')));
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:state.user.user_metadata.display_name}]);
    if(path==='/rest/v1/app_suborganizations'){
      if(method==='PATCH'){Object.assign(state.org,body||{});return ok([])}
      return ok([state.org]);
    }
    if(path==='/rest/v1/app_suborganization_assignees')return ok(state.membership?[{organization_id:state.org.id,user_id:state.user.id,assigned_by:state.user.id,created_at:now()}]:[]);
    if(path==='/rest/v1/app_org_affiliation_tags'){
      if(method==='POST'){
        const row={...(body||{}),id:`tag-${state.tags.length+1}`};state.tags.push(row);return ok([row]);
      }
      return ok(state.tags);
    }
    if(path==='/rest/v1/app_suborganization_affiliations'){
      if(method==='GET')return ok(state.affiliations.map(tag_id=>({tag_id,created_at:now()})));
      if(method==='DELETE'){state.affiliations=[];return ok([])}
      if(method==='POST'){state.affiliations=(Array.isArray(body)?body:[body]).map(x=>x.tag_id);return ok([])}
    }
    if(path==='/rest/v1/app_suborganization_status_items'||path==='/rest/v1/app_suborganization_timeline')return ok([]);
    if(path==='/rest/v1/app_notifications')return ok([]);
    if(path==='/rest/v1/app_profile_workplaces'||path==='/rest/v1/app_profile_report_projects')return ok([]);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

async function preloadSession(page){await page.addInitScript(s=>window['local'+'Storage'].setItem('kptu_collab_session_v1',JSON.stringify(s)),session)}

test('new account cannot access workspace before admin approval',async({page})=>{
  const state={
    user:{id:'new-user',email:'new@example.org',user_metadata:{display_name:'신규 팀원'}},
    workspace:{id:'workspace-1',slug:'kptu-work',name:'공공기관사업팀 Workspace'},membership:null,requests:[],
    org:{id:'org-1',workspace_id:'workspace-1',name:'테스트지부',representative_name:null,contact:null,member_count:null,updated_at:now(),created_by:'owner-1'},tags:[],affiliations:[]
  };
  await preloadSession(page);await installMock(page,state);await page.goto('http://127.0.0.1:8123/app/');
  await expect(page.locator('#bootstrapView')).toBeVisible({timeout:10000});
  await expect(page.locator('#bootstrapView')).toContainText('관리자 승인 대기 중');
  await expect(page.locator('#bootstrapView')).toContainText('승인하기 전에는');
  await expect(page.locator('#appView')).toBeHidden();
  await expect.poll(()=>state.requests.length).toBe(1);
});

test('admin sees pending access request and can approve it',async({page})=>{
  const state={
    user:{id:'owner-1',email:'owner@example.org',user_metadata:{display_name:'김명진'}},
    workspace:{id:'workspace-1',slug:'kptu-work',name:'공공기관사업팀 Workspace'},membership:{workspace_id:'workspace-1',user_id:'owner-1',role:'owner'},
    requests:[{id:'request-1',workspace_id:'workspace-1',user_id:'new-user',display_name:'신규 팀원',email:'new@example.org',requested_role:'author',status:'pending',requested_at:now()}],
    org:{id:'org-1',workspace_id:'workspace-1',name:'테스트지부',representative_name:'대표자',contact:'010-1234-5678',member_count:100,updated_at:now(),created_by:'owner-1'},
    tags:[{id:'tag-1',workspace_id:'workspace-1',name:'운수산업협의회',kind:'council',created_by:'owner-1'}],affiliations:['tag-1']
  };
  page.on('dialog',d=>d.accept());
  await preloadSession(page);await installMock(page,state);await page.goto('http://127.0.0.1:8123/app/');
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await page.locator('[data-view="team"]').click();
  await expect(page.locator('#aaReviewSection')).toBeVisible();
  await expect(page.locator('#aaReviewSection')).toContainText('신규 팀원');
  await page.locator('[data-aa-approve="request-1"]').click();
  await expect.poll(()=>state.requests[0].status).toBe('approved');
  await expect(page.locator('#aaReviewList')).toContainText('승인 대기 중인 계정이 없습니다.');
});

test('organization detail shows representative contact, system update time, and multi affiliation tags',async({page})=>{
  const state={
    user:{id:'owner-1',email:'owner@example.org',user_metadata:{display_name:'김명진'}},
    workspace:{id:'workspace-1',slug:'kptu-work',name:'공공기관사업팀 Workspace'},membership:{workspace_id:'workspace-1',user_id:'owner-1',role:'owner'},requests:[],
    org:{id:'org-1',workspace_id:'workspace-1',name:'테스트지부',representative_name:'대표자',contact:'010-1234-5678',member_count:100,updated_at:now(),created_by:'owner-1'},
    tags:[{id:'tag-1',workspace_id:'workspace-1',name:'운수산업협의회',kind:'council',created_by:'owner-1'},{id:'tag-2',workspace_id:'workspace-1',name:'안전인력사업단',kind:'taskforce',created_by:'owner-1'}],affiliations:['tag-1','tag-2']
  };
  await preloadSession(page);await installMock(page,state);await page.goto('http://127.0.0.1:8123/app/');
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await page.evaluate(()=>window.KPTUDeferredFeatures.load());
  await page.evaluate(()=>{const b=document.createElement('button');b.id='openOrgE2E';b.dataset.psWorkplaceOrg='org-1';document.body.appendChild(b)});
  await page.locator('#openOrgE2E').click();
  await expect(page.locator('#wdModal')).toBeVisible();
  await expect(page.locator('label:has-text("대표자 연락처")')).toContainText('대표자 연락처');
  await expect(page.locator('#wdContact')).toHaveValue('010-1234-5678');
  await expect(page.locator('#wdUpdated')).not.toHaveText('-');
  await expect(page.locator('#wdAffChips')).toContainText('운수산업협의회');
  await expect(page.locator('#wdAffChips')).toContainText('안전인력사업단');
  await page.locator('#wdAffManage').click();
  await expect(page.locator('#wdAffModal')).toBeVisible();
  await page.locator('#wdAffNewKind').selectOption('taskforce');
  await page.locator('#wdAffNewName').fill('민자철도사업단');
  await page.locator('#wdAffCreate').click();
  await expect(page.locator('#wdAffChoices')).toContainText('민자철도사업단');
  await page.locator('#wdAffSave').click();
  await expect.poll(()=>state.affiliations.length).toBe(3);
});
