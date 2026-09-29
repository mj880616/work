import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const APP_ORIGIN=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
const NOW='2026-09-28T03:00:00.000Z';
const task=(id,extra={})=>({id,title:id,taskListId:'l1',taskListTitle:'QA',due:'2026-09-28T00:00:00.000Z',status:'needsAction',completed:null,source:'google-task',...extra});
const ok=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
const row=(page,id)=>page.locator(`#gtTaskBody [data-google-task="${id}"]`);

async function openTasks(browser,{onDelete,onOverview,onToggle,reducedMotion='no-preference'}={}){
  const context=await browser.newContext({timezoneId:'Asia/Seoul',reducedMotion});
  const page=await context.newPage();
  await page.clock.setFixedTime(new Date(NOW));
  const google={a:task('a'),b:task('b'),c:task('c',{status:'completed',completed:NOW})};
  const calls={deletes:[],overviews:0};
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname,action=u.searchParams.get('action');
    if(p==='/auth/v1/token')return ok(route,{access_token:'qa',refresh_token:'qa',expires_in:3600,expires_at:4102444800,user:{id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}}});
    if(p==='/auth/v1/user')return ok(route,{id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}});
    if(p==='/rest/v1/app_workspace_members')return ok(route,[{workspace_id:'qa-ws',user_id:'qa-user',role:'owner'}]);
    if(p==='/rest/v1/app_workspaces')return ok(route,[{id:'qa-ws',name:'QA Workspace'}]);
    if(p==='/rest/v1/app_profiles')return ok(route,[{user_id:'qa-user',display_name:'QA'}]);
    if(p==='/functions/v1/google-calendar')return ok(route,{connected:false,enabled:false,calendars:[],events:[]});
    if(p==='/functions/v1/google-tasks'&&action==='overview'){
      calls.overviews++;
      const snapshot=Object.values(google).map(t=>({...t}));
      return onOverview?onOverview(route,snapshot,calls.overviews):ok(route,{connected:true,authorized:true,tasks:snapshot});
    }
    if(p==='/functions/v1/google-tasks'&&action==='delete'){
      const body=JSON.parse(req.postData()||'{}');calls.deletes.push(body);
      if(onDelete)return onDelete(route,body,google);
      delete google[body.task_id];return ok(route,{ok:true});
    }
    if(p==='/functions/v1/google-tasks'&&action==='toggle'){
      const body=JSON.parse(req.postData()||'{}');
      if(onToggle)return onToggle(route,body,google);
      google[body.task_id]={...google[body.task_id],status:body.completed?'completed':'needsAction',completed:body.completed?NOW:null};
      return ok(route,{ok:true,task:google[body.task_id]});
    }
    if(p.startsWith('/rest/v1/')||p.startsWith('/functions/v1/'))return ok(route,[]);
    return ok(route,{});
  });
  await page.goto(loginEntry(`${APP_ORIGIN}/app/`));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('qa@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:10000});
  await expect.poll(()=>page.evaluate(()=>typeof window.KPTURouter?.go==='function'),{timeout:10000}).toBeTruthy();
  await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await expect(row(page,'a')).toBeVisible({timeout:10000});
  await page.locator('#gtCompleted summary').click();
  return {context,page,google,calls};
}

test('each pending and completed row has a separate reachable delete target',async({browser})=>{
  const {context,page}=await openTasks(browser);
  for(const id of ['a','c']){
    const button=row(page,id).locator('[data-gt-delete]');
    await expect(button).toBeVisible();
    const box=await button.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    const check=await row(page,id).locator('[data-gt-toggle]').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(check.x+check.width+8);
  }
  await context.close();
});

test('undo restores the same place without sending a delete',async({browser})=>{
  const {context,page,calls}=await openTasks(browser);
  await row(page,'b').locator('[data-gt-delete]').click();
  await expect(row(page,'b')).toHaveCount(0);
  await page.locator('[data-gt-undo="b"]').click();
  await expect(row(page,'b')).toBeVisible();
  expect(await page.locator('#gtTaskBody .gt-row').evaluateAll(els=>els.map(e=>e.dataset.googleTask))).toEqual(['a','b','c']);
  await page.waitForTimeout(5200);
  expect(calls.deletes).toHaveLength(0);
  await context.close();
});

test('five seconds commits only the selected completed task',async({browser})=>{
  const {context,page,calls}=await openTasks(browser);
  await row(page,'c').locator('[data-gt-delete]').click();
  await expect(row(page,'c')).toHaveCount(0);
  expect(calls.deletes).toHaveLength(0);
  await expect.poll(()=>calls.deletes.map(x=>x.task_id),{timeout:7000}).toEqual(['c']);
  expect(calls.deletes[0]).toMatchObject({action:'delete',task_list_id:'l1'});
  await expect(page.locator('[data-gt-undo="c"]')).toHaveCount(0);
  await context.close();
});

test('failed delete restores the row and shows a short error',async({browser})=>{
  const {context,page,calls}=await openTasks(browser,{onDelete:route=>ok(route,{error:'delete failed'},500)});
  await row(page,'a').locator('[data-gt-delete]').click();
  await expect(row(page,'a')).toHaveCount(0);
  await expect.poll(()=>calls.deletes.length,{timeout:7000}).toBe(1);
  await expect(row(page,'a')).toBeVisible();
  await expect(page.locator('#gtTaskSection [data-gt-sync]')).toContainText('삭제하지 못');
  await context.close();
});

test('consecutive deletions keep independent undo timers and row order',async({browser})=>{
  const {context,page,calls}=await openTasks(browser);
  await row(page,'a').locator('[data-gt-delete]').click();
  await row(page,'b').locator('[data-gt-delete]').click();
  await expect(row(page,'a')).toHaveCount(0);
  await expect(row(page,'b')).toHaveCount(0);
  await page.locator('[data-gt-undo="a"]').click();
  await expect(row(page,'a')).toBeVisible();
  await expect.poll(()=>calls.deletes.map(x=>x.task_id),{timeout:7000}).toEqual(['b']);
  expect(await page.locator('#gtTaskBody .gt-row').evaluateAll(els=>els.map(e=>e.dataset.googleTask))).toEqual(['a','c']);
  await context.close();
});

test('delete during completion effect cannot reappear when the effect finishes',async({browser})=>{
  const {context,page,calls}=await openTasks(browser);
  await row(page,'a').locator('[data-gt-toggle]').click();
  await expect(row(page,'a')).toHaveClass(/gt-settle/);
  await row(page,'a').locator('[data-gt-delete]').click();
  await page.waitForTimeout(1000);
  await expect(row(page,'a')).toHaveCount(0);
  await expect.poll(()=>calls.deletes.map(x=>x.task_id),{timeout:7000}).toEqual(['a']);
  await context.close();
});

test('leaving the task view inside five seconds cancels deletion',async({browser})=>{
  const {context,page,calls}=await openTasks(browser);
  await row(page,'a').locator('[data-gt-delete]').click();
  await page.evaluate(()=>window.KPTURouter.go('calendar',{source:'qa'}));
  await expect(page.locator('#calendarView')).toBeVisible({timeout:10000});
  await page.waitForTimeout(5200);
  expect(calls.deletes).toHaveLength(0);
  await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await expect(row(page,'a')).toBeVisible({timeout:10000});
  await context.close();
});

test('closing the page inside five seconds sends no delete',async({browser})=>{
  const {context,page,calls}=await openTasks(browser);
  await row(page,'a').locator('[data-gt-delete]').click();
  await page.close();
  await new Promise(resolve=>setTimeout(resolve,5200));
  expect(calls.deletes).toHaveLength(0);
  await context.close();
});

test('returning to the same tab restores a deletion cancelled while hidden',async({browser})=>{
  const {context,page,calls}=await openTasks(browser);
  await row(page,'a').locator('[data-gt-delete]').click();
  await page.evaluate(()=>{
    Object.defineProperty(document,'hidden',{configurable:true,value:true});
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document,'hidden',{configurable:true,value:false});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(row(page,'a')).toBeVisible();
  await page.waitForTimeout(5200);
  expect(calls.deletes).toHaveLength(0);
  await context.close();
});

test('reduced motion keeps the controls and skips the completion animation',async({browser})=>{
  const {context,page}=await openTasks(browser,{reducedMotion:'reduce'});
  await row(page,'a').locator('[data-gt-toggle]').click();
  await expect(row(page,'a')).toHaveClass(/completed/);
  await expect(row(page,'a')).not.toHaveClass(/gt-settle/);
  await row(page,'a').locator('[data-gt-delete]').click();
  await expect(row(page,'a')).toHaveCount(0);
  await page.locator('[data-gt-undo="a"]').click();
  await expect(row(page,'a')).toBeVisible();
  await context.close();
});

test('automatic refresh cannot resurrect a pending row or move its undo position',async({browser})=>{
  const {context,page,calls}=await openTasks(browser);
  await row(page,'b').locator('[data-gt-delete]').click();
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect.poll(()=>calls.overviews).toBeGreaterThanOrEqual(2);
  await expect(row(page,'b')).toHaveCount(0);
  await page.locator('[data-gt-undo="b"]').click();
  expect(await page.locator('#gtTaskBody .gt-row').evaluateAll(els=>els.map(e=>e.dataset.googleTask))).toEqual(['a','b','c']);
  await context.close();
});

test('an overview started before deletion cannot resurrect the pending row',async({browser})=>{
  let release;
  const hold=new Promise(resolve=>{release=resolve});
  const {context,page,calls}=await openTasks(browser,{onOverview:async(route,snapshot,n)=>{
    if(n===2)await hold;
    return ok(route,{connected:true,authorized:true,tasks:snapshot});
  }});
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect.poll(()=>calls.overviews).toBeGreaterThanOrEqual(2);
  await row(page,'b').locator('[data-gt-delete]').click();
  release();
  await expect(row(page,'b')).toHaveCount(0);
  await page.locator('[data-gt-undo="b"]').click();
  expect(await page.locator('#gtTaskBody .gt-row').evaluateAll(els=>els.map(e=>e.dataset.googleTask))).toEqual(['a','b','c']);
  await context.close();
});
