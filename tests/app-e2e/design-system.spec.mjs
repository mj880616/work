import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'design-system-user',email:'design-system@example.org',user_metadata:{display_name:'Design QA'}};
const workspace={id:'design-system-workspace',slug:'design-system',name:'공공기관사업팀 Workspace'};

async function mockApp(page){
  await page.route(`${SB}/**`,async route=>{
    const url=new URL(route.request().url());
    const path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'design-access',refresh_token:'design-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email}]);
    if(path==='/rest/v1/app_workspaces')return ok([workspace]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'Design QA'}]);
    if(path==='/rest/v1/app_tasks')return ok([]);
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
}

async function actionMetrics(page,view,selector){
  await page.locator(`[data-view="${view}"]`).first().click();
  const el=page.locator(selector);
  await expect(el).toBeVisible({timeout:10000});
  return el.evaluate(node=>({
    height:node.getBoundingClientRect().height,
    radius:getComputedStyle(node).borderRadius,
    fontSize:getComputedStyle(node).fontSize
  }));
}

test('Design System 1.0 keeps the top-level action contract with a compact calendar exception',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:1024,height:900});
  await mockApp(page);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);

  const tokenNames=[
    '--kptu-bg','--kptu-surface','--kptu-ink','--kptu-muted','--kptu-border',
    '--kptu-primary','--kptu-success','--kptu-warning','--kptu-danger','--kptu-info',
    '--kptu-space-1','--kptu-space-2','--kptu-space-3','--kptu-space-4','--kptu-space-5','--kptu-space-6',
    '--kptu-radius-sm','--kptu-radius-md','--kptu-radius-lg',
    '--kptu-control-height','--kptu-action-compact-height'
  ];
  const values=await page.evaluate(names=>{
    const style=getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map(name=>[name,style.getPropertyValue(name).trim()]));
  },tokenNames);
  for(const name of tokenNames)expect(values[name],name).not.toBe('');

  const calendarAction=await actionMetrics(page,'calendar','#newEventBtn');
  expect(calendarAction.height).toBeLessThanOrEqual(32);

  const actions=[
    ['tasks','#newTaskBtn'],['projects','#newProjectBtn'],
    ['library','#newDocumentBtn'],['meetings','#newMeetingBtn']
  ];
  const metrics=[];
  for(const [view,selector] of actions)metrics.push(await actionMetrics(page,view,selector));
  expect(new Set(metrics.map(x=>Math.round(x.height))).size).toBe(1);
  for(const metric of metrics)expect(metric.height).toBeCloseTo(36,0);
  expect(new Set(metrics.map(x=>x.radius)).size).toBe(1);

  await page.locator('[data-view="home"]').first().click();
  const panel=page.locator('#homeView .panel:not(.hidden)').first();
  await expect(panel).toBeVisible({timeout:10000});
  const cardStyle=await panel.evaluate(el=>({radius:getComputedStyle(el).borderRadius,shadow:getComputedStyle(el).boxShadow}));
  expect(cardStyle.radius).toBe('12px');
  expect(cardStyle.shadow).toBe('none');

  await page.locator('[data-view="tasks"]').first().click();
  await page.locator('#newTaskBtn').click();
  const modal=page.locator('#taskModal .modal-card');
  await expect(modal).toBeVisible();
  expect(await modal.evaluate(el=>getComputedStyle(el).borderRadius)).toBe('12px');
});
