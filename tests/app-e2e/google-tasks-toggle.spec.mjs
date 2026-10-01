import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';
const TEST_ORIGIN=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';

// TASK-구현 PR 1: completing or reopening a Google task shows at once and saves in the background.
// The device copy of the last result is checked in google-tasks-cache.spec.mjs.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const NOW='2026-09-27T03:00:00.000Z';
const gt=(id,due,extra={})=>({id,title:id,taskListId:'l1',taskListTitle:'업무',due,status:'needsAction',completed:null,source:'google-task',...extra});
const ok=(route,x,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(x??null)});
const gate=()=>{let open;const wait=new Promise(r=>{open=r});return {wait,open}};

async function mockBase(page){
  await page.route(`${SB}/**`,async route=>{
    const p=new URL(route.request().url()).pathname;
    if(p==='/auth/v1/token')return ok(route,{access_token:'qa',refresh_token:'qa',expires_in:3600,expires_at:4102444800,user:{id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}}});
    if(p==='/auth/v1/user')return ok(route,{id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}});
    if(p==='/rest/v1/app_workspace_members')return ok(route,[{workspace_id:'qa-ws',user_id:'qa-user',role:'owner'}]);
    if(p==='/rest/v1/app_workspaces')return ok(route,[{id:'qa-ws',name:'QA Workspace'}]);
    if(p==='/rest/v1/app_profiles')return ok(route,[{user_id:'qa-user',display_name:'QA'}]);
    if(p==='/functions/v1/google-calendar')return ok(route,{connected:false,enabled:false,calendars:[],events:[]});
    if(p.startsWith('/rest/v1/')||p.startsWith('/functions/v1/'))return ok(route,[]);
    return ok(route,{});
  });
}

// Google state lives in `google`; overview answers from it unless a test holds or overrides the answer.
async function openTasks(browser,{onToggle,onOverview,reducedMotion='no-preference',extra={}}={}){
  const context=await browser.newContext({timezoneId:'Asia/Seoul',reducedMotion});
  const page=await context.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  await mockBase(page);
  const google={a:gt('a','2026-09-27T00:00:00.000Z'),b:gt('b','2026-09-28T00:00:00.000Z'),...extra};
  const calls={overview:0,toggles:[]};
  await page.route(`${SB}/functions/v1/google-tasks**`,async route=>{
    const req=route.request(),action=new URL(req.url()).searchParams.get('action');
    if(action==='toggle'){
      const b=JSON.parse(req.postData()||'{}');calls.toggles.push(b);
      if(onToggle)return onToggle(route,b,google);
      google[b.task_id]={...google[b.task_id],...(b.completed?{status:'completed',completed:NOW}:{status:'needsAction',completed:null})};
      return ok(route,{ok:true,task:google[b.task_id]});
    }
    calls.overview++;
    const snapshot=Object.values(google).map(t=>({...t}));
    if(onOverview)return onOverview(route,snapshot,calls.overview);
    return ok(route,{connected:true,authorized:true,needs_reconnect:false,tasks:snapshot});
  });
  await page.goto(loginEntry(`${TEST_ORIGIN}/app/`));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('qa@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:10000});
  await expect.poll(()=>page.evaluate(()=>typeof window.KPTURouter?.go==='function'),{timeout:10000}).toBeTruthy();
  await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await expect(page.locator('#gtTaskBody [data-google-task="a"]')).toBeVisible({timeout:10000});
  return {context,page,google,calls};
}

const row=(page,id)=>page.locator(`#gtTaskBody .gt-row[data-google-task="${id}"]`);

test('completing a Google task shows at once, saves in the background and does not reload the list',async({browser})=>{
  const hold=gate();
  const {context,page,calls}=await openTasks(browser,{onToggle:async(route,b,google)=>{
    await hold.wait;
    google.a={...google.a,status:'completed',completed:NOW};
    return ok(route,{ok:true,task:google.a});
  }});
  const loads=calls.overview;
  await row(page,'a').locator('[data-gt-toggle]').click();
  // Shown as completed while the save is still in flight.
  await expect(row(page,'a')).toHaveClass(/completed/);
  await expect(row(page,'a').locator('[data-gt-toggle]')).toHaveAttribute('aria-label','완료 취소');
  expect(calls.toggles).toEqual([expect.objectContaining({action:'toggle',task_id:'a',task_list_id:'l1',completed:true})]);
  hold.open();
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#gtTaskSection [data-gt-sync]').textContent)).toBe('');
  await page.waitForTimeout(300);
  await expect(row(page,'a')).toHaveClass(/completed/);
  expect(calls.overview).toBe(loads);
  expect(calls.toggles).toHaveLength(1);
  await context.close();
});

test('a failed save puts the task back and says so',async({browser})=>{
  const {context,page}=await openTasks(browser,{onToggle:route=>ok(route,{error:'Google 저장 실패'},500)});
  await row(page,'a').locator('[data-gt-toggle]').click();
  const sync=page.locator('#gtTaskSection [data-gt-sync]');
  await expect(sync).toHaveText('완료를 저장하지 못해 되돌렸습니다');
  await expect(sync).toHaveAttribute('role','status');
  await expect(row(page,'a')).toHaveClass(/pending/);
  await expect(row(page,'a')).not.toHaveClass(/completed/);
  await context.close();
});

test('repeated taps save in order and only the last wish',async({browser})=>{
  const holds=[gate(),gate()];let n=0;
  const {context,page,calls}=await openTasks(browser,{onToggle:async(route,b,google)=>{
    await holds[n++].wait;
    google[b.task_id]={...google[b.task_id],...(b.completed?{status:'completed',completed:NOW}:{status:'needsAction',completed:null})};
    return ok(route,{ok:true,task:google[b.task_id]});
  }});
  const toggle=()=>row(page,'a').locator('[data-gt-toggle]').click();
  // complete → reopen → complete → reopen while the first save is held.
  await toggle();await toggle();await toggle();await toggle();
  await expect(row(page,'a')).toHaveClass(/pending/);
  expect(calls.toggles.map(x=>x.completed)).toEqual([true]);
  holds[0].open();
  // The second save starts only after the first answered, and carries the last tapped state.
  await expect.poll(()=>calls.toggles.map(x=>x.completed)).toEqual([true,false]);
  await expect(row(page,'a')).toHaveClass(/pending/);
  holds[1].open();
  await page.waitForTimeout(300);
  expect(calls.toggles.map(x=>x.completed)).toEqual([true,false]);
  await expect(row(page,'a')).toHaveClass(/pending/);
  await context.close();
});

test('three quick taps that end on complete send a single save',async({browser})=>{
  const hold=gate();
  const {context,page,calls}=await openTasks(browser,{onToggle:async(route,b,google)=>{
    await hold.wait;
    google.a={...google.a,status:'completed',completed:NOW};
    return ok(route,{ok:true,task:google.a});
  }});
  const toggle=()=>row(page,'a').locator('[data-gt-toggle]').click();
  await toggle();await toggle();await toggle();
  await expect(row(page,'a')).toHaveClass(/completed/);
  hold.open();
  await page.waitForTimeout(300);
  expect(calls.toggles.map(x=>x.completed)).toEqual([true]);
  await expect(row(page,'a')).toHaveClass(/completed/);
  await context.close();
});

test('a list load that answers with the old state does not undo a tap made during it',async({browser})=>{
  let holdLoad=null;
  const saveHold=gate();let holdSave=false;
  const {context,page,calls}=await openTasks(browser,{
    onOverview:async(route,snapshot)=>{const g=holdLoad;if(g)await g.wait;return ok(route,{connected:true,authorized:true,needs_reconnect:false,tasks:snapshot})},
    onToggle:async(route,b,google)=>{if(holdSave)await saveHold.wait;google[b.task_id]={...google[b.task_id],...(b.completed?{status:'completed',completed:NOW}:{status:'needsAction',completed:null})};return ok(route,{ok:true,task:google[b.task_id]})}
  });
  // 1) Load starts (old state captured), tap saves and finishes, then the old load answers.
  holdLoad=gate();const first=holdLoad;
  const before=calls.overview;
  await page.evaluate(()=>{window.KPTURouter.go('calendar',{source:'qa'});window.KPTURouter.go('tasks',{source:'qa'})});
  await expect.poll(()=>calls.overview).toBe(before+1);
  await row(page,'a').locator('[data-gt-toggle]').click();
  await expect.poll(()=>calls.toggles.length).toBe(1);
  await expect(row(page,'a')).toHaveClass(/completed/);
  holdLoad=null;first.open();
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#gtTaskSection [data-gt-sync]').textContent)).toBe('');
  await expect(row(page,'a')).toHaveClass(/completed/);
  // 2) Save is held; a load answers with the old state for b meanwhile.
  holdSave=true;
  await row(page,'b').locator('[data-gt-toggle]').click();
  await expect(row(page,'b')).toHaveClass(/completed/);
  await page.evaluate(()=>{window.KPTURouter.go('calendar',{source:'qa'});window.KPTURouter.go('tasks',{source:'qa'})});
  await expect.poll(()=>calls.overview).toBe(before+2);
  await page.waitForTimeout(300);
  await expect(row(page,'b')).toHaveClass(/completed/);
  saveHold.open();
  await expect.poll(()=>calls.toggles.length).toBe(2);
  await expect(row(page,'b')).toHaveClass(/completed/);
  // A later load reflects Google as usual.
  await page.evaluate(()=>{window.KPTURouter.go('calendar',{source:'qa'});window.KPTURouter.go('tasks',{source:'qa'})});
  await expect.poll(()=>calls.overview).toBe(before+3);
  await expect(row(page,'a')).toHaveClass(/completed/);
  await expect(row(page,'b')).toHaveClass(/completed/);
  await context.close();
});

// TASK-구현 PR 1-보완: the tapped row changes in place first (check drawn, title struck), then fades and moves.
const order=page=>page.locator('#gtTaskBody .gt-row').evaluateAll(rs=>rs.map(r=>r.dataset.googleTask));
const effectClasses=page=>page.locator('#gtTaskBody .gt-row').evaluateAll(rs=>rs.flatMap(r=>[...r.classList].filter(c=>/^gt-(settle|anim-)/.test(c))));

test('completing keeps the checked and struck row in place for three seconds, then moves it',async({browser})=>{
  const hold=gate();
  const {context,page,calls}=await openTasks(browser,{onToggle:async(route,b,google)=>{
    await hold.wait;
    google.a={...google.a,status:'completed',completed:NOW};
    return ok(route,{ok:true,task:google.a});
  }});
  expect(await order(page)).toEqual(['a','b']);
  const started=Date.now();
  await row(page,'a').locator('[data-gt-toggle]').click();
  // In place: circle filled, check drawn, title struck, still first. The save already started.
  await expect(row(page,'a')).toHaveClass(/completed/);
  await expect(row(page,'a')).toHaveClass(/gt-settle/);
  await expect(row(page,'a')).toHaveClass(/gt-anim-on/);
  expect(await order(page)).toEqual(['a','b']);
  expect(calls.toggles).toHaveLength(1);
  const look=await row(page,'a').evaluate(r=>({check:getComputedStyle(r.querySelector('.gt-check'),'::after').content,strike:getComputedStyle(r.querySelector('.gt-main b')).textDecorationLine,animations:r.getAnimations({subtree:true}).map(a=>a.animationName).sort()}));
  expect(look.check).toBe('""');
  expect(look.strike).toBe('line-through');
  expect(look.animations).toEqual(expect.arrayContaining(['gt-draw','gt-fill','gt-settle','gt-strike']));
  await page.waitForTimeout(2200);
  expect(await order(page)).toEqual(['a','b']);
  await expect(row(page,'a')).toBeVisible();
  await expect.poll(()=>order(page),{timeout:2500}).toEqual(['b','a']);
  expect(Date.now()-started).toBeGreaterThanOrEqual(3000);
  await expect(row(page,'a')).not.toHaveClass(/gt-settle/);
  await expect(row(page,'a')).toHaveClass(/completed/);
  hold.open();
  await expect.poll(()=>page.evaluate(()=>document.querySelector('#gtTaskSection [data-gt-sync]').textContent)).toBe('');
  expect(await order(page)).toEqual(['b','a']);
  expect(calls.toggles).toHaveLength(1);
  await context.close();
});

test('a tap during the effect stops it and shows the new state at once',async({browser})=>{
  const {context,page,calls}=await openTasks(browser);
  const toggle=()=>row(page,'a').locator('[data-gt-toggle]').click();
  await toggle();
  await expect(row(page,'a')).toHaveClass(/gt-settle/);
  await toggle();
  await expect(row(page,'a')).toHaveClass(/pending/);
  expect(await effectClasses(page)).toEqual([]);
  expect(await order(page)).toEqual(['a','b']);
  await page.waitForTimeout(1200);
  expect(await order(page)).toEqual(['a','b']);
  await expect(row(page,'a')).toHaveClass(/pending/);
  expect(await effectClasses(page)).toEqual([]);
  await expect.poll(()=>calls.toggles.map(x=>x.completed)).toEqual([true,false]);
  await context.close();
});

test('a save that fails after the row moved shows the row going back to where it was',async({browser})=>{
  const hold=gate();
  const {context,page}=await openTasks(browser,{onToggle:async route=>{await hold.wait;return ok(route,{error:'Google 저장 실패'},500)}});
  await row(page,'a').locator('[data-gt-toggle]').click();
  await expect.poll(()=>order(page),{timeout:4500}).toEqual(['b','a']);
  hold.open();
  // Unchecked in the completed part first, then back to its place above b.
  await expect(row(page,'a')).toHaveClass(/gt-anim-off/);
  await expect(row(page,'a')).toHaveClass(/pending/);
  expect(await order(page)).toEqual(['b','a']);
  await expect.poll(()=>order(page),{timeout:3000}).toEqual(['a','b']);
  await expect(page.locator('#gtTaskSection [data-gt-sync]')).toHaveText('완료를 저장하지 못해 되돌렸습니다');
  await expect(row(page,'a')).not.toHaveClass(/gt-settle/);
  await context.close();
});

test('a save that fails during the effect unchecks the row in place',async({browser})=>{
  const {context,page}=await openTasks(browser,{onToggle:route=>ok(route,{error:'Google 저장 실패'},500)});
  await row(page,'a').locator('[data-gt-toggle]').click();
  await expect(page.locator('#gtTaskSection [data-gt-sync]')).toHaveText('완료를 저장하지 못해 되돌렸습니다');
  await expect(row(page,'a')).toHaveClass(/pending/);
  await page.waitForTimeout(1200);
  expect(await order(page)).toEqual(['a','b']);
  await expect(row(page,'a')).toHaveClass(/pending/);
  await context.close();
});

test('reopening a task outside the shown dates plays the effect and then leaves the list',async({browser})=>{
  const {context,page,calls}=await openTasks(browser,{extra:{c:gt('c','2026-10-20T00:00:00.000Z',{status:'completed',completed:NOW})}});
  await expect(row(page,'c')).toHaveClass(/completed/);
  await page.locator('#gtCompleted summary').click();
  await row(page,'c').locator('[data-gt-toggle]').click();
  await expect(row(page,'c')).toHaveClass(/pending/);
  await expect(row(page,'c')).toHaveClass(/gt-anim-off/);
  await expect(row(page,'c')).toHaveClass(/gt-settle/);
  expect(calls.toggles.map(x=>x.completed)).toEqual([false]);
  await expect(row(page,'c')).toHaveCount(0,{timeout:3000});
  expect(await order(page)).toEqual(['a','b']);
  await context.close();
});

test('with reduced motion the row stays for three seconds without animation',async({browser})=>{
  const {context,page}=await openTasks(browser,{reducedMotion:'reduce'});
  await row(page,'a').locator('[data-gt-toggle]').click();
  expect(await order(page)).toEqual(['a','b']);
  await expect(row(page,'a')).toHaveClass(/completed/);
  expect(await row(page,'a').evaluate(r=>r.getAnimations({subtree:true}).length)).toBe(0);
  await expect.poll(()=>order(page),{timeout:4500}).toEqual(['b','a']);
  await context.close();
});

test('a linked task can be reopened during its first save',async({browser})=>{
  const hold=gate();
  const {context,page,calls}=await openTasks(browser,{onToggle:async(route,b,google)=>{
    if(b.completed)await hold.wait;
    google[b.task_id]={...google[b.task_id],status:b.completed?'completed':'needsAction',completed:b.completed?NOW:null};
    return ok(route,{ok:true,task:google[b.task_id]});
  }});
  await page.route(`${SB}/functions/v1/google-tasks?action=linked**`,route=>ok(route,{tasks:[gt('a','2026-09-27T00:00:00.000Z')]}));
  await page.evaluate(()=>{const box=document.createElement('div');box.id='linkedTest';document.body.append(box);window.KPTUGoogleTasks.mountLinked(box,{project_id:'project-1'})});
  const linked=page.locator('#linkedTest [data-google-task="a"]');
  await expect(linked).toBeVisible();
  await linked.locator('[data-gt-linked-toggle]').click();
  await expect(linked).toHaveClass(/completed/);
  await linked.locator('[data-gt-linked-toggle]').click();
  await expect(linked).toHaveClass(/pending/);
  hold.open();
  await expect.poll(()=>calls.toggles.map(x=>x.completed)).toEqual([true,false]);
  await context.close();
});

test('consecutive completions keep independent three second timers',async({browser})=>{
  const {context,page,calls}=await openTasks(browser);
  await row(page,'a').locator('[data-gt-toggle]').click();
  await page.waitForTimeout(1400);
  await row(page,'b').locator('[data-gt-toggle]').click();
  expect(calls.toggles.map(x=>x.task_id)).toEqual(['a','b']);
  await expect.poll(()=>order(page),{timeout:2500}).toEqual(['b','a']);
  await expect(row(page,'b')).toHaveClass(/completed/);
  await expect(page.locator('#gtTaskBody [data-gt-week] [data-google-task="b"]')).toBeVisible();
  await expect.poll(()=>page.locator('#gtCompleted [data-google-task]').count(),{timeout:2500}).toBe(2);
  await context.close();
});

test('leaving during the three second display keeps the saved completion',async({browser})=>{
  const {context,page,google}=await openTasks(browser);
  await row(page,'a').locator('[data-gt-toggle]').click();
  await expect(row(page,'a')).toHaveClass(/completed/);
  await page.evaluate(()=>window.KPTURouter.go('calendar',{source:'qa'}));
  await expect.poll(()=>google.a.status).toBe('completed');
  await page.waitForTimeout(3100);
  await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await expect(page.locator('#gtCompleted [data-google-task="a"]')).toHaveClass(/completed/);
  await context.close();
});

test('a failed linked save restores the row and announces the error',async({browser})=>{
  const {context,page}=await openTasks(browser,{onToggle:route=>ok(route,{error:'Google 저장 실패'},500)});
  await page.route(`${SB}/functions/v1/google-tasks?action=linked**`,route=>ok(route,{tasks:[gt('a','2026-09-27T00:00:00.000Z')]}));
  await page.evaluate(()=>{const box=document.createElement('div');box.id='linkedTest';document.body.append(box);window.KPTUGoogleTasks.mountLinked(box,{project_id:'project-1'})});
  const linked=page.locator('#linkedTest [data-google-task="a"]');
  await expect(linked).toBeVisible();
  await linked.locator('[data-gt-linked-toggle]').click();
  await expect(linked).toHaveClass(/pending/);
  await expect(page.locator('#linkedTest [data-gt-linked-msg]')).toContainText('완료를 저장하지 못해 되돌렸습니다');
  await context.close();
});
