// REC-정리상태확인못함(S60-3): 녹음 정리 띠가 서버가 거절한 이유를 그대로 보이고, 잠깐 끊김만 '확인하지 못했어요'로 알린 뒤
// 다시 보이거나 연결이 돌아오면 저절로 다시 확인한다. 결과(초안) 열기 실패는 상태 확인 실패와 나눠 '정리 끝 [초안 열기]'에 남긴다.
// 운영 서버는 쓰지 않는다: 가짜 Supabase(page.route). 서버 거절 답 모양은 Edge meeting-transcribe(model.mjs MESSAGES·STATUS)와 같다.
import {test,expect} from '@playwright/test';
import {signInWithSession} from './helpers/session-login.mjs';

test.use({timezoneId:'Asia/Seoul'});

const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const JOB='00000000-0000-4000-8000-0000000000c1',SESSION='00000000-0000-4000-8000-0000000000aa';
const SHOTS=process.env.REC_STATUS_SHOTS||'';

const failedJob={id:JOB,kind:'recording',status:'failed',stage:'transcribe',error_code:'empty_transcript',session_id:SESSION,parts_done:0,parts_total:1,step_no:0,step_total:0,created_at:'2026-11-12T07:00:00Z',seconds:600};
const doneJob={...failedJob,status:'done',stage:'done',error_code:null,parts_done:1,jobs:[],
  transcript_text:'김위원장: 서버가 정리한 전사 전문입니다.',draft:{decisions:'서버 요약 결정',information:'',actions:[],meeting_date:'',attendees:[]}};

// retry/read: (calls)=> {http,body} | 'abort' | job. 첫 화면 job_list는 멈춘 작업 하나.
async function mock(page,{retry,read=()=>doneJob}={}){
  const calls=[];
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    const answer=a=>a==='abort'?route.abort('internetdisconnected'):a?.http?route.fulfill({status:a.http,contentType:'application/json',body:JSON.stringify(a.body)}):ok({ok:true,job:a});
    if(path==='/auth/v1/token')return ok({access_token:'rs-access',refresh_token:'rs-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'rs-user'}});
    if(path==='/auth/v1/user')return ok({id:'rs-user',email:'rs@example.org',user_metadata:{display_name:'녹음 QA'}});
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'rs-ws',user_id:'rs-user',role:'owner',email:'rs@example.org',workspace:{id:'rs-ws',name:'QA Workspace'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'rs-ws',name:'QA Workspace'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:'rs-user',display_name:'녹음 QA'}]);
    if(path==='/functions/v1/meeting-transcribe'){
      const action=url.searchParams.get('action');
      let body={};try{body=JSON.parse(req.postData()||'{}')}catch{}
      calls.push({action,body});
      if(action==='job_list')return ok({ok:true,jobs:[failedJob]});
      if(action==='job_retry')return answer(retry(calls));
      if(action==='job_read')return answer(read(calls));
      if(action==='rec_pending')return ok({ok:true,sessions:[],live:[]});
      if(action==='join_list')return ok({ok:true,jobs:[]});
      if(action==='join_candidates')return ok({ok:true,candidates:[]});
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
async function open(page,opts){
  const calls=await mock(page,opts);
  const returnTo=`${BASE}/app/?view=meetings`;
  await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(returnTo)}`);
  await signInWithSession(page,'rs@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
  const band=page.locator('#recBand');
  // 앱을 열면 멈춘 서버 정리 작업이 띠에 이유와 함께 뜬다(job_list).
  await expect(band.locator('.rec-label')).toHaveText('녹음 정리 멈춤',{timeout:10000});
  await expect(band.locator('.rec-note')).toHaveText('녹음에서 글을 찾지 못했어요.');
  return {calls,band};
}
const count=(calls,action)=>calls.filter(c=>c.action===action).length;
const shot=async(page,name)=>{if(SHOTS)await page.locator('#recBand').screenshot({path:`${SHOTS}/${name}.png`})};

for(const [label,size] of [['PC 1280',{width:1280,height:800}],['폰 412',{width:412,height:915}]]){
  test(`${label}: [다시]가 이번 달 한도(429 monthly_limit)로 거절되면 '확인하지 못했어요'가 아니라 한도 글 — 다시 눌러도 같다고 알린다`,async({page})=>{
    await page.setViewportSize(size);
    const {calls,band}=await open(page,{retry:()=>({http:429,body:{ok:false,code:'monthly_limit',error:'이번 달 녹음 전사 한도에 닿았어요.'}})});
    await band.getByRole('button',{name:'다시'}).click();
    await expect(band.locator('.rec-note')).toHaveText('이번 달 녹음 전사 한도에 닿았어요. 한도가 풀리기 전엔 [다시]도 같아요. 소리는 Drive에 남아 있어요.');
    await expect(band.locator('.rec-note')).not.toContainText('확인하지 못했어요');
    await shot(page,`monthly-limit-${size.width}`);
    expect(count(calls,'job_retry')).toBe(1);
    // 한 번 더 눌러도 같은 이유 글(뭉개지지 않음).
    await band.getByRole('button',{name:'다시'}).click();
    await expect.poll(()=>count(calls,'job_retry')).toBe(2);
    await expect(band.locator('.rec-note')).toContainText('이번 달 녹음 전사 한도에 닿았어요.');
  });
}

test('PC: 다른 거절 이유도 그 이유 글로 — 준비 중(503 not_ready)·작업 없음(404 not_found, [다시] 없음)',async({page})=>{
  await page.setViewportSize({width:1280,height:800});
  let n=0;
  const {band}=await open(page,{retry:()=>++n===1?{http:503,body:{ok:false,code:'not_ready',error:'녹음 전사는 준비 중이에요.'}}:{http:404,body:{ok:false,code:'not_found',error:'전사 작업을 찾지 못했어요.'}}});
  await band.getByRole('button',{name:'다시'}).click();
  await expect(band.locator('.rec-note')).toHaveText('녹음 전사는 준비 중이에요. 준비가 끝나기 전엔 [다시]도 같아요. 소리는 Drive에 남아 있어요.');
  await band.getByRole('button',{name:'다시'}).click();
  await expect(band.locator('.rec-note')).toHaveText('정리 작업을 찾지 못했어요. 삭제한 녹음일 수 있어요.');
  await expect(band.getByRole('button',{name:'다시'})).toHaveCount(0);
});

for(const [label,size] of [['PC 1280',{width:1280,height:800}],['폰 412',{width:412,height:915}]]){
  test(`${label}: 잠깐 끊김이면 '확인하지 못했어요 · 연결되면 저절로' → 연결이 돌아오면 [다시] 없이 다시 확인해 결과를 연다`,async({page})=>{
    await page.setViewportSize(size);
    const {calls,band}=await open(page,{retry:()=>'abort',read:()=>doneJob});
    await band.getByRole('button',{name:'다시'}).click();
    await expect(band.locator('.rec-note')).toHaveText('연결이 끊겨 정리 상태를 확인하지 못했어요. 연결되면 저절로 다시 확인해요.');
    await shot(page,`offline-${size.width}`);
    expect(count(calls,'job_read')).toBe(0);
    await page.evaluate(()=>window.dispatchEvent(new Event('online')));
    // 다시 하기(job_retry)가 아니라 읽기(job_read)만 — 끝난 작업이면 결과를 연다.
    await expect.poll(()=>count(calls,'job_read'),{timeout:15000}).toBeGreaterThan(0);
    expect(count(calls,'job_retry')).toBe(1);
    await expect(page.locator('#meetingModal')).toBeVisible({timeout:20000});
    await expect(page.locator('#meetingNotes')).toHaveValue(/서버가 정리한 전사 전문입니다/);
  });
}

test('PC: 끝난 작업이면 [다시]가 결과를 연다 — 결과 열기가 실패하면 \'상태 확인 실패\'가 아니라 \'정리 끝 · 초안을 열지 못했어요 [초안 열기]\'',async({page})=>{
  await page.setViewportSize({width:1280,height:800});
  const {calls,band}=await open(page,{retry:()=>doneJob});
  // 결과 열기 길(사업 보고 화면 불러오기)이 실패하도록.
  await page.evaluate(()=>{
    const fail=()=>Promise.reject(new Error('load failed'));
    if(window.KPTUDeferredFeatures)window.KPTUDeferredFeatures.loadView=fail;
    if(window.KPTUViewLoader)window.KPTUViewLoader.load=fail;
  });
  await band.getByRole('button',{name:'다시'}).click();
  await expect(band.locator('.rec-label')).toHaveText('정리 끝');
  await expect(band.locator('.rec-note')).toHaveText('정리는 끝났는데 초안을 열지 못했어요. [초안 열기]를 다시 누르세요.');
  await expect(band.getByRole('button',{name:'초안 열기'})).toBeVisible();
  await expect(band).toHaveClass(/rec-why/,'이유 글은 두 줄까지 보인다');
  await shot(page,'open-failed-1280');
  expect(count(calls,'job_retry')).toBe(1);
});
