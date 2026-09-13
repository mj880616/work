import { test, expect } from '@playwright/test';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';

async function installMock(page){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request();
    const url=new URL(req.url());
    const path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});

    if(path==='/auth/v1/token') return ok({access_token:'desktop-access',refresh_token:'desktop-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer'});
    if(path==='/auth/v1/user') return ok({id:'desktop-user',email:'desktop@example.org',user_metadata:{display_name:'데스크톱 사용자'}});
    if(path==='/auth/v1/logout') return ok({});
    if(path==='/functions/v1/google-calendar') return ok({connected:false,enabled:false,selected:[],calendars:[],colors:{},events:[]});
    if(path.startsWith('/functions/v1/')) return ok({});
    if(path.startsWith('/rest/v1/rpc/')) return ok(null);
    if(path==='/rest/v1/app_workspace_members'){
      if(url.searchParams.get('limit')==='1') return ok([{workspace_id:'workspace-1',user_id:'desktop-user',role:'owner',email:'desktop@example.org'}]);
      return ok([{workspace_id:'workspace-1',user_id:'desktop-user',role:'owner',email:'desktop@example.org'}]);
    }
    if(path==='/rest/v1/app_profiles') return ok([{user_id:'desktop-user',display_name:'데스크톱 사용자',job_title:'국장'}]);
    if(path==='/rest/v1/app_workspaces') return ok([{id:'workspace-1',slug:'public-institutions',name:'공공기관사업팀 Workspace'}]);
    if(path==='/rest/v1/app_spaces') return ok([{id:'space-1',workspace_id:'workspace-1',name:'반응형 프로젝트',parent_id:null,status:'active',owner_id:'desktop-user',visibility:'team',sort_order:10}]);
    if(path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}

test('desktop web uses a wide two-column workspace while sharing the same app',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await installMock(page);
  await page.goto('http://127.0.0.1:8123/app/');

  await expect(page.locator('#desktopUiCss')).toHaveAttribute('href','./desktop-ui.css?v=1');
  await expect(page.locator('#emailAuthToggle')).toBeVisible({timeout:10000});
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('desktop@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});

  const desktop=await page.locator('#appView').evaluate(el=>{
    const app=getComputedStyle(el);
    const nav=getComputedStyle(el.querySelector(':scope > .app-nav'));
    const main=getComputedStyle(document.querySelector('main'));
    return {display:app.display,columns:app.gridTemplateColumns,navDirection:nav.flexDirection,navPosition:nav.position,mainMaxWidth:main.maxWidth};
  });
  expect(desktop.display).toBe('grid');
  expect(desktop.columns.split(' ').length).toBeGreaterThanOrEqual(2);
  expect(desktop.navDirection).toBe('column');
  expect(desktop.navPosition).toBe('sticky');
  expect(desktop.mainMaxWidth).toBe('1720px');

  await page.setViewportSize({width:760,height:900});
  const mobile=await page.locator('#appView').evaluate(el=>({display:getComputedStyle(el).display,navDirection:getComputedStyle(el.querySelector(':scope > .app-nav')).flexDirection}));
  expect(mobile.display).not.toBe('grid');
  expect(mobile.navDirection).not.toBe('column');
});
