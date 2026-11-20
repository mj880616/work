import {test,expect} from '@playwright/test';
import {enterLogin} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

// APP-기록+이름바꾸기(S67-44): 내 프로필 '이름 바꾸기'(서버 custom_words) — 시작 때 읽어 첫 그리기부터 내 이름, [기본으로]·[저장], DB 적용 전 안내.
// 모든 이름·글은 합성 값. 서버는 가짜(page.route).
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'custom-words-user',email:'custom-words@example.org',user_metadata:{display_name:'이름 QA'}};
const workspace={id:'custom-words-workspace',slug:'custom-words',name:'웹2'};

async function mockApp(page,{words=null,missing=false}={}){
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
        if(missing)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:'42703',message:'column app_profiles.custom_words does not exist'})});
        return ok([{custom_words:state.words}]);
      }
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

test('내가 바꾼 이름은 첫 화면부터 메뉴·앱 바탕에 보이고, 이름 바꾸기 칸에서 [기본으로]·[저장]한다 (PC)',async({page})=>{
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
  const panel=page.locator('#psCustomWordsPanel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('summary')).toContainText('이름 바꾸기');
  await expect(panel.locator('.cw-count')).toHaveText('3개 바꿈');
  await panel.locator('summary').click();
  const area=panel.locator('[data-cw-slot="area"]');
  await expect(area).toHaveValue('캠페인');
  await expect(area).toHaveAttribute('placeholder','사업영역');
  await expect(panel.locator('[data-cw-slot="kind_policy"]')).toHaveValue('기획 회의');
  await expect(panel.locator('[data-cw-save]')).toBeDisabled();
  // [기본으로]는 그 칸만 비운다.
  await panel.locator('[data-cw-reset="area"]').click();
  await expect(area).toHaveValue('');
  await expect(panel.locator('[data-cw-reset="area"]')).toBeHidden();
  await panel.locator('[data-cw-slot="org_one"]').fill('맡은 곳');
  await expect(panel.locator('[data-cw-save]')).toBeEnabled();
  await panel.locator('[data-cw-save]').click();
  await expect(panel.locator('.cw-state')).toHaveText('저장했어요. 다시 열면 모든 화면에 보여요.');
  expect(state.patches).toEqual([{custom_words:{menu_biz:'활동 일지',org_one:'맡은 곳',kind_policy:'기획 회의'}}]);
  await expect(panel.locator('[data-cw-reload]')).toBeVisible();
  await panel.screenshot({path:'docs/design/screens/s67-44/custom-words-1440.png'});
  // 틀린 글자는 저장 전에 막는다.
  await panel.locator('[data-cw-slot="report"]').fill('a<b');
  await panel.locator('[data-cw-save]').click();
  await expect(panel.locator('.cw-state')).toContainText('20자까지');
  expect(state.patches).toHaveLength(1);
});

test('바꾼 이름이 없으면 글자 그대로, 서버에 칸이 아직 없으면(DB 적용 전) 기본 이름으로 열고 저장 준비 중 (폰)',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:390,height:844});
  await mockApp(page,{missing:true});
  await page.goto(testOrigin+'/app/?view=profile');
  await signIn(page);
  await expect(page.locator('#profileView')).toBeVisible({timeout:20000});
  await expect(page.locator('#areaWindowTitle')).toHaveText('사업영역 관리');
  const panel=page.locator('#psCustomWordsPanel');
  await expect(panel).toBeVisible();
  await panel.locator('summary').click();
  await expect(panel.locator('.cw-state')).toHaveText('저장 준비 중이에요. 조금 뒤에 다시 열어 주세요.');
  await expect(panel.locator('[data-cw-slot="area"]')).toBeDisabled();
  await expect(panel.locator('[data-cw-save]')).toBeDisabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await panel.screenshot({path:'docs/design/screens/s67-44/custom-words-390.png'});
});
