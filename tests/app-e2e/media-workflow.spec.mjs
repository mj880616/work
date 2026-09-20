import { test, expect } from '@playwright/test';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'media-user',email:'media@example.org',user_metadata:{display_name:'언론담당'}};
const workspace={id:'media-workspace',slug:'media-workspace',name:'공공기관사업팀 Workspace'};
const now=new Date().toISOString();
const mediaPage={id:'media-page-1',workspace_id:workspace.id,space_id:null,slug:'media-20260918-abcd',title:'[언론대응] 기존 사건',summary:'언론대응 · 사건 팩트시트 → 초안 → QA',body:'# 사건 팩트시트',visibility:'workspace',status:'draft',owner_id:user.id,published_at:null,created_at:now,updated_at:now};
const publicPage={id:'page-1',workspace_id:workspace.id,space_id:null,slug:'public-page',title:'일반 게시글',summary:'일반 게시판 자료',body:'# 일반',visibility:'workspace',status:'draft',owner_id:user.id,published_at:null,created_at:now,updated_at:now};

async function mockApp(page){
  await page.route(SB+'/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'media-access',refresh_token:'media-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email}]);
    if(path==='/rest/v1/app_workspaces')return ok([workspace]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'언론담당'}]);
    if(path==='/rest/v1/app_spaces'||path==='/rest/v1/app_groups'||path==='/rest/v1/app_page_permissions'||path==='/rest/v1/app_page_revisions')return ok([]);
    if(path==='/rest/v1/app_pages'){
      if((url.searchParams.get('slug')||'').includes('media-'))return ok([mediaPage]);
      if((url.searchParams.get('id')||'').includes(mediaPage.id))return ok([mediaPage]);
      return ok([mediaPage,publicPage]);
    }
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

async function signIn(page){
  await page.goto('http://127.0.0.1:8123/app/login/?return=http%3A%2F%2F127.0.0.1%3A8123%2Fapp%2F');
  await expect(page.locator('#emailAuthToggle')).toBeVisible({timeout:10000});
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill(user.email);
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
}

test('press workflow uses internal page storage and keeps cases out of general page list',async({page})=>{
  await mockApp(page);
  await page.goto('http://127.0.0.1:8123/app/');
  await signIn(page);

  await page.locator('[data-view="pages"]').click();
  await page.locator('#pagesMediaEntry').click();
  await expect(page.locator('#mediaView')).toBeVisible();
  await expect(page.locator('[data-view="media"]')).toHaveText('성명·보도자료');
  await expect(page.locator('#mediaView h2').first()).toHaveText('성명·보도자료');
  await expect(page.locator('#pressArchiveLink')).toHaveAttribute('href','../press/');
  await expect(page.locator('#mediaCaseList')).toContainText('기존 사건');
  await expect(page.locator('#mediaCaseList')).toContainText('언론대응 · 사건 팩트시트 → 초안 → QA');

  await page.locator('#newMediaCaseBtn').click();
  await expect(page.locator('#editorModal')).toBeVisible();
  await expect(page.locator('#pageTitle')).toHaveValue('[언론대응] ');
  await expect(page.locator('#pageSlug')).toHaveValue(/^media-/);
  await expect(page.locator('#pageVisibility')).toHaveValue('workspace');
  await expect(page.locator('#pageStatus')).toHaveValue('draft');
  await expect(page.locator('#pageBody')).toHaveValue(/# 사건 팩트시트/);
  await expect(page.locator('#pageBody')).toHaveValue(/# 취재요청 초안/);
  await expect(page.locator('#pageBody')).toHaveValue(/# 보도자료 초안/);
  await expect(page.locator('#pageBody')).toHaveValue(/# 성명 초안/);
  await expect(page.locator('#pageBody')).toHaveValue(/# 배포 전 QA/);

  await page.locator('[data-close="editorModal"]').first().click();
  await page.locator('[data-view="pages"]').click();
  await expect(page.locator('#pageList')).toContainText('일반 게시글');
  await expect(page.locator('#pageList')).not.toContainText('기존 사건');
});
