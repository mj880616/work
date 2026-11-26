import {test,expect} from '@playwright/test';
import {enterLogin} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

// S69 STORE-계정삭제: 내 프로필 '계정' 칸 [계정 삭제] → 확인 창(되돌릴 수 없음·남는 것 안내) → 서버 미리 보기 → 확인 글자 '삭제' → 삭제 → 로그아웃.
// 서버(account-delete)는 가짜. 화면은 누가·어느 작업공간인지 보내지 않는다(몸통은 action·confirm뿐).
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'account-delete-user',email:'account-delete@example.org',user_metadata:{display_name:'Delete QA'}};
const workspace={id:'account-delete-workspace',slug:'account-delete',name:'웹2'};

async function mockApp(page,{check={ok:true},checkStatus=200,del={ok:true,files_left:0},delStatus=200}={}){
  const calls={check:[],del:[],logout:0};
  await page.route(`${SB}/**`,async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    const ok=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data??null)});
    if(path==='/auth/v1/token')return ok({access_token:'delete-access',refresh_token:'delete-refresh',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user});
    if(path==='/auth/v1/user')return ok(user);
    if(path==='/auth/v1/logout'){calls.logout++;return ok({})}
    if(path==='/functions/v1/account-delete'){
      if(req.method()==='OPTIONS')return route.fulfill({status:204});
      const body=req.postDataJSON();
      if(body?.action==='check'){calls.check.push(body);return ok(check,checkStatus)}
      calls.del.push(body);return ok(del,delStatus);
    }
    if(path==='/functions/v1/google-calendar')return ok({connected:false,enabled:false,selected:[],calendars:[],events:[],eventColors:{}});
    if(path==='/functions/v1/google-tasks')return ok({connected:true,authorized:true,pending_scope:'all',tasks:[]});
    if(path.startsWith('/functions/v1/'))return ok({});
    if(path.startsWith('/rest/v1/rpc/'))return ok(null);
    if(path==='/rest/v1/app_workspace_members')return ok([{workspace_id:workspace.id,user_id:user.id,role:'owner',email:user.email}]);
    if(path==='/rest/v1/app_workspaces')return ok([workspace]);
    if(path==='/rest/v1/app_profiles')return ok([{user_id:user.id,display_name:'Delete QA',job_title:'QA'}]);
    if(path.startsWith('/rest/v1/'))return ok([]);
    return ok({});
  });
  return calls;
}

async function openProfile(page,width){
  await page.setViewportSize({width,height:900});
  await page.goto(testOrigin+'/app/?view=profile&pane=account'); // S71-36: 계정 삭제는 '계정' 장
  await enterLogin(page);
  await expect(page.locator('#googleLoginBtn')).toBeVisible({timeout:10000});
  await signInWithSession(page,user.email);
  await expect(page.locator('#profileView')).toBeVisible({timeout:20000});
}

for(const [name,width] of [['PC',1280],['phone',390]]){
  test(`계정 삭제: 안내·확인 글자 뒤에만 삭제, 몸통에 id 없음, 끝나면 로그아웃 (${name} ${width}px)`,async({page})=>{
    test.setTimeout(60000);
    const calls=await mockApp(page);
    await openProfile(page,width);
    const entry=page.locator('#profileView [data-ps-page="account"] [data-account-delete]');
    // S71-36 PROFILE-설정화면: '계정' 장 따로 떨어진 묶음의 빨간 줄(공용 설정 줄) — 이름 + 설명 한 줄.
    await expect(entry.locator('.sl-label')).toHaveText('계정 삭제');
    await expect(entry).toHaveClass(/sl-danger/);
    await entry.click();
    const dialog=page.locator('#accountDeleteDialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.acd-lead')).toContainText('되돌릴 수 없어요');
    await expect(dialog.locator('.acd-lead')).toContainText('구글 드라이브·캘린더·할 일의 원본은 내 구글 계정에 그대로');
    // 자세한 목록은 접혀 있다가 펼치면 보인다.
    await expect(dialog.locator('.acd-more')).not.toHaveAttribute('open','');
    await dialog.locator('.acd-more summary').click();
    await expect(dialog.locator('.acd-more')).toContainText('백업');
    await expect.poll(()=>calls.check.length).toBe(1);
    expect(calls.check[0]).toEqual({action:'check'});
    const go=dialog.locator('[data-acd-go]'),word=dialog.locator('[data-acd-word]');
    await expect(word).toBeEnabled();
    await expect(go).toBeDisabled();
    await word.fill('지우기');
    await expect(go).toBeDisabled();
    await word.fill('삭제');
    await expect(go).toBeEnabled();
    expect(calls.del).toEqual([]);
    await go.click();
    await expect(dialog.locator('[data-acd-status]')).toContainText('삭제했어요');
    expect(calls.del).toEqual([{action:'delete',confirm:'삭제'}]);
    // 로그아웃 → 로그인 화면.
    await expect(page.locator('#googleLoginBtn')).toBeVisible({timeout:15000});
    expect(calls.logout).toBeGreaterThanOrEqual(1);
  });
}

test('계정 삭제: 서버가 거절하면 이유 한 줄, 확인 칸·삭제 버튼은 잠김, 닫으면 아무 요청 없음',async({page})=>{
  test.setTimeout(60000);
  const calls=await mockApp(page,{check:{ok:false,code:'ACCOUNT_GROUP_ADMIN_MOVE'}});
  await openProfile(page,1280);
  await page.locator('[data-account-delete]').click();
  const dialog=page.locator('#accountDeleteDialog');
  await expect(dialog.locator('[data-acd-status]')).toContainText('관리자를 넘기거나');
  await expect(dialog.locator('[data-acd-word]')).toBeDisabled();
  await expect(dialog.locator('[data-acd-go]')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-account-delete]')).toBeFocused();
  expect(calls.del).toEqual([]);
});

test('계정 삭제: 서버가 아직 없으면(배포 전) 준비 중, 삭제 실패면 기록은 그대로라고 알림',async({page})=>{
  test.setTimeout(60000);
  await mockApp(page,{check:{error:'not_found'},checkStatus:404});
  await openProfile(page,1280);
  await page.locator('[data-account-delete]').click();
  await expect(page.locator('#accountDeleteDialog [data-acd-status]')).toContainText('준비 중');
  await page.locator('#accountDeleteDialog [data-acd-close]').first().click();
  await expect(page.locator('#accountDeleteDialog')).toBeHidden();
});

test('계정 삭제: 삭제 요청이 실패하면 창에 남고 다시 할 수 있다',async({page})=>{
  test.setTimeout(60000);
  const calls=await mockApp(page,{del:{ok:false,code:'DB_FAILED',error:'DB_FAILED'},delStatus:502});
  await openProfile(page,1280);
  await page.locator('[data-account-delete]').click();
  const dialog=page.locator('#accountDeleteDialog');
  await dialog.locator('[data-acd-word]').fill('삭제');
  await dialog.locator('[data-acd-go]').click();
  await expect(dialog.locator('[data-acd-status]')).toContainText('기록은 그대로예요');
  await expect(dialog.locator('[data-acd-go]')).toBeEnabled();
  expect(calls.logout).toBe(0);
  await expect(page.locator('#profileView')).toBeVisible();
});
