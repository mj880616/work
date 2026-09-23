import { test, expect } from '@playwright/test';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';

async function installMock(page){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token'&&url.searchParams.get('grant_type')==='password')return ok({access_token:'e2e-access',refresh_token:'e2e-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'user-1',email:'writer@example.org',user_metadata:{display_name:'페이지 작성자'}}});
    if(path==='/auth/v1/user')return ok({id:'user-1',email:'writer@example.org',user_metadata:{display_name:'페이지 작성자'}});
    if(path==='/rest/v1/app_workspace_members'&&url.searchParams.has('user_id'))return ok([{workspace_id:'workspace-1',role:'owner',user_id:'user-1',workspace:{id:'workspace-1',slug:'team',name:'웹2'}}]);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'workspace-1',role:'owner',user_id:'user-1'}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'workspace-1',slug:'team',name:'웹2'}]);
    if(path==='/rest/v1/main_project_archive_state')return ok([{card_key:'sanbyeol',archived:true}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:'user-1',display_name:'페이지 작성자'}]);
    if(path==='/rest/v1/app_spaces'||path==='/rest/v1/app_groups'||path==='/rest/v1/app_events'||path==='/rest/v1/app_event_attendees'||path==='/rest/v1/app_tasks'||path==='/rest/v1/app_meetings'||path==='/rest/v1/app_documents'||path==='/rest/v1/app_notifications')return ok([]);
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

async function mockBoardSource(page){
  await page.route('https://raw.githubusercontent.com/mj880616/work/main/**',route=>route.fulfill({
    status:200,
    contentType:'text/plain; charset=utf-8',
    body:'<!doctype html><html><body><main id="boardSourceFixture">repo source</main></body></html>'
  }));
}

test('authenticated board mirrors Web1 business pages and excludes library and press',async({page})=>{
  await installMock(page);
  await mockBoardSource(page);
  const target='http://127.0.0.1:8123/app/?view=pages';
  await page.goto('http://127.0.0.1:8123/app/login/?return='+encodeURIComponent(target));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('writer@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page).toHaveURL(target,{timeout:10000});
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#pagesView')).toBeVisible();
  await expect(page.locator('#newPageBtn')).toHaveCount(0);
  await expect(page.locator('#pageSearch,#pageFilter,#pageList')).toHaveCount(0);
  await expect(page.locator('#web1BoardActive')).toContainText('위험업무 2인1조 법제화');
  await expect(page.locator('#web1BoardActive')).toContainText('공공기관 인력확충');
  await expect(page.locator('#web1BoardActive')).toContainText('민자철도 사업 현황');
  await expect(page.locator('#web1BoardActive')).toContainText('궤도협의회');
  await expect(page.locator('#web1BoardActive')).not.toContainText('자료실');
  await expect(page.locator('#web1BoardActive')).not.toContainText('성명·보도자료');
  await expect(page.locator('#web1BoardArchived')).toContainText('산별전환 업무 현황');
  await expect(page.locator('#pagesView .w1b-card')).toHaveCount(5);
  const cards=await page.locator('#pagesView .w1b-card').evaluateAll(nodes=>nodes.map(x=>x.dataset.web1BoardHref));
  expect(cards).toContain('https://work.bokdoong.com/work/2in1/');
  expect(cards).toContain('https://work.bokdoong.com/work/workforce/');
  expect(cards).not.toContain('https://work.bokdoong.com/public-policy/');
  expect(cards).not.toContain('https://work.bokdoong.com/press/');

  await page.locator('#web1BoardActive .w1b-card').first().click();
  await expect(page.locator('#web1BoardDetailModal')).toBeVisible();
  await expect(page.locator('#web1BoardDetailFrame')).toHaveAttribute('src','about:blank');
  await expect(page.locator('#web1BoardDetailFrame')).toHaveAttribute('data-web1-board-source','2in1/index.html');
  await expect.poll(async()=>await page.locator('#web1BoardDetailFrame').getAttribute('srcdoc')).toContain('<base href="https://work.bokdoong.com/work/2in1/">');
  await expect(page.locator('#web1BoardDetailFrame')).toHaveAttribute('data-web1-board-canonical','https://work.bokdoong.com/work/2in1/');
  await expect(page.locator('#pagesView')).toBeVisible();
  await page.locator('[data-close-web1-board]').click();
  await expect(page.locator('#web1BoardDetailModal')).toHaveClass(/hidden/);
});
