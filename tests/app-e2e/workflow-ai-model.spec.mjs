import {clickView} from './helpers/shell-navigation.mjs';
import { test, expect } from '@playwright/test';
import { watchRetiredCollaboration } from './helpers/retired-collaboration.mjs';
watchRetiredCollaboration(test);
import { readFileSync, existsSync } from 'node:fs';
import { loginEntry } from './helpers/login-entry.mjs';
import {fillDateTime} from './helpers/date-time.mjs';
import { signInWithSession } from './helpers/session-login.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
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
    if(path==='/functions/v1/google-tasks'){
      if(url.searchParams.get('action')==='create'){state.googleCreates.push(body);return ok({ok:true,task:{id:'google-followup'}})}
      return ok({tasks:[],needs_reconnect:false});
    }
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    // MEET-파일AI분류: 새 사업 보고의 자료도 자료실 올리기와 같은 library-files 요청(meeting_id로 연결)으로 올라간다.
    if((path==='/functions/v1/library-files'||path==='/functions/v1/meeting-files')&&method==='POST'){state.fileUploads++;return ok({ok:true,document:{id:`00000000-0000-4000-8000-00000000000${state.fileUploads}`,meeting_id:'meeting-1'}})}
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
        state.appTaskWrites++;
        const list=Array.isArray(body)?body:[body],made=[];
        for(const item of list){const row={...(item||{}),id:`task-${state.tasks.length+1}`,created_at:now(),updated_at:now(),assignment_status:'accepted'};state.tasks.push(row);made.push(row)}
        return ok(made);
      }
      return ok(state.tasks);
    }
    if(path==='/rest/v1/app_documents')return ok([]);
    if(path==='/rest/v1/app_events'||path==='/rest/v1/app_groups'||path==='/rest/v1/app_notifications')return ok([]);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

async function signIn(page){
  await page.goto(loginEntry(`${BASE}/app/`));
  await signInWithSession(page,'member@example.org');
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
    meetings:[],tasks:[],googleCreates:[],appTaskWrites:0,fileUploads:0
  };
}

test('new meeting stores raw result exactly and creates linked Google follow-up without AI preprocessing',async({page})=>{
  const s=state();
  await mockApp(page,s);
  await signIn(page);
  await clickView(page,'meetings');
  await page.locator('#newMeetingBtn').click();
  await expect(page.locator('#meetingModal')).toBeVisible();

  await expect(page.locator('#meetingAutoClassify,#meetingDecisions,#wfMeetingLocation,#wfMeetingAttendees')).toHaveCount(0);
  await expect(page.locator('#meetingProject option[value="main-1"]')).toHaveCount(1);
  expect(await page.evaluate(()=>typeof window.__KPTU_OPEN_AI_FOR_MEETING__)).toBe('undefined');

  const raw='  첫 줄 원문\n둘째 줄 그대로\n마지막 줄  ';
  const special='특이사항 첫 줄\n특이사항 둘째 줄';
  await page.locator('#meetingTitle').fill('회의 단순화 검증');
  await fillDateTime(page,'#meetingAt','2026-09-24T11:00');
  await page.locator('#meetingPlaces').click();await page.locator('#reportPlacesSheet').getByRole('button',{name:/상위 프로젝트/}).first().click();await page.locator('#reportPlacesSheet').getByRole('button',{name:'저장',exact:true}).click();
  await page.locator('#meetingRoundNo').fill('9');
  await page.locator('#meetingTranscript').fill(raw);
  await page.locator('#meetingNotes').fill(special);
  // UI-회의결과창정리: 입력 한 줄에 쓰고 [추가] 없이 저장해도 그 줄의 할 일을 함께 만든다.
  await page.locator('#meetingActionTitle').fill('후속 자료 정리');
  await page.locator('#meetingActionDue').fill('2026-09-25');
  await page.locator('#meetingFiles').setInputFiles([
    {name:'자료1.txt',mimeType:'text/plain',buffer:Buffer.from('one')},
    {name:'자료2.txt',mimeType:'text/plain',buffer:Buffer.from('two')}
  ]);
  await page.locator('#saveMeetingBtn').click();

  await expect.poll(()=>s.meetings.length).toBe(1);
  await expect.poll(()=>s.googleCreates.length).toBe(1);
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
  expect(s.googleCreates[0]).toMatchObject({action:'create',title:'후속 자료 정리',due:'2026-09-25',notes:'',links:[{meeting_id:'meeting-1'},{project_id:'main-1'}]});
  expect(s.appTaskWrites).toBe(0);
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
  // UI-회의결과창정리: 창 설명은 "자료실에도 자동 등록"만 남기고, 100MB 제한은 고를 때·저장할 때 안내한다.
  expect(html).toContain('자료실에도 자동 등록');
  // MTG-사업보고말바꾸기: 새 사업 보고 창의 안내는 칸 글자(회의 칸 '회의자료', 다른 칸 '자료') + '는 파일당 100MB…'로 조립된다.
  expect(readFileSync('app/team.js','utf8')).toContain("+'는 파일당 100MB까지 첨부할 수 있습니다.'");
  expect(readFileSync('app/report-words.mjs','utf8')).toContain("materials:'회의자료'");
  // MEET-파일AI분류: 사업 보고 상세의 자료 올리기는 자료실 올리기 창이 맡으므로 100MB 안내·제한도 그 창의 것이다.
  expect(readFileSync('app/library-upload.js','utf8')).toContain('현재 자료실은 파일당 100MB까지 지원합니다.');
  expect(readFileSync('app/library-upload.js','utf8')).toContain('const LU_MAX_FILE_BYTES=100*1024*1024');
  expect(edge).toContain('file.size>100*1024*1024');
  expect(edge).toContain('파일당 100MB까지 지원합니다.');
});
