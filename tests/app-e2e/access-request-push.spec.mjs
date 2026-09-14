import { test, expect } from '@playwright/test';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';

async function mock(page){
  await page.route(`${SB}/**`,async route=>{
    const u=new URL(route.request().url()),p=u.pathname;
    const ok=x=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x??null)});
    if(p==='/auth/v1/token')return ok({access_token:'qa',refresh_token:'qa',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
    if(p==='/auth/v1/user')return ok({id:'qa-owner',email:'owner@example.org',user_metadata:{display_name:'QA 관리자'}});
    if(p==='/rest/v1/app_workspace_members')return ok([{workspace_id:'qa-ws',user_id:'qa-owner',role:'owner'}]);
    if(p==='/rest/v1/app_workspaces')return ok([{id:'qa-ws',name:'QA Workspace'}]);
    if(p==='/rest/v1/app_profiles')return ok([{user_id:'qa-owner',display_name:'QA 관리자'}]);
    if(p==='/rest/v1/app_access_requests')return ok([{id:'req-1',user_id:'new-user',display_name:'신규 조합원',email:'new@example.org',requested_role:'author',requested_at:'2026-09-14T00:00:00Z',status:'pending'}]);
    if(p==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,calendars:[],events:[]});
    if(p==='/functions/v1/google-tasks')return ok({tasks:[],needs_reconnect:false});
    if(p==='/functions/v1/push-notifications')return ok({enabled:false,count:0,public_key:'qa'});
    if(p.startsWith('/rest/v1/')||p.startsWith('/functions/v1/'))return ok([]);
    return ok({});
  });
}

async function login(page){
  await page.goto('http://127.0.0.1:8123/app/?view=team&focus=access-requests');
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('owner@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
}

test('access request push deep link opens Team approval area',async({page})=>{
  await mock(page);
  await login(page);
  await expect(page.locator('#teamView')).toBeVisible({timeout:10000});
  await expect(page.locator('#aaReviewSection')).toBeVisible({timeout:10000});
  await expect(page.locator('#aaReviewSection')).toContainText('가입 승인');
  await expect(page.locator('#aaReviewSection')).toContainText('신규 조합원');
  await expect(page.locator('#aaPendingCount')).toHaveText('대기 1명');
  await expect.poll(()=>page.evaluate(()=>document.activeElement?.id)).toBe('aaReviewSection');
  expect(new URL(page.url()).searchParams.get('focus')).toBe('access-requests');
});
