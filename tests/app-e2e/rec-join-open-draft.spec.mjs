// REC-한회의로잇기 6번 확인(S57-22, 설계 docs/design/rec-join.md 2절): 저장하지 않은 회의 초안이 다음 녹음 정리로 사라지는지.
// 이 파일은 고치기 전의 '지금 동작'을 사실로 적어 둔 시험이다. 막는 물음(열려 있는 초안이 있으면 먼저 묻기)을 넣는 PR에서
// 아래 기대를 새 동작으로 바꾼다(지우거나 건너뛰지 않는다).
// 실제 마이크·운영 서버는 쓰지 않는다: 가짜 MediaRecorder·getUserMedia(addInitScript)와 가짜 Supabase(page.route). 글은 모두 가짜다.
import {test,expect} from '@playwright/test';
import {signInWithSession} from './helpers/session-login.mjs';
import {appOrigin} from './helpers/test-origin.mjs';

test.use({timezoneId:'Asia/Seoul'});

const BASE=appOrigin;
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const SESSION=n=>`00000000-0000-4000-8000-0000000000a${n}`;
const JOB=n=>`00000000-0000-4000-8000-0000000000b${n}`;
const WORD=['','첫','둘째'];

// 가짜 녹음기(laptop-recording.spec.mjs와 같은 방식): 시험이 __fakeRec.emit()으로 조각을 내고, stop()은 마지막 조각 → stop.
async function fakeRecorder(page){
  await page.addInitScript(()=>{
    const recs=[];
    class FakeRecorder extends EventTarget{
      constructor(stream,opts={}){super();this.stream=stream;this.mimeType=opts.mimeType||'';this.state='inactive';this.n=0;recs.push(this)}
      static isTypeSupported(t){return String(t).startsWith('audio/webm')}
      start(timeslice){this.state='recording';this.timeslice=timeslice}
      pause(){this.state='paused'}
      resume(){this.state='recording'}
      requestData(){this.chunk()}
      chunk(){const e=new Event('dataavailable');e.data=new Blob([`piece-${++this.n}-`.repeat(40)],{type:'audio/webm'});this.dispatchEvent(e)}
      stop(){if(this.state==='inactive')return;this.state='inactive';setTimeout(()=>{this.chunk();this.dispatchEvent(new Event('stop'))},0)}
    }
    window.MediaRecorder=FakeRecorder;
    const track={stopped:false,stop(){this.stopped=true}};
    window.__fakeRec={recs,emit(){recs.at(-1)?.chunk()}};
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[track]})}});
  });
}

// 가짜 서버: 녹음마다 다른 session → 다른 서버 정리 작업 → 다른 결과 글(첫·둘째). 보고를 쓰는 요청(app_meetings POST·PATCH·DELETE)은 세기만 한다.
async function mock(page){
  const calls=[],meetingPosts=calls.meetingPosts=[];
  let recordings=0;
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'rec-access',refresh_token:'rec-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'rec-user'}});
    if(path==='/auth/v1/user')return ok({id:'rec-user',email:'rec@example.org',user_metadata:{display_name:'녹음 QA'}});
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'rec-ws',user_id:'rec-user',role:'owner',email:'rec@example.org',workspace:{id:'rec-ws',name:'QA Workspace'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'rec-ws',name:'QA Workspace'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:'rec-user',display_name:'녹음 QA'}]);
    if(path==='/rest/v1/app_meetings'){if(method==='POST'||method==='PATCH'||method==='DELETE')meetingPosts.push(method);return ok([])}
    if(path==='/functions/v1/meeting-transcribe'){
      const action=url.searchParams.get('action');
      const body=action==='rec_piece'?null:(()=>{try{return JSON.parse(req.postData()||'{}')}catch{return {}}})();
      calls.push({action,body});
      if(action==='rec_pending')return ok({ok:true,sessions:[],live:[]});
      if(action==='rec_start'){const n=body.session_id?recordings:++recordings;return ok({ok:true,recording_id:`00000000-0000-4000-8000-00000000000${n}`,session_id:body.session_id||SESSION(n),segment_no:1,piece_seconds:300,segment_seconds:3540})}
      if(action==='rec_piece')return ok({ok:true,pieces:1});
      if(action==='config')return ok({ok:true,ready:true});
      if(action==='job_list')return ok({ok:true,jobs:[]});
      if(action==='job_start'){const n=body.session_id===SESSION(2)?2:1;return ok({ok:true,job:{id:JOB(n),kind:'recording',status:'queued',stage:'combine',session_id:body.session_id,parts_done:0,parts_total:0,step_no:0,step_total:0,jobs:[]}})}
      if(action==='job_read'){const n=body.job_id===JOB(2)?2:1,w=WORD[n];return ok({ok:true,job:{id:JOB(n),kind:'recording',status:'done',stage:'done',session_id:SESSION(n),
        created_at:'2026-10-29T06:10:00Z',seconds:600,jobs:[`00000000-0000-4000-8000-0000000000j${n}`],parts_done:1,parts_total:1,step_no:1,step_total:1,
        transcript_text:`가짜 ${w} 녹음 전문입니다.`,
        draft:{decisions:`가짜 ${w} 결정`,information:`가짜 ${w} 공유`,actions:[],meeting_date:'',attendees:[]}}})}
      return ok({ok:true});
    }
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path==='/functions/v1/google-tasks')return ok({tasks:[],needs_reconnect:false});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/')||path.startsWith('/functions/v1/'))return ok([]);
    return ok({});
  });
  return calls;
}

async function signIn(page){
  await fakeRecorder(page);
  const calls=await mock(page);
  const returnTo=`${BASE}/app/?view=meetings`;
  await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(returnTo)}`);
  await signInWithSession(page,'rec@example.org');
  await expect(page.locator('#meetingsView')).toBeVisible({timeout:10000});
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  return calls;
}
const recCalls=(calls,action)=>calls.filter(c=>c.action===action);

// [녹음] → 조각 하나 → 띠가 '녹음 중'일 때까지.
async function startRecording(page,calls){
  const band=page.locator('#recBand'),before=recCalls(calls,'rec_piece').length;
  await page.locator('#reportRecordBtn').click();
  await expect(band.locator('.rec-label')).toHaveText('녹음 중');
  await page.evaluate(()=>window.__fakeRec.emit());
  await expect.poll(()=>recCalls(calls,'rec_piece').length).toBe(before+1);
  return band;
}

test('지금 동작(고치기 전) ① 저장 안 한 첫 초안 창은 묻지 않고 닫히고, 둘째 녹음 정리가 연 창에는 첫 초안 글이 없다',async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width:1440,height:900});
  const calls=await signIn(page);
  const modal=page.locator('#meetingModal'),notes=page.locator('#meetingNotes'),result=page.locator('#meetingTranscript');

  // 첫 녹음 → [멈추고 정리] → 첫 초안이 채워진 입력 창.
  let band=await startRecording(page,calls);
  await band.getByRole('button',{name:'멈추고 정리'}).click();
  await expect(modal).toBeVisible({timeout:20000});
  await expect(notes).toHaveValue(/가짜 첫 녹음 전문/);
  await expect(result).toHaveValue(/가짜 첫 결정/);

  // 저장하지 않고 [닫기]: 묻는 창 없이 바로 닫힌다. 화면은 창을 열 때 이미 첫 결과를 서버에 '열었음'으로 알렸다
  // (서버는 '열었음'인 결과를 다시 주지 않는다 — 그 거르기는 서버 쪽이라 이 가짜 서버로는 보지 않는다). 띠가 닫힐 때까지 기다린다.
  await page.locator('#meetingModal [data-close="meetingModal"]').click();
  await expect(modal).toBeHidden();
  await expect.poll(()=>recCalls(calls,'job_opened').map(c=>c.body.job_id)).toEqual([JOB(1)]);
  await expect(band).toBeHidden({timeout:15000});
  await expect(page.locator('#reportRecordBtn')).toBeEnabled();

  // 둘째 녹음 → [멈추고 정리] → 다시 열린 입력 창에는 둘째 결과만 있다.
  band=await startRecording(page,calls);
  await band.getByRole('button',{name:'멈추고 정리'}).click();
  await expect(modal).toBeVisible({timeout:20000});
  await expect(notes).toHaveValue(/가짜 둘째 녹음 전문/);
  await expect(result).toHaveValue(/가짜 둘째 결정/);
  expect(await notes.inputValue()).not.toContain('가짜 첫');
  expect(await result.inputValue()).not.toContain('가짜 첫');
  expect(recCalls(calls,'job_start').map(c=>c.body.session_id)).toEqual([SESSION(1),SESSION(2)]);
  // 그 사이 어떤 보고도 저장되지 않았다(첫 초안은 화면 어디에도 남지 않음).
  expect(calls.meetingPosts).toEqual([]);
});

test('지금 동작(고치기 전) ② 입력 창을 열어 쓰던 글이 있어도 녹음 정리 결과가 묻지 않고 그 창을 비우고 채운다',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:1440,height:900});
  const calls=await signIn(page);
  const modal=page.locator('#meetingModal'),result=page.locator('#meetingTranscript');

  const band=await startRecording(page,calls);
  // 녹음 중에 사업 보고 입력 창을 열어([회의] 칸, 다른 화면이 쓰는 같은 길) 직접 쓴다.
  await page.evaluate(()=>window.KPTUReportEntry.open({kind:'meeting'}));
  await expect(modal).toBeVisible();
  await result.fill('가짜 직접 쓴 메모');
  // 녹음 띠는 입력 창 위에 떠 있어 창을 연 채 누를 수 있다.
  await band.getByRole('button',{name:'멈추고 정리'}).click();
  await expect(result).toHaveValue(/가짜 첫 결정/,{timeout:20000});
  expect(await result.inputValue()).not.toContain('가짜 직접 쓴 메모');
  await expect(modal).toBeVisible();
  expect(calls.meetingPosts).toEqual([]);
});
