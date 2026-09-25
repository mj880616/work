import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { loginEntry } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const now=()=>new Date().toISOString();

async function mockApp(page,state){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const jsonBody=()=>{try{return req.postDataJSON()}catch{return null}};
    const body=jsonBody();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
    if(path==='/auth/v1/user')return ok(state.user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/google-tasks')return ok({tasks:[],needs_reconnect:false});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path==='/functions/v1/meeting-files'&&method==='POST'){state.fileUploads++;return ok({ok:true,document:{id:`doc-${state.fileUploads}`}})}
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members'){
      if(url.searchParams.has('user_id')&&url.searchParams.get('limit')==='1')return ok([{workspace_id:state.workspace.id,user_id:state.user.id,role:'owner',workspace:state.workspace}]);
      return ok([{workspace_id:state.workspace.id,user_id:state.user.id,role:'owner'}]);
    }
    if(path==='/rest/v1/app_profiles')return ok([{user_id:state.user.id,display_name:'일반 사용자'}]);
    if(path==='/rest/v1/app_workspaces')return ok([state.workspace]);
    if(path==='/rest/v1/app_spaces')return ok(state.spaces);
    if(path==='/rest/v1/app_meetings'){
      if(method==='POST'){
        const row={...(body||{}),id:`meeting-${state.meetings.length+1}`,created_at:now(),updated_at:now(),followups:[]};
        state.meetings.unshift(row);return ok([row]);
      }
      return ok(state.meetings);
    }
    if(path==='/rest/v1/app_tasks'){
      if(method==='POST'){
        const list=Array.isArray(body)?body:[body],made=[];
        for(const item of list){const row={...(item||{}),id:`task-${state.tasks.length+1}`,created_at:now(),updated_at:now(),assignment_status:'accepted'};state.tasks.push(row);made.push(row)}
        return ok(made);
      }
      return ok(state.tasks);
    }
    if(path==='/rest/v1/app_documents')return ok([]);
    if(path==='/rest/v1/app_events'||path==='/rest/v1/app_event_attendees'||path==='/rest/v1/app_groups'||path==='/rest/v1/app_notifications'||path==='/rest/v1/app_space_members')return ok([]);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

async function signIn(page){
  await page.goto(loginEntry('http://127.0.0.1:8123/app/'));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('member@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
}

function state(){
  return {
    user:{id:'user-1',email:'member@example.org',user_metadata:{display_name:'일반 사용자'}},
    workspace:{id:'workspace-1',slug:'team',name:'팀 Workspace'},
    spaces:[
      {id:'main-1',workspace_id:'workspace-1',name:'상위 프로젝트',parent_id:null,status:'active',owner_id:'user-1',metadata:{project_system:'v2'},sort_order:10},
      {id:'child-1',workspace_id:'workspace-1',name:'하위 프로젝트',parent_id:'main-1',status:'active',owner_id:'user-1',metadata:{project_system:'v2'},sort_order:20}
    ],
    meetings:[],tasks:[],fileUploads:0
  };
}

test('new meeting stores raw result exactly and creates linked follow-up tasks without AI preprocessing',async({page})=>{
  const s=state();
  await mockApp(page,s);
  await signIn(page);
  await page.locator('[data-view="meetings"]').click();
  await page.locator('#newMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeVisible();

  await expect(page.locator('#meetingAutoClassify,#meetingDecisions,#wfMeetingLocation,#wfMeetingAttendees')).toHaveCount(0);
  await expect(page.locator('#meetingProject option[value="main-1"]')).toHaveCount(1);
  expect(await page.evaluate(()=>typeof window.__KPTU_OPEN_AI_FOR_MEETING__)).toBe('undefined');

  const raw='  첫 줄 원문\n둘째 줄 그대로\n마지막 줄  ';
  const special='특이사항 첫 줄\n특이사항 둘째 줄';
  await page.locator('#meetingTitle').fill('회의 단순화 검증');
  await page.locator('#meetingAt').fill('2026-09-24T11:00');
  await page.locator('#meetingProject').selectOption('main-1');
  await page.locator('#meetingRoundNo').fill('9');
  await page.locator('#meetingTranscript').fill(raw);
  await page.locator('#meetingNotes').fill(special);
  const action=page.locator('.meeting-action-row').first();
  await action.locator('.meeting-action-title').fill('후속 자료 정리');
  await action.locator('.meeting-action-due').fill('2026-09-25');
  await page.locator('#meetingFiles').setInputFiles([
    {name:'자료1.txt',mimeType:'text/plain',buffer:Buffer.from('one')},
    {name:'자료2.txt',mimeType:'text/plain',buffer:Buffer.from('two')}
  ]);
  await page.locator('#saveMeetingBtn').click();

  await expect.poll(()=>s.meetings.length).toBe(1);
  await expect.poll(()=>s.tasks.length).toBe(1);
  await expect.poll(()=>s.fileUploads).toBe(2);
  expect(s.meetings[0].transcript_text).toBe(raw);
  expect(s.meetings[0].notes).toBe(special);
  expect(s.meetings[0].decisions).toBeUndefined();
  expect(s.meetings[0].location).toBeUndefined();
  expect(s.meetings[0].attendee_count).toBeUndefined();
  expect(s.meetings[0].project_id).toBe('main-1');
  expect(s.meetings[0].title).toBe('회의 단순화 검증');
  expect(s.meetings[0].series_name).toBe('회의 단순화 검증');
  expect(s.meetings[0].round_no).toBe(9);
  expect(s.tasks[0]).toMatchObject({title:'후속 자료 정리',project_id:'main-1',assignee_id:'user-1',source_type:'meeting',source_id:'meeting-1'});
});

test('meeting AI frontend execution path is retired while legacy AI implementation and backend functions stay in the repository',async()=>{
  const loader=readFileSync('app/loader-v2.js','utf8');
  const html=readFileSync('app/index.html','utf8');
  const detail=readFileSync('app/meeting-round-detail.js','utf8');
  expect(loader).not.toContain('workflow-ai-v3.js');
  expect(html).not.toContain('meetingAutoClassify');
  expect(html).not.toContain('meetingDecisions');
  expect(detail).not.toContain('mrdAiDraft');
  expect(existsSync('app/workflow-ai-v3.js')).toBe(true);
  expect(existsSync('supabase/functions/meeting-ai-draft/index.ts')).toBe(true);
  expect(existsSync('supabase/functions/meeting-ai-ingest/index.ts')).toBe(true);
});

test('meeting materials keep multiple upload and the existing 100MB per-file server limit',async()=>{
  const html=readFileSync('app/index.html','utf8');
  const edge=readFileSync('supabase/functions/meeting-files/index.ts','utf8');
  expect(html).toContain('id="meetingFiles" type="file" multiple');
  expect(html).toContain('파일당 최대 100MB');
  expect(edge).toContain('file.size>100*1024*1024');
  expect(edge).toContain('파일당 100MB까지 지원합니다.');
});
