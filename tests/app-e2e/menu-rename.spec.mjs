import {test,expect} from '@playwright/test';
import {enterLogin} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {accountButton} from './helpers/shell-navigation.mjs';

// S67-71: '메뉴 수정' 창에서 이름 바꾸기 칸이 있는 메뉴(사업 관리·조직 관리)의 이름을 그 줄에서 바로 바꾼다.
// 저장은 내 프로필 '이름 바꾸기'와 같은 칸(서버 custom_words)·같은 길, 빈칸 = 기본 이름, [완료] 뒤 앱을 다시 열어 메뉴에 새 이름.
// 모든 이름·글은 합성 값. 서버는 가짜(page.route).
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const user={id:'menu-rename-user',email:'menu-rename@example.org',user_metadata:{display_name:'이름 QA'}};
const workspace={id:'menu-rename-workspace',slug:'menu-rename',name:'웹2'};

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


const modal=page=>page.locator('#menuEditModal');
const row=(page,id)=>modal(page).locator(`[data-reorder-id="${id}"]`);
async function openEdit(page,width){
  await accountButton(page).click();
  const panel=page.locator(width<=760?'#mobileMenu':'#sidebarAccountPanel');
  await expect(panel).toBeVisible();
  await panel.locator('[data-menu-edit-open]').click();
  await expect(modal(page)).toBeVisible();
}
const noOverflow=page=>page.evaluate(()=>{
  const card=document.querySelector('#menuEditModal .menu-edit-card');
  return document.documentElement.scrollWidth<=innerWidth&&card.scrollWidth<=card.clientWidth+1;
});
const menuText=(page,view,width)=>page.locator(width<=760?`#appView .mobile-tabs [data-view="${view}"]`:`.app-nav [data-view="${view}"]`).first();

for(const width of [1440,390]){
  test(`메뉴 수정 창에서 메뉴 이름 바꾸기 → 저장 → [완료] 뒤 메뉴에 새 이름, 빈칸은 기본 이름 (${width}px)`,async({page})=>{
    test.setTimeout(90000);
    await page.setViewportSize({width,height:900});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const state=await mockApp(page,{words:{menu_biz:'활동 일지',area:'캠페인'}});
    await page.goto(testOrigin+'/app/?view=calendar');
    await signIn(page);
    await expect(menuText(page,'meetings',width)).toContainText('활동 일지');

    await openEdit(page,width);
    // 이름 칸이 있는 메뉴만 이름 글자가 버튼이다.
    await expect(row(page,'meetings').locator('[data-menu-edit-rename]')).toHaveText(/활동 일지/);
    await expect(row(page,'team').locator('[data-menu-edit-rename]')).toHaveText(/조직 관리/);
    await expect(row(page,'note').locator('[data-menu-edit-rename]')).toHaveCount(0);
    await expect(row(page,'home').locator('[data-menu-edit-rename]')).toHaveCount(0);
    // 작게: ⑥ 아이콘 버튼(선·바탕 없음), 줄 높이는 그대로.
    const look=await row(page,'team').locator('[data-menu-edit-rename]').evaluate(el=>{const cs=getComputedStyle(el);return {line:cs.borderTopColor,bg:cs.backgroundColor,row:el.closest('.me-row').getBoundingClientRect().height}});
    expect(look.line).toBe('rgba(0, 0, 0, 0)');expect(look.bg).toBe('rgba(0, 0, 0, 0)');expect(look.row).toBeLessThanOrEqual(29);

    // Esc는 입력만 그만두고 창은 닫지 않는다.
    await row(page,'team').locator('[data-menu-edit-rename]').click();
    const teamIn=row(page,'team').locator('[data-menu-edit-name]');
    await expect(teamIn).toBeFocused();
    await expect(teamIn).toHaveValue('');
    await expect(teamIn).toHaveAttribute('placeholder','조직 관리');
    await teamIn.fill('그만둘 이름');
    await page.keyboard.press('Escape');
    await expect(modal(page)).toBeVisible();
    await expect(teamIn).toHaveCount(0);
    expect(state.patches).toHaveLength(0);

    // 새 이름 → Enter = 저장(다른 칸은 그대로 둔다).
    await row(page,'team').locator('[data-menu-edit-rename]').click();
    await teamIn.fill('거래처·직원');
    await expect.poll(()=>noOverflow(page)).toBe(true);
    await teamIn.press('Enter');
    await expect(modal(page).locator('.me-note')).toContainText('바꿨어요');
    expect(state.patches).toEqual([{custom_words:{menu_biz:'활동 일지',area:'캠페인',menu_org:'거래처·직원'}}]);
    await expect(row(page,'team').locator('[data-menu-edit-rename]')).toHaveText(/거래처·직원/);
    if(width>760)await expect(modal(page).locator('.me-pv-box')).toContainText('거래처·직원');

    // 틀린 글자는 저장하지 않고 칸을 열어 둔다.
    await row(page,'meetings').locator('[data-menu-edit-rename]').click();
    const bizIn=row(page,'meetings').locator('[data-menu-edit-name]');
    await expect(bizIn).toHaveValue('활동 일지');
    await bizIn.fill('a<b');
    await bizIn.press('Enter');
    await expect(modal(page).locator('.me-note')).toContainText('20자까지');
    await expect(bizIn).toBeVisible();
    expect(state.patches).toHaveLength(1);

    // 빈칸 = 기본 이름으로 되돌리기.
    await bizIn.fill('');
    await bizIn.press('Enter');
    await expect(modal(page).locator('.me-note')).toContainText('기본 이름');
    expect(state.patches[1]).toEqual({custom_words:{area:'캠페인',menu_org:'거래처·직원'}});
    await expect(row(page,'meetings').locator('[data-menu-edit-rename]')).toHaveText(/사업 관리/);
    expect(await noOverflow(page)).toBe(true);
    await modal(page).screenshot({path:`test-results/menu-rename-${width}.png`});

    // [완료] → 앱을 다시 열어 메뉴·하단바·왼쪽 메뉴가 새 이름.
    await Promise.all([page.waitForEvent('load',{timeout:20000}),modal(page).locator('[data-close="menuEditModal"]').click()]);
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
    await expect(menuText(page,'team',width)).toContainText('거래처·직원',{timeout:20000});
    await expect(menuText(page,'meetings',width)).toContainText('사업 관리');
    expect(errors).toEqual([]);
  });
}
