import {test,expect} from '@playwright/test';

const url='http://127.0.0.1:8123/tests/app-e2e/profile-workplaces-fixture.html';

async function openProfile(page){
  await page.goto(url);
  await expect(page.locator('[data-view="profile"]')).toBeVisible();
  await page.click('[data-view="profile"]');
  await expect(page.locator('#profileView')).toBeVisible();
  await expect(page.locator('#psDeleteWorkplace')).toBeVisible();
  await expect(page.locator('#psSaveWorkplaces')).toBeVisible();
}

test('profile workplace changes are staged and saved together',async({page})=>{
  await openProfile(page);
  const chip=page.locator('[data-ps-workplace-org="org-a"]');
  await expect(chip).toContainText('철도노조');
  const fontSize=await chip.evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
  expect(fontSize).toBeLessThanOrEqual(13);

  await expect(page.locator('.ps-legacy-chip')).toContainText('과거 담당기관');
  await expect(page.locator('.ps-legacy-chip')).toContainText('산하조직 연결 전');

  await expect(page.locator('[data-ps-remove-workplace="org-a"]')).toBeHidden();
  await page.click('#psDeleteWorkplace');
  await expect(page.locator('[data-ps-remove-workplace="org-a"]')).toBeVisible();
  await page.click('[data-ps-remove-workplace="org-a"]');
  await expect(page.locator('.ps-pending-remove')).toHaveCount(1);
  await expect.poll(()=>page.evaluate(()=>window.__state.assignments.some(x=>x.organization_id==='org-a'))).toBeTruthy();

  await page.click('#psAddWorkplace');
  await expect(page.locator('#psWorkplacePicker')).toBeVisible();
  await page.fill('#psWorkplaceSearch','가스');
  const add=page.locator('[data-ps-add-workplace="org-b"]');
  await expect(add).toContainText('한국가스공사노조');
  await add.click();
  await expect(add).toHaveClass(/selected/);
  await expect(add.locator('b')).toHaveText('선택됨');
  await expect.poll(()=>page.evaluate(()=>window.__state.assignments.some(x=>x.organization_id==='org-b'))).toBeFalsy();

  await expect(page.locator('#psSaveWorkplaces')).toBeEnabled();
  await page.click('#psSaveWorkplaces');

  await expect.poll(()=>page.evaluate(()=>window.__state.assignments.some(x=>x.organization_id==='org-b'&&x.user_id==='u1'))).toBeTruthy();
  await expect.poll(()=>page.evaluate(()=>window.__state.workplaces.some(x=>x.organization_id==='org-b'&&x.user_id==='u1'))).toBeTruthy();
  await expect.poll(()=>page.evaluate(()=>window.__state.assignments.some(x=>x.organization_id==='org-a'))).toBeFalsy();
  await expect.poll(()=>page.evaluate(()=>window.__state.workplaces.some(x=>x.organization_id==='org-a'))).toBeFalsy();
  await expect(page.locator('[data-ps-workplace-org="org-b"]')).toContainText('한국가스공사노조');
  await expect(page.locator('[data-ps-workplace-org="org-a"]')).toHaveCount(0);
  await expect(page.locator('[data-ps-remove-workplace="org-b"]')).toBeHidden();
  await expect(page.locator('#psSaveWorkplaces')).toBeDisabled();
  await expect(page.locator('.ps-legacy-chip')).toContainText('과거 담당기관');

  const state=await page.evaluate(()=>window.__state);
  expect(state.calls.some(x=>x.method==='POST'&&x.path==='/rest/v1/app_suborganization_assignees'&&x.body?.organization_id==='org-b')).toBeTruthy();
  expect(state.calls.some(x=>x.method==='POST'&&x.path==='/rest/v1/app_profile_workplaces'&&x.body?.organization_id==='org-b')).toBeTruthy();
  expect(state.calls.some(x=>x.method==='DELETE'&&x.path.includes('/app_profile_workplaces?')&&x.path.includes('organization_id=eq.org-a'))).toBeTruthy();
  expect(state.calls.some(x=>x.method==='DELETE'&&x.path.includes('/app_suborganization_assignees?')&&x.path.includes('organization_id=eq.org-a'))).toBeTruthy();
  expect(state.events).toBeGreaterThanOrEqual(1);
  expect(state.reloads).toBeGreaterThanOrEqual(1);
  expect(state.memberReloads).toBeGreaterThanOrEqual(1);
});

test('delete mode can be cancelled before save and picker excludes inactive organizations',async({page})=>{
  await openProfile(page);
  await page.click('#psDeleteWorkplace');
  const remove=page.locator('[data-ps-remove-workplace="org-a"]');
  await remove.click();
  await expect(page.locator('.ps-pending-remove')).toHaveCount(1);
  await remove.click();
  await expect(page.locator('.ps-pending-remove')).toHaveCount(0);
  await expect(page.locator('#psSaveWorkplaces')).toBeDisabled();

  await page.click('#psAddWorkplace');
  await expect(page.locator('[data-ps-add-workplace="org-a"]')).toHaveCount(0);
  await expect(page.locator('[data-ps-add-workplace="org-c"]')).toHaveCount(0);
  await expect(page.locator('[data-ps-add-workplace="org-b"]')).toHaveCount(1);
});

test('profile destructive controls include the target name',async({page})=>{
  await openProfile(page);
  await page.click('#psDeleteWorkplace');
  await expect(page.locator('[data-ps-remove-workplace="org-a"]')).toHaveAttribute('aria-label','철도노조 담당사업장 삭제');
  await page.evaluate(async()=>{
    window.__state.projects=[{id:'project-1',user_id:'u1',name:'민자철도 대응',description:'',sort_order:0,created_at:'2026-09-17T00:00:00Z'}];
    await window.KPTUProfileSettings.reload();
  });
  await expect(page.locator('[data-ps-delete-project="project-1"]')).toHaveAttribute('aria-label','민자철도 대응 프로젝트 삭제');
});
