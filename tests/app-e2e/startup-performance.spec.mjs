import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { loginEntry } from './helpers/login-entry.mjs';

const loaderUrl='http://127.0.0.1:8123/app/loader-v2.js?p6-startup-contract=1';
const read=path=>readFileSync(path,'utf8');

test('authenticated home commits before non-critical feature bundle', async ({ page }) => {
  const response=await page.request.get(loaderUrl);
  expect(response.ok()).toBeTruthy();
  const source=await response.text();
  const usable=source.indexOf('window.__KPTU_MARK_APP_UI_READY__?.({usable:homeResult?.ok===true})');
  const deferred=source.indexOf('defer(()=>loadFeatures()');
  expect(source).toContain('const [homeResult]=await Promise.all([window.__KPTU_HOME_READY__,mobileNavigationReady])');
  const router=read('app/app-router.js');
  expect(router).toContain('authenticatedShellReady()');
  expect(router).toContain('appReady()||authenticatedShellReady()');
  expect(source).toContain('await window.__KPTU_START_TEAM_DATA__()');
  expect(read('app/home-dashboard-v2.js')).toContain('resolveReady?.({ok:false})');
  expect(read('app/app.js')).toContain("mark(usable?'homeUsable':'uiReadyOnly')");
  expect(usable).toBeGreaterThan(0);
  expect(deferred).toBeGreaterThan(usable);
  const criticalAwaitedImports=source.split('\n').filter(line=>/^  await import\(/.test(line));
  for(const path of ['project-system-v3','profile-settings','media-workflow','meeting-round-detail','google-tasks']){
    expect(criticalAwaitedImports.some(line=>line.includes(path))).toBeFalsy();
  }
});

test('direct feature URLs wait for the feature bundle and failures remain visible', async ({ page }) => {
  const source=await (await page.request.get(loaderUrl)).text();
  expect(source).toContain("if(requested&&requested!=='home')await loadFeatures()");
  expect(source).toContain("box.id='deferredFeatureError'");
  expect(source).toContain("setAttribute('role','alert')");
  expect(source).toContain('이 기능을 불러오지 못했습니다.');
});

test('home reuses authenticated boot context and guards stale-session commits', async () => {
  const home=read('app/home-dashboard-v2.js');
  const team=read('app/team.js');
  expect(home).toContain('window.__KPTU_BOOT_CONTEXT__');
  expect(home).toContain('if(epoch!==renderEpoch)return');
  expect(home).toContain("addEventListener('kptu:session-changed'");
  expect(team).toContain("addEventListener('kptu:session-changed'");
  expect(team).toContain("showOnly('authView')");
});

test('page builder and AI modules remain lazy or background-only', async ({ page }) => {
  const source=await (await page.request.get(loaderUrl)).text();
  expect(source).toContain("addEventListener('kptu:page-editor-opened',lazyPageBuilderOpen)");
  expect(source).toContain('await window.__KPTU_PAGE_BUILDER_READY__');
  for(const modulePath of ['./workplace-ai-report.js','./workflow-ai-v3.js']){
    expect(source.indexOf(modulePath)).toBeGreaterThan(source.indexOf("startup?.mark('allInitialModulesComplete')"));
  }
});

test('feature navigation waits for deferred readiness and bootstrap loads access approval', async () => {
  const source=read('app/loader-v2.js');
  expect(source).toContain("if(teamState==='bootstrap'){await import('./access-approval.js?v=4');return}");
  expect(source).toContain("event.stopImmediatePropagation()");
  expect(source).toContain('#appView [data-hdv-goto]');
  expect(source).toContain('#appView [data-hdv-project]');
  expect(source).toContain('#newTaskBtn');
  expect(source).toContain("loadFeatures().then(()=>{status.remove()");
  expect(source).toContain("const [homeResult]=await Promise.all([window.__KPTU_HOME_READY__,mobileNavigationReady])");
});

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
async function loginWithMock(page,{delayGroups=false}={}){
  const user={id:'p6-flow-user',email:'p6-flow@example.org',user_metadata:{display_name:'P6 QA'}};
  await page.route(SB+'/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(delayGroups&&path==='/rest/v1/app_groups')await new Promise(resolve=>setTimeout(resolve,700));
    const data=path==='/auth/v1/token'?{access_token:'p6-flow-access',refresh_token:'p6-flow-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600}:
      path==='/auth/v1/user'?user:
      path==='/rest/v1/app_workspace_members'?[{workspace_id:'p6-flow-workspace',user_id:user.id,role:'owner'}]:
      path==='/rest/v1/app_workspaces'?[{id:'p6-flow-workspace',name:'공공기관사업팀 Workspace'}]:
      path==='/rest/v1/app_profiles'?[{user_id:user.id,display_name:'P6 QA'}]:
      path==='/functions/v1/google-calendar'?{connected:false,enabled:false,selected:[],calendars:[],events:[]}:
      path==='/functions/v1/push-notifications'?{enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'}:
      path.startsWith('/rest/v1/')?[]:{};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(loginEntry('http://127.0.0.1:8123/app/'));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill(user.email);
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await page.waitForURL('http://127.0.0.1:8123/app/');
  await page.waitForFunction(()=>typeof window.__KPTU_STARTUP__?.marks?.homeUsable==='number');
}

test('home shortcut waits for deferred feature data on first click',async({page})=>{
  await loginWithMock(page,{delayGroups:true});
  await page.locator('#hdvTaskPanel [data-hdv-goto]').click();
  await expect(page.locator('#deferredFeatureStatus')).toBeVisible();
  await expect(page.locator('#tasksView')).toBeVisible({timeout:15000});
  await expect(page.locator('#deferredFeatureStatus')).toHaveCount(0);
});

test('deferred module failure leaves home usable and shows an alert',async({page})=>{
  await page.route('**/app/project-system-v3.js*',route=>route.abort());
  await loginWithMock(page);
  await page.locator('#appView .app-nav [data-view="projects"]').click();
  await expect(page.locator('#deferredFeatureError')).toHaveAttribute('role','alert');
  await expect(page.locator('#deferredFeatureError')).toContainText('이 기능을 불러오지 못했습니다.');
  await expect(page.locator('#homeView')).toBeVisible();
});
