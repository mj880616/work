import {test,expect} from '@playwright/test';

const fixture='http://127.0.0.1:8123/tests/app-e2e/suborganization-filters-canonical-fixture.html';

async function setup(page,table,method='POST'){
  await page.goto(fixture);
  await page.evaluate(()=>window.__KPTU_SUBORGANIZATIONS_READY__);
  await page.evaluate(({table,method})=>{window.__saveLockProbe={table,method,count:0,hold:true,fail:false,waiters:[]}}, {table,method});
}
const count=page=>page.evaluate(()=>window.__saveLockProbe.count);
const release=page=>page.evaluate(()=>{const p=window.__saveLockProbe;p.hold=false;p.waiters.splice(0).forEach(resolve=>resolve())});
const failNext=page=>page.evaluate(()=>{window.__saveLockProbe.fail=true});
async function assertOneDuringSave(page,button){
  await button.click();
  await expect.poll(()=>count(page)).toBe(1);
  await expect(button).toBeDisabled();
  await button.dispatchEvent('click');
  await page.waitForTimeout(150);
  expect(await count(page)).toBe(1);
  await release(page);
  await expect(button).toBeEnabled();
}

test('saveOrg creates once and retries after failure',async({page})=>{
  await setup(page,'app_suborganizations');
  // UI-조직추가숨김: no add button on screen; open the create dialog through the edit delegate.
  await page.evaluate(()=>{const b=document.createElement('button');b.id='soTestOpenEdit';b.setAttribute('data-so-edit','');document.body.append(b)});
  await page.locator('#soTestOpenEdit').click();
  await page.locator('#soEditName').fill('잠금 검사 조직');
  const button=page.locator('#soSaveOrg');
  await assertOneDuringSave(page,button);
  await expect(page.locator('#soEditModal')).toBeHidden();
  await page.locator('#soTestOpenEdit').click();
  await page.locator('#soEditName').fill('재시도 조직');
  await failNext(page);await button.click();
  await expect(page.locator('#soEditStatus')).toContainText('임시 저장 실패');
  await expect(button).toBeEnabled();await button.click();
  await expect.poll(()=>count(page)).toBe(3);
});

async function openRail(page){
  await page.locator('[data-so-org="org-rail"]').click();
  await expect(page.locator('#wdModal')).toBeVisible();
}

test('wdSaveTime creates once and retries after failure',async({page})=>{
  await setup(page,'app_suborganization_timeline');await openRail(page);
  await page.locator('#wdTime > summary').click();
  await page.locator('#wdAddTime').click();
  await page.locator('#wdTimeName').fill('잠금 검사 일정');
  const button=page.locator('#wdTimeSave');
  await assertOneDuringSave(page,button);
  await expect(page.locator('#wdTimeModal')).toBeHidden();
  await page.locator('#wdAddTime').click();
  await page.locator('#wdTimeName').fill('재시도 일정');
  await failNext(page);await button.click();
  await expect(page.locator('#toast')).toContainText('임시 저장 실패');
  await expect(button).toBeEnabled();await button.click();
  await expect.poll(()=>count(page)).toBe(3);
});

async function openAff(page){
  await page.locator('#wdMore > summary').click();
  await page.locator('#wdAffManage').click();
  await expect(page.locator('#wdAffModal')).toBeVisible();
}

test('wdCreateAffTag creates once and retries after failure',async({page})=>{
  await setup(page,'app_org_affiliation_tags');await openRail(page);await openAff(page);
  await page.locator('#wdAffNewName').fill('잠금 검사 꼬리표');
  const button=page.locator('#wdAffCreate');
  await assertOneDuringSave(page,button);
  await expect(page.locator('#wdAffStatus')).toContainText('추가했습니다');
  await page.locator('#wdAffNewName').fill('재시도 꼬리표');
  await failNext(page);await button.click();
  await expect(page.locator('#wdAffStatus')).toContainText('임시 저장 실패');
  await expect(button).toBeEnabled();await button.click();
  await expect.poll(()=>count(page)).toBe(3);
});

test('wdSaveAff keeps POST single-flight, resumes known refusal and never resends an unknown result',async({page})=>{
  await setup(page,'app_suborganization_affiliations');await openRail(page);await openAff(page);
  const button=page.locator('#wdAffSave');
  await assertOneDuringSave(page,button);
  await expect(page.locator('#wdAffModal')).toBeHidden();
  await page.locator('#wdAffManage').click();
  await failNext(page);await button.click();
  await expect(page.locator('#wdAffStatus')).toContainText('기존 소속을 비웠고');
  const deleted=await page.evaluate(()=>window.__affCalls.filter(x=>x.method==='DELETE').length);
  await expect(button).toBeEnabled();await button.click();
  await expect.poll(()=>count(page)).toBe(3);
  await expect(page.locator('#wdAffModal')).toBeHidden();
  expect(await page.evaluate(()=>window.__affCalls.filter(x=>x.method==='DELETE').length)).toBe(deleted);
  await page.locator('#wdAffManage').click();
  await page.evaluate(()=>{window.__saveLockProbe.fail=true;window.__saveLockProbe.failStatus=503});await button.click();
  await expect.poll(()=>count(page)).toBe(4);
  await expect(page.locator('#wdAffStatus')).toContainText('새 선택은 아직 확인하지 못했습니다');
  await page.locator('#wdAffStatus button').click();
  await expect(page.locator('#wdAffStatus')).toContainText('다시 전송하지 않았습니다');
  await button.click();expect(await count(page)).toBe(4);
  await expect(page.locator('#wdAffModal')).toBeVisible();
  await expect(page.locator('[data-wd-aff][value="tag-1"]')).toBeChecked();
});

test('saveAssignees sends one connection POST and retries after failure',async({page})=>{
  await setup(page,'app_suborganization_assignees');
  await page.evaluate(()=>{const b=document.createElement('button');b.dataset.soAssign='org-rail';b.id='assignE2E';document.body.appendChild(b)});
  await page.locator('#assignE2E').click();
  await expect(page.locator('#soAssignModal')).toBeVisible();
  await page.locator('#soAssignMembers input[value="user-me"]').check();
  const button=page.locator('#soSaveAssignees');
  await assertOneDuringSave(page,button);
  await expect(page.locator('#soAssignModal')).toBeHidden();
  await page.locator('#assignE2E').click();
  await failNext(page);await button.click();
  await expect(page.locator('#soAssignStatus')).toContainText('임시 저장 실패');
  await expect(button).toBeEnabled();await button.click();
  await expect.poll(()=>count(page)).toBe(3);
});
