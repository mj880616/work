// S61-5 REC-전사삭제(명진 11/13 '회의 전사 기능은 아예 웹2에서 삭제, 그냥 파일만 제공(자료실 어딘가 자동 저장)').
// PC 1280(노트북 녹음 띠)·폰 412(폰 앱 녹음 띠)에서 녹음을 멈추면: 합치기(rec_finish) → 자료실 '회의 녹음' 폴더에 저장(rec_save) →
// 띠에 파일 이름 · [내려받기] · [Drive에서 열기]. 전사·요약·서버 정리·초안 창 호출은 0번.
// 실제 마이크·운영 서버는 쓰지 않는다(가짜 녹음기·가짜 앱 다리·가짜 Supabase). 자료는 모두 지어낸 것.
// KPTU_SHOTS=1이면 docs/design/screens/s61-5/에 화면 사진을 남긴다.
import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {signInWithSession} from './helpers/session-login.mjs';

test.use({timezoneId:'Asia/Seoul'});
const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const SHOTS=process.env.KPTU_SHOTS==='1';
const SHOT_DIR='docs/design/screens/s61-5';
const shot=async(page,name)=>{if(!SHOTS)return;mkdirSync(SHOT_DIR,{recursive:true});await page.waitForTimeout(300);await page.screenshot({path:`${SHOT_DIR}/${name}.png`})};
const SID='00000000-0000-4000-8000-0000000000aa',RID='00000000-0000-4000-8000-000000000001';
const FILE='회의 녹음 2026-11-13 10-00 (1)';
const ANDROID='Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36 KPTUAndroid/0.5.0';
// 전사·서버 정리·요약·녹음 붙이기 — 하나라도 부르면 실패.
const GONE=['transcribe','upload','job_start','job_retry','job_read','job_list','attach','config'];

async function mock(page,ext){
  const calls=[];
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'rec-access',refresh_token:'rec-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'rec-user'}});
    if(path==='/auth/v1/user')return ok({id:'rec-user',email:'rec@example.org',user_metadata:{display_name:'녹음 QA'}});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'rec-ws',user_id:'rec-user',role:'owner',email:'rec@example.org',workspace:{id:'rec-ws',name:'QA Workspace'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'rec-ws',name:'QA Workspace'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:'rec-user',display_name:'녹음 QA'}]);
    if(path==='/functions/v1/meeting-transcribe'){
      const action=url.searchParams.get('action');
      const body=action==='rec_piece'?null:(()=>{try{return JSON.parse(req.postData()||'{}')}catch{return {}}})();
      calls.push({action,body});
      if(action==='rec_pending')return ok({ok:true,sessions:[],live:[]});
      if(action==='rec_start')return ok({ok:true,recording_id:RID,session_id:SID,segment_no:1,piece_seconds:60,segment_seconds:1740,max_pieces:29});
      if(action==='rec_piece')return ok({ok:true,pieces:1});
      if(action==='rec_finish')return ok({ok:true,more:false,session_id:body.session_id,segments:[{segment_no:1,status:'combined',job_id:'00000000-0000-4000-8000-0000000000j1',duration_sec:600}]});
      if(action==='rec_save')return ok({ok:true,session_id:body.session_id,folder_id:'folder-rec',folder_name:'회의 녹음',files:[
        {document_id:'doc-rec-1',file_name:`${FILE}.${ext}`,drive_file_id:'driveRec1',drive_url:'https://drive.google.com/file/d/driveRec1/view',mime_type:`audio/${ext}`,size_bytes:4096,duration_sec:600,meeting_id:null}]});
      if(GONE.includes(action))return route.fulfill({status:410,contentType:'application/json',body:JSON.stringify({ok:false,code:'transcribe_off'})});
      return ok({ok:true});
    }
    if(path==='/functions/v1/workspace-drive'&&url.searchParams.get('action')==='download-token'){calls.push({action:'download-token',body:JSON.parse(req.postData()||'{}')});return ok({url:`${BASE}/app/__fake-download`})}
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path==='/functions/v1/google-tasks')return ok({tasks:[],needs_reconnect:false});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/')||path.startsWith('/functions/v1/'))return ok(method==='GET'?[]:{});
    return ok({});
  });
  await page.route(`${BASE}/app/__fake-download`,r=>r.fulfill({status:200,headers:{'Content-Type':`audio/${ext}`,'Content-Disposition':`attachment; filename="rec.${ext}"`},body:'fake-audio'}));
  await page.context().route('https://drive.google.com/**',r=>r.fulfill({status:200,contentType:'text/html',body:'drive'}));
  return calls;
}
async function signIn(page){
  await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(`${BASE}/app/?view=meetings`)}`);
  await signInWithSession(page,'rec@example.org');
  await expect(page.locator('#meetingsView')).toBeVisible({timeout:10000});
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
}
const of=(calls,action)=>calls.filter(c=>c.action===action);
async function checkSaved(page,band,calls,label,ext){
  await expect.poll(()=>of(calls,'rec_save').map(c=>c.body),{timeout:15000}).toEqual([{session_id:SID}]);
  expect(of(calls,'rec_finish').length).toBeGreaterThanOrEqual(1);
  await expect(band.locator('.rec-label')).toHaveText('저장됨');
  await expect(band.locator(".rec-file-name")).toHaveText(`${FILE}.${ext}`);
  const down=band.getByRole('button',{name:/내려받기$/}),open=band.getByRole('button',{name:/Drive에서 열기$/});
  await expect(down).toBeVisible();await expect(open).toBeVisible();
  // 전사·요약 버튼·띠 글자가 없다.
  await expect(band.getByText(/전사|요약|초안|정리/)).toHaveCount(0);
  await expect(page.locator('#meetingModal')).toBeHidden();
  // 띠가 가로로 넘치지 않는다.
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await shot(page,`${label}-saved`);
  // [내려받기]: 자료 번호로 한 번 쓰는 내려받기 주소(자료실과 같은 길)
  await Promise.all([page.waitForEvent('download'),down.click()]);
  await expect.poll(()=>of(calls,'download-token').map(c=>c.body)).toEqual([{document_id:'doc-rec-1'}]);
  // [Drive에서 열기]: 새 탭
  const [popup]=await Promise.all([page.waitForEvent('popup'),open.click()]);
  await popup.waitForURL(/drive\.google\.com\/file\/d\/driveRec1\/view/);await popup.close();
  expect(calls.filter(c=>GONE.includes(c.action))).toEqual([]);
}

test('PC 1280: [녹음] → [멈추고 저장] → 자료실 \'회의 녹음\' 저장 띠, 전사 호출 0번',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:1280,height:800});
  await page.addInitScript(()=>{
    class FakeRecorder extends EventTarget{
      constructor(stream,opts={}){super();this.mimeType=opts.mimeType||'';this.state='inactive';this.n=0}
      static isTypeSupported(t){return String(t).startsWith('audio/webm')}
      start(){this.state='recording'}
      pause(){this.state='paused'}resume(){this.state='recording'}
      requestData(){this.chunk()}
      chunk(){const e=new Event('dataavailable');e.data=new Blob([`piece-${++this.n}-`.repeat(40)],{type:'audio/webm'});this.dispatchEvent(e)}
      stop(){if(this.state==='inactive')return;this.state='inactive';setTimeout(()=>{this.chunk();this.dispatchEvent(new Event('stop'))},0)}
    }
    window.MediaRecorder=FakeRecorder;
    const track={stop(){}};
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[track]})}});
  });
  const calls=await mock(page,'webm');
  await signIn(page);
  await page.locator('#reportRecordBtn').click();
  const band=page.locator('#recBand');
  await expect(band.locator('.rec-label')).toHaveText('녹음 중');
  await expect(band.getByRole('button',{name:'멈추고 저장'})).toBeVisible();
  await shot(page,'pc-1280-recording');
  await band.getByRole('button',{name:'멈추고 저장'}).click();
  await checkSaved(page,band,calls,"pc-1280","webm");
});

test.describe('폰 앱 412',()=>{
  test.use({viewport:{width:412,height:915},userAgent:ANDROID,hasTouch:true,isMobile:true});
  test('폰 412: 녹음 중 띠 [멈추고 저장] → 남은 조각 올림 → 자료실 \'회의 녹음\' 저장 띠, 전사 호출 0번',async({page})=>{
    test.setTimeout(60000);
    // 가짜 앱 다리: 녹음 중인 폰 앱처럼 답한다(tests/phone-recorder.test.mjs의 흉내와 같은 규칙).
    await page.addInitScript(({SID,RID})=>{
      const st={state:'recording',session_id:SID,started_at:new Date(Date.now()-600000).toISOString(),elapsed_ms:600000,queued:0,auto_finish:false,workspace_id:'rec-ws'};
      let pieces=[],seq=0,listeners=[];
      const reply=t=>setTimeout(()=>listeners.forEach(f=>f({data:t})),0);
      const state=()=>reply('rec:state:'+JSON.stringify({...st,queued:pieces.length}));
      const add=()=>{seq++;pieces.push({kind:'piece',no:1,id:RID,seq,seconds:seq*60,size:100,token:`tok${seq}xxxxxxxxxxxxxxxxxxxx`})};
      window.KPTUAppShell={addEventListener:(type,fn)=>{if(type==='message')listeners.push(fn)},postMessage:t=>{
        if(t==='rec:hello')state();
        else if(t==='rec:next')reply('rec:next:'+JSON.stringify(pieces.length?pieces[0]:st.state==='recording'?{kind:'idle'}:st.state==='idle'?{kind:'none'}:{kind:'drained'}));
        else if(t.startsWith('rec:sent:')){const s=t.split(':')[3];if(pieces[0]&&String(pieces[0].seq)===s)pieces.shift()}
        else if(t.startsWith('rec:failed:'))reply('rec:wait:0');
        else if(t==='rec:stop'){st.state='stopped';add();state()}
        else if(t==='rec:clear'){st.state='idle';st.session_id='';pieces=[];state()}
      }};
    },{SID,RID});
    await page.route(`${BASE}/app/__rec/**`,r=>r.fulfill({status:200,contentType:'audio/ogg',body:'fake-ogg-piece'}));
    const calls=await mock(page,'ogg');
    await signIn(page);
    const band=page.locator('#phoneRecBand');
    await expect(band.locator('.rec-label')).toHaveText('녹음 중',{timeout:10000});
    await expect(band.getByRole('button',{name:'멈추고 저장'})).toBeVisible();
    await shot(page,'phone-412-recording');
    await band.getByRole('button',{name:'멈추고 저장'}).click();
    await expect.poll(()=>of(calls,'rec_piece').length,{timeout:15000}).toBe(1);
    await checkSaved(page,band,calls,"phone-412","ogg");
    await band.getByRole('button',{name:'닫기'}).click();
    await expect(band).toBeHidden();
  });
});
