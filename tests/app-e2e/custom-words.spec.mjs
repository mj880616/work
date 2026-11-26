import {test,expect} from '@playwright/test';
import {enterLogin} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {accountButton} from './helpers/shell-navigation.mjs';

// APP-기록+이름바꾸기(S67-44): 내가 고친 이름(서버 custom_words) — 시작 때 읽어 첫 그리기부터 내 이름, DB 적용 전 안내.
// S71-32: 고치는 곳은 메뉴 수정 창 하나(내 프로필 '이름 바꾸기' 상자 없앰, menu-rename.spec.mjs). 시작 때 읽기가 늦어도 기본 이름으로 굳지 않는다.
// 모든 이름·글은 합성 값. 서버는 가짜(page.route).
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'custom-words-user',email:'custom-words@example.org',user_metadata:{display_name:'이름 QA'}};
const workspace={id:'custom-words-workspace',slug:'custom-words',name:'웹2'};

async function mockApp(page,{words=null,missing=false,wordsDelay=0,menuLayout=null}={}){
  const state={words,patches:[],wordReads:0};
  await page.route(`${SB}/**`,async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    const ok=data=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'cw-access',refresh_token:'cw-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/google-tasks')return ok({connected:true,authorized:true,pending_scope:'all',tasks:[]});
    if(path==='/functions/v1/push-notifications')return ok({enabled:false,web_enabled:false,native_enabled:false,public_key:'qa'});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email}]);
    if(path==='/rest/v1/app_workspaces')return ok([workspace]);
    if(path==='/rest/v1/app_profiles'){
      const select=url.searchParams.get('select')||'';
      if(request.method()==='PATCH'){
        const body=request.postDataJSON();
        if('custom_words' in body){
          if(missing)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'42703',message:'column app_profiles.custom_words does not exist'})});
          state.patches.push(body);state.words=body.custom_words;
          return ok([{user_id:user.id,custom_words:state.words}]);
        }
        return ok([{user_id:user.id,...body}]);
      }
      if(select.includes('custom_words')){
        state.wordReads+=1;
        if(wordsDelay&&state.wordReads===1)await new Promise(r=>setTimeout(r,wordsDelay));
        if(missing)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'42703',message:'column app_profiles.custom_words does not exist'})});
        return ok([{custom_words:state.words}]);
      }
      if(select.includes('view_prefs'))return ok([{view_prefs:menuLayout?{menu_layout:menuLayout}:null}]);
      return ok([{user_id:user.id,display_name:'이름 QA',job_title:'담당'}]);
    }
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
  return state;
}

async function signIn(page){
  await enterLogin(page);
  await expect(page.locator('#googleLoginBtn')).toBeVisible({timeout:10000});
  await signInWithSession(page,user.email);
  await expect(page.locator('#appView')).toBeVisible({timeout:15000});
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:15000});
}

test('내가 바꾼 이름은 첫 화면부터 메뉴·앱 바탕에 보이고, 내 프로필에는 이름 바꾸기 상자가 없다 (PC)',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:1440,height:900});
  const state=await mockApp(page,{words:{menu_biz:'활동 일지',area:'캠페인',kind_policy:'기획 회의'}});
  await page.goto(testOrigin+'/app/?view=calendar');
  await signIn(page);
  // 앱 바탕(index.html) 메뉴 글자도 첫 공개 때 이미 내 이름이다.
  await expect(page.locator('.app-nav [data-view="meetings"]').first()).toHaveText('활동 일지');
  await expect(page.locator('#areaWindowTitle')).toHaveText('캠페인 관리');
  await expect(page.locator('.app-nav [data-view="team"]').first()).toHaveText('조직 관리');
  expect(state.wordReads).toBe(1);

  await page.goto(testOrigin+'/app/?view=profile');
  await expect(page.locator('#profileView')).toBeVisible({timeout:20000});
  await expect(page.locator('#profileView .ps-panel').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#psCustomWordsPanel, #profileView .cw-fold, #profileView [data-cw-slot]')).toHaveCount(0);
  await expect(page.locator('#profileView')).not.toContainText('이름 바꾸기');
});

// S71-32 ⑤(명진 폰): 시작 때 고친 이름 읽기가 3.5초를 넘기면 그 접속 내내 하단바·메뉴가 기본 이름으로 보였다(옛 3.5초 끊기).
// 이제 다른 시작 읽기와 같은 기다림이라, 늦게 와도 고친 이름으로 연다. 내 프로필에 머물러도(옛 상자를 펼친 화면 자리) 하단바는 고친 이름 그대로.
test('시작 때 고친 이름 읽기가 늦어도(4.5초) 하단바·메뉴는 고친 이름, 내 프로필에서도 그대로 (폰)',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:390,height:844});
  const layout={bar:['home','note','calendar','team','meetings'],rest:['basket','reading','library','files','brief','hwp','photos','outside']};
  const state=await mockApp(page,{words:{menu_org:'우리 조직',menu_biz:'우리 사업'},wordsDelay:4500,menuLayout:layout});
  await page.goto(testOrigin+'/app/?view=profile');
  await signIn(page);
  const tabs=page.locator('#appView .mobile-tabs');
  await expect(tabs.locator('[data-view="team"]')).toHaveText('우리 조직');
  await expect(tabs.locator('[data-view="meetings"]')).toHaveText('우리 사업');
  await expect(page.locator('#profileView')).toBeVisible({timeout:20000});
  await page.waitForLoadState('networkidle');
  await expect(tabs.locator('[data-view="team"]')).toHaveText('우리 조직');
  await expect(tabs.locator('[data-view="meetings"]')).toHaveText('우리 사업');
  expect(state.wordReads).toBe(1);
});

test('바꾼 이름이 없으면 글자 그대로, 서버에 칸이 아직 없으면(DB 적용 전) 기본 이름으로 열고 메뉴 수정 창에 이름 칸이 없다 (폰)',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:390,height:844});
  await mockApp(page,{missing:true});
  await page.goto(testOrigin+'/app/?view=calendar');
  await signIn(page);
  await expect(page.locator('#areaWindowTitle')).toHaveText('사업영역 관리');
  await accountButton(page).click();
  await page.locator('#mobileMenu [data-menu-edit-open]').click();
  const modal=page.locator('#menuEditModal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('[data-reorder-id="team"] .me-name')).toHaveText('조직 관리');
  await page.waitForLoadState('networkidle');
  await expect(modal.locator('input[data-menu-edit-word]')).toHaveCount(0);
  await expect(modal.locator('details.me-more')).toHaveCount(0);
  await modal.locator('[data-close="menuEditModal"]').click();
  await expect(modal).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
