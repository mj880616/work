import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';

// NOTE-보드여러개 (요청함 10/30 05:48, 명진 결정 '위 추천안대로'): 포스트잇 보기 위 [전체] [보드…] [+ 새 보드].
// PC: 왼쪽 폴더·노트 목록에서 끌어 놓기(또는 누르기)로 붙이기, 이미 붙은 노트는 흐리게, ×로 빼도 노트는 남음, 옮긴 자리는 metadata.boards[보드 id].
// 폰: [+ 노트 붙이기] 고르기 창, 보드 칸 꾹 누르기 메뉴 [이름 바꾸기] [보드 지우기]. 보드 목록·마지막 보드는 서버 화면 기억(view_prefs). 이름은 지어낸 것.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const F = '00000000-0000-4000-8000-000000000001';
async function fixture(page, width, prefs = {note_view:'board'}) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  const server = await installViewPrefsServer(page, prefs);
  await openHome(page);
  const row = (id, title, updated_at, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + '\n첫 줄 내용', occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
  const rows = [
    row('n1', '가 노트', '2026-10-10T01:00:00Z', { folder_id: F, board: { x: 24, y: 24, r: 1, z: 0 } }),
    row('n2', '나 노트', '2026-10-16T01:00:00Z'),
    row('n3', '다 노트', '2026-10-12T01:00:00Z', { folder_id: F }),
  ];
  const folders = [{ id: F, workspace_id: 'w', parent_id: null, name: '회의', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' }];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id')) && (!q.get('updated_at') || 'eq.' + x.updated_at === q.get('updated_at'));
    if (req.method() === 'GET') return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)).map(x => structuredClone(x)) });
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push({ id: (q.get('id') || '').slice(3), body }); const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, structuredClone(body))); return r.fulfill({ json: hit.map(x => structuredClone(x)) }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3');
  return { rows, writes, errors, server };
}
const chip = (page, name) => page.locator('[data-nbb] .nbb-chip', { hasText: name });
const cards = page => page.locator('[data-note-board] [data-nb-card]');
const boardId = server => server.value?.note_boards?.[0]?.id;

test('PC: 새 보드 → 왼쪽 목록에서 끌어 놓기·누르기로 붙이기 → 옮기기 → ×로 빼기, [전체]는 그대로 (1440)', async ({ page }) => {
  const { rows, writes, errors, server } = await fixture(page, 1440);
  await expect(chip(page, '전체')).toHaveAttribute('aria-pressed', 'true');
  await expect(cards(page)).toHaveCount(3);
  await expect(page.locator('[data-nbb-side]')).toBeHidden();
  const bar = await page.locator('[data-nbb] [data-nbb-new]').boundingBox();
  expect(bar.height).toBeLessThanOrEqual(28);
  page.once('dialog', d => d.accept('국회 대응'));
  await page.locator('[data-nbb] [data-nbb-new]').click();
  await expect(chip(page, '국회 대응')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => boardId(server)).toMatch(/^b[0-9a-z]{8}$/);
  const id = boardId(server);
  await expect.poll(() => server.value?.note_board).toBe(id);
  expect(server.value.note_boards).toEqual([{ id, name: '국회 대응' }]);
  // 빈 판 한 줄, 왼쪽 170px 목록.
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator('[data-nb-empty]')).toHaveText('왼쪽 노트를 끌어다 놓으세요');
  const side = page.locator('[data-nbb-side]');
  await expect(side).toBeVisible();
  expect(Math.round((await side.boundingBox()).width)).toBe(170);
  await side.locator('[data-nbb-folder]', { hasText: '회의' }).click();
  await side.locator('[data-nbb-folder]', { hasText: '폴더 없음' }).click();
  await expect(side.locator('[data-nbb-note]')).toHaveCount(3);
  // 끌어 놓기: 놓은 곳에 붙는다.
  await side.locator('[data-nbb-note="n1"]').dragTo(page.locator('[data-nb-scroll]'), { targetPosition: { x: 400, y: 300 } });
  await expect(cards(page)).toHaveCount(1);
  await expect.poll(() => rows[0].metadata.boards?.[id]).toBeTruthy();
  expect(rows[0].metadata.board).toEqual({ x: 24, y: 24, r: 1, z: 0 }); // [전체] 자리는 그대로
  await expect(side.locator('[data-nbb-note="n1"]')).toHaveAttribute('aria-disabled', 'true');
  // 누르기: 빈 곳에 붙는다.
  await side.locator('[data-nbb-note="n2"]').click();
  await side.locator('[data-nbb-note="n3"]').click();
  await expect(cards(page)).toHaveCount(3 - 0);
  await expect.poll(() => rows.filter(r => r.metadata.boards?.[id]).length).toBe(3);
  for (const w of writes) expect(w.body.updated_at).toBeUndefined();
  // 옮기기 → metadata.boards[id]만 바뀐다.
  const card = page.locator('[data-nb-card="n2"]'), box = await card.boundingBox(), before = structuredClone(rows[1].metadata.boards[id]);
  await page.mouse.move(box.x + 40, box.y + 60); await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 120, { steps: 6 }); await page.mouse.move(box.x + 200, box.y + 160, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => rows[1].metadata.boards[id].x).not.toBe(before.x);
  expect(rows[1].metadata.board).toBeUndefined();
  // ×로 빼기: 노트는 남는다.
  await page.locator('[data-nb-card="n3"] [data-nb-remove]').click();
  await expect(cards(page)).toHaveCount(2);
  await expect.poll(() => rows[2].metadata.boards?.[id]).toBeUndefined();
  await expect(side.locator('[data-nbb-note="n3"]')).not.toHaveAttribute('aria-disabled', 'true');
  // ⋯ 메뉴 [보드에서 빼기]
  await page.locator('[data-nb-card="n2"] [data-note-row-more]').click();
  await page.locator('#noteDocMenu [data-nbb-detach]').click();
  await expect(cards(page)).toHaveCount(1);
  // [전체]는 모든 노트 그대로, 보드 목록은 숨김.
  await chip(page, '전체').click();
  await expect(cards(page)).toHaveCount(3);
  await expect(side).toBeHidden();
  await expect.poll(() => server.value?.note_board).toBe('all');
  // 다시 보드: 붙은 칸 자리 그대로(다른 보기 갔다 와도).
  await chip(page, '국회 대응').click();
  const left = await page.locator('[data-nb-card="n1"]').evaluate(n => n.style.left);
  await page.locator('.nv-switch [data-note-view="list"]').click(); await page.locator('.nv-switch [data-note-view="board"]').click();
  await expect(chip(page, '국회 대응')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-nb-card="n1"]')).toHaveCSS('left', left);
  expect(errors).toEqual([]);
});

test('PC: 서버에 기억한 마지막 보드로 열리고, 보드 칸 우클릭 메뉴로 이름 바꾸기·지우기(노트는 그대로) (1440)', async ({ page }) => {
  const id = 'b1a2b3c4';
  const { rows, errors, server } = await fixture(page, 1440, { note_view: 'board', note_boards: [{ id, name: '교섭' }], note_board: id });
  await expect(chip(page, '교섭')).toHaveAttribute('aria-pressed', 'true');
  await expect(cards(page)).toHaveCount(0);
  await page.locator('[data-nbb-side] [data-nbb-folder]', { hasText: '폴더 없음' }).click();
  await page.locator('[data-nbb-side] [data-nbb-note="n2"]').click();
  await expect(cards(page)).toHaveCount(1);
  await expect.poll(() => rows[1].metadata.boards?.[id]).toBeTruthy();
  page.once('dialog', d => d.accept('교섭 대응'));
  await chip(page, '교섭').click({ button: 'right' });
  await page.locator('[data-nbb-menu] [data-nbb-rename]').click();
  await expect(chip(page, '교섭 대응')).toBeVisible();
  await expect.poll(() => server.value?.note_boards?.[0]?.name).toBe('교섭 대응');
  await chip(page, '교섭 대응').click({ button: 'right' });
  await page.locator('[data-nbb-menu] [data-nbb-delete]').click();
  await page.locator('.kptu-ask .danger').click();
  await expect(page.locator('[data-nbb] .nbb-chip')).toHaveCount(1);
  await expect(chip(page, '전체')).toHaveAttribute('aria-pressed', 'true');
  await expect(cards(page)).toHaveCount(3);
  await expect.poll(() => server.value?.note_boards).toEqual([]);
  await expect.poll(() => rows[1].metadata.boards).toBeUndefined();
  expect(rows.length).toBe(3);
  expect(errors).toEqual([]);
});

for (const width of [412, 760]) {
  test(`폰: [+ 노트 붙이기] 고르기 창으로 붙이기, 꾹 누르기 메뉴 (${width})`, async ({ page }) => {
    const id = 'b1a2b3c4';
    const { rows, errors } = await fixture(page, width, { note_view: 'board', note_boards: [{ id, name: '국회 대응' }], note_board: id });
    await expect(chip(page, '국회 대응')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-nbb-side]')).toBeHidden();
    await expect(page.locator('[data-nb-empty]')).toHaveText('[+ 노트 붙이기]로 노트를 고르세요');
    await page.locator('[data-nbb] [data-nbb-pick]').tap();
    const dlg = page.locator('dialog.nbb-pick');
    await expect(dlg).toBeVisible();
    await dlg.locator('[data-nbb-pf]', { hasText: '회의' }).tap();
    await dlg.locator('[data-nbb-pn="n1"]').tap();
    await dlg.locator('[data-nbb-pick-find]').fill('나 노트');
    await dlg.locator('[data-nbb-pn="n2"]').tap();
    await expect(dlg.locator('[data-nbb-pick-ok]')).toHaveText('붙이기 2');
    // 창이 하단바에 가리지 않는다.
    const tabs = page.locator('.mobile-tabs');
    if (await tabs.count() && await tabs.isVisible()) expect((await dlg.boundingBox()).y + (await dlg.boundingBox()).height).toBeLessThanOrEqual((await page.viewportSize()).height);
    await dlg.locator('[data-nbb-pick-ok]').tap();
    await expect(dlg).toHaveCount(0);
    await expect(cards(page)).toHaveCount(2);
    await expect.poll(() => rows.filter(r => r.metadata.boards?.[id]).map(r => r.id).sort()).toEqual(['n1', 'n2']);
    // 꾹 누르기 → 메뉴.
    const c = await chip(page, '국회 대응').boundingBox();
    await page.touchscreen.tap(c.x + 5, c.y + 5); // 짧게 누르기는 그 보드 고르기
    await chip(page, '국회 대응').dispatchEvent('pointerdown', { pointerType: 'touch', clientX: c.x + 5, clientY: c.y + 5, isPrimary: true });
    await expect(page.locator('[data-nbb-menu] [data-nbb-rename]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-nbb-menu]')).toBeHidden();
    expect(errors).toEqual([]);
  });
}
