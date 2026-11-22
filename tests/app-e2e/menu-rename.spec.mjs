import {test,expect} from '@playwright/test';
import {enterLogin} from './helpers/login-entry.mjs';
import {signInWithSession} from './helpers/session-login.mjs';
import {testOrigin} from './helpers/test-origin.mjs';
import {accountButton} from './helpers/shell-navigation.mjs';

// S67-71 · S67-77(A안): '메뉴 수정' 창에서 이름 바꾸기 칸이 있는 메뉴(사업 관리·조직 관리)는 이름 자리가 처음부터 입력칸(값 = 지금 이름).
// 칸 밖으로 나가기·Enter = 저장, 저장은 내 프로필 '이름 바꾸기'와 같은 칸(서버 custom_words)·같은 길, 빈칸 = 기본 이름, [완료] 뒤 앱을 다시 열어 메뉴에 새 이름.
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

for(const width of [1440,412,390]){
  test(`메뉴 수정 창: 이름 칸은 처음부터 입력칸 → 칸 밖·Enter로 저장 → [완료] 뒤 메뉴에 새 이름, 빈칸은 기본 이름, 끌기는 손잡이에서 (${width}px)`,async({page})=>{
    test.setTimeout(90000);
    await page.setViewportSize({width,height:900});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const state=await mockApp(page,{words:{menu_biz:'활동 일지',area:'캠페인'}});
    await page.goto(testOrigin+'/app/?view=calendar');
    await signIn(page);
    await expect(menuText(page,'meetings',width)).toContainText('활동 일지');

    await openEdit(page,width);
    // 이름 칸이 있는 메뉴만 처음부터 입력칸(값 = 지금 이름, 흐린 글자 = 기본 이름). 나머지·홈은 글자. ✎·이름 버튼은 없다.
    const bizIn=row(page,'meetings').locator('input[data-menu-edit-name]'),teamIn=row(page,'team').locator('input[data-menu-edit-name]');
    await expect(bizIn).toHaveValue('활동 일지');
    await expect(bizIn).toHaveAttribute('placeholder','사업 관리');
    await expect(teamIn).toHaveValue('조직 관리');
    await expect(teamIn).toHaveAttribute('placeholder','조직 관리');
    for(const id of ['note','home']){
      await expect(row(page,id).locator('[data-menu-edit-name]')).toHaveCount(0);
      await expect(row(page,id).locator('.me-name')).toHaveText(/\S/);
    }
    await expect(modal(page).locator('[data-menu-edit-rename],.me-pen')).toHaveCount(0);
    expect(await modal(page).locator('.me-body, [data-menu-edit-body]').first().evaluate(el=>el.textContent.includes('✎'))).toBe(false);
    // 콤팩트: 줄 높이 그대로, 입력칸은 얇은 선·줄 안 높이·남는 폭을 채운다.
    const look=await teamIn.evaluate(el=>{const cs=getComputedStyle(el),r=el.getBoundingClientRect(),row=el.closest('.me-row'),rr=row.getBoundingClientRect(),toggle=row.querySelector('.me-toggle').getBoundingClientRect();return {line:parseFloat(cs.borderTopWidth),h:r.height,row:rr.height,gap:toggle.left-r.right}});
    expect(look.line).toBeLessThanOrEqual(1);expect(look.h).toBeLessThanOrEqual(26);expect(look.row).toBeLessThanOrEqual(29);expect(look.gap).toBeLessThanOrEqual(12);
    expect(await noOverflow(page)).toBe(true);

    // 입력칸을 눌러도 끌기가 시작되지 않고 글을 쓴다. Esc는 고치던 글자만 되돌리고 창은 닫지 않는다.
    await teamIn.click();
    await expect(teamIn).toBeFocused();
    await teamIn.fill('그만둘 이름');
    await page.keyboard.press('Escape');
    await expect(modal(page)).toBeVisible();
    await expect(teamIn).toHaveValue('조직 관리');
    expect(state.patches).toHaveLength(0);

    // 새 이름 → 칸 밖 누르기(blur) = 저장(다른 칸은 그대로 둔다).
    await teamIn.fill('거래처·직원');
    await expect.poll(()=>noOverflow(page)).toBe(true);
    await modal(page).locator('.me-group h3').first().click();
    await expect(modal(page).locator('.me-note')).toContainText('바꿨어요');
    expect(state.patches).toEqual([{custom_words:{menu_biz:'활동 일지',area:'캠페인',menu_org:'거래처·직원'}}]);
    await expect(teamIn).toHaveValue('거래처·직원');
    if(width>760)await expect(modal(page).locator('.me-pv-box')).toContainText('거래처·직원');
    // 같은 이름으로 칸을 들락날락하면 저장하지 않는다.
    await teamIn.focus();await teamIn.blur();
    await page.waitForTimeout(200);
    expect(state.patches).toHaveLength(1);

    // 틀린 글자는 저장하지 않고 칸에 그대로 둔다(Enter).
    await bizIn.fill('a<b');
    await bizIn.press('Enter');
    await expect(modal(page).locator('.me-note')).toContainText('20자까지');
    await expect(bizIn).toHaveValue('a<b');
    await expect(bizIn).toHaveAttribute('aria-invalid','true');
    expect(state.patches).toHaveLength(1);

    // 빈칸 + Enter = 기본 이름으로 되돌리기(칸에는 기본 이름이 보인다).
    await bizIn.fill('');
    await bizIn.press('Enter');
    await expect(modal(page).locator('.me-note')).toContainText('기본 이름');
    expect(state.patches[1]).toEqual({custom_words:{area:'캠페인',menu_org:'거래처·직원'}});
    await expect(bizIn).not.toHaveAttribute('aria-invalid','true');
    await bizIn.blur();
    await expect(bizIn).toHaveValue('사업 관리');
    expect(state.patches).toHaveLength(2);

    // 끌기는 ⠿ 손잡이에서 여전히 된다(이름 칸이 있는 줄도). 옮긴 뒤에도 입력칸 값 그대로.
    const rowList=await row(page,'team').evaluate(el=>el.closest('[data-reorder-list]').dataset.reorderList);
    const before=await ids(page,rowList),idx=before.indexOf('team');
    const target=before[idx>1?idx-1:idx+1];
    const handle=row(page,'team').locator('[data-reorder-handle]');
    await handle.scrollIntoViewIfNeeded();
    const from=await handle.boundingBox(),to=await row(page,target).boundingBox();
    const toY=idx>1?to.y+3:to.y+to.height-3;
    await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
    await page.mouse.move(from.x+from.width/2,from.y+from.height/2+(toY>from.y?6:-6),{steps:3});
    await page.mouse.move(from.x+from.width/2,toY,{steps:6});await page.mouse.up();
    await expect.poll(()=>ids(page,rowList)).not.toEqual(before);
    await expect(teamIn).toHaveValue('거래처·직원');
    // 입력칸 위에서 끌어도 줄이 움직이지 않는다(글자 고르기).
    const now=await ids(page,rowList),box=await teamIn.boundingBox();
    await page.mouse.move(box.x+8,box.y+box.height/2);await page.mouse.down();
    await page.mouse.move(box.x+8,box.y+box.height/2+40,{steps:6});await page.mouse.up();
    await page.waitForTimeout(200);
    expect(await ids(page,rowList)).toEqual(now);
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

// 칸에 새 이름을 쓰고 곧바로 [완료]를 눌러도(칸 밖으로 나가며 시작된 저장) 저장이 끝난 뒤 앱을 다시 연다.
test('메뉴 수정 창: 이름을 쓰고 바로 [완료] → 저장 뒤 다시 열기 (390px)',async({page})=>{
  test.setTimeout(60000);
  await page.setViewportSize({width:390,height:900});
  const state=await mockApp(page,{words:null});
  await page.goto(testOrigin+'/app/?view=calendar');
  await signIn(page);
  await openEdit(page,390);
  const teamIn=row(page,'team').locator('input[data-menu-edit-name]');
  await expect(teamIn).toHaveValue('조직 관리');
  await teamIn.fill('거래처');
  await Promise.all([page.waitForEvent('load',{timeout:20000}),modal(page).locator('[data-close="menuEditModal"]').click()]);
  expect(state.patches).toEqual([{custom_words:{menu_org:'거래처'}}]);
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
  await expect(menuText(page,'team',390)).toContainText('거래처',{timeout:20000});
});
