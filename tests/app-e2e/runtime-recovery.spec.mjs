import { test, expect } from '@playwright/test';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const liveSession=()=>({
  access_token:'old-access',refresh_token:'refresh-1',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)+3600
});
const expiredSession=()=>({
  access_token:'expired-access',refresh_token:'refresh-1',token_type:'bearer',expires_at:Math.floor(Date.now()/1000)-10
});

async function loadRuntime(page,session){
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/runtime-client-fixture.html');
  await page.evaluate(s=>window.KPTURuntime.session.write(s),session);
}

test('authenticated API retries once after 401 by refreshing the session',async({page})=>{
  let apiCalls=0,refreshCalls=0,secondAuth='';
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.pathname==='/auth/v1/token'&&url.searchParams.get('grant_type')==='refresh_token'){
      refreshCalls++;
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({access_token:'new-access',refresh_token:'refresh-2',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600})});
    }
    if(url.pathname==='/rest/v1/retry-me'){
      apiCalls++;
      if(apiCalls===1)return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({message:'JWT expired'})});
      secondAuth=req.headers().authorization||'';
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})});
    }
    return route.fulfill({status:404,body:'not found'});
  });
  await loadRuntime(page,liveSession());
  const result=await page.evaluate(()=>window.KPTURuntime.api('/rest/v1/retry-me'));
  expect(result).toEqual({ok:true});
  expect(apiCalls).toBe(2);
  expect(refreshCalls).toBe(1);
  expect(secondAuth).toBe('Bearer new-access');
});

test('timeout is isolated as a retryable runtime error',async({page})=>{
  await page.route(`${SB}/rest/v1/slow`,async route=>{
    await new Promise(r=>setTimeout(r,250));
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true})}).catch(()=>{});
  });
  await loadRuntime(page,liveSession());
  const result=await page.evaluate(async()=>{
    const started=performance.now();
    try{await window.KPTURuntime.api('/rest/v1/slow',{timeoutMs:50});return {ok:true,elapsed:performance.now()-started}}
    catch(e){return {ok:false,elapsed:performance.now()-started,name:e.name,code:e.code,status:e.status,retryable:e.retryable,message:e.message}}
  });
  expect(result.ok).toBe(false);
  expect(result.code).toBe('timeout');
  expect(result.retryable).toBe(true);
  expect(result.elapsed).toBeLessThan(200);
});

test('5xx response keeps status and retryability without clearing session',async({page})=>{
  await page.route(`${SB}/rest/v1/fail`,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'temporary outage'})}));
  await loadRuntime(page,liveSession());
  const result=await page.evaluate(async()=>{
    try{await window.KPTURuntime.api('/rest/v1/fail');return {ok:true}}
    catch(e){return {ok:false,code:e.code,status:e.status,retryable:e.retryable,message:e.message,hasSession:!!window.KPTURuntime.session.read()}}
  });
  expect(result).toMatchObject({ok:false,status:503,retryable:true,hasSession:true});
  expect(result.message).toContain('temporary outage');
});

test('transient refresh failure preserves session and reports retryable session error',async({page})=>{
  await page.route(`${SB}/auth/v1/token?grant_type=refresh_token`,route=>route.abort('failed'));
  await loadRuntime(page,expiredSession());
  const result=await page.evaluate(async()=>{
    try{await window.KPTURuntime.api('/rest/v1/anything');return {ok:true}}
    catch(e){return {ok:false,code:e.code,status:e.status,retryable:e.retryable,hasSession:!!window.KPTURuntime.session.read(),message:e.message}}
  });
  expect(result).toMatchObject({ok:false,code:'session_refresh_failed',retryable:true,hasSession:true});
});

test('page save is single-flight and prevents duplicate RPC submission',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/page-save-singleflight-fixture.html');
  await page.evaluate(()=>{const b=document.querySelector('#savePageBtn');b.click();b.click()});
  await expect.poll(()=>page.evaluate(()=>window.__saveCalls)).toBe(1);
  await expect(page.locator('#savePageBtn')).toBeDisabled();
  await expect(page.locator('#editorStatus')).toContainText('저장했습니다.',{timeout:3000});
  await expect(page.locator('#savePageBtn')).toBeEnabled();
});
