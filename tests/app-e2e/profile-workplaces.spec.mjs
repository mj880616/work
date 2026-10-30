import { appOrigin } from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';

// PROFILE-화면정리: 내 프로필 화면. 저장 버튼 하나(이름·직책 + 담당 사업장 체크), 맡은 프로젝트 칸·안내문 없음.
// PROFILE-담당사업장접기: 담당 사업장은 '담당조직 현황 n'(접힘) → 담당만 체크된 채 → 접힌 '그 외 n'(맨 위 찾기, 초성 포함).
const url=`${appOrigin}/tests/app-e2e/profile-workplaces-fixture.html`;

async function openProfile(page){
  await page.goto(url);
  await expect(page.locator('#userBadge')).toBeVisible();
  await page.click('#userBadge');
  await expect(page.locator('#profileView')).toBeVisible();
  await expect(page.locator('#psWorkplaceList .pick-fold-head')).toBeVisible();
}
// PROFILE-담당사업장접기: '담당조직 현황 n'을 펼치고, 필요하면 '그 외 n'도 펼친다(사람이 누르는 그대로).
const fold=page=>page.locator('#psWorkplaceList [data-pick-fold]');
const others=page=>page.locator('#psWorkplaceList [data-pick-others]');
async function unfold(page){if(!(await fold(page).evaluate(el=>el.open)))await page.locator('#psWorkplaceList .pick-fold-head').click();await expect(page.locator('#psWorkplaceList .pick-picked')).toBeVisible()}
async function showAll(page){await unfold(page);if(await others(page).count()&&!(await others(page).evaluate(el=>el.open)))await page.locator('#psWorkplaceList .pick-others-head').click();await expect(page.locator('#psWorkplaceList [data-pick-search]')).toBeVisible()}
const pickedNames=page=>page.locator('#psWorkplaceList .pick-picked .ps-org-name');
const calls=page=>page.evaluate(()=>window.__state.calls.map(x=>`${x.method} ${x.path.split('?')[0]}${x.body?.organization_id?' '+x.body.organization_id:''}${x.path.includes('organization_id=eq.')?' '+decodeURIComponent(x.path.match(/organization_id=eq\.([^&]+)/)[1]):''}`));

for(const [label,width] of [['폰 412',412],['폰 884',884],['PC 1440',1440]]){
  test(`${label}: 처음엔 '담당조직 현황 n' 한 줄 → 펼치면 담당만 체크된 채 → '그 외' 펼치면 맨 위 찾기, 찾아 체크하면 담당으로 올라가고 저장된다`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await openProfile(page);
    const view=page.locator('#profileView'),list=page.locator('#psWorkplaceList');
    // ① 처음엔 제목 한 줄만(접힘). 조직 줄·찾기 칸은 보이지 않는다.
    await expect(fold(page)).not.toHaveAttribute('open','');
    await expect(list.locator('.pick-fold-head')).toHaveText(/담당조직 현황\s*1/);
    await expect(list.locator('[data-ps-org-check="org-a"]')).toBeHidden();
    await expect(list.locator('[data-pick-search]')).toBeHidden();
    expect((await page.locator('#psWorkplacePanel').boundingBox()).height).toBeLessThanOrEqual(56);
    await expect(view.locator('#psSaveProfile,#psSaveWorkplaces,#psAddWorkplace,#psDeleteWorkplace,#psWorkplacePicker,#psProjectList,#psNewProject,#psAddProject,#psLedgerEntry,.ps-workplace-note')).toHaveCount(0);
    await expect(view).not.toContainText('맡은 프로젝트');
    await expect(view.locator('button.primary')).toHaveCount(1);
    await expect(view.locator('#psName')).toHaveValue('테스터');
    await expect(view.locator('#psTitle')).toHaveValue('국장');
    await expect(view.locator('#psState')).toHaveText('바뀐 것 없음');
    await expect(view.locator('#psSave')).toBeDisabled();
    // ② 펼치면 내 담당만 체크된 채. 나머지는 접힌 '그 외 3'.
    await unfold(page);
    await expect(pickedNames(page)).toHaveText(['철도노조']);
    await expect(list.locator('[data-ps-org-check="org-a"]')).toBeChecked();
    await expect(list.locator('[data-ps-org-check="org-b"]')).toBeHidden();
    await expect(list.locator('[data-ps-org-check="org-c"]')).toHaveCount(0);
    await expect(list.locator('.pick-others-head')).toHaveText(/그 외\s*3/);
    await expect(others(page)).not.toHaveAttribute('open','');
    // ③ '그 외'를 펼치면 맨 위에 찾기 칸, 그 아래 묶음 순서 목록(묶음 밖은 제목 없이 끝에).
    await showAll(page);
    const search=list.locator('[data-pick-search]');
    const firstRow=await list.locator('.pick-others .ps-org-row').first().boundingBox(),sb=await search.boundingBox();
    expect(sb.y+sb.height).toBeLessThanOrEqual(firstRow.y+1);
    await expect(list.locator('.pick-others .pick-group-name')).toHaveText(['철도','지하철']);
    await expect(list.locator('.pick-others .ps-org-name')).toHaveText(['전국철도노동조합','서울교통공사노동조합','한국가스공사노조']);
    // 크기: 저장 버튼·줄은 작고, 찾기 칸도 작다. 가로로 넘치지 않는다.
    expect((await view.locator('#psSave').boundingBox()).height).toBeLessThanOrEqual(33);
    expect((await list.locator('.ps-org-row').first().boundingBox()).height).toBeLessThanOrEqual(34);
    // UI-점검1030손질 C4: 체크칸(16px)은 작게 두되 줄 전체(label)가 누르는 곳이고 그 범위는 위아래 44px(::after).
    const pick=list.locator('.ps-org-pick').first();
    expect(await pick.evaluate(el=>{const a=getComputedStyle(el,'::after');return {content:a.content,h:parseFloat(a.height),pos:getComputedStyle(el).position}})).toEqual({content:'""',h:44,pos:'relative'});
    expect((await list.locator('.ps-org-box').first().boundingBox()).height).toBeLessThanOrEqual(16.5);
    expect(sb.height).toBeLessThanOrEqual(33);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    // 초성으로 찾기 → 맞는 것만 남는다.
    await search.fill('ㄱㅅㄱ');
    await expect(list.locator('.pick-others .ps-org-name:visible')).toHaveText(['한국가스공사노조']);
    await expect(list.locator('.pick-others .pick-group-name:visible')).toHaveCount(0);
    // 체크하면 담당으로 올라간다. 찾기 글·펼침은 그대로.
    await list.locator('.ps-org-pick',{hasText:'한국가스공사노조'}).click();
    await expect(pickedNames(page)).toHaveText(['철도노조','한국가스공사노조']);
    await expect(list.locator('.pick-picked [data-ps-org-check="org-b"]')).toBeChecked();
    await expect(list.locator('[data-ps-org-check="org-b"]')).toBeFocused();
    await expect(list.locator('.pick-fold-head')).toHaveText(/담당조직 현황\s*2/);
    await expect(list.locator('.pick-others-head')).toHaveText(/그 외\s*2/);
    await expect(search).toHaveValue('ㄱㅅㄱ');
    await expect(view.locator('#psState')).toHaveText('바뀐 것 1곳');
    // 저장은 아래 [저장] 하나, 서버로.
    await view.locator('#psSave').click();
    await expect(view.locator('#psState')).toHaveText('바뀐 것 없음');
    const state=await page.evaluate(()=>window.__state);
    expect(state.assignments.some(x=>x.organization_id==='org-b'&&x.user_id==='u1')).toBeTruthy();
    expect(state.workplaces.some(x=>x.organization_id==='org-b'&&x.user_id==='u1')).toBeTruthy();
    await expect(pickedNames(page)).toHaveText(['철도노조','한국가스공사노조']);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  });
}

test('담당 체크를 풀면 저장 전까지 흐리게 남고, 다시 체크하면 돌아온다. 새로 고른 것을 풀면 그 외로 돌아간다',async({page})=>{
  await openProfile(page);
  await unfold(page);
  const a=page.locator('#psWorkplaceList .ps-org-row',{hasText:'철도노조'}).first();
  await page.locator('.ps-org-pick',{hasText:'철도노조'}).first().click();
  await expect(pickedNames(page)).toHaveText(['철도노조']);
  await expect(a).toHaveClass(/pick-off/);
  expect(Number(await a.evaluate(el=>getComputedStyle(el).opacity))).toBeLessThan(.8);
  await expect(page.locator('[data-ps-org-check="org-a"]')).not.toBeChecked();
  await expect(page.locator('#psWorkplaceList .pick-fold-head')).toHaveText(/담당조직 현황\s*0/);
  await expect(page.locator('#psState')).toHaveText('바뀐 것 1곳');
  await page.locator('.ps-org-pick',{hasText:'철도노조'}).first().click();
  await expect(a).not.toHaveClass(/pick-off/);
  await expect(page.locator('#psState')).toHaveText('바뀐 것 없음');
  await showAll(page);
  await page.locator('.ps-org-pick',{hasText:'서울교통공사노동조합'}).click();
  // 고른 것도 묶음 순서 그대로(지하철 묶음이 묶음 밖보다 앞).
  await expect(pickedNames(page)).toHaveText(['서울교통공사노동조합','철도노조']);
  await page.locator('.ps-org-pick',{hasText:'서울교통공사노동조합'}).click();
  await expect(pickedNames(page)).toHaveText(['철도노조']);
  await expect(page.locator('#psWorkplaceList .pick-others .ps-org-name',{hasText:'서울교통공사노동조합'})).toBeVisible();
  await expect(page.locator('#psState')).toHaveText('바뀐 것 없음');
});

test('찾기: 글자·초성·섞어 쓰기 모두 되고, 없으면 짧게 알린다. 찾기 칸 Enter는 저장하지 않는다',async({page})=>{
  await openProfile(page);
  await showAll(page);
  const search=page.locator('#psWorkplaceList [data-pick-search]'),names=page.locator('#psWorkplaceList .pick-others .ps-org-name:visible');
  await search.fill('철도');await expect(names).toHaveText(['전국철도노동조합']);
  await search.fill('ㅅㅇㄱㅌ');await expect(names).toHaveText(['서울교통공사노동조합']);
  await search.fill('철ㄷㄴ');await expect(names).toHaveText(['전국철도노동조합']);
  await search.fill('없는이름');await expect(names).toHaveCount(0);
  await expect(page.locator('#psWorkplaceList [data-pick-empty]')).toBeVisible();
  await page.fill('#psName','엔터시험');
  await search.press('Enter');
  expect((await calls(page)).some(c=>!c.startsWith('GET'))).toBeFalsy();
  await search.fill('');await expect(names).toHaveCount(3);
  await expect(page.locator('#psWorkplaceList [data-pick-empty]')).toBeHidden();
});

test('화면을 다시 열면 늘 접힌 채 시작한다(접힘 상태는 기억하지 않는다)',async({page})=>{
  await openProfile(page);
  await showAll(page);
  await page.evaluate(()=>window.KPTURouter.go('team'));
  await page.evaluate(()=>window.KPTURouter.go('profile'));
  await expect(page.locator('#psWorkplaceList .pick-fold-head')).toBeVisible();
  await expect(fold(page)).not.toHaveAttribute('open','');
  await unfold(page);
  await expect(others(page)).not.toHaveAttribute('open','');
});

test('이름은 체크만, 줄 끝 ›는 조직 정보 열기 전용',async({page})=>{
  await openProfile(page);
  await showAll(page);
  await page.evaluate(()=>{window.__opened=[];document.addEventListener('click',e=>{const b=e.target.closest('[data-ps-workplace-org]');if(b)window.__opened.push(b.dataset.psWorkplaceOrg)})});
  await page.locator('[data-ps-workplace-org="org-a"]').click();
  await expect(page.locator('[data-ps-org-check="org-a"]')).toBeChecked();
  expect(await page.evaluate(()=>window.__opened)).toEqual(['org-a']);
  await expect(page.locator('#psState')).toHaveText('바뀐 것 없음');
  await page.locator('.ps-org-pick',{hasText:'한국가스공사노조'}).click();
  await expect(page.locator('[data-ps-org-check="org-b"]')).toBeChecked();
  expect(await page.evaluate(()=>window.__opened)).toEqual(['org-a']);
  await expect(page.locator('#psState')).toHaveText('바뀐 것 1곳');
  await page.locator('.ps-org-pick',{hasText:'한국가스공사노조'}).click();
  await expect(page.locator('#psState')).toHaveText('바뀐 것 없음');
  await expect(page.locator('#psSave')).toBeDisabled();
});

test('저장 하나로 프로필 → 사업장 추가 → 사업장 삭제 순서로 저장한다',async({page})=>{
  await openProfile(page);
  await showAll(page);
  await page.fill('#psName','새이름');
  await page.locator('.ps-org-pick',{hasText:'철도노조'}).click();
  await page.locator('.ps-org-pick',{hasText:'한국가스공사노조'}).click();
  await expect(page.locator('#psState')).toHaveText('바뀐 것 3곳');
  await page.click('#psSave');
  await expect(page.locator('#psState')).toHaveText('바뀐 것 없음');
  await expect(page.locator('#toast')).toContainText('저장');
  await expect(page.locator('#psSave')).toBeDisabled();
  const state=await page.evaluate(()=>window.__state);
  expect(state.profile[0].display_name).toBe('새이름');
  expect(state.assignments.some(x=>x.organization_id==='org-b'&&x.user_id==='u1')).toBeTruthy();
  expect(state.workplaces.some(x=>x.organization_id==='org-b'&&x.user_id==='u1')).toBeTruthy();
  expect(state.assignments.some(x=>x.organization_id==='org-a')).toBeFalsy();
  expect(state.workplaces.some(x=>x.organization_id==='org-a')).toBeFalsy();
  const writes=(await calls(page)).filter(c=>!c.startsWith('GET'));
  expect(writes).toEqual([
    'PATCH /rest/v1/app_profiles',
    'POST /rest/v1/app_suborganization_assignees org-b',
    'POST /rest/v1/app_profile_workplaces org-b',
    'DELETE /rest/v1/app_profile_workplaces org-a',
    'DELETE /rest/v1/app_suborganization_assignees org-a'
  ]);
  await expect(page.locator('[data-ps-org-check="org-b"]')).toBeChecked();
  await expect(page.locator('[data-ps-org-check="org-a"]')).not.toBeChecked();
  await expect(page.locator('.ps-legacy-chip')).toContainText('과거 담당기관');
  expect(state.events).toBeGreaterThanOrEqual(1);
  expect(state.reloads).toBeGreaterThanOrEqual(1);
  expect(state.memberReloads).toBeGreaterThanOrEqual(1);
});

test('이름만 바꿔도 저장되고 이름이 비면 저장하지 않는다',async({page})=>{
  await openProfile(page);
  await page.fill('#psName','');
  await page.click('#psSave');
  await expect(page.locator('#toast')).toContainText('이름을 입력해 주세요');
  expect((await calls(page)).some(c=>c.startsWith('PATCH'))).toBeFalsy();
  await page.fill('#psName','이름만');
  await page.fill('#psTitle','');
  await page.click('#psSave');
  await expect(page.locator('#psState')).toHaveText('바뀐 것 없음');
  const state=await page.evaluate(()=>window.__state);
  expect(state.profile[0].display_name).toBe('이름만');
  expect(state.profile[0].job_title).toBeNull();
  expect((await calls(page)).filter(c=>c.startsWith('POST')||c.startsWith('DELETE'))).toEqual([]);
});

test('중간에 실패하면 거기서 멈추고, 저장된 것은 그대로, 실패한 체크는 남아 다시 저장할 수 있다',async({page})=>{
  await openProfile(page);
  await showAll(page);
  await page.evaluate(()=>{window.__state.fail.push({method:'POST',path:'/rest/v1/app_suborganization_assignees',org:'org-b'})});
  await page.fill('#psName','절반만');
  await page.locator('.ps-org-pick',{hasText:'철도노조'}).click();
  await page.locator('.ps-org-pick',{hasText:'한국가스공사노조'}).click();
  await page.click('#psSave');
  await expect(page.locator('#toast')).toContainText('프로필은 저장했고 담당 사업장 2곳은 저장하지 못했어요');
  // 프로필은 저장됨, 사업장은 그대로(삭제까지 가지 않음), 체크는 사용자가 고른 그대로 남음.
  const state=await page.evaluate(()=>window.__state);
  expect(state.profile[0].display_name).toBe('절반만');
  expect(state.assignments.some(x=>x.organization_id==='org-a')).toBeTruthy();
  expect(state.assignments.some(x=>x.organization_id==='org-b')).toBeFalsy();
  await expect(page.locator('[data-ps-org-check="org-b"]')).toBeChecked();
  await expect(page.locator('[data-ps-org-check="org-a"]')).not.toBeChecked();
  await expect(page.locator('#psName')).toHaveValue('절반만');
  await expect(page.locator('#psState')).toHaveText('바뀐 것 2곳');
  await expect(page.locator('#psSave')).toBeEnabled();
  // 다시 저장: 프로필은 다시 보내지 않고 사업장만 보낸다.
  await page.evaluate(()=>{window.__state.fail.length=0;window.__state.calls.length=0});
  await page.click('#psSave');
  await expect(page.locator('#psState')).toHaveText('바뀐 것 없음');
  const after=await page.evaluate(()=>window.__state);
  expect(after.assignments.some(x=>x.organization_id==='org-b')).toBeTruthy();
  expect(after.assignments.some(x=>x.organization_id==='org-a')).toBeFalsy();
  expect((await calls(page)).some(c=>c.startsWith('PATCH /rest/v1/app_profiles'))).toBeFalsy();
});

test('프로필 저장이 실패하면 사업장은 건드리지 않고 입력을 남긴다',async({page})=>{
  await openProfile(page);
  await showAll(page);
  await page.evaluate(()=>{window.__state.fail.push({method:'PATCH',path:'/rest/v1/app_profiles'})});
  await page.fill('#psName','실패이름');
  await page.locator('.ps-org-pick',{hasText:'한국가스공사노조'}).click();
  await page.click('#psSave');
  await expect(page.locator('#toast')).toContainText('프로필과 담당 사업장 1곳은 저장하지 못했어요');
  expect((await calls(page)).some(c=>c.startsWith('POST'))).toBeFalsy();
  await expect(page.locator('#psName')).toHaveValue('실패이름');
  await expect(page.locator('[data-ps-org-check="org-b"]')).toBeChecked();
  await expect(page.locator('#psState')).toHaveText('바뀐 것 2곳');
});

test('저장하지 않고 떠나려 하면 확인창이 한 번 뜨고, 머물면 그대로이고 떠나면 고친 것은 버려진다',async({page})=>{
  await openProfile(page);
  const messages=[];
  let accept=false;
  page.on('dialog',async dialog=>{messages.push(dialog.message());if(accept)await dialog.accept();else await dialog.dismiss()});
  const leave=()=>page.evaluate(()=>window.dispatchEvent(new CustomEvent('kptu:before-view-change',{cancelable:true,detail:{view:'team'}})));
  // 바뀐 것이 없으면 묻지 않는다.
  expect(await leave()).toBe(true);
  expect(messages.length).toBe(0);
  await page.fill('#psName','쓰던이름');
  expect(await leave()).toBe(false);
  expect(messages).toEqual(['저장하지 않은 변경이 있어요. 저장하지 않고 나갈까요?']);
  await expect(page.locator('#psName')).toHaveValue('쓰던이름');
  accept=true;
  expect(await leave()).toBe(true);
  expect(messages.length).toBe(2);
  await page.evaluate(()=>window.KPTURouter.go('team'));
  await page.evaluate(()=>window.KPTURouter.go('profile'));
  await expect(page.locator('#psName')).toHaveValue('테스터');
  await expect(page.locator('#psState')).toHaveText('바뀐 것 없음');
});

test('연결 전 옛 담당 사업장은 목록 아래 작은 글자로만 보인다',async({page})=>{
  await openProfile(page);
  await expect(page.locator('.ps-legacy-wrap')).toBeHidden();
  await showAll(page);
  const legacy=page.locator('.ps-legacy-wrap');
  await expect(legacy).toContainText('기존 담당사업장 정보');
  const last=await page.locator('.ps-org-row').last().boundingBox(),box=await legacy.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(last.y+last.height-1);
  expect(await legacy.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(12);
});
