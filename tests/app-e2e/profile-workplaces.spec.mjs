import {test,expect} from '@playwright/test';

const url='http://127.0.0.1:8123/tests/app-e2e/profile-workplaces-fixture.html';

async function openProfile(page){
  await page.goto(url);
  await expect(page.locator('[data-view="profile"]')).toBeVisible();
  await page.click('[data-view="profile"]');
  await expect(page.locator('#profileView')).toBeVisible();
}

test('profile can add and remove own assigned workplaces',async({page})=>{
  await openProfile(page);
  await expect(page.locator('[data-ps-workplace-org="org-a"]')).toContainText('철도노조');

  await page.click('#psAddWorkplace');
  await expect(page.locator('#psWorkplacePicker')).toBeVisible();
  await page.fill('#psWorkplaceSearch','가스');
  await expect(page.locator('[data-ps-add-workplace="org-b"]')).toContainText('한국가스공사노조');
  await page.click('[data-ps-add-workplace="org-b"]');

  await expect.poll(()=>page.evaluate(()=>window.__state.assignments.some(x=>x.organization_id==='org-b'&&x.user_id==='u1'))).toBeTruthy();
  await expect.poll(()=>page.evaluate(()=>window.__state.workplaces.some(x=>x.organization_id==='org-b'&&x.user_id==='u1'))).toBeTruthy();
  await expect(page.locator('[data-ps-workplace-org="org-b"]')).toContainText('한국가스공사노조');
  await expect(page.locator('[data-ps-add-workplace="org-b"]')).toHaveCount(0);

  const addCalls=await page.evaluate(()=>window.__state.calls);
  expect(addCalls.some(x=>x.method==='POST'&&x.path==='/rest/v1/app_suborganization_assignees'&&x.body?.organization_id==='org-b')).toBeTruthy();
  expect(addCalls.some(x=>x.method==='POST'&&x.path==='/rest/v1/app_profile_workplaces'&&x.body?.organization_id==='org-b')).toBeTruthy();

  page.once('dialog',d=>d.accept());
  await page.click('[data-ps-remove-workplace="org-a"]');
  await expect.poll(()=>page.evaluate(()=>window.__state.assignments.some(x=>x.organization_id==='org-a'))).toBeFalsy();
  await expect.poll(()=>page.evaluate(()=>window.__state.workplaces.some(x=>x.organization_id==='org-a'))).toBeFalsy();
  await expect(page.locator('[data-ps-workplace-org="org-a"]')).toHaveCount(0);

  const state=await page.evaluate(()=>window.__state);
  expect(state.calls.some(x=>x.method==='DELETE'&&x.path.includes('/app_profile_workplaces?')&&x.path.includes('organization_id=eq.org-a'))).toBeTruthy();
  expect(state.calls.some(x=>x.method==='DELETE'&&x.path.includes('/app_suborganization_assignees?')&&x.path.includes('organization_id=eq.org-a'))).toBeTruthy();
  expect(state.events).toBeGreaterThanOrEqual(2);
  expect(state.reloads).toBeGreaterThanOrEqual(2);
});

test('profile picker excludes inactive and already assigned organizations',async({page})=>{
  await openProfile(page);
  await page.click('#psAddWorkplace');
  await expect(page.locator('[data-ps-add-workplace="org-a"]')).toHaveCount(0);
  await expect(page.locator('[data-ps-add-workplace="org-c"]')).toHaveCount(0);
  await expect(page.locator('[data-ps-add-workplace="org-b"]')).toHaveCount(1);
});
