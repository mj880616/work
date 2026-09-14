import {test,expect} from '@playwright/test';
const base='http://127.0.0.1:8123/tests/app-e2e/team-member-management-fixture.html';

test.beforeEach(async({page})=>{page.on('dialog',d=>d.accept())});

test('owner can change member role and approval or invite does not offer admin directly',async({page})=>{
  await page.goto(base+'?actor=owner&targetRole=author');
  await expect(page.locator('[data-aa-role] option[value="admin"]')).toHaveCount(0);
  await expect(page.locator('#inviteRole option[value="admin"]')).toHaveCount(0);
  await expect(page.locator('#inviteRole + .tmm-approval-note')).toContainText('가입 후 구성원 상세');
  await expect(page.locator('#aaReviewSection .tmm-approval-note')).toContainText('가입 승인 후 소유자');
  await page.click('#openMember');
  await expect(page.locator('#tmmSection')).toBeVisible();
  await expect(page.locator('#tmmRole')).toHaveValue('author');
  await expect(page.locator('#tmmRole option[value="admin"]')).toHaveCount(1);
  await page.selectOption('#tmmRole','editor');
  await page.click('#tmmSave');
  await expect.poll(()=>page.evaluate(()=>window.__state.target.role)).toBe('editor');
  await expect(page.locator('#tpvTitle')).toContainText('편집자');
  const call=await page.evaluate(()=>window.__state.rpcCalls.at(-1));
  expect(call).toEqual({p_user:'u2',p_role:'editor'});
});

test('owner can remove a non-owner member and workplace links are cleaned first',async({page})=>{
  await page.goto(base+'?actor=owner&targetRole=viewer');
  await page.click('#openMember');
  await expect(page.locator('#tmmRemove')).toBeVisible();
  await page.click('#tmmRemove');
  await expect.poll(()=>page.evaluate(()=>window.__state.removed)).toBe(true);
  await expect(page.locator('#tpvModal')).toHaveClass(/hidden/);
  const calls=await page.evaluate(()=>window.__state.deleteCalls);
  expect(calls.some(x=>x.includes('app_suborganization_assignees'))).toBeTruthy();
  expect(calls.some(x=>x.includes('app_profile_workplaces'))).toBeTruthy();
  expect(calls.some(x=>x.includes('app_workspace_members'))).toBeTruthy();
});

test('admin can change ordinary roles but cannot promote to admin or remove members',async({page})=>{
  await page.goto(base+'?actor=admin&targetRole=author');
  await page.click('#openMember');
  await expect(page.locator('#tmmRole option[value="admin"]')).toHaveCount(0);
  await expect(page.locator('#tmmRemove')).toHaveCount(0);
  await page.selectOption('#tmmRole','viewer');
  await page.click('#tmmSave');
  await expect.poll(()=>page.evaluate(()=>window.__state.target.role)).toBe('viewer');
});

test('owner account is protected and mobile management UI does not overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(base+'?actor=owner&targetRole=owner');
  await page.click('#openMember');
  await expect(page.locator('#tmmSection')).toContainText('소유자 계정은 권한 변경·팀 제외 대상에서 보호');
  await expect(page.locator('#tmmRole')).toHaveCount(0);
  await expect(page.locator('#tmmRemove')).toHaveCount(0);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
  expect(overflow).toBeFalsy();
});
