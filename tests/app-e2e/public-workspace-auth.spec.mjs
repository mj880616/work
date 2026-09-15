import {test,expect} from '@playwright/test';

const BASE='http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';

async function mockPublic(page){
  const calls={snapshot:0};
  const snapshot={
    spaces:[{id:'p1',name:'공개 프로젝트',slug:'public-project',description:'공개 사업 설명',status:'active',parent_id:null,sort_order:10}],
    tasks:[{id:'t1',project_id:'p1',title:'프로젝트 공개 할 일',status:'todo',priority:'high',due_at:null,note:'INTERNAL_NOTE',assignee_name:'INTERNAL_ASSIGNEE'},{id:'personal',project_id:null,title:'개인 할 일',status:'todo',priority:'normal'}],
    pages:[{id:'pg1',space_id:'p1',slug:'public-page',title:'공개 게시물',summary:'공개 요약',updated_at:new Date().toISOString()}],
    documents:[{id:'d1',project_id:'p1',title:'공개 자료',category:'정책자료',source:'테스트 출처',document_date:'2026-09-15',description:'공개 설명',tags:['테스트'],drive_url:'https://example.com/public-doc',file_name:'public.pdf'}]
  };
  await page.route(`${SB}/rest/v1/rpc/app_public_projects_snapshot`,route=>{calls.snapshot+=1;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(snapshot)})});
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
    if(path==='/rest/v1/app_workspaces')return ok([{id:'w1',slug:'public-institutions',name:'공공기관사업팀 Workspace'}]);
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[]});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
}

test('anonymous root exposes every menu while content stays permission-scoped',async({page})=>{
  const calls=await mockPublic(page);
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(`${BASE}/app/`);
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#authView')).toBeHidden();
  await expect(page.locator('#userBadge')).toContainText('공개 열람');

  for(const view of ['home','calendar','tasks','projects','library','meetings','pages','team']){
    await expect(page.locator(`.app-nav [data-view="${view}"]`)).toBeVisible();
  }
  await expect.poll(()=>calls.snapshot).toBeGreaterThanOrEqual(1);
  expect(errors).toEqual([]);
  await expect(page.locator('#homeView')).toContainText('공개 업무 둘러보기');

  await page.locator('.app-nav [data-view="tasks"]').click();
  const publicTasks=page.locator('#tasksView .public-task-list');
  await expect(publicTasks).toContainText('프로젝트 공개 할 일');
  await expect(publicTasks).not.toContainText('개인 할 일');
  await expect(publicTasks).not.toContainText('INTERNAL_NOTE');
  await expect(publicTasks).not.toContainText('INTERNAL_ASSIGNEE');

  await page.locator('.app-nav [data-view="calendar"]').click();
  await expect(page.locator('#calendarView')).toContainText('공동 일정은 로그인 후 열람할 수 있습니다.');

  await page.locator('.app-nav [data-view="projects"]').click();
  await expect(page.locator('#projectGrid')).toContainText('공개 프로젝트');
  await page.locator('[data-public-project="p1"]').click();
  await expect(page.locator('#publicProjectBody')).toContainText('프로젝트 공개 할 일');
  await expect(page.locator('#publicProjectBody')).not.toContainText('개인 할 일');
  await expect(page.locator('#publicProjectBody')).not.toContainText('INTERNAL_NOTE');
  await expect(page.locator('#publicProjectBody')).not.toContainText('INTERNAL_ASSIGNEE');
  await page.locator('#publicProjectClose').click();

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

  await page.locator('.app-nav [data-view="team"]').click();
  await expect(page.locator('#teamView')).toContainText('팀 정보는 로그인 후 열람할 수 있습니다.');

  await page.locator('#publicLoginBtn').click();
  await expect(page).toHaveURL(/\/app\/login\/?\?return=/);
  await expect(page.locator('#emailAuthToggle')).toBeVisible();
});

test('anonymous deep link keeps the requested locked menu instead of redirecting to projects',async({page})=>{
  await mockPublic(page);
  await page.goto(`${BASE}/app/?view=meetings`);
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#meetingsView')).toBeVisible();
  await expect(page.locator('#meetingsView')).toContainText('회의 결과는 로그인 후 열람할 수 있습니다.');
  await expect(page).toHaveURL(`${BASE}/app/?view=meetings`);
});

test('guest mobile mode loads swipe navigation',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const page=await context.newPage();
  await mockPublic(page);
  await page.goto(`${BASE}/app/`);
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect.poll(()=>page.evaluate(()=>window.__KPTU_MOBILE_SWIPE_NAV__===true)).toBe(true);
  await context.close();
});

test('Android native back returns to prior view and never falls through to app exit',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,userAgent:'Mozilla/5.0 Android WebView KPTUAndroid/0.1.10'});
  await context.addInitScript(()=>{
    window.KPTUNativeBack={
      _stack:['home','tasks'],
      handle(){
        const prev=this._stack.pop();
        if(!prev)return false;
        window.KPTURouter?.go?.(prev,{source:'native-back',replaceUrl:true});
        return true;
      }
    };
  });
  const page=await context.newPage();
  await mockPublic(page);
  await page.goto(`${BASE}/app/`);
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect.poll(()=>page.evaluate(()=>!!window.KPTUNativeBack?.__kptuGuarded)).toBe(true);
  await page.locator('.app-nav [data-view="tasks"]').click();
  await page.locator('.app-nav [data-view="projects"]').click();
  await expect(page.locator('#projectsView')).toBeVisible();
  expect(await page.evaluate(()=>window.KPTUNativeBack.handle())).toBe(true);
  await expect(page.locator('#tasksView')).toBeVisible();
  expect(await page.evaluate(()=>window.KPTUNativeBack.handle())).toBe(true);
  await expect(page.locator('#homeView')).toBeVisible();
  expect(await page.evaluate(()=>window.KPTUNativeBack.handle())).toBe(true);
  await expect(page.locator('#homeView')).toBeVisible();
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
  await expect(page.locator('#userBadge')).toContainText('테스트 사용자');
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
