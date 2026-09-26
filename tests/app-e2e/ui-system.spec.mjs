import { test, expect } from '@playwright/test';
import { enterLogin } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'ui-system-user',email:'ui-system@example.org',user_metadata:{display_name:'UI QA'}};
const workspace={id:'ui-system-workspace',slug:'ui-system',name:'웹2'};
const tasks=Array.from({length:24},(_,i)=>({id:`ui-task-${i+1}`,workspace_id:workspace.id,title:`UI 점검 할 일 ${i+1}`,assignee_id:user.id,created_by:user.id,status:'todo',assignment_status:'accepted',priority:'normal',project_id:null,due_at:`2026-09-${String(15+(i%10)).padStart(2,'0')}T09:00:00Z`,created_at:'2026-09-14T00:00:00Z'}));

async function mockApp(page){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request();
    const url=new URL(req.url());
    const path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'ui-access',refresh_token:'ui-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email}]);
    if(path==='/rest/v1/app_workspaces')return ok([workspace]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'UI QA'}]);
    if(path==='/rest/v1/app_tasks')return ok(tasks);
    if(path==='/rest/v1/app_spaces')return ok([]);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

async function signIn(page){
  await enterLogin(page);
  await expect(page.locator('#emailAuthToggle')).toBeVisible({timeout:10000});
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill(user.email);
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
}

async function buttonHeight(page,view,selector){
  await page.locator(`[data-view="${view}"]`).first().click();
  const button=page.locator(selector);
  await expect(button).toBeVisible({timeout:10000});
  return button.evaluate(el=>el.getBoundingClientRect().height);
}

test('calendar uses a smaller add control while other top-level actions stay consistent and mobile content reaches the viewport bottom',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:390,height:844});
  await mockApp(page);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);
  await expect(page.locator('#ccMobileDock')).toHaveCount(0);

  const calendarAdd=await buttonHeight(page,'calendar','#newEventBtn');
  expect(calendarAdd).toBeLessThanOrEqual(32);

  const heights=[];
  heights.push(await buttonHeight(page,'tasks','#newTaskBtn'));
  heights.push(await buttonHeight(page,'projects','#newProjectBtn'));
  heights.push(await buttonHeight(page,'library','#newDocumentBtn'));
  heights.push(await buttonHeight(page,'meetings','#newMeetingBtn'));

  expect(Math.max(...heights)-Math.min(...heights)).toBeLessThanOrEqual(.5);
  for(const height of heights)expect(height).toBeCloseTo(36,0);

  await page.locator('[data-view="tasks"]').first().click();
  const rows=page.locator('#taskList .tl-task-row');
  await expect(rows).toHaveCount(24,{timeout:10000});
  await page.evaluate(()=>{
    const items=document.querySelectorAll('#taskList .tl-task-row');
    items[items.length-1]?.scrollIntoView({block:'end'});
  });
  await page.waitForTimeout(80);
  const clearance=await page.evaluate(()=>{
    const items=document.querySelectorAll('#taskList .tl-task-row');
    const item=items[items.length-1]?.getBoundingClientRect();
    return item?{itemBottom:item.bottom,viewportBottom:innerHeight,scrollY:window.scrollY,docHeight:document.documentElement.scrollHeight}:null;
  });
  expect(clearance).not.toBeNull();
  expect(clearance.itemBottom).toBeLessThanOrEqual(clearance.viewportBottom-4);
  expect(clearance.scrollY).toBeGreaterThan(0);
});
