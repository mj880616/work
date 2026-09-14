import { test, expect } from '@playwright/test';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';

async function mock(page,{role='owner'}={}){
  await page.route(`${SB}/**`,async route=>{
    const u=new URL(route.request().url()),p=u.pathname;
    const ok=x=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(x??null)});
    if(p==='/auth/v1/token')return ok({access_token:'qa',refresh_token:'qa',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600});
    if(p==='/auth/v1/user')return ok({id:'qa-owner',email:'owner@example.org',user_metadata:{display_name:'QA 관리자'}});
    if(p==='/rest/v1/app_workspace_members')return ok([{workspace_id:'qa-ws',user_id:'qa-owner',role}]);
    if(p==='/rest/v1/app_workspaces')return ok([{id:'qa-ws',name:'QA Workspace'}]);
    if(p==='/rest/v1/app_profiles')return ok([{user_id:'qa-owner',display_name:'QA 관리자'}]);
    if(p==='/rest/v1/app_access_requests')return ok([{id:'req-1',user_id:'new-user',display_name:'신규 조합원',email:'new@example.org',requested_role:'author',requested_at:'2026-09-14T00:00:00Z',status:'pending'}]);
    if(p==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,calendars:[],events:[]});
    if(p==='/functions/v1/google-tasks')return ok({tasks:[],needs_reconnect:false});
    if(p==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(p.startsWith('/rest/v1/')||p.startsWith('/functions/v1/'))return ok([]);
    return ok({});
  });
}

async function login(page,url='http://127.0.0.1:8123/app/?view=team&focus=access-requests'){
  await page.goto(url);
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('owner@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
}

test('access request deep link opens approval inside Team member management',async({page})=>{
  await mock(page);
  await login(page);
  await expect(page.locator('#teamView')).toBeVisible({timeout:10000});
  const review=page.locator('#aaReviewSection');
  await expect(review).toBeVisible({timeout:10000});
  await expect(review).toContainText('가입 승인 요청');
  await expect(review).toContainText('신규 조합원');
  await expect(review).toContainText('열람자');
  await expect(review).toContainText('작성자');
  await expect(review).toContainText('편집자');
  await expect(review).toContainText('관리자');
  await expect(review).toContainText('새 팀 콘텐츠 작성·수정은 할 수 없음');
  await expect(review).toContainText('팀 공용 항목을 다른 사람이 만든 경우에도 수정·정리');
  await expect(page.locator('#aaPendingCount')).toHaveText('대기 1명');
  await expect(review).toHaveAttribute('open','');
  await expect.poll(()=>page.evaluate(()=>document.activeElement?.id)).toBe('aaReviewSection');
  expect(new URL(page.url()).searchParams.get('focus')).toBe('access-requests');
});

test('admin sees only Team pending badge, not a separate Home approval card',async({page})=>{
  await mock(page);
  await login(page,'http://127.0.0.1:8123/app/');
  const badge=page.locator('.app-nav [data-view="team"] .aa-nav-badge');
  await expect(badge).toBeVisible({timeout:10000});
  await expect(badge).toHaveText('1');
  await expect(page.locator('#aaHomeCard')).toHaveCount(0);
  await page.locator('.app-nav [data-view="team"]').click();
  const review=page.locator('#aaReviewSection');
  await expect(review).toBeVisible();
  await review.locator('summary').click();
  await expect(review).toHaveAttribute('open','');
  await expect(review).toContainText('신규 조합원');
});

test('selected approval role immediately explains what that role means',async({page})=>{
  await mock(page);
  await login(page);
  const select=page.locator('[data-aa-role="req-1"]');
  await select.selectOption('viewer');
  await expect(page.locator('[data-aa-help="req-1"]')).toContainText('새 팀 콘텐츠 작성·수정은 할 수 없음');
  await select.selectOption('editor');
  await expect(page.locator('[data-aa-help="req-1"]')).toContainText('다른 사람이 만든 경우에도 수정·정리');
});

test('ordinary member does not see access approval controls',async({page})=>{
  await mock(page,{role:'author'});
  await login(page,'http://127.0.0.1:8123/app/');
  await expect(page.locator('.app-nav [data-view="team"] .aa-nav-badge')).toBeHidden();
  await expect(page.locator('#aaHomeCard')).toHaveCount(0);
  await expect(page.locator('#aaReviewSection')).toHaveCount(0);
});
