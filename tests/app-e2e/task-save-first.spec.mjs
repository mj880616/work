import { test, expect } from '@playwright/test';
import { loginEntry } from './helpers/login-entry.mjs';
import { signInWithSession } from './helpers/session-login.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { showBasketRow } from './helpers/basket-more.mjs';

// BIZ-저장먼저닫기 3차(S59-18): 할 일 첨부(google-tasks attach)를 쓰는 저장 창 — 할 일 창 [저장](새 할 일·수정 창 교체·빼기·붙이기), 일정 창 [할 일]로 저장,
// [할 일] 빠른 입력칸, 잊지 말기 [할 일 만들기] — 은 할 일(글)이 저장되면 창이 바로 닫히고/입력칸이 바로 풀리고, 파일은 그 할 일의 뒤 줄에서 하나씩
// 끝까지 올라간다(화면을 옮겨도). 하단바 위 한 줄(#uploadDock)이 묶음 전체 진행 → '할 일에 사진 n장·파일 n개 올렸어요', 못 올린 것은 그 한 줄에
// [다시 올리기](못 올린 것만, 같은 할 일로). 글 저장이 실패하면 창·입력칸·고른 파일은 그대로이고 아무것도 보내지 않는다. 서버는 흉내, 파일은 가짜.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const APP_ORIGIN = process.env.APP_E2E_ORIGIN || 'http://127.0.0.1:8123';
const NOW = '2026-10-21T03:00:00.000Z';
const ok = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
const line = (id, name) => `첨부: ${name} https://drive.google.com/file/d/${id}/view`;
const txt = (name, body = 'abc') => ({ name, mimeType: 'text/plain', buffer: Buffer.from(body) });
const png = name => ({ name, mimeType: 'image/png', buffer: Buffer.from('png') });
const dock = page => page.locator('#uploadDock:not([hidden])');
const shot = async (page, name) => { if (process.env.CAPTURE_DIR) await page.screenshot({ path: `${process.env.CAPTURE_DIR}/${name}.png` }); };
const rowById = (page, id) => page.locator(`#gtTaskBody [data-google-task="${id}"]`);
const rowByTitle = (page, title) => page.locator('#gtTaskBody .gt-row', { hasText: title });

// 할 일 화면 흉내: create·update·attach·detach. gate(): 열기 전까지 attach 답을 붙잡는다. failAttach(name, tries): true면 400(서버가 받고 거절).
async function openTasks(browser, { viewport, files = [], failCreate = false, failAttach = () => false } = {}) {
  const context = await browser.newContext({ timezoneId: 'Asia/Seoul', viewport, hasTouch: viewport.width < 600, isMobile: viewport.width < 600 });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(new Date(NOW));
  const google = { a: { id: 'a', title: '회의 자료 준비', taskListId: '@default', taskListTitle: '내 할 일', due: '2026-10-21T00:00:00.000Z', status: 'needsAction', completed: null, notes: '원래 메모', source: 'google-task' } };
  const state = { files: files.map(f => ({ ...f })), calls: { order: [], creates: [], updates: [], attach: [], detach: [] }, next: 1, hold: null };
  const notesOf = (id, drop = []) => { const own = state.files.filter(f => f.google_task_id === id); const kept = String(google[id].notes || '').split('\n').filter(l => ![...own.map(f => f.drive_file_id), ...drop].some(fid => l.includes('/file/d/' + fid + '/view'))).join('\n'); return [kept, ...own.map(f => line(f.drive_file_id, f.file_name))].filter(Boolean).join('\n'); };
  google.a.notes = notesOf('a');
  await page.route(`${SB}/**`, async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, action = u.searchParams.get('action');
    if (p === '/auth/v1/token') return ok(route, { access_token: 'qa', refresh_token: 'qa', expires_in: 3600, expires_at: 4102444800, user: { id: 'qa-user', email: 'qa@example.org', user_metadata: { display_name: 'QA' } } });
    if (p === '/auth/v1/user') return ok(route, { id: 'qa-user', email: 'qa@example.org', user_metadata: { display_name: 'QA' } });
    if (p === '/rest/v1/app_workspace_members') return ok(route, [{ workspace_id: 'qa-ws', user_id: 'qa-user', role: 'owner' }]);
    if (p === '/rest/v1/app_workspaces') return ok(route, [{ id: 'qa-ws', name: 'QA Workspace' }]);
    if (p === '/rest/v1/app_profiles') return ok(route, [{ user_id: 'qa-user', display_name: 'QA' }]);
    if (p === '/functions/v1/google-calendar') return ok(route, { connected: false, enabled: false, calendars: [], events: [] });
    if (p === '/functions/v1/google-tasks' && (action === 'overview' || action === 'tasks')) return ok(route, { connected: true, authorized: true, pending_scope: 'all', tasks: Object.values(google).map(t => ({ ...t })) });
    if (p === '/functions/v1/google-tasks' && action === 'links') return ok(route, { links: [], meeting_links: [] });
    if (p === '/functions/v1/google-tasks' && action === 'create') {
      const b = JSON.parse(req.postData() || '{}'); state.calls.creates.push(b); state.calls.order.push('create');
      if (failCreate) return ok(route, { error: 'Google 할 일을 저장하지 못했습니다.', code: 'google_failed' }, 400);
      const id = 'new' + state.calls.creates.length;
      google[id] = { id, title: b.title, taskListId: '@default', taskListTitle: '내 할 일', due: b.due ? `${b.due}T00:00:00.000Z` : null, status: 'needsAction', completed: null, notes: b.notes || '', source: 'google-task' };
      return ok(route, { ok: true, task: { ...google[id], due: b.due || null }, links: (b.links || []).map(l => ({ ...l, status: 'confirmed' })), meeting_links: [] });
    }
    if (p === '/functions/v1/google-tasks' && action === 'update') {
      const b = JSON.parse(req.postData() || '{}'); state.calls.updates.push(b); state.calls.order.push('update');
      google[b.task_id] = { ...google[b.task_id], title: b.title, notes: b.notes }; google[b.task_id].notes = notesOf(b.task_id);
      return ok(route, { ok: true, task: { ...google[b.task_id] } });
    }
    if (p === '/rest/v1/app_task_attachments') {
      const ids = ((u.searchParams.get('google_task_id') || '').match(/^in\.\((.*)\)$/)?.[1] || '').split(',');
      return ok(route, state.files.filter(f => ids.includes(f.google_task_id)).map(({ google_task_id, drive_file_id, file_name, size_bytes }) => ({ google_task_id, drive_file_id, file_name, size_bytes })));
    }
    if (p === '/functions/v1/google-tasks' && action === 'attach') {
      const body = req.postDataBuffer()?.toString('latin1') || '';
      const taskId = body.match(/name="task_id"\r\n\r\n([^\r]*)/)?.[1];
      const name = Buffer.from(body.match(/name="file"; filename="([^"]*)"/)?.[1] || '', 'latin1').toString('utf8');
      state.calls.attach.push({ taskId, name }); state.calls.order.push('attach:' + name);
      if (state.hold) await state.hold;
      if (failAttach(name, state.calls.attach.filter(c => c.name === name).length)) return ok(route, { error: '파일 이름이나 형식을 확인해 주세요.', code: 'file_metadata_invalid' }, 400);
      const f = { google_task_id: taskId, drive_file_id: 'drv' + state.next++, file_name: name, size_bytes: 3 };
      state.files.push(f); google[taskId].notes = notesOf(taskId);
      return ok(route, { ok: true, file: f, files: state.files.filter(x => x.google_task_id === taskId), task: { ...google[taskId] }, notes_synced: true });
    }
    if (p === '/functions/v1/google-tasks' && action === 'detach') {
      const b = JSON.parse(req.postData() || '{}'); state.calls.detach.push(b); state.calls.order.push('detach:' + b.drive_file_id);
      state.files = state.files.filter(f => !(f.google_task_id === b.task_id && f.drive_file_id === b.drive_file_id)); google[b.task_id].notes = notesOf(b.task_id, [b.drive_file_id]);
      return ok(route, { ok: true, files: state.files.filter(x => x.google_task_id === b.task_id), task: { ...google[b.task_id] }, notes_synced: true });
    }
    if (p.startsWith('/rest/v1/') || p.startsWith('/functions/v1/')) return ok(route, []);
    return ok(route, {});
  });
  await page.goto(loginEntry(`${APP_ORIGIN}/app/`));
  await signInWithSession(page, 'qa@example.org');
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 10000 });
  await expect.poll(() => page.evaluate(() => typeof window.KPTURouter?.go === 'function'), { timeout: 10000 }).toBeTruthy();
  await page.evaluate(() => window.KPTURouter.go('tasks', { source: 'qa' }));
  await expect(rowById(page, 'a')).toBeVisible({ timeout: 10000 });
  const gate = () => { let open; state.hold = new Promise(r => { open = r; }); return () => { state.hold = null; open(); }; };
  return { context, page, state, google, errors, gate };
}
const go = (page, view) => page.evaluate(v => window.KPTURouter.go(v, { source: 'qa' }), view);

for (const viewport of [{ width: 412, height: 915 }, { width: 1280, height: 900 }]) {
  const w = viewport.width;

  test(`할 일 창 [저장]: 창은 바로 닫히고 파일은 뒤에서 — 다른 화면으로 가도 끝까지 ${w}`, async ({ browser }) => {
    const { context, page, state, errors, gate } = await openTasks(browser, { viewport });
    await page.evaluate(() => window.KPTUGoogleTasks.openEditor(null));
    const modal = page.locator('#gtTaskModal');
    await page.locator('#gtNewFiles [data-gt-pick-input]').setInputFiles([png('현장.png'), txt('회의록.txt')]);
    await page.locator('#gtEditTitle').fill('보고서 정리');
    const release = gate();
    await page.locator('#gtSaveBtn').click();
    // 할 일이 저장되면 첫 파일이 아직 올라가는 중이어도 창은 닫혀 있다.
    await expect.poll(() => state.calls.attach.length).toBe(1);
    await expect(modal).toBeHidden();
    await expect(dock(page)).toContainText('2개 올리는 중');
    await shot(page, `task-editor-saving-${w}`);
    await go(page, 'library');
    release();
    await expect(dock(page)).toContainText('할 일에 사진 1장·파일 1개 올렸어요');
    await shot(page, `task-editor-done-${w}`);
    expect(state.calls.attach).toEqual([{ taskId: 'new1', name: '현장.png' }, { taskId: 'new1', name: '회의록.txt' }]);
    expect(state.calls.creates.length).toBe(1);
    await go(page, 'tasks');
    await expect(rowByTitle(page, '보고서 정리').locator('.gt-files a.gt-file')).toHaveText(['현장.png', '회의록.txt']);
    expect(errors).toEqual([]);
    await context.close();
  });

  test(`할 일 창 [저장]: 못 올린 파일만 [다시 올리기]로 같은 할 일에 ${w}`, async ({ browser }) => {
    const { context, page, state, errors } = await openTasks(browser, { viewport, failAttach: (name, tries) => name === '둘째.txt' && tries === 1 });
    await page.evaluate(() => window.KPTUGoogleTasks.openEditor(null));
    await page.locator('#gtNewFiles [data-gt-pick-input]').setInputFiles([txt('첫째.txt'), txt('둘째.txt'), txt('셋째.txt')]);
    await page.locator('#gtEditTitle').fill('자료 묶기');
    await page.locator('#gtSaveBtn').click();
    await expect(page.locator('#gtTaskModal')).toBeHidden();
    const bar = dock(page);
    await expect(bar).toContainText('할 일에 파일 1개 못 올렸어요');
    await expect(bar.locator('.up-dock-note')).toContainText('파일 2개 올렸어요');
    await expect(bar.locator('.up-dock-note')).toContainText('파일 이름이나 형식을 확인해 주세요');
    // 못 올린 한 줄은 누를 때까지 남는다.
    await page.waitForTimeout(6500);
    await expect(bar).toContainText('할 일에 파일 1개 못 올렸어요');
    await shot(page, `task-editor-fail-${w}`);
    await bar.getByRole('button', { name: '못 올린 파일 다시 올리기' }).click();
    await expect(dock(page)).toContainText('할 일에 파일 1개 올렸어요');
    expect(state.calls.attach.map(c => c.taskId + ':' + c.name)).toEqual(['new1:첫째.txt', 'new1:둘째.txt', 'new1:셋째.txt', 'new1:둘째.txt']);
    expect(state.calls.creates.length).toBe(1);
    await expect(rowByTitle(page, '자료 묶기').locator('.gt-files a.gt-file')).toHaveText(['첫째.txt', '셋째.txt', '둘째.txt']);
    expect(errors).toEqual([]);
    await context.close();
  });

  test(`수정 창 [저장]: 글이 먼저 저장되고 창은 바로 닫힘 — 빼기 뒤 교체·붙이기는 뒤에서 ${w}`, async ({ browser }) => {
    const files = [{ google_task_id: 'a', drive_file_id: 'old1', file_name: '옛 안건.pdf', size_bytes: 9 }, { google_task_id: 'a', drive_file_id: 'old2', file_name: '뺄 자료.pdf', size_bytes: 9 }];
    const { context, page, state, google, errors, gate } = await openTasks(browser, { viewport, files });
    await expect(rowById(page, 'a').locator('.gt-files a.gt-file')).toHaveText(['옛 안건.pdf', '뺄 자료.pdf']);
    await page.evaluate(notes => window.KPTUGoogleTasks.openEditor({ id: 'a', title: '회의 자료 준비', taskListId: '@default', status: 'needsAction', notes }), google.a.notes);
    await expect(page.locator('#gtTaskHeading')).toHaveText('Google 할 일 수정');
    const att = page.locator('#gtEditAttach');
    await expect(att.locator('.gt-att-row .gt-att-name')).toHaveText(['옛 안건.pdf', '뺄 자료.pdf']);
    await page.locator('#gtEditNotes').fill('고친 메모');
    await att.locator('[data-gt-att-swap="old1"]').click();
    await att.locator('[data-gt-att-swap-input]').setInputFiles([txt('새 안건.txt')]);
    await att.locator('[data-gt-att-remove="old2"]').click();
    await att.locator('[data-gt-att-add-input]').setInputFiles([txt('더할 자료.txt')]);
    const release = gate();
    await page.locator('#gtSaveBtn').click();
    // 글(메모) 먼저, 그다음 빼기 — 창은 새 파일이 올라가기를 기다리지 않는다.
    await expect.poll(() => state.calls.attach.length).toBe(1);
    await expect(page.locator('#gtTaskModal')).toBeHidden();
    expect(state.calls.order.slice(0, 3)).toEqual(['update', 'detach:old2', 'attach:새 안건.txt']);
    expect(state.calls.updates[0].notes).toBe(['고친 메모', line('old1', '옛 안건.pdf'), line('old2', '뺄 자료.pdf')].join('\n'));
    await expect(dock(page)).toContainText('2개 올리는 중');
    await shot(page, `task-edit-saving-${w}`);
    release();
    await expect(dock(page)).toContainText('할 일에 파일 2개 올렸어요');
    // 교체: 새 파일을 올린 뒤 원래 파일을 뺀다(Drive에는 남음).
    expect(state.calls.order).toEqual(['update', 'detach:old2', 'attach:새 안건.txt', 'detach:old1', 'attach:더할 자료.txt']);
    await expect(rowById(page, 'a').locator('.gt-files a.gt-file')).toHaveText(['새 안건.txt', '더할 자료.txt']);
    expect(google.a.notes).toBe(['고친 메모', line('drv1', '새 안건.txt'), line('drv2', '더할 자료.txt')].join('\n'));
    expect(errors).toEqual([]);
    await context.close();
  });

  test(`일정 창 [할 일]로 저장 + 파일: 창은 바로 닫히고 파일은 뒤에서 ${w}`, async ({ browser }) => {
    const { context, page, state, errors, gate } = await openTasks(browser, { viewport });
    const q = page.locator('#tasksView .home-quick[data-home-quick]');
    await q.locator('[data-quick-input]').fill('현장 점검');
    await q.locator('[data-quick-detail]').click();
    const modal = page.locator('#eventModal');
    await expect(page.locator('#eventModalTitle')).toHaveText('할 일 등록');
    await modal.locator('#eventTaskFiles [data-gt-pick-input]').setInputFiles([png('현장1.png'), png('현장2.png')]);
    const release = gate();
    await page.locator('#saveEventBtn').click();
    await expect.poll(() => state.calls.attach.length).toBe(1);
    await expect(modal).toBeHidden();
    await expect(dock(page)).toContainText('2개 올리는 중');
    await shot(page, `task-calendar-saving-${w}`);
    release();
    await expect(dock(page)).toContainText('할 일에 사진 2장 올렸어요');
    // 알림은 하단바 위 한 줄 하나(위쪽 '할 일을 추가했습니다' 알림은 띄우지 않음).
    await expect(page.locator('#toast')).not.toContainText('할 일을 추가했습니다');
    await shot(page, `task-calendar-done-${w}`);
    expect(state.calls.attach).toEqual([{ taskId: 'new1', name: '현장1.png' }, { taskId: 'new1', name: '현장2.png' }]);
    expect(errors).toEqual([]);
    await context.close();
  });

  test(`[할 일] 빠른 입력칸: [추가] 바로 입력칸이 풀리고 파일은 뒤에서 ${w}`, async ({ browser }) => {
    const { context, page, state, errors, gate } = await openTasks(browser, { viewport });
    const q = page.locator('#tasksView .home-quick[data-home-quick]');
    // [할 일] 입력칸의 클립(📎)은 아래 목록이 할 일 첨부 표를 읽고 답한 뒤에야 켜진다(home-quick.js taskFilesOn). 켜지기 전에 고른 파일은
    // 입력칸이 받지 않으므로, 사람처럼 클립이 보인 뒤 고른다(STAB-저장먼저닫기흔들림 — 이 시험만 기다리지 않아 가끔 파일 없이 저장됐다).
    await expect(q.locator('[data-quick-file-picker] .basket-clip')).toBeVisible();
    await q.locator('input[type="file"]').setInputFiles([txt('안건.txt'), png('칠판.png')]);
    await q.locator('[data-quick-input]').fill('안건 보내기');
    const release = gate();
    await q.locator('[data-quick-save]').click();
    await expect.poll(() => state.calls.attach.length).toBe(1);
    await expect(q.locator('[data-quick-input]')).toHaveValue('');
    await expect(q.locator('[data-quick-input]')).toBeEnabled();
    await expect(q.locator('[data-basket-files] .library-selected-file')).toHaveCount(0);
    await expect(dock(page)).toContainText('2개 올리는 중');
    await shot(page, `task-quick-saving-${w}`);
    release();
    await expect(dock(page)).toContainText('할 일에 사진 1장·파일 1개 올렸어요');
    await expect(rowByTitle(page, '안건 보내기').locator('.gt-files a.gt-file')).toHaveText(['안건.txt', '칠판.png']);
    expect(errors).toEqual([]);
    await context.close();
  });
}

// STAB-갈래4흔들림: 고른 파일은 같은 파일 찾기(same-file.js, 서버 읽기)가 끝난 뒤에 담긴다. 찾기가 끝나기 전에 [저장]을 눌러도
// 고른 파일이 빠지지 않는다(저장이 찾기를 기다린 뒤 파일을 읽음). 찾기 읽기를 붙잡아 두고 [저장]을 누른 뒤 푼다.
test('일정 창 [할 일]로 저장: 같은 파일 찾기가 끝나기 전에 [저장]을 눌러도 고른 파일 2개가 그대로 올라감 1280', async ({ browser }) => {
  const { context, page, state, errors } = await openTasks(browser, { viewport: { width: 1280, height: 900 } });
  let release, asked = 0; const held = new Promise(r => { release = r; });
  await page.route(u => /\/rest\/v1\/(app_documents|app_task_attachments|app_notes)$/.test(u.pathname), async r => {
    if (!/file_name=in|attachments=cs/.test(decodeURIComponent(r.request().url()))) return r.fallback();
    asked++; await held; return r.fallback();
  });
  const q = page.locator('#tasksView .home-quick[data-home-quick]');
  await q.locator('[data-quick-input]').fill('현장 점검');
  await q.locator('[data-quick-detail]').click();
  const modal = page.locator('#eventModal');
  await expect(page.locator('#eventModalTitle')).toHaveText('할 일 등록');
  await modal.locator('#eventTaskFiles [data-gt-pick-input]').setInputFiles([png('현장1.png'), png('현장2.png')]);
  await expect.poll(() => asked).toBeGreaterThan(0);
  await page.locator('#saveEventBtn').click();
  release();
  await expect(modal).toBeHidden();
  await expect(dock(page)).toContainText('할 일에 사진 2장 올렸어요');
  expect(state.calls.attach).toEqual([{ taskId: 'new1', name: '현장1.png' }, { taskId: 'new1', name: '현장2.png' }]);
  expect(errors).toEqual([]);
  await context.close();
});

test('할 일 창: 글 저장이 실패하면 창·고른 파일은 그대로이고 아무것도 보내지 않는다 412', async ({ browser }) => {
  const { context, page, state } = await openTasks(browser, { viewport: { width: 412, height: 915 }, failCreate: true });
  await page.evaluate(() => window.KPTUGoogleTasks.openEditor(null));
  await page.locator('#gtNewFiles [data-gt-pick-input]').setInputFiles([txt('보고.txt')]);
  await page.locator('#gtEditTitle').fill('실패 시험');
  await page.locator('#gtSaveBtn').click();
  await expect(page.locator('#gtEditStatus')).not.toHaveText(/저장 중/);
  await expect(page.locator('#gtEditStatus')).not.toHaveText('');
  await expect(page.locator('#gtTaskModal')).toBeVisible();
  await expect(page.locator('#gtNewFiles .gt-pick-name')).toHaveText(['보고.txt']);
  expect(state.calls.creates.length).toBe(1);
  expect(state.calls.attach).toEqual([]);
  await expect(page.locator('#uploadDock:not([hidden])')).toHaveCount(0);
  await context.close();
});

// 잊지 말기 상세 [할 일 만들기] + 파일(basket-manual-link.js): 할 일이 생기면 창(할 일 만들기 칸)은 닫히고 파일은 뒤에서.
const NOTE = '10000000-0000-4000-8000-000000000001', STAMP = '2026-10-06T01:00:00.123456+00:00';
for (const width of [412, 1280]) {
  test(`잊지 말기 [할 일 만들기] + 파일: 할 일이 생기면 바로 닫히고 파일은 뒤에서 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 761 ? 1200 : 900 });
    await openHome(page);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const note = { id: NOTE, workspace_id: 'w', occurred_at: STAMP, updated_at: STAMP, raw_text: '10/20 기자회견 준비 회의\n장소: 본사 앞', ai_export_allowed: true, archived_at: null, attachments: [], metadata: {} };
    await page.route(SB + '/rest/v1/app_notes?**', async route => {
      const req = route.request(), q = new URL(req.url()).searchParams;
      if (req.method() === 'PATCH') { note.metadata = req.postDataJSON().metadata; return route.fulfill({ json: [{ id: NOTE, updated_at: note.updated_at, metadata: note.metadata }] }); }
      if (q.get('metadata') === 'cs.{"tasks":[]}') return route.fulfill({ json: [] });
      return route.fulfill({ json: [note] });
    });
    await page.route(SB + '/rest/v1/app_task_attachments?**', route => route.fulfill({ json: [] }));
    const attach = []; let open; const hold = new Promise(r => { open = r; });
    await page.route(SB + '/functions/v1/google-tasks?action=attach', async route => {
      const body = route.request().postDataBuffer()?.toString('latin1') || '';
      attach.push({ task: body.match(/name="task_id"\r\n\r\n([^\r]*)/)?.[1], name: Buffer.from(body.match(/name="file"; filename="([^"]*)"/)?.[1] || '', 'latin1').toString('utf8') });
      await hold;
      return route.fulfill({ json: { ok: true, files: attach.map((a, i) => ({ drive_file_id: 'd' + i, file_name: a.name, size_bytes: 3 })), notes_synced: true } });
    });
    await page.evaluate(() => window.KPTURouter.go('basket'));
    await showBasketRow(page, NOTE);
    const tap = async loc => { await expect(loc).toBeVisible(); await loc.click(); };
    await tap(page.locator(`[data-basket-row="${NOTE}"]`));
    const detail = page.locator('[data-basket-detail]');
    await tap(detail.getByRole('button', { name: '할 일 만들기' }));
    await detail.locator('[data-manual-task-title]').fill('기자회견 장소 확정');
    const pick = detail.locator('[data-gt-pick-input]');
    await expect(detail.locator('[data-gt-pick]')).toBeVisible();
    await pick.setInputFiles([png('현장 사진.png')]);
    await tap(detail.getByRole('button', { name: '할 일 만들기', exact: true }));
    await expect.poll(() => attach.length).toBe(1);
    await expect(detail.locator('[data-basket-status]')).toHaveText('Google 할 일을 만들었어요. 이 업데이트에 기록했어요.');
    await expect(detail.locator('[data-manual-task-title]')).toHaveCount(0);
    await expect(dock(page)).toContainText('1개 올리는 중');
    await shot(page, `task-forget-saving-${width}`);
    open();
    await expect(dock(page)).toContainText('할 일에 사진 1장 올렸어요');
    await expect(page.locator('#toast')).not.toContainText('Google 할 일을 만들었어요');
    expect(attach.map(a => a.name)).toEqual(['현장 사진.png']);
    expect(attach[0].task).toMatch(/^home-created-/);
    expect(errors).toEqual([]);
  });
}
