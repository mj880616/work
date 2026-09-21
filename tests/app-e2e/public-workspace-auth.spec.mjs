import {test,expect} from '@playwright/test';

const BASE='http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';

async function mockPublic(page){
  const calls={index:0,broadSnapshots:0,projectSlugs:[]};
  const publishedSlug='project-123456781234123412341234567890ab';
  const index={
    projects:[{slug:publishedSlug,name:'공개 프로젝트',description:'공개 사업 설명',status:'active',updated_at:'2026-09-20T00:00:00Z'}],
    pages:[{slug:'public-page',title:'공개 게시물',summary:'공개 요약',published_at:'2026-09-20T00:00:00Z',updated_at:'2026-09-20T00:00:00Z'}],
    documents:[{title:'공개 자료',category:'정책자료',source:'테스트 출처',document_date:'2026-09-15',description:'공개 설명',tags:['테스트'],drive_url:'https://example.com/public-doc',file_name:'public.pdf',updated_at:'2026-09-20T00:00:00Z'}]
  };
  await page.route(`${SB}/rest/v1/rpc/app_public_workspace_index`,route=>{calls.index+=1;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(index)})});
  await page.route(`${SB}/rest/v1/rpc/app_public_project`,route=>{
    calls.projectSlugs.push(route.request().postDataJSON()?.p_slug);
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({title:'공개 프로젝트',summary:'공개 사업 설명',blocks:[{section:'진행상황',title:'공개 업무',type:'text',content:{text:'공개 진행상황'}}]})});
  });
  for(const name of ['app_public_projects_snapshot','app_public_workspace_snapshot']){
    await page.route(`${SB}/rest/v1/rpc/${name}`,route=>{calls.broadSnapshots+=1;return route.fulfill({status:403,contentType:'application/json',body:'{"message":"permission denied"}'})});
  }
  return calls;
}

async function mockSignedIn(page){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token'&&url.searchParams.get('grant_type')==='password')return ok({access_token:'access',refresh_token:'refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer'});
    if(path==='/auth/v1/user')return ok({id:'u1',email:'member@example.org',user_metadata:{display_name:'테스트 사용자'}});
    if(path==='/rest/v1/app_workspace_members'&&url.searchParams.has('user_id'))return ok([{workspace_id:'w1',role:'owner',user_id:'u1'}]);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'w1',role:'owner',user_id:'u1'}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'w1',slug:'public-institutions',name:'웹2'}]);
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[]});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

test('anonymous app entry uses the narrow public index and gates internal work',async({page})=>{
  const calls=await mockPublic(page);
  const errors=[];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(`${BASE}/app/`);
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#authView')).toBeHidden();
  await expect(page.locator('#userBadge,#teamManageTop,#ccMessageTop')).toHaveCount(0);

  for(const view of ['home','calendar','tasks','projects','library','meetings','pages']){
    await expect(page.locator(`.app-nav [data-view="${view}"]`)).toBeVisible();
  }
  await expect(page.locator('#teamManageTop')).toHaveCount(0);
  await expect(page.locator('#pagesMediaEntry')).toHaveCount(0);
  await expect.poll(()=>calls.index).toBeGreaterThanOrEqual(1);
  expect(calls.broadSnapshots).toBe(0);
  expect(errors).toEqual([]);
  await expect(page.locator('#homeView')).toContainText('공개 업무');
  for(const label of ['프로젝트','다가오는 주요 일정','게시판','자료실']){
    await expect(page.locator('#homeView')).toContainText(label);
  }
  await expect(page.locator('#homeView .panel')).toHaveCount(4);
  await expect(page.locator('#homeView')).not.toContainText('INTERNAL_EVENT_BODY');
  await expect(page.locator('.app-nav [data-view="pages"]')).toHaveText('게시판');

  await page.locator('.app-nav [data-view="tasks"]').click();
  await expect(page.locator('#tasksView')).toContainText('할 일은 로그인 후 열람할 수 있습니다.');
  await expect(page.locator('#tasksView')).not.toContainText('프로젝트 공개 할 일');
  await expect(page.locator('#tasksView')).not.toContainText('개인 할 일');

  await page.locator('.app-nav [data-view="calendar"]').click();
  await expect(page.locator('#calendarView')).toContainText('공개된 공동 일정이 없습니다.');
  await expect(page.locator('#calendarView')).toContainText('개인 일정·Google 일정·상세 메모·참석자 정보는 비로그인 사용자에게 노출하지 않습니다.');
  await expect(page.locator('#calendarView')).not.toContainText('INTERNAL_EVENT_BODY');
  await expect(page.locator('#calendarView')).not.toContainText('INTERNAL_ATTENDEE');

  await page.locator('.app-nav [data-view="projects"]').click();
  await expect(page.locator('#projectGrid')).toContainText('공개 프로젝트');
  await expect(page.locator('#projectGrid')).not.toContainText('비공개 프로젝트');
  await page.locator('#projectGrid [data-public-project="project-123456781234123412341234567890ab"]').click();
  await expect(page).toHaveURL(`${BASE}/p/?slug=project-123456781234123412341234567890ab`);
  await expect(page.locator('#paper')).toContainText('공개 진행상황');
  await expect(page.locator('#paper')).not.toContainText('INTERNAL_NOTE');
  expect(calls.projectSlugs).toEqual(['project-123456781234123412341234567890ab']);
  await page.goto(`${BASE}/app/?view=library`);

  await page.locator('.app-nav [data-view="library"]').click();
  await expect(page.locator('#libraryView')).toContainText('공개 자료');
  await expect(page.locator('#libraryView')).not.toContainText('자료실은 로그인 후 열람할 수 있습니다.');

  await page.locator('.app-nav [data-view="pages"]').click();
  await expect(page.locator('#pageList')).toContainText('공개 게시물');
  await expect(page.locator('#pagesView')).toContainText('링크 공개(unlisted)');
  await expect(page.locator('#pagesView')).toContainText('비공개 글은 제목과 요약도 외부 목록에 노출하지 않습니다.');
  const pageCard=page.locator('#pageList .page-card').first();
  await expect(pageCard).toHaveAttribute('data-public-card-url',/\/p\/public-page\/$/);
  await expect(pageCard.locator('.page-card-foot a.mini')).toBeHidden();

  await page.goto(`${BASE}/app/?view=team`);
  await expect(page.locator('#teamView')).toContainText('팀 정보는 로그인 후 열람할 수 있습니다.');

  await page.locator('#publicLoginBtn').click();
  await expect(page).toHaveURL(/\/app\/login\/?\?return=/);
  await expect(page.locator('#emailAuthToggle')).toBeVisible();
  expect(calls.index).toBeGreaterThanOrEqual(1);
  expect(calls.broadSnapshots).toBe(0);
});

test('anonymous internal deep links show a login gate without internal records',async({page})=>{
  const calls=await mockPublic(page);
  const target=`${BASE}/app/?view=meetings&project=hidden`;
  await page.goto(target);
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#meetingsView')).toContainText('로그인');
  await expect(page.locator('#meetingsView')).not.toContainText('hidden');
  await expect.poll(()=>calls.index).toBeGreaterThanOrEqual(1);
  expect(calls.broadSnapshots).toBe(0);
});

test('anonymous mobile library keeps the public read-only view',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const page=await context.newPage();
  const calls=await mockPublic(page);
  await page.goto(`${BASE}/app/?view=library`);
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#libraryView')).toContainText('공개 자료');
  await expect(page.locator('#libraryView')).not.toContainText('INTERNAL_NOTE');
  await expect.poll(()=>calls.index).toBeGreaterThanOrEqual(1);
  expect(calls.broadSnapshots).toBe(0);
  await context.close();
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
  await expect(page.locator('#userBadge')).toHaveCount(0);
});

test('Android app Google login returns through native callback',async({browser})=>{
  const context=await browser.newContext({userAgent:'Mozilla/5.0 Android WebView KPTUAndroid/0.1.10'});
  const page=await context.newPage();
  let authorizeUrl='';
  await page.route(`${SB}/auth/v1/authorize**`,route=>{authorizeUrl=route.request().url();return route.abort()});
  await page.goto(`${BASE}/app/login/`);
  await page.locator('#googleLoginBtn').click();
  await expect.poll(()=>authorizeUrl).not.toBe('');
  const target=new URL(authorizeUrl);
  expect(target.searchParams.get('provider')).toBe('google');
  expect(target.searchParams.get('redirect_to')).toBe(`${BASE}/app/native-callback.html?native=android`);
  await context.close();
});
