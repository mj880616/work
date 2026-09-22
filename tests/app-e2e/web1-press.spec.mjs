import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const app='http://127.0.0.1:8123/app/';
const user={id:'press-user',email:'press@example.org',user_metadata:{display_name:'언론자료 QA'}};

async function mockApp(page){
  await page.route(SB+'/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'press-access',refresh_token:'press-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'press-workspace',user_id:user.id,role:'owner',workspace:{id:'press-workspace',slug:'press',name:'웹2'}}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'press-workspace',name:'웹2'}]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'언론자료 QA'}]);
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}
async function signIn(page){
  await page.goto(loginEntry(app));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill(user.email);
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
}
test('Web2 media tab reuses the self-hosted Web1 press archive without drafting workflow controls',async({page})=>{
  await mockApp(page);
  await page.route('https://raw.githubusercontent.com/mj880616/work/main/**',route=>route.fulfill({
    status:200,
    contentType:'text/html; charset=utf-8',
    body:'<!doctype html><html><head><title>원본 보도자료</title></head><body><main id="rawPressBody">원본 보도자료 본문</main></body></html>'
  }));
  await signIn(page);
  await page.locator('.app-nav [data-view="media"]').click();
  await expect(page.locator('#mediaView')).toBeVisible();
  await expect(page.locator('#pressArchiveList .w1p-item')).toHaveCount(38);
  await expect(page.locator('#mediaView')).toContainText('공공기관 인력감축 없다더니');
  await expect(page.locator('#newMediaCaseBtn,#mediaCaseList,#mediaStatusFilter,#pressArchiveSource')).toHaveCount(0);
  await expect(page.locator('#mediaView')).not.toContainText('사건 팩트시트');
  await expect(page.locator('#mediaView')).not.toContainText('배포 전 QA');

  await page.locator('[data-press-type="statement"]').click();
  await expect(page.locator('#pressArchiveList .w1p-item')).toHaveCount(13);
  await expect(page.locator('#pressArchiveList')).toContainText('민자철도는 실패했다');
  await expect(page.locator('#pressArchiveList')).not.toContainText('청년일자리 늘린다더니');

  await page.locator('[data-press-type="all"]').click();
  await page.locator('#pressSearch').fill('9호선 2·3단계');
  await expect(page.locator('#pressArchiveList .w1p-item')).toHaveCount(2);

  await page.locator('#pressSearch').fill('');
  await page.locator('#pressArchiveList .w1p-item').first().click();
  await expect(page.locator('#pressDetailModal')).toBeVisible();
  await expect(page.locator('#pressDetailFrame')).toHaveAttribute('srcdoc',/원본 보도자료 본문/);
  await expect(page.locator('#pressDetailFrame')).toHaveAttribute('srcdoc',/https:\/\/work\.bokdoong\.com\/work\/press\/2026-09-22-public-institution-workforce-joint-action\//);
  await expect(page.locator('#pressDetailFrame')).toHaveAttribute('sandbox',/allow-scripts/);
  await page.locator('[data-close-press]').click();
  await expect(page.locator('#pressDetailModal')).toHaveClass(/hidden/);
});
