import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { loginEntry } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// The app judges due dates in Korean time (묶음C-4), so fixtures use the Korean date too.
const kstDateKey=(offset=0,now=Date.now())=>new Date(now+9*60*60*1000+offset*24*60*60*1000).toISOString().slice(0,10);
const googleDue=(offset=0)=>`${kstDateKey(offset)}T00:00:00.000Z`;
const gt=(id,due,extra={})=>({id,title:id,taskListId:'l1',taskListTitle:'업무',due,status:'needsAction',source:'google-task',...extra});

// Opens the task view at a fixed time in the given device time zone and returns the rendered Google Tasks rows.
async function renderedRows(browser,{timezoneId,now,tasks}){
  const context=await browser.newContext({timezoneId});
  const page=await context.newPage();
  await page.clock.setFixedTime(new Date(now));
  await mock(page);
  await page.route(`${SB}/functions/v1/google-tasks**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({connected:true,authorized:true,needs_reconnect:false,tasks})}));
  await login(page);
  await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await expect(page.locator('#gtTaskBody.gt-list')).toBeVisible({timeout:10000});
  const ids=sel=>page.locator(sel).evaluateAll(els=>els.map(el=>el.dataset.googleTask));
  const result={overdue:await ids('#gtTaskBody [data-gt-overdue] .gt-row'),rest:await ids('#gtTaskBody > .gt-row'),head:await page.locator('#gtOverdueHead').allTextContents(),overdueClass:await ids('#gtTaskBody .gt-row.overdue')};
  await context.close();
  return result;
}

async function mock(page){
  await page.route(`${SB}/**`,async route=>{
    const u=new URL(route.request().url()),p=u.pathname;
    const ok=x=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x??null)});
    if(p==='/auth/v1/token')return ok({access_token:'qa',refresh_token:'qa',expires_in:3600,expires_at:4102444800,user:{id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}}});
    if(p==='/auth/v1/user')return ok({id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}});
    if(p==='/rest/v1/app_workspace_members')return ok([{workspace_id:'qa-ws',user_id:'qa-user',role:'owner'}]);
    if(p==='/rest/v1/app_workspaces')return ok([{id:'qa-ws',name:'QA Workspace'}]);
    if(p==='/rest/v1/app_profiles')return ok([{user_id:'qa-user',display_name:'QA'}]);
    if(p==='/rest/v1/app_tasks')return ok([]);
    if(p==='/rest/v1/app_spaces')return ok([]);
    if(p==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,calendars:[],events:[]});
    if(p==='/functions/v1/google-tasks')return ok({tasks:[{id:'g1',title:'Google QA 할 일',taskListTitle:'업무',due:googleDue(0),notes:'',status:'needsAction',source:'google-task'}],needs_reconnect:false});
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
  await expect(page.locator('#gtTaskSection')).toContainText('오늘부터 7일');
  await expect(page.locator('#gtTaskSection')).toContainText('최근 3일');
});

test('Google Tasks shows pending first and only completions from the last three days',async({page})=>{
  await mock(page);
  const recent=new Date(Date.now()-24*60*60*1000).toISOString();
  const old=new Date(Date.now()-5*24*60*60*1000).toISOString();
  await page.route(`${SB}/functions/v1/google-tasks**`,async route=>{
    const action=new URL(route.request().url()).searchParams.get('action');
    const body=action==='status'?{connected:true,authorized:true}:{tasks:[
      {id:'recent-done',title:'최근 완료',taskListId:'l1',taskListTitle:'업무',due:googleDue(0),status:'completed',completed:recent,source:'google-task'},
      {id:'old-done',title:'오래된 완료',taskListId:'l1',taskListTitle:'업무',due:googleDue(0),status:'completed',completed:old,source:'google-task'},
      {id:'pending',title:'미완료 우선',taskListId:'l1',taskListTitle:'업무',due:googleDue(1),status:'needsAction',source:'google-task'}
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
  expect(edge).toContain("completedMin=new Date(Date.now()-RECENT_COMPLETED_MS).toISOString()");
});

test('Google Tasks shows overdue first, then Korean today through +6 days, then recent completions whatever their due date, across a year boundary',async({browser})=>{
  // 2026-12-31 23:30 in Korea.
  const r=await renderedRows(browser,{timezoneId:'Asia/Seoul',now:'2026-12-31T14:30:00.000Z',tasks:[
    gt('yesterday','2026-12-30T00:00:00.000Z'),
    gt('minus30','2026-12-01T00:00:00.000Z'),
    gt('plus6','2027-01-06T00:00:00.000Z'),
    gt('today','2026-12-31T00:00:00.000Z'),
    gt('tomorrow','2027-01-01T00:00:00.000Z'),
    gt('plus7','2027-01-07T00:00:00.000Z'),
    gt('no-due',null),
    // Completed in the last 3 days: shown in the completed part whatever the due date (2026-09-27 decision), newest completion first.
    gt('recent-done-in','2027-01-01T00:00:00.000Z',{status:'completed',completed:'2026-12-31T13:30:00.000Z'}),
    gt('recent-done-out','2027-01-07T00:00:00.000Z',{status:'completed',completed:'2026-12-31T12:30:00.000Z'}),
    gt('recent-done-overdue','2026-12-01T00:00:00.000Z',{status:'completed',completed:'2026-12-31T11:30:00.000Z'}),
    gt('recent-done-undated',null,{status:'completed',completed:'2026-12-29T15:00:00.000Z'}),
    // Completed more than 3 days ago: hidden even with a due date inside the window.
    gt('old-done-overdue','2026-12-20T00:00:00.000Z',{status:'completed',completed:'2026-12-28T14:00:00.000Z'}),
    gt('old-done-in','2027-01-01T00:00:00.000Z',{status:'completed',completed:'2026-12-27T14:30:00.000Z'})
  ]});
  expect(r.head).toEqual(['기한 지남 2']);
  expect(r.overdue).toEqual(['minus30','yesterday']);
  expect(r.overdueClass).toEqual(['minus30','yesterday']);
  expect(r.rest).toEqual(['today','tomorrow','plus6','recent-done-in','recent-done-out','recent-done-overdue','recent-done-undated']);
});

test('Google Tasks moves the overdue line at Korean midnight whatever the device time zone',async({browser})=>{
  const tasks=[gt('d-1','2026-09-26T00:00:00.000Z'),gt('d0','2026-09-27T00:00:00.000Z'),gt('d6','2026-10-03T00:00:00.000Z'),gt('d7','2026-10-04T00:00:00.000Z'),gt('undated',null)];
  // 09-27 23:59:59 in Korea (09-27 07:59 in Los Angeles).
  const before=await renderedRows(browser,{timezoneId:'America/Los_Angeles',now:'2026-09-27T14:59:59.000Z',tasks});
  expect(before.overdue).toEqual(['d-1']);
  expect(before.rest).toEqual(['d0','d6']);
  // 09-28 00:00 in Korea, still 09-27 in Los Angeles.
  const after=await renderedRows(browser,{timezoneId:'America/Los_Angeles',now:'2026-09-27T15:00:00.000Z',tasks});
  expect(after.head).toEqual(['기한 지남 2']);
  expect(after.overdue).toEqual(['d-1','d0']);
  expect(after.rest).toEqual(['d6','d7']);
});

test('completing an overdue Google task moves it from the overdue group to the completed part',async({browser})=>{
  const context=await browser.newContext({timezoneId:'Asia/Seoul'});
  const page=await context.newPage();
  await page.clock.setFixedTime(new Date('2026-09-27T03:00:00.000Z'));
  await mock(page);
  const task=gt('late','2026-09-20T00:00:00.000Z',{title:'밀린 할 일'});
  const toggles=[];
  await page.route(`${SB}/functions/v1/google-tasks**`,async route=>{
    const req=route.request(),action=new URL(req.url()).searchParams.get('action');
    if(action==='toggle'){const b=JSON.parse(req.postData()||'{}');toggles.push(b);Object.assign(task,b.completed?{status:'completed',completed:'2026-09-27T03:00:00.000Z'}:{status:'needsAction',completed:null});return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,task})});}
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({connected:true,authorized:true,needs_reconnect:false,tasks:[task,gt('today','2026-09-27T00:00:00.000Z')]})});
  });
  await login(page);
  await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await expect(page.locator('#gtOverdueHead')).toHaveText('기한 지남 1');
  // The check is drawn in CSS inside the circle: no glyph that can spill out, same circle for pending and completed.
  const check=id=>page.locator(`[data-gt-toggle="${id}"]`).evaluate(el=>{const r=el.getBoundingClientRect(),a=getComputedStyle(el,'::after');return {w:r.width,h:r.height,text:el.textContent,after:a.content,left:a.left,top:a.top,pos:a.position,bg:getComputedStyle(el).backgroundColor}});
  const pendingCheck=await check('late');
  expect(pendingCheck).toMatchObject({w:22,h:22,text:'',after:'none'});
  await page.locator('[data-gt-overdue] [data-gt-toggle="late"]').click();
  await expect(page.locator('#gtOverdueHead')).toHaveCount(0);
  const row=page.locator('#gtTaskBody > .gt-row.completed[data-google-task="late"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('밀린 할 일');
  const doneCheck=await check('late');
  // 22px circle with a 2px border: the check is anchored at 9px of the 18px inner box, i.e. the centre of the circle.
  expect(doneCheck).toMatchObject({w:22,h:22,text:'',after:'""',left:'9px',top:'9px',pos:'absolute'});
  expect(doneCheck.bg).not.toBe(pendingCheck.bg);
  expect(toggles).toEqual([expect.objectContaining({action:'toggle',task_id:'late',completed:true})]);
  await context.close();
});

test('Google Tasks without overdue items shows no overdue group',async({browser})=>{
  const r=await renderedRows(browser,{timezoneId:'Asia/Seoul',now:'2026-09-27T03:00:00.000Z',tasks:[gt('d0','2026-09-27T00:00:00.000Z')]});
  expect(r.head).toEqual([]);
  expect(r.overdue).toEqual([]);
  expect(r.rest).toEqual(['d0']);
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
    await expect(page.locator('#newTaskBtn')).toBeVisible();
    await expect(page.locator('#gtTaskSection [data-gt-refresh]')).toBeVisible();
    await expect(page.locator('[data-gt-add]')).toHaveCount(0);
  }
});


test('Google Tasks can be created, edited, completed, reopened and deleted',async({page})=>{
  await mock(page);
  const calls=[];
  await page.route(`${SB}/functions/v1/google-tasks**`,async route=>{
    const req=route.request(),u=new URL(req.url()),action=u.searchParams.get('action'),body=req.method()==='GET'?{}:JSON.parse(req.postData()||'{}');
    const ok=x=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x??null)});
    const listed=[{id:'g1',title:'Google QA 할 일',taskListId:'l1',taskListTitle:'업무',due:googleDue(0),notes:'메모',status:'needsAction',source:'google-task'}];
    if(action==='status')return ok({connected:true,authorized:true});
    if(action==='lists')return ok({lists:[{id:'l1',title:'업무'}]});
    if(action==='overview')return ok({connected:true,authorized:true,needs_reconnect:false,tasks:listed});
    if(action==='tasks')return ok({tasks:listed,needs_reconnect:false});
    calls.push({action,body});return ok({ok:true});
  });
  await login(page);await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await page.locator('#newTaskBtn').click();
  await page.locator('#gtEditTitle').fill('새 Google 할 일');
  await page.locator('#gtSaveBtn').click();
  await expect.poll(()=>calls.some(x=>x.action==='create'&&x.body.title==='새 Google 할 일')).toBeTruthy();
  await page.locator('[data-gt-edit="g1"]').click();
  await page.locator('#gtEditTitle').fill('수정된 Google 할 일');
  await page.locator('#gtSaveBtn').click();
  await expect.poll(()=>calls.some(x=>x.action==='update'&&x.body.title==='수정된 Google 할 일')).toBeTruthy();
  await page.locator('[data-gt-toggle="g1"]').click();
  await expect.poll(()=>calls.some(x=>x.action==='toggle'&&x.body.completed===true)).toBeTruthy();
  await expect(page.locator('[data-google-task="g1"]')).toHaveClass(/completed/);
  await page.locator('[data-gt-toggle="g1"]').click();
  await expect.poll(()=>calls.some(x=>x.action==='toggle'&&x.body.completed===false)).toBeTruthy();
  await expect(page.locator('[data-google-task="g1"]')).toHaveClass(/pending/);
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
      return ok({tasks:[{id:'a-private',title:'A의 비공개 Google 할 일',taskListTitle:'A 목록',due:googleDue(0),status:'needsAction',source:'google-task'}],needs_reconnect:false});
    }
    return ok({tasks:[{id:'b-private',title:'B의 Google 할 일',taskListTitle:'B 목록',due:googleDue(0),status:'needsAction',source:'google-task'}],needs_reconnect:false});
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

// TASK-구현 PR 4: the editor saves to "내 할 일" only and chooses any number of project and organization links.
async function mockLinkTargets(page){
  await page.route(`${SB}/rest/v1/app_spaces**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([
    {id:'p1',workspace_id:'qa-ws',owner_id:'qa-user',name:'민자철도',parent_id:null,status:'active',sort_order:1,metadata:{project_system:'v2'}},
    {id:'p2',workspace_id:'qa-ws',owner_id:'qa-user',name:'국회토론회',parent_id:'p1',status:'active',sort_order:2,metadata:{project_system:'v2'}},
    {id:'p3',workspace_id:'qa-ws',owner_id:'qa-user',name:'지난 캠페인',parent_id:null,status:'archived',sort_order:3,metadata:{project_system:'v2'}}
  ])}));
  await page.route(`${SB}/rest/v1/app_suborganization_assignees**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([
    {organization_id:'o1'},{organization_id:'o2'},{organization_id:'o3'},{organization_id:'o4'}
  ])}));
  await page.route(`${SB}/rest/v1/app_suborganizations**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([
    {id:'o0',name:'담당 아닌 조직'},
    {id:'o1',name:'서울교통공사노조'},
    {id:'o2',name:'철도노조'},
    {id:'o3',name:'가나다조직'},
    {id:'o4',name:'아주 긴 이름이 360픽셀 화면에서도 체크박스 아래로 내려가거나 가로로 넘치지 않아야 하는 담당 조직'}
  ])}));
}

test('Google Tasks editor has no list choice and saves chosen links',async({page})=>{
  await mock(page);await mockLinkTargets(page);
  const calls=[];
  await page.route(`${SB}/functions/v1/google-tasks**`,async route=>{
    const req=route.request(),u=new URL(req.url()),action=u.searchParams.get('action'),body=req.method()==='GET'?{}:JSON.parse(req.postData()||'{}');
    const ok=x=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x??null)});
    calls.push({action,body,query:Object.fromEntries(u.searchParams)});
    if(action==='overview')return ok({connected:true,authorized:true,needs_reconnect:false,tasks:[gt('g1',googleDue(0),{taskListId:'@default',taskListTitle:'내 할 일'})]});
    if(action==='links')return ok({links:[{project_id:'p1',organization_id:null,status:'confirmed'},{project_id:'p3',organization_id:null,status:'confirmed'},{project_id:null,organization_id:'o0',status:'confirmed'}]});
    return ok({ok:true,task:gt('g1',googleDue(0)),links:[]});
  });
  await login(page);await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await expect(page.locator('#gtTaskSection')).toContainText('"내 할 일" 목록만 보입니다');
  await page.locator('#newTaskBtn').click();
  await expect(page.locator('#gtEditList')).toHaveCount(0);
  await expect(page.locator('#gtTaskModal [data-gt-list-note]')).toContainText('"내 할 일" 목록에 저장');
  const links=page.locator('#gtEditLinkBody');
  await expect(links.locator('[data-gt-link]')).toHaveCount(6);
  await expect(links.locator('input[value="p:p3"]')).toHaveCount(0);
  await expect(links.locator('input[value="o:o0"]')).toHaveCount(0);
  await expect(links.locator('.gt-link-group').last().locator('span')).toHaveText([
    '철도노조','서울교통공사노조','가나다조직','아주 긴 이름이 360픽셀 화면에서도 체크박스 아래로 내려가거나 가로로 넘치지 않아야 하는 담당 조직'
  ]);
  await page.locator('#gtEditTitle').fill('연결 없는 할 일');
  await page.locator('#gtSaveBtn').click();
  await expect.poll(()=>calls.find(x=>x.action==='create')?.body).toEqual(expect.objectContaining({title:'연결 없는 할 일',links:[]}));
  expect(calls.find(x=>x.action==='create').body.task_list_id).toBeUndefined();
  await page.locator('#newTaskBtn').click();
  await page.locator('#gtEditTitle').fill('연결 둘');
  await links.locator('input[value="p:p2"]').check();
  await links.locator('input[value="o:o1"]').check();
  await page.locator('#gtSaveBtn').click();
  await expect.poll(()=>calls.filter(x=>x.action==='create')[1]?.body?.links).toEqual([{project_id:'p2'},{organization_id:'o1'}]);
  await page.locator('[data-gt-edit="g1"]').click();
  await expect(links.locator('input[value="p:p1"]')).toBeChecked();
  await links.locator('input[value="p:p1"]').uncheck();
  await links.locator('input[value="o:o1"]').check();
  await page.locator('#gtSaveBtn').click();
  await expect.poll(()=>calls.find(x=>x.action==='unlink')?.body?.links).toEqual([{project_id:'p1'}]);
  expect(calls.find(x=>x.action==='link')?.body).toEqual(expect.objectContaining({task_id:'g1',links:[{organization_id:'o1'}]}));
  // The archived project link is not offered, so it is neither removed nor re-added.
  const linkChanges=JSON.stringify(calls.filter(x=>x.action==='link'||x.action==='unlink').map(x=>x.body));
  expect(linkChanges).not.toContain('p3');
  expect(linkChanges).not.toContain('o0');
  expect(calls.some(x=>x.action==='lists')).toBeFalsy();
  await expect(page.locator('#taskList')).toBeEmpty();
  await expect(page.locator('[data-gt-add]')).toHaveCount(0);
  // Saving closes the editor; reopen it before measuring the visible link options.
  await page.locator('[data-gt-edit="g1"]').click();
  await expect(links.locator('[data-gt-link]')).toHaveCount(6);
  for(const width of [360,1280]){
    await page.setViewportSize({width,height:800});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
    const option=links.locator('label.gt-link-opt').last();
    const [checkBox,textBox]=await Promise.all([option.locator('input').boundingBox(),option.locator('span').boundingBox()]);
    expect(checkBox).not.toBeNull();
    expect(textBox).not.toBeNull();
    expect(textBox.x).toBeGreaterThan(checkBox.x);
    expect(textBox.x+textBox.width).toBeLessThanOrEqual(width);
  }
});

test('Google Tasks editor shows a short message when no organizations are assigned',async({page})=>{
  await mock(page);
  await page.route(`${SB}/rest/v1/app_spaces**`,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await page.route(`${SB}/rest/v1/app_suborganization_assignees**`,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await page.route(`${SB}/rest/v1/app_suborganizations**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:'not-mine',name:'담당 아닌 조직'}])}));
  await page.route(`${SB}/functions/v1/google-tasks**`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({connected:true,authorized:true,needs_reconnect:false,tasks:[]})}));
  await login(page);await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await page.locator('#newTaskBtn').click();
  const organizations=page.locator('#gtEditLinkBody [role="group"][aria-label="조직"]');
  await expect(organizations).toContainText('담당 조직이 없습니다.');
  await expect(organizations.locator('[data-gt-link]')).toHaveCount(0);
});

test('unlinked Google tasks load only when their folded section opens',async({page})=>{
  await mock(page);await mockLinkTargets(page);
  const calls=[];
  await page.route(`${SB}/functions/v1/google-tasks**`,async route=>{
    const action=new URL(route.request().url()).searchParams.get('action');calls.push(action);
    const ok=x=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x)});
    if(action==='overview')return ok({connected:true,authorized:true,needs_reconnect:false,tasks:[gt('g1',googleDue(0))]});
    if(action==='unlinked')return ok({tasks:[gt('free-undated',null,{title:'기한 없는 할 일'}),gt('free-late',googleDue(20),{title:'한참 뒤 할 일'})]});
    if(action==='links')return ok({links:[]});
    return ok({ok:true});
  });
  await login(page);await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await expect(page.locator('#gtTaskSection')).toContainText('g1');
  const fold=page.locator('#gtUnlinked');
  await expect(fold).not.toHaveAttribute('open','');
  expect(calls).not.toContain('unlinked');
  await fold.locator('summary').click();
  await expect(page.locator('#gtUnlinkedBody [data-gt-unlinked-task]')).toHaveCount(2);
  await expect(fold.locator('[data-gt-unlinked-count]')).toHaveText('2');
  await expect(page.locator('#gtUnlinkedBody')).toContainText('기한 미정');
  await page.locator('[data-gt-unlinked-link="free-undated"]').click();
  await expect(page.locator('#gtTaskModal')).toBeVisible();
  await expect(page.locator('#gtEditTitle')).toHaveValue('기한 없는 할 일');
  await expect(page.locator('#gtEditLinkBody input[value="p:p1"]')).toBeFocused();
  for(const width of [360,1280]){
    await page.setViewportSize({width,height:800});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
  }
});
