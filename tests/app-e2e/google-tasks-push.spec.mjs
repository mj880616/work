import { test, expect } from '@playwright/test';
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
    if(p==='/functions/v1/push-notifications')return ok({enabled:false,count:0,public_key:'qa'});
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
  await expect(page.locator('#gtTaskSection')).toContainText('읽기 전용');
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
  await expect(page.locator('#gtTaskSection')).toContainText('Google Tasks 읽기 권한이 없습니다');
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
