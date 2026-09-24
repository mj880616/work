import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { loginEntry } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';

async function mock(page){
  await page.route(`${SB}/**`,async route=>{
    const u=new URL(route.request().url()),p=u.pathname;
    const ok=x=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x??null)});
    if(p==='/auth/v1/token')return ok({access_token:'qa',refresh_token:'qa',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}}});
    if(p==='/auth/v1/user')return ok({id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}});
    if(p==='/rest/v1/app_workspace_members')return ok([{workspace_id:'qa-ws',user_id:'qa-user',role:'owner'}]);
    if(p==='/rest/v1/app_workspaces')return ok([{id:'qa-ws',name:'QA Workspace'}]);
    if(p==='/rest/v1/app_profiles')return ok([{user_id:'qa-user',display_name:'QA'}]);
    if(p==='/rest/v1/app_tasks')return ok([]);
    if(p==='/rest/v1/app_spaces')return ok([]);
    if(p==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,calendars:[],events:[]});
    if(p==='/functions/v1/google-tasks')return ok({tasks:[{id:'g1',title:'Google QA 할 일',taskListTitle:'업무',due:null,notes:'',source:'google-task'}],needs_reconnect:false});
    if(p.startsWith('/rest/v1/')||p.startsWith('/functions/v1/'))return ok([]);
    return ok({});
  });
}

async function login(page){
  await page.goto(loginEntry('http://127.0.0.1:8123/app/'));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('qa@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:10000});
  await expect.poll(()=>page.evaluate(()=>typeof window.KPTURouter?.go==='function'),{timeout:10000}).toBeTruthy();
}

test('Google Tasks remains separate from the app task list',async({page})=>{
  await mock(page);await login(page);
  await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await expect(page.locator('#gtTaskSection')).toBeVisible({timeout:10000});
  await expect(page.locator('#gtTaskSection')).toContainText('Google QA 할 일');
  await expect(page.locator('#gtTaskSection')).toContainText('최근 3일');
});

test('Google Tasks shows pending first and only completions from the last three days',async({page})=>{
  await mock(page);
  const recent=new Date(Date.now()-24*60*60*1000).toISOString();
  const old=new Date(Date.now()-5*24*60*60*1000).toISOString();
  await page.route(`${SB}/functions/v1/google-tasks**`,async route=>{
    const action=new URL(route.request().url()).searchParams.get('action');
    const body=action==='status'?{connected:true,authorized:true}:{tasks:[
      {id:'recent-done',title:'최근 완료',taskListId:'l1',taskListTitle:'업무',status:'completed',completed:recent,source:'google-task'},
      {id:'old-done',title:'오래된 완료',taskListId:'l1',taskListTitle:'업무',status:'completed',completed:old,source:'google-task'},
      {id:'pending',title:'미완료 우선',taskListId:'l1',taskListTitle:'업무',status:'needsAction',source:'google-task'}
    ],needs_reconnect:false};
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await login(page);await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  const rows=page.locator('#gtTaskSection .gt-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('미완료 우선');
  await expect(rows.nth(1)).toContainText('최근 완료');
  await expect(page.locator('#gtTaskSection')).not.toContainText('오래된 완료');
  await expect(page.locator('[data-gt-show-completed]')).toHaveCount(0);
  expect(Number(await rows.nth(1).evaluate(el=>getComputedStyle(el).opacity))).toBeLessThan(0.7);
  const edge=readFileSync('supabase/functions/google-tasks/index.ts','utf8');
  expect(edge).toContain("completedMin:new Date(Date.now()-RECENT_COMPLETED_MS).toISOString()");
});

test('Google Tasks layout fits supported mobile widths',async({page})=>{
  await mock(page);await login(page);
  await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await expect(page.locator('#gtTaskSection')).toBeVisible({timeout:10000});
  for(const width of [360,390,412,430]){
    await page.setViewportSize({width,height:800});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
    const section=await page.locator('#gtTaskSection').boundingBox();
    expect(section?.width||0).toBeLessThanOrEqual(width);
    await expect(page.locator('#gtTaskSection .gt-actions .mini')).toHaveCount(2);
  }
});


test('Google Tasks can be created, edited, completed, reopened and deleted',async({page})=>{
  await mock(page);
  const calls=[];
  await page.route(`${SB}/functions/v1/google-tasks**`,async route=>{
    const req=route.request(),u=new URL(req.url()),action=u.searchParams.get('action'),body=req.method()==='GET'?{}:JSON.parse(req.postData()||'{}');
    const ok=x=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x??null)});
    if(action==='status')return ok({connected:true,authorized:true});
    if(action==='lists')return ok({lists:[{id:'l1',title:'업무'}]});
    if(action==='tasks')return ok({tasks:[{id:'g1',title:'Google QA 할 일',taskListId:'l1',taskListTitle:'업무',due:null,notes:'메모',status:'needsAction',source:'google-task'}],needs_reconnect:false});
    calls.push({action,body});return ok({ok:true});
  });
  await login(page);await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await page.locator('[data-gt-add]').click();
  await page.locator('#gtEditTitle').fill('새 Google 할 일');
  await page.locator('#gtSaveBtn').click();
  await expect.poll(()=>calls.some(x=>x.action==='create'&&x.body.title==='새 Google 할 일')).toBeTruthy();
  await page.locator('[data-gt-edit="g1"]').click();
  await page.locator('#gtEditTitle').fill('수정된 Google 할 일');
  await page.locator('#gtSaveBtn').click();
  await expect.poll(()=>calls.some(x=>x.action==='update'&&x.body.title==='수정된 Google 할 일')).toBeTruthy();
  await page.locator('[data-gt-toggle="g1"]').click();
  await expect.poll(()=>calls.some(x=>x.action==='toggle'&&x.body.completed===true)).toBeTruthy();
  await page.locator('[data-gt-edit="g1"]').click();
  page.once('dialog',d=>d.accept());
  await page.locator('#gtDeleteBtn').click();
  await expect.poll(()=>calls.some(x=>x.action==='delete')).toBeTruthy();
});


test('Google Tasks missing scope shows an explicit reconnect action',async({page})=>{
  await mock(page);
  await page.route(`${SB}/functions/v1/google-tasks**`,async route=>{
    const u=new URL(route.request().url());
    const action=u.searchParams.get('action');
    const body=action==='status'
      ? {connected:true,authorized:false,needs_reconnect:true}
      : {tasks:[],needs_reconnect:true};
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await login(page);
  await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await expect(page.locator('#gtTaskSection')).toBeVisible({timeout:10000});
  await expect(page.locator('#gtTaskSection')).toContainText('Google Tasks 수정 권한이 없습니다');
  await expect(page.locator('[data-gt-connect]')).toHaveText('Google 할 일 권한 다시 연결');
});

test('direct A-to-B session switch discards a stale Google Tasks response',async({page})=>{
  await mock(page);await login(page);
  await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await expect(page.locator('#gtTaskSection')).toContainText('Google QA 할 일');
  let releaseA=()=>{},aRequestStarted=false;
  await page.route(`${SB}/functions/v1/google-tasks**`,async route=>{
    const request=route.request(),url=new URL(request.url()),action=url.searchParams.get('action'),auth=request.headers().authorization||'';
    const ok=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    if(action==='status')return ok({connected:true,authorized:true});
    if(auth==='Bearer token-a'){
      aRequestStarted=true;
      await new Promise(resolve=>{releaseA=resolve});
      return ok({tasks:[{id:'a-private',title:'A의 비공개 Google 할 일',taskListTitle:'A 목록',source:'google-task'}],needs_reconnect:false});
    }
    return ok({tasks:[{id:'b-private',title:'B의 Google 할 일',taskListTitle:'B 목록',source:'google-task'}],needs_reconnect:false});
  });
  await page.evaluate(()=>window.KPTURuntime.session.write({access_token:'token-a',refresh_token:'token-a',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'user-a'}}));
  await expect.poll(()=>aRequestStarted).toBeTruthy();
  await page.evaluate(()=>window.KPTURuntime.session.write({access_token:'token-b',refresh_token:'token-b',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'user-b'}}));
  releaseA();
  await expect(page.locator('#gtTaskSection')).toContainText('B의 Google 할 일');
  await expect(page.locator('#gtTaskSection')).not.toContainText('A의 비공개 Google 할 일');
});

test('logout discards a stale Google Tasks response and clears its DOM',async({page})=>{
  await mock(page);await login(page);
  await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await expect(page.locator('#gtTaskSection')).toContainText('Google QA 할 일');
  let releaseA=()=>{},aRequestStarted=false;
  await page.route(`${SB}/functions/v1/google-tasks**`,async route=>{
    const request=route.request(),url=new URL(request.url()),action=url.searchParams.get('action');
    const ok=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    if(action==='status')return ok({connected:true,authorized:true});
    aRequestStarted=true;
    await new Promise(resolve=>{releaseA=resolve});
    return ok({tasks:[{id:'a-private',title:'A의 비공개 Google 할 일',taskListTitle:'A 목록',source:'google-task'}],needs_reconnect:false});
  });
  await page.evaluate(()=>window.KPTURuntime.session.write({access_token:'token-a',refresh_token:'token-a',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'user-a'}}));
  await expect.poll(()=>aRequestStarted).toBeTruthy();
  await page.evaluate(()=>window.KPTURuntime.session.write(null));
  releaseA();
  await expect(page.locator('#gtTaskSection')).toHaveCount(0);
});

test('Google Tasks client detects Android app and checks authorization before task fetch',async()=>{
  const source=await import('node:fs').then(({readFileSync})=>readFileSync('app/google-tasks.js','utf8'));
  expect(source).toContain("endpoint('status')");
  expect(source).toContain('/KPTUAndroid/i.test(navigator.userAgent)');
  expect(source).toContain("params.get('native')==='android'");
});
