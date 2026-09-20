import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const now=()=>new Date().toISOString();
const idFilter=url=>String(url.searchParams.get('id')||'').replace(/^eq\./,'');
const projectFilter=url=>String(url.searchParams.get('project_id')||'').replace(/^eq\./,'');

function initialState(){
  return {
    user:{id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA 사용자'}},
    workspace:{id:'qa-workspace',slug:'qa',name:'공공기관사업팀 Workspace'},
    spaces:[{id:'legacy-qa',workspace_id:'qa-workspace',name:'이식본',description:'',parent_id:null,status:'active',owner_id:'qa-user',sort_order:10,metadata:{legacy_snapshot:true}}],
    modules:[],workstreams:[],progress:[],milestones:[],decisions:[],comments:[]
  };
}

async function mockApp(page,state){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const body=(()=>{try{return req.postDataJSON()}catch{return null}})();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});

    if(path==='/auth/v1/token')return ok({access_token:'qa-access',refresh_token:'qa-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
    if(path==='/auth/v1/user')return ok(state.user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:state.workspace.id,user_id:state.user.id,role:'owner',email:state.user.email}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'QA 사용자'}]);
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);
    if(path==='/rest/v1/app_space_members')return ok([]);

    if(path==='/rest/v1/app_spaces'){
      if(method==='GET')return ok(state.spaces);
      if(method==='POST'){
        const row={...(body||{}),id:`qa-project-${state.spaces.length+1}`,created_at:now(),updated_at:now()};
        state.spaces.push(row);return ok([row]);
      }
      if(method==='PATCH'){
        const row=state.spaces.find(x=>x.id===idFilter(url));if(row)Object.assign(row,body||{});return ok([]);
      }
      return ok([]);
    }

    if(path==='/rest/v1/app_project_modules'){
      const pid=projectFilter(url);
      if(method==='GET')return ok(state.modules.filter(x=>!pid||x.project_id===pid));
      if(method==='POST'){
        const rows=(Array.isArray(body)?body:[body]).map((x,i)=>({...x,id:`qa-module-${state.modules.length+i+1}`,created_at:now(),updated_at:now()}));
        state.modules.push(...rows);return ok(rows);
      }
      if(method==='PATCH'){const row=state.modules.find(x=>x.id===idFilter(url));if(row)Object.assign(row,body||{});return ok([])}
    }

    if(path==='/rest/v1/app_project_workstreams'){
      const pid=projectFilter(url);
      if(method==='GET')return ok(state.workstreams.filter(x=>!pid||x.project_id===pid));
      if(method==='POST'){
        const rows=(Array.isArray(body)?body:[body]).map((x,i)=>({...x,id:`qa-ws-${state.workstreams.length+i+1}`,created_at:now(),updated_at:now()}));
        state.workstreams.push(...rows);return ok(rows);
      }
      if(method==='PATCH'){const row=state.workstreams.find(x=>x.id===idFilter(url));if(row)Object.assign(row,body||{});return ok([])}
      if(method==='DELETE'){state.workstreams=state.workstreams.filter(x=>x.id!==idFilter(url));return ok([])}
    }

    if(path==='/rest/v1/app_project_progress_updates'){
      const pid=projectFilter(url);
      if(method==='GET')return ok(state.progress.filter(x=>!pid||x.project_id===pid));
      if(method==='POST'){const row={...(body||{}),id:`qa-progress-${state.progress.length+1}`,created_at:now(),updated_at:now()};state.progress.unshift(row);return ok([row])}
    }

    if(path==='/rest/v1/app_project_milestones'){
      const pid=projectFilter(url);
      if(method==='GET')return ok(state.milestones.filter(x=>!pid||x.project_id===pid));
      if(method==='POST'){const row={...(body||{}),id:`qa-milestone-${state.milestones.length+1}`,created_at:now(),updated_at:now()};state.milestones.push(row);return ok([row])}
    }

    if(path==='/rest/v1/app_project_decisions'){
      const pid=projectFilter(url);
      if(method==='GET')return ok(state.decisions.filter(x=>!pid||x.project_id===pid));
      if(method==='POST'){const row={...(body||{}),id:`qa-decision-${state.decisions.length+1}`,created_at:now(),updated_at:now()};state.decisions.push(row);return ok([row])}
    }

    if(path==='/rest/v1/app_project_comments'){
      if(method==='GET')return ok(state.comments.filter(x=>!projectFilter(url)||x.project_id===projectFilter(url)));
      if(method==='POST'){const row={...(body||{}),id:`qa-comment-${state.comments.length+1}`,created_at:now()};state.comments.push(row);return ok([row])}
    }

    if(['/rest/v1/app_tasks','/rest/v1/app_events','/rest/v1/app_event_attendees','/rest/v1/app_meetings','/rest/v1/app_documents','/rest/v1/app_pages','/rest/v1/app_groups','/rest/v1/app_notifications','/rest/v1/app_suborganizations','/rest/v1/app_suborganization_updates','/rest/v1/app_suborganization_weekly_reports'].includes(path))return ok([]);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

async function signIn(page){
  await page.goto(loginEntry('http://127.0.0.1:8123/app/'));
  await expect(page.locator('#emailAuthToggle')).toBeVisible({timeout:10000});
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('qa@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
}

async function expectNoHorizontalOverflow(page){
  const overflow=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth}));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth+2);
}

async function expectControlReachable(page,modalSelector,controlSelector){
  const modal=page.locator(modalSelector);
  await expect(modal).toBeVisible();
  const control=page.locator(controlSelector);
  await control.scrollIntoViewIfNeeded();
  const box=await control.boundingBox();
  expect(box).not.toBeNull();
  const viewport=page.viewportSize();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y+box.height).toBeLessThanOrEqual(viewport.height+2);
}

async function createQaProject(page,state){
  await page.locator('[data-view="projects"]').click();
  await page.locator('#newProjectBtn').click();
  await expect(page.locator('#pm2CreateModal')).toBeVisible();
  await page.locator('[data-pm2-type="campaign"]').click();
  await expect(page.locator('[data-pm2-type="campaign"] strong')).toHaveText('의제 사업');
  await page.locator('#pm2Name').fill('QA 자동검사 프로젝트');
  await page.locator('#pm2Objective').fill('프로젝트 UI와 연결 기능 전체 자동검사');
  await page.locator('#pm2Create').click();
  await expect.poll(()=>state.spaces.filter(x=>x.metadata?.project_system==='v2').length).toBe(1);
  await expect(page.locator('#pm2DetailModal')).toBeVisible({timeout:10000});
  return state.spaces.find(x=>x.metadata?.project_system==='v2');
}

test('mobile full project QA: create, scroll, input, linked modals and layout',async({page},testInfo)=>{
  test.setTimeout(90000);
  await page.setViewportSize({width:390,height:844});
  const state=initialState();
  const pageErrors=[];const failed=[];
  page.on('pageerror',e=>pageErrors.push(String(e)));
  page.on('requestfailed',r=>failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText||''}`));
  await mockApp(page,state);
  await signIn(page);
  const project=await createQaProject(page,state);

  await expect(page.locator('#pm2DetailKicker')).toContainText('의제 사업');
  await expect(page.locator('[data-pm2-nav]')).toContainText(['개요','진행 기록','주요 일정','할 일','자료','회의·결정','게시','프로젝트 관련 의견']);
  await expectNoHorizontalOverflow(page);

  const detailScroll=await page.locator('#pm2DetailModal').evaluate(el=>{el.scrollTop=el.scrollHeight;return {top:el.scrollTop,height:el.clientHeight,total:el.scrollHeight}});
  expect(detailScroll.total).toBeGreaterThan(detailScroll.height);
  expect(detailScroll.top).toBeGreaterThan(0);
  await page.locator('#pm2DetailModal').evaluate(el=>{el.scrollTop=0});

  await page.locator('[data-pm2-add-progress]').click();
  await expect(page.locator('#pm2ProgressModal')).toBeVisible();
  await expect(page.locator('#pm2ProgressModal h2')).toHaveText('진행 기록');
  await page.locator('#pm2ProgressSummary').fill('자동 QA 진행 기록');
  await page.locator('#pm2ProgressNext').fill('다음 자동 검사');
  await expectControlReachable(page,'#pm2ProgressModal','#pm2SaveProgress');
  await page.locator('#pm2SaveProgress').click();
  await expect.poll(()=>state.progress.length).toBe(1);
  await expect(page.locator('#pm2-mod-progress')).toContainText('자동 QA 진행 기록');

  await page.locator('[data-pm2-add-milestone]').click();
  await expect(page.locator('#pm2MilestoneModal h2')).toHaveText('주요 일정 추가');
  await page.locator('#pm2MilestoneTitle').fill('QA 주요 일정');
  await page.locator('#pm2MilestoneAt').fill('2026-09-14T11:00');
  await page.locator('#pm2MilestoneNotes').fill('주요 일정 입력 및 저장 검사');
  await expectControlReachable(page,'#pm2MilestoneModal','#pm2SaveMilestone');
  await page.locator('#pm2SaveMilestone').click();
  await expect.poll(()=>state.milestones.length).toBe(1);
  await expect(page.locator('#pm2-mod-milestones')).toContainText('QA 주요 일정');

  await page.locator('[data-pm2-add-decision]').click();
  await page.locator('#pm2DecisionTitle').fill('QA 결정사항');
  await page.locator('#pm2DecisionBody').fill('자동 검사로 기록한 결정사항');
  await expectControlReachable(page,'#pm2DecisionModal','#pm2SaveDecision');
  await page.locator('#pm2SaveDecision').click();
  await expect.poll(()=>state.decisions.length).toBe(1);
  await expect(page.locator('#pm2-mod-decisions')).toContainText('QA 결정사항');

  const linked=[
    ['task','#taskModal','#taskProject','[data-close="taskModal"]'],
    ['document','#documentModal','#docProject','[data-close="documentModal"]'],
    ['meeting','#meetingModal','#meetingProject','[data-close="meetingModal"]'],
    ['page','#editorModal','#pageSpace','[data-close="editorModal"]']
  ];
  for(const [kind,modal,select,close] of linked){
    await page.locator(`[data-pm2-global="${kind}"]`).click();
    await expect(page.locator(modal)).toBeVisible({timeout:5000});
    await expect.poll(async()=>page.locator(select).inputValue()).toBe(project.id);
    const layers=await page.evaluate(([m])=>({front:Number(getComputedStyle(document.querySelector(m)).zIndex||0),detail:Number(getComputedStyle(document.querySelector('#pm2DetailModal')).zIndex||0)}),[modal]);
    expect(layers.front).toBeGreaterThan(layers.detail);
    await page.locator(close).first().click();
    await expect(page.locator(modal)).toBeHidden();
    await expect(page.locator('#pm2DetailModal')).toBeVisible();
  }

  await page.locator('#pm2CommentBody').fill('QA 프로젝트 관련 의견');
  await page.locator('[data-pm2-comment]').click();
  await expect.poll(()=>state.comments.length).toBe(1);
  await expect(page.locator('#pm2-mod-collaboration')).toContainText('QA 프로젝트 관련 의견');

  await testInfo.attach('mobile-project-detail',{body:await page.screenshot({fullPage:false}),contentType:'image/png'});
  expect(pageErrors).toEqual([]);
  expect(failed).toEqual([]);
});

test('core navigation and creation modals stay usable on desktop',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});
  const state=initialState();
  await mockApp(page,state);
  await signIn(page);

  for(const view of ['home','calendar','tasks','projects','library','meetings','pages']){
    await page.locator(`[data-view="${view}"]`).click();
    await expect(page.locator(`[data-view="${view}"]`)).toHaveClass(/active/);
    await expectNoHorizontalOverflow(page);
  }
  await page.locator('#teamManageTop').click();
  await expect(page.locator('#teamView')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const buttons=[
    ['#newEventBtn','#eventModal','[data-close="eventModal"]'],
    ['#newTaskBtn','#taskModal','[data-close="taskModal"]'],
    ['#newDocumentBtn','#documentModal','[data-close="documentModal"]'],
    ['#newMeetingBtn','#meetingModal','[data-close="meetingModal"]'],
    ['#newPageBtn','#editorModal','[data-close="editorModal"]']
  ];
  for(const [button,modal,close] of buttons){
    const b=page.locator(button);
    if(await b.isVisible()){
      await b.click();
      await expect(page.locator(modal)).toBeVisible();
      await page.locator(close).first().click();
      await expect(page.locator(modal)).toBeHidden();
    }
  }
});
