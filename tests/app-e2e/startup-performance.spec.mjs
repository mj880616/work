import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { loginEntry } from './helpers/login-entry.mjs';

const loaderUrl='http://127.0.0.1:8123/app/loader-v2.js?p6-startup-contract=1';
const read=path=>readFileSync(path,'utf8');

test('shell has a single visible Web2 brand and no duplicate workspace heading',async()=>{
  const html=read('app/index.html');
  expect((html.match(/<span>웹2<\/span>/g)||[]).length).toBe(1);
  expect(html).not.toContain('class="workspace-head"');
  expect(html).not.toContain('id="workspaceName"');
});

test('authenticated session exposes a non-sensitive startup shell before workspace membership resolves', async () => {
  const html=read('app/index.html');
  expect(html).toContain('id="bootView"');
  expect(html).toContain('업무 공간을 확인하고 있습니다.');
  const loader=read('app/loader-v2.js');
  expect(loader.indexOf("document.querySelector('#bootView')")).toBeLessThan(loader.indexOf("workspacePrefetchStart"));
  expect(loader).toContain("mark('authenticatedShellVisible')");
  expect(loader).toContain("mark('membershipCheckStart')");
  expect(loader).toContain("mark('membershipCheckComplete')");
  const team=read('app/team.js');
  expect(team).toContain("'authView','bootstrapView','appView','bootView'");
});

test('startup assets are discovered from the document head without changing auth gates', async () => {
  const html=read('app/index.html');
  const head=html.slice(0,html.indexOf('</head>'));
  const body=html.slice(html.indexOf('<body>'));
  expect(head).toContain('<script src="./app.js?v=76" defer></script>');
  expect(body).not.toContain('<script src="./app.js?v=76" defer></script>');
  for(const asset of [
    './loader-v2.js?v=188','./runtime-client.js?v=3','./native-auth-bridge.js?v=4',
    './calendar-return-bridge.js?v=2','./team.js?v=32','./home-dashboard-v2.js?v=7'
  ]) expect(head).toContain('rel="modulepreload" href="'+asset+'"');
  expect(read('app/app.js')).toContain("import('./loader-v2.js?v=188')");
  const loader=read('app/loader-v2.js');
  expect(loader).toContain("const runtimeReady=import('./runtime-client.js?v=3')");
  expect(loader).toContain("import('./team.js?v=32')");
  expect(loader).toContain("import('./google-tasks.js?v=6')");
  expect(loader).toContain("if(window.__KPTU_NATIVE_BRIDGE__||window.__KPTU_CALENDAR_BRIDGE__)return");
  expect(loader.indexOf('await runtimeReady')).toBeLessThan(loader.indexOf("const authenticated=await window.KPTURuntime.session.ensure()"));
});

test('authenticated home commits before non-critical feature bundle', async ({ page }) => {
  const response=await page.request.get(loaderUrl);
  expect(response.ok()).toBeTruthy();
  const source=await response.text();
  const usable=source.indexOf('window.__KPTU_MARK_APP_UI_READY__?.({usable:homeResult?.ok===true})');
  const deferred=source.indexOf('defer(()=>loadFeatures()');
  expect(source).toContain('const homeResult=await window.__KPTU_HOME_READY__');
  expect(source).not.toContain('await Promise.all([window.__KPTU_HOME_READY__,mobileNavigationReady])');
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
  expect(team).toContain("user=userFromSession()||await getUser()");
  expect(team).toContain("workspace:app_workspaces(id,slug,name)");
  expect(home).toContain("app.classList.add('kptu-shell-ready')");
  expect(read('app/base-ui.css')).toContain("#appView:not(.kptu-ui-ready):not(.kptu-shell-ready)");
  expect(home).toContain('window.__KPTU_BOOT_CONTEXT__');
  expect(home).toContain('if(epoch!==renderEpoch)return');
  expect(home).toContain("addEventListener('kptu:session-changed'");
  expect(team).toContain("addEventListener('kptu:session-changed'");
  expect(team).toContain("showOnly('authView')");
});

test('retired page editors and media drafting workflow stay out while the Web1 press archive remains available', async ({ page }) => {
  const source=await (await page.request.get(loaderUrl)).text();
  for(const retired of ['./page-list-controller.js','./page-save-controller.js','./page-builder.js','./page-shortcut.js','./page-management.js','./page-inline-viewer-v2.js']){
    expect(source).not.toContain(retired);
  }
  expect(source).toContain("import('./web1-board.js?v=1')");
  expect(source).not.toContain("import('./media-workflow.js");
  expect(source).toContain("import('./web1-press.js?v=2')");
  for(const modulePath of ['./workplace-ai-report.js','./workflow-ai-v3.js']){
    expect(source.indexOf(modulePath)).toBeGreaterThan(source.indexOf("startup?.mark('allInitialModulesComplete')"));
  }
});

test('feature navigation waits for deferred readiness and bootstrap loads access approval', async () => {
  const source=read('app/loader-v2.js');
  expect(source).toContain("if(teamState==='bootstrap'){await import('./access-approval.js?v=5');return}");
  expect(source).toContain("event.stopImmediatePropagation()");
  expect(source).toContain('#appView [data-hdv-goto]');
  expect(source).toContain('#appView [data-hdv-project]');
  expect(source).toContain('#newTaskBtn');
  expect(source).toContain("loadFeatures().then(()=>{status.remove()");
  expect(source).toContain("const homeResult=await window.__KPTU_HOME_READY__");
  expect(source).not.toContain("await Promise.all([window.__KPTU_HOME_READY__,mobileNavigationReady])");
});

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
async function loginWithMock(page,{delayGroups=false}={}){
  const user={id:'p6-flow-user',email:'p6-flow@example.org',user_metadata:{display_name:'P6 QA'}};
  await page.route(SB+'/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(delayGroups&&path==='/rest/v1/app_groups')await new Promise(resolve=>setTimeout(resolve,700));
    const data=path==='/auth/v1/token'?{access_token:'p6-flow-access',refresh_token:'p6-flow-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user}:
      path==='/auth/v1/user'?user:
      path==='/rest/v1/app_workspace_members'?[{workspace_id:'p6-flow-workspace',user_id:user.id,role:'owner',workspace:{id:'p6-flow-workspace',slug:'kptu-work',name:'웹2'}}]:
      path==='/rest/v1/app_workspaces'?[{id:'p6-flow-workspace',name:'웹2'}]:
      path==='/rest/v1/app_profiles'?[{user_id:user.id,display_name:'P6 QA'}]:
      path==='/functions/v1/google-calendar'?{connected:false,enabled:false,selected:[],calendars:[],events:[]}:
      path==='/functions/v1/push-notifications'?{enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'}:
      path.startsWith('/rest/v1/')?[]:{};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(loginEntry('http://127.0.0.1:8123/app/'));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill(user.email);
  await page.locator('#authPassword').fill('test-password-value');
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


test('startup diagnostics keep only timing metadata and debug UI is opt-in',async({page})=>{
  await loginWithMock(page);
  const sample=await page.evaluate(()=>window.KPTUStartupDiagnostics?.latest?.());
  expect(sample).toBeTruthy();
  expect(sample.outcome).toBe('home-usable');
  expect(sample.totalMs).toBeGreaterThan(0);
  expect(sample.requests.map(x=>x.name)).toEqual(expect.arrayContaining(['workspace-member','projects','milestones','tasks','documents']));
  const serialized=JSON.stringify(sample);
  expect(serialized).not.toContain('p6-flow-user');
  expect(serialized).not.toContain('p6-flow-access');
  await expect(page.locator('#startupDiagCopy')).toHaveCount(0);

  await page.goto('http://127.0.0.1:8123/app/?startup-debug=1');
  await page.waitForFunction(()=>typeof window.__KPTU_STARTUP__?.marks?.homeUsable==='number');
  await expect(page.locator('#startupDiagCopy')).toBeVisible();
});
