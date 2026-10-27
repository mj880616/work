import {closeMeetingResult,openMeetingResult} from './helpers/meeting-open.mjs';
import { appOrigin } from './helpers/test-origin.mjs';
import {expandLibraryTree,revealLibraryRow} from './helpers/library-tree.mjs';
import { test, expect } from '@playwright/test';
import {showAllLibraryCategories} from './helpers/library-categories.mjs';
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
  await page.goto(`${appOrigin}/tests/app-e2e/runtime-client-fixture.html`);
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
  const body={title:'scope transport'},options={method:'PATCH',body,prefer:'return=representation',expectedSessionEpoch:0,singleFlight:false,refreshSession:false};
  expect(await api('/rest/v1/app_documents?id=eq.fixture',options)).toBe('shared-runtime');
  expect(calls[0].path).toBe('/rest/v1/app_documents?id=eq.fixture');
  expect(calls[0].options).toEqual(options);expect(calls[0].options.body).toBe(body);
  expect(await api('/rest/v1/app_documents')).toBe('shared-runtime');
  expect(calls[1].options).toEqual({method:'GET',body:null,prefer:'',expectedSessionEpoch:null,singleFlight:true,refreshSession:true});
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

// Consumer lifecycle probes compose actual runtime/router/a11y/modules and app
// DOM in the existing runtime fixture. Shell Auth bootstrap is excluded because
// its independent identity listener navigates away on B/null snapshots.
const DELETE_UNKNOWN='삭제 결과를 확인하지 못했습니다. 다시 삭제하지 말고 자료실 목록 또는 사업 보고 자료를 다시 열어 확인해 주세요. Drive 원본 상태도 직접 확인해 주세요.';
const DELETE_LEGACY='자료 등록을 삭제했습니다. Drive 파일 처리 결과는 확인하지 못했습니다. 원본 상태를 직접 확인해 주세요.';
const DELETE_DRIVE='Google Drive 연결을 확인해 주세요. 다시 삭제하기 전에 자료 목록과 원본 상태를 먼저 확인해 주세요.';
const appMarkup=readFileSync(new URL('../../app/index.html',import.meta.url),'utf8');
const helperSource=readFileSync(new URL('../../app/document-delete.js',import.meta.url),'utf8');
const librarySource=readFileSync(new URL('../../app/library-upload.js',import.meta.url),'utf8');
const meetingSource=readFileSync(new URL('../../app/meeting-round-detail.js',import.meta.url),'utf8');
const consumerStates=new WeakMap();
test.afterEach(async({page})=>{const state=consumerStates.get(page);if(state)for(const key of ['lookupGate','deleteGate','driveGate'])state[key]?.release()});
const fixtureSession=()=>({...liveSession(),user:{id:'owner'}});
function gate(){let release;const promise=new Promise(resolve=>release=resolve);return {promise,release}}
async function deleteConsumerFixture(page,view,width=390,{holdImport=false}={}){
  await page.setViewportSize({width,height:900});
  const state={docs:[0,1].map(i=>({id:'doc-'+i,workspace_id:'ws',meeting_id:'meeting-1',title:'자료 '+i,file_name:'file-'+i+'.pdf',tags:[],category:'회의자료'})),calls:[],driveCalls:0,uploadCalls:0,refreshes:0,deleteGate:null,lookupGate:null,driveGate:null,status:200,driveStatus:200,lookupStatus:200,result:{ok:true},lookupRow:null,options:[],pageErrors:[],oauthRequests:0,oauthNavigations:0,settled:false};
  consumerStates.set(page,state);
  // Settlement lives in the runner so a real native OAuth navigation cannot
  // erase the observation by replacing the old document's execution context.
  await page.exposeBinding('__observeDeleteSettlement',(_source,settled,cacheIds)=>{state.settled=settled;if(cacheIds)state.settlementCacheIds=cacheIds});
  state.cdp=await page.context().newCDPSession(page);await state.cdp.send('Page.enable');
  state.cdp.on('Page.frameRequestedNavigation',e=>{if(e.url.includes('delete-oauth=1'))state.oauthNavigations++});
  page.on('pageerror',e=>state.pageErrors.push(e.message));
  page.on('request',req=>{if(req.url().includes('library-open-fixture.html?delete-oauth=1'))state.oauthRequests++});
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    if(path==='/auth/v1/token'){state.refreshes++;return route.fulfill({json:fixtureSession()})}
    if(path==='/rest/v1/app_documents'){
      const id=url.searchParams.get('id')?.replace(/^eq\./,''),mid=url.searchParams.get('meeting_id')?.replace(/^eq\./,'');
      if(id&&state.lookupGate){state.lookupStarted=true;await state.lookupGate.promise}
      if(id&&state.lookupStatus!==200)return route.fulfill({status:state.lookupStatus,json:{message:'controlled lookup failure'}});
      return route.fulfill({json:id&&state.lookupRow?[state.lookupRow]:state.docs.filter(d=>(!id||d.id===id)&&(!mid||d.meeting_id===mid))});
    }
    if(path==='/rest/v1/app_meetings')return route.fulfill({json:[{id:'meeting-1',workspace_id:'ws',title:'회의',series_name:'회의',transcript_text:'기존 회의 원문',created_by:'owner'}]});
    if(path==='/functions/v1/document-actions'){
      state.calls.push(req.postDataJSON());if(state.deleteGate)await state.deleteGate.promise;
      return route.fulfill({status:state.status,json:state.result});
    }
    if(path==='/functions/v1/public-policy-drive'){
      state.driveCalls++;if(state.driveGate)await state.driveGate.promise;
      return route.fulfill({status:state.driveStatus,json:state.driveStatus===200?{url:`${appOrigin}/tests/app-e2e/library-open-fixture.html?delete-oauth=1`}:{error:'controlled reconnect failure'}});
    }
    if(path==='/functions/v1/library-files'){state.uploadCalls++;return route.fulfill({status:400,json:{error:'invalid_grant'}})}
    if(path==='/functions/v1/google-tasks')return route.fulfill({json:{tasks:[]}});
    return route.fulfill({json:[]});
  });
  await page.route('**/library-open-fixture.html?delete-oauth=1',async route=>{return route.fulfill({contentType:'text/html',body:'<p>Controlled OAuth target</p>'})});
  // The cache-clear/settlement hooks observe existing calls; they contain no
  // product deletion logic and are never served outside this routed test.
  await page.route('**/app/library-upload.js',route=>route.fulfill({contentType:'text/javascript',body:librarySource+`;window.__clearDeleteCache=()=>{luDocuments=[]};window.__fixtureLibraryRows=()=>luDocuments;const observedDelete=luDeleteDocument;luDeleteDocument=async(...args)=>{await window.__observeDeleteSettlement(false);try{return await observedDelete(...args)}finally{await window.__observeDeleteSettlement(true,luDocuments.map(row=>row.id))}};`}));
  await page.route('**/app/meeting-round-detail.js',route=>route.fulfill({contentType:'text/javascript',body:meetingSource+`;const observedMaterials=mrdRenderMaterials;mrdRenderMaterials=docs=>{window.__fixtureMaterialRows=docs;return observedMaterials(docs)};`}));
  if(holdImport)await page.route('**/app/document-delete.js*',route=>route.fulfill({contentType:'text/javascript',body:`window.__helperImportStarted=true;await new Promise(resolve=>window.__releaseHelperImport=resolve);${helperSource}\nwindow.__helperImportSettled=true;`}));
  await loadRuntime(page,fixtureSession());
  await page.evaluate(({markup,view})=>{
    const parsed=new DOMParser().parseFromString(markup,'text/html');document.body.replaceChildren(...parsed.body.childNodes);
    const base=document.createElement('base');base.href='/app/';document.head.prepend(base);
    document.body.className='';document.documentElement.dataset.theme='olive';
    const app=document.querySelector('#appView');app.classList.remove('hidden');app.classList.add('kptu-ui-ready');app.inert=false;
    window.KPTURuntime.context.set({user:{id:'owner'},workspace:{id:'ws'},membership:{role:'owner'}});
    history.replaceState({},'',location.pathname+'?view='+view);
    window.__deleteEvents=0;window.addEventListener('kptu:documents-changed',()=>window.__deleteEvents++);
    const api=window.KPTURuntime.api;window.__deleteOptions=[];
    window.__driveOptions=[];
    window.KPTURuntime.api=(path,opts)=>{if(path.endsWith('document-actions'))window.__deleteOptions.push(opts);if(path.endsWith('public-policy-drive'))window.__driveOptions.push(opts);return api(path,opts)};
  },{markup:appMarkup,view});
  for(const name of ['styles','library-upload','filter-chips','meeting-ui'])await page.addStyleTag({url:'/app/'+name+'.css'});
  await page.addScriptTag({url:'/app/accessibility-dialog.js'});await page.addScriptTag({url:'/app/app-router.js'});
  await page.evaluate(async view=>{
    window.KPTURouter.go(view,{updateUrl:false});
    await import('/app/library-upload.js');await window.__KPTU_LIBRARY_UPLOAD_READY__;
    await import('/app/meeting-round-detail.js');await window.__KPTU_MEETING_ROUND_DETAIL_READY__;
    document.querySelector('#meetingList').innerHTML='<article data-mrd-meeting="meeting-1" role="button" tabindex="0">회의</article>';
  },view);
  // UI-바구니거르기: meeting documents list with the rest in the library (no [회의자료만] row).
  if(view!=='library'){await page.locator('[data-mrd-meeting="meeting-1"]').click();await expect(page.locator('#mrdMaterials .mrd-file-row')).toHaveCount(2)}
  else{await showAllLibraryCategories(page);await expandLibraryTree(page)}// UI-PC자료실: 자료실은 기본으로 [회의]가 꺼져 있어 회의자료 분류 자료를 보려면 켠다. LIB-토글트리: 토글을 모두 편다.
  expect(await page.evaluate(()=>({owner:window.KPTURuntime.session.read()?.user?.id,token:!!window.KPTURuntime.session.read()?.access_token,ctx:window.KPTURuntime.context.read()?.workspace?.id,view:window.KPTURouter.current}))).toEqual({owner:'owner',token:true,ctx:'ws',view});
  return state;
}
function consumerDialogs(page,{reconnect=false}={}){
  const seen=[];
  page.on('dialog',async d=>{
    seen.push({type:d.type(),message:d.message()});
    if(d.type()==='confirm'){
      expect(d.message()).toMatch(reconnect?/자료 등록을 삭제할까요\?|Google Drive 연결이 만료됐습니다/:/자료 등록을 삭제할까요\?/);
      await d.accept();
    }else{expect(d.type()).toBe('alert');await d.accept()}
  });
  return seen;
}
async function startConsumerDelete(page,view,id='doc-0'){
  if(view==='library'){
    await page.locator(`[data-lu-menu="${id}"]`).click();await page.locator(`[data-lu-delete="${id}"]`).click();
  }else{
    await page.evaluate(id=>{
      const b=document.querySelector(`[data-mrd-delete-document="${id}"]`),handler=b.onclick;
      b.onclick=async e=>{await window.__observeDeleteSettlement(false);try{return await handler(e)}finally{await window.__observeDeleteSettlement(true)}};
    },id);
    await page.locator(`[data-mrd-delete-document="${id}"]`).click();
  }
}
async function settleConsumer(page){await expect.poll(()=>consumerStates.get(page).settled).toBe(true)}
async function settleOrOAuth(page){
  const state=consumerStates.get(page);
  await expect.poll(()=>state.settled||state.oauthNavigations>0||state.oauthRequests>0).toBe(true);
}
async function releaseImport(page){await page.evaluate(()=>window.__releaseHelperImport());await settleConsumer(page)}
async function observedSession(page,change){
  await page.evaluate(change=>{
    const rt=window.KPTURuntime,key=rt.config.sessionKey,s=rt.session.read();
    const bad=change.includes('null')?null:change.includes('empty')?{...s,access_token:''}:{...s,user:{id:'other-owner'}};
    const write=value=>value?localStorage.setItem(key,JSON.stringify(value)):localStorage.removeItem(key);
    if(change.startsWith('snapshot'))window.dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:bad,epoch:rt.session.epoch()}}));
    else{write(bad);window.dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:bad,epoch:rt.session.epoch()}}));write(s)}
    // Restore the router via its actual accepted route API; scope/epoch/context
    // did not change because this probe never calls runtime.session.write.
    window.KPTURouter.go(new URLSearchParams(location.search).get('view'),{source:'session',updateUrl:false});
  },change);
}
async function actualAwayBack(page,view){
  await page.evaluate(view=>{window.__routeTrace=[];const record=e=>window.__routeTrace.push(e.detail);window.addEventListener('kptu:view-changed',record);window.KPTURouter.go('home',{updateUrl:false});window.KPTURouter.go(view,{updateUrl:false});window.removeEventListener('kptu:view-changed',record)},view);
  expect(await page.evaluate(()=>window.__routeTrace.map(e=>e.view))).toEqual(['home',view]);
}

for(const width of [390,1280])for(const view of ['library','meetings']){
  for(const changed of ['owner','null','empty token'])test(`delete lifecycle entry refuses actual ${changed} with unchanged context ${view} ${width}`,async({page})=>{
    const state=await deleteConsumerFixture(page,view,width),seen=consumerDialogs(page);
    await page.evaluate(changed=>{const rt=window.KPTURuntime,s=rt.session.read();if(changed==='null')localStorage.removeItem(rt.config.sessionKey);else localStorage.setItem(rt.config.sessionKey,JSON.stringify(changed==='owner'?{...s,user:{id:'other-owner'}}:{...s,access_token:''}))},changed);
    await startConsumerDelete(page,view);await settleConsumer(page);
    expect(state.calls).toEqual([]);expect(seen.some(d=>d.type==='confirm')).toBe(false);
    expect(await page.evaluate(()=>window.__deleteEvents)).toBe(0);
    expect(seen.map(d=>d.message)).toEqual(['로그인 세션을 확인하지 못했습니다. 다시 로그인한 뒤 자료 목록과 원본 상태를 먼저 확인해 주세요.']);
  });
  for(const changed of ['owner','null','empty token','snapshot owner','snapshot null','snapshot empty token'])test(`delete lifecycle import observed ${changed} restoration stays cancelled ${view} ${width}`,async({page})=>{
    const state=await deleteConsumerFixture(page,view,width,{holdImport:true}),seen=consumerDialogs(page);
    await startConsumerDelete(page,view);await page.waitForFunction(()=>window.__helperImportStarted);
    const before=await page.evaluate(()=>({epoch:window.KPTURuntime.session.epoch(),ctx:window.KPTURuntime.context.read()}));
    await observedSession(page,changed);await releaseImport(page);
    expect(state.calls).toEqual([]);expect(seen).toEqual([]);expect(state.oauthRequests).toBe(0);
    expect(await page.evaluate(()=>({epoch:window.KPTURuntime.session.epoch(),ctx:window.KPTURuntime.context.read()}))).toEqual(before);
    expect(await page.evaluate(()=>window.__deleteEvents)).toBe(0);
  });
  test(`delete lifecycle actual route away back during import stays cancelled ${view} ${width}`,async({page})=>{
    const state=await deleteConsumerFixture(page,view,width,{holdImport:true}),seen=consumerDialogs(page);
    await startConsumerDelete(page,view);await page.waitForFunction(()=>window.__helperImportStarted);
    await actualAwayBack(page,view);await releaseImport(page);
    expect(state.calls).toEqual([]);expect(seen).toEqual([]);expect(await page.evaluate(()=>window.__deleteEvents)).toBe(0);
  });
  test(`delete lifecycle same owner valid token rotation and session route preserve success ${view} ${width}`,async({page})=>{
    const state=await deleteConsumerFixture(page,view,width,{holdImport:true}),seen=consumerDialogs(page);
    await startConsumerDelete(page,view);await page.waitForFunction(()=>window.__helperImportStarted);
    const epoch=await page.evaluate(()=>window.KPTURuntime.session.epoch());
    await page.evaluate(()=>{const rt=window.KPTURuntime;rt.session.write({...rt.session.read(),access_token:'rotated-valid-token'});window.KPTURouter.go(window.KPTURouter.current,{source:'session',updateUrl:false})});
    await releaseImport(page);
    expect(state.calls).toEqual([{action:'delete',document_id:'doc-0'}]);expect(seen.map(d=>d.type)).toEqual(['confirm','alert']);expect(seen[1].message).toBe(DELETE_LEGACY);
    expect(await page.evaluate(()=>window.__deleteEvents)).toBe(1);
    expect(await page.evaluate(()=>window.__deleteOptions[0])).toMatchObject({expectedSessionEpoch:epoch,refreshSession:false});
  });
  for(const departure of ['session cycle','route cycle'])test(`delete lifecycle sent response ${departure} cannot publish stale success ${view} ${width}`,async({page})=>{
    const state=await deleteConsumerFixture(page,view,width),seen=consumerDialogs(page);state.deleteGate=gate();
    await startConsumerDelete(page,view);await expect.poll(()=>state.calls.length).toBe(1);
    if(departure==='session cycle')await observedSession(page,'owner');else await actualAwayBack(page,view);
    state.deleteGate.release();await settleConsumer(page);
    expect(state.calls).toEqual([{action:'delete',document_id:'doc-0'}]);expect(seen.map(d=>d.type)).toEqual(['confirm']);
    expect(await page.evaluate(()=>window.__deleteEvents)).toBe(0);
    if(view==='library'){
      // Capture cache at the consumer's final checkpoint before restoring the
      // actual route's filter, so a later GET cannot mask optimistic removal.
      expect(state.settlementCacheIds).toContain('doc-0');
      // UI-PC자료실: 다른 화면을 거쳐 다시 들어오면 분류 칩이 기본 상태([회의] 꺼짐)로 돌아가므로, 회의자료 분류인 doc-0을 보려면 다시 켠다.
      // 로그인 정보 갱신(session cycle)은 들어오기가 아니라 칩이 그대로여야 한다.
      if(departure==='route cycle')await showAllLibraryCategories(page);
      else await expect(page.locator('#libraryCategoryFilter [aria-pressed="false"]')).toHaveCount(0);
    }
    await expect(page.locator(view==='library'?'[data-lu-document="doc-0"]':'[data-mrd-delete-document="doc-0"]')).toHaveCount(1);
  });
}

for(const width of [390,1280]){
  test(`delete lifecycle meeting a11y deactivate reactivate without close epoch revokes import ${width}`,async({page})=>{
    const state=await deleteConsumerFixture(page,'meetings',width,{holdImport:true}),seen=consumerDialogs(page);
    await startConsumerDelete(page,'meetings');await page.waitForFunction(()=>window.__helperImportStarted);
    await page.evaluate(()=>{const m=document.querySelector('#meetingRoundDetailModal');window.KPTUA11y.dialog.deactivate(m,{restoreFocus:false});window.KPTUA11y.dialog.activate(m)});
    await releaseImport(page);expect(state.calls).toEqual([]);expect(seen).toEqual([]);
  });
  test(`delete lifecycle library held lookup route return remains cancelled ${width}`,async({page})=>{
    const state=await deleteConsumerFixture(page,'library',width),seen=consumerDialogs(page);state.lookupGate=gate();
    await page.evaluate(()=>window.__clearDeleteCache());await startConsumerDelete(page,'library');
    await expect.poll(()=>state.lookupStarted).toBe(true);await actualAwayBack(page,'library');
    state.lookupGate.release();await settleConsumer(page);
    expect(state.calls).toEqual([]);expect(seen).toEqual([]);
  });
  test(`delete lifecycle library held lookup rejects returned registration workspace ${width}`,async({page})=>{
    const state=await deleteConsumerFixture(page,'library',width),seen=consumerDialogs(page);state.lookupRow={...state.docs[0],workspace_id:'other-workspace'};
    await page.evaluate(()=>window.__clearDeleteCache());await startConsumerDelete(page,'library');await settleConsumer(page);
    expect(state.calls).toEqual([]);expect(seen.some(d=>d.type==='confirm')).toBe(false);
  });
  test(`delete lifecycle library guarded OAuth await cannot navigate after away return ${width}`,async({page})=>{
    const state=await deleteConsumerFixture(page,'library',width),seen=consumerDialogs(page,{reconnect:true});
    state.status=400;state.result={error:'invalid_grant'};state.driveGate=gate();
    await startConsumerDelete(page,'library');await expect.poll(()=>state.driveCalls).toBe(1);
    expect(seen.map(d=>d.type)).toEqual(['confirm','alert','confirm']);expect(seen[1].message).toBe(DELETE_DRIVE);
    await actualAwayBack(page,'library');state.driveGate.release();await settleOrOAuth(page);
    await state.cdp.send('Page.getFrameTree');expect(state.oauthNavigations).toBe(0);
    expect(state.oauthRequests).toBe(0);expect(page.url()).toContain('runtime-client-fixture.html');
    expect(seen[2].message).toContain('재연결 후 자료 목록과 원본 상태를 먼저 확인해 주세요.');
    expect(state.calls).toEqual([{action:'delete',document_id:'doc-0'}]);expect(state.driveCalls).toBe(1);expect(state.refreshes).toBe(0);
    expect(seen).toHaveLength(3);expect(await page.evaluate(()=>window.__deleteEvents)).toBe(0);
  });
}

for(const width of [390,1280])for(const view of ['library','meetings']){
  for(const unavailable of ['api','epoch method','negative epoch','fractional epoch','context owner','context workspace'])test(`delete lifecycle unavailable shared runtime ${unavailable} cannot take fallback ${view} ${width}`,async({page})=>{
    const state=await deleteConsumerFixture(page,view,width),seen=consumerDialogs(page);
    await page.evaluate(unavailable=>{const rt=window.KPTURuntime;
      if(unavailable==='api')rt.api=null;
      else if(unavailable==='epoch method')rt.session.epoch=null;
      else if(unavailable==='negative epoch')rt.session.epoch=()=>-1;
      else if(unavailable==='fractional epoch')rt.session.epoch=()=>0.5;
      else{const ctx=rt.context.read();if(unavailable==='context owner')ctx.user={id:'other-owner'};else ctx.workspace={id:''}}
    },unavailable);await startConsumerDelete(page,view);await settleConsumer(page);
    expect(state.calls).toEqual([]);expect(seen.some(d=>d.type==='confirm')).toBe(false);
    expect(seen.map(d=>d.message)).toEqual(['로그인 세션을 확인하지 못했습니다. 다시 로그인한 뒤 자료 목록과 원본 상태를 먼저 확인해 주세요.']);
  });
  test(`delete lifecycle stale failed import suppresses import error ${view} ${width}`,async({page})=>{
    const state=await deleteConsumerFixture(page,view,width),seen=consumerDialogs(page);
    await page.route('**/app/document-delete.js*',route=>route.fulfill({contentType:'text/javascript',body:'window.__helperImportStarted=true;await new Promise(resolve=>window.__releaseHelperImport=resolve);throw new Error("controlled import failure");'}));
    await startConsumerDelete(page,view);await page.waitForFunction(()=>window.__helperImportStarted);
    await actualAwayBack(page,view);await releaseImport(page);
    expect(state.calls).toEqual([]);expect(seen).toEqual([]);expect(state.pageErrors).toEqual([]);
  });
  test(`delete lifecycle rerender duplicate sends one request ${view} ${width}`,async({page})=>{
    const state=await deleteConsumerFixture(page,view,width),seen=consumerDialogs(page);state.deleteGate=gate();
    await startConsumerDelete(page,view);await expect.poll(()=>state.calls.length).toBe(1);
    if(view==='library')await page.evaluate(()=>window.KPTULibrary.render());
    else{await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:documents-changed')));await expect(page.locator('[data-mrd-delete-document="doc-0"]')).toBeEnabled()}
    await startConsumerDelete(page,view);
    state.deleteGate.release();await expect.poll(()=>seen.map(d=>d.type)).toEqual(['confirm','alert']);await settleConsumer(page);
    expect(state.calls).toEqual([{action:'delete',document_id:'doc-0'}]);expect(seen.map(d=>d.type)).toEqual(['confirm','alert']);expect(seen[1].message).toBe(DELETE_LEGACY);
  });
  test(`delete lifecycle sent revoked error after session return never starts OAuth ${view} ${width}`,async({page})=>{
    const state=await deleteConsumerFixture(page,view,width),seen=consumerDialogs(page,{reconnect:true});state.deleteGate=gate();state.status=400;state.result={error:'invalid_grant'};
    await startConsumerDelete(page,view);await expect.poll(()=>state.calls.length).toBe(1);
    await observedSession(page,'null');state.deleteGate.release();await settleConsumer(page);
    expect(state.calls).toHaveLength(1);expect(state.driveCalls).toBe(0);expect(state.oauthRequests).toBe(0);expect(seen.map(d=>d.type)).toEqual(['confirm']);
  });
}
for(const width of [390,1280]){
  test(`delete lifecycle library stale lookup failure cannot alert ${width}`,async({page})=>{
    const state=await deleteConsumerFixture(page,'library',width),seen=consumerDialogs(page);state.lookupGate=gate();state.lookupStatus=400;
    await page.evaluate(()=>window.__clearDeleteCache());await startConsumerDelete(page,'library');await expect.poll(()=>state.lookupStarted).toBe(true);
    await actualAwayBack(page,'library');state.lookupGate.release();await settleConsumer(page);
    expect(state.calls).toEqual([]);expect(seen).toEqual([]);expect(state.pageErrors).toEqual([]);
  });
  test(`delete lifecycle library stale reconnect failure cannot alert ${width}`,async({page})=>{
    const state=await deleteConsumerFixture(page,'library',width),seen=consumerDialogs(page,{reconnect:true});state.status=400;state.result={error:'invalid_grant'};state.driveGate=gate();state.driveStatus=400;
    await startConsumerDelete(page,'library');await expect.poll(()=>state.driveCalls).toBe(1);
    const epoch=await page.evaluate(()=>window.KPTURuntime.session.epoch());
    expect(await page.evaluate(()=>window.__driveOptions[0])).toMatchObject({expectedSessionEpoch:epoch});
    await observedSession(page,'empty token');state.driveGate.release();await settleOrOAuth(page);
    expect(state.oauthNavigations).toBe(0);expect(state.oauthRequests).toBe(0);expect(seen.map(d=>d.type)).toEqual(['confirm','alert','confirm']);
    expect(state.calls).toHaveLength(1);expect(state.driveCalls).toBe(1);expect(state.refreshes).toBe(0);
  });
  test(`delete lifecycle current library reconnect navigates with captured epoch ${width}`,async({page})=>{
    const state=await deleteConsumerFixture(page,'library',width),seen=consumerDialogs(page,{reconnect:true});state.status=400;state.result={error:'invalid_grant'};state.driveGate=gate();
    const epoch=await page.evaluate(()=>window.KPTURuntime.session.epoch());
    await startConsumerDelete(page,'library');await expect.poll(()=>state.driveCalls).toBe(1);
    expect(await page.evaluate(()=>window.__driveOptions[0])).toMatchObject({expectedSessionEpoch:epoch});
    state.driveGate.release();await page.waitForURL('**/library-open-fixture.html?delete-oauth=1');
    expect(state.oauthNavigations).toBe(1);expect(state.oauthRequests).toBe(1);expect(state.driveCalls).toBe(1);expect(state.calls).toHaveLength(1);
    expect(seen.map(d=>d.type)).toEqual(['confirm','alert','confirm']);expect(seen[2].message).toContain('재연결 후 자료 목록과 원본 상태를 먼저 확인해 주세요.');
  });
  test(`library upload one argument reconnect keeps its existing navigation contract ${width}`,async({page})=>{
    const state=await deleteConsumerFixture(page,'library',width),seen=[];
    page.on('dialog',async d=>{seen.push({type:d.type(),message:d.message()});await d.accept()});
    await page.locator('#newDocumentBtn').click();
    // The runtime fixture excludes shell modal bindings; compose its actual
    // DOM/a11y dialog activation before exercising the consumer upload flow.
    await page.evaluate(()=>{const modal=document.querySelector('#documentModal');modal.classList.remove('hidden');window.KPTUA11y.dialog.activate(modal,{initialFocus:'#docTitle'})});
    await page.locator('#libraryFileInput').setInputFiles({name:'upload.pdf',mimeType:'application/pdf',buffer:Buffer.from('upload')});
    state.driveGate=gate();await page.locator('#saveDocumentBtn').click();await expect.poll(()=>state.driveCalls).toBe(1);
    expect(await page.evaluate(()=>window.__driveOptions[0])).toMatchObject({expectedSessionEpoch:null,refreshSession:true});
    state.driveGate.release();await page.waitForURL('**/library-open-fixture.html?delete-oauth=1');
    expect(state.uploadCalls).toBe(1);expect(state.calls).toEqual([]);expect(state.oauthNavigations).toBe(1);expect(state.oauthRequests).toBe(1);
    expect(seen).toEqual([{type:'confirm',message:'Google Drive 연결이 만료됐습니다. 지금 관리자 계정을 다시 연결할까요?\n재연결 후 같은 작업을 다시 실행하면 됩니다.'}]);
  });
  test(`delete lifecycle library held lookup session snapshot remains revoked ${width}`,async({page})=>{
    const state=await deleteConsumerFixture(page,'library',width),seen=consumerDialogs(page);state.lookupGate=gate();
    await page.evaluate(()=>window.__clearDeleteCache());await startConsumerDelete(page,'library');await expect.poll(()=>state.lookupStarted).toBe(true);
    await observedSession(page,'snapshot null');state.lookupGate.release();await settleConsumer(page);expect(state.calls).toEqual([]);expect(seen).toEqual([]);
  });
  test(`delete lifecycle meeting close reopen same ID invalidates held import ${width}`,async({page})=>{
    const state=await deleteConsumerFixture(page,'meetings',width,{holdImport:true}),seen=consumerDialogs(page);
    await startConsumerDelete(page,'meetings');await page.waitForFunction(()=>window.__helperImportStarted);
    await closeMeetingResult(page);await openMeetingResult(page,'meeting-1');await expect(page.locator('#mrdMaterials .mrd-file-row')).toHaveCount(2);
    await releaseImport(page);expect(state.calls).toEqual([]);expect(seen).toEqual([]);
  });
  test(`delete lifecycle library OAuth session snapshot restoration cannot navigate ${width}`,async({page})=>{
    const state=await deleteConsumerFixture(page,'library',width),seen=consumerDialogs(page,{reconnect:true});state.status=400;state.result={error:'invalid_grant'};state.driveGate=gate();
    await startConsumerDelete(page,'library');await expect.poll(()=>state.driveCalls).toBe(1);
    await observedSession(page,'snapshot owner');state.driveGate.release();await settleOrOAuth(page);
    await state.cdp.send('Page.getFrameTree');expect(state.oauthNavigations).toBe(0);expect(state.oauthRequests).toBe(0);expect(state.calls).toHaveLength(1);expect(state.driveCalls).toBe(1);expect(seen).toHaveLength(3);
  });
}

for(const width of [390,1280])for(const view of ['library','meetings'])test(`delete lifecycle initial registration ID stays immutable during held import ${view} ${width}`,async({page})=>{
  const state=await deleteConsumerFixture(page,view,width,{holdImport:true}),seen=consumerDialogs(page);
  await startConsumerDelete(page,view);await page.waitForFunction(()=>window.__helperImportStarted);
  await page.evaluate(view=>{const rows=view==='library'?window.__fixtureLibraryRows():window.__fixtureMaterialRows;Object.assign(rows.find(row=>row.id==='doc-0'),{id:'doc-1',title:'Changed after capture'})},view);
  await releaseImport(page);
  expect(state.calls).toEqual([{action:'delete',document_id:'doc-0'}]);expect(seen.map(d=>d.type)).toEqual(['confirm','alert']);expect(seen[0].message).toContain('file-0.pdf');
  expect(await page.evaluate(()=>window.__deleteEvents)).toBe(1);
});
