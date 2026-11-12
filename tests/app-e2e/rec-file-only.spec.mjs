// REC-파일만받기(S61-3, 명진 11/13): 녹음 끝 [파일만 받기](기본) / [전사·요약까지].
// [파일만 받기] = rec_finish(합치기만)뿐 — 서버 전사 작업(job_start)·화면 전사(transcribe)를 부르지 않고 띠에 '녹음 파일 [내려받기][Drive 열기]'.
// 그 띠·사업 보고 위 '녹음 파일' 줄의 [전사·요약]은 같은 job_start(서버 정리)를 시작한다. PC 1280(노트북 녹음)·폰 412(폰 앱 녹음, 가짜 앱 다리).
// 실제 마이크·운영 서버는 쓰지 않는다. S61_SHOTS=1이면 화면 사진을 docs/design/screens/s61-3/에 남긴다(가짜 자료).
import {test,expect} from '@playwright/test';
import {signInWithSession} from './helpers/session-login.mjs';

test.use({timezoneId:'Asia/Seoul'});

const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const SID='00000000-0000-4000-8000-0000000000aa';
const FILES=[{segment_no:1,drive_file_id:'driveRecFile0001',duration_sec:1740},{segment_no:2,drive_file_id:'driveRecFile0002',duration_sec:600}];
const shot=async(page,name)=>{if(process.env.S61_SHOTS)await page.screenshot({path:`docs/design/screens/s61-3/${name}.png`})};

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
    window.__fakeRec={recs,track};
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[track]})}});
  });
}

// 폰 앱 흉내(RecordHub·MainActivity와 같은 답): 다리 글을 받아 상태·다음 조각을 돌려준다. 조각 내용은 ./__rec/<번호>.
async function fakeApp(page){
  await page.addInitScript(()=>{
    const st={state:'idle',session_id:'',started_at:'',elapsed_ms:0,queued:0,auto_finish:false,discard:false,want_start:false};
    let pieces=[],seq=0;const fns=[];
    const reply=t=>setTimeout(()=>fns.forEach(f=>f({data:t})),0);
    const state=()=>reply('rec:state:'+JSON.stringify({...st,queued:pieces.length}));
    const add=()=>{seq++;pieces.push({no:1,id:'00000000-0000-4000-8000-000000000001',seq,seconds:60,size:100,token:`tok${seq}xxxxxxxxxxxxxxxxxxxx`})};
    window.KPTUAppShell={
      addEventListener(type,fn){if(type==='message')fns.push(fn)},
      postMessage(t){
        if(typeof t!=='string'||!t.startsWith('rec:'))return;
        if(t==='rec:hello')state();
        else if(t==='rec:prepare')reply('rec:ready');
        else if(t.startsWith('rec:begin:')){const b=JSON.parse(t.slice(10));Object.assign(st,{state:'recording',session_id:b.session_id,started_at:b.started_at});add();state()}
        else if(t==='rec:next')reply('rec:next:'+JSON.stringify(pieces.length?{kind:'piece',...pieces[0]}:st.state==='recording'?{kind:'idle'}:st.state==='idle'?{kind:'none'}:{kind:'drained'}));
        else if(t.startsWith('rec:sent:')){const [, , , s]=t.split(':');if(pieces[0]&&String(pieces[0].seq)===s)pieces.shift()}
        else if(t.startsWith('rec:failed:'))reply('rec:wait:0');
        else if(t==='rec:stop'){st.state='stopped';add();state()}
        else if(t==='rec:clear'){st.state='idle';st.session_id='';pieces=[];state()}
      },
    };
  });
  await page.route(`${BASE}/app/__rec/**`,route=>route.fulfill({status:200,contentType:'audio/ogg',body:'OggS-fake-piece'}));
}

async function mock(page,{pending=[]}={}){
  const calls=[];
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'rec-access',refresh_token:'rec-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'rec-user'}});
    if(path==='/auth/v1/user')return ok({id:'rec-user',email:'rec@example.org',user_metadata:{display_name:'녹음 QA'}});
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'rec-ws',user_id:'rec-user',role:'owner',email:'rec@example.org',workspace:{id:'rec-ws',name:'QA Workspace'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'rec-ws',name:'QA Workspace'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:'rec-user',display_name:'녹음 QA'}]);
    if(path==='/functions/v1/meeting-transcribe'){
      const action=url.searchParams.get('action');
      const body=action==='rec_piece'?null:(()=>{try{return JSON.parse(req.postData()||'{}')}catch{return {}}})();
      calls.push({action,body});
      if(action==='rec_pending')return ok({ok:true,sessions:typeof pending==='function'?pending(calls):pending,live:[]});
      if(action==='rec_start')return ok({ok:true,recording_id:'00000000-0000-4000-8000-000000000001',session_id:SID,segment_no:1,piece_seconds:60,segment_seconds:1740,max_pieces:29});
      if(action==='rec_piece')return ok({ok:true,pieces:1});
      if(action==='rec_finish')return ok({ok:true,more:false,session_id:body.session_id,segments:FILES.map(f=>({segment_no:f.segment_no,status:'combined',error_code:null,job_id:`job-${f.segment_no}`,duration_sec:f.duration_sec})),files:FILES});
      if(action==='job_start')return ok({ok:true,job:{id:'00000000-0000-4000-8000-0000000000b1',kind:'recording',status:'running',stage:'transcribe',session_id:body.session_id,parts_done:0,parts_total:2,step_no:0,step_total:2,jobs:[]}});
      if(action==='job_read')return ok({ok:true,job:{id:body.job_id,kind:'recording',status:'running',stage:'transcribe',session_id:SID,parts_done:0,parts_total:2,step_no:0,step_total:2,jobs:[]}});
      if(action==='job_list')return ok({ok:true,jobs:[]});
      if(action==='transcribe')throw new Error('파일만 받기에서는 전사를 부르면 안 된다');
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

async function signIn(page,opts){
  const calls=await mock(page,opts);
  const returnTo=`${BASE}/app/?view=meetings`;
  await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(returnTo)}`);
  await signInWithSession(page,'rec@example.org');
  await expect(page.locator('#meetingsView')).toBeVisible({timeout:10000});
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  return calls;
}
const of=(calls,action)=>calls.filter(c=>c.action===action);
const fits=async band=>{const [b,a]=await Promise.all([band.boundingBox(),band.locator('.rec-actions').boundingBox()]);expect(a.x).toBeGreaterThanOrEqual(b.x-1);expect(a.x+a.width).toBeLessThanOrEqual(b.x+b.width+1)};

test('PC 1280: 녹음 → [파일만 받기](기본) → 전사 작업 없이 녹음 파일 [내려받기][Drive 열기] → [전사·요약]이면 서버 정리 시작',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:1280,height:800});
  await fakeRecorder(page);
  const calls=await signIn(page);
  await page.locator('#reportRecordBtn').click();
  const band=page.locator('#recBand');
  await expect(band.locator('.rec-label')).toHaveText('녹음 중');
  const fileBtn=band.getByRole('button',{name:'파일만 받기'}),aiBtn=band.getByRole('button',{name:'전사·요약까지'});
  // [파일만 받기]가 앞(기본), [전사·요약까지]가 뒤, 같은 높이(작은 띠 버튼).
  const [f,a]=await Promise.all([fileBtn.boundingBox(),aiBtn.boundingBox()]);
  expect(f.x+f.width).toBeLessThanOrEqual(a.x);expect(f.height).toBeCloseTo(a.height,0);expect(f.height).toBeLessThanOrEqual(32);
  await fits(band);
  await shot(page,'pc-1280-recording');

  await fileBtn.click();
  await expect(band.locator('.rec-label')).toHaveText('녹음 파일');
  await expect.poll(()=>of(calls,'rec_finish').length).toBe(1);
  expect(of(calls,'rec_finish')[0].body).toEqual({session_id:SID});
  const down=band.getByRole('link',{name:'내려받기 1'});
  await expect(down).toHaveAttribute('href','https://drive.google.com/uc?export=download&id=driveRecFile0001');
  await expect(band.getByRole('link',{name:'내려받기 2'})).toHaveAttribute('href',/id=driveRecFile0002$/);
  await expect(band.getByRole('link',{name:'Drive 열기'})).toHaveAttribute('href','https://drive.google.com/file/d/driveRecFile0001/view');
  await expect(down).toHaveAttribute('target','_blank');
  await fits(band);
  await shot(page,'pc-1280-file-only');
  // 서버 전사 작업·화면 전사·요약을 부르지 않는다(AI 비용 0).
  await page.waitForTimeout(500);
  expect(of(calls,'job_start')).toEqual([]);
  expect(of(calls,'transcribe')).toEqual([]);

  // [전사·요약]: 같은 녹음으로 서버 정리(job_start) — [전사·요약까지]와 같은 길.
  await band.getByRole('button',{name:'전사·요약'}).click();
  await expect.poll(()=>of(calls,'job_start').map(c=>c.body)).toEqual([{workspace_id:'rec-ws',kind:'recording',session_id:SID}]);
  await expect(band.locator('.rec-label')).toHaveText('정리 중');
  expect(of(calls,'transcribe')).toEqual([]);
});

test('PC 1280: [전사·요약까지]는 지금처럼 바로 서버 정리(job_start), 합치기만 따로 부르지 않는다',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:1280,height:800});
  await fakeRecorder(page);
  const calls=await signIn(page);
  await page.locator('#reportRecordBtn').click();
  const band=page.locator('#recBand');
  await expect(band.locator('.rec-label')).toHaveText('녹음 중');
  await band.getByRole('button',{name:'전사·요약까지'}).click();
  await expect.poll(()=>of(calls,'job_start').map(c=>c.body)).toEqual([{workspace_id:'rec-ws',kind:'recording',session_id:SID}]);
  expect(of(calls,'rec_finish')).toEqual([]);
});

test('PC 1280: 파일만 남긴 녹음은 맨 위 띠가 아니라 사업 보고 위 \'녹음 파일\' 줄 → [전사·요약]이면 서버 정리',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:1280,height:800});
  await fakeRecorder(page);
  const item={session_id:SID,started_at:new Date(Date.now()-3600000).toISOString(),duration_sec:2340,file_only:true,files:FILES,
    segments:FILES.map(f=>({segment_no:f.segment_no,status:'combined',job_id:`job-${f.segment_no}`,job_status:'uploaded',duration_sec:f.duration_sec}))};
  const calls=await signIn(page,{pending:c=>c.some(x=>x.action==='job_start')?[]:[item]});
  const line=page.locator('#recPendingLine');
  await expect(line).toBeVisible({timeout:10000});
  await expect(line).toContainText('녹음 파일 ·');
  await expect(page.locator('#recBand')).toBeHidden();
  await expect(line.getByRole('link',{name:'내려받기 1'})).toBeVisible();
  await expect(line.getByRole('button',{name:'이어서 정리'})).toHaveCount(0);
  await expect(line.getByRole('button',{name:'이어 녹음'})).toHaveCount(0);
  await shot(page,'pc-1280-file-line');
  await line.getByRole('button',{name:'전사·요약'}).click();
  await expect.poll(()=>of(calls,'job_start').map(c=>c.body)).toEqual([{workspace_id:'rec-ws',kind:'recording',session_id:SID}]);
});

test('폰 412(앱): 녹음 → [파일만 받기](기본) → 전사 작업 없이 녹음 파일 → [전사·요약]이면 서버 정리',async({browser})=>{
  test.setTimeout(60000);
  const ctx=await browser.newContext({viewport:{width:412,height:915},deviceScaleFactor:1,hasTouch:true,isMobile:true,timezoneId:'Asia/Seoul',
    userAgent:'Mozilla/5.0 (Linux; Android 14; SM-F946N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 KPTUAndroid/0.3.3'});
  const page=await ctx.newPage();
  await fakeApp(page);
  const calls=await signIn(page);
  const rec=page.locator('#phoneRecordBtn');
  await expect(rec).toBeVisible({timeout:10000});
  await rec.click();
  const band=page.locator('#phoneRecBand');
  await expect(band.locator('.rec-label')).toHaveText('녹음 중');
  await expect(band.getByRole('button',{name:'파일만 받기'})).toBeVisible();
  await expect(band.getByRole('button',{name:'전사·요약까지'})).toBeVisible();
  await fits(band);
  await shot(page,'phone-412-recording');

  await band.getByRole('button',{name:'파일만 받기'}).click();
  await expect(band.locator('.rec-label')).toHaveText('녹음 파일');
  await expect.poll(()=>of(calls,'rec_finish').length).toBe(1);
  await expect(band.getByRole('link',{name:'내려받기 1'})).toHaveAttribute('href',/id=driveRecFile0001$/);
  await expect(band.getByRole('link',{name:'Drive 열기'})).toBeVisible();
  await fits(band);
  await shot(page,'phone-412-file-only');
  await page.waitForTimeout(500);
  expect(of(calls,'job_start')).toEqual([]);
  expect(of(calls,'transcribe')).toEqual([]);

  await band.getByRole('button',{name:'전사·요약'}).click();
  await expect.poll(()=>of(calls,'job_start').map(c=>c.body)).toEqual([{workspace_id:'rec-ws',kind:'recording',session_id:SID}]);
  await ctx.close();
});
