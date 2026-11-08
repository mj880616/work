import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S49-38 FOLDER-순서·색 ② (설계 docs/design/folder-color-order.md): 노트 폴더·노트 끌기 순서(줄 사이 = 순서 / 줄 가운데 = 넣기), 색 8가지(고르기·새로고침 뒤 유지·
// 폴더 고르기 창·꼬리표·포스트잇 같은 색), 노트 정렬 [내가 정한 순서]일 때만 노트 끌기, 폰은 꾹 눌러 끌기 + ⋯ [위로][아래로]. 이름·내용은 모두 가짜.
test.use({ hasTouch: true });
// 시험 화면은 시계가 멈춰 있어(home-entry) '끌기 직후 누름 삼킴 시간'이 저절로 안 지난다: 시계를 앞으로 보낸다.
let clockStep = 0;
const tick = page => page.clock.setFixedTime(new Date(Date.parse('2026-10-06T01:00:00Z') + (++clockStep) * 60000));
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], writes = [], rpc = [];
  page.on('pageerror', e => errors.push(e.message));
  const server = await installViewPrefsServer(page);
  await openHome(page);
  const row = (id, title, updated_at, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문', occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
  const rows = [
    row('n1', '가 노트', '2026-10-16T01:00:00Z', { folder_id: U(1), folder: '갑 폴더' }),
    row('n2', '나 노트', '2026-10-15T01:00:00Z', { folder_id: U(1), folder: '갑 폴더' }),
    row('n3', '다 노트', '2026-10-14T01:00:00Z', { folder_id: U(1), folder: '갑 폴더' }),
    row('n4', '라 노트', '2026-10-10T01:00:00Z', { folder_id: U(2), folder: '을 폴더' }),
  ];
  const mk = (n, name, order) => ({ id: U(n), workspace_id: 'w', parent_id: null, name, sort_order: order, created_at: `2026-10-0${n}T00:00:00Z`, color: null });
  const folders = [mk(1, '갑 폴더', 1024), mk(2, '을 폴더', 2048), mk(3, '병 폴더', 3072)];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'));
    if (req.method() === 'GET') return r.fulfill({ json: rows.filter(pick).map(x => structuredClone(x)) });
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push({ table: 'notes', id: (q.get('id') || '').slice(3), body }); const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, structuredClone(body))); return r.fulfill({ json: hit.map(x => structuredClone(x)) }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams, id = (q.get('id') || '').slice(3);
    if (req.method() === 'GET') return r.fulfill({ json: structuredClone(folders) });
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push({ table: 'folders', id, body }); const x = folders.find(f => f.id === id); Object.assign(x, body); return r.fulfill({ json: [structuredClone(x)] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/rpc/app_note_folder_set_color', async r => {
    const body = r.request().postDataJSON(); rpc.push(body);
    const x = folders.find(f => f.id === body.p_id); if (!x) return r.fulfill({ status: 403, json: { message: 'NOTE_FOLDER_COLOR_FORBIDDEN' } });
    x.color = body.p_color; return r.fulfill({ json: { ok: true, id: body.p_id, color: body.p_color } });
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  const show = async () => { await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 }); await page.waitForFunction(() => window.KPTURouter?.go); await page.evaluate(() => window.KPTURouter.go('basket')); await chooseBasketKind(page, 'note'); await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 4'); };
  await show();
  return { rows, folders, writes, rpc, errors, server, show };
}
// 진짜 마우스로 끌기: from 줄을 잡아 to 줄의 zone 자리에 놓는다(before 위 25% 안 / inside 가운데 / after 아래 25% 안).
async function mouseDrag(page, from, to, zone = 'inside') {
  const a = await page.locator(from).first().boundingBox(), b = await page.locator(to).first().boundingBox();
  const ty = zone === 'before' ? b.y + b.height * 0.1 : zone === 'after' ? b.y + b.height * 0.9 : b.y + b.height * 0.5;
  await page.mouse.move(a.x + 30, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + a.height / 2 + 6, { steps: 3 });
  await page.mouse.move(b.x + 30, ty, { steps: 8 });
  await page.mouse.up();
}
const treeOrder = page => page.locator('[data-nx-tree] [data-nx-folder]').evaluateAll(els => els.map(el => el.dataset.nxFolder));
const noteOrder = page => page.locator('#noteRows [data-nx-note]').evaluateAll(els => els.map(el => el.dataset.nxNote));
const more = (page, id) => page.locator(`[data-nx-tree] [data-nx-folder-more="${id}"], #noteRows [data-nx-folder-more="${id}"]`).first();
const rootMenu = page => page.locator('#noteDocMenu');
async function pickColor(page, id, name) {
  await more(page, id).click();
  await rootMenu(page).locator('[data-nx-color]').click();
  await expect(rootMenu(page).locator('[data-fl-color]')).toHaveCount(9);
  await rootMenu(page).locator(`[aria-label="${name}"]`).click();
}

test.describe('PC 1440', () => {
  test.use({ hasTouch: false });
  test('폴더: 줄 사이에 놓으면 순서, 가운데 놓으면 안으로 / 되돌리기', async ({ page }) => {
    const f = await fixture(page, 1440);
    expect(await treeOrder(page)).toEqual([U(1), U(2), U(3)]);
    // 위 25% 안: 병 폴더를 갑 폴더 앞으로 → 순서만 바뀐다(상위는 그대로 null, 병 폴더 한 줄만 쓴다).
    await mouseDrag(page, `[data-nx-tree] [data-nx-folder="${U(3)}"]`, `[data-nx-tree] [data-nx-folder="${U(1)}"]`, 'before');
    await expect.poll(() => treeOrder(page)).toEqual([U(3), U(1), U(2)]);
    expect(f.folders.find(x => x.id === U(3)).parent_id).toBe(null);
    expect(f.writes.filter(w => w.table === 'folders').map(w => w.id)).toEqual([U(3)]);
    await expect(page.locator('#kptuNotice')).toContainText('폴더 순서를 바꿨어요');
    // 되돌리기: 처음 순서로.
    await page.locator('#kptuNotice .kptu-notice-undo').click();
    await expect.poll(() => treeOrder(page)).toEqual([U(1), U(2), U(3)]);
    // 아래 25% 안: 갑 폴더를 을 폴더 뒤로.
    await mouseDrag(page, `[data-nx-tree] [data-nx-folder="${U(1)}"]`, `[data-nx-tree] [data-nx-folder="${U(2)}"]`, 'after');
    await expect.poll(() => treeOrder(page)).toEqual([U(2), U(1), U(3)]);
    // 가운데 50%: 병 폴더를 갑 폴더 안으로 → 상위가 갑 폴더가 된다(순서가 아니라 넣기).
    await mouseDrag(page, `[data-nx-tree] [data-nx-folder="${U(3)}"]`, `[data-nx-tree] [data-nx-folder="${U(1)}"]`, 'inside');
    await expect.poll(() => f.folders.find(x => x.id === U(3)).parent_id).toBe(U(1));
    expect(f.errors).toEqual([]);
  });

  test('끌어 놓는 동안 자리 표시: 사이는 선 하나, 가운데는 바탕 하나(동시에 나오지 않음)', async ({ page }) => {
    await fixture(page, 1440);
    const from = await page.locator(`[data-nx-tree] [data-nx-folder="${U(3)}"]`).boundingBox(), to = await page.locator(`[data-nx-tree] [data-nx-folder="${U(1)}"]`).boundingBox();
    await page.mouse.move(from.x + 30, from.y + from.height / 2); await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + from.height / 2 - 8, { steps: 3 });
    const target = page.locator(`[data-nx-tree] [data-nx-folder="${U(1)}"]`);
    await page.mouse.move(to.x + 30, to.y + to.height * 0.1, { steps: 6 });
    await expect(target).toHaveClass(/nx-line-before/); await expect(target).not.toHaveClass(/nx-drop/);
    await page.mouse.move(to.x + 30, to.y + to.height * 0.5, { steps: 3 });
    await expect(target).toHaveClass(/nx-drop/); await expect(target).not.toHaveClass(/nx-line-(before|after)/);
    await page.mouse.move(to.x + 30, to.y + to.height * 0.9, { steps: 3 });
    await expect(target).toHaveClass(/nx-line-after/); await expect(target).not.toHaveClass(/nx-drop/);
    await page.mouse.up();
  });

  test('색: 선택하면 나무·꼬리표·폴더 선택 창·포스트잇이 같은 색, 새로고침해도 유지, 서버 함수로만 저장', async ({ page }) => {
    const f = await fixture(page, 1440);
    // 안 고른 폴더는 기본 노랑 폴더 그림(FOLDER-나무새기준: 공용 닫힌/열린 그림, 색 번호 없음).
    await expect(page.locator(`[data-nx-tree] [data-nx-folder="${U(1)}"] .ft-ico`)).not.toHaveAttribute('data-fc', /./);
    await pickColor(page, U(1), '강청');
    await expect.poll(() => f.rpc).toEqual([{ p_id: U(1), p_color: 5 }]);
    const icon = page.locator(`[data-nx-tree] [data-nx-folder="${U(1)}"] .ft-ico`);
    await expect(icon).toHaveAttribute('data-fc', '5');
    await expect(icon.locator('svg')).toBeVisible();
    // 표 쓰기(PATCH)로는 색을 보내지 않는다.
    expect(f.writes.some(w => 'color' in w.body)).toBe(false);
    // 목록 보기 꼬리표 / 포스트잇 칸이 같은 번호.
    await page.locator('[data-note-view="list"]').click();
    await expect(page.locator('#noteRows .nx-path[data-fc="5"]').first()).toBeVisible();
    await expect(page.locator('#noteRows .nx-path[data-fc]:not([data-fc="5"])')).toHaveCount(0);
    await page.locator('[data-note-view="board"]').click();
    await expect(page.locator('.nb-card[data-fc="5"]')).toHaveCount(3);
    await expect(page.locator('.nb-card:not([data-fc])')).toHaveCount(1);
    await page.locator('[data-note-view="folder"]').click();
    // 색 바꾸기.
    await pickColor(page, U(1), '자주');
    await expect(icon).toHaveAttribute('data-fc', '7');
    // 새로고침해도(서버 값) 같은 색.
    await page.reload(); await f.show();
    await expect(page.locator(`[data-nx-tree] [data-nx-folder="${U(1)}"] .ft-ico`)).toHaveAttribute('data-fc', '7');
    await pickColor(page, U(1), '기본');
    expect(f.rpc.at(-1)).toEqual({ p_id: U(1), p_color: null });
    await expect(page.locator(`[data-nx-tree] [data-nx-folder="${U(1)}"] .ft-ico`)).not.toHaveAttribute('data-fc', /./);
    expect(f.errors).toEqual([]);
  });

  test('폴더 선택 창: 색 선택한 폴더 줄에 같은 색 그림', async ({ page }) => {
    const f = await fixture(page, 1440);
    await pickColor(page, U(2), '청록');
    await page.locator('[data-note-view="list"]').click();
    await page.locator('[data-note-row-more="n1"]').click();
    await page.locator('#noteDocMenu [data-note-folder-move]').click();
    const item = page.locator('#luMovePicker .lu-move-item', { hasText: '을 폴더' });
    await expect(item.locator('.lu-move-ico')).toHaveAttribute('data-fc', '4');
    // S52-27(11/07 21:13): 색 안 고른 폴더도 기본 노란 폴더 그림(색 번호 없음), 이름은 그림 바로 옆 왼쪽.
    const plain = page.locator('#luMovePicker .lu-move-item', { hasText: '갑 폴더' });
    await expect(plain.locator('.lu-move-ico svg')).toHaveCount(1);
    await expect(plain.locator('.lu-move-ico')).not.toHaveAttribute('data-fc', /./);
    const gap = await plain.evaluate(b => b.querySelector('.lu-move-name').getBoundingClientRect().left - b.querySelector('.lu-move-ico').getBoundingClientRect().right);
    expect(gap).toBeLessThan(20);
    expect(f.errors).toEqual([]);
  });

  test('노트 순서: 정렬이 [수정한 날]이면 끌어도 안내만, [내가 정한 순서]면 끌어서 저장, 새로고침해도 같은 순서', async ({ page }) => {
    const f = await fixture(page, 1440);
    await page.locator(`[data-nx-tree] [data-nx-open="${U(1)}"]`).click();
    expect(await noteOrder(page)).toEqual(['n1', 'n2', 'n3']);
    // 고친 날 정렬: 같은 폴더 안 노트 위에 놓으면 아무것도 저장하지 않고 안내.
    await mouseDrag(page, '#noteRows [data-nx-note="n3"]', '#noteRows [data-nx-note="n1"]', 'before');
    await expect(page.locator('#kptuNotice')).toContainText('내가 정한 순서');
    expect(f.writes.filter(w => w.table === 'notes')).toEqual([]);
    expect(await noteOrder(page)).toEqual(['n1', 'n2', 'n3']);
    // 정렬을 내가 정한 순서로(서버에 기억).
    await page.locator('[data-note-folder-more]').click();
    await expect(page.locator('#noteDocMenu [data-nx-sort]')).toContainText('내가 정한 순서');
    await page.locator('#noteDocMenu [data-nx-sort]').click();
    await expect.poll(() => f.server.value?.note_sort).toBe('manual');
    // n3을 n1 앞으로 → n3 맨 앞.
    await mouseDrag(page, '#noteRows [data-nx-note="n3"]', '#noteRows [data-nx-note="n1"]', 'before');
    await expect.poll(() => noteOrder(page)).toEqual(['n3', 'n1', 'n2']);
    const orders = Object.fromEntries(f.rows.map(r => [r.id, r.metadata.order]));
    expect(orders.n3).toBeLessThan(orders.n1); expect(orders.n1).toBeLessThan(orders.n2);
    // 순서 쓰기는 고친 날을 바꾸지 않는다.
    expect(f.rows.find(r => r.id === 'n3').updated_at).toBe('2026-10-14T01:00:00Z');
    // ⋯ [아래로](끌기 직후 누름 삼킴 시간이 지난 뒤).
    await tick(page);
    await page.locator('[data-note-row-more="n3"]').click();
    await expect(page.locator('#noteDocMenu [data-note-up]')).toHaveCount(0);
    await page.locator('#noteDocMenu [data-note-down]').click();
    await expect.poll(() => noteOrder(page)).toEqual(['n1', 'n3', 'n2']);
    // 새로고침해도 같은 정렬·같은 순서.
    await page.reload(); await f.show();
    await page.locator(`[data-nx-tree] [data-nx-open="${U(1)}"]`).click();
    await expect.poll(() => noteOrder(page)).toEqual(['n1', 'n3', 'n2']);
    // 다시 고친 날로.
    await page.locator('[data-note-folder-more]').click();
    await page.locator('#noteDocMenu [data-nx-sort]').click();
    await expect.poll(() => f.server.value?.note_sort).toBe('changed');
    await expect.poll(() => noteOrder(page)).toEqual(['n1', 'n2', 'n3']);
    expect(f.errors).toEqual([]);
  });

  test('폴더 ⋯ 메뉴: 색 선택·위로·아래로(맨 앞은 위로 없음, 맨 끝은 아래로 없음)', async ({ page }) => {
    const f = await fixture(page, 1440);
    await more(page, U(1)).click();
    await expect(rootMenu(page).locator('button')).toHaveText(['새 노트', '선택', '이 폴더로 들어가기', '새 폴더', '이름 바꾸기', '색 선택…', '아래로', '옮기기…', '폴더 삭제']);
    await page.keyboard.press('Escape');
    await more(page, U(3)).click();
    await expect(rootMenu(page).locator('[data-nx-folder-up]')).toHaveText('위로');
    await expect(rootMenu(page).locator('[data-nx-folder-down]')).toHaveCount(0);
    await rootMenu(page).locator('[data-nx-folder-up]').click();
    await expect.poll(() => treeOrder(page)).toEqual([U(1), U(3), U(2)]);
    expect(f.folders.find(x => x.id === U(3)).sort_order).toBeLessThan(f.folders.find(x => x.id === U(2)).sort_order);
    expect(f.errors).toEqual([]);
  });
});

test.describe('폰 412', () => {
  test('꾹 눌러 끌어 폴더 순서 바꾸기, 끌지 않고 떼면 메뉴, ⋯ [위로]·색', async ({ page }) => {
    const f = await fixture(page, 412);
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
    const center = async sel => { const r = await page.locator(sel).first().boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.y + r.height * 0.1 }; };
    const rowSel = n => `#noteRows [data-nx-folder="${U(n)}"] .ft-name`;
    const order = () => page.locator('#noteRows [data-nx-folder]').evaluateAll(els => els.map(el => el.dataset.nxFolder));
    expect(await order()).toEqual([U(1), U(2), U(3)]);
    // 병 폴더를 꾹 눌러 갑 폴더 윗부분으로 끌어 놓기 → 순서만 바뀐다.
    const a = await center(rowSel(3)), b = await center(`#noteRows [data-nx-folder="${U(1)}"]`);
    await touch('touchStart', [{ x: a.x, y: a.y }]); await page.waitForTimeout(650);
    await touch('touchMove', [{ x: a.x, y: a.y - 20 }]); await touch('touchMove', [{ x: b.x, y: (a.y + b.top) / 2 }]); await touch('touchMove', [{ x: b.x, y: b.top }]);
    await expect(page.locator(`#noteRows [data-nx-folder="${U(1)}"]`)).toHaveClass(/nx-line-before/);
    await touch('touchEnd', []);
    await expect.poll(order).toEqual([U(3), U(1), U(2)]);
    expect(f.folders.find(x => x.id === U(3)).parent_id).toBe(null);
    // 끌지 않고 떼면 ⋯ 메뉴.
    await tick(page);
    const c = await center(rowSel(2));
    await touch('touchStart', [{ x: c.x, y: c.y }]); await page.waitForTimeout(650); await touch('touchEnd', []);
    await expect(rootMenu(page)).toBeVisible();
    // NOTE-폴더메뉴새노트: 맨 위 [새 노트], 그다음 [선택].
    await expect(rootMenu(page).locator('button').first()).toHaveText('새 노트');
    await expect(rootMenu(page).locator('button').nth(1)).toHaveText('선택');
    await expect(rootMenu(page).locator('[data-nx-folder-up]')).toHaveText('위로');
    await rootMenu(page).locator('[data-nx-folder-up]').tap();
    await expect.poll(order).toEqual([U(3), U(2), U(1)]);
    await tick(page);
    await page.waitForTimeout(700);
    // 색 고르기(폰): 동그라미 9개가 화면 안에 보이고 누르면 저장.
    await page.locator(`#noteRows [data-nx-folder-more="${U(2)}"]`).tap();
    await rootMenu(page).locator('[data-nx-color]').tap();
    const box = await rootMenu(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(412);
    await rootMenu(page).locator('[aria-label="황토"]').tap();
    await expect.poll(() => f.rpc).toEqual([{ p_id: U(2), p_color: 2 }]);
    await expect(page.locator(`#noteRows [data-nx-folder="${U(2)}"] .ft-ico`)).toHaveAttribute('data-fc', '2');
    await cdp.detach();
    expect(f.errors).toEqual([]);
  });
});
