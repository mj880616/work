import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { checkSplit } from './helpers/split-check.mjs';
import { touchDrag } from './helpers/touch-drag.mjs';
// S48-28: 보드 이름은 공용 작은 글 입력창(.kptu-ask, app/small-notice.js askText)으로 묻는다. 글을 넣고 [확인]을 누른다.
async function answerText(page, value) {
  const ask = page.locator('.kptu-ask');
  await ask.waitFor({state: 'visible'});
  await ask.locator('.kptu-ask-field').fill(value);
  await ask.locator('.kptu-ask-actions button').nth(1).click();
  await ask.waitFor({state: 'detached'});
}

// NOTE-보드여러개 (요청함 10/30 05:48, 명진 결정 '위 추천안대로'): 보드 보기 위 [보드…] [+ 새 보드].
// S69-83(명진 11/24 23:55 "전체는 불필요함 걍 없애"): 모든 노트를 늘어놓던 [전체] 칸·판은 없다. 보드가 없으면 판 대신 빈 안내 한 줄.
// PC: 왼쪽 폴더·노트 목록에서 끌어 놓기로만 붙이기(S69-33: 누르기로는 붙지 않음), 이미 붙은 노트는 작은 '보드에 있음' 점, ×로 빼도 노트는 남음, 옮긴 자리는 metadata.boards[보드 id].
// 폰: [+ 노트 붙이기] 고르기 창, 보드 칸 꾹 누르기 메뉴 [이름 바꾸기] [보드 지우기]. 보드 목록·마지막 보드는 서버 화면 기억(view_prefs). 이름은 지어낸 것.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const F = '00000000-0000-4000-8000-000000000001', G = '00000000-0000-4000-8000-000000000002';
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
  // G: '회의' 아래 하위 폴더(노트 없음) — 왼쪽 목록에서 하위 폴더로 끌어 넣기 시험용.
  const folders = [{ id: F, workspace_id: 'w', parent_id: null, name: '회의', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: G, workspace_id: 'w', parent_id: F, name: '궤도', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' }];
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

test('PC: 보드 없음 = [+ 새 보드]와 빈 안내([전체] 없음) → 새 보드 → 왼쪽 목록에서 끌어 놓기로 붙이기 → 옮기기 → ×로 빼기 (1440)', async ({ page }) => {
  const { rows, writes, errors, server } = await fixture(page, 1440);
  // S69-83: [전체] 칸·모든 노트 판이 없다. 보드 칸 줄은 [+ 새 보드]뿐, 판(도구 줄 포함) 대신 빈 안내.
  await expect(page.locator('[data-nbb] .nbb-chip')).toHaveCount(0);
  await expect(page.locator('[data-nbb]')).not.toContainText('전체');
  await expect(page.locator('[data-nbw-none]')).toHaveText('보드가 없어요. [+ 새 보드]로 만들어 보세요.');
  await expect(page.locator('[data-note-board]')).toBeHidden();
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator('[data-nbb-side]')).toBeHidden();
  const bar = await page.locator('[data-nbb] [data-nbb-new]').boundingBox();
  expect(bar.height).toBeLessThanOrEqual(28);
  await page.locator('[data-nbb] [data-nbb-new]').click();
  await answerText(page, '국회 대응');
  await expect(chip(page, '국회 대응')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => boardId(server)).toMatch(/^b[0-9a-z]{8}$/);
  const id = boardId(server);
  await expect.poll(() => server.value?.note_board).toBe(id);
  expect(server.value.note_boards).toEqual([{ id, name: '국회 대응' }]);
  // 빈 판 한 줄, 왼쪽 좁은 목록(UI-칸폭끌기전수: 기본 16:84·최소 150px, 경계를 끌어 바꿈 — 아래 시험).
  await expect(cards(page)).toHaveCount(0);
  await expect(page.locator('[data-nb-empty]')).toHaveText('왼쪽 노트를 끌어다 놓으세요');
  const side = page.locator('[data-nbb-side]');
  await expect(side).toBeVisible();
  const sideWidth = Math.round((await side.boundingBox()).width);
  expect(sideWidth).toBeGreaterThanOrEqual(150); expect(sideWidth).toBeLessThan(260);
  await side.locator('[data-nbb-folder]', { hasText: '회의' }).click();
  await side.locator('[data-nbb-folder]', { hasText: '폴더 없음' }).click();
  await expect(side.locator('[data-nbb-note]')).toHaveCount(3);
  // 끌어 놓기: 놓은 곳에 붙는다.
  await side.locator('[data-nbb-note="n1"]').dragTo(page.locator('[data-nb-scroll]'), { targetPosition: { x: 400, y: 300 } });
  await expect(cards(page)).toHaveCount(1);
  await expect.poll(() => rows[0].metadata.boards?.[id]).toBeTruthy();
  expect(rows[0].metadata.board).toEqual({ x: 24, y: 24, r: 1, z: 0 }); // 옛 [전체] 자리 값은 지우지 않는다
  // S69-33: 이미 붙은 줄은 흐리게가 아니라 보통 진하기 + 작은 점('보드에 있음').
  const onRow = side.locator('[data-nbb-note="n1"]');
  await expect(onRow).toHaveAttribute('data-nbb-on', '');
  await expect(onRow.locator('.nbb-dot')).toBeVisible();
  expect(await onRow.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
  await expect(onRow).not.toHaveAttribute('title', /./); // S70-79: 쓰는 법 안내 title 없음
  // 끌어 놓기로만 붙는다(놓은 자리마다).
  await side.locator('[data-nbb-note="n2"]').dragTo(page.locator('[data-nb-scroll]'), { targetPosition: { x: 600, y: 300 } });
  await side.locator('[data-nbb-note="n3"]').dragTo(page.locator('[data-nb-scroll]'), { targetPosition: { x: 400, y: 460 } });
  await expect(cards(page)).toHaveCount(3);
  await expect.poll(() => rows.filter(r => r.metadata.boards?.[id]).length).toBe(3);
  for (const w of writes) expect(w.body.updated_at).toBeUndefined();
  // 옮기기 → metadata.boards[id]만 바뀐다.
  const card = page.locator('[data-nb-card="n2"]'), box = await card.boundingBox(), before = structuredClone(rows[1].metadata.boards[id]);
  await page.mouse.move(box.x + 40, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 120, { steps: 6 }); await page.mouse.move(box.x + 200, box.y + 160, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => rows[1].metadata.boards[id].x).not.toBe(before.x);
  expect(rows[1].metadata.board).toBeUndefined();
  // ×로 빼기: 노트는 남는다.
  // S68-38: ×·⋯는 고른 카드(PC는 마우스를 올린 카드)에서만 보인다.
  await page.locator('[data-nb-card="n3"]').hover();
  await page.locator('[data-nb-card="n3"] [data-nb-remove]').click();
  await expect(cards(page)).toHaveCount(2);
  await expect.poll(() => rows[2].metadata.boards?.[id]).toBeUndefined();
  await expect(side.locator('[data-nbb-note="n3"]')).not.toHaveAttribute('data-nbb-on');
  // ⋯ 메뉴 [보드에서 빼기]
  await page.locator('[data-nb-card="n2"]').hover();
  await page.locator('[data-nb-card="n2"] [data-note-row-more]').click();
  await page.locator('#noteDocMenu [data-nbb-detach]').click();
  await expect(cards(page)).toHaveCount(1);
  await expect(page.locator('[data-nbw-none]')).toBeHidden();
  // 다시 보드: 붙은 칸 자리 그대로(다른 보기 갔다 와도).
  const left = await page.locator('[data-nb-card="n1"]').evaluate(n => n.style.left);
  await page.locator('.nv-switch [data-note-view="list"]').click(); await page.locator('.nv-switch [data-note-view="board"]').click();
  await expect(chip(page, '국회 대응')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-nb-card="n1"]')).toHaveCSS('left', left);
  expect(errors).toEqual([]);
});

test('PC: 서버에 기억한 마지막 보드로 열리고, 보드 칸 우클릭 메뉴로 이름 바꾸기·삭제(노트는 그대로) (1440)', async ({ page }) => {
  const id = 'b1a2b3c4';
  const { rows, errors, server } = await fixture(page, 1440, { note_view: 'board', note_boards: [{ id, name: '교섭' }], note_board: id });
  await expect(chip(page, '교섭')).toHaveAttribute('aria-pressed', 'true');
  await expect(cards(page)).toHaveCount(0);
  await page.locator('[data-nbb-side] [data-nbb-folder]', { hasText: '폴더 없음' }).click();
  await page.locator('[data-nbb-side] [data-nbb-note="n2"]').dragTo(page.locator('[data-nb-scroll]'), { targetPosition: { x: 400, y: 300 } });
  await expect(cards(page)).toHaveCount(1);
  await expect.poll(() => rows[1].metadata.boards?.[id]).toBeTruthy();
  await chip(page, '교섭').click({ button: 'right' });
  await page.locator('[data-nbb-menu] [data-nbb-rename]').click();
  await answerText(page, '교섭 대응');
  await expect(chip(page, '교섭 대응')).toBeVisible();
  await expect.poll(() => server.value?.note_boards?.[0]?.name).toBe('교섭 대응');
  await chip(page, '교섭 대응').click({ button: 'right' });
  await page.locator('[data-nbb-menu] [data-nbb-delete]').click();
  await page.locator('.kptu-ask .danger').click();
  // S69-83: 마지막 보드를 지우면 [전체]로 가지 않고 빈 안내.
  await expect(page.locator('[data-nbb] .nbb-chip')).toHaveCount(0);
  await expect(page.locator('[data-nbw-none]')).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await expect.poll(() => server.value?.note_boards).toEqual([]);
  await expect.poll(() => rows[1].metadata.boards).toBeUndefined();
  expect(rows.length).toBe(3);
  expect(errors).toEqual([]);
});

test('PC: 왼쪽 노트 목록·빈 보드 우클릭은 브라우저 메뉴 대신 웹2 메뉴, 노트 줄 메뉴에 [보드에 붙이기] (1440)', async ({ page }) => {
  const id = 'b1a2b3c4';
  const { rows, errors } = await fixture(page, 1440, { note_view: 'board', note_boards: [{ id, name: '교섭' }], note_board: id });
  await page.locator('[data-nbb-side] [data-nbb-folder]', { hasText: '폴더 없음' }).click();
  const menu = page.locator('#noteDocMenu');
  await page.locator('[data-nbb-side] [data-nbb-note="n2"]').click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-nbb-attach]')).toHaveText('보드에 붙이기');
  await menu.locator('[data-nbb-attach]').click();
  await expect(cards(page)).toHaveCount(1);
  await expect.poll(() => rows[1].metadata.boards?.[id]).toBeTruthy();
  await page.locator('[data-nbb-side] [data-nbb-folder]', { hasText: '폴더 없음' }).click({ button: 'right' });
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('[data-note-board]').click({ button: 'right', position: { x: 600, y: 400 } });
  await expect(menu.locator('[data-nbb-newnote]')).toHaveText('새 노트 쓰기');
  expect(errors).toEqual([]);
});

// S69 보드목록폴더놓기(요청함 '여기서 노트를 드래그해서 폴더로 못넣음'): 왼쪽 목록의 노트를 폴더 줄에 놓으면 그 폴더로 옮긴다.
// 끄는 동안 놓을 폴더 줄은 옅은 바탕, 개수는 바로 바뀌고, 판에 끌어 놓기는 그대로. 이미 붙은 노트도 폴더로는 옮길 수 있다.
test('PC: 보드 왼쪽 목록에서 노트를 하위 폴더·폴더 없음에 끌어 넣기, 판 놓기는 그대로 (1440)', async ({ page }) => {
  const id = 'b1a2b3c4';
  const { rows, errors } = await fixture(page, 1440, { note_view: 'board', note_boards: [{ id, name: '교섭' }], note_board: id });
  const side = page.locator('[data-nbb-side]'), folderRow = name => side.locator('[data-nbb-folder]', { hasText: name });
  await folderRow('회의').click();
  await folderRow('폴더 없음').click();
  await expect(folderRow('궤도')).toBeVisible();
  await expect(folderRow('궤도').locator('.nbb-num')).toHaveText('0');
  // 끄는 동안: 놓을 폴더 줄 강조, 지금 든 폴더(폴더 없음)는 강조하지 않음.
  // 마우스로 브라우저 끌기: 누른 채 조금 움직여 시작 → 폴더 줄로(자리 알림은 다음 움직임에서 따라오므로 끝에서 한 번 더 움직임).
  const dragOver = async (from, to) => {
    const a = await from.boundingBox(), b = await to.boundingBox();
    await page.mouse.move(a.x + 20, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(a.x + 24, a.y + a.height / 2 - 6, { steps: 3 });
    await page.mouse.move(b.x + 30, b.y + b.height / 2, { steps: 6 });
    await page.mouse.move(b.x + 34, b.y + b.height / 2, { steps: 2 });
  };
  await dragOver(side.locator('[data-nbb-note="n2"]'), folderRow('궤도'));
  await expect(folderRow('궤도')).toHaveClass(/nx-drop/);
  await expect(side.locator('.nbb-folder.nx-drop')).toHaveCount(1);
  await page.mouse.up();
  await expect(side.locator('.nbb-folder.nx-drop')).toHaveCount(0);
  await expect.poll(() => rows[1].metadata.folder_id).toBe(G);
  expect(rows[1].metadata.folder).toBe('궤도');
  await expect(folderRow('궤도').locator('.nbb-num')).toHaveText('1');
  await expect(cards(page)).toHaveCount(0); // 폴더로 옮기기는 판에 붙이지 않는다
  // 판 놓기는 그대로.
  await side.locator('[data-nbb-note="n1"]').dragTo(page.locator('[data-nb-scroll]'), { targetPosition: { x: 400, y: 300 } });
  await expect(cards(page)).toHaveCount(1);
  await expect.poll(() => rows[0].metadata.boards?.[id]).toBeTruthy();
  // 이미 붙은 노트(n1, '회의')도 하위 폴더로 옮길 수 있고, 보드 자리는 그대로. 지금 든 폴더('회의')는 강조하지 않는다.
  // ('폴더 없음' 줄은 그 안 노트가 없어져 목록에서 사라진다.)
  await expect(folderRow('폴더 없음')).toHaveCount(0);
  await expect(side.locator('[data-nbb-note="n1"]')).toHaveAttribute('data-nbb-on', '');
  await dragOver(side.locator('[data-nbb-note="n1"]'), side.locator('[data-nbb-folder]', { hasText: /^회의/ }));
  await expect(side.locator('.nbb-folder.nx-drop')).toHaveCount(0);
  const sub = await folderRow('궤도').boundingBox(); // 같은 끌기로 이어서 하위 폴더로
  await page.mouse.move(sub.x + 30, sub.y + sub.height / 2, { steps: 4 }); await page.mouse.move(sub.x + 34, sub.y + sub.height / 2, { steps: 2 });
  await expect(folderRow('궤도')).toHaveClass(/nx-drop/);
  await page.mouse.up();
  await expect.poll(() => rows[0].metadata.folder_id).toBe(G);
  await expect(folderRow('궤도').locator('.nbb-num')).toHaveText('2');
  expect(rows[0].metadata.boards?.[id]).toBeTruthy();
  await expect(cards(page)).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('넓은 터치 화면: 보드 왼쪽 목록 노트를 꾹 눌러 끌어 하위 폴더에 넣기, 짧게 누르기는 붙이지 않고 노트 열기 (1024)', async ({ page }) => {
  const id = 'b1a2b3c4';
  const { rows, errors } = await fixture(page, 1024, { note_view: 'board', note_boards: [{ id, name: '교섭' }], note_board: id });
  const side = page.locator('[data-nbb-side]'), folderRow = name => side.locator('[data-nbb-folder]', { hasText: name });
  await expect(side).toBeVisible();
  await folderRow('회의').click();
  await folderRow('폴더 없음').click();
  await touchDrag(page, side.locator('[data-nbb-note="n3"]'), folderRow('궤도'), { before: async () => { await expect(folderRow('궤도')).toHaveClass(/nx-drop/); } });
  await expect.poll(() => rows[2].metadata.folder_id).toBe(G);
  await expect(folderRow('궤도').locator('.nbb-num')).toHaveText('1');
  await expect(cards(page)).toHaveCount(0);
  await page.waitForTimeout(700); // 끌기 뒤 따라오는 누르기 삼킴이 끝난 뒤
  // S69-33: 짧게 누르기는 붙이지 않는다(붙이기는 끌어 놓기·[+ 노트 붙이기]만) — 아직 안 붙은 노트는 노트 열기.
  await side.locator('[data-nbb-note="n2"]').tap();
  await expect(page.locator('[data-note-detail]')).toBeVisible();
  expect(rows[1].metadata.boards).toBeUndefined();
  expect(errors).toEqual([]);
});

for (const width of [412, 760]) {
  test(`폰: [+ 노트 붙이기] 선택 창으로 붙이기, 꾹 누르기 메뉴 (${width})`, async ({ page }) => {
    const id = 'b1a2b3c4';
    const { rows, errors } = await fixture(page, width, { note_view: 'board', note_boards: [{ id, name: '국회 대응' }], note_board: id });
    await expect(chip(page, '국회 대응')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-nbb-side]')).toBeHidden();
    await expect(page.locator('[data-nb-empty]')).toHaveText('[+ 노트 붙이기]로 노트를 선택하세요');
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

// UI-칸폭끌기전수(요청함 10/30 10:29): PC 이름 붙은 보드의 노트 목록 | 보드 사이 경계를 끌어 폭을 바꾸고, 폭은 서버(view_prefs.split_ratio.noteboard)에 기억한다.
test('PC 1440: 노트 목록 | 보드 경계 끌기·키보드·새로고침 유지·두 번 눌러 기본', async ({ page }) => {
  const id = 'b1a2b3c4';
  const { errors, server } = await fixture(page, 1440, { note_view: 'board', note_boards: [{ id, name: '국회 대응' }], note_board: id });
  const side = page.locator('[data-nbb-side]');
  // 새로고침 직후에는 사이드바가 아직 없을 수 있어(그러면 도우미가 폰 메뉴를 찾는다) 사이드바 [노트] 줄부터 기다린다.
  const open = async () => { await expect(page.locator('#appView > .app-nav [data-basket-kind-nav="note"]')).toBeVisible(); await chooseBasketKind(page, 'note'); await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3'); await expect(side).toBeVisible(); };
  await expect(side).toBeVisible();
  await checkSplit(page, { container: '[data-note-list] .nbw-body', left: ':scope>[data-nbb-side]', right: ':scope>[data-nbw-main]', name: 'noteboard', share: 0.16, server, reopen: open });
  expect(errors).toEqual([]);
});

test('S69-83: 화면 기억에 옛 값 [전체](all)가 남아 있어도 무시하고 가장 최근 보드로 연다 — [전체] 칸 없음 (1440)', async ({ page }) => {
  const a = 'b1a2b3c4', b = 'bq0q0q0q';
  const { errors } = await fixture(page, 1440, { note_view: 'board', note_boards: [{ id: a, name: '교섭' }, { id: b, name: '국회 대응' }], note_board: 'all' });
  await expect(page.locator('[data-nbb] .nbb-chip')).toHaveCount(2);
  await expect(page.locator('[data-nbb]')).not.toContainText('전체');
  await expect(chip(page, '국회 대응')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-nbw-none]')).toBeHidden();
  await expect(page.locator('[data-nb-empty]')).toHaveText('왼쪽 노트를 끌어다 놓으세요');
  // 옛 metadata.board 자리가 있는 노트(n1)도 이 보드에 붙지 않았으면 판에 없다.
  await expect(cards(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

// NOTE-보드목록음영(S70-79, 명진 11/26 09:02 "노트 보드화면에서 노트위에 커서 올리면 또 회색 노란 색 배경 음영"):
// PC 보드 왼쪽 노트 목록 줄에 마우스를 올리면 — 줄 바탕은 다른 목록(노트·[파일] 폴더 나무 .ft-main·.nx-main)과 같은 공용 마우스 올림 색
// (--kptu-surface-subtle) 하나, 커서 밑에 노란(밑줄·형광펜·끌기 조각) 칸이 없고, 쓰는 법 안내 title 말풍선이 없다(이름 칸 title = 전체 이름만, 표준 L2).
test('PC 1280: 보드 노트 목록 줄 마우스 올림 = 공용 색 하나 · 노란 칸 없음 · 안내 title 없음', async ({ page }) => {
  const id = 'b1a2b3c4';
  const { errors } = await fixture(page, 1280, { note_view: 'board', note_boards: [{ id, name: '교섭' }], note_board: id });
  const side = page.locator('[data-nbb-side]');
  await side.locator('[data-nbb-folder]', { hasText: '폴더 없음' }).click();
  const row = side.locator('[data-nbb-note="n2"]');
  await expect(row).toBeVisible();
  // 안내 말풍선 없음: 줄·보드 칸·목록 어디에도 쓰는 법 title이 없다. 이름 칸은 전체 이름.
  await expect(row).not.toHaveAttribute('title', /./);
  await expect(row.locator('.nbb-name')).toHaveAttribute('title', '나 노트');
  await expect(chip(page, '교섭')).not.toHaveAttribute('title', /./);
  expect(await side.evaluate(el => [...el.querySelectorAll('[title]')].map(x => x.title).filter(t => /끌어|누르면|우클릭|놓으면/.test(t)))).toEqual([]);
  const bb = await row.boundingBox();
  await page.mouse.move(bb.x + 4, bb.y + 4);
  await page.mouse.move(bb.x + 30, bb.y + bb.height / 2, { steps: 4 });
  await page.waitForTimeout(250);
  const look = await page.evaluate(({ x, y }) => {
    const probe = document.createElement('div'); probe.style.background = 'var(--kptu-surface-subtle)';
    document.querySelector('#appView').append(probe); const common = getComputedStyle(probe).backgroundColor; probe.remove();
    const r = document.querySelector('[data-nbb-side] [data-nbb-note="n2"]');
    const clear = c => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';
    const sideBg = getComputedStyle(document.querySelector('[data-nbb-side]')).backgroundColor;
    // 커서 자리에 겹친 칸: 줄(공용 색)·목록 칸 바탕 말고 다른 바탕이 없어야 한다.
    const stack = document.elementsFromPoint(x, y).filter(e => e.closest('[data-nbb-side]') || e.matches('.td-ghost,mark'))
      .map(e => getComputedStyle(e).backgroundColor).filter(c => !clear(c));
    const inner = [...r.querySelectorAll('*')].map(e => getComputedStyle(e).backgroundColor).filter(c => !clear(c));
    return { common, row: getComputedStyle(r).backgroundColor, sideBg, stack, inner,
      marks: document.querySelectorAll('[data-nbb-side] mark, mark.hl-mark, .td-ghost, [data-drag-ghost]').length };
  }, { x: bb.x + 30, y: bb.y + bb.height / 2 });
  expect(look.row).toBe(look.common);
  expect(look.inner).toEqual([]);
  expect(look.marks).toBe(0);
  expect(look.stack.filter(c => c !== look.common && c !== look.sideBg)).toEqual([]);
  expect(errors).toEqual([]);
});
