import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { loginEntry } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';

// UI-할일조작통일: (1) a home task row (HOME-업무일지홈: the home is the work journal; its 할 일 칸) opens the task screen's editor and saves through the same Edge call,
// (2) the calendar date list has a ⋯ menu per task — TASK-바로처리통일: the shared task line (내일로 · 기한 바꾸기 · 고치기 · 지우기,
// 지우기 asks first). Only remote APIs are synthetic.
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
    const card = page.locator('#homeView [data-journal-group="todo"]');
    const row = card.locator('li[data-journal-task="today"]');
    await expect(row).toBeVisible();
    // The whole title area is the button; nothing is toggled by it. It opens the task on the task screen in its editor.
    await row.locator('.journal-item-open').click();
    await expect(page.locator('#tasksView')).toBeVisible();
    await expect(page.locator('#gtTaskModal')).toBeVisible();
    await expect(page.locator('#gtEditTitle')).toHaveValue('오늘 항목');
    await expect(page.locator('#gtSaveBtn')).toBeEnabled();
    await page.locator('#gtEditTitle').fill('바꾼 오늘 항목');
    await page.locator('#gtSaveBtn').click();
    // 폰은 창이 닫히고, PC 할 일 화면은 오른쪽 칸에 붙은 편집기(gt-docked)가 그 할 일을 계속 보인다.
    if (width < 761) await expect(page.locator('#gtTaskModal')).toBeHidden();
    else await expect(page.locator('#gtEditTitle')).toHaveValue('바꾼 오늘 항목');
    await expect.poll(() => updates.length).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].task_id).toBe('today');
    expect(updates[0].title).toBe('바꾼 오늘 항목');
  });
}

async function fixture(page, { width = 412, onDelete } = {}) {
  await page.setViewportSize({ width, height: 844 });
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
      if (action === 'update') {
        const i = tasks.findIndex((t) => t.id === body.task_id);
        tasks[i] = { ...tasks[i], title: body.title, notes: body.notes, due: body.due ? body.due + 'T00:00:00.000Z' : null };
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
  await signInWithSession(page,'qa@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/);
  await page.locator('[data-calendar-view="month"]').click();
  await expect.poll(() => page.evaluate(() => window.KPTUCalendarMonthView?.dayEvents?.('2026-10-20').filter((e) => e.source === 'task').length ?? 0)).toBe(2);
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
  // TASK-바로처리통일: the date list's ⋯ is the shared task line menu (내일로 · 기한 바꾸기 · 고치기 · 지우기; a finished row: 다시 할 일로 ·
  // 고치기). Completing is the row's circle, with the shared 5-second [되돌리기].
  test(`date list ⋯ holds the shared items and the circle completes with undo, list stays open (${width}px)`, async ({ page }) => {
    const { calls } = await fixture(page, { width });
    await showDay(page);
    const trigger = menuButton(page, 'cell');
    const box = await trigger.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await line(page, 'cell').hover();
    await trigger.click();
    const menu = page.locator('#calendarTaskMenu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('button')).toHaveText(['내일로', '기한 바꾸기', '고치기', '지우기']);
    // The menu stays inside the date list's window (its focus loop).
    expect(await menu.evaluate((m) => !!m.closest('#calendarDayModal'))).toBe(true);
    // Opens where it was pressed: right edge near the ⋯ button, inside the window.
    const m = await menu.boundingBox(), t = await trigger.boundingBox();
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.x + m.width).toBeLessThanOrEqual(width);
    expect(Math.abs((m.x + m.width) - (t.x + t.width))).toBeLessThanOrEqual(width - 24);
    for (const b of await menu.getByRole('button').all()) expect((await b.boundingBox()).height).toBeLessThanOrEqual(40);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await chip(page, 'cell').locator('.cmv-task-mark').click();
    await expect(chip(page, 'cell')).toHaveClass(/cmv-task-done/);
    await expect.poll(() => actions(calls, 'toggle').length).toBe(1);
    const undo = page.locator('[data-undo-notice]');
    await expect(undo).toContainText("'하나'를 끝냈어요.");
    await undo.getByRole('button', { name: '되돌리기' }).click();
    await expect(chip(page, 'cell')).not.toHaveClass(/cmv-task-done/);
    await expect(undo).toContainText('다시 할 일로 돌려놨어요.');
    expect(actions(calls, 'toggle').map((c) => c.body.completed)).toEqual([true, false]);
    // Completed again, then ⋯ [다시 할 일로].
    await chip(page, 'cell').locator('.cmv-task-mark').click();
    await expect.poll(() => actions(calls, 'toggle').length).toBe(3);
    await line(page, 'cell').hover();
    await trigger.click();
    await expect(menu.getByRole('button')).toHaveText(['다시 할 일로', '고치기']);
    await menu.getByRole('button', { name: '다시 할 일로' }).click();
    await expect(chip(page, 'cell')).not.toHaveClass(/cmv-task-done/);
    await expect.poll(() => actions(calls, 'toggle').length).toBe(4);
    expect(actions(calls, 'delete')).toHaveLength(0);
    await expect(page.locator('#calendarDayModal')).toBeVisible();
    await expect(page.locator('#gtTaskModal')).toBeHidden();
  });

  test(`date list ⋯ 내일로 moves the due date with the editor's update and the row leaves the day (${width}px)`, async ({ page }) => {
    const { calls } = await fixture(page, { width });
    await showDay(page);
    await line(page, 'cell').hover();
    await menuButton(page, 'cell').click();
    await page.locator('#calendarTaskMenu').getByRole('button', { name: '내일로' }).click();
    await expect.poll(() => actions(calls, 'update').length).toBe(1);
    // Tomorrow is from today (10/15 in Korea), the editor's own update with the title and notes.
    expect(actions(calls, 'update')[0].body).toEqual({ action: 'update', task_id: 'cell', task_list_id: '@default', title: '하나', notes: '', due: '2026-10-16' });
    await expect(page.locator('#toast')).toHaveText("'하나' 기한을 내일로 옮겼어요.");
    await expect(chip(page, 'cell')).toHaveCount(0);
    await expect(chip(page, 'other')).toBeVisible();
    await expect.poll(() => page.evaluate(() => KPTUCalendarMonthView.dayEvents('2026-10-16').filter((e) => e.source === 'task').map((e) => e.id))).toEqual(['cell']);
    // 기한 바꾸기: the small date box under the ⋯, inside the date list's window.
    await line(page, 'other').hover();
    await menuButton(page, 'other').click();
    await page.locator('#calendarTaskMenu').getByRole('button', { name: '기한 바꾸기' }).click();
    const input = page.locator('#taskDuePopup [data-task-due-input]');
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('2026-10-20');
    expect(await input.evaluate((el) => !!el.closest('#calendarDayModal'))).toBe(true);
    await input.fill('2026-10-22');
    await page.locator('#taskDuePopup').getByRole('button', { name: '바꾸기' }).click();
    await expect.poll(() => actions(calls, 'update').length).toBe(2);
    expect(actions(calls, 'update')[1].body.due).toBe('2026-10-22');
    await expect(page.locator('#toast')).toHaveText("'둘' 기한을 10월 22일(목)로 바꿨어요.");
    await expect(page.locator('#calendarDayModal')).toBeVisible();
  });

  test(`date list menu deletes only after confirmation and removes the row (${width}px)`, async ({ page }) => {
    const { calls } = await fixture(page, { width });
    await showDay(page);
    // Declined: nothing is sent and the row stays.
    page.once('dialog', (d) => d.dismiss());
    await line(page, 'cell').hover();
    await menuButton(page, 'cell').click();
    await page.locator('#calendarTaskMenu').getByRole('button', { name: '지우기', exact: true }).click();
    await expect(chip(page, 'cell')).toBeVisible();
    expect(actions(calls, 'delete')).toHaveLength(0);
    // Accepted: one delete for that task, the row goes, the other stays, the list stays open.
    page.once('dialog', (d) => { expect(d.message()).toContain('삭제'); d.accept(); });
    await line(page, 'cell').hover();
    await menuButton(page, 'cell').click();
    await page.locator('#calendarTaskMenu').getByRole('button', { name: '지우기', exact: true }).click();
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
  await line(page, 'cell').hover();
  await menuButton(page, 'cell').click();
  await page.locator('#calendarTaskMenu').getByRole('button', { name: '지우기', exact: true }).click();
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
