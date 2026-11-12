// REC-초안버리기(S60-20): 정리 끝 띠 [초안 열기] [삭제] → 한 번 묻기 → 서버 job_discard → 띠 사라짐 + 작은 알림 [되돌리기](job_restore).
// 버린 결과는 job_list에서 빠지므로(가짜 서버도 같은 규칙) 다시 열어도 띠가 뜨지 않는다. 폰 알림 '회의 요약' 기록도 '열었음'(phone-push opened).
// 화면 사진: KPTU_SHOTS=1이면 docs/design/screens/s60-20/ (PC 1280 · 폰 412).
import {test,expect} from '@playwright/test';
import {signInWithSession} from './helpers/session-login.mjs';
import {appOrigin} from './helpers/test-origin.mjs';

test.use({timezoneId:'Asia/Seoul'});

const BASE=appOrigin;
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const JOB='00000000-0000-4000-8000-0000000000b1';
const SHOTS=process.env.KPTU_SHOTS==='1';
const shot=async(page,name)=>{if(SHOTS){await page.waitForTimeout(250);await page.screenshot({path:`docs/design/screens/s60-20/${name}.png`})}};

async function mock(page){
  const calls=[],server={discarded:false};
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
    if(path==='/functions/v1/phone-push'){calls.push({fn:'push',action:url.searchParams.get('action'),body});return ok({ok:true,items:[]})}
    if(path==='/functions/v1/meeting-transcribe'){
      const action=url.searchParams.get('action');
      calls.push({fn:'rec',action,body});
      if(action==='rec_pending')return ok({ok:true,sessions:[],live:[]});
      if(action==='config')return ok({ok:true,ready:true});
      const job={id:JOB,kind:'recording',status:'done',stage:'done',session_id:'00000000-0000-4000-8000-0000000000a1',created_at:'2026-11-12T05:00:00Z',
        finished_at:'2026-11-12T05:30:00Z',seconds:1500,jobs:[],parts_done:1,parts_total:1,step_no:1,step_total:1,opened_at:null,discarded:server.discarded};
      if(action==='job_list')return ok({ok:true,jobs:server.discarded?[]:[job]});
      if(action==='job_discard'){server.discarded=true;return ok({ok:true})}
      if(action==='job_restore'){server.discarded=false;return ok({ok:true})}
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
const rec=(calls,action)=>calls.filter(c=>c.fn==='rec'&&c.action===action);

for(const [label,size] of [['pc-1280',{width:1280,height:800}],['phone-412',{width:412,height:915}]]){
  test(`정리 끝 띠 [삭제] → 묻기 → 버리면 띠가 사라지고 다시 열어도 안 뜸, [되돌리기]로 다시 뜸 (${label})`,async({page})=>{
    await page.setViewportSize(size);
    const {calls,server}=await mock(page);
    await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(`${BASE}/app/?view=reports`)}`);
    await signInWithSession(page,'rec@example.org');
    const band=page.locator('#recBand');
    await expect(band.locator('.rec-label')).toHaveText('정리 끝',{timeout:15000});
    await expect(band.locator('.rec-actions button')).toHaveText(['초안 열기','삭제']);
    await shot(page,`${label}-1-band`);

    // [취소]면 아무것도 바뀌지 않는다.
    await band.getByRole('button',{name:'삭제'}).click();
    const ask=page.locator('.kptu-ask');
    await expect(ask.locator('.kptu-ask-text')).toHaveText('이 초안을 삭제할까요?');
    await expect(ask.locator('.kptu-ask-note')).toHaveText('녹음 소리는 Drive에 남아요.');
    await expect(ask.locator('.kptu-ask-actions button')).toHaveText(['취소','삭제']);
    await shot(page,`${label}-2-ask`);
    await ask.getByRole('button',{name:'취소'}).click();
    await expect(ask).toHaveCount(0);
    await expect(band.locator('.rec-label')).toHaveText('정리 끝');
    expect(rec(calls,'job_discard')).toEqual([]);

    // [삭제] → 서버 버림 → 띠 사라짐 + 알림 [되돌리기] → 되돌리면 띠가 다시.
    await band.getByRole('button',{name:'삭제'}).click();
    await ask.getByRole('button',{name:'삭제'}).click();
    await expect(band).toBeHidden();
    const notice=page.locator('#kptuNotice:not([hidden])');
    await expect(notice.locator('.kptu-notice-text')).toHaveText('25분 녹음 초안을 삭제했어요');
    await shot(page,`${label}-3-notice`);
    expect(rec(calls,'job_discard').map(c=>c.body)).toEqual([{job_id:JOB}]);
    await expect.poll(()=>calls.filter(c=>c.fn==='push'&&c.action==='opened').map(c=>c.body)).toEqual([{kind:'meeting_done',ref_key:'d2026-11-12'}]);
    expect(rec(calls,'job_opened')).toEqual([]); // '열었음'과 섞지 않음
    await notice.getByRole('button',{name:'되돌리기'}).click();
    await expect.poll(()=>rec(calls,'job_restore').map(c=>c.body)).toEqual([{job_id:JOB}]);
    await expect(band.locator('.rec-label')).toHaveText('정리 끝');
    expect(server.discarded).toBe(false);

    // 다시 버리고 앱을 다시 열면 띠가 뜨지 않는다(서버 job_list가 뺌).
    await band.getByRole('button',{name:'삭제'}).click();
    await ask.getByRole('button',{name:'삭제'}).click();
    await expect(band).toBeHidden();
    expect(server.discarded).toBe(true);
    const lists=rec(calls,'job_list').length;
    await page.reload();
    await expect.poll(()=>rec(calls,'job_list').length,{timeout:15000}).toBeGreaterThan(lists);
    await page.waitForTimeout(500);
    await expect(band).toBeHidden();
  });
}
