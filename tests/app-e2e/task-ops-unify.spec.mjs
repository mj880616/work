import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { loginEntry } from './helpers/login-entry.mjs';

// UI-할일조작통일: (1) a home [오늘 할 일] row opens the task screen's editor and saves through the same Edge call,
// (2) the calendar date list has a ⋯ menu per task with 완료 / 완료 취소 / 삭제 (확인 후 삭제). Only remote APIs are synthetic.
const ORIGIN = process.env.APP_E2E_ORIGIN || 'http://127.0.0.1:8123';
const NOW = '2026-10-15T03:00:00.000Z';
const SB = 'xmlkxfjeagycwttklxjw.supabase.co';
test.use({ timezoneId: 'Asia/Seoul' });

for (const width of [412, 1280]) {
  test(`home row opens the existing editor and saves the change (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openHome(page);
    const updates = [];
    await page.route('**/functions/v1/google-tasks?action=update', async (route) => {
      const body = route.request().postDataJSON();
      updates.push(body);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, task: { id: body.task_id, taskListId: 'default', title: body.title, notes: body.notes || '', due: body.due || null, status: 'needsAction' } }) });
    });
    const card = page.locator('[data-home-card="tasks"]');
    const row = card.locator('[data-home-task="today"]');
    await expect(row).toBeVisible();
    // The whole title area is the button; nothing is toggled by it.
    await row.locator('[data-home-edit]').click();
    await expect(page.locator('#gtTaskModal')).toBeVisible();
    await expect(page.locator('#gtEditTitle')).toHaveValue('오늘 항목');
    await expect(page.locator('#gtSaveBtn')).toBeEnabled();
    await page.locator('#gtEditTitle').fill('바꾼 오늘 항목');
    await page.locator('#gtSaveBtn').click();
    await expect(page.locator('#gtTaskModal')).toBeHidden();
    expect(updates).toHaveLength(1);
    expect(updates[0].task_id).toBe('today');
    expect(updates[0].title).toBe('바꾼 오늘 항목');
  });
}

async function fixture(page, { width = 412, onDelete } = {}) {
  await page.setViewportSize({ width, height: 844 });
  await page.addInitScript(() => { try { localStorage.setItem('kptu-calendar-view', 'month') } catch {} });
  await page.clock.setFixedTime(new Date(NOW));
  const make = (id, date, title = 'QA task') => ({ id, title, notes: '', due: date + 'T00:00:00.000Z', status: 'needsAction', completed: null, taskListId: '@default', taskListTitle: 'QA', source: 'google-task' });
  const tasks = [make('cell', '2026-10-20', '하나'), make('other', '2026-10-20', '둘')];
  const calls = [];
  await page.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname;
    if (url.origin === ORIGIN) return route.continue();
    if (url.hostname !== SB) return route.abort();
    const ok = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const user = { id: 'qa-user', email: 'qa@example.org', user_metadata: { display_name: 'QA' } };
    if (p === '/auth/v1/token') return ok({ access_token: 'qa', refresh_token: 'qa', expires_in: 3600, expires_at: 4102444800, user });
    if (p === '/auth/v1/user') return ok(user);
    if (p === '/rest/v1/app_workspace_members') return ok([{ workspace_id: 'qa-ws', user_id: 'qa-user', role: 'owner' }]);
    if (p === '/rest/v1/app_workspaces') return ok([{ id: 'qa-ws', name: 'QA Workspace' }]);
    if (p === '/rest/v1/app_profiles') return ok([{ user_id: 'qa-user', display_name: 'QA' }]);
    if (p === '/functions/v1/google-calendar') return ok({ connected: false, enabled: false, calendars: [], events: [] });
    if (p === '/functions/v1/google-tasks') {
      const action = url.searchParams.get('action'), body = req.method() === 'POST' ? req.postDataJSON() : {};
      calls.push({ action, body });
      if (action === 'links') return ok({ links: [], meeting_links: [] });
      if (action === 'toggle') {
        const i = tasks.findIndex((t) => t.id === body.task_id);
        tasks[i] = { ...tasks[i], status: body.completed ? 'completed' : 'needsAction', completed: body.completed ? NOW : null };
        return ok({ ok: true, task: tasks[i] });
      }
      if (action === 'delete') {
        if (onDelete?.fail) return ok({ error: 'QA delete failure' }, 500);
        const i = tasks.findIndex((t) => t.id === body.task_id);
        if (i >= 0) tasks.splice(i, 1);
        return ok({ ok: true });
      }
      return ok({ connected: true, authorized: true, needs_reconnect: false, tasks, pending_scope: 'all' });
    }
    return ok([]);
  });
  await page.goto(loginEntry(ORIGIN + '/app/?view=calendar'));
  await page.locator('#emailAuthToggle').click();
  await page.locator('#authEmail').fill('qa@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  await expect(page.locator('.cal-cell[data-date="2026-10-20"] .cmv-task-count')).toBeVisible();
  return { calls };
}
const line = (page, id) => page.locator(`#calendarDayTasks [data-calendar-task-line="${id}"]`);
const chip = (page, id) => page.locator(`#calendarDayTasks [data-calendar-task="${id}"]`);
async function showDay(page) {
  await page.evaluate(() => KPTUCalendarDayOverflow.open(new Date('2026-10-20T12:00:00+09:00'), KPTUCalendarMonthView.dayEvents('2026-10-20')));
  await expect(page.locator('#calendarDayModal')).toBeVisible();
  await expect(page.locator('#calendarDayTasks [data-calendar-task]')).toHaveCount(2);
}
const menuButton = (page, id) => line(page, id).locator('[data-calendar-task-menu]');
const actions = (calls, name) => calls.filter((c) => c.action === name);

for (const width of [412, 1280]) {
  test(`date list menu completes and un-completes, list stays open (${width}px)`, async ({ page }) => {
    const { calls } = await fixture(page, { width });
    await showDay(page);
    const trigger = menuButton(page, 'cell');
    const box = await trigger.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await trigger.click();
    const menu = page.locator('#calendarTaskMenu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button', { name: '완료', exact: true })).toBeVisible();
    await expect(menu.getByRole('button', { name: '삭제', exact: true })).toBeVisible();
    // Opens where it was pressed: right edge near the ⋯ button, inside the window.
    const m = await menu.boundingBox(), t = await trigger.boundingBox();
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.x + m.width).toBeLessThanOrEqual(width);
    expect(Math.abs((m.x + m.width) - (t.x + t.width))).toBeLessThanOrEqual(width - 24);
    await menu.getByRole('button', { name: '완료', exact: true }).click();
    await expect(chip(page, 'cell')).toHaveClass(/cmv-task-done/);
    await expect.poll(() => actions(calls, 'toggle').length).toBe(1);
    await trigger.click();
    await expect(menu.getByRole('button', { name: '완료 취소', exact: true })).toBeVisible();
    await menu.getByRole('button', { name: '완료 취소', exact: true }).click();
    await expect(chip(page, 'cell')).not.toHaveClass(/cmv-task-done/);
    await expect.poll(() => actions(calls, 'toggle').length).toBe(2);
    expect(actions(calls, 'toggle').map((c) => c.body.completed)).toEqual([true, false]);
    expect(actions(calls, 'delete')).toHaveLength(0);
    await expect(page.locator('#calendarDayModal')).toBeVisible();
    await expect(page.locator('#gtTaskModal')).toBeHidden();
  });

  test(`date list menu deletes only after confirmation and removes the row (${width}px)`, async ({ page }) => {
    const { calls } = await fixture(page, { width });
    await showDay(page);
    // Declined: nothing is sent and the row stays.
    page.once('dialog', (d) => d.dismiss());
    await menuButton(page, 'cell').click();
    await page.locator('#calendarTaskMenu').getByRole('button', { name: '삭제', exact: true }).click();
    await expect(chip(page, 'cell')).toBeVisible();
    expect(actions(calls, 'delete')).toHaveLength(0);
    // Accepted: one delete for that task, the row goes, the other stays, the list stays open.
    page.once('dialog', (d) => { expect(d.message()).toContain('삭제'); d.accept(); });
    await menuButton(page, 'cell').click();
    await page.locator('#calendarTaskMenu').getByRole('button', { name: '삭제', exact: true }).click();
    await expect(chip(page, 'cell')).toHaveCount(0);
    await expect(chip(page, 'other')).toBeVisible();
    await expect(page.locator('#calendarDayModal')).toBeVisible();
    expect(actions(calls, 'delete')).toHaveLength(1);
    expect(actions(calls, 'delete')[0].body).toMatchObject({ action: 'delete', task_id: 'cell', task_list_id: '@default' });
    expect(actions(calls, 'toggle')).toHaveLength(0);
    // The calendar itself no longer counts it (one task left on the day).
    await expect.poll(() => page.evaluate(() => KPTUCalendarMonthView.dayEvents('2026-10-20').filter((e) => e.source === 'task').length)).toBe(1);
  });
}

test('date list delete failure keeps the row and says so', async ({ page }) => {
  const onDelete = { fail: true };
  const { calls } = await fixture(page, { width: 412, onDelete });
  await showDay(page);
  page.once('dialog', (d) => d.accept());
  await menuButton(page, 'cell').click();
  await page.locator('#calendarTaskMenu').getByRole('button', { name: '삭제', exact: true }).click();
  await expect.poll(() => actions(calls, 'delete').length).toBe(1);
  await expect(page.locator('#toast')).toContainText('삭제하지 못했습니다');
  await expect(chip(page, 'cell')).toBeVisible();
  await expect(line(page, 'cell')).not.toHaveAttribute('data-busy', '1');
});

test('date list row still opens the editor from the title and the circle still toggles', async ({ page }) => {
  const { calls } = await fixture(page, { width: 412 });
  await showDay(page);
  await chip(page, 'cell').locator('.cmv-task-mark').click();
  await expect(chip(page, 'cell')).toHaveClass(/cmv-task-done/);
  await expect.poll(() => actions(calls, 'toggle').length).toBe(1);
  await expect(page.locator('#calendarTaskMenu')).toBeHidden();
  await chip(page, 'other').locator('.cmv-event-title').click();
  await expect(page.locator('#gtTaskModal')).toBeVisible();
  await expect(page.locator('#gtDeleteBtn')).toBeVisible();
});
