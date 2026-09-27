import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';

// TASK-구현 PR 1: completing or reopening a Google task shows at once and saves in the background.
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
async function openTasks(browser,{onToggle,onOverview}={}){
  const context=await browser.newContext({timezoneId:'Asia/Seoul'});
  const page=await context.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  await mockBase(page);
  const google={a:gt('a','2026-09-27T00:00:00.000Z'),b:gt('b','2026-09-28T00:00:00.000Z')};
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
  await page.goto(loginEntry('http://127.0.0.1:8123/app/'));
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
const cached=page=>page.evaluate(()=>{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k.includes('google-tasks-v2:'))return JSON.parse(localStorage.getItem(k)).tasks.map(t=>`${t.id}:${t.status}`)}return null});

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
  expect(await cached(page)).toEqual(expect.arrayContaining(['a:completed','b:needsAction']));
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
  expect(await cached(page)).toEqual(expect.arrayContaining(['a:needsAction']));
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
  await page.locator('[data-gt-refresh]').click();
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
  await page.locator('[data-gt-refresh]').click();
  await expect.poll(()=>calls.overview).toBe(before+2);
  await page.waitForTimeout(300);
  await expect(row(page,'b')).toHaveClass(/completed/);
  saveHold.open();
  await expect.poll(()=>calls.toggles.length).toBe(2);
  await expect(row(page,'b')).toHaveClass(/completed/);
  // A later load reflects Google as usual.
  await page.locator('[data-gt-refresh]').click();
  await expect.poll(()=>calls.overview).toBe(before+3);
  await expect(row(page,'a')).toHaveClass(/completed/);
  await expect(row(page,'b')).toHaveClass(/completed/);
  await context.close();
});
