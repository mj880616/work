import { test, expect } from '@playwright/test';

test('task screen renders directly into taskList and separates task origins',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/task-layout-fixture.html');
  const sections=page.locator('#taskList .tl-task-section');
  await expect(sections).toHaveCount(2);
  await expect(page.locator('#tlTaskSections')).toHaveCount(0);
  await expect(page.locator('#taskList')).toHaveClass(/tl-task-list/);

  const mine=sections.nth(0),team=sections.nth(1);
  await expect(mine.locator('.tl-section-head h3')).toHaveText('내 할 일');
  await expect(mine.locator('.tl-section-head span')).toHaveText('2건');
  await expect(team.locator('.tl-section-head h3')).toHaveText('팀에서 부여된 할 일');
  await expect(team.locator('.tl-section-head span')).toHaveText('1건');

  await expect(mine.locator('.tl-incomplete')).toHaveAttribute('open','');
  await expect(mine.locator('.tl-incomplete summary b')).toHaveText('1');
  await expect(mine.locator('.tl-completed summary b')).toHaveText('1');
  await expect(team.locator('.tl-incomplete summary b')).toHaveText('0');
  await expect(team.locator('.tl-completed summary b')).toHaveText('1');
  await expect(team).toContainText('회의에서 부여된 할 일');
  await expect(team.locator('.tl-origin')).toContainText('팀에서 부여 · 회의');
});

test('completed open state is retained without a mutation observer',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/task-layout-fixture.html');
  const mine=page.locator('#taskList .tl-task-section').filter({hasText:'내 할 일'}).first();
  const completed=mine.locator('.tl-completed');

  await completed.locator('summary').click();
  await expect(completed).toHaveAttribute('open','');
  await completed.locator('[data-tl-toggle="self-done"]').click();

  await expect(mine.locator('.tl-completed')).toHaveAttribute('open','');
  await expect(mine.locator('.tl-completed summary b')).toHaveText('0');
  await expect(mine.locator('.tl-incomplete summary b')).toHaveText('2');
  await expect(mine.locator('.tl-incomplete')).toContainText('내가 완료한 프로젝트 할 일');
});

test('new manual task is saved by the canonical task renderer',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/task-layout-fixture.html');
  await page.locator('#taskTitle').fill('새 할 일');
  await page.locator('#taskProject').selectOption('space-1');
  await page.locator('#saveTaskBtn').click();
  await expect(page.locator('#taskList .tl-task-section').first()).toContainText('새 할 일');
  await expect(page.locator('#taskModal')).toHaveClass(/hidden/);
});
