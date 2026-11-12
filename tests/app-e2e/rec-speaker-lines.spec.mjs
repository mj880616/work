// REC-발언자구분(S58-6, 요청함 11/11 12:57): 노트북 [녹음]은 29분마다 새 구간으로 넘어가고(발언자 구분은 30분까지라),
// 구간마다 온 '화자n:' 줄이 회의록 전문 칸에 줄로 나뉘어 들어간다. 구간이 바뀌는 자리의 '― n분부터 ―' 머리 줄은 그대로.
// 실제 마이크·운영 서버·실제 회의 글은 쓰지 않는다: 가짜 녹음기·가짜 Supabase(page.route)·지어낸 글. 29분은 가짜 시계로 건너뛴다.
import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {testOrigin} from './helpers/test-origin.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {openMeetingResult} from './helpers/meeting-open.mjs';

test.use({timezoneId:'Asia/Seoul'});

const BASE=testOrigin,SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// 화면 사진은 REC_SHOTS=1일 때만 남긴다(PR에 붙이는 사진, docs/design/screens/s58-6/). CI는 찍지 않는다.
const SHOTS=process.env.REC_SHOTS==='1'?'docs/design/screens/s58-6':'';
const shot=async(target,name)=>{if(!SHOTS)return;mkdirSync(SHOTS,{recursive:true});await target.screenshot({path:`${SHOTS}/${name}.png`})};

const SID='00000000-0000-4000-8000-0000000000aa',J1='00000000-0000-4000-8000-0000000000j1',J2='00000000-0000-4000-8000-0000000000j2';
// 구간마다 서버가 돌려주는 전사 글(지어낸 것). 화자 번호는 구간마다 새로 매겨진다.
const SEG1='화자1: 오늘은 가상 행사 준비 일정을 정리하겠습니다.\n화자2: 장소 예약은 이번 주 안에 끝내면 됩니다.\n화자1: 그럼 안내문은 다음 주 월요일에 내보내죠.';
const SEG2='화자1: 이어서 예산 이야기를 하겠습니다.\n화자2: 인쇄비는 지난번과 같습니다.\n화자3: 간식비만 조금 늘리면 됩니다.';
const FULL=`${SEG1}\n\n― 29분부터 ―\n${SEG2}`;
const SUMMARY={decisions:'안내문은 다음 주 월요일에 내보내기로 함',information:'인쇄비는 지난번과 같고 간식비만 늘림',actions:[{task:'장소 예약',assignee:'',due:''}],meeting_date:'',attendees:[]};

async function fakeRecorder(page){
  await page.addInitScript(()=>{
    const recs=[];
    class FakeRecorder extends EventTarget{
      constructor(stream,opts={}){super();this.mimeType=opts.mimeType||'';this.state='inactive';this.n=0;recs.push(this)}
      static isTypeSupported(t){return String(t).startsWith('audio/webm')}
      start(timeslice){this.state='recording';this.timeslice=timeslice}
      pause(){this.state='paused'}
      resume(){this.state='recording'}
      requestData(){this.chunk()}
      chunk(){const e=new Event('dataavailable');e.data=new Blob([`piece-${++this.n}-`.repeat(40)],{type:'audio/webm'});this.dispatchEvent(e)}
      stop(){if(this.state==='inactive')return;this.state='inactive';setTimeout(()=>{this.chunk();this.dispatchEvent(new Event('stop'))},0)}
    }
    window.MediaRecorder=FakeRecorder;
    const track={stop(){}};
    window.__fakeRec={recs,emit(){recs.at(-1)?.chunk()},slices(){return recs.map(r=>r.timeslice)}};
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[track]})}});
  });
}

// 가짜 서버. segmentSeconds: rec_start 답의 구간 길이(새 서버 1740, 옛 서버 3540). meetings: 저장된 사업 보고 목록.
async function mock(page,{segmentSeconds=1740,meetings=[]}={}){
  const calls=[];
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'rec-access',refresh_token:'rec-refresh',expires_in:36000,expires_at:Math.floor(Date.now()/1000)+36000,user:{id:'rec-user'}});
    if(path==='/auth/v1/user')return ok({id:'rec-user',email:'rec@example.org',user_metadata:{display_name:'녹음 QA'}});
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'rec-ws',user_id:'rec-user',role:'owner',email:'rec@example.org',workspace:{id:'rec-ws',name:'QA Workspace'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'rec-ws',name:'QA Workspace'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:'rec-user',display_name:'녹음 QA'}]);
    if(path==='/rest/v1/app_meetings')return ok(meetings);
    if(path==='/functions/v1/meeting-transcribe'){
      const action=url.searchParams.get('action'),headers=req.headers();
      const body=action==='rec_piece'?null:(()=>{try{return JSON.parse(req.postData()||'{}')}catch{return {}}})();
      calls.push({action,body,seq:headers['x-piece-seq']||'',rid:headers['x-recording-id']||'',seconds:headers['x-duration-sec']||''});
      if(action==='rec_pending')return ok({ok:true,sessions:[],live:[]});
      if(action==='rec_start'){const n=calls.filter(c=>c.action==='rec_start').length;return ok({ok:true,recording_id:`00000000-0000-4000-8000-00000000000${n}`,session_id:SID,segment_no:n,piece_seconds:60,segment_seconds:segmentSeconds,max_pieces:60})}
      if(action==='rec_piece')return ok({ok:true,pieces:Number(headers['x-piece-seq'])});
      if(action==='rec_finish')return ok({ok:true,more:false,session_id:body.session_id,segments:[
        {segment_no:1,status:'combined',error_code:null,job_id:J1,duration_sec:1740},{segment_no:2,status:'combined',error_code:null,job_id:J2,duration_sec:600}]});
      // 발언자 구분이 켜진 구간의 답: '화자n:' 줄(서버 readTranscript가 맞춘 모양 그대로).
      if(action==='transcribe')return ok({ok:true,job_id:body.job_id,text:body.job_id===J1?SEG1:SEG2,speaker_split:true});
      if(action==='config')return ok({ok:true,ready:true});
      return ok({ok:true}); // 서버 정리(job_*)를 모르는 옛 서버처럼: 화면이 구간마다 전사해 잇는다
    }
    if(path==='/functions/v1/meeting-ai-draft'){calls.push({action:'draft',body:JSON.parse(req.postData()||'{}')});return ok({draft:SUMMARY})}
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
  const calls=await mock(page,opts);
  await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(`${BASE}/app/?view=meetings`)}`);
  await signInWithSession(page,'rec@example.org');
  await expect(page.locator('#meetingsView')).toBeVisible({timeout:10000});
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  return calls;
}
const of=(calls,action)=>calls.filter(c=>c.action===action);

// 서버가 새 값(29분)을 주든 옛 값(59분)을 주든 노트북은 29분에 넘긴다(화면과 서버 가운데 어느 쪽이 먼저 배포돼도 같은 동작).
for(const [label,segmentSeconds] of [['새 서버(구간 29분)',1740],['옛 서버(구간 59분)',3540]]){
  test(`PC 1280: [녹음] 29분에 새 구간으로 넘어가고, 정리하면 회의록 전문이 '화자n:' 줄로 나뉘어 들어간다 — ${label}`,async({page})=>{
    test.setTimeout(90000);
    await page.setViewportSize({width:1280,height:900});
    await page.clock.install();
    await fakeRecorder(page);
    const calls=await signIn(page,{segmentSeconds});
    await page.locator('#reportRecordBtn').click();
    const band=page.locator('#recBand');
    await expect(band.locator('.rec-label')).toHaveText('녹음 중');
    const pieces=()=>of(calls,'rec_piece').map(c=>`${c.rid.slice(-1)}:${c.seq}`);
    await page.evaluate(()=>window.__fakeRec.emit());
    await expect.poll(pieces,{timeout:10000}).toEqual(['1:1']);

    // 28분: 아직 한 구간(녹음기 하나).
    await page.clock.fastForward(28*60*1000);
    await page.clock.runFor(2000);
    expect(await page.evaluate(()=>window.__fakeRec.recs.length)).toBe(1);
    expect(of(calls,'rec_start').length).toBe(1);
    // 29분을 넘으면: 새 녹음기를 먼저 켜고 앞 녹음기를 멈춘다(앞 구간 마지막 조각 → 같은 녹음의 다음 구간을 연다). 녹음은 끊기지 않는다.
    await page.clock.fastForward(61*1000);
    await page.clock.runFor(2000);
    await expect.poll(()=>page.evaluate(()=>window.__fakeRec.slices()),{timeout:10000}).toEqual([60000,60000]);
    await expect.poll(pieces,{timeout:10000}).toEqual(['1:1','1:2']);
    await expect.poll(()=>of(calls,'rec_start').map(c=>c.body.session_id??null),{timeout:10000}).toEqual([null,SID]);
    await expect(band.locator('.rec-label')).toHaveText('녹음 중');
    // 앞 구간 길이는 29분 남짓: 발언자 구분 상한(30분 = 1800초) 안.
    const firstLength=Number(of(calls,'rec_piece')[1].seconds);
    expect(firstLength).toBeGreaterThanOrEqual(1740);expect(firstLength).toBeLessThanOrEqual(1800);
    await page.evaluate(()=>window.__fakeRec.emit());
    await expect.poll(pieces,{timeout:10000}).toEqual(['1:1','1:2','2:1']);

    // 멈추고 정리: 구간마다 전사 → 글 잇기 → 요약 → 회의 입력 창.
    await band.getByRole('button',{name:'전사·요약까지'}).click();
    await expect.poll(()=>of(calls,'transcribe').map(c=>c.body.job_id),{timeout:15000}).toEqual([J1,J2]);
    const modal=page.locator('#meetingModal');
    await expect(modal).toBeVisible({timeout:15000});
    // 회의록 전문: 화자 줄은 줄마다, 구간이 바뀌는 자리에 머리 줄 한 줄(번호가 새로 매겨지는 자리).
    const notes=page.locator('#meetingNotes');
    await expect(page.locator('#meetingNotesLabel')).toHaveText('회의록 전문');
    await expect(notes).toHaveValue(FULL);
    const lines=(await notes.inputValue()).split('\n').filter(Boolean);
    expect(lines.filter(l=>/^화자[123]: /.test(l))).toHaveLength(6);
    expect(lines.filter(l=>/^―/.test(l))).toEqual(['― 29분부터 ―']);
    // 요약에 넘기는 글은 전문 그대로(머리 줄·화자 줄 포함), 요약·참석자·할 일 칸에는 화자 번호가 들어가지 않는다.
    expect(calls.find(c=>c.action==='draft').body.transcript_text).toBe(FULL);
    const summary=await page.locator('#meetingTranscript').inputValue();
    expect(summary).toContain('안내문은 다음 주 월요일에 내보내기로 함');
    expect(summary).not.toMatch(/화자\s*\d/);
    for(const field of await modal.locator('input[type="text"],input:not([type])').all())expect(await field.inputValue()).not.toMatch(/화자\s*\d/);
    if(segmentSeconds===1740){
      await notes.evaluate(el=>{el.style.height='auto';el.style.height=`${Math.min(el.scrollHeight+4,360)}px`});
      await notes.scrollIntoViewIfNeeded();
      await shot(page,'after-draft-notes-1280');
    }
  });
}

// 저장된 회의를 다시 열면 회의록 전문이 화자 줄마다 줄이 바뀌어 보인다(폰·PC). 머리 줄도 따로 한 줄.
const SAVED={id:'meeting-rec-1',workspace_id:'rec-ws',project_id:null,title:'가상 준비 모임',series_name:'가상 준비 모임',round_no:1,
  meeting_at:'2026-11-11T05:00:00Z',notes:FULL,decisions:'',location:'',attendee_count:null,
  transcript_text:'결정\n- 안내문은 다음 주 월요일에 내보내기로 함\n\n공유\n- 인쇄비는 지난번과 같고 간식비만 늘림',created_by:'rec-user',activity_kind:'meeting'};
for(const [name,width,height] of [['폰 412',412,900],['PC 1280',1280,900]]){
  test(`${name}: 저장된 회의의 회의록 전문을 펼치면 '화자n:' 줄과 구간 머리 줄이 줄마다 보인다`,async({page})=>{
    test.setTimeout(60000);
    await page.setViewportSize({width,height});
    await signIn(page,{meetings:[SAVED]});
    await openMeetingResult(page,SAVED.id);
    const fold=page.locator('#mrdSpecialFold');
    await expect(fold).toBeVisible();
    // 전문은 길어서 접어 두고 글자 수만 보인다 → 펼친다.
    await expect(page.locator('#mrdSpecialSize')).toHaveText(`${FULL.length.toLocaleString('ko-KR')}자`);
    if(!(await fold.evaluate(el=>el.open)))await fold.locator('summary').click();
    const special=page.locator('#mrdSpecial');
    await expect(special).toBeVisible();
    // 보이는 글(줄바꿈 그대로)에 화자 줄 6개·머리 줄 1개가 각각 한 줄로 있다.
    const seen=(await special.innerText()).split('\n').map(l=>l.trim()).filter(Boolean);
    expect(seen.filter(l=>/^화자[123]: /.test(l))).toEqual([...SEG1.split('\n'),...SEG2.split('\n')]);
    expect(seen.filter(l=>/^―/.test(l))).toEqual(['― 29분부터 ―']);
    // 결과(요약) 칸에는 화자 번호가 없다.
    expect(await page.locator('#mrdResult').innerText()).not.toMatch(/화자\s*\d/);
    // 가로로 넘치지 않는다.
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    await special.scrollIntoViewIfNeeded();
    await shot(page,`after-result-notes-${width}`);
  });
}
