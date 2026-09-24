import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('task screen renders one personal task list with pending count',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/task-layout-fixture.html');
  const sections=page.locator('#taskList .tl-task-section');
  await expect(sections).toHaveCount(1);
  await expect(page.locator('#tlTaskSections')).toHaveCount(0);
  await expect(page.locator('#taskList')).toHaveClass(/tl-task-list/);

  const mine=sections.first();
  await expect(mine.locator('.tl-section-head h3')).toHaveText('내 할 일');
  await expect(mine.locator('.tl-section-head span')).toHaveText('1건');
  await expect(mine.locator('.tl-incomplete')).toHaveAttribute('open','');
  await expect(mine.locator('.tl-incomplete summary b')).toHaveText('1');
  await expect(mine.locator('.tl-completed summary b')).toHaveText('2');
  await expect(mine).toContainText('회의 후속 할 일');
  await expect(mine.locator('.tl-origin')).toHaveCount(0);
  await expect(page.locator('#taskList')).not.toContainText('팀에서 부여된 할 일');
  await expect(page.locator('#taskList')).not.toContainText('내가 추가');
});
test('completed open state is retained without a mutation observer',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/task-layout-fixture.html');
  const mine=page.locator('#taskList .tl-task-section').filter({hasText:'내 할 일'}).first();
  const completed=mine.locator('.tl-completed');

  await completed.locator('summary').click();
  await expect(completed).toHaveAttribute('open','');
  await completed.locator('[data-tl-toggle="self-done"]').click();

  await expect(mine.locator('.tl-completed')).toHaveAttribute('open','');
  await expect(mine.locator('.tl-completed summary b')).toHaveText('1');
  await expect(mine.locator('.tl-incomplete summary b')).toHaveText('2');
  await expect(mine.locator('.tl-incomplete')).toContainText('내가 완료한 프로젝트 할 일');
});

test('new manual task is saved by the canonical task renderer',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/task-layout-fixture.html');
  await page.locator('#taskModal').evaluate(el=>{el.classList.remove('hidden');el.setAttribute('aria-hidden','false')});
  await page.locator('#taskTitle').fill('새 할 일');
  await page.locator('#taskProject').selectOption('space-1');
  await page.locator('#saveTaskBtn').click();
  await expect(page.locator('#taskList .tl-task-section').first()).toContainText('새 할 일');
  await expect(page.locator('#taskModal')).toHaveClass(/hidden/);
});

test('new task can target no project, a top-level project, or a child project',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/task-layout-fixture.html');
  await expect.poll(()=>page.evaluate(()=>typeof window.KPTUTaskLayout?.openCreate)).toBe('function');

  await page.evaluate(()=>window.KPTUTaskLayout.openCreate('main-1'));
  await expect(page.locator('#taskModal')).toBeVisible();
  await expect(page.locator('#taskProject')).toHaveValue('main-1');
  const values=await page.locator('#taskProject option').evaluateAll(options=>options.map(o=>o.value));
  expect(values).toEqual(['','main-1','space-1']);
  await expect(page.locator('#taskProject')).not.toContainText('옛 업무공간');
  await expect(page.locator('#taskProject option[value="space-1"]')).toContainText('↳');

  await page.locator('#taskTitle').fill('상위 프로젝트 직접 할 일');
  await page.locator('#saveTaskBtn').click();
  await expect(page.locator('#taskList')).toContainText('상위 프로젝트 직접 할 일');
  await expect(page.locator('#taskList')).toContainText('공공기관 인력확충');

  await page.evaluate(()=>window.KPTUTaskLayout.openCreate(''));
  await expect(page.locator('#taskProject')).toHaveValue('');
  await page.locator('#taskProject').selectOption('space-1');
  await expect(page.locator('#taskProject')).toHaveValue('space-1');
});

test('390px task rows prioritize two-line information and keep actions in a menu',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/task-layout-fixture.html');
  const row=page.locator('[data-tl-task-row="self-open"]');
  await expect(row.locator('[data-tl-toggle]')).toHaveAttribute('type','checkbox');
  await expect(row.locator('[data-tl-menu]')).toBeVisible();
  await expect(row.locator('.tl-task-note')).toContainText('후속 논의');
  await expect(row.locator('.tl-task-description')).toContainText('공공기관 공동사업 준비');
  await expect(page.locator('[data-tl-task-row="self-done"] .tl-task-note')).toHaveCount(0);
  await expect(row.locator('[data-tl-edit]:visible,[data-tl-delete]:visible,[data-tn-edit]:visible')).toHaveCount(0);
  const metrics=await row.evaluate(el=>{
    const title=el.querySelector('.tl-task-title');
    const cs=getComputedStyle(title);
    return {height:title.getBoundingClientRect().height,lineHeight:parseFloat(cs.lineHeight),clamp:cs.webkitLineClamp,scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,contentWidth:el.querySelector('.tl-task-main').getBoundingClientRect().width,rowWidth:el.getBoundingClientRect().width};
  });
  expect(metrics.clamp).toBe('2');
  expect(metrics.height).toBeGreaterThan(metrics.lineHeight*1.5);
  expect(metrics.height).toBeLessThanOrEqual(metrics.lineHeight*2.1);
  expect(metrics.contentWidth/metrics.rowWidth).toBeGreaterThan(.6);
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.client+1);
  await row.locator('.tl-task-note').click();
  await expect(page.locator('#taskModal')).toBeVisible();
  await expect(page.locator('#taskNote')).toBeFocused();
  await page.locator('#taskNote').fill('새 메모 내용');
  await page.locator('#saveTaskBtn').click();
  await expect(row.locator('.tl-task-note')).toContainText('새 메모 내용');
  await expect(row.locator('.tl-task-main')).toBeFocused();
  await row.locator('.tl-task-main').click();
  await expect(page.locator('#taskTitle')).toBeFocused();
  await page.locator('[data-close="taskModal"]').click();
  await row.locator('[data-tl-menu]').click();
  await expect(row.locator('[data-tl-menu-items]')).toBeVisible();
  await expect(row.locator('[data-tl-menu-edit]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(row.locator('[data-tl-menu-items]')).toBeHidden();
  await expect(row.locator('[data-tl-menu]')).toBeFocused();
  await row.locator('[data-tl-menu]').click();
  await page.keyboard.press('Tab');
  await expect(row.locator('[data-tl-menu-items]')).toBeVisible();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(row.locator('[data-tl-menu-items]')).toBeHidden();
});

test('checkbox reverses completion and delete keeps confirmation',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/task-layout-fixture.html');
  const row=page.locator('[data-tl-task-row="self-open"]');
  await row.locator('[data-tl-toggle]').click();
  const completed=page.locator('#taskList .tl-task-section').first().locator('.tl-completed');
  await completed.locator('summary').click();
  await expect(completed.locator('[data-tl-task-row="self-open"] [data-tl-toggle]')).toBeChecked();
  await completed.locator('[data-tl-task-row="self-open"] [data-tl-toggle]').click();
  await expect(row.locator('[data-tl-toggle]')).not.toBeChecked();
  await row.locator('[data-tl-menu]').click();
  page.once('dialog',dialog=>dialog.dismiss());
  await row.locator('[data-tl-delete]').click();
  await expect(row).toBeVisible();
  await expect(row.locator('[data-tl-menu]')).toBeFocused();
  await row.locator('[data-tl-menu]').click();
  page.once('dialog',dialog=>dialog.accept());
  await row.locator('[data-tl-delete]').click();
  await expect(row).toHaveCount(0);
});

test('detail offers completion and hides delete for tasks created by others',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/task-layout-fixture.html');
  const completed=page.locator('#taskList [data-tl-section="mine"] .tl-completed');
  await completed.locator('summary').click();
  const team=completed.locator('[data-tl-task-row="team-one"]');
  await team.locator('[data-tl-menu]').click();
  await expect(team.locator('[data-tl-delete]')).toHaveCount(0);
  await team.locator('[data-tl-menu-edit]').click();
  await expect(page.locator('#taskModal')).toBeVisible();
  await expect(page.locator('#taskModalDelete')).toBeHidden();
  await page.locator('#taskModalToggle').click();
  await expect(page.locator('#taskModalToggle')).toHaveText('완료');
  await page.locator('#taskModalToggle').click();
  await expect(page.locator('#taskModalToggle')).toHaveText('미완료로 변경');
});

test('a denied task update leaves completion and note unchanged',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/task-layout-fixture.html');
  await page.evaluate(()=>{window.__denyTaskPatch=true});
  const row=page.locator('[data-tl-task-row="self-open"]');
  page.once('dialog',dialog=>dialog.accept());
  await row.locator('[data-tl-toggle]').click();
  await expect(row.locator('[data-tl-toggle]')).not.toBeChecked();
  await row.locator('.tl-task-note').click();
  await page.locator('#taskNote').fill('저장되지 않아야 하는 메모');
  await page.locator('#saveTaskBtn').click();
  await expect(page.locator('#taskModalStatus')).toContainText('권한 없음');
  await expect(row.locator('.tl-task-note')).toContainText('후속 논의 내용을 기록했습니다.');
});

test('direct A-to-B session switch discards a stale project task response',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/task-layout-fixture.html');
  await expect(page.locator('#taskList')).toContainText('내가 완료한 프로젝트 할 일');
  await page.evaluate(()=>{window.KPTUTaskLayout.openTask('pending-project')});
  await expect.poll(()=>page.evaluate(()=>Boolean(window.__resolvePendingProjectTask))).toBeTruthy();
  await page.evaluate(()=>{
    window.__fixtureUserId='user-2';
    window.dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:{user:{id:'user-2'}}}}));
    window.__resolvePendingProjectTask([{id:'pending-project',workspace_id:'workspace-1',assignee_id:'user-1',title:'A의 비공개 할 일',status:'todo'}]);
  });
  await expect(page.locator('#taskModal')).toBeHidden();
  await expect(page.locator('#taskList')).not.toContainText('A의 비공개 할 일');
  await expect(page.locator('#taskList')).not.toContainText('내가 완료한 프로젝트 할 일');
});

test('logout discards a stale project task response',async({page})=>{
  await page.goto('http://127.0.0.1:8123/tests/app-e2e/task-layout-fixture.html');
  await expect(page.locator('#taskList')).toContainText('내가 완료한 프로젝트 할 일');
  await page.evaluate(()=>{window.KPTUTaskLayout.openTask('pending-project')});
  await expect.poll(()=>page.evaluate(()=>Boolean(window.__resolvePendingProjectTask))).toBeTruthy();
  await page.evaluate(()=>{
    window.dispatchEvent(new CustomEvent('kptu:session-changed',{detail:{session:null}}));
    window.__resolvePendingProjectTask([{id:'pending-project',workspace_id:'workspace-1',assignee_id:'user-1',title:'A의 비공개 할 일',status:'todo'}]);
  });
  await expect(page.locator('#taskModal')).toBeHidden();
  await expect(page.locator('#taskList')).toBeEmpty();
});


test('task mutations have one canonical owner and obsolete task filters stay removed',async()=>{
  const team=readFileSync(new URL('../../app/team.js',import.meta.url),'utf8');
  const index=readFileSync(new URL('../../app/index.html',import.meta.url),'utf8');
  const loader=readFileSync(new URL('../../app/loader-v2.js',import.meta.url),'utf8');
  const app=readFileSync(new URL('../../app/app.js',import.meta.url),'utf8');
  const layout=readFileSync(new URL('../../app/task-layout.js',import.meta.url),'utf8');
  const workflow=readFileSync(new URL('../../app/task-workflow.js',import.meta.url),'utf8');
  const meeting=readFileSync(new URL('../../app/meeting-round-detail.js',import.meta.url),'utf8');
  const project=readFileSync(new URL('../../app/project-system-v3.js',import.meta.url),'utf8');

  expect(team).not.toContain('async function saveTask(){');
  expect(team).not.toContain("$('#saveTaskBtn').onclick=saveTask");
  expect(team).not.toContain('dataset.taskToggle');
  expect(team).not.toContain("$('#taskProject').innerHTML");
  expect(team).not.toContain("$('#taskAssignee').innerHTML");

  expect(index).not.toContain('id="taskScope"');
  expect(index).not.toContain('id="taskStatus"');
  expect(index).not.toContain('id="taskAssignee"');
  expect(layout).not.toContain('teamAssigned');
  expect(layout).not.toContain('팀에서 부여된 할 일');
  expect(layout).not.toContain('내가 추가');
  expect(workflow).not.toContain('meeting-action-assignee');
  expect(meeting).not.toContain('mrdTaskAssignee');
  expect(meeting).toContain("assignee_id=eq.'+encodeURIComponent(mrdUser.id)");
  expect(project).toContain('assignee_id=eq.${encodeURIComponent(user.id)}');
  expect(index).toContain('./team.js?v=39');
  expect(index).toContain('./loader-v2.js?v=213');
  expect(index).toContain('./app.js?v=101');
  expect(loader).toContain("import('./team.js?v=39')");
  expect(app).toContain("import('./loader-v2.js?v=213')");
});
