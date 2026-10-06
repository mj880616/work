import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';

// 묶음C-2: Google Tasks loads with one combined request, shows this device's last result first while a fresh copy
// loads, keeps the last result when a refresh fails, drops the cache on sign-out or owner change, and still works
// against the older google-tasks Edge that has no action=overview. 묶음C-4: the cache moved to v2 (results include
// overdue tasks), so a v1 copy is ignored and removed. TASK-구현 PR 1: a tap on complete updates the copy at once and a
// failed save puts it back.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const TEST_ORIGIN=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const CACHE_KEY='kptu_owner_cache:google-tasks-v2:qa-user',OLD_CACHE_KEY='kptu_owner_cache:google-tasks-v1:qa-user';
// The app judges due dates in Korean time, so fixtures use the Korean date too.
const kstDateKey=(offset=0,now=Date.now())=>new Date(now+9*60*60*1000+offset*24*60*60*1000).toISOString().slice(0,10);
const googleDue=(offset=0)=>`${kstDateKey(offset)}T00:00:00.000Z`;
const task=(id,title)=>({id,title,taskListId:'l1',taskListTitle:'업무',due:googleDue(0),notes:'',status:'needsAction',source:'google-task'});

async function mockBase(page){
  await page.route(`${SB}/**`,async route=>{
    const u=new URL(route.request().url()),p=u.pathname;
    const ok=x=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x??null)});
    if(p==='/auth/v1/token')return ok({access_token:'qa',refresh_token:'qa',expires_in:3600,expires_at:4102444800,user:{id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}}});
    if(p==='/auth/v1/user')return ok({id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}});
    if(p==='/rest/v1/app_workspace_members')return ok([{workspace_id:'qa-ws',user_id:'qa-user',role:'owner'}]);
    if(p==='/rest/v1/app_workspaces')return ok([{id:'qa-ws',name:'QA Workspace'}]);
    if(p==='/rest/v1/app_profiles')return ok([{user_id:'qa-user',display_name:'QA'}]);
    if(p==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,calendars:[],events:[]});
    if(p.startsWith('/rest/v1/')||p.startsWith('/functions/v1/'))return ok([]);
    return ok({});
  });
}

// handler(action, request) -> {status, body} or a Promise of it. Records every google-tasks request.
async function mockTasks(page,handler){
  const calls=[];
  await page.route(`${SB}/functions/v1/google-tasks**`,async route=>{
    const req=route.request(),action=new URL(req.url()).searchParams.get('action');
    calls.push(action);
    const r=await handler(action,req);
    return route.fulfill({status:r.status||200,contentType:'application/json',body:JSON.stringify(r.body)});
  });
  return calls;
}

async function login(page){
  await page.goto(loginEntry(`${TEST_ORIGIN}/app/?view=calendar`));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('qa@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await ready(page);
}
async function ready(page){
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:10000});
  await expect.poll(()=>page.evaluate(()=>typeof window.KPTURouter?.go==='function'),{timeout:10000}).toBeTruthy();
}
const openTasks=page=>page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
const cached=page=>page.evaluate(k=>localStorage.getItem(k),CACHE_KEY);
// Owner change and sign-out can navigate the page, so storage checks after them retry.
const storageKeys=page=>page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('kptu_owner_cache:')).sort()).catch(()=>['navigating']);

test('one combined request loads Google Tasks and stores this owner\'s last result',async({page})=>{
  await mockBase(page);
  const calls=await mockTasks(page,action=>action==='overview'?{body:{connected:true,authorized:true,needs_reconnect:false,tasks:[task('t1','첫 결과')]}}:{status:500,body:{error:'unexpected '+action}});
  await login(page);await openTasks(page);
  await expect(page.locator('#gtTaskSection')).toContainText('첫 결과');
  await expect(page.locator('#gtTaskSection [data-gt-sync]')).toHaveText('');
  expect(calls).toEqual(['overview']);
  expect(calls.every(a=>a==='overview')).toBeTruthy();
  expect(JSON.parse(await cached(page)).tasks.map(t=>t.id)).toEqual(['t1']);
});

test('reopening shows the last result first, marks the refresh, then replaces it',async({page})=>{
  await mockBase(page);
  let version=1,release=()=>{},holding=false;
  await mockTasks(page,async action=>{
    if(action!=='overview')return {status:500,body:{error:'unexpected'}};
    if(version===2){holding=true;await new Promise(r=>{release=r});}
    return {body:{connected:true,authorized:true,needs_reconnect:false,tasks:[task('t'+version,version===1?'직전 결과':'새 결과')]}};
  });
  await login(page);await openTasks(page);
  await expect(page.locator('#gtTaskSection')).toContainText('직전 결과');
  version=2;
  await page.reload();await ready(page);await openTasks(page);
  await expect.poll(()=>holding).toBeTruthy();
  await expect(page.locator('#gtTaskSection')).toContainText('직전 결과');
  await expect(page.locator('#gtTaskSection [data-gt-sync]')).toHaveText('새로 받는 중…');
  await expect(page.locator('#gtTaskBody')).not.toContainText('불러오는 중');
  release();
  await expect(page.locator('#gtTaskSection')).toContainText('새 결과');
  await expect(page.locator('#gtTaskSection')).not.toContainText('직전 결과');
  await expect(page.locator('#gtTaskSection [data-gt-sync]')).toHaveText('');
  expect(JSON.parse(await cached(page)).tasks.map(t=>t.id)).toEqual(['t2']);
});

for(const failure of ['overview','session readiness']){
  test(`a failed ${failure} refresh keeps the cached result and mobile retry replaces it`,async({page})=>{
    await page.setViewportSize({width:360,height:800});
    await mockBase(page);
    let fail=false,version=1;
    const calls=await mockTasks(page,action=>fail?{status:500,body:{error:'upstream unavailable'}}:action==='overview'?{body:{connected:true,authorized:true,needs_reconnect:false,tasks:[task('t'+version,'fixture')]}}:{status:500,body:{error:'unexpected'}});
    await login(page);await openTasks(page);
    await expect(page.locator('#gtTaskBody [data-google-task="t1"]')).toBeVisible();
    if(failure==='overview')fail=true;
    else await page.evaluate(()=>{
      const session=window.KPTURuntime.session,ensure=session.ensure;
      session.ensure=async()=>{throw new Error('session readiness unavailable')};
      window.__qaRestoreEnsure=()=>{session.ensure=ensure};
    });
    await page.evaluate(()=>{window.KPTURouter.go('calendar',{source:'qa'});window.KPTURouter.go('tasks',{source:'qa'})});
    await expect(page.locator('#gtTaskSection [data-gt-sync]')).toContainText('새로 받지 못했습니다 · 직전 결과 표시 중');
    await expect(page.locator('#gtTaskBody [data-google-task="t1"]')).toBeVisible();
    expect(JSON.parse(await cached(page)).tasks.map(t=>t.id)).toEqual(['t1']);
    const retry=page.getByRole('button',{name:'다시 시도',exact:true});
    await expect(retry).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    fail=false;version=2;
    if(failure==='session readiness')await page.evaluate(()=>window.__qaRestoreEnsure());
    await retry.click();
    await expect(page.locator('#gtTaskBody [data-google-task="t2"]')).toBeVisible();
    await expect(page.locator('#gtTaskBody [data-google-task="t1"]')).toHaveCount(0);
    await expect(retry).toHaveCount(0);
    expect(JSON.parse(await cached(page)).tasks.map(t=>t.id)).toEqual(['t2']);
    expect(calls).toEqual(failure==='overview'?['overview','overview','overview']:['overview','overview']);
  });
}

test('sign-out and owner change remove the cached Google Tasks; another owner never sees them',async({page})=>{
  await mockBase(page);
  await mockTasks(page,(action,req)=>{
    const auth=req.headers().authorization||'';
    if(action!=='overview')return {status:500,body:{error:'unexpected'}};
    return {body:{connected:true,authorized:true,needs_reconnect:false,tasks:[auth==='Bearer token-b'?task('b1','B의 할 일'):task('q1','QA의 할 일')]}};
  });
  await login(page);await openTasks(page);
  await expect(page.locator('#gtTaskSection')).toContainText('QA의 할 일');
  expect(await cached(page)).not.toBeNull();
  // Owner change: A's cache is dropped before B's view renders.
  await page.evaluate(()=>window.KPTURuntime.session.write({access_token:'token-b',refresh_token:'token-b',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'user-b'}}));
  await expect(page.locator('#gtTaskSection')).toContainText('B의 할 일');
  await expect(page.locator('#gtTaskSection')).not.toContainText('QA의 할 일');
  await expect.poll(()=>storageKeys(page)).toEqual(['kptu_owner_cache:google-tasks-v2:user-b']);
  // Sign-out: every owner cache is dropped.
  await page.evaluate(()=>window.KPTURuntime.session.write(null));
  await expect.poll(()=>storageKeys(page)).toEqual([]);
});

test('a cached copy from before 묶음C-4 (v1) is never shown and is removed',async({page})=>{
  await mockBase(page);
  let release=()=>{},holding=false;
  await mockTasks(page,async action=>{
    if(action!=='overview')return {status:500,body:{error:'unexpected'}};
    holding=true;await new Promise(r=>{release=r});
    return {body:{connected:true,authorized:true,needs_reconnect:false,tasks:[task('n1','새 결과'),{...task('o1','밀린 할 일'),due:googleDue(-3)}]}};
  });
  await page.addInitScript(([k,v])=>{if(!sessionStorage.getItem('qa-seeded')){localStorage.setItem(k,v);sessionStorage.setItem('qa-seeded','1')}},[OLD_CACHE_KEY,JSON.stringify({owner:'qa-user',savedAt:Date.now(),tasks:[task('v1','옛 사본 결과')]})]);
  await login(page);await openTasks(page);
  await expect.poll(()=>holding).toBeTruthy();
  await expect(page.locator('#gtTaskBody')).toContainText('불러오는 중');
  await expect(page.locator('#gtTaskSection')).not.toContainText('옛 사본 결과');
  await expect.poll(()=>page.evaluate(k=>localStorage.getItem(k),OLD_CACHE_KEY)).toBeNull();
  release();
  await expect(page.locator('#gtTaskSection')).toContainText('새 결과');
  await expect(page.locator('#gt-overdue-head')).toHaveText('기한 지남 1');
  expect(JSON.parse(await cached(page)).tasks.map(t=>t.id)).toEqual(['n1','o1']);
});

test('the current google-tasks Edge (v9, no overdue tasks) still renders without an overdue group or error',async({page})=>{
  await mockBase(page);
  await mockTasks(page,action=>action==='overview'?{body:{connected:true,authorized:true,needs_reconnect:false,email:null,tasks:[task('t1','오늘 할 일'),{...task('t2','6일 뒤'),due:googleDue(6)}]}}:{status:500,body:{error:'unexpected'}});
  await login(page);await openTasks(page);
  await expect(page.locator('#gtTaskSection .gt-row')).toHaveCount(2);
  await expect(page.locator('#gt-overdue-head')).toHaveText('기한 지남 0');
  await expect(page.locator('#gtTaskSection [data-gt-sync]')).toHaveText('');
});

test('a token refresh for the same owner keeps the cache',async({page})=>{
  await mockBase(page);
  await mockTasks(page,action=>action==='overview'?{body:{connected:true,authorized:true,needs_reconnect:false,tasks:[task('t1','유지')]}}:{status:500,body:{error:'unexpected'}});
  await login(page);await openTasks(page);
  await expect(page.locator('#gtTaskSection')).toContainText('유지');
  await page.evaluate(()=>{const s=window.KPTURuntime.session.read();window.KPTURuntime.session.write({...s,access_token:'qa-refreshed'})});
  expect(await cached(page)).not.toBeNull();
});

test('older google-tasks Edge without action=overview falls back to status and tasks once',async({page})=>{
  await mockBase(page);
  const calls=await mockTasks(page,action=>{
    if(action==='overview')return {status:400,body:{error:'Unknown action'}};
    if(action==='status')return {body:{connected:true,authorized:true}};
    if(action==='tasks')return {body:{tasks:[task('old1','옛 Edge 결과')],needs_reconnect:false}};
    return {status:500,body:{error:'unexpected'}};
  });
  await login(page);await openTasks(page);
  await expect(page.locator('#gtTaskSection')).toContainText('옛 Edge 결과');
  await expect(page.locator('#gtTaskSection [data-gt-sync]')).toHaveText('');
  await page.evaluate(()=>{window.KPTURouter.go('calendar',{source:'qa'});window.KPTURouter.go('tasks',{source:'qa'})});
  await expect.poll(()=>calls.filter(a=>a==='tasks').length).toBeGreaterThanOrEqual(2);
  expect(calls.filter(a=>a==='overview').length).toBe(1);
});

test('older Edge reconnect states still show the reconnect action',async({page})=>{
  await mockBase(page);
  await mockTasks(page,action=>action==='overview'?{status:400,body:{error:'Unknown action'}}:action==='status'?{body:{connected:true,authorized:false,needs_reconnect:true}}:{body:{tasks:[],needs_reconnect:true}});
  await login(page);await openTasks(page);
  await expect(page.locator('#gtTaskSection')).toContainText('Google Tasks 수정 권한이 없습니다');
  await expect(page.locator('[data-gt-connect]')).toHaveText('Google 할 일 권한 다시 연결');
  expect(await cached(page)).toBeNull();
});

test('completing a task updates the stored last result at once and a failed save puts it back',async({page})=>{
  await mockBase(page);
  let release=()=>{},fail=false;
  await mockTasks(page,async action=>{
    if(action==='overview')return {body:{connected:true,authorized:true,needs_reconnect:false,tasks:[task('t1','완료할 일')]}};
    if(action!=='toggle')return {status:500,body:{error:'unexpected '+action}};
    if(fail)return {status:500,body:{error:'Google 저장 실패'}};
    await new Promise(r=>{release=r});
    return {body:{ok:true,task:{...task('t1','완료할 일'),status:'completed',completed:new Date().toISOString()}}};
  });
  await login(page);await openTasks(page);
  const statusOf=async()=>(JSON.parse(await cached(page))?.tasks||[]).map(t=>t.id+':'+t.status);
  await expect.poll(statusOf).toEqual(['t1:needsAction']);
  await page.locator('[data-gt-toggle="t1"]').click();
  // Updated before Google answers.
  await expect.poll(statusOf).toEqual(['t1:completed']);
  release();
  await expect.poll(statusOf).toEqual(['t1:completed']);
  fail=true;
  await page.locator('[data-gt-toggle="t1"]').click();
  await expect(page.locator('#gtTaskSection [data-gt-sync]')).toHaveText('완료 취소를 저장하지 못해 되돌렸습니다');
  await expect.poll(statusOf).toEqual(['t1:completed']);
});


test('each task-view visit refreshes once and reentry shares the in-flight load including session readiness',async({page})=>{
  await mockBase(page);
  let release=()=>{};
  const held=new Promise(resolve=>{release=resolve});
  let hold=true;
  const calls=await mockTasks(page,async action=>{
    if(hold)await held;
    return {body:{connected:true,authorized:true,needs_reconnect:false,tasks:[task('t1','fixture')]}};
  });
  await login(page);
  // Load the real module while the calendar is visible; hold the real session readiness boundary.
  await page.evaluate(async()=>{
    await window.KPTUViewLoader.load('tasks');
    const session=window.KPTURuntime.session,ensure=session.ensure;
    let unblock;const ready=new Promise(resolve=>{unblock=resolve});
    window.__qaEnsureCount=0;
    session.ensure=async(...args)=>{window.__qaEnsureCount++;await ready;return ensure(...args)};
    window.__qaReleaseSession=()=>{session.ensure=ensure;unblock()};
    window.KPTURouter.go('tasks',{source:'qa'});
    window.KPTURouter.go('calendar',{source:'qa'});
    window.KPTURouter.go('tasks',{source:'qa'});
  });
  expect(calls).toEqual([]);
  expect(await page.evaluate(()=>window.__qaEnsureCount)).toBe(1);
  await page.evaluate(()=>window.__qaReleaseSession());
  await expect.poll(()=>calls.length).toBeGreaterThan(0);
  await page.evaluate(()=>{window.KPTURouter.go('calendar',{source:'qa'});window.KPTURouter.go('tasks',{source:'qa'})});
  hold=false;release();
  await expect(page.locator('#gtTaskBody .gt-row')).toHaveCount(1);
  expect(calls).toEqual(['overview']);
  await page.evaluate(()=>{window.KPTURouter.go('calendar',{source:'qa'});window.KPTURouter.go('tasks',{source:'qa'})});
  await expect(page.locator('#gtTaskSection [data-gt-sync]')).toHaveText('');
  await expect.poll(()=>calls.length).toBe(2);
  expect(calls).toEqual(['overview','overview']);
});

test('initial task load failure offers a short accessible retry at mobile width and clears it after success',async({page})=>{
  await page.setViewportSize({width:360,height:800});
  await mockBase(page);
  let fail=true;
  const calls=await mockTasks(page,()=>fail?{status:500,body:{error:'upstream unavailable'}}:{body:{connected:true,authorized:true,needs_reconnect:false,tasks:[task('t1','fixture')]}});
  await login(page);await openTasks(page);
  await expect(page.locator('#gtTaskBody')).toContainText('Google 할 일을 불러오지 못했습니다.');
  const retry=page.getByRole('button',{name:'다시 시도',exact:true});
  await expect(retry).toBeVisible();
  await expect(page.getByRole('button',{name:'새로고침',exact:true})).toHaveCount(0);
  await expect(page.locator('#newTaskBtn')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  expect(calls).toEqual(['overview']);
  fail=false;await retry.click();
  await expect(page.locator('#gtTaskBody .gt-row')).toHaveCount(1);
  await expect(retry).toHaveCount(0);
  expect(calls).toEqual(['overview','overview']);
});

const BASE=TEST_ORIGIN;
const gate=()=>{let release;const promise=new Promise(resolve=>{release=resolve});return {promise,release}};

// Keep one document alive to exercise the module's own session epoch. The full-shell
// public-workspace-auth tests separately verify the loader's reload/login boundary.
// Session, cache, API single-flight, router and Google Tasks code are all real.
async function start(page,phase){
  const requests={previous:0,current:0},gates={previous:gate(),current:gate()};
  await page.route(`${SB}/**`,async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname==='/rest/v1/app_record_links')return route.fulfill({json:[]});
    if(url.pathname!=='/functions/v1/google-tasks'||url.searchParams.get('action')!=='overview'){
      return route.fulfill({status:500,json:{error:'unexpected fixture request'}});
    }
    const owner=request.headers().authorization==='Bearer fixture-previous'?'previous':'current';
    requests[owner]++;
    await gates[owner].promise;
    const due=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10)+'T00:00:00.000Z';
    await route.fulfill({json:{connected:true,authorized:true,tasks:[{
      id:owner,title:'fixture',taskListId:'fixture-list',due,status:'needsAction',notes:''
    }]}});
  });
  await page.goto(`${BASE}/tests/app-e2e/runtime-client-fixture.html`);
  await page.evaluate(phase=>{
    document.body.innerHTML='<style>.hidden{display:none!important}</style><main id="appView" class="kptu-ui-ready"><section id="calendarView" class="view-panel"></section><section id="tasksView" class="view-panel hidden"><button id="newTaskBtn">Add</button><div id="taskList"></div></section></main>';
    const rt=window.KPTURuntime;
    window.__race={ensures:0,apiCalls:0,settled:0,staleRows:0,documentId:Math.random()};
    window.__setOwner=(owner,id=owner)=>{
      rt.session.write(owner?{access_token:'fixture-'+owner,refresh_token:'fixture',expires_at:4102444800,user:{id}}:null);
      if(owner)rt.context.set({user:{id},workspace:{id:'fixture-workspace'}});
    };
    window.__setOwner('previous');
    const ensure=rt.session.ensure;
    let release;
    const readiness=new Promise(resolve=>{release=resolve});
    window.__releaseReadiness=release;
    rt.session.ensure=async()=>{
      const call=++window.__race.ensures;
      if(phase==='readiness'&&call===1)await readiness;
      return ensure();
    };
    const api=rt.api;
    rt.api=async(...args)=>{
      window.__race.apiCalls++;
      try{return await api(...args)}finally{window.__race.settled++}
    };
    // Observe transient insertions too, rather than checking only the final DOM.
    new MutationObserver(records=>{
      for(const record of records)for(const node of record.addedNodes){
        if(node.nodeType!==1)continue;
        window.__race.staleRows+=Number(node.matches('[data-google-task="previous"]'))+node.querySelectorAll('[data-google-task="previous"]').length;
      }
    }).observe(document.querySelector('#tasksView'),{subtree:true,childList:true});
  },phase);
  await page.addScriptTag({url:`${BASE}/app/app-router.js`});
  await page.addScriptTag({url:`${BASE}/app/google-tasks.js`});
  const documentId=await page.evaluate(()=>window.__race.documentId);
  await page.evaluate(()=>window.KPTURouter.go('tasks'));
  if(phase==='overview')await expect.poll(()=>requests.previous).toBe(1);
  else await expect.poll(()=>page.evaluate(()=>window.__race.ensures)).toBe(1);
  return {requests,gates,documentId};
}

const drain=page=>page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
const reenter=page=>page.evaluate(()=>{window.KPTURouter.go('calendar');window.KPTURouter.go('tasks')});
const stats=page=>page.evaluate(()=>({...window.__race}));

for(const phase of ['readiness','overview'])for(const transition of ['switch','logout'])for(const finish of ['previous first','current first']){
  test(`Google Tasks ${transition} during ${phase}: ${finish} preserves the new session load`,async({page})=>{
    const {requests,gates,documentId}=await start(page,phase);
    const releasePrevious=async()=>{
      if(phase==='readiness')await page.evaluate(()=>window.__releaseReadiness());
      else{
        gates.previous.release();
        await expect.poll(async()=>(await stats(page)).settled).toBe(finish==='current first'?3:1);
      }
      await drain(page);
    };
    if(transition==='logout'){
      await page.evaluate(()=>window.__setOwner(null));
      await expect(page.locator('#gtTaskSection')).toHaveCount(0);
      if(finish==='previous first'){
        await releasePrevious();
        await expect(page.locator('#gtTaskSection')).toHaveCount(0);
        expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('kptu_owner_cache:')).length)).toBe(0);
      }
    }
    // Relogin to the same owner also needs a fresh epoch, even though the id repeats.
    const expectedOwner=transition==='logout'?'previous':'current';
    await page.evaluate(owner=>window.__setOwner('current',owner),expectedOwner);
    await expect.poll(()=>requests.current).toBe(1);
    const expectedCalls=phase==='overview'?2:1;
    if(transition==='switch'&&finish==='previous first')await releasePrevious();
    await reenter(page);
    await drain(page);
    // Counting the module's ensure/API calls prevents runtime deduplication from
    // hiding an old finally block that incorrectly clears the new owner's lock.
    expect((await stats(page)).ensures).toBe(2);
    expect((await stats(page)).apiCalls).toBe(expectedCalls);
    expect(requests.current).toBe(1);
    gates.current.release();
    await expect(page.locator('[data-google-task="current"]')).toHaveCount(1);
    if(finish==='current first')await releasePrevious();
    await expect(page.locator('[data-google-task="previous"]')).toHaveCount(0);
    await expect(page.locator('[data-google-task="current"]')).toHaveCount(1);
    const final=await stats(page);
    expect(final.staleRows).toBe(0);
    expect(final.documentId).toBe(documentId);
    expect(final.ensures).toBe(2);
    expect(final.apiCalls).toBe(expectedCalls+1); // One owner-scoped link read after the current overview.
    expect(requests).toEqual({previous:phase==='overview'?1:0,current:1});
    expect(await page.evaluate(owner=>{
      const keys=Object.keys(localStorage).filter(key=>key.startsWith('kptu_owner_cache:'));
      return keys.length===1&&keys[0].endsWith(':'+owner)&&JSON.parse(localStorage.getItem(keys[0])).tasks.every(task=>task.id==='current');
    },expectedOwner)).toBe(true);
    // Completed loads must release the current epoch as well.
    await reenter(page);
    await expect.poll(()=>requests.current).toBe(2);
  });
}
