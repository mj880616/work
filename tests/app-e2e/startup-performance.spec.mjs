import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { loginEntry } from './helpers/login-entry.mjs';

const loaderUrl='http://127.0.0.1:8123/app/loader-v2.js?p6-startup-contract=1';
const read=path=>readFileSync(path,'utf8');

test('Web2 first paint uses the final icon without a green placeholder or late favicon rewrite',async()=>{
  const html=read('app/index.html');
  const pwa=read('app/pwa.js');
  const manifest=read('app/windows-manifest.json');
  const sw=read('app/sw.js');
  const icon='./app-icon.svg?v=20260924-unicorn3';
  expect(html).toContain(`rel="icon" href="${icon}"`);
  expect(html).toContain(`rel="apple-touch-icon" href="${icon}"`);
  expect(html).toContain('rel="manifest" href="./windows-manifest.json?v=5"');
  expect(html).toContain(`class="brand-icon" src="${icon}"`);
  expect(html).not.toContain('class="leaf"');
  expect(pwa).not.toContain('favicon');
  expect(pwa).not.toContain('apple-touch-icon');
  expect(pwa).not.toContain('createElement(\'link\')');
  expect(manifest).toContain('20260924-unicorn3');
  expect(sw).toContain('20260924-unicorn3');
  for(const source of [html,pwa,manifest,sw])expect(source).not.toContain('20260913-3');
});

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

test('startup preloads only route-agnostic core assets', async () => {
  const html=read('app/index.html');
  const head=html.slice(0,html.indexOf('</head>'));
  expect(head).toContain('<script src="./app.js?v=104" defer></script>');
  for(const asset of [
    './loader-v2.js?v=216','./runtime-client.js?v=4','./native-auth-bridge.js?v=4',
    './calendar-return-bridge.js?v=3','./team.js?v=40'
  ]) expect(head).toContain('rel="modulepreload" href="'+asset+'"');
  expect(head).not.toContain('home-dashboard-v2.js');
  expect(read('app/app.js')).toContain("import('./loader-v2.js?v=216')");
  const loader=read('app/loader-v2.js');
  expect(loader).toContain("const runtimeReady=import('./runtime-client.js?v=4')");
  expect(loader).toContain("import('./team.js?v=40')");
  expect(loader).toContain("import('./view-loader.js?v=3')");
  expect(loader).not.toContain("import('./google-tasks.js");
  expect(loader.indexOf('await runtimeReady')).toBeLessThan(loader.indexOf("const authenticated=await window.KPTURuntime.session.ensure()"));
});

test('requested route is resolved before view-specific feature loading', async () => {
  const source=read('app/loader-v2.js');
  const viewLoader=read('app/view-loader.js');
  expect(source).toContain("const rawRequested=params.get('view')||(params.get('project')?'projects':'home')");
  expect(source).toContain("result=await viewLoader.load(requested)");
  expect(source).not.toContain("const homeResult=await window.__KPTU_HOME_READY__");
  expect(source).not.toContain("if(requested&&requested!=='home')await loadFeatures()");
  expect(source).not.toContain("defer(()=>loadFeatures()");
  expect(viewLoader).toContain("const loaders={home,calendar,tasks,projects,library,meetings,media,pages,team:organizations,photos,notifications}");
});

test('direct feature URLs load one requested view and keep failures visible', async () => {
  const source=read('app/loader-v2.js');
  expect(source).toContain("startup?.mark('requestedViewLoadStart',{view:requested})");
  expect(source).toContain("startup?.mark('requestedViewReady',{view:requested})");
  expect(source).toContain("box.id='deferredFeatureError'");
  expect(source).toContain("setAttribute('role','alert')");
  expect(source).not.toContain("await window.__KPTU_HOME_READY__");
  expect(source).not.toContain("await loadFeatures()");
});

test('calendar health no longer owns a Google status request', async () => {
  const health=read('app/calendar-health.js');
  const persistence=read('app/calendar-persistence.js');
  expect(health).not.toContain('/functions/v1/google-calendar?action=status');
  expect(health).toContain('window.KPTUCalendarHealth={render:renderCalendarHealth}');
  expect(persistence).toContain("queueMicrotask(()=>cpStatus())");
  expect(persistence).toContain("if(!document.querySelector('#calendarView')?.classList.contains('hidden'))cpStatus()");
});

test('project direct route does not start unrelated external integrations or home queries',async({page})=>{
  const user={id:'route-project-user',email:'route@example.org',user_metadata:{display_name:'Route QA'}};
  const workspace={id:'route-project-workspace',slug:'route',name:'웹2'};
  const session={access_token:'route-access',refresh_token:'route-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user};
  await page.addInitScript(s=>localStorage.setItem('kptu_collab_session_v1',JSON.stringify(s)),session);
  const seen=[];
  await page.route(SB+'/**',async route=>{
    const u=new URL(route.request().url()),path=u.pathname;
    seen.push(path+u.search);
    const data=path==='/rest/v1/app_workspace_members'&&u.searchParams.has('user_id')?[{workspace_id:workspace.id,user_id:user.id,role:'owner',workspace}]:
      path==='/rest/v1/app_workspace_members'?[{workspace_id:workspace.id,user_id:user.id,role:'owner'}]:
      path==='/rest/v1/app_profiles'?[{user_id:user.id,display_name:'Route QA'}]:
      path.startsWith('/rest/v1/')?[]:{};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('http://127.0.0.1:8123/app/?view=projects');
  await expect(page.locator('#projectsView')).toBeVisible({timeout:15000});
  await page.waitForFunction(()=>document.documentElement.classList.contains('kptu-project-v3-ready'));
  const external=seen.filter(x=>/\/functions\/v1\/(google-calendar|google-tasks|push-notifications|event-media)/.test(x));
  expect(external).toEqual([]);
  expect(seen.some(x=>x.startsWith('/rest/v1/app_project_milestones'))).toBeFalsy();
  expect(seen.some(x=>x.startsWith('/rest/v1/app_tasks'))).toBeFalsy();
  expect(seen.some(x=>x.startsWith('/rest/v1/app_documents'))).toBeFalsy();
  expect(seen.filter(x=>x.startsWith('/auth/v1/user'))).toHaveLength(0);
  expect(seen.filter(x=>x.startsWith('/rest/v1/app_workspace_members?user_id=eq.'))).toHaveLength(1);
});

test('home and feature modules reuse authenticated boot context', async () => {
  const home=read('app/home-dashboard-v2.js');
  const team=read('app/team.js');
  const runtime=read('app/runtime-client.js');
  expect(team).toContain("user=userFromSession()||await getUser()");
  expect(team).toContain("workspace:app_workspaces(id,slug,name)");
  expect(team).toContain("window.KPTURuntime?.context?.set?.(window.__KPTU_BOOT_CONTEXT__)");
  expect(runtime).toContain("context:{read:contextRead,set:contextSet,clear:contextClear}");
  expect(home).toContain('window.__KPTU_BOOT_CONTEXT__');
  expect(home).toContain('if(epoch!==renderEpoch)return');
});

test('route manifest keeps retired modules out and Web1 views isolated', async () => {
  const source=read('app/view-loader.js');
  for(const retired of ['./page-list-controller.js','./page-save-controller.js','./page-builder.js','./page-shortcut.js','./page-management.js','./page-inline-viewer-v2.js']){
    expect(source).not.toContain(retired);
  }
  expect(source).toContain("module('./web1-board.js?v=3')");
  expect(source).toContain("module('./web1-press.js?v=2'");
  expect(source).not.toContain('./workflow-ai-v3.js');
  expect(source).not.toContain('./media-workflow.js');
});

test('feature navigation lazy-loads only the destination view and bootstrap still loads access approval', async () => {
  const source=read('app/loader-v2.js');
  expect(source).toContain("if(teamState==='bootstrap'){await import('./access-approval.js?v=5');return}");
  expect(source).toContain("event.stopImmediatePropagation()");
  expect(source).toContain('#appView [data-hdv-goto]');
  expect(source).toContain('#newTaskBtn');
  expect(source).toContain("viewLoader.load(view).then");
  expect(source).toContain("window.KPTUDeferredFeatures={load:()=>viewLoader.loadAll(),loadView:viewLoader.load}");
  expect(source).not.toContain("const homeResult=await window.__KPTU_HOME_READY__");
});

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
async function loginWithMock(page,{delayGroups=false}={}){
  const user={id:'p6-flow-user',email:'p6-flow@example.org',user_metadata:{display_name:'P6 QA'}};
  await page.route(SB+'/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(delayGroups&&path==='/rest/v1/app_tasks')await new Promise(resolve=>setTimeout(resolve,700));
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
