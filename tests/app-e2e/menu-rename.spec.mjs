import {test,expect} from '@playwright/test';
import {enterLogin} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {accountButton} from './helpers/shell-navigation.mjs';

// S67-71 · S67-77(A안): '메뉴 수정' 창에서 이름 바꾸기 칸이 있는 메뉴(사업 관리·조직 관리)는 이름 자리가 처음부터 입력칸(값 = 지금 이름).
// S71-32: 내 프로필 '이름 바꾸기' 상자를 없애고 여기로 옮겼다. 메뉴가 아닌 이름·활동 분류는 맨 아래 접힌 '다른 이름' 묶음.
// 저장은 [완료] 하나로 함께(서버 custom_words 같은 칸·같은 길), 빈칸 = 기본 이름, 저장했으면 앱을 다시 열어 하단바·왼쪽 메뉴에 새 이름.
// 끌기는 ⠿ 손잡이에서만(입력칸을 누르면 글 입력). 모든 이름·글은 합성 값. 서버는 가짜(page.route).
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
// S68-37: 저장된 메뉴 순서가 없는 계정은 조직·사업 칸이 하단바가 아니라 [메뉴] 창에 있어 폰은 두 곳 중 있는 쪽을 본다.
const menuText=(page,view,width)=>page.locator(width<=760?`#appView :is(.mobile-tabs, #mobileMenu nav) [data-view="${view}"]`:`.app-nav [data-view="${view}"]`).first();

const ids=(page,list)=>modal(page).locator(`[data-reorder-list="${list}"] > [data-reorder-id]`).evaluateAll(els=>els.map(el=>el.dataset.reorderId));

for(const width of [1440,390]){
  test(`메뉴 수정 창: 메뉴 줄에서 이름 고치기 + '다른 이름'에서 분류 이름 고치기 → [완료] 한 번에 저장 → 하단바·왼쪽 메뉴에 새 이름, 비우면 기본 이름 (${width}px)`,async({page})=>{
    test.setTimeout(90000);
    await page.setViewportSize({width,height:900});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const state=await mockApp(page,{words:{menu_biz:'활동 일지',area:'캠페인'}});
    await page.goto(testOrigin+'/app/?view=calendar');
    await signIn(page);
    await expect(menuText(page,'meetings',width)).toContainText('활동 일지');

    await openEdit(page,width);
    // 이름 칸이 있는 메뉴만 줄의 이름 자리가 입력칸(값 = 지금 이름, 흐린 글자 = 기본 이름). 나머지·홈은 글자.
    const bizIn=row(page,'meetings').locator('input[data-menu-edit-name]'),teamIn=row(page,'team').locator('input[data-menu-edit-name]');
    await expect(bizIn).toHaveValue('활동 일지');
    await expect(bizIn).toHaveAttribute('placeholder','사업 관리');
    await expect(teamIn).toHaveValue('조직 관리');
    for(const id of ['note','home']){
      await expect(row(page,id).locator('[data-menu-edit-name]')).toHaveCount(0);
      await expect(row(page,id).locator('.me-name')).toHaveText(/\S/);
    }
    // 콤팩트: 줄 높이 그대로, 입력칸은 얇은 선·줄 안 높이·남는 폭을 채운다.
    const look=await teamIn.evaluate(el=>{const cs=getComputedStyle(el),r=el.getBoundingClientRect(),row=el.closest('.me-row'),rr=row.getBoundingClientRect(),toggle=row.querySelector('.me-toggle').getBoundingClientRect();return {line:parseFloat(cs.borderTopWidth),h:r.height,row:rr.height,gap:toggle.left-r.right}});
    expect(look.line).toBeLessThanOrEqual(1);expect(look.h).toBeLessThanOrEqual(26);expect(look.row).toBeLessThanOrEqual(29);expect(look.gap).toBeLessThanOrEqual(12);
    expect(await noOverflow(page)).toBe(true);

    // '다른 이름' 묶음: 처음엔 접힘(n개 바꿈), 펼치면 메뉴가 아닌 이름 5칸 + 활동 분류 8칸이 같은 줄 모양.
    const more=modal(page).locator('details.me-more');
    await expect(more).not.toHaveAttribute('open','');
    await expect(more.locator('summary')).toContainText('다른 이름');
    await expect(more.locator('summary')).toContainText('1개 바꿈');
    await more.locator('summary').click();
    const words=more.locator('input[data-menu-edit-word]');
    await expect(words).toHaveCount(13);
    await expect(more.locator('[data-menu-edit-word="area"]')).toHaveValue('캠페인');
    await expect(more.locator('[data-menu-edit-word="area"]')).toHaveAttribute('placeholder','사업영역');
    await expect(more.locator('[data-menu-edit-word="kind_policy"]')).toHaveValue('정책');
    expect(await more.locator('.me-row').first().evaluate(el=>el.getBoundingClientRect().height)).toBeLessThanOrEqual(29);
    await expect(more.locator('[data-reorder-id]')).toHaveCount(0);

    // 입력칸을 눌러도 끌기가 시작되지 않고 글을 쓴다. Esc는 고치던 글자만 되돌리고 창은 닫지 않는다. 칸 밖으로 나가도 저장하지 않는다(저장은 [완료]).
    await teamIn.click();
    await expect(teamIn).toBeFocused();
    await teamIn.fill('그만둘 이름');
    await page.keyboard.press('Escape');
    await expect(modal(page)).toBeVisible();
    await expect(teamIn).toHaveValue('조직 관리');
    await teamIn.fill('거래처·직원');
    await teamIn.press('Enter');
    await bizIn.fill('');                       // 비우면 기본 이름
    await more.locator('[data-menu-edit-word="kind_policy"]').fill('기획');
    await more.locator('[data-menu-edit-word="area"]').fill('');
    await modal(page).locator('.me-note').click();
    await page.waitForTimeout(200);
    expect(state.patches).toEqual([]);
    await expect(modal(page).locator('.me-note')).toContainText('[완료]');

    // 끌어도(손잡이) 고친 글자는 그대로.
    const rowList=await row(page,'team').evaluate(el=>el.closest('[data-reorder-list]').dataset.reorderList);
    const before=await ids(page,rowList),idx=before.indexOf('team'),target=before[idx>1?idx-1:idx+1];
    const handle=row(page,'team').locator('[data-reorder-handle]');
    await row(page,'team').evaluate(el=>el.scrollIntoView({block:'center'})); // 창 머리(고정)에 가리지 않게 가운데로
    const from=await handle.boundingBox(),to=await row(page,target).boundingBox();
    const toY=idx>1?to.y+3:to.y+to.height-3;
    await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
    await page.mouse.move(from.x+from.width/2,from.y+from.height/2+(toY>from.y?6:-6),{steps:3});
    await page.mouse.move(from.x+from.width/2,toY,{steps:6});await page.mouse.up();
    await expect.poll(()=>ids(page,rowList)).not.toEqual(before);
    await expect(teamIn).toHaveValue('거래처·직원');
    await expect(bizIn).toHaveValue('');
    await expect(modal(page).locator('details.me-more')).toHaveAttribute('open','');
    await expect(modal(page).locator('[data-menu-edit-word="kind_policy"]')).toHaveValue('기획');
    await modal(page).screenshot({path:`test-results/menu-rename-${width}.png`});

    // [완료] → 고친 칸만 한 번에 저장(다른 칸은 서버 값 그대로) → 앱을 다시 열어 하단바·왼쪽 메뉴에 새 이름.
    await Promise.all([page.waitForEvent('load',{timeout:20000}),modal(page).locator('[data-close="menuEditModal"]').click()]);
    expect(state.patches).toEqual([{custom_words:{menu_org:'거래처·직원',kind_policy:'기획'}}]);
    await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
    await expect(menuText(page,'team',width)).toContainText('거래처·직원',{timeout:20000});
    await expect(menuText(page,'meetings',width)).toContainText('사업 관리');
    expect(errors).toEqual([]);
  });
}

// 틀린 글자는 [완료]에서 막고 창을 닫지 않는다. 접힌 '다른 이름' 안 칸이면 펼쳐서 보인다.
test('메뉴 수정 창: 틀린 이름은 [완료]에서 막고 그 칸을 보인다 (390px)',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:390,height:900});
  const state=await mockApp(page,{words:null});
  await page.goto(testOrigin+'/app/?view=calendar');
  await signIn(page);
  await openEdit(page,390);
  await modal(page).locator('details.me-more summary').click();
  await modal(page).locator('[data-menu-edit-word="report"]').fill('a<b');
  await modal(page).locator('details.me-more summary').click();
  await expect(modal(page).locator('details.me-more')).not.toHaveAttribute('open','');
  await modal(page).locator('[data-close="menuEditModal"]').click();
  await expect(modal(page)).toBeVisible();
  await expect(modal(page).locator('details.me-more')).toHaveAttribute('open','');
  await expect(modal(page).locator('[data-menu-edit-word="report"]')).toHaveAttribute('aria-invalid','true');
  await expect(modal(page).locator('[data-menu-edit-word="report"]')).toBeFocused();
  await expect(modal(page).locator('.me-note')).toContainText('20자까지');
  expect(state.patches).toEqual([]);
  // 고치면 저장하고 다시 연다.
  await modal(page).locator('[data-menu-edit-word="report"]').fill('일지');
  await Promise.all([page.waitForEvent('load',{timeout:20000}),modal(page).locator('[data-close="menuEditModal"]').click()]);
  expect(state.patches).toEqual([{custom_words:{report:'일지'}}]);
});

// 칸에 새 이름을 쓰고 곧바로 [완료]를 눌러도 저장이 끝난 뒤 앱을 다시 연다. 이름을 안 고쳤으면 다시 열지 않는다.
test('메뉴 수정 창: 이름을 쓰고 바로 [완료] → 저장 뒤 다시 열기, 안 고쳤으면 그냥 닫기 (390px)',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:390,height:900});
  const state=await mockApp(page,{words:null});
  await page.goto(testOrigin+'/app/?view=calendar');
  await signIn(page);
  let loads=0;page.on('load',()=>{loads+=1;});
  await openEdit(page,390);
  await modal(page).locator('[data-close="menuEditModal"]').click();
  await expect(modal(page)).toBeHidden();
  await page.waitForTimeout(800);
  expect(loads).toBe(0);
  await openEdit(page,390);
  const teamIn=row(page,'team').locator('input[data-menu-edit-name]');
  await expect(teamIn).toHaveValue('조직 관리');
  await teamIn.fill('거래처');
  await Promise.all([page.waitForEvent('load',{timeout:20000}),modal(page).locator('[data-close="menuEditModal"]').click()]);
  expect(state.patches).toEqual([{custom_words:{menu_org:'거래처'}}]);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
  await expect(menuText(page,'team',390)).toContainText('거래처',{timeout:20000});
});
