import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {runInNewContext} from 'node:vm';

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
  const start=source.indexOf('async function luApi('),end=source.indexOf('\nfunction luEsc(',start);
  expect(start).toBeGreaterThanOrEqual(0);expect(end).toBeGreaterThan(start);
  const calls=[],api=runInNewContext(source.slice(start,end)+';luApi',{
    window:{KPTURuntime:{api:(path,options)=>{calls.push({path,options});return 'shared-runtime'}}},
    fetch:()=>{throw new Error('direct fetch bypassed runtime')}
  });
  const body={title:'scope transport'},options={method:'PATCH',body,prefer:'return=representation',expectedSessionEpoch:0,singleFlight:false};
  expect(await api('/rest/v1/app_documents?id=eq.fixture',options)).toBe('shared-runtime');
  expect(calls[0].path).toBe('/rest/v1/app_documents?id=eq.fixture');
  expect(calls[0].options).toEqual(options);expect(calls[0].options.body).toBe(body);
  expect(await api('/rest/v1/app_documents')).toBe('shared-runtime');
  expect(calls[1].options).toEqual({method:'GET',body:null,prefer:'',expectedSessionEpoch:null,singleFlight:true});
  expect(source).not.toContain("fetch(LU_SB+'/functions/v1/library-files'");
  expect(source).not.toContain("fetch(LU_SB+'/functions/v1/document-actions'");
  expect(source).not.toContain("fetch(LU_SB+'/auth/v1/user'");
});

const ownerSession=(id,{expired=false}={})=>({access_token:'synthetic-'+id,refresh_token:'synthetic-refresh-'+id,expires_at:Math.floor(Date.now()/1000)+(expired?-10:3600),user:{id}});
for(const phase of ['before-ensure','before-401-refresh','during-refresh','before-retry','after-success'])test(`save call context rejects session change ${phase}`,async({page})=>{
 let calls=0,refreshes=0,release;const gate=new Promise(r=>release=r),state={replacement:false,otherRequests:0};
 await page.route(`${SB}/**`,async route=>{
  const u=new URL(route.request().url());
  if(u.pathname==='/auth/v1/token'){refreshes++;if(phase==='during-refresh')await gate;const id=phase==='before-401-refresh'?'owner-b':'owner-a';return route.fulfill({json:{...ownerSession(id),access_token:'synthetic-refreshed-'+id}});}
  calls++;if(route.request().headers().authorization==='Bearer synthetic-refreshed-owner-b'||route.request().headers().authorization==='Bearer synthetic-owner-b')state.otherRequests++;
  if(calls===1&&['before-401-refresh','after-success'].includes(phase))await gate;
  return route.fulfill({status:calls===1&&!['before-ensure','after-success'].includes(phase)?401:200,json:{ok:true}});
 });
 await loadRuntime(page,ownerSession('owner-a'));
 if(phase==='before-ensure'){
  const result=await page.evaluate(async()=>{const rt=window.KPTURuntime,epoch=rt.session.epoch();rt.session.write({access_token:'synthetic-owner-b',refresh_token:'synthetic-refresh-owner-b',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'owner-b'}});try{await rt.api('/rest/v1/guarded-save',{method:'POST',body:{title:'draft-a'},expectedSessionEpoch:epoch});return {ok:true}}catch(e){return {code:e.code}}});expect(result.code).toBe('session_changed');expect(calls).toBe(0);return;
 }
 if(phase==='before-retry')await page.evaluate(()=>{window.addEventListener('kptu:session-changed',e=>{if(e.detail?.session?.access_token==='synthetic-refreshed-owner-a')window.KPTURuntime.session.write({access_token:'synthetic-owner-b',refresh_token:'synthetic-refresh-owner-b',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'owner-b'}})})});
 await page.evaluate(()=>{const rt=window.KPTURuntime;window.__guardedSave=rt.api('/rest/v1/guarded-save',{method:'POST',body:{title:'draft-a'},expectedSessionEpoch:rt.session.epoch()}).then(()=>({ok:true}),e=>({code:e.code}))});
 if(phase!=='before-retry'){
  await expect.poll(()=>phase==='during-refresh'?refreshes:calls).toBe(1);
  await page.evaluate(s=>window.KPTURuntime.session.write(s),ownerSession('owner-b'));release();
 }
 const result=await page.evaluate(async()=>await window.__guardedSave);console.info('save-context observation',JSON.stringify({phase,calls,refreshes,otherRequests:state.otherRequests,resultCode:result.code||'success'}));expect(result.code).toBe('session_changed');expect(calls).toBe(1);expect(state.otherRequests).toBe(0);
});
test('guarded same-owner 401 refresh retains the normal authenticated retry',async({page})=>{
 let calls=0,refreshes=0;
 await page.route(`${SB}/**`,r=>{if(new URL(r.request().url()).pathname==='/auth/v1/token'){refreshes++;return r.fulfill({json:{...ownerSession('owner-a'),access_token:'synthetic-refreshed-owner-a'}})}calls++;return r.fulfill({status:calls===1?401:200,json:{ok:true}})});
 await loadRuntime(page,ownerSession('owner-a'));const result=await page.evaluate(()=>{const rt=window.KPTURuntime;return rt.api('/rest/v1/guarded-save',{method:'POST',body:{title:'draft-a'},expectedSessionEpoch:rt.session.epoch()})});expect(result).toEqual({ok:true});expect(calls).toBe(2);expect(refreshes).toBe(1);
});
test('guarded save rejects logout and same-owner login as a new session',async({page})=>{
 let calls=0,release;const gate=new Promise(r=>release=r);await page.route(`${SB}/**`,async r=>{if(new URL(r.request().url()).pathname==='/auth/v1/token')return r.fulfill({json:ownerSession('owner-a')});calls++;if(calls===1)await gate;return r.fulfill({status:calls===1?401:200,json:{ok:true}})});await loadRuntime(page,ownerSession('owner-a'));await page.evaluate(()=>{const rt=window.KPTURuntime;window.__guardedSave=rt.api('/rest/v1/guarded-save',{method:'POST',body:{title:'draft-a'},expectedSessionEpoch:rt.session.epoch()}).then(()=>({ok:true}),e=>({code:e.code}))});await expect.poll(()=>calls).toBe(1);await page.evaluate(s=>{window.KPTURuntime.session.write(null);window.KPTURuntime.session.write(s)},ownerSession('owner-a'));release();const result=await page.evaluate(async()=>await window.__guardedSave);expect(result.code).toBe('session_changed');expect(calls).toBe(1);
});
for(const method of ['POST','GET'])test(`guarded ${method} does not join an unguarded flight`,async({page})=>{
 let calls=0,release;const gate=new Promise(r=>release=r);await page.route(`${SB}/rest/v1/context-flight`,async r=>{calls++;await gate;return r.fulfill({json:{ok:true}})});await loadRuntime(page,ownerSession('owner-a'));
 await page.evaluate(method=>{const rt=window.KPTURuntime,o={method,...(method==='POST'?{body:{title:'draft-a'}}:{})};window.__defaultFlight=rt.api('/rest/v1/context-flight',o);window.__guardedFlight=rt.api('/rest/v1/context-flight',{...o,expectedSessionEpoch:rt.session.epoch()})},method);
 try{await expect.poll(()=>calls).toBe(2)}finally{release()}
 await page.evaluate(async()=>await Promise.all([window.__defaultFlight,window.__guardedFlight]));
});

test('guarded identical calls still share one guarded request',async({page})=>{
 let calls=0;await page.route(`${SB}/rest/v1/context-flight`,r=>{calls++;return r.fulfill({json:{ok:true}})});await loadRuntime(page,ownerSession('owner-a'));const result=await page.evaluate(()=>{const rt=window.KPTURuntime,o={method:'POST',body:{title:'draft-a'},expectedSessionEpoch:rt.session.epoch()};return Promise.all([rt.api('/rest/v1/context-flight',o),rt.api('/rest/v1/context-flight',o)])});expect(result).toEqual([{ok:true},{ok:true}]);expect(calls).toBe(1);
});
test('session changes during initial ensure reject before the save dispatch',async({page})=>{
 let writes=0,refreshes=0,release;const gate=new Promise(r=>release=r);await page.route(`${SB}/**`,async r=>{if(new URL(r.request().url()).pathname==='/auth/v1/token'){refreshes++;await gate;return r.fulfill({json:ownerSession('owner-a')})}writes++;return r.fulfill({json:{ok:true}})});await loadRuntime(page,ownerSession('owner-a',{expired:true}));await page.evaluate(()=>{const rt=window.KPTURuntime;window.__guardedSave=rt.api('/rest/v1/context-flight',{method:'POST',body:{title:'draft-a'},expectedSessionEpoch:rt.session.epoch()}).then(()=>({ok:true}),e=>({code:e.code}))});await expect.poll(()=>refreshes).toBe(1);await page.evaluate(s=>window.KPTURuntime.session.write(s),ownerSession('owner-b'));release();const result=await page.evaluate(async()=>await window.__guardedSave);expect(result.code).toBe('session_changed');expect(writes).toBe(0);
});
