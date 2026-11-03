// MTG-노트북녹음 2단계: 노트북 [녹음] → 녹음 띠 → [멈추고 정리] → 회의 입력 창 초안, '이어서 정리', 폰 폭에는 [녹음] 없음.
// 실제 마이크·운영 서버는 쓰지 않는다: 가짜 MediaRecorder·getUserMedia(addInitScript)와 가짜 Supabase(page.route).
import {test,expect} from '@playwright/test';
import {signInWithSession} from './helpers/session-login.mjs';
import {clickView} from './helpers/shell-navigation.mjs';

test.use({timezoneId:'Asia/Seoul'});

const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';

// 가짜 녹음기: timeslice는 기록만 하고(조각 간격 확인) 시험이 __fakeRec.emit()으로 조각을 낸다. stop()은 마지막 조각 → stop.
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
    window.__fakeRec={recs,track,emit(){recs.at(-1)?.chunk()},state(){return recs.at(-1)?.state||''},slices(){return recs.map(r=>r.timeslice)}};
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[track]})}});
  });
}

async function mock(page,{pending=[],live=[],pieceFails=1,rec=null,server=false}={}){
  const calls=[],meetingPosts=calls.meetingPosts=[];
  let pendingServed=false;
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'rec-access',refresh_token:'rec-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'rec-user'}});
    if(path==='/auth/v1/user')return ok({id:'rec-user',email:'rec@example.org',user_metadata:{display_name:'녹음 QA'}});
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'rec-ws',user_id:'rec-user',role:'owner',email:'rec@example.org',workspace:{id:'rec-ws',name:'QA Workspace'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'rec-ws',name:'QA Workspace'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:'rec-user',display_name:'녹음 QA'}]);
    if(path==='/rest/v1/app_meetings'){if(method==='POST'){try{const b=JSON.parse(req.postData()||'{}');meetingPosts.push(Array.isArray(b)?b[0]:b)}catch{}return ok([{id:'meeting-new',workspace_id:'rec-ws',title:'운영위',series_name:'운영위',meeting_at:'2026-10-29T05:30:00Z',activity_kind:'meeting'}])}return ok([])}
    if(path==='/functions/v1/meeting-transcribe'){
      const action=url.searchParams.get('action');
      const headers=req.headers();
      const body=action==='rec_piece'?null:(()=>{try{return JSON.parse(req.postData()||'{}')}catch{return {}}})();
      calls.push({action,body,seq:headers['x-piece-seq']||'',rid:headers['x-recording-id']||'',type:headers['content-type']||''});
      if(action==='rec_pending'){const sessions=typeof pending==='function'?pending(calls):pendingServed?[]:pending;pendingServed=true;return ok({ok:true,sessions,live:typeof live==='function'?live(calls):live})}
      if(action==='rec_discard')return ok({ok:true,session_id:body.session_id,discarded:1,trashed:true});
      if(action==='rec_restore')return ok({ok:true,session_id:body.session_id,restored:1});
      if(action==='rec_start'){
        if(rec){const n=recCalls(calls,'rec_start').length;return ok({ok:true,recording_id:`00000000-0000-4000-8000-00000000000${n}`,session_id:'00000000-0000-4000-8000-0000000000aa',segment_no:n,...rec})}
        return ok({ok:true,recording_id:'00000000-0000-4000-8000-000000000001',session_id:'00000000-0000-4000-8000-0000000000aa',segment_no:1,piece_seconds:300,segment_seconds:3540});
      }
      if(action==='rec_piece'){
        if(pieceFails>0){pieceFails--;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'잠시 뒤 다시'})})}
        return ok({ok:true,pieces:Number(headers['x-piece-seq'])});
      }
      if(action==='rec_finish')return ok({ok:true,more:false,session_id:body.session_id,segments:[{segment_no:1,status:'combined',error_code:null,job_id:'00000000-0000-4000-8000-0000000000j1',duration_sec:600}]});
      if(action==='transcribe')return ok({ok:true,text:'김위원장: 다음 주 화요일 교섭 일정을 확정합니다.\n박간사: 자료는 금요일까지 돌립니다.'});
      if(action==='attach')return ok({ok:true});
      if(action==='config')return ok({ok:true,ready:true});
      // REC-서버정리(S49-2): server=true면 서버가 정리를 맡는다(job_start → job_read 끝). 아니면 옛 서버처럼 모르는 action에 {ok:true}만.
      if(server&&action==='job_start')return ok({ok:true,job:{id:'00000000-0000-4000-8000-0000000000b1',kind:'recording',status:'queued',stage:'combine',session_id:body.session_id,parts_done:0,parts_total:0,step_no:0,step_total:0,jobs:[]}});
      if(server&&action==='job_read')return ok({ok:true,job:{id:body.job_id,kind:'recording',status:'done',stage:'done',session_id:'00000000-0000-4000-8000-0000000000aa',
        created_at:'2026-10-29T06:10:00Z',seconds:600,jobs:['00000000-0000-4000-8000-0000000000j1'],parts_done:1,parts_total:1,step_no:1,step_total:1,
        transcript_text:'김위원장: 서버가 정리한 전사 전문입니다.\n박간사: 자료는 금요일까지 돌립니다.',
        draft:{decisions:'서버 요약 결정',information:'서버 요약 공유',actions:[{task:'자료 돌리기',assignee:'박간사',due:'2026-11-06'}],meeting_date:'',attendees:['김위원장']}}});
      if(server&&action==='job_list')return ok({ok:true,jobs:[]});
      return ok({ok:true});
    }
    if(path==='/functions/v1/meeting-ai-draft'){calls.push({action:'draft',body:JSON.parse(req.postData()||'{}')});return ok({draft:{decisions:'다음 주 화요일 교섭 일정 확정',information:'자료는 금요일까지 공유',actions:[],attendees:['김위원장','박간사']}})}
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path==='/functions/v1/google-tasks')return ok({tasks:[],needs_reconnect:false});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/')||path.startsWith('/functions/v1/'))return ok([]);
    return ok({});
  });
  return calls;
}

async function signIn(page,opts){
  await fakeRecorder(page);
  const calls=await mock(page,opts);
  const returnTo=`${BASE}/app/?view=meetings`;
  await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(returnTo)}`);
  await signInWithSession(page,'rec@example.org');
  await expect(page.locator('#meetingsView')).toBeVisible({timeout:10000});
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  return calls;
}
const recCalls=(calls,action)=>calls.filter(c=>c.action===action);

test('PC: [녹음] → 메뉴를 옮겨도 녹음 띠 유지 → 실패 조각 같은 번호로 재시도 → [멈추고 정리] → 초안이 채워진 회의 창 → 저장 뒤 녹음 붙이기',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:1440,height:900});
  const calls=await signIn(page);
  const rec=page.locator('#reportRecordBtn'),add=page.locator('#newMeetingBtn'),more=page.locator('#reportMore');
  await expect(rec).toBeVisible();
  await expect(rec).toHaveText('녹음');
  // 위쪽 줄 [녹음][+ 사업 보고][⋯]: 작고 낮은 버튼(32px), 같은 줄.
  const [r,a,m]=await Promise.all([rec.boundingBox(),add.boundingBox(),more.boundingBox()]);
  expect(r.height).toBeCloseTo(32,0);
  expect(r.x+r.width).toBeLessThanOrEqual(a.x);
  expect(a.x+a.width).toBeLessThanOrEqual(m.x);
  expect(Math.abs((r.y+r.height/2)-(a.y+a.height/2))).toBeLessThanOrEqual(1);
  await expect.poll(()=>recCalls(calls,'rec_pending').length).toBe(1);

  await rec.click();
  const band=page.locator('#recBand');
  await expect(band).toBeVisible();
  await expect(band.locator('.rec-label')).toHaveText('녹음 중');
  await expect(rec).toHaveText('녹음 중');
  await expect(rec).toBeDisabled();
  expect(recCalls(calls,'rec_start')[0].body).toEqual({workspace_id:'rec-ws',mime:'audio/webm'});
  // 옛 서버(piece_seconds 300)면 화면도 5분 조각으로 보낸다(화면이 먼저 배포돼도 옛 서버 조각 상한 16을 넘지 않음).
  expect(await page.evaluate(()=>window.__fakeRec.slices())).toEqual([300000]);
  const b=await band.boundingBox();
  expect(b.y).toBe(0);expect(b.height).toBeLessThanOrEqual(32);expect(b.width).toBeGreaterThan(1300);
  // 띠가 본문을 가리지 않는다(본문이 띠 높이만큼 내려감).
  expect((await page.locator('#appView>.app-topline').boundingBox()).y).toBeGreaterThanOrEqual(b.height);

  // 다른 메뉴로 옮겨도 녹음은 계속(띠는 앱 껍데기 한 곳).
  await clickView(page,'library');
  await expect(page.locator('#libraryView')).toBeVisible();
  await expect(band.locator('.rec-label')).toHaveText('녹음 중');
  expect(await page.evaluate(()=>window.__fakeRec.recs.length)).toBe(1);

  // 5분 조각: 첫 시도는 503 → 메모리에 두고 같은 번호(1)로 다시 보낸다.
  await page.evaluate(()=>window.__fakeRec.emit());
  await expect.poll(()=>recCalls(calls,'rec_piece').map(c=>c.seq),{timeout:15000}).toEqual(['1','1']);
  const piece=recCalls(calls,'rec_piece')[1];
  expect(piece.rid).toBe('00000000-0000-4000-8000-000000000001');
  expect(piece.type).toBe('audio/webm');

  // 일시정지 ⇄ 이어 녹음
  await band.getByRole('button',{name:'일시정지'}).click();
  await expect(band.locator('.rec-label')).toHaveText('일시정지');
  expect(await page.evaluate(()=>window.__fakeRec.state())).toBe('paused');
  await band.getByRole('button',{name:'이어 녹음'}).click();
  expect(await page.evaluate(()=>window.__fakeRec.state())).toBe('recording');

  await band.getByRole('button',{name:'멈추고 정리'}).click();
  // 마지막 조각(2) → 합치기 → 전사 → 요약 → 회의 입력 창
  await expect.poll(()=>recCalls(calls,'rec_piece').map(c=>c.seq)).toEqual(['1','1','2']);
  await expect.poll(()=>recCalls(calls,'rec_finish').length).toBe(1);
  expect(recCalls(calls,'rec_finish')[0].body).toEqual({session_id:'00000000-0000-4000-8000-0000000000aa'});
  await expect.poll(()=>recCalls(calls,'transcribe').map(c=>c.body.job_id)).toEqual(['00000000-0000-4000-8000-0000000000j1']);
  const modal=page.locator('#meetingModal');
  await expect(modal).toBeVisible({timeout:10000});
  await expect(page.locator('#meetingTranscript')).toHaveValue(/결정\n- 다음 주 화요일 교섭 일정 확정/);
  await expect(page.locator('#meetingTranscript')).toHaveValue(/참석: 김위원장, 박간사/);
  const draft=calls.find(c=>c.action==='draft');
  expect(draft.body.transcript_text).toContain('다음 주 화요일 교섭 일정');
  await expect(page.locator('#mtdStatus')).toContainText('초안을 채웠어요');
  // S48-64: 전사 전문은 '회의록 전문' 칸(notes)에 들어가 저장 때 함께 남는다. 요약 호출은 15초가 아닌 긴 기다림으로.
  await expect(page.locator('#meetingNotesLabel')).toHaveText('회의록 전문');
  await expect(page.locator('#meetingNotes')).toHaveValue(/다음 주 화요일 교섭 일정/);
  await expect(band.locator('.rec-note strong')).toHaveText('초안 열림');
  expect(await page.evaluate(()=>window.__fakeRec.track.stopped)).toBe(true);
  await expect(page.locator('#mtdAttach')).toBeChecked();

  // 저장 → 그 회의에 녹음 붙이기(구간마다)
  const select=page.locator('#meetingNameSelect');
  if(await select.isVisible())await select.selectOption('__other__');
  await page.locator('#meetingTitle').fill('운영위');
  await page.locator('#saveMeetingBtn').click();
  await expect.poll(()=>recCalls(calls,'attach').map(c=>c.body)).toEqual([{job_id:'00000000-0000-4000-8000-0000000000j1',meeting_id:'meeting-new'}]);
  await expect.poll(()=>calls.meetingPosts.at(-1)?.notes||'').toContain('다음 주 화요일 교섭 일정');
});

test('PC: 다시 열면 사업 보고 위 \'이어서 정리\' 한 줄 → 전사 → 초안 창',async({page})=>{
  test.setTimeout(45000);
  await page.setViewportSize({width:1440,height:900});
  const calls=await signIn(page,{pending:[{session_id:'00000000-0000-4000-8000-0000000000bb',started_at:'2026-10-29T05:30:00Z',duration_sec:1920,
    segments:[{segment_no:1,status:'recording',job_id:null,job_status:null,duration_sec:1920}]}]});
  const line=page.locator('#recPendingLine');
  await expect(line).toBeVisible();
  await expect(line).toContainText('끝나지 않은 녹음 · 10/29 14:30 녹음 · 32분');
  const btn=line.getByRole('button',{name:'이어서 정리'});
  expect((await btn.boundingBox()).height).toBeLessThanOrEqual(28);
  await btn.click();
  await expect(page.locator('#recBand')).toBeVisible();
  await expect.poll(()=>recCalls(calls,'rec_finish').map(c=>c.body.session_id)).toEqual(['00000000-0000-4000-8000-0000000000bb']);
  await expect(page.locator('#meetingModal')).toBeVisible({timeout:10000});
  await expect(page.locator('#meetingTranscript')).toHaveValue(/교섭 일정 확정/);
  // 일시는 녹음을 시작한 때(서울)
  await expect(page.locator('#meetingAt')).toHaveValue('2026-10-29T14:30');
  await expect(line).toBeHidden();
  expect(recCalls(calls,'rec_start').length).toBe(0);
});

// UI-폴드PC틀: 폴드 펼침(884)은 PC 틀이라 [녹음]이 있다. 없는 쪽은 폰(≤760)뿐.
for(const width of [412,760]){
  test(`폰 ${width}px: [녹음]과 '이어서 정리'가 없고 녹음 서버를 부르지 않는다`,async({page})=>{
    await page.setViewportSize({width,height:900});
    const calls=await signIn(page,{pending:[{session_id:'s',started_at:'2026-10-29T05:30:00Z',duration_sec:60,segments:[]}]});
    await expect(page.locator('#reportRecordBtn')).toBeHidden();
    await expect(page.locator('#recPendingLine')).toBeHidden();
    await expect(page.locator('#recBand')).toBeHidden();
    await page.waitForTimeout(500);
    expect(calls.filter(c=>c.action.startsWith('rec_')).length).toBe(0);
  });
}

// 요청함 10/30 11:15: 녹음 조각 1분(서버가 rec_start로 간격·구간 조각 한도를 알려 줌).
test('PC: 서버가 1분 조각을 알려 주면 1분 간격으로 보내고, 조각 한도에 닿으면 같은 녹음의 새 구간으로 넘어가 이어 보낸다',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:1440,height:900});
  const calls=await signIn(page,{pieceFails:0,rec:{piece_seconds:60,segment_seconds:3540,max_pieces:4}});
  await page.locator('#reportRecordBtn').click();
  const band=page.locator('#recBand');
  await expect(band.locator('.rec-label')).toHaveText('녹음 중');
  expect(await page.evaluate(()=>window.__fakeRec.slices())).toEqual([60000]);
  const pieces=()=>recCalls(calls,'rec_piece').map(c=>`${c.rid.slice(-1)}:${c.seq}`);
  // 1분마다 한 조각씩 바로 서버로(순서대로 1·2·3).
  for(let i=1;i<=3;i++){
    await page.evaluate(()=>window.__fakeRec.emit());
    await expect.poll(pieces,{timeout:10000}).toEqual(Array.from({length:i},(_,k)=>`1:${k+1}`));
  }
  // 4번째 조각 = 구간 조각 한도: 새 녹음기(같은 1분 간격)를 켜고 앞 녹음기를 멈춘다(마지막 조각 5).
  await page.evaluate(()=>window.__fakeRec.emit());
  await expect.poll(()=>page.evaluate(()=>window.__fakeRec.slices()),{timeout:10000}).toEqual([60000,60000]);
  await expect.poll(pieces,{timeout:10000}).toEqual(['1:1','1:2','1:3','1:4','1:5']);
  await expect.poll(()=>recCalls(calls,'rec_start').map(c=>c.body.session_id??null),{timeout:10000}).toEqual([null,'00000000-0000-4000-8000-0000000000aa']);
  await page.evaluate(()=>window.__fakeRec.emit());
  await expect.poll(pieces,{timeout:10000}).toEqual(['1:1','1:2','1:3','1:4','1:5','2:1']);
  expect(await page.evaluate(()=>window.__fakeRec.recs[0].state)).toBe('inactive');
  // 멈추고 정리: 새 구간 마지막 조각 → rec_finish
  await band.getByRole('button',{name:'멈추고 정리'}).click();
  await expect.poll(pieces,{timeout:10000}).toEqual(['1:1','1:2','1:3','1:4','1:5','2:1','2:2']);
  await expect.poll(()=>recCalls(calls,'rec_finish').length,{timeout:10000}).toBe(1);
  await expect(page.locator('#meetingModal')).toBeVisible({timeout:10000});
});

// 요청함 10/30 10:01: [버리기] — 멈추고 정리 말고 취소하고 버리기, 위쪽 작은 알림 [되돌리기] 10초.
const LIVE='00000000-0000-4000-8000-0000000000aa';
test('PC: 녹음 띠 [버리기] → 띠·마이크 꺼짐·정리 없음 → 위쪽 알림 [되돌리기] → \'이어서 정리\' 줄 → 정리하면 초안',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:1440,height:900});
  // 되돌린 뒤에만 서버가 이 녹음을 '끝나지 않은 녹음'으로 돌려준다.
  const pending=calls=>calls.some(c=>c.action==='rec_restore')?[{session_id:LIVE,started_at:'2026-10-30T01:00:00Z',duration_sec:60,
    segments:[{segment_no:1,status:'closed',job_id:null,job_status:null,duration_sec:60}]}]:[];
  const calls=await signIn(page,{pending,pieceFails:0});
  await page.locator('#reportRecordBtn').click();
  const band=page.locator('#recBand');
  await expect(band.locator('.rec-label')).toHaveText('녹음 중');
  // [일시정지] [멈추고 정리] [버리기] 순서, 같은 크기, [버리기]는 빨강 글자.
  const stop=band.getByRole('button',{name:'멈추고 정리'}),drop=band.getByRole('button',{name:'버리기'});
  const [s1,d1]=await Promise.all([stop.boundingBox(),drop.boundingBox()]);
  expect(s1.x+s1.width).toBeLessThanOrEqual(d1.x);
  expect(d1.height).toBeCloseTo(s1.height,0);
  const [dc,danger]=await drop.evaluate(el=>{const p=document.createElement('i');p.style.color='var(--kptu-danger)';document.body.append(p);const c=getComputedStyle(p).color;p.remove();return [getComputedStyle(el).color,c]});
  expect(dc).toBe(danger);
  // 일시정지 중에도 [버리기]가 있다.
  await band.getByRole('button',{name:'일시정지'}).click();
  await expect(band.getByRole('button',{name:'버리기'})).toBeVisible();

  await drop.click();
  await expect(band).toBeHidden();
  expect(await page.evaluate(()=>window.__fakeRec.track.stopped)).toBe(true);
  await expect(page.locator('#reportRecordBtn')).toHaveText('녹음');
  // 녹음기가 내놓은 마지막 조각까지 올린 뒤 서버에 버리기(조각은 서버가 Drive 휴지통으로).
  await expect.poll(()=>recCalls(calls,'rec_discard').map(c=>c.body)).toEqual([{session_id:LIVE}]);
  expect(recCalls(calls,'rec_piece').map(c=>c.seq)).toEqual(['1']);
  const notice=page.locator('#kptuNotice');
  await expect(notice).toBeVisible();
  await expect(notice.locator('.kptu-notice-text')).toHaveText('녹음을 버렸어요');
  // 알림은 10초(보통 알림 2초보다 길다).
  await page.mouse.move(5,890);
  await page.waitForTimeout(3000);
  await expect(notice).toBeVisible();
  expect(recCalls(calls,'rec_finish').length).toBe(0);
  expect(recCalls(calls,'transcribe').length).toBe(0);
  expect(calls.some(c=>c.action==='draft')).toBe(false);
  await expect(page.locator('#meetingModal')).toBeHidden();
  await expect(page.locator('#recPendingLine')).toBeHidden();

  await notice.getByRole('button',{name:'되돌리기'}).click();
  await expect.poll(()=>recCalls(calls,'rec_restore').map(c=>c.body)).toEqual([{session_id:LIVE}]);
  const line=page.locator('#recPendingLine');
  await expect(line).toBeVisible();
  await expect(line).toContainText('끝나지 않은 녹음 · 10/30 10:00 녹음 · 1분');
  await expect(notice).toContainText('되돌렸어요: 녹음 버리기');
  // 마이크는 이미 꺼졌으므로 녹음을 이어 하지 않는다(새 녹음기 없음).
  expect(await page.evaluate(()=>window.__fakeRec.recs.length)).toBe(1);
  await line.getByRole('button',{name:'이어서 정리'}).click();
  await expect.poll(()=>recCalls(calls,'rec_finish').map(c=>c.body.session_id)).toEqual([LIVE]);
  await expect(page.locator('#meetingModal')).toBeVisible({timeout:10000});
  await expect(page.locator('#meetingTranscript')).toHaveValue(/교섭 일정 확정/);
});

test('PC: \'이어서 정리\' 줄 [버리기] → 줄이 빠지고 서버에 버리기, 정리는 하지 않음',async({page})=>{
  test.setTimeout(45000);
  await page.setViewportSize({width:1440,height:900});
  const id='00000000-0000-4000-8000-0000000000cc';
  const calls=await signIn(page,{pending:[{session_id:id,started_at:'2026-10-29T05:00:00Z',duration_sec:2280,
    segments:[{segment_no:1,status:'closed',job_id:null,job_status:null,duration_sec:2280}]}]});
  const line=page.locator('#recPendingLine');
  await expect(line).toContainText('끝나지 않은 녹음 · 10/29 14:00 녹음 · 38분');
  const resume=line.getByRole('button',{name:'이어서 정리'}),drop=line.getByRole('button',{name:'버리기'});
  const [r1,d1]=await Promise.all([resume.boundingBox(),drop.boundingBox()]);
  expect(r1.x+r1.width).toBeLessThanOrEqual(d1.x);
  expect(d1.height).toBeCloseTo(r1.height,0);
  await drop.click();
  await expect.poll(()=>recCalls(calls,'rec_discard').map(c=>c.body)).toEqual([{session_id:id}]);
  await expect(line).toBeHidden();
  await expect(page.locator('#kptuNotice .kptu-notice-text')).toHaveText('녹음을 버렸어요');
  await expect(page.locator('#kptuNotice').getByRole('button',{name:'되돌리기'})).toBeVisible();
  expect(recCalls(calls,'rec_finish').length).toBe(0);
  expect(recCalls(calls,'rec_start').length).toBe(0);
  await expect(page.locator('#recBand')).toBeHidden();
});

test('PC: 서버 정리(S49-2) — [멈추고 정리] 뒤 서버가 합치기·전사·요약을 맡고, 끝난 결과가 회의 입력 창에 채워진다(화면 전사·요약 호출 없음)',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:1440,height:900});
  const calls=await signIn(page,{server:true,pieceFails:0});
  await page.locator('#reportRecordBtn').click();
  const band=page.locator('#recBand');
  await expect(band.locator('.rec-label')).toHaveText('녹음 중');
  await page.evaluate(()=>window.__fakeRec.emit());
  await expect.poll(()=>recCalls(calls,'rec_piece').length).toBe(1);
  await band.getByRole('button',{name:'멈추고 정리'}).click();
  await expect.poll(()=>recCalls(calls,'job_start').map(c=>c.body)).toEqual([{workspace_id:'rec-ws',kind:'recording',session_id:'00000000-0000-4000-8000-0000000000aa'}]);
  await expect(band.locator('.rec-label')).toHaveText('정리 중');
  await expect(band.locator('.rec-note')).toContainText('화면을 닫아도 서버에서 계속 정리해요');
  await expect(page.locator('#meetingModal')).toBeVisible({timeout:20000});
  await expect(page.locator('#meetingTranscript')).toHaveValue(/결정\n- 서버 요약 결정/);
  await expect(page.locator('#meetingNotes')).toHaveValue(/서버가 정리한 전사 전문입니다/);
  await expect(page.locator('#mtdStatus')).toContainText('초안을 채웠어요');
  await expect(page.locator('#mtdAttach')).toBeChecked();
  expect(recCalls(calls,'rec_finish').length).toBe(0);
  expect(recCalls(calls,'transcribe').length).toBe(0);
  expect(calls.some(c=>c.action==='draft')).toBe(false);
  await expect.poll(()=>recCalls(calls,'job_opened').map(c=>c.body)).toEqual([{job_id:'00000000-0000-4000-8000-0000000000b1'}]);
});

// REC-새로고침(S49-7): 새로고침·창 닫기로 끊긴 녹음은 서버에 조각이 남아 있고(rec_pending의 live), 어느 화면에서든 맨 위 띠에서 이어 녹음·이어서 정리할 수 있다.
// 브라우저 한계: 마이크는 새로고침에서 꺼진다. 되살리지 않고 같은 녹음(session)의 다음 구간으로 새 녹음기를 켠다.
const minutesAgo=m=>new Date(Date.now()-m*60000).toISOString();
test('PC: 새로고침 직후 어느 화면이든 맨 위 띠에 \'하던 녹음\' → [이어서 녹음]은 같은 녹음의 다음 구간으로, 띠 시간은 앞 길이에서 이어 센다',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:1440,height:900});
  const live=calls=>recCalls(calls,'rec_start').length?[]:[{session_id:LIVE,started_at:minutesAgo(52),duration_sec:3000,idle_sec:20,
    segments:[{segment_no:1,status:'recording',job_id:null,job_status:null,duration_sec:3000}]}];
  const calls=await signIn(page,{live,pieceFails:0,rec:{piece_seconds:60,segment_seconds:3540,max_pieces:60}});
  // 사업 보고가 아닌 화면에서도 보인다.
  await clickView(page,'library');
  await expect(page.locator('#libraryView')).toBeVisible();
  const band=page.locator('#recBand');
  await expect(band).toBeVisible();
  await expect(band.locator('.rec-label')).toHaveText('하던 녹음');
  await expect(band).toContainText('50분');
  const names=await band.getByRole('button').allTextContents();
  expect(names).toEqual(['이어서 녹음','이어서 정리','버리기']);
  const b=await band.boundingBox();
  expect(b.y).toBe(0);expect(b.height).toBeLessThanOrEqual(32);
  // 방금 끊긴 것인지 다른 곳에서 녹음 중인지 모르므로(idle 20초) 이어받기 전에 띠에서 한 번 묻는다(브라우저 확인창 없음). [취소]하면 그대로.
  let dialogs=0;
  page.on('dialog',async d=>{dialogs++;await d.dismiss()});
  await band.getByRole('button',{name:'이어서 녹음'}).click();
  await expect(band.locator('.rec-label')).toHaveText('확인');
  await expect(band).toContainText('다른 곳에서 지금 녹음 중이면 그쪽 녹음은 멈춰요');
  expect(recCalls(calls,'rec_start').length).toBe(0);
  await band.getByRole('button',{name:'취소'}).click();
  await expect(band.locator('.rec-label')).toHaveText('하던 녹음');
  await band.getByRole('button',{name:'이어서 녹음'}).click();
  await band.getByRole('button',{name:'계속'}).click();
  await expect(band.locator('.rec-label')).toHaveText('녹음 중');
  expect(dialogs).toBe(0);
  expect(recCalls(calls,'rec_start')[0].body).toEqual({workspace_id:'rec-ws',mime:'audio/webm',session_id:LIVE});
  expect(recCalls(calls,'rec_finish').length).toBe(0);
  await expect(band.locator('.rec-time')).toHaveText(/^50:0\d$/);
  // 새 구간의 조각은 새 녹음 id로 올라가고, 길이는 구간 시작부터 잰다(앞 녹음 길이를 더하지 않음).
  await page.evaluate(()=>window.__fakeRec.emit());
  await expect.poll(()=>recCalls(calls,'rec_piece').length).toBe(1);
  // 멈추고 정리: 같은 session 전체를 서버 정리로(끊긴 앞 구간 포함).
  await band.getByRole('button',{name:'멈추고 정리'}).click();
  await expect.poll(()=>recCalls(calls,'rec_finish').map(c=>c.body.session_id)).toEqual([LIVE]);
});

test('PC: 하던 녹음이 오래 조용하면(idle 5분) [이어서 정리]도 묻지 않고 바로 한다',async({page})=>{
  test.setTimeout(45000);
  await page.setViewportSize({width:1440,height:900});
  const calls=await signIn(page,{live:[{session_id:LIVE,started_at:minutesAgo(10),duration_sec:300,idle_sec:300,
    segments:[{segment_no:1,status:'recording',job_id:null,job_status:null,duration_sec:300}]}],pieceFails:0});
  const band=page.locator('#recBand');
  await expect(band.locator('.rec-label')).toHaveText('하던 녹음');
  await band.getByRole('button',{name:'이어서 정리'}).click();
  await expect.poll(()=>recCalls(calls,'rec_finish').map(c=>c.body.session_id)).toEqual([LIVE]);
  expect(recCalls(calls,'rec_start').length).toBe(0);
});

test('PC: 하루가 지난 끝나지 않은 녹음은 맨 위 띠에 없고 사업 보고 위 한 줄에만 있다',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await signIn(page,{pending:[{session_id:'s-old',started_at:minutesAgo(3*24*60),duration_sec:600,segments:[]}]});
  await expect(page.locator('#recPendingLine')).toBeVisible();
  await expect(page.locator('#recPendingLine').getByRole('button').allTextContents()).resolves.toEqual(['이어서 녹음','이어서 정리','버리기']);
  await expect(page.locator('#recBand')).toBeHidden();
});

test('PC: 녹음 중 새로고침·창 닫기는 먼저 \'나가시겠어요?\' 확인(beforeunload)을 요청하고, 녹음 중이 아니면 요청하지 않는다',async({page})=>{
  test.setTimeout(45000);
  await page.setViewportSize({width:1440,height:900});
  await signIn(page,{pieceFails:0});
  const asks=()=>page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented});
  expect(await asks()).toBe(false);
  await page.locator('#reportRecordBtn').click();
  await expect(page.locator('#recBand .rec-label')).toHaveText('녹음 중');
  expect(await asks()).toBe(true);
  await page.locator('#recBand').getByRole('button',{name:'일시정지'}).click();
  expect(await asks()).toBe(true);
});
