import { appOrigin } from './helpers/test-origin.mjs';
import {test,expect} from '@playwright/test';

// PROFILE-화면정리: 내 프로필 화면. 저장 버튼 하나(이름·직책 + 담당 사업장 체크), 담당 사업장은 묶음 순서의 체크 목록, 맡은 프로젝트 칸·안내문 없음.
const url=`${appOrigin}/tests/app-e2e/profile-workplaces-fixture.html`;

async function openProfile(page){
  await page.goto(url);
  await expect(page.locator('#userBadge')).toBeVisible();
  await page.click('#userBadge');
  await expect(page.locator('#profileView')).toBeVisible();
  await expect(page.locator('[data-ps-org-check="org-a"]')).toBeVisible();
}
const calls=page=>page.evaluate(()=>window.__state.calls.map(x=>`${x.method} ${x.path.split('?')[0]}${x.body?.organization_id?' '+x.body.organization_id:''}${x.path.includes('organization_id=eq.')?' '+decodeURIComponent(x.path.match(/organization_id=eq\.([^&]+)/)[1]):''}`));

for(const [label,width] of [['폰 390',390],['PC 1280',1280]]){
  test(`${label}: 한 줄 저장 버튼, 묶음 순서 체크 목록, 맡은 프로젝트·안내문·추가/삭제 버튼 없음`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await openProfile(page);
    const view=page.locator('#profileView');
    await expect(view.locator('.ps-group-name')).toHaveText(['철도','지하철','그 외']);
    await expect(view.locator('.ps-org-name')).toHaveText(['전국철도노동조합','서울교통공사노동조합','철도노조','한국가스공사노조']);
    await expect(view.locator('[data-ps-org-check="org-c"]')).toHaveCount(0);
    await expect(view.locator('#psSaveProfile,#psSaveWorkplaces,#psAddWorkplace,#psDeleteWorkplace,#psWorkplacePicker,#psProjectList,#psNewProject,#psAddProject,#psLedgerEntry,.ps-workplace-note')).toHaveCount(0);
    await expect(view).not.toContainText('맡은 프로젝트');
    await expect(view).not.toContainText('저장합니다');
    await expect(view.locator('p')).toHaveCount(await view.locator('.ps-group-name').count());
    await expect(view.locator('button.primary')).toHaveCount(1);
    await expect(view.locator('#psName')).toHaveAttribute('aria-label','이름');
    await expect(view.locator('#psName')).toHaveValue('테스터');
    await expect(view.locator('#psTitle')).toHaveValue('국장');
    await expect(view.locator('#psState')).toHaveText('바뀐 것 없음');
    await expect(view.locator('#psSave')).toBeDisabled();
    await expect(view.locator('#psWorkplaceCount')).toHaveText('1곳 선택');
    await expect(view.locator('[data-ps-org-check="org-a"]')).toBeChecked();
    await expect(view.locator('[data-ps-org-check="org-b"]')).not.toBeChecked();
    await expect(view.locator('.ps-legacy-chip')).toContainText('과거 담당기관');
    await expect(view.locator('.ps-legacy-chip')).toContainText('산하조직 연결 전');
    // 칸 제목은 한 가지 크기, 저장 버튼은 작다.
    const sizes=await view.locator('.ps-panel h3').evaluateAll(els=>els.map(e=>getComputedStyle(e).fontSize));
    expect(new Set(sizes).size).toBe(1);
    expect((await view.locator('#psSave').boundingBox()).height).toBeLessThanOrEqual(33);
    expect((await view.locator('.ps-org-row').first().boundingBox()).height).toBeLessThanOrEqual(34);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    const xs=await view.locator('.ps-org-row').evaluateAll(els=>els.map(e=>Math.round(e.getBoundingClientRect().x)));
    expect(new Set(xs).size).toBe(width>=1024?2:1);
  });
}

test('이름은 체크만, 줄 끝 ›는 조직 정보 열기 전용',async({page})=>{
  await openProfile(page);
  await page.evaluate(()=>{window.__opened=[];document.addEventListener('click',e=>{const b=e.target.closest('[data-ps-workplace-org]');if(b)window.__opened.push(b.dataset.psWorkplaceOrg)})});
  await page.locator('[data-ps-workplace-org="org-a"]').click();
  await expect(page.locator('[data-ps-org-check="org-a"]')).toBeChecked();
  expect(await page.evaluate(()=>window.__opened)).toEqual(['org-a']);
  await expect(page.locator('#psState')).toHaveText('바뀐 것 없음');
  await page.locator('.ps-org-pick',{hasText:'한국가스공사노조'}).click();
  await expect(page.locator('[data-ps-org-check="org-b"]')).toBeChecked();
  expect(await page.evaluate(()=>window.__opened)).toEqual(['org-a']);
  await expect(page.locator('#psState')).toHaveText('바뀐 것 1곳');
  await expect(page.locator('#psWorkplaceCount')).toHaveText('2곳 선택');
  await page.locator('.ps-org-pick',{hasText:'한국가스공사노조'}).click();
  await expect(page.locator('#psState')).toHaveText('바뀐 것 없음');
  await expect(page.locator('#psSave')).toBeDisabled();
});

test('저장 하나로 프로필 → 사업장 추가 → 사업장 삭제 순서로 저장한다',async({page})=>{
  await openProfile(page);
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
  await page.evaluate(()=>{window.__state.fail.push({method:'PATCH',path:'/rest/v1/app_profiles'})});
  await page.fill('#psName','실패이름');
  await page.locator('.ps-org-pick',{hasText:'한국가스공사노조'}).click();
  await page.click('#psSave');
  await expect(page.locator('#toast')).toContainText('프로필은 저장하지 못했어요');
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
  const legacy=page.locator('.ps-legacy-wrap');
  await expect(legacy).toContainText('기존 담당사업장 정보');
  const last=await page.locator('.ps-org-row').last().boundingBox(),box=await legacy.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(last.y+last.height-1);
  expect(await legacy.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeLessThanOrEqual(12);
});
