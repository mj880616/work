import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';

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
    if(path==='/functions/v1/meeting-ai-ingest')return ok({ok:true,materials_text:'[토론회 자료]\n현황과 대응 방향',warnings:[],stt_enabled:false});
    if(path==='/functions/v1/meeting-ai-draft'){
      const variant=String(body?.transcript_text||'').includes('변형 응답');
      const draft=variant
        ? {decisions:'- 변형 응답도 결정사항으로 보존한다.',actions:[{title:'변형 과제',owner:'일반 사용자',deadline:'2026-09-21'},'담당자 확인이 필요한 추가 과제'],info:'- 변형 키의 정보공유도 보존한다.'}
        : {decisions:'- 10월 대응안을 확정한다.',actions:[{task:'의원실에 최종안 전달',assignee:'일반 사용자',due:'2026-09-20'}],information:'- 정부 협의 경과를 공유했다.'};
      const row=state.meetings.find(x=>x.id===body?.meeting_id);if(row)Object.assign(row,{ai_draft:draft,transcript_text:body?.transcript_text,result_status:'draft',ai_generated_at:now(),updated_at:now()});
      return ok({ok:true,draft,warnings:variant?['응답 정규화 필요']:[]});
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
        state.meetingPosts=state.meetingPosts||[];
        state.meetingPosts.push(body);
        const row={...(body||{}),id:`meeting-${state.meetings.length+1}`,created_at:now(),updated_at:now(),followups:[],result_status:'final'};
        state.meetings.unshift(row);return ok([row]);
      }
      if(method==='PATCH'){
        state.meetingPatches=(state.meetingPatches||0)+1;
        const row=state.meetings.find(x=>x.id===idFrom());if(row)Object.assign(row,body||{});return ok(row?[row]:[]);
      }
      return ok(state.meetings);
    }
    if(path==='/rest/v1/app_tasks'){
      if(method==='POST'){
        const list=Array.isArray(body)?body:[body];
        const made=[];
        for(const item of list){const row={...(item||{}),id:`task-${state.tasks.length+1}`,created_at:now(),updated_at:now(),assignment_status:'accepted'};state.tasks.push(row);made.push(row)}
        return ok(made);
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
  await page.goto(loginEntry(page.url()));
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
  await expect(page.locator('#taskProject option[value="main-1"]')).toHaveCount(0);
  await expect(page.locator('#taskProject option[value="child-1"]')).toHaveCount(1);
  await expect(page.locator('#taskProject')).toContainText('10월 국회토론회');
  await page.locator('[data-close="taskModal"]').click();

  await page.locator('[data-view="meetings"]').click();
  await page.locator('#newMeetingBtn').click();
  await expect(page.locator('#wfMeetingLocation')).toBeVisible();
  await expect(page.locator('#wfMeetingAttendees')).toBeVisible();
  await expect(page.locator('#meetingSeriesName')).toBeVisible();
  await page.locator('#meetingTitle').fill('10월 토론회 준비회의');
  await page.locator('#meetingProject').selectOption('child-1');
  await page.locator('#meetingSeriesName').fill('궤도협의회 집행위원회');
  await page.locator('#meetingRoundNo').fill('8');
  await page.locator('#meetingNotes').fill('정부 협의 경과 공유');
  await page.locator('#meetingDecisions').fill('10월 대응안 확정');
  await page.locator('#wfMeetingLocation').fill('회의실');
  await page.locator('#wfMeetingAttendees').fill('6');
  const firstAction=page.locator('.meeting-action-row').first();
  await firstAction.locator('.meeting-action-title').fill('회의자료 최종 확인');
  await expect(firstAction.locator('.meeting-action-assignee')).toBeVisible();
  await firstAction.locator('.meeting-action-assignee').selectOption('user-1');
  await firstAction.locator('.meeting-action-due').fill('2026-09-19');
  await page.locator('#addMeetingAction').click();
  const secondAction=page.locator('.meeting-action-row').nth(1);
  await secondAction.locator('.meeting-action-title').fill('의원실 전달 준비');
  await expect(secondAction.locator('.meeting-action-assignee')).toBeVisible();
  await secondAction.locator('.meeting-action-assignee').selectOption('user-1');
  await secondAction.locator('.meeting-action-due').fill('2026-09-20');
  const saveOwner=await page.locator('#saveMeetingBtn').evaluate(el=>String(el.onclick||''));
  expect(saveOwner).toContain('wfMeetingLocation');
  expect(saveOwner).not.toContain('twSaveMeeting');
  await page.locator('#saveMeetingBtn').click();
  await expect.poll(()=>state.meetings.length).toBe(1);
  await expect.poll(()=>state.tasks.filter(x=>x.source_type==='meeting').length).toBe(2);
  expect(state.meetingPosts).toHaveLength(1);
  expect(state.meetings[0].location).toBe('회의실');
  expect(state.meetings[0].attendee_count).toBe(6);
  expect(state.meetings[0].series_name).toBe('궤도협의회 집행위원회');
  expect(state.meetings[0].round_no).toBe(8);
  expect(state.meetings[0].result_status).toBe('final');
  expect(state.meetings[0].finalized_at).toBeTruthy();
  expect(state.tasks.filter(x=>x.source_type==='meeting').map(x=>x.title)).toEqual(['회의자료 최종 확인','의원실 전달 준비']);
  await page.waitForTimeout(450);
  expect(state.meetingPatches||0).toBe(0);

  await page.locator('#meetingList article.item-card').first().click();
  await expect(page.locator('#meetingRoundDetailModal')).toBeVisible();
  await expect(page.locator('#mrdAiDraft')).toBeVisible({timeout:5000});
  await page.locator('#mrdAiDraft').click();
  await expect(page.locator('#wfMeetingAiModal')).toBeVisible();
  await expect(page.locator('#wfMeetingGenerate')).toHaveAttribute('data-ingest-backend','text-only');
  await expect(page.locator('#wfMeetingAiModal .notice')).toContainText('음성파일 자동전사(STT)는 비용 절감을 위해 사용하지 않습니다');
  await page.locator('#wfMeetingTranscript').fill('대응안을 확정했다. 일반 사용자가 9월 20일까지 의원실에 최종안을 전달한다. 정부 협의 경과를 공유했다.');
  await page.locator('#wfMeetingGenerate').click();
  await expect(page.locator('#wfMeetingDraft')).toBeVisible();
  await expect(page.locator('#wfDraftDecisions')).toHaveValue(/대응안을 확정/);
  await expect(page.locator('#wfDraftActions')).toHaveValue(/의원실에 최종안 전달/);
  expect(state.meetings[0].result_status).toBe('draft');

  await page.locator('#wfFinalizeMeeting').click();
  await expect.poll(()=>state.tasks.filter(x=>x.source_type==='meeting'&&x.title==='의원실에 최종안 전달').length).toBe(1);
  const aiTask=state.tasks.find(x=>x.source_type==='meeting'&&x.title==='의원실에 최종안 전달');
  expect(aiTask.project_id).toBe('child-1');
  expect(aiTask.title).toBe('의원실에 최종안 전달');
});


test('new meeting raw text is classified before the meeting is saved',async({page})=>{
  const state={
    user:{id:'user-1',email:'member@example.org',user_metadata:{display_name:'일반 사용자'}},
    workspace:{id:'workspace-1',slug:'team',name:'팀 Workspace'},
    spaces:[{id:'child-1',workspace_id:'workspace-1',name:'10월 국회토론회',description:'',parent_id:'main-1',status:'active',owner_id:'user-1',visibility:'team',metadata:{},sort_order:20}],
    meetings:[],tasks:[]
  };
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);
  await page.locator('[data-view="meetings"]').click();
  await page.locator('#newMeetingBtn').click();
  await page.locator('#meetingTitle').fill('원문 자동정리 테스트 회의');
  await page.locator('#meetingProject').selectOption('child-1');
  await page.locator('#meetingTranscript').fill('10월 대응안을 확정했다. 일반 사용자가 9월 20일까지 의원실에 최종안을 전달한다. 정부 협의 경과를 공유했다.');
  await page.locator('#meetingAutoClassify').click();
  await expect(page.locator('#meetingAutoClassifyStatus')).toContainText('자동 정리했습니다');
  await expect(page.locator('#meetingDecisions')).toHaveValue(/10월 대응안을 확정/);
  await expect(page.locator('#meetingNotes')).toHaveValue(/정부 협의 경과/);
  const action=page.locator('.meeting-action-row').first();
  await expect(action.locator('.meeting-action-title')).toHaveValue('의원실에 최종안 전달');
  await expect(action.locator('.meeting-action-assignee')).toHaveValue('user-1');
  await expect(action.locator('.meeting-action-due')).toHaveValue('2026-09-20');
  expect(state.meetings).toHaveLength(0);
  await page.locator('#saveMeetingBtn').click();
  await expect.poll(()=>state.meetings.length).toBe(1);
  expect(state.meetings[0].transcript_text).toContain('10월 대응안을 확정했다');
  expect(state.meetings[0].decisions).toContain('10월 대응안을 확정');
  expect(state.meetings[0].notes).toContain('정부 협의 경과');
  await expect.poll(()=>state.tasks.filter(x=>x.source_type==='meeting').length).toBe(1);
});


test('meeting AI draft keeps usable content when response keys vary',async({page})=>{
  const state={
    user:{id:'user-1',email:'member@example.org',user_metadata:{display_name:'일반 사용자'}},
    workspace:{id:'workspace-1',slug:'team',name:'팀 Workspace'},
    spaces:[{id:'child-1',workspace_id:'workspace-1',name:'세부 사업',description:'',parent_id:'main-1',status:'active',owner_id:'user-1',visibility:'team',metadata:{},sort_order:20}],
    meetings:[{id:'meeting-1',workspace_id:'workspace-1',project_id:'child-1',title:'변형 응답 테스트 회의',meeting_at:now(),created_by:'user-1',decisions:'',notes:'',followups:[],result_status:'final'}],
    tasks:[]
  };
  await mockApp(page,state);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);
  await page.locator('[data-view="meetings"]').click();
  await page.locator('#meetingList article.item-card').first().click();
  await page.locator('#mrdAiDraft').click();
  await expect(page.locator('#wfMeetingAiModal')).toBeVisible();
  await page.locator('#wfMeetingTranscript').fill('변형 응답 테스트용 회의록');
  await page.locator('#wfMeetingGenerate').click();
  await expect(page.locator('#wfMeetingDraft')).toBeVisible();
  await expect(page.locator('#wfDraftDecisions')).toHaveValue(/변형 응답도 결정사항/);
  await expect(page.locator('#wfDraftActions')).toHaveValue(/변형 과제 \| 일반 사용자 \| 2026-09-21/);
  await expect(page.locator('#wfDraftActions')).toHaveValue(/담당자 확인이 필요한 추가 과제 \| \[확인 필요\] \| \[확인 필요\]/);
  await expect(page.locator('#wfDraftInfo')).toHaveValue(/변형 키의 정보공유/);
  await expect(page.locator('#wfMeetingAiStatus')).toContainText('초안을 만들었습니다');
});
