import { test, expect } from '@playwright/test';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'media-user',email:'media@example.org',user_metadata:{display_name:'언론담당'}};
const workspace={id:'media-workspace',slug:'media-workspace',name:'웹2'};

async function mockApp(page){
  await page.route(SB+'/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'media-access',refresh_token:'media-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/rest/v1/app_workspace_members'&&url.searchParams.has('user_id'))return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',workspace}]);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner'}]);
    if(path==='/rest/v1/app_workspaces')return ok([workspace]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'언론담당'}]);
    if(path==='/rest/v1/main_project_archive_state')return ok([]);
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

async function signIn(page){
  const target='http://127.0.0.1:8123/app/?view=media';
  await page.goto('http://127.0.0.1:8123/app/login/?return='+encodeURIComponent(target));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill(user.email);
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page).toHaveURL(target,{timeout:10000});
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
}

test('media tab embeds the Web1 press archive and has no separate drafting workflow',async({page})=>{
  await mockApp(page);
  await signIn(page);

  await expect(page.locator('#mediaView')).toBeVisible();
  await expect(page.locator('[data-view="media"]')).toHaveText('성명·보도자료');
  await expect(page.locator('#mediaView h2').first()).toHaveText('성명·보도자료');
  await expect(page.locator('#newMediaCaseBtn,#mediaCaseList,#mediaSearch,#mediaStatusFilter')).toHaveCount(0);
  await expect(page.locator('#pressArchiveLink')).toHaveAttribute('href','https://work.bokdoong.com/press/');
  await expect(page.locator('#web1PressFrame')).toHaveAttribute('src','../press/');

  const archive=page.frameLocator('#web1PressFrame');
  await expect(archive.locator('h1')).toHaveText('성명·보도자료',{timeout:10000});
  await expect(archive.locator('#pressSearch')).toBeVisible();
  await expect(archive.locator('[data-type="statement"]').first()).toBeVisible();
  await expect(archive.locator('[data-type="release"]').first()).toBeVisible();
  await expect(archive.locator('[data-type="request"]').first()).toBeVisible();
});
