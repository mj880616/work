import {clickView} from '../app-e2e/helpers/shell-navigation.mjs';
import { test, expect } from '@playwright/test';

// CI-버전자동화: the scripts/build-pages.mjs output (hashed ?v=, what Pages deploys) boots and
// switches views with the same mocked APIs as tests/app-e2e. Served at PAGES_BUILD_ORIGIN.
const origin=process.env.PAGES_BUILD_ORIGIN||'http://127.0.0.1:8125';
const hashed=/[?&]v=[0-9a-f]{10}(?:&|$)/;

async function boot(page){
  const user={id:'build-user',email:'build@example.org'},workspace={id:'build-workspace',name:'QA',slug:'qa'};
  await page.route('https://xmlkxfjeagycwttklxjw.supabase.co/**',route=>{
    const path=new URL(route.request().url()).pathname;
    let data=[];
    if(path==='/auth/v1/token')data={access_token:'qa',refresh_token:'qa-refresh',expires_in:86400,expires_at:Math.floor(Date.now()/1000)+86400,user};
    else if(path==='/auth/v1/user')data=user;
    else if(path==='/rest/v1/app_workspace_members')data=[{workspace_id:workspace.id,user_id:user.id,role:'owner'}];
    else if(path==='/rest/v1/app_workspaces')data=[workspace];
    else if(path==='/rest/v1/app_profiles')data=[{user_id:user.id,display_name:'QA'}];
    else if(path.startsWith('/functions/'))data={connected:false,enabled:false,tasks:[],events:[],calendars:[]};
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(origin+'/app/login/?return='+encodeURIComponent(origin+'/app/?view=calendar'));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill(user.email);
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
}

test('built output boots, switches views and loads only hashed app assets',async({page})=>{
  const local=[],failed=[],errors=[];
  page.on('request',r=>{const u=new URL(r.url());if(u.origin===origin&&u.pathname.startsWith('/app/')&&/\.(?:js|css)$/.test(u.pathname))local.push(u)});
  page.on('response',r=>{if(r.url().startsWith(origin)&&r.status()>=400)failed.push(`${r.status()} ${r.url()}`)});
  page.on('pageerror',e=>errors.push(e.message));
  await boot(page);
  for(const view of ['projects','library','calendar'])await clickView(page,view);
  await expect(page.locator('#versionNotice')).toHaveCount(0);
  expect(failed).toEqual([]);expect(errors).toEqual([]);
  const app=local.filter(u=>u.pathname==='/app/app.js');
  expect(app.length).toBeGreaterThan(0);
  for(const u of app)expect(u.search).toMatch(hashed);
  // Every versioned app asset the browser asked for carries a content hash, never a repository number.
  const versioned=local.filter(u=>u.searchParams.has('v'));
  expect(versioned.length).toBeGreaterThan(20);
  expect(versioned.filter(u=>!hashed.test(u.search)).map(u=>u.pathname+u.search)).toEqual([]);
});

test('the version notice treats a different deployed hash as new',async({page})=>{
  await boot(page);
  await page.route(origin+'/app/index.html',route=>route.fulfill({contentType:'text/html',body:'<script src="./app.js?v=fedcba9876" defer></script>'}));
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#versionNotice')).toBeVisible();
});
