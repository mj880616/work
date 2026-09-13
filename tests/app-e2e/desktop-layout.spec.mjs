import { test, expect } from '@playwright/test';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';

async function installMock(page){
  const pageRow={id:'page-1',workspace_id:'workspace-1',space_id:'space-1',slug:'desktop-page',title:'데스크톱 게시글',summary:'게시 탭 내부 미리보기',body:'# 본문\n\n게시글 본문입니다.',visibility:'public',status:'published',owner_id:'desktop-user',published_at:new Date().toISOString(),created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const taskRow={id:'task-1',workspace_id:'workspace-1',project_id:null,title:'메인에서 바로 처리할 할 일',description:'',assignee_id:'desktop-user',status:'todo',priority:'normal',due_at:null,source_type:'manual',created_by:'desktop-user',created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
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
    if(path==='/rest/v1/app_pages') return ok([pageRow]);
    if(path==='/rest/v1/app_tasks') return ok([taskRow]);
    if(path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}

async function login(page){
  await expect(page.locator('#emailAuthToggle')).toBeVisible({timeout:10000});
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('desktop@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
}

test('desktop web uses a compact left navigation while sharing the same app',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await installMock(page);
  await page.goto('http://127.0.0.1:8123/app/');

  await expect(page.locator('#desktopUiCss')).toHaveAttribute('href','./desktop-ui.css?v=2');
  await expect(page.locator('#desktopTightNavCss')).toHaveAttribute('href','./desktop-tight-nav.css?v=1');
  await login(page);

  const desktop=await page.locator('#appView').evaluate(el=>{
    const app=getComputedStyle(el);
    const navEl=el.querySelector(':scope > .app-nav');
    const nav=getComputedStyle(navEl);
    const main=getComputedStyle(document.querySelector('main'));
    return {display:app.display,columns:app.gridTemplateColumns,navDirection:nav.flexDirection,navPosition:nav.position,navWidth:navEl.getBoundingClientRect().width,mainMaxWidth:main.maxWidth};
  });
  expect(desktop.display).toBe('grid');
  expect(desktop.columns.split(' ').length).toBeGreaterThanOrEqual(2);
  expect(desktop.navDirection).toBe('column');
  expect(desktop.navPosition).toBe('sticky');
  expect(desktop.navWidth).toBeLessThanOrEqual(160);
  expect(desktop.mainMaxWidth).toBe('1720px');

  await expect(page.locator('#myTaskMini')).toContainText('메인에서 바로 처리할 할 일');
  await expect(page.locator('#myTaskMini [data-hta-toggle="task-1"]')).toBeVisible();
  await expect(page.locator('#myTaskMini [data-hta-edit="task-1"]')).toHaveText('수정');
  await expect(page.locator('#myTaskMini [data-hta-delete="task-1"]')).toHaveText('삭제');

  await page.setViewportSize({width:760,height:900});
  const mobile=await page.locator('#appView').evaluate(el=>({display:getComputedStyle(el).display,navDirection:getComputedStyle(el.querySelector(':scope > .app-nav')).flexDirection}));
  expect(mobile.display).not.toBe('grid');
  expect(mobile.navDirection).not.toBe('column');
});

test('selected view survives refresh and page cards open inside the 게시 tab',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await installMock(page);
  await page.goto('http://127.0.0.1:8123/app/');
  await login(page);

  await page.locator('[data-view="calendar"]').click();
  await expect(page.locator('#calendarView')).toBeVisible();
  await expect(page).toHaveURL(/view=calendar/);
  await page.reload();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#calendarView')).toBeVisible({timeout:10000});
  await expect(page.locator('[data-view="calendar"]')).toHaveClass(/active/);

  await page.locator('[data-view="pages"]').click();
  await expect(page.locator('#pageList')).toContainText('데스크톱 게시글');
  const card=page.locator('#pageList .page-card').filter({hasText:'데스크톱 게시글'});
  await expect(card).toHaveAttribute('data-inline-page','page-1');
  await card.locator('h3').click();
  await expect(page.locator('#pageInlineViewer')).toBeVisible();
  await expect(page.locator('#pivTitle')).toHaveText('데스크톱 게시글');
  await expect(page.locator('#pivFrame')).toHaveAttribute('src',/\/p\/\?slug=desktop-page/);
  await expect(page).toHaveURL(/view=pages/);
  await expect(page).toHaveURL(/page=page-1/);
  await expect(page.locator('#pageList')).toBeHidden();
});
