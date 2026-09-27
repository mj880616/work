import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';

// 묶음C-2: Google Tasks loads with one combined request, shows this device's last result first while a fresh copy
// loads, keeps the last result when a refresh fails, drops the cache on sign-out or owner change, and still works
// against the older google-tasks Edge that has no action=overview. 묶음C-4: the cache moved to v2 (results include
// overdue tasks), so a v1 copy is ignored and removed. TASK-구현 PR 1: a tap on complete updates the copy at once and a
// failed save puts it back.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
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
  await page.goto(loginEntry('http://127.0.0.1:8123/app/'));
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
  expect(calls.length).toBeGreaterThanOrEqual(1);
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

test('a failed refresh keeps the last result and says so',async({page})=>{
  await mockBase(page);
  let fail=false;
  await mockTasks(page,action=>fail?{status:500,body:{error:'Google Tasks 요청 실패'}}:action==='overview'?{body:{connected:true,authorized:true,needs_reconnect:false,tasks:[task('t1','남아야 할 결과')]}}:{status:500,body:{error:'unexpected'}});
  await login(page);await openTasks(page);
  await expect(page.locator('#gtTaskSection')).toContainText('남아야 할 결과');
  fail=true;
  await page.locator('[data-gt-refresh]').click();
  await expect(page.locator('#gtTaskSection [data-gt-sync]')).toHaveText('새로 받지 못했습니다 · 직전 결과 표시 중');
  await expect(page.locator('#gtTaskSection')).toContainText('남아야 할 결과');
  expect(JSON.parse(await cached(page)).tasks.map(t=>t.id)).toEqual(['t1']);
});

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
  await expect(page.locator('#gtOverdueHead')).toHaveText('기한 지남 1');
  expect(JSON.parse(await cached(page)).tasks.map(t=>t.id)).toEqual(['n1','o1']);
});

test('the current google-tasks Edge (v9, no overdue tasks) still renders without an overdue group or error',async({page})=>{
  await mockBase(page);
  await mockTasks(page,action=>action==='overview'?{body:{connected:true,authorized:true,needs_reconnect:false,email:null,tasks:[task('t1','오늘 할 일'),{...task('t2','6일 뒤'),due:googleDue(6)}]}}:{status:500,body:{error:'unexpected'}});
  await login(page);await openTasks(page);
  await expect(page.locator('#gtTaskSection .gt-row')).toHaveCount(2);
  await expect(page.locator('#gtOverdueHead')).toHaveCount(0);
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
  await page.locator('[data-gt-refresh]').click();
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
