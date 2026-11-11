// REC-한회의로잇기 6번 확인(S57-22, 설계 docs/design/rec-join.md 2절)과 PR-0 '초안 지키기'(S59-6, 2-3절).
// S57-22가 적어 둔 '고치기 전 동작'(저장 안 한 초안이 묻지 않고 사라짐)을 PR-0의 새 동작으로 바꾼 시험이다(지우거나 건너뛰지 않음):
// ① 저장 안 한 초안 창을 닫을 때 묻고, 닫은 초안은 띠 [초안 열기]로 다시 연다. '열었음'(job_opened)은 저장할 때 그 보고 id와 함께만.
// ② 녹음 중 입력 창에 직접 쓰던 글이 있으면 정리 결과가 창을 비우기 전에 묻는다(두면 쓰던 글 그대로 · 결과는 띠에).
// ③ 녹음 결과 창에 다른 녹음 결과가 오면 묻고, 새로 열기를 고르면 앞 결과는 '버림'으로 '열었음'(보고 id 없이).
// ④ 폰: 뒤로가기로 닫을 때도 묻고, 두기로 하면 창과 뒤로가기 칸이 그대로다.
// 실제 마이크·운영 서버는 쓰지 않는다: 가짜 MediaRecorder·getUserMedia(addInitScript)와 가짜 Supabase(page.route). 글은 모두 가짜다.
import {test,expect} from '@playwright/test';
import {signInWithSession} from './helpers/session-login.mjs';
import {appOrigin} from './helpers/test-origin.mjs';
import {answerAsk} from './helpers/small-notice.mjs';

test.use({timezoneId:'Asia/Seoul'});

const BASE=appOrigin;
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const SESSION=n=>`00000000-0000-4000-8000-0000000000a${n}`;
const JOB=n=>`00000000-0000-4000-8000-0000000000b${n}`;
const WORD=['','첫','둘째'];
const MEETING='00000000-0000-4000-8000-0000000000c1';

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

// 가짜 서버: 녹음마다 다른 session → 다른 서버 정리 작업 → 다른 결과 글(첫·둘째). 보고를 쓰는 요청(app_meetings POST·PATCH·DELETE)은 세고,
// POST(저장)는 만든 보고 한 줄(가짜 id)을 돌려준다.
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
    if(path==='/rest/v1/app_meetings'){if(method==='POST'||method==='PATCH'||method==='DELETE')meetingPosts.push(method);return ok(method==='POST'?[{id:MEETING,workspace_id:'rec-ws',title:'가짜 회의',series_name:'가짜 회의',meeting_at:'2026-10-29T06:00:00Z',activity_kind:'meeting'}]:[])}
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

const askBox=page=>page.locator('.kptu-ask');
const opened=calls=>recCalls(calls,'job_opened').map(c=>c.body);

test('초안 지키기 ① 저장 안 한 초안 창은 닫기 전에 묻고, 닫은 초안은 띠 [초안 열기]로 다시 열며, \'열었음\'은 저장할 때 그 보고 id와 함께만 보낸다',async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width:1440,height:900});
  const calls=await signIn(page);
  const modal=page.locator('#meetingModal'),notes=page.locator('#meetingNotes'),result=page.locator('#meetingTranscript');

  // 첫 녹음 → [멈추고 정리] → 첫 초안이 채워진 입력 창. 창을 열기만 했을 때는 '열었음'을 보내지 않는다.
  let band=await startRecording(page,calls);
  await band.getByRole('button',{name:'멈추고 정리'}).click();
  await expect(modal).toBeVisible({timeout:20000});
  await expect(notes).toHaveValue(/가짜 첫 녹음 전문/);
  await expect(result).toHaveValue(/가짜 첫 결정/);
  await expect(page.locator('#mtdStatus')).toContainText('초안을 채웠어요');
  expect(opened(calls)).toEqual([]);

  // [×] → 묻는다 → [계속 쓰기]: 창·글 그대로.
  await page.locator('#meetingModal [data-close="meetingModal"]').click();
  await expect(askBox(page).locator('.kptu-ask-text')).toHaveText('쓰던 사업 보고를 저장하지 않고 닫을까요?');
  await expect(askBox(page).locator('.kptu-ask-note')).toHaveText('녹음 정리 결과는 맨 위 [초안 열기]로 다시 열 수 있어요.');
  await askBox(page).getByRole('button',{name:'계속 쓰기'}).click();
  await expect(askBox(page)).toHaveCount(0);
  await expect(modal).toBeVisible();
  await expect(notes).toHaveValue(/가짜 첫 녹음 전문/);

  // Esc도 같은 물음 → [닫기]: 창이 닫히고, 첫 결과는 띠 '정리 끝 · [초안 열기]'로 돌아온다. 여전히 '열었음' 없음.
  await result.focus();
  await page.keyboard.press('Escape');
  await expect(askBox(page).locator('.kptu-ask-text')).toHaveText('쓰던 사업 보고를 저장하지 않고 닫을까요?');
  await askBox(page).getByRole('button',{name:'닫기'}).click();
  await expect(modal).toBeHidden();
  await expect(band.locator('.rec-label')).toHaveText('정리 끝');
  await expect(band.getByRole('button',{name:'초안 열기'})).toBeVisible();
  expect(opened(calls)).toEqual([]);

  // [초안 열기] → 닫았던 첫 초안이 다시 열린다(서버 결과를 다시 읽음).
  await band.getByRole('button',{name:'초안 열기'}).click();
  await expect(modal).toBeVisible({timeout:20000});
  await expect(notes).toHaveValue(/가짜 첫 녹음 전문/);
  await expect(result).toHaveValue(/가짜 첫 결정/);
  expect(opened(calls)).toEqual([]);

  // 저장하면 그때 '열었음' + 저장한 보고 id. 저장 뒤 닫힌 창은 묻지 않는다.
  const select=page.locator('#meetingNameSelect');
  if(await select.isVisible())await select.selectOption('__other__');
  await page.locator('#meetingTitle').fill('가짜 회의');
  await page.locator('#saveMeetingBtn').click();
  await expect(modal).toBeHidden();
  await expect.poll(()=>opened(calls)).toEqual([{job_id:JOB(1),meeting_id:MEETING}]);
  expect(calls.meetingPosts).toEqual(['POST']);
  await expect(askBox(page)).toHaveCount(0);

  // 둘째 녹음 → 새 창에는 둘째 결과만(앞 초안은 저장된 보고에 있다).
  await expect(band).toBeHidden({timeout:15000});
  await expect(page.locator('#reportRecordBtn')).toBeEnabled();
  band=await startRecording(page,calls);
  await band.getByRole('button',{name:'멈추고 정리'}).click();
  await expect(modal).toBeVisible({timeout:20000});
  await expect(notes).toHaveValue(/가짜 둘째 녹음 전문/);
  await expect(result).toHaveValue(/가짜 둘째 결정/);
  expect(await notes.inputValue()).not.toContain('가짜 첫');
  expect(recCalls(calls,'job_start').map(c=>c.body.session_id)).toEqual([SESSION(1),SESSION(2)]);
  expect(opened(calls)).toEqual([{job_id:JOB(1),meeting_id:MEETING}]);
});

test('초안 지키기 ② 녹음 중 입력 창에 직접 쓰던 글이 있으면 정리 결과가 비우기 전에 묻고, 두면 쓰던 글 그대로·결과는 띠 [초안 열기]에 남는다',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:1440,height:900});
  const calls=await signIn(page);
  const modal=page.locator('#meetingModal'),result=page.locator('#meetingTranscript');

  const band=await startRecording(page,calls);
  // 녹음 중에 사업 보고 입력 창을 열어([회의] 칸, 다른 화면이 쓰는 같은 길) 직접 쓴다.
  await page.evaluate(()=>window.KPTUReportEntry.open({kind:'meeting'}));
  await expect(modal).toBeVisible();
  await result.fill('가짜 직접 쓴 메모');
  // 녹음 띠는 입력 창 위에 떠 있어 창을 연 채 누를 수 있다. 결과가 오면 비우기 전에 묻는다.
  await band.getByRole('button',{name:'멈추고 정리'}).click();
  await expect(askBox(page).locator('.kptu-ask-text')).toHaveText('쓰던 사업 보고가 있어요. 저장하지 않고 새로 열까요?',{timeout:20000});
  await expect(askBox(page).locator('.kptu-ask-note')).toHaveText('두면 새 녹음 정리 결과는 맨 위 [초안 열기]에 남아요.');
  await askBox(page).getByRole('button',{name:'쓰던 창 두기'}).click();
  // 쓰던 창·글 그대로, 정리 결과는 띠 [초안 열기].
  await expect(band.getByRole('button',{name:'초안 열기'})).toBeVisible();
  await expect(modal).toBeVisible();
  await expect(result).toHaveValue('가짜 직접 쓴 메모');
  expect(await page.locator('#meetingNotes').inputValue()).not.toContain('가짜 첫');

  // 띠 [초안 열기] → 다시 묻는다 → [새로 열기]를 고르면 그때 쓰던 글 대신 정리 결과가 열린다.
  await band.getByRole('button',{name:'초안 열기'}).click();
  await expect(askBox(page).locator('.kptu-ask-text')).toHaveText('쓰던 사업 보고가 있어요. 저장하지 않고 새로 열까요?',{timeout:20000});
  await askBox(page).getByRole('button',{name:'새로 열기'}).click();
  await expect(result).toHaveValue(/가짜 첫 결정/,{timeout:20000});
  expect(await result.inputValue()).not.toContain('가짜 직접 쓴 메모');
  await expect(modal).toBeVisible();
  // 버린 것은 직접 쓴 글(녹음 결과 아님)이라 '열었음'은 없다. 저장 요청도 없다.
  expect(opened(calls)).toEqual([]);
  expect(calls.meetingPosts).toEqual([]);
});

test('초안 지키기 ③ 녹음 결과 창에 다른 녹음 결과가 오면 묻고, [새로 열기]를 고르면 앞 결과만 \'열었음\'(보고 id 없음)으로 보낸다',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:1440,height:900});
  const calls=await signIn(page);
  const modal=page.locator('#meetingModal'),notes=page.locator('#meetingNotes');

  const band=await startRecording(page,calls);
  await band.getByRole('button',{name:'멈추고 정리'}).click();
  await expect(notes).toHaveValue(/가짜 첫 녹음 전문/,{timeout:20000});
  // 다른 기기(폰 앱)에서 맡긴 둘째 정리를 같은 띠가 넘겨받는 길(phone-recorder.js → KPTUMeetingRecorder.watch).
  await page.evaluate(id=>window.KPTUMeetingRecorder.watch({id,kind:'recording',status:'queued',stage:'combine'}),JOB(2));
  await answerAsk(page,true);
  await expect(notes).toHaveValue(/가짜 둘째 녹음 전문/,{timeout:20000});
  expect(await notes.inputValue()).not.toContain('가짜 첫');
  await expect(modal).toBeVisible();
  await expect.poll(()=>opened(calls)).toEqual([{job_id:JOB(1)}]);
  expect(calls.meetingPosts).toEqual([]);
});

test('초안 지키기 ④ 폰: 뒤로가기로 닫을 때도 묻고, [계속 쓰기]면 창과 뒤로가기 칸이 그대로, [닫기]면 닫힌다',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:412,height:915});
  await signIn(page);
  const modal=page.locator('#meetingModal'),result=page.locator('#meetingTranscript');
  await page.evaluate(()=>window.KPTUReportEntry.open({kind:'meeting'}));
  await expect(modal).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay||'')).toBe('meetingModal');
  await result.fill('가짜 폰에서 쓴 메모');

  await page.goBack();
  await expect(askBox(page).locator('.kptu-ask-text')).toHaveText('쓰던 사업 보고를 저장하지 않고 닫을까요?');
  await askBox(page).getByRole('button',{name:'계속 쓰기'}).click();
  await expect(askBox(page)).toHaveCount(0);
  await expect(modal).toBeVisible();
  await expect(result).toHaveValue('가짜 폰에서 쓴 메모');
  await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay||'')).toBe('meetingModal');

  // 다시 뒤로가기 → [닫기]: 창이 닫히고 창의 뒤로가기 칸도 빠진다.
  await page.goBack();
  await answerAsk(page,true);
  await expect(modal).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>history.state?.kptuOverlay||'')).toBe('');
  await expect(page.locator('#meetingsView')).toBeVisible();

  // 쓴 글이 없으면 지금처럼 묻지 않고 닫는다.
  await page.evaluate(()=>window.KPTUReportEntry.open({kind:'meeting'}));
  await expect(modal).toBeVisible();
  await page.goBack();
  await expect(modal).toBeHidden();
  await expect(askBox(page)).toHaveCount(0);
});
