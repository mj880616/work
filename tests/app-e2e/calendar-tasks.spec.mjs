import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';

// CAL-할일: Google tasks on the month calendar by due date. Pending tasks sit on their due date (overdue ones too), tasks
// completed in the last 3 days are struck and faded, undated tasks are left out, a tap opens the existing task editor, a
// missing Google connection shows the calendar as usual, and the first calendar screen never waits for tasks.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const TEST_ORIGIN=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
// 2026-10-15 12:00 in Korea.
const NOW=Date.parse('2026-10-15T03:00:00.000Z'),DAY=24*60*60*1000;
const gt=(id,title,due,extra={})=>({id,title,taskListId:'@default',taskListTitle:'내 할 일',due,notes:'',status:'needsAction',source:'google-task',...extra});
const done=(id,title,due,completedAt)=>gt(id,title,due,{status:'completed',completed:new Date(completedAt).toISOString()});
const FIXTURE=[
  gt('p1','다음 주 할 일','2026-10-20T00:00:00.000Z'),
  gt('o1','지난 할 일','2026-10-10T00:00:00.000Z'),
  done('c1','어제 끝낸 일','2026-10-14T00:00:00.000Z',NOW-DAY),
  done('c5','오래전 끝낸 일','2026-10-13T00:00:00.000Z',NOW-5*DAY),
  gt('u1','기한 없는 일',null)
];
const overview=tasks=>({connected:true,authorized:true,needs_reconnect:false,tasks,pending_scope:'all'});

async function setup(page,{now=NOW,handler}={}){
  await page.clock.setFixedTime(new Date(now));
  const calls=[];
  await page.route(`${SB}/**`,async route=>{
    const u=new URL(route.request().url()),p=u.pathname;
    const ok=x=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x??null)});
    if(p==='/auth/v1/token')return ok({access_token:'qa',refresh_token:'qa',expires_in:3600,expires_at:4102444800,user:{id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}}});
    if(p==='/auth/v1/user')return ok({id:'qa-user',email:'qa@example.org',user_metadata:{display_name:'QA'}});
    if(p==='/rest/v1/app_workspace_members')return ok([{workspace_id:'qa-ws',user_id:'qa-user',role:'owner'}]);
    if(p==='/rest/v1/app_workspaces')return ok([{id:'qa-ws',name:'QA Workspace'}]);
    if(p==='/rest/v1/app_profiles')return ok([{user_id:'qa-user',display_name:'QA'}]);
    if(p==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,calendars:[],events:[]});
    if(p==='/functions/v1/google-tasks'){
      const action=u.searchParams.get('action');calls.push({action,at:Date.now(),scope:u.searchParams.get('pending_scope')});
      if(action==='links')return ok({links:[],meeting_links:[]});
      const r=await handler(action);
      return route.fulfill({status:r.status||200,contentType:'application/json',body:JSON.stringify(r.body)});
    }
    if(p.startsWith('/rest/v1/')||p.startsWith('/functions/v1/'))return ok([]);
    return ok({});
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
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:10000});
  await expect.poll(()=>page.evaluate(()=>typeof window.KPTURouter?.go==='function'),{timeout:10000}).toBeTruthy();
}
const chip=(page,id)=>page.locator(`#calendarGrid [data-calendar-task="${id}"]`);
const cellOf=(page,id)=>chip(page,id).evaluate(el=>{
  const week=el.closest('.cmv-week'),col=Number(getComputedStyle(el).gridColumnStart)-1;
  return week.querySelectorAll('.cal-cell')[col].dataset.date;
});

test('tasks sit on their due date: overdue stays, recent completed is struck and faded, undated is left out',async({page})=>{
  const calls=await setup(page,{handler:()=>({body:overview(FIXTURE)})});
  await login(page);
  await expect(chip(page,'p1')).toBeVisible();
  expect(await cellOf(page,'p1')).toBe('2026-10-20');
  expect(await cellOf(page,'o1')).toBe('2026-10-10');
  await expect(chip(page,'o1')).toHaveClass(/cmv-task-overdue/);
  await expect(chip(page,'o1')).toHaveAttribute('aria-label','할 일: 지난 할 일, 기한 지남');
  expect(await cellOf(page,'c1')).toBe('2026-10-14');
  await expect(chip(page,'c1')).toHaveClass(/cmv-task-done/);
  await expect(chip(page,'c1')).toHaveAttribute('aria-label','할 일: 어제 끝낸 일, 완료');
  const look=await chip(page,'c1').evaluate(el=>({opacity:Number(getComputedStyle(el).opacity),line:getComputedStyle(el.querySelector('.cmv-event-title')).textDecorationLine}));
  expect(look.opacity).toBeLessThan(1);
  expect(look.line).toContain('line-through');
  await expect(chip(page,'c5')).toHaveCount(0);
  await expect(chip(page,'u1')).toHaveCount(0);
  await expect(page.locator('#calendarGrid [data-calendar-task]')).toHaveCount(3);
  // Told apart from events by shape and text, not only color: a completion circle and a "할 일" label.
  await expect(chip(page,'p1').locator('.cmv-task-mark')).toHaveCount(1);
  await expect(chip(page,'p1')).toHaveAttribute('aria-label','할 일: 다음 주 할 일');
  await expect(chip(page,'p1')).not.toHaveClass(/cm-app|cp-event/);
  expect(calls.filter(c=>c.action==='overview').map(c=>c.scope)).toEqual(['all']);
});

test('tapping a task opens the existing Google task editor and does not complete it',async({page})=>{
  const calls=await setup(page,{handler:()=>({body:overview(FIXTURE)})});
  await login(page);
  await chip(page,'p1').click();
  await expect(page.locator('#gtTaskModal')).toBeVisible();
  await expect(page.locator('#gtTaskHeading')).toHaveText('Google 할 일 수정');
  await expect(page.locator('#gtEditTitle')).toHaveValue('다음 주 할 일');
  await expect(page.locator('#gtEditDue')).toHaveValue('2026-10-20');
  await expect(page.locator('#eventModal')).toBeHidden();
  expect(calls.some(c=>c.action==='toggle')).toBeFalsy();
});

test('saving from the editor opened on the calendar reads the tasks again',async({page})=>{
  let tasks=[gt('p1','처음 제목','2026-10-20T00:00:00.000Z')];
  const calls=await setup(page,{handler:action=>{
    if(action==='update'){tasks=[gt('p1','바꾼 제목','2026-10-21T00:00:00.000Z')];return {body:{task:tasks[0]}}}
    return {body:overview(tasks)};
  }});
  await login(page);
  await chip(page,'p1').click();
  await page.locator('#gtEditTitle').fill('바꾼 제목');
  await page.locator('#gtSaveBtn').click();
  await expect(page.locator('#gtTaskModal')).toBeHidden();
  await expect(chip(page,'p1')).toHaveAttribute('aria-label','할 일: 바꾼 제목');
  expect(await cellOf(page,'p1')).toBe('2026-10-21');
  expect(calls.filter(c=>c.action==='overview')).toHaveLength(2);
});

for(const [name,body] of [
  ['not connected',{connected:false,authorized:false,needs_reconnect:false,tasks:[]}],
  ['missing Tasks permission',{connected:true,authorized:false,needs_reconnect:true,tasks:[]}],
  ['server error',null]
]){
  test(`Google ${name}: the calendar shows as usual with no tasks and no error`,async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const calls=await setup(page,{handler:()=>body?{body}:{status:500,body:{error:'upstream unavailable'}}});
    await login(page);
    await expect.poll(()=>calls.filter(c=>c.action==='overview').length).toBe(1);
    await expect(page.locator('#calendarGrid .cal-cell')).toHaveCount(35);
    await expect(page.locator('#calendarGrid [data-calendar-task]')).toHaveCount(0);
    await expect(page.locator('#toast')).toBeHidden();
    await expect(page.locator('.modal:not(.hidden)')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test('the first calendar screen does not wait for tasks',async({page})=>{
  let release=()=>{};const held=new Promise(r=>{release=r});
  const calls=await setup(page,{handler:async()=>{await held;return {body:overview(FIXTURE)}}});
  await login(page);
  // The screen is ready and drawn before any task request has been made.
  expect(calls).toEqual([]);
  await expect(page.locator('#calendarGrid .cal-cell')).toHaveCount(35);
  await expect.poll(()=>calls.length).toBe(1);
  await expect(page.locator('#calendarGrid [data-calendar-task]')).toHaveCount(0);
  release();
  await expect(chip(page,'p1')).toBeVisible();
});

test('this device\'s copy shows first and an equal fresh copy does not redraw',async({page})=>{
  let release=()=>{},hold=false,tasks=FIXTURE;
  await setup(page,{handler:async()=>{if(hold)await new Promise(r=>{release=r});return {body:overview(tasks)}}});
  await login(page);
  // The task view stores this device's copy.
  await page.evaluate(()=>window.KPTURouter.go('tasks',{source:'qa'}));
  await expect(page.locator('#gtTaskSection')).toContainText('다음 주 할 일');
  hold=true;
  await page.goto(`${TEST_ORIGIN}/app/?view=calendar`);await ready(page);
  await expect(chip(page,'p1')).toBeVisible();
  await page.evaluate(()=>{document.querySelector('[data-calendar-task="p1"]').dataset.qaMark='kept'});
  release();
  // Same data: the drawn chip stays (no redraw, no flicker).
  await page.waitForTimeout(300);
  await expect(chip(page,'p1')).toHaveAttribute('data-qa-mark','kept');
  // Changed data replaces it on the next read.
  hold=false;tasks=[gt('p1','새 제목','2026-10-20T00:00:00.000Z')];
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:google-tasks-changed')));
  await expect(chip(page,'p1')).toHaveAttribute('aria-label','할 일: 새 제목');
  await expect(page.locator('#calendarGrid [data-calendar-task]')).toHaveCount(1);
});

// Google stores a due date as midnight UTC of that date. The calendar uses its date part as it is, so neither Korean midnight
// nor a device in another time zone can move a task to the next or previous day.
for(const [label,now,overdue14] of [
  ['just before Korean midnight','2026-10-14T14:59:00.000Z',false],
  ['just after Korean midnight','2026-10-14T15:01:00.000Z',true]
]){
  for(const timezoneId of ['Asia/Seoul','America/Los_Angeles']){
    test(`due dates stay on their day ${label} (${timezoneId})`,async({browser})=>{
      const context=await browser.newContext({timezoneId});
      const page=await context.newPage();
      await setup(page,{now:Date.parse(now),handler:()=>({body:overview([
        gt('d14','14일 할 일','2026-10-14T00:00:00.000Z'),
        gt('d15','15일 할 일','2026-10-15T00:00:00.000Z')
      ])})});
      await login(page);
      await expect(chip(page,'d14')).toBeVisible();
      expect(await cellOf(page,'d14')).toBe('2026-10-14');
      expect(await cellOf(page,'d15')).toBe('2026-10-15');
      if(overdue14)await expect(chip(page,'d14')).toHaveClass(/cmv-task-overdue/);
      else await expect(chip(page,'d14')).not.toHaveClass(/cmv-task-overdue/);
      await expect(chip(page,'d15')).not.toHaveClass(/cmv-task-overdue/);
      await context.close();
    });
  }
}
