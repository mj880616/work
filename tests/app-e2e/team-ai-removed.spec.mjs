import {clickView} from './helpers/shell-navigation.mjs';
import {test,expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';

const app='http://127.0.0.1:8123/app/';
const supabase='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'team-ai-removed-user',email:'removed@example.org',user_metadata:{display_name:'E2E 사용자'}};
const workspace={id:'team-ai-removed-workspace',name:'웹2'};

test('old AI addresses return to the default screen without team-ai requests or console errors',async({page})=>{
  test.setTimeout(60000);
  const errors=[],requests=[];
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(new URL(request.url()).pathname==='/functions/v1/team-ai')requests.push(request.url())});
  await page.route(`${supabase}/**`,route=>{
    const path=new URL(route.request().url()).pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner'}]);
    if(path==='/rest/v1/app_workspaces')return ok([workspace]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'E2E 사용자'}]);
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });

  await page.goto(loginEntry(app));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill(user.email);
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
  await page.waitForLoadState('networkidle');
  await page.evaluate(()=>window.__KPTU_SUBORGANIZATIONS_READY__);

  for(const oldView of ['ai','team-ai']){
    await page.goto(`${app}?view=${oldView}`);
    await expect(page.locator('#homeView')).toBeVisible({timeout:20000});
    await expect.poll(()=>new URL(page.url()).searchParams.get('view')).toBe('home');
    await page.waitForLoadState('networkidle');
    await page.evaluate(()=>window.__KPTU_SUBORGANIZATIONS_READY__);
  }
  await clickView(page,'team');
  await expect(page.locator('#teamView')).toBeVisible({timeout:20000});
  await expect.poll(()=>page.evaluate(()=>window.KPTUViewLoader.isLoaded('team'))).toBe(true);
  await expect(page.locator('#aiView,#teamAiView,#warGenerate,#warTimeline,[data-view="ai"],[data-goto="ai"],[data-view="team-ai"],[data-goto="team-ai"]')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});
