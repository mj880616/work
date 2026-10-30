import {test,expect} from '@playwright/test';
import {accountButton} from './helpers/shell-navigation.mjs';
import {enterLogin} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

// UI-프로필입구: [계정 ▾] 맨 위 [내 프로필] → 라우터(KPTURouter.go)가 #profileView를 연다. 모듈은 첫 사용 때 view-loader가 불러온다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'profile-entry-user',email:'profile-entry@example.org',user_metadata:{display_name:'Entry QA'}};
const workspace={id:'profile-entry-workspace',slug:'profile-entry',name:'웹2'};

async function mockApp(page){
  const profileReads=[];
  await page.route(`${SB}/**`,async route=>{
    const path=new URL(route.request().url()).pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'entry-access',refresh_token:'entry-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/auth/v1/logout')return ok({});
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/google-tasks')return ok({connected:true,authorized:true,pending_scope:'all',tasks:[]});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email}]);
    if(path==='/rest/v1/app_workspaces')return ok([workspace]);
    if(path==='/rest/v1/app_profiles'){profileReads.push(route.request().url());return ok([{user_id:user.id,display_name:'Entry QA',job_title:'Entry Title'}])}
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
  return profileReads;
}

async function signIn(page){
  await enterLogin(page);
  await expect(page.locator('#googleLoginBtn')).toBeVisible({timeout:10000});
  await signInWithSession(page,user.email);
  await expect(page.locator('#appView')).toBeVisible({timeout:10000});
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:10000});
}

for(const [name,width] of [['PC',1440],['mid',900],['phone',390]]){
  test(`계정 메뉴 맨 위 [내 프로필]이 프로필 화면을 열고 뒤로가기로 돌아온다 (${name} ${width}px)`,async({page})=>{
    test.setTimeout(60000);
    await page.setViewportSize({width,height:900});
    await mockApp(page);
    await page.goto(testOrigin+'/app/?view=calendar');
    await signIn(page);
    await expect(page.locator('#calendarView')).toBeVisible();
    await expect(page.locator('#profileView')).toHaveCount(0);

    const phoneLike=width<=760;
    const panel=page.locator(phoneLike?'#mobileMenu':'#sidebarAccountPanel');
    const entries=panel.locator(phoneLike?'#mobileAccountGroup button':'button');
    await accountButton(page).click();
    await expect(panel).toBeVisible();
    expect(await entries.allTextContents()).toEqual(['내 프로필','메뉴 편집','화면 색','로그아웃']);
    const profile=panel.locator('[data-profile-open]');
    await expect(profile).toHaveClass(/account-action/);
    await profile.click();

    await expect(panel).toBeHidden();
    await expect(page.locator('#profileView')).toBeVisible({timeout:15000});
    await expect(page.locator('#calendarView')).toBeHidden();
    await expect(page).toHaveURL(/view=profile/);
    await expect(page.locator('#psName')).toHaveValue('Entry QA');
    await expect(page.locator('#psTitle')).toHaveValue('Entry Title');
    await expect(page.locator('#psWorkplacePanel')).toBeVisible();

    // 새로고침해도 프로필 화면이 유지된다(주소의 view=profile을 시작 로더가 같은 방식으로 불러온다).
    await page.reload();
    await expect(page.locator('#profileView')).toBeVisible({timeout:20000});
    await expect(page.locator('#psName')).toHaveValue('Entry QA');
    await page.goBack();
    await expect(page.locator('#calendarView')).toBeVisible();
    await expect(page.locator('#profileView')).toBeHidden();
    await expect(page).toHaveURL(/view=calendar/);

    // 두 번째 열기: 이미 만든 화면을 다시 보여 주고 자료만 새로 읽는다(화면이 두 개 생기지 않는다).
    await accountButton(page).click();
    await panel.locator('[data-profile-open]').click();
    await expect(page.locator('#profileView')).toBeVisible();
    await expect(page.locator('#profileView')).toHaveCount(1);
    await page.goBack();
    await expect(page.locator('#calendarView')).toBeVisible();
  });
}

test('PC 계정 메뉴: Esc로 닫으면 화면은 그대로이고, 메뉴를 열었다 뒤로가기하면 프로필이 열리지 않는다',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:1440,height:900});
  await mockApp(page);
  await page.goto(testOrigin+'/app/?view=calendar');
  await signIn(page);
  const account=accountButton(page),panel=page.locator('#sidebarAccountPanel');
  await account.click();await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');await expect(panel).toBeHidden();
  await expect(page.locator('#calendarView')).toBeVisible();
  await account.click();await page.goBack();
  await expect(panel).toBeHidden();
  await expect(page.locator('#calendarView')).toBeVisible();
  await expect(page.locator('#profileView')).toHaveCount(0);
});

// ORG-사본갱신퇴장: [사본 갱신] 칸(버튼·갱신 시각·사본 링크)은 앱에서 없어졌고, 앱은 시작 때 drive-summary를 부르지 않는다.
// ORG-사본자동갱신: 저장 뒤 자동 갱신 모듈(window.KPTUDriveSummary, saved만)은 화면에 아무것도 그리지 않는다.
for(const [name,width] of [['PC',1440],['mid',900],['phone',390]]){
  test(`계정 메뉴에 [사본 갱신]이 없고 순서가 내 프로필·화면 색·로그아웃이다 (${name} ${width}px)`,async({page})=>{
    test.setTimeout(60000);
    const driveCalls=[];
    page.on('request',request=>{if(new URL(request.url()).pathname==='/functions/v1/drive-summary')driveCalls.push(request.method())});
    await page.setViewportSize({width,height:900});
    await mockApp(page);
    await page.goto(testOrigin+'/app/?view=calendar');
    await signIn(page);
    await expect(page.locator('#calendarView')).toBeVisible();
    const phoneLike=width<=760;
    const panel=page.locator(phoneLike?'#mobileMenu':'#sidebarAccountPanel');
    await accountButton(page).click();
    await expect(panel).toBeVisible();
    await expect(panel.locator(phoneLike?'#mobileAccountGroup button':'button')).toHaveText(['내 프로필','메뉴 편집','화면 색','로그아웃']);
    await expect(panel.locator('[data-drive-summary-refresh],[data-drive-summary-status],[data-account-drive-slot],.drive-summary-time,.drive-summary-links')).toHaveCount(0);
    await expect(panel).not.toContainText('사본');
    await expect(page.locator('body')).not.toContainText('사본 갱신');
    expect(await page.evaluate(()=>Object.keys(window.KPTUDriveSummary||{}))).toEqual(['saved']);
    expect(driveCalls).toEqual([]);
  });
}
