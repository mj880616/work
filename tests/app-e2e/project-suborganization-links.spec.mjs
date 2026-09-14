import {test,expect} from '@playwright/test';

const base='http://127.0.0.1:8123/tests/app-e2e/project-suborganization-links-fixture.html';

test('organization detail links projects and saves changes atomically through RPC',async({page})=>{
  await page.goto(base);
  await expect(page.locator('[data-pol-org-detail]')).toBeVisible();
  await page.click('[data-pol-org-detail]');
  await expect(page.locator('#wdModal')).toBeVisible();
  await expect(page.locator('#polOrgProjects')).toContainText('인력확충 공동투쟁');
  await expect(page.locator('#polManageOrg')).toBeVisible();

  await page.click('#polManageOrg');
  await expect(page.locator('#polManageModal')).toBeVisible();
  await expect(page.locator('#polChoices input[value="p1"]')).toBeChecked();
  await expect(page.locator('#polChoices input[value="p2"]')).not.toBeChecked();
  await page.check('#polChoices input[value="p2"]');
  await page.click('#polSave');

  await expect.poll(()=>page.evaluate(()=>window.__state.links.filter(x=>x.organization_id==='org-a').length)).toBe(2);
  await expect(page.locator('#polOrgProjects')).toContainText('10.7 공동대의원대회');
  const calls=await page.evaluate(()=>window.__state.calls);
  expect(calls.some(x=>x.path==='/rest/v1/rpc/app_sync_suborganization_projects'&&x.method==='POST'&&x.body?.p_organization==='org-a')).toBeTruthy();
});

test('project detail shows linked organizations and can manage them',async({page})=>{
  await page.goto(base);
  await page.click('#openProject');
  await expect(page.locator('#pm2DetailModal')).toBeVisible();
  await expect(page.locator('#polProjectOrgs')).toContainText('철도노조');
  await expect(page.locator('#polManageProject')).toBeVisible();

  await page.click('#polManageProject');
  await expect(page.locator('#polChoices input[value="org-a"]')).toBeChecked();
  await expect(page.locator('#polChoices input[value="org-b"]')).not.toBeChecked();
  await page.check('#polChoices input[value="org-b"]');
  await page.click('#polSave');

  await expect.poll(()=>page.evaluate(()=>window.__state.links.filter(x=>x.project_id==='p1').length)).toBe(2);
  await expect(page.locator('#polProjectOrgs')).toContainText('부산지하철노조');
  const calls=await page.evaluate(()=>window.__state.calls);
  expect(calls.some(x=>x.path==='/rest/v1/rpc/app_sync_project_suborganizations'&&x.method==='POST'&&x.body?.p_project==='p1')).toBeTruthy();
});

test('viewer can read links but cannot see management controls',async({page})=>{
  await page.goto(base+'?role=viewer');
  await expect(page.locator('[data-pol-org-detail]')).toBeVisible();
  await page.click('[data-pol-org-detail]');
  await expect(page.locator('#polOrgProjects')).toContainText('인력확충 공동투쟁');
  await expect(page.locator('#polManageOrg')).toBeHidden();
  await page.click('[data-wd-close="wdModal"]');
  await page.click('#openProject');
  await expect(page.locator('#polProjectOrgs')).toContainText('철도노조');
  await expect(page.locator('#polManageProject')).toBeHidden();
});

test('link UI stays within mobile viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto(base);
  await page.click('#openProject');
  await expect(page.locator('#polProjectOrgsSection')).toBeVisible();
  await page.click('#polManageProject');
  await expect(page.locator('#polManageModal')).toBeVisible();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth);
  expect(overflow).toBeFalsy();
});
