import {test,expect} from '@playwright/test';

const BASE='http://127.0.0.1:8123';
const APP=`${BASE}/app/`;
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const SESSION_KEY='kptu_collab_session_v1';
const privatePath=/\/(?:rest\/v1|functions\/v1)\//;

function trackSupabase(page){
  const calls={publicIndex:0,private:[],auth:[],featureModules:[],publicWorkspaceAssets:[]};
  page.on('request',request=>{
    const url=new URL(request.url());
    if(url.origin===BASE){
      if(/^\/app\/(?:team|app-router|capabilities|view-loader|mobile-swipe-navigation|public-workspace)\.js$/.test(url.pathname))calls.featureModules.push(url.pathname);
      if(/^\/app\/public-workspace(?:-extras)?\.(?:js|css)$/.test(url.pathname))calls.publicWorkspaceAssets.push(url.pathname);
    }
    if(url.origin!==SB)return;
    if(url.pathname==='/rest/v1/rpc/app_public_workspace_index')calls.publicIndex+=1;
    if(privatePath.test(url.pathname))calls.private.push(url.pathname);
    if(url.pathname.startsWith('/auth/v1/'))calls.auth.push(url.pathname);
  });
  return calls;
}

async function expectLoginOnly(page,target){
  await expect(page).toHaveURL(/\/app\/login\/?\?return=/,{timeout:10000});
  const url=new URL(page.url());
  expect(url.searchParams.get('return')).toBe(target);
  await expect(page.locator('.login-shell')).toBeVisible();
  await expect(page.locator('#googleLoginBtn')).toBeVisible();
  await expect(page.locator('#appView,.app-nav,.modal,#publicLoginBtn')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('공개 업무');
  await expect(page.locator('body')).not.toContainText('로그인 없이 공개 업무 보기');
}

async function mockSignedIn(page){
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token'&&url.searchParams.get('grant_type')==='password')return ok({access_token:'access',refresh_token:'refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:{id:'u1',email:'member@example.org',user_metadata:{display_name:'테스트 사용자'}}});
    if(path==='/auth/v1/token'&&url.searchParams.get('grant_type')==='refresh_token')return ok({access_token:'refreshed',refresh_token:'refresh-2',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user:{id:'u1',email:'member@example.org'}});
    if(path==='/auth/v1/user')return ok({id:'u1',email:'member@example.org',user_metadata:{display_name:'테스트 사용자'}});
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/rest/v1/app_workspace_members'&&url.searchParams.has('user_id')){
      const id=url.searchParams.get('user_id').replace(/^eq\./,'');
      return ok([{workspace_id:'w1',role:'owner',user_id:id,workspace:{id:'w1',slug:'private',name:'웹2'}}]);
    }
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:'w1',role:'owner',user_id:'u1'}]);
    if(path==='/rest/v1/app_workspaces')return ok([{id:'w1',slug:'private',name:'웹2'}]);
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[]});
    if(path==='/functions/v1/google-tasks')return ok({connected:false,authorized:false,tasks:[]});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path.startsWith('/rest/v1/'))return ok([]);
    if(path.startsWith('/functions/v1/'))return ok({});
    return ok({});
  });
}

async function signIn(page,returnTo=APP){
  await page.goto(`${APP}login/?return=${encodeURIComponent(returnTo)}`);
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('member@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:20000});
}

test('anonymous Web2 root renders only the dedicated login and makes no workspace request',async({page})=>{
  const calls=trackSupabase(page);
  await page.goto(APP);
  await expectLoginOnly(page,APP);
  expect(calls.publicIndex).toBe(0);
  expect(calls.private).toEqual([]);
  expect(calls.featureModules).toEqual([]);
  expect(calls.publicWorkspaceAssets).toEqual([]);
});

for(const query of [
  '?view=calendar','?view=tasks','?view=projects','?view=meetings','?view=library','?view=team','?view=media','?view=pages','?project=00000000-0000-0000-0000-000000000000'
]){
  test(`anonymous deep link ${query} redirects to login without workspace traffic`,async({page})=>{
    const calls=trackSupabase(page);
    const target=APP+query;
    await page.goto(target);
    await expectLoginOnly(page,target);
    expect(calls.publicIndex).toBe(0);
    expect(calls.private).toEqual([]);
  });
}

for(const width of [360,390,412,430,1280,1440,1920]){
  test(`anonymous ${width}px viewport has no Web2 shell flash`,async({page})=>{
    await page.setViewportSize({width,height:width<800?844:1000});
    await page.addInitScript(()=>{
      window.__shellFrames=[];
      const sample=()=>{
        const app=document.querySelector('#appView');
        const nav=document.querySelector('.app-nav');
        if(app||nav)window.__shellFrames.push({app:!!app&&getComputedStyle(app).visibility!=='hidden'&&getComputedStyle(app).display!=='none',nav:!!nav&&getComputedStyle(nav).visibility!=='hidden'&&getComputedStyle(nav).display!=='none'});
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    const target=APP+'?view=tasks';
    await page.goto(target);
    await expectLoginOnly(page,target);
    const shellStates=await page.evaluate(()=>window.__shellFrames||[]);
    expect(shellStates.some(state=>state.app||state.nav)).toBe(false);
  });
}

test('dedicated login returns to the authenticated deep link',async({page})=>{
  await mockSignedIn(page);
  const target=APP+'?view=projects';
  await signIn(page,target);
  await expect(page).toHaveURL(target,{timeout:20000});
  await expect(page.locator('#projectsView')).toBeVisible();
  await expect(page.locator('.app-nav')).toBeVisible();
});

test('logout clears the session and back or forward cannot restore private DOM',async({page})=>{
  await mockSignedIn(page);
  await signIn(page,APP);
  await page.locator('.app-nav [data-view="tasks"]').click();
  await expect(page.locator('#tasksView')).toBeVisible();
  await page.locator('#tasksView').evaluate(node=>node.insertAdjacentHTML('beforeend','<div id="privateSentinel">PRIVATE_SENTINEL</div>'));
  await page.locator('#sidebarLogoutBtn').click();
  await expect(page).toHaveURL(/\/app\/login\//,{timeout:20000});
  expect(await page.evaluate(key=>localStorage.getItem(key),SESSION_KEY)).toBeNull();
  await expect(page.locator('#privateSentinel,#appView')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/app\/login\//,{timeout:20000});
  await expect(page.locator('#privateSentinel,#appView')).toHaveCount(0);
  await page.goForward().catch(()=>null);
  await expect(page).toHaveURL(/\/app\/login\//,{timeout:20000});
  await expect(page.locator('#privateSentinel,#appView')).toHaveCount(0);
});

test('expired session refresh failure reaches login without private API calls',async({page})=>{
  const calls=trackSupabase(page);
  await page.route(`${SB}/auth/v1/token?grant_type=refresh_token`,route=>route.fulfill({status:401,contentType:'application/json',body:'{"message":"expired"}'}));
  await page.goto(`${APP}login/`);
  await page.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{key:SESSION_KEY,value:{access_token:'expired',refresh_token:'expired-refresh',expires_at:1,user:{id:'u1'}}});
  await page.goto(APP+'?view=calendar');
  await expect(page).toHaveURL(/\/app\/login\//,{timeout:20000});
  await expect(page.locator('#appView')).toHaveCount(0);
  expect(calls.publicIndex).toBe(0);
  expect(calls.private).toEqual([]);
});

test('direct session owner switch reloads without retaining the previous private DOM',async({page})=>{
  await mockSignedIn(page);
  await signIn(page,APP+'?view=projects');
  await page.locator('#projectsView').evaluate(node=>node.insertAdjacentHTML('beforeend','<div id="privateSentinel">USER_ONE_PRIVATE</div>'));
  await page.evaluate(()=>window.KPTURuntime.session.write({access_token:'second-access',refresh_token:'second-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'u2',email:'second@example.org'}})).catch(()=>null);
  await expect.poll(()=>page.evaluate(()=>window.__KPTU_BOOT_CONTEXT__?.user?.id||'').catch(()=>''),{timeout:20000}).toBe('u2');
  await expect(page.locator('#privateSentinel')).toHaveCount(0);
  await expect(page.locator('#appView')).toBeVisible({timeout:20000});
});

test('logout in another tab locks the current private UI and returns it to login',async({browser})=>{
  const context=await browser.newContext();
  const page=await context.newPage();
  const control=await context.newPage();
  await mockSignedIn(page);
  await signIn(page,APP+'?view=tasks');
  await page.locator('#tasksView').evaluate(node=>node.insertAdjacentHTML('beforeend','<div id="privateSentinel">USER_ONE_PRIVATE</div>'));
  await control.goto(`${BASE}/tests/app-e2e/home-dashboard-v2-fixture.html`);
  await control.evaluate(key=>localStorage.removeItem(key),SESSION_KEY);
  await expect(page).toHaveURL(/\/app\/login\//,{timeout:20000});
  await expect(page.locator('#privateSentinel,#appView')).toHaveCount(0);
  await context.close();
});

test('account switch in another tab reloads without retaining the previous private DOM',async({browser})=>{
  const context=await browser.newContext();
  const page=await context.newPage();
  const control=await context.newPage();
  await mockSignedIn(page);
  await signIn(page,APP+'?view=projects');
  await page.locator('#projectsView').evaluate(node=>node.insertAdjacentHTML('beforeend','<div id="privateSentinel">USER_ONE_PRIVATE</div>'));
  await control.goto(`${BASE}/tests/app-e2e/home-dashboard-v2-fixture.html`);
  await Promise.all([
    page.waitForNavigation({waitUntil:'domcontentloaded'}),
    control.evaluate(({key,value})=>localStorage.setItem(key,JSON.stringify(value)),{
      key:SESSION_KEY,
      value:{access_token:'second-access',refresh_token:'second-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'u2',email:'second@example.org'}}
    })
  ]);
  await expect.poll(()=>page.evaluate(()=>window.__KPTU_BOOT_CONTEXT__?.user?.id||''),{timeout:20000}).toBe('u2');
  await expect(page.locator('#privateSentinel')).toHaveCount(0);
  await expect(page.locator('#appView')).toBeVisible();
  await context.close();
});

test('authenticated workspace initialization failure is explicit and retryable',async({page})=>{
  let failMembership=true;
  await mockSignedIn(page);
  await page.route(`${SB}/rest/v1/app_workspace_members**`,route=>{
    if(failMembership)return route.fulfill({status:503,contentType:'application/json',body:'{"message":"temporary failure"}'});
    const url=new URL(route.request().url());
    const id=(url.searchParams.get('user_id')||'eq.u1').replace(/^eq\./,'');
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{workspace_id:'w1',role:'owner',user_id:id,workspace:{id:'w1',slug:'private',name:'웹2'}}])});
  });
  await page.goto(`${APP}login/?return=${encodeURIComponent(APP)}`);
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('member@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#bootView')).toBeVisible({timeout:20000});
  await expect(page.locator('#bootView')).toContainText('업무 공간을 열 수 없습니다.');
  await expect(page.locator('#bootRetryBtn')).toBeVisible();
  failMembership=false;
  await page.locator('#bootRetryBtn').click();
  await expect(page.locator('#appView')).toBeVisible({timeout:20000});
});

test('web OAuth hash is consumed before the anonymous gate',async({page})=>{
  await mockSignedIn(page);
  const header=Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({sub:'u1',email:'member@example.org',role:'authenticated',aud:'authenticated'})).toString('base64url');
  const token=`${header}.${payload}.signature`;
  await page.goto(`${APP}#access_token=${encodeURIComponent(token)}&refresh_token=oauth-refresh&expires_in=3600&token_type=bearer`);
  await expect(page.locator('#appView')).toBeVisible({timeout:20000});
  await expect(page).toHaveURL(APP);
});

test('Android app Google login still targets the native auth callback',async({browser})=>{
  const context=await browser.newContext({userAgent:'Mozilla/5.0 Android WebView KPTUAndroid/0.1.10'});
  const page=await context.newPage();
  let authorizeUrl='';
  await page.route(`${SB}/auth/v1/authorize**`,route=>{authorizeUrl=route.request().url();return route.abort()});
  await page.goto(`${APP}login/`);
  await page.locator('#googleLoginBtn').click();
  await expect.poll(()=>authorizeUrl).not.toBe('');
  const target=new URL(authorizeUrl);
  expect(target.searchParams.get('provider')).toBe('google');
  expect(target.searchParams.get('redirect_to')).toBe(`${APP}native-callback.html?native=android`);
  await context.close();
});

test('Android Calendar OAuth return is handed to the native app before auth gating',async({page})=>{
  await page.goto(`${APP}?google=connected&native=android`);
  await expect(page.locator('h2')).toContainText('Google Calendar 연결이 완료되었습니다.');
  await expect(page.locator('#openKptuApp')).toHaveAttribute('href','kptuwork://auth?google=connected');
  await expect(page.locator('#appView')).toHaveCount(0);
});
