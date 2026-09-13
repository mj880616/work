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
    if(path==='/functions/v1/meeting-ai-ingest')return ok({ok:true,transcript:'',materials_text:'[토론회 자료]\n현황과 대응 방향',warnings:[]});
    if(path==='/functions/v1/meeting-ai-draft'){
      const draft={decisions:'- 10월 대응안을 확정한다.',actions:[{task:'의원실에 최종안 전달',assignee:'일반 사용자',due:'2026-09-20'}],information:'- 정부 협의 경과를 공유했다.'};
      const row=state.meetings.find(x=>x.id===body?.meeting_id);if(row)Object.assign(row,{ai_draft:draft,transcript_text:body?.transcript_text,result_status:'draft',ai_generated_at:now(),updated_at:now()});
      return ok({ok:true,draft,warnings:[]});
    }
    if(path==='/functions/v1/team-ai')return ok({answer:JSON.stringify({decisions:'- 10월 대응안을 확정한다.',actions:[{task:'의원실에 최종안 전달',assignee:'일반 사용자',due:'2026-09-20'}],information:'- 정부 협의 경과를 공유했다.'})});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members'){
      if(url.searchParams.has('user_id')&&url.searchParams.get('limit')==='1')return ok([{workspace_id:state.workspace.id,user_id:state.user.id,role:'owner'}]);
      return ok([{workspace_id:state.workspace.id,user_id:state.user.id,role:'owner'}]);
    }
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'일반 사용자'}]);
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);
    if(path==='/rest/v1/app_spaces')return ok(state.spaces);
    if(path==='/rest/v1/app_space_members')return ok([]);
    if(path==='/rest/v1/app_meetings'){
      if(method==='POST'){
        const row={...(body||{}),id:`meeting-${state.meetings.length+1}`,created_at:now(),updated_at:now(),followups:[],result_status:'final'};
        state.meetings.unshift(row);return ok([row]);
      }
      if(method==='PATCH'){
        const row=state.meetings.find(x=>x.id===idFrom());if(row)Object.assign(row,body||{});return ok([]);
      }
      return ok(state.meetings);
    }
    if(path==='/rest/v1/app_tasks'){
      if(method==='POST'){
        const row={...(body||{}),id:`task-${state.tasks.length+1}`,created_at:now(),updated_at:now(),assignment_status:'accepted'};
        state.tasks.push(row);return ok([row]);
      }
      return ok(state.tasks);
    }
    if(path==='/rest/v1/app_documents')return ok([]);
    if(path==='/rest/v1/app_events')return ok([]);
    if(path==='/rest/v1/app_pages')return ok([]);
    if(path==='/rest/v1/app_project_sections')return ok([]);
    if(path==='/rest/v1/app_project_blocks')return ok([]);
    if(path==='/rest/v1/app_project_updates')return ok([]);
    if(path==='/rest/v1/app_project_checkitems')return ok([]);
    if(path==='/rest/v1/app_project_comments')return ok([]);
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

test('meeting AI draft is reviewed before finalization and project tasks only target child projects',async({page})=>{
  const state={
    user:{id:'user-1',email:'member@example.org',user_metadata:{display_name:'일반 사용자'}},
    workspace:{id:'workspace-1',slug:'team',name:'팀 Workspace'},
    spaces:[
      {id:'main-1',workspace_id:'workspace-1',name:'지방이전 대응',description:'연중 사업',parent_id:null,status:'active',owner_id:'user-1',visibility:'team',metadata:{},sort_order:10},
      {id:'child-1',workspace_id:'workspace-1',name:'10월 국회토론회',description:'세부 사업',parent_id:'main-1',status:'active',owner_id:'user-1',visibility:'team',metadata:{},sort_order:20}
    ],meetings:[],tasks:[]
  };
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);

  await page.locator('[data-view="tasks"]').click();
  await page.locator('#newTaskBtn').click();
  await expect(page.locator('#taskModal')).toBeVisible();
  await expect(page.locator('#taskProject option')).toHaveCount(2);
  await expect(page.locator('#taskProject')).not.toContainText('지방이전 대응');
  await expect(page.locator('#taskProject')).toContainText('10월 국회토론회');
  await page.locator('[data-close="taskModal"]').click();

  await page.locator('[data-view="meetings"]').click();
  await page.locator('#newMeetingBtn').click();
  await expect(page.locator('#wfMeetingLocation')).toBeVisible();
  await expect(page.locator('#wfMeetingAttendees')).toBeVisible();
  await page.locator('#meetingTitle').fill('10월 토론회 준비회의');
  await page.locator('#meetingProject').selectOption('child-1');
  await page.locator('#meetingNotes').fill('정부 협의 경과 공유');
  await page.locator('#meetingDecisions').fill('10월 대응안 확정');
  await page.locator('#wfMeetingLocation').fill('회의실');
  await page.locator('#wfMeetingAttendees').fill('6');
  await page.locator('#saveMeetingBtn').click();
  await expect.poll(()=>state.meetings.length).toBe(1);
  await page.waitForTimeout(700);
  expect(state.meetings[0].location).toBe('회의실');
  expect(state.meetings[0].attendee_count).toBe(6);

  await page.locator('#meetingList article.item-card').first().click();
  await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();
  await expect(page.locator('#wfMeetingAiBtn')).toBeVisible({timeout:5000});
  await page.locator('#wfMeetingAiBtn').click();
  await expect(page.locator('#wfMeetingAiModal')).toBeVisible();
  await expect(page.locator('#wfMeetingGenerate')).toHaveAttribute('data-ingest-backend','1');
  await page.locator('#wfMeetingTranscript').fill('대응안을 확정했다. 일반 사용자가 9월 20일까지 의원실에 최종안을 전달한다. 정부 협의 경과를 공유했다.');
  await page.locator('#wfMeetingGenerate').click();
  await expect(page.locator('#wfMeetingDraft')).toBeVisible();
  await expect(page.locator('#wfDraftDecisions')).toHaveValue(/대응안을 확정/);
  await expect(page.locator('#wfDraftActions')).toHaveValue(/의원실에 최종안 전달/);
  expect(state.meetings[0].result_status).toBe('draft');

  await page.locator('#wfFinalizeMeeting').click();
  await expect.poll(()=>state.tasks.length).toBe(1);
  expect(state.tasks[0].project_id).toBe('child-1');
  expect(state.tasks[0].source_type).toBe('meeting_ai');
  expect(state.tasks[0].title).toBe('의원실에 최종안 전달');
});

test('main project exposes the long-running project operating model',async({page})=>{
  const state={
    user:{id:'user-1',email:'member@example.org',user_metadata:{display_name:'일반 사용자'}},
    workspace:{id:'workspace-1',slug:'team',name:'팀 Workspace'},
    spaces:[{id:'main-1',workspace_id:'workspace-1',name:'통폐합 대응',description:'연중 사업',parent_id:null,status:'active',owner_id:'user-1',visibility:'team',metadata:{},sort_order:10}],meetings:[],tasks:[]
  };
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);
  await page.locator('[data-view="projects"]').click();
  await page.locator('[data-project="main-1"]').first().click();
  await expect(page.locator('#projectModal')).toBeVisible();
  await expect(page.locator('#pomTemplate')).toBeVisible({timeout:7000});
  await expect(page.locator('#pomAi')).toHaveText('AI로 사업현황 초안');
});
