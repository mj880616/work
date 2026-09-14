import { test, expect } from '@playwright/test';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';

async function mockApp(page){
  const user={id:'nav-user',email:'nav@example.org',user_metadata:{display_name:'메뉴 QA'}};
  const workspace={id:'nav-workspace',name:'공공기관사업팀 Workspace'};
  await page.route(`${SB}/**`,async route=>{
    const u=new URL(route.request().url()),p=u.pathname;
    const ok=x=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x??null)});
    if(p==='/auth/v1/token')return ok({access_token:'nav-access',refresh_token:'nav-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
    if(p==='/auth/v1/user')return ok(user);
    if(p==='/auth/v1/logout')return ok({});
    if(p==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner'}]);
    if(p==='/rest/v1/app_workspaces')return ok([workspace]);
    if(p==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'메뉴 QA'}]);
    if(p==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(p==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(p.startsWith('/rest/v1/')||p.startsWith('/functions/v1/'))return ok([]);
    return ok({});
  });
}

async function login(page){
  await page.goto('http://127.0.0.1:8123/app/');
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('nav@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
}

test('active top menu follows swipe navigation and remains visible',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await mockApp(page);
  await login(page);

  await page.evaluate(()=>window.KPTURouter.go('team',{source:'swipe'}));
  await expect(page.locator('#teamView')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>{
    const nav=document.querySelector('.app-nav');
    const active=nav?.querySelector('.nav-btn.active');
    if(!nav||!active)return false;
    const n=nav.getBoundingClientRect(),a=active.getBoundingClientRect();
    return nav.scrollLeft>0&&a.left>=n.left-1&&a.right<=n.right+1;
  })).toBe(true);

  await page.evaluate(()=>window.KPTURouter.go('home',{source:'swipe'}));
  await expect(page.locator('#homeView')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.querySelector('.app-nav')?.scrollLeft||0)).toBeLessThan(4);
});
