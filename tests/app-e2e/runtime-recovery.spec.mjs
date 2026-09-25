import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

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

test('delayed refresh cannot restore a session cleared by another tab',async({page})=>{
  let releaseRefresh,refreshCalls=0;
  const released=new Promise(resolve=>{releaseRefresh=resolve});
  await page.route(`${SB}/auth/v1/token?grant_type=refresh_token`,async route=>{
    refreshCalls++;
    await released;
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({access_token:'stale-access',refresh_token:'stale-refresh',expires_in:3600})});
  });
  await loadRuntime(page,{...expiredSession(),user:{id:'user-1'}});
  await page.evaluate(()=>{window.__pendingRefresh=window.KPTURuntime.session.refresh()});
  await expect.poll(()=>refreshCalls).toBe(1);
  await page.evaluate(()=>window.KPTURuntime.session.write(null));
  releaseRefresh();
  const result=await page.evaluate(async()=>({refresh:await window.__pendingRefresh,session:window.KPTURuntime.session.read()}));
  expect(result).toEqual({refresh:false,session:null});
});

test('delayed refresh cannot overwrite a different account selected in another tab',async({page})=>{
  let releaseRefresh,refreshCalls=0;
  const released=new Promise(resolve=>{releaseRefresh=resolve});
  await page.route(`${SB}/auth/v1/token?grant_type=refresh_token`,async route=>{
    refreshCalls++;
    await released;
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({access_token:'stale-access',refresh_token:'stale-refresh',expires_in:3600,user:{id:'user-1'}})});
  });
  await loadRuntime(page,{...expiredSession(),user:{id:'user-1'}});
  await page.evaluate(()=>{window.__pendingRefresh=window.KPTURuntime.session.refresh()});
  await expect.poll(()=>refreshCalls).toBe(1);
  const replacement={access_token:'account-b-access',refresh_token:'account-b-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'user-2'}};
  await page.evaluate(value=>window.KPTURuntime.session.write(value),replacement);
  releaseRefresh();
  const result=await page.evaluate(async()=>({refresh:await window.__pendingRefresh,session:window.KPTURuntime.session.read()}));
  expect(result.refresh).toBe(false);
  expect(result.session).toEqual(replacement);
});

test('concurrent identical mutations are single-flight by default',async({page})=>{
  let mutationCalls=0;
  await page.route(`${SB}/rest/v1/app_spaces`,async route=>{
    mutationCalls++;
    await new Promise(r=>setTimeout(r,150));
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:'project-1'}])});
  });
  await loadRuntime(page,liveSession());
  const result=await page.evaluate(async()=>{
    const body={workspace_id:'workspace-1',name:'중복 저장 방지'};
    return Promise.all([
      window.KPTURuntime.api('/rest/v1/app_spaces',{method:'POST',body,prefer:'return=representation'}),
      window.KPTURuntime.api('/rest/v1/app_spaces',{method:'POST',body,prefer:'return=representation'})
    ]);
  });
  expect(mutationCalls).toBe(1);
  expect(result).toEqual([[{id:'project-1'}],[{id:'project-1'}]]);
});

test('concurrent authenticated GET requests share one in-flight request but do not become a response cache',async({page})=>{
  let calls=0;
  await page.route(`${SB}/rest/v1/dedupe`,async route=>{
    calls++;
    await new Promise(resolve=>setTimeout(resolve,80));
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({call:calls})});
  });
  await loadRuntime(page,liveSession());
  const first=await page.evaluate(async()=>{
    const [a,b]=await Promise.all([
      window.KPTURuntime.api('/rest/v1/dedupe'),
      window.KPTURuntime.api('/rest/v1/dedupe')
    ]);
    return {a,b};
  });
  expect(calls).toBe(1);
  expect(first.a).toEqual(first.b);
  await page.evaluate(()=>window.KPTURuntime.api('/rest/v1/dedupe'));
  expect(calls).toBe(2);
});

test('GET single-flight and boot context are isolated when the signed-in user changes',async({page})=>{
  let calls=0;
  await page.route(`${SB}/rest/v1/session-scope`,async route=>{
    calls++;
    await new Promise(resolve=>setTimeout(resolve,60));
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({call:calls})});
  });
  await loadRuntime(page,liveSession());
  const result=await page.evaluate(async()=>{
    const rt=window.KPTURuntime;
    rt.context.set({user:rt.session.read().user,membership:{role:'owner'},workspace:{id:'workspace-a'}});
    const first=rt.api('/rest/v1/session-scope');
    rt.session.write({access_token:'access-2',refresh_token:'refresh-2',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'user-2',email:'two@example.org'}});
    const contextAfterSwitch=rt.context.read();
    const second=rt.api('/rest/v1/session-scope');
    await Promise.all([first,second]);
    return {contextAfterSwitch,epoch:rt.session.epoch()};
  });
  expect(result.contextAfterSwitch).toBeNull();
  expect(result.epoch).toBeGreaterThan(0);
  expect(calls).toBe(2);
});

test('library mutations use the shared runtime recovery transport',async()=>{
  const source=readFileSync('app/library-upload.js','utf8');
  expect(source).toContain("if(window.KPTURuntime?.api)return window.KPTURuntime.api(path,{method,body,prefer})");
  expect(source).not.toContain("fetch(LU_SB+'/functions/v1/library-files'");
  expect(source).not.toContain("fetch(LU_SB+'/functions/v1/document-actions'");
  expect(source).not.toContain("fetch(LU_SB+'/auth/v1/user'");
});

test('page save is single-flight and prevents duplicate RPC submission',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/page-save-singleflight-fixture.html');
  await page.evaluate(()=>{const b=document.querySelector('#savePageBtn');b.click();b.click()});
  await expect.poll(()=>page.evaluate(()=>window.__saveCalls)).toBe(1);
  await expect(page.locator('#savePageBtn')).toBeDisabled();
  await expect(page.locator('#savePageBtn')).toHaveAttribute('aria-busy','true');
  await expect(page.locator('#editorStatus')).toHaveAttribute('role','status');
  await expect(page.locator('#editorStatus')).toHaveAttribute('aria-live','polite');
  await expect(page.locator('#editorStatus')).toContainText('저장했습니다.',{timeout:3000});
  await expect(page.locator('#savePageBtn')).toBeEnabled();
  await expect(page.locator('#savePageBtn')).not.toHaveAttribute('aria-busy');
});

test('page editor reconciles to the canonical server record after save',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/page-save-singleflight-fixture.html');
  await page.locator('#pageTitle').fill('클라이언트 제목');
  await page.locator('#pageSlug').fill('client-slug');
  await page.locator('#pageSummary').fill('클라이언트 요약');
  await page.locator('#pageBody').fill('클라이언트 본문');
  await page.locator('#savePageBtn').click();
  await expect(page.locator('#editorStatus')).toContainText('저장했습니다.',{timeout:3000});
  await expect(page.locator('#pageTitle')).toHaveValue('서버 기준 제목');
  await expect(page.locator('#pageSlug')).toHaveValue('server-canonical-slug');
  await expect(page.locator('#pageSummary')).toHaveValue('서버 기준 요약');
  await expect(page.locator('#pageBody')).toHaveValue('서버 기준 본문');
  await expect(page.locator('#pageStatus')).toHaveValue('published');
  await expect(page.locator('#pageVisibility')).toHaveValue('unlisted');
});

test('partial page save failure is explicit after the primary record is saved',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/page-save-singleflight-fixture.html');
  await page.evaluate(()=>{window.__failSecondary=true});
  await page.locator('#savePageBtn').click();
  await expect(page.locator('#editorStatus')).toContainText('본문은 저장됐지만 일부 부가설정 저장에 실패했습니다.',{timeout:3000});
  await expect(page.locator('#editorStatus')).toContainText('AI/디자인 설정: 설정 저장 실패');
  await expect(page.locator('#editorStatus')).toHaveAttribute('role','alert');
  await expect(page.locator('#editorStatus')).not.toHaveAttribute('aria-live');
  await expect(page.locator('#savePageBtn')).toBeEnabled();
  await expect(page.locator('#savePageBtn')).not.toHaveAttribute('aria-busy');
  await expect(page.locator('#pageTitle')).toHaveValue('서버 기준 제목');
});
