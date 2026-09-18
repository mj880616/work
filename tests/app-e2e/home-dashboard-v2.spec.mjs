import { test, expect } from '@playwright/test';

test('home dashboard renders project, task, milestone and library panels',async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/home-dashboard-v2-fixture.html');

  await expect(page.locator('#hdvProjectPanel')).toBeVisible();
  await expect(page.locator('#hdvTaskPanel')).toBeVisible();
  await expect(page.locator('#hdvLibraryPanel')).toBeVisible();
  await expect(page.locator('#hdvTaskPanel')).toBeVisible();
  await expect(page.locator('#hdvMilestonePanel')).toBeVisible();
  await expect(page.locator('#hdvLibraryPanel')).toBeVisible();
  await expect(page.locator('#hdvProjects')).toContainText('인력확충 투쟁');
  await expect(page.locator('#hdvProjects')).toContainText('민자철도');
  await expect(page.locator('#hdvProjects')).not.toContainText('숨김 이식본');
  await expect(page.locator('#hdvTasks')).toContainText('보도자료 확정');
  await expect(page.locator('#hdvTasks')).toContainText('국토부 면담자료 검토');
  await expect(page.locator('#hdvMilestones')).toContainText('국회 기자회견');
  await expect(page.locator('#hdvMilestones')).toContainText('인력확충 투쟁');
  await expect(page.locator('#hdvLibrary')).toContainText('인력확충 기자회견 자료');
  await expect(page.locator('#hdvLibrary')).toContainText('민자철도 운영실태 개선요구');

  const cols=await page.locator('#homeView .dashboard-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(cols).toBeGreaterThanOrEqual(2);

  await page.locator('#hdvProjects [data-hdv-project="project-1"]').click();
  await expect.poll(()=>page.evaluate(()=>window.__routeCalls.at(-1)?.view)).toBe('projects');
  await expect.poll(()=>page.evaluate(()=>window.__projectClicks.at(-1))).toBe('project-1');
});

test('home dashboard stacks cards on mobile without horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/home-dashboard-v2-fixture.html');
  await expect(page.locator('#hdvProjectPanel')).toBeVisible();
  const layout=await page.evaluate(()=>({
    scrollWidth:document.documentElement.scrollWidth,
    innerWidth:window.innerWidth,
    columns:getComputedStyle(document.querySelector('#homeView .dashboard-grid')).gridTemplateColumns
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth+1);
  expect(layout.columns.split(' ').length).toBe(1);
});
