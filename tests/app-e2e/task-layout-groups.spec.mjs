import { test, expect } from '@playwright/test';

test('task screen separates my tasks from team assignments and nests both statuses in toggles',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/task-layout-fixture.html');
  const sections=page.locator('#tlTaskSections .tl-task-section');
  await expect(sections).toHaveCount(2);

  const mine=sections.nth(0),team=sections.nth(1);
  await expect(mine.locator('.tl-section-head h3')).toHaveText('내 할 일');
  await expect(mine.locator('.tl-section-head span')).toHaveText('2건');
  await expect(team.locator('.tl-section-head h3')).toHaveText('팀에서 부여된 할 일');
  await expect(team.locator('.tl-section-head span')).toHaveText('1건');

  await expect(mine.locator('.tl-incomplete')).toHaveAttribute('open','');
  await expect(mine.locator('.tl-incomplete summary')).toContainText('미완료된 할 일');
  await expect(mine.locator('.tl-incomplete summary b')).toHaveText('1');
  await expect(mine.locator('.tl-incomplete [data-tl-task-row]')).toHaveCount(1);
  await expect(mine.locator('.tl-completed summary')).toContainText('완료된 할 일');
  await expect(mine.locator('.tl-completed summary b')).toHaveText('1');
  await expect(mine.locator('.tl-completed [data-tl-task-row]')).toHaveCount(1);

  await expect(team.locator('.tl-incomplete summary b')).toHaveText('0');
  await expect(team.locator('.tl-completed summary b')).toHaveText('1');
  await expect(team.locator('.tl-completed [data-tl-task-row]')).toHaveCount(1);
  await expect(team).toContainText('회의에서 부여된 할 일');
  await expect(team).not.toContainText('내가 만든 프로젝트 할 일');
});
