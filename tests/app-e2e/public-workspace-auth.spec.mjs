import {test,expect} from '@playwright/test';

const BASE='http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';

async function mockPublic(page){
  const snapshot={spaces:[{id:'p1',name:'공개 프로젝트',slug:'public-project',description:'공개 사업 설명',status:'active',parent_id:null,sort_order:10}],tasks:[{id:'t1',project_id:'p1',title:'프로젝트 공개 할 일',status:'todo',priority:'high',due_at:null,note:'외부 비공개 내부 메모',assignee_name:'비공개 담당자'},{id:'personal',project_id:null,title:'개인 할 일 - 표시 금지',status:'todo',priority:'normal'}],pages:[{id:'pg1',space_id:'p1',slug:'public-page',title:'공개 게시물',summary:'공개 요약',updated_at:new Date().toISOString()}]};
  await page.route(`${SB}/rest/v1/rpc/app_public_projects_snapshot`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(snapshot)}));
}

async function mockSignedIn(page){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token'&&url.searchParams.get('grant_type')==='password')return ok({access_token:'access',refresh_token:'refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer'});
    if(path==='/auth/v1/user')return ok({id:'u1',email:'member@example.org',user_metadata:{display_name:'테스트 사용자'}});
    if(path==='/rest/v1/app_workspace_members'&&url.searchParams.has('user_id'))return ok([{workspace_id:'w1',role:'owner',user_id:'u1'}]);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'w1',role:'owner',user_id:'u1'}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'w1',slug:'public-institutions',name:'공공기관사업팀 Workspace'}]);
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[]});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

test('anonymous root is a read-only workspace, not a login screen',async({page})=>{
  await mockPublic(page);
  await page.goto(`${BASE}/app/`);
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#authView')).toBeHidden();
  await expect(page.locator('#userBadge')).toContainText('공개 열람');
  await expect(page.locator('.app-nav [data-view="projects"]')).toBeVisible();
  await expect(page.locator('.app-nav [data-view="pages"]')).toBeVisible();
  await expect(page.locator('.app-nav [data-view="tasks"]')).toBeHidden();
  await page.getByRole('button',{name:/공개 프로젝트/}).click();
  await expect(page.locator('#publicProjectBody')).toContainText('프로젝트 공개 할 일');
  await expect(page.locator('#publicProjectBody')).not.toContainText('개인 할 일 - 표시 금지');
  await expect(page.locator('#publicProjectBody')).not.toContainText('외부 비공개 내부 메모');
  await expect(page.locator('#publicProjectBody')).not.toContainText('비공개 담당자');
  await page.locator('#publicProjectClose').click();
  await page.locator('.app-nav [data-view="pages"]').click();
  await expect(page.locator('#pageList')).toContainText('공개 게시물');
  await page.locator('#publicLoginBtn').click();
  await expect(page).toHaveURL(/\/app\/login\/?\?return=/);
  await expect(page.locator('#emailAuthToggle')).toBeVisible();
});

test('dedicated login signs in and returns to authenticated app',async({page})=>{
  await mockSignedIn(page);
  await page.goto(`${BASE}/app/login/?return=${encodeURIComponent(`${BASE}/app/?view=projects`)}`);
  await expect(page.locator('#appView')).toHaveCount(0);
  await expect(page.locator('#emailAuthToggle')).toBeVisible();
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('member@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page).toHaveURL(`${BASE}/app/?view=projects`,{timeout:10000});
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#userBadge')).toContainText('테스트 사용자');
});
