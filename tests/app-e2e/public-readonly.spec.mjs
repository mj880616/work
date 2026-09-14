import {test,expect} from '@playwright/test';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';

async function mockPublic(page){
  const snapshot={
    spaces:[
      {id:'p1',name:'공개 프로젝트',slug:'public-project',description:'공개 사업 설명',status:'active',parent_id:null,sort_order:10},
      {id:'p2',name:'공개 하위 프로젝트',slug:'public-child',description:'하위 사업',status:'active',parent_id:'p1',sort_order:20}
    ],
    tasks:[
      {id:'t1',project_id:'p1',title:'프로젝트 공개 할 일',status:'todo',priority:'high',due_at:null,note:'외부에 노출되면 안 되는 내부 메모',assignee_name:'비공개 담당자'},
      {id:'personal',project_id:null,title:'개인 할 일 - 절대 표시 금지',status:'todo',priority:'normal'}
    ],
    pages:[
      {id:'pg1',space_id:'p1',slug:'public-page',title:'공개 게시물',summary:'공개 요약',updated_at:new Date().toISOString()}
    ]
  };
  await page.route(`${SB}/rest/v1/rpc/app_public_projects_snapshot`,async route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(snapshot)}));
}

test('anonymous users browse public projects, project tasks and public pages without write controls',async({page})=>{
  await mockPublic(page);
  await page.goto('/app/');
  await expect(page.locator('#appView')).toBeVisible();
  await expect(page.locator('#authView')).toBeHidden();
  await expect(page.locator('#userBadge')).toContainText('공개 열람');

  await expect(page.locator('.app-nav [data-view="projects"]')).toBeVisible();
  await expect(page.locator('.app-nav [data-view="pages"]')).toBeVisible();
  await expect(page.locator('.app-nav [data-view="tasks"]')).toBeHidden();
  await expect(page.locator('#newProjectBtn')).toBeHidden();

  await page.getByRole('button',{name:/공개 프로젝트/}).click();
  await expect(page.locator('#publicProjectModal')).toBeVisible();
  await expect(page.locator('#publicProjectBody')).toContainText('프로젝트 공개 할 일');
  await expect(page.locator('#publicProjectBody')).not.toContainText('개인 할 일 - 절대 표시 금지');
  await expect(page.locator('#publicProjectBody')).not.toContainText('외부에 노출되면 안 되는 내부 메모');
  await expect(page.locator('#publicProjectBody')).not.toContainText('비공개 담당자');

  await page.locator('#publicProjectClose').click();
  await page.locator('.app-nav [data-view="pages"]').click();
  await expect(page.locator('#pageList')).toContainText('공개 게시물');
  await expect(page.locator('#newPageBtn')).toBeHidden();
  await expect(page.locator('#pageList a[href*="/p/public-page/"]')).toBeVisible();
});

test('login button returns to existing authentication flow',async({page})=>{
  await mockPublic(page);
  await page.goto('/app/');
  await page.locator('#publicLoginBtn').click();
  await expect(page.locator('#authView')).toBeVisible();
  await expect(page.locator('#appView')).toBeHidden();
  await expect(page.locator('#authEmail')).toBeVisible();
  await expect(page.getByRole('button',{name:'로그인'}).first()).toBeVisible();
});
