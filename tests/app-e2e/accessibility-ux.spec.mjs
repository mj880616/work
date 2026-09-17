import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'a11y-user',email:'a11y@example.org',user_metadata:{display_name:'접근성 QA'}};
const workspace={id:'a11y-workspace',slug:'a11y',name:'공공기관사업팀 Workspace'};
const tasks=[{id:'a11y-task-1',workspace_id:workspace.id,title:'접근성 점검 할 일',assignee_id:user.id,created_by:user.id,status:'todo',assignment_status:'accepted',priority:'normal',project_id:null,due_at:null,created_at:'2026-09-17T00:00:00Z'}];

async function mockApp(page){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request();
    const url=new URL(req.url());
    const path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'a11y-access',refresh_token:'a11y-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email}]);
    if(path==='/rest/v1/app_workspaces')return ok([workspace]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'접근성 QA'}]);
    if(path==='/rest/v1/app_tasks')return ok(tasks);
    if(path==='/rest/v1/app_spaces')return ok([]);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

async function signIn(page){
  await page.goto(loginEntry(page.url()));
  await expect(page.locator('#emailAuthToggle')).toBeVisible({timeout:10000});
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill(user.email);
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:10000});
}

async function boot(page,viewport){
  await page.setViewportSize(viewport);
  await mockApp(page);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);
}

test('active navigation exposes aria-current',async({page})=>{
  await boot(page,{width:1024,height:768});
  await page.locator('.app-nav [data-view="tasks"]').click();
  await expect(page.locator('.app-nav [data-view="tasks"]')).toHaveAttribute('aria-current','page');
  await expect(page.locator('.app-nav [data-view="home"]')).not.toHaveAttribute('aria-current');
});

test('task dialog exposes semantics, closes on Escape, and restores trigger focus',async({page})=>{
  await boot(page,{width:1024,height:768});
  await page.locator('.app-nav [data-view="tasks"]').click();
  const trigger=page.locator('#newTaskBtn');
  await trigger.focus();
  await trigger.click();
  const modal=page.locator('#taskModal');
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute('role','dialog');
  await expect(modal).toHaveAttribute('aria-modal','true');
  const labelledby=await modal.getAttribute('aria-labelledby');
  expect(labelledby).toBeTruthy();
  await expect(page.locator('#'+labelledby)).toBeVisible();
  await expect(page.locator('#taskTitle')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(modal).toHaveClass(/hidden/);
  await expect(trigger).toBeFocused();
});

test('task dialog wraps keyboard focus within the dialog',async({page})=>{
  await boot(page,{width:1024,height:768});
  await page.locator('.app-nav [data-view="tasks"]').click();
  await page.locator('#newTaskBtn').click();
  const modal=page.locator('#taskModal');
  const first=modal.locator('[data-close="taskModal"]');
  const last=page.locator('#saveTaskBtn');
  await first.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
});

test('symbol-only controls have accessible names',async({page})=>{
  await boot(page,{width:1024,height:768});
  await expect(page.locator('#prevMonthBtn')).toHaveAttribute('aria-label','이전 달');
  await expect(page.locator('#nextMonthBtn')).toHaveAttribute('aria-label','다음 달');
  await expect(page.locator('#taskModal [data-close="taskModal"]')).toHaveAttribute('aria-label','닫기');
});

for(const viewport of [
  {width:360,height:800},
  {width:768,height:1024},
  {width:1024,height:768},
  {width:1440,height:900}
]){
  test(`core views do not overflow at ${viewport.width}`,async({page})=>{
    await boot(page,viewport);
    for(const view of ['home','calendar','tasks','projects','library','meetings','pages','team']){
      await page.locator(`.app-nav [data-view="${view}"]`).click();
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      expect(overflow,view).toBeLessThanOrEqual(1);
    }
  });
}
