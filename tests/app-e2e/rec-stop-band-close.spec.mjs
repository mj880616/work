// REC-멈춤띠계속뜸(S60-26): 멈춤 띠 [닫기] → 서버 job_discard('닫음' 표시) → 띠 사라짐 + 작은 알림 [되돌리기](job_restore).
// 닫은 멈춤은 job_list에 discarded로 오므로(가짜 서버도 같은 규칙) 다시 열어도 띠에 뜨지 않고, 사업 보고 위 녹음 줄 [다시](job_retry)로만 보인다.
// 화면 사진: KPTU_SHOTS=1이면 docs/design/screens/s60-26/ (PC 1280 · 폰 412).
import {test,expect} from '@playwright/test';
import {signInWithSession} from './helpers/session-login.mjs';
import {appOrigin} from './helpers/test-origin.mjs';

test.use({timezoneId:'Asia/Seoul'});

const BASE=appOrigin;
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const JOB='00000000-0000-4000-8000-0000000000c1';
const SHOTS=process.env.KPTU_SHOTS==='1';
const shot=async(page,name)=>{if(SHOTS){await page.waitForTimeout(250);await page.screenshot({path:`docs/design/screens/s60-26/${name}.png`})}};

async function mock(page){
  const calls=[],server={closed:false,status:'failed'};
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'rec-access',refresh_token:'rec-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'rec-user'}});
    if(path==='/auth/v1/user')return ok({id:'rec-user',email:'rec@example.org',user_metadata:{display_name:'녹음 QA'}});
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'rec-ws',user_id:'rec-user',role:'owner',email:'rec@example.org',workspace:{id:'rec-ws',name:'QA Workspace'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'rec-ws',name:'QA Workspace'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:'rec-user',display_name:'녹음 QA'}]);
    const body=(()=>{try{return JSON.parse(req.postData()||'{}')}catch{return {}}})();
    if(path==='/functions/v1/meeting-transcribe'){
      const action=url.searchParams.get('action');
      calls.push({action,body});
      if(action==='rec_pending')return ok({ok:true,sessions:[],live:[]});
      if(action==='config')return ok({ok:true,ready:true});
      // 서버 jobView와 같은 모양: error_code는 멈춘 이유만, 닫았으면 discarded:true(실패일 때만).
      const job=()=>({id:JOB,kind:'recording',status:server.status,stage:'summary',session_id:'00000000-0000-4000-8000-0000000000a2',created_at:'2026-11-12T06:34:00Z',
        finished_at:'2026-11-12T06:40:00Z',seconds:1500,jobs:[],parts_done:1,parts_total:1,step_no:1,step_total:2,opened_at:null,
        error_code:server.status==='failed'?'daily_limit':null,discarded:server.status==='failed'&&server.closed});
      if(action==='job_list')return ok({ok:true,jobs:[job()]});
      if(action==='job_discard'){server.closed=true;return ok({ok:true})}
      if(action==='job_restore'){server.closed=false;return ok({ok:true})}
      // 녹음 줄 [다시]: 같은 이유로 또 멈춤 — 서버는 닫은 그대로(failedCode), 지금 보는 띠에만 보인다.
      if(action==='job_retry'||action==='job_read')return ok({ok:true,job:job()});
      return ok({ok:true});
    }
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path==='/functions/v1/google-tasks')return ok({tasks:[],needs_reconnect:false});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/')||path.startsWith('/functions/v1/'))return ok([]);
    return ok({});
  });
  return {calls,server};
}
const of=(calls,action)=>calls.filter(c=>c.action===action);

for(const [label,size] of [['pc-1280',{width:1280,height:800}],['phone-412',{width:412,height:915}]]){
  test(`멈춤 띠 [닫기] → 서버 닫음 → 다시 열어도 띠 안 뜸, 녹음 줄 [다시], [되돌리기] (${label})`,async({page})=>{
    await page.setViewportSize(size);
    const {calls,server}=await mock(page);
    await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(`${BASE}/app/?view=reports`)}`);
    await signInWithSession(page,'rec@example.org');
    const band=page.locator('#recBand'),line=page.locator('#recPendingLine');
    await expect(band.locator('.rec-label')).toHaveText('녹음 정리 멈춤',{timeout:15000});
    await expect(band.locator('.rec-actions button')).toHaveText(['다시','닫기']);
    await shot(page,`${label}-1-band`);

    // [닫기] → 서버 닫음 표시 → 띠 사라짐 + 알림 [되돌리기] → 되돌리면 띠가 다시.
    await band.getByRole('button',{name:'닫기'}).click();
    await expect(band).toBeHidden();
    await expect.poll(()=>of(calls,'job_discard').map(c=>c.body)).toEqual([{job_id:JOB}]);
    const notice=page.locator('#kptuNotice:not([hidden])');
    await expect(notice.locator('.kptu-notice-text')).toHaveText('멈춘 녹음 정리를 닫았어요. 사업 보고 위 녹음 줄에서 [다시] 할 수 있어요');
    await expect(line.locator('.rec-pending-text')).toHaveText('멈춘 녹음 정리 · 11/12 15:34 · 25분 · 오늘 AI 한도');
    await shot(page,`${label}-2-closed`);
    await notice.getByRole('button',{name:'되돌리기'}).click();
    await expect.poll(()=>of(calls,'job_restore').map(c=>c.body)).toEqual([{job_id:JOB}]);
    await expect(band.locator('.rec-label')).toHaveText('녹음 정리 멈춤');
    await expect(line).toBeHidden();
    expect(server.closed).toBe(false);

    // 다시 닫고 앱을 다시 열면 띠는 안 뜨고 녹음 줄에만 [다시].
    await band.getByRole('button',{name:'닫기'}).click();
    await expect(band).toBeHidden();
    await expect.poll(()=>server.closed).toBe(true);
    const lists=of(calls,'job_list').length;
    await page.reload();
    await expect.poll(()=>of(calls,'job_list').length,{timeout:15000}).toBeGreaterThan(lists);
    await expect(line.getByRole('button',{name:'다시'})).toBeVisible();
    await page.waitForTimeout(500);
    await expect(band).toBeHidden();
    await shot(page,`${label}-3-reopen-line`);

    // 녹음 줄 [다시] → job_retry(같은 작업) → 같은 이유로 또 멈추면 지금 보는 띠에만 보인다.
    await line.getByRole('button',{name:'다시'}).click();
    await expect.poll(()=>of(calls,'job_retry').map(c=>c.body.job_id)).toEqual([JOB]);
    await expect(band.locator('.rec-label')).toHaveText('녹음 정리 멈춤');
    await expect(line).toBeHidden();
  });
}
