import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { checkSplit } from './helpers/split-check.mjs';
import { folderSheet, pickInSheet } from './helpers/folder-sheet.mjs';
// S48-28: 폴더 이름은 공용 작은 글 입력창(.kptu-ask, app/small-notice.js askText)으로 묻는다. 글을 넣고 [확인]을 누른다.
async function answerText(page, value) {
  const ask = page.locator('.kptu-ask');
  await ask.waitFor({state: 'visible'});
  await ask.locator('.kptu-ask-field').fill(value);
  await ask.locator('.kptu-ask-actions button').nth(1).click();
  await ask.waitFor({state: 'detached'});
}

// NOTE-탐색기 (2026-10-28 09:24·10:34·11:01): the note list is a folder tree (app_note_folders, migration 20261028170000).
// 10/28 17:45·17:55 화면 정리: PC = 왼쪽 폴더 나무(맨 아래 '폴더 없음' + [+ 새 폴더]) · 오른쪽은 고른 폴더의 노트만 한 줄씩(위에 '이름 · 장수').
// FOLDER-나무새기준(S51-12): 폰 = 첫 화면 나무(폴더를 누르면 그 자리에서 펼침), 두 손가락 벌리기 = 그 폴더만('‹ 노트 › 이름 · 장수', 하위 폴더 줄 먼저),
// [‹]·오므리기·갤럭시 뒤로가기 = 펼친 자리 그대로 나무.
// Notes without a folder sit in '🗂 폴더 없음'. A note written before the table keeps its folder by name (top folder of the same name).
// Row ⋯ / right-click = one menu with [선택] on top (phone long-press picks the row, S69); select mode moves several at once; every move has [되돌리기].
// Phone 390 and PC 1280. Names are made up.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture(page, width, {table = true, more = [], longRow = false} = {}) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  const row = (id, title, updated_at, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문', occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
  const rows = [
    row('n1', '가 노트', '2026-10-16T01:00:00Z', { tasks: [{ task_id: 't1' }] }),
    row('n2', '나 노트', '2026-10-12T01:00:00Z', { folder: '회의' }),
    row('n3', '다 노트', '2026-10-10T01:00:00Z'),
  ];
  if (longRow) rows[0] = row('n1', '아주 긴 제목의 노트입니다 '.repeat(10), '2026-10-16T01:00:00Z', { folder: '회의' });
  const folders = [{ id: U(1), workspace_id: 'w', parent_id: null, name: '회의', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' }, ...more];
  let seq = 10;
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id')) && (!q.get('updated_at') || 'eq.' + x.updated_at === q.get('updated_at'));
    if (req.method() === 'GET') return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)).map(x => structuredClone(x)) });
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push({ table: 'notes', id: (q.get('id') || '').slice(3), body }); const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, structuredClone(body))); return r.fulfill({ json: hit.map(x => structuredClone(x)) }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', async r => {
    if (!table) return r.fulfill({ status: 404, json: { code: 'PGRST205', message: "Could not find the table 'public.app_note_folders'" } });
    const req = r.request(), q = new URL(req.url()).searchParams, id = (q.get('id') || '').slice(3);
    if (req.method() === 'GET') return r.fulfill({ json: structuredClone(folders) });
    if (req.method() === 'POST') { const body = req.postDataJSON(); writes.push({ table: 'folders', method: 'POST', body }); const x = { id: body.id || U(++seq), created_at: '2026-10-28T00:00:00Z', ...body }; folders.push(x); return r.fulfill({ status: 201, json: [structuredClone(x)] }); }
    if (req.method() === 'PATCH') { const body = req.postDataJSON(); writes.push({ table: 'folders', method: 'PATCH', id, body }); const x = folders.find(f => f.id === id); Object.assign(x, body); return r.fulfill({ json: [structuredClone(x)] }); }
    if (req.method() === 'DELETE') { writes.push({ table: 'folders', method: 'DELETE', id }); const i = folders.findIndex(f => f.id === id); const [x] = folders.splice(i, 1); folders.forEach(f => { if (f.parent_id === id) f.parent_id = x.parent_id; }); return r.fulfill({ json: [{ id }] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3');
  return { rows, folders, writes, errors };
}
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
// S69-62: 폴더 고르기 = [파일] '옮길 곳' 창과 같은 창(줄 누르기 = 고르기·펼치기, [여기에 옮기기]로만 옮김).
const picker = page => folderSheet(page);
const noteRow = (page, id) => page.locator(`#noteRows [data-note-row="${id}"]`);
// Shows the notes of folder id: phone and PC both enter it from the row's ⋯ menu [이 폴더로 들어가기] (S69-99: two fingers change the row size).
async function showFolder(page, width, id) {
  if (width>=761) { await press(page, page.locator(`[data-nx-tree] [data-nx-folder-more="${id}"]`), width); await page.locator('#noteDocMenu [data-nx-enter]').click(); } // UI-폴더누르기한규칙: 나무 누르기 = 펼침만, 들어가기 = ⋯ 메뉴
  else { await press(page, page.locator(`#noteRows [data-nx-folder-more="${id}"]`), width); await page.locator('#noteDocMenu [data-nx-enter]').click(); await expect(page.locator('#noteRows [data-nx-focus]')).toBeVisible(); }
}
// '폴더 없음' 노트: PC는 처음부터 오른쪽에 보인다(나무의 '폴더 없음'이 고른 곳), 폰은 첫 화면 맨 아래 '폴더 없음'을 눌러 들어간다.
async function showOutside(page, width) {
  // NOTE-최근5개: PC는 처음 '최근'이 고른 곳이라 나무의 '폴더 없음'을 눌러 연다.
  if (width>=761) { await press(page, page.locator('[data-nx-tree] [data-nx-open="out"]'), width); await expect(page.locator('[data-nx-tree] [data-nx-outside]')).toHaveClass(/ft-current/); }
  else { await press(page, page.locator('#noteRows [data-nx-outside] [data-nx-folder-more]'), width); await page.locator('#noteDocMenu [data-nx-enter]').click(); }
  await expect(here(page)).toContainText('폴더 없음');
}
// S51-24: 폰 '그 폴더만'은 이름·개수가 상자 머리(#noteRows [data-nx-focus] .ft-focus-head), 넓은 화면은 위 줄(data-nx-here).
const here = page => page.locator(':is([data-nx-here]:not([hidden]), #noteRows [data-nx-focus] .ft-focus-head)');

for (const width of [390, 1280]) test(`folder tree: old folder by name, 폴더 없음, move with the shared picker and undo ${width}`, async ({ page }) => {
  const f = await fixture(page, width);
  // The old folder (metadata.folder '회의', no id) is the top folder of that name; the others are in 폴더 없음 (at the bottom).
  await expect(page.locator(`[data-nx-folder="${U(1)}"]`).first()).toContainText('회의');
  await expect(page.locator(`[data-nx-folder="${U(1)}"] .ft-num`).first()).toHaveText('1');
  await expect(page.locator('[data-nx-outside]').first()).toContainText('폴더 없음');
  await expect(page.locator('[data-note-row] .basket-preview')).toHaveCount(0);
  // 17:45 ③: no copy icon on the rows.
  await expect(page.locator('[data-note-row-copy], .basket-row-copy')).toHaveCount(0);
  if (width>=761) {
    // PC: folders only in the left tree (none on the right). NOTE-최근5개: the tree starts with '최근' (picked first), the right shows
    // the latest changed notes of every folder with '최근 · 3' above and the folder name on the row.
    await expect(page.locator('#noteRows [data-nx-folder]')).toHaveCount(0);
    await expect(page.locator('[data-nx-tree] .ft-row').first()).toHaveAttribute('data-nx-recent-item', '');
    await expect(page.locator('[data-nx-tree] [data-nx-recent-item]')).toHaveClass(/ft-current/);
    await expect(here(page)).toHaveText('최근 · 3');
    await expect(page.locator('[data-nx-tree] [data-nx-new-top]')).toHaveText('+ 새 폴더');
    await expect(page.locator('#noteRows [data-note-row]')).toHaveCount(3);
    await expect(noteRow(page, 'n2').locator('[data-nx-recent-folder]')).toContainText('회의');
    await press(page, page.locator('[data-nx-tree] [data-nx-open="out"]'), width);
    await expect(here(page)).toHaveText('폴더 없음 · 2');
    await expect(noteRow(page, 'n1')).toBeVisible(); await expect(noteRow(page, 'n3')).toBeVisible();
    await expect(noteRow(page, 'n2')).toHaveCount(0);
  } else {
    // Phone first screen: '최근' (latest changed notes, every folder) above the folder list; the list itself has no note rows, 폴더 없음 last, then [+ 새 폴더].
    await expect(page.locator('[data-nx-recent] [data-note-row]')).toHaveCount(3);
    await expect(page.locator('#noteRows [data-note-row]')).toHaveCount(0);
    await expect(page.locator('#noteRows > *').last()).toHaveText('+ 새 폴더');
    await expect(here(page)).toBeHidden();
  }
  await showFolder(page, width, U(1));
  await expect(noteRow(page, 'n2')).toBeVisible();
  await expect(noteRow(page, 'n1')).toHaveCount(0);
  await expect(here(page)).toContainText(width < 761 ? '회의 노트 1' : '회의 · 1');
  if (width<761) { await page.goBack(); await expect(page.locator(`#noteRows [data-nx-folder="${U(1)}"]`)).toBeVisible(); await expect(here(page)).toBeHidden(); }
  else await press(page, page.locator('[data-nx-tree] [data-nx-open="out"]'), width);
  await showOutside(page, width);
  // Row ⋯: [선택] first, [복사] in the menu, then [폴더로 옮기기] opens the shared folder list; the note gets the folder id and name, nothing else changes.
  await press(page, page.locator('[data-note-row-more="n1"]'), width);
  await expect(page.locator('#noteDocMenu button')).toHaveText(['선택', '복사', '고정', '폴더로 옮기기', '수정', '공유 링크 만들기', '알림 걸기…', '서식으로 저장', '하루 기록으로 보내기', '삭제']);
  await press(page, page.locator('#noteDocMenu [data-note-folder-move]'), width);
  await expect(picker(page)).toBeVisible();
  await pickInSheet(page, ['회의']);
  await expect(picker(page)).toHaveCount(0);
  await expect.poll(() => f.writes.filter(x => x.table === 'notes').length).toBe(1);
  const w = f.writes.filter(x => x.table === 'notes');
  expect(w[0].body).toEqual({ metadata: { tasks: [{ task_id: 't1' }], folder_id: U(1), folder: '회의' } });
  expect(f.rows.find(r => r.id === 'n1').updated_at).toBe('2026-10-16T01:00:00Z');
  await expect(page.locator('#kptuNotice')).toContainText('옮겼어요 1개');
  await expect(here(page)).toContainText(width < 761 ? '폴더 없음 노트 1' : '폴더 없음 · 1');
  if (width>=761) await expect(page.locator(`[data-nx-tree] [data-nx-folder="${U(1)}"] .ft-num`)).toHaveText('2');
  // [되돌리기] puts it back in 폴더 없음.
  await press(page, page.locator('#kptuNotice .kptu-notice-undo'), width);
  await expect.poll(() => f.rows.find(r => r.id === 'n1').metadata).toEqual({ tasks: [{ task_id: 't1' }] });
  await expect(here(page)).toContainText(width < 761 ? '폴더 없음 노트 2' : '폴더 없음 · 2');
  expect(f.errors).toEqual([]);
});

for (const width of [390, 1280]) test(`select mode: [선택] → pick rows → move together → mode ends; Esc ends it ${width}`, async ({ page }) => {
  const f = await fixture(page, width);
  await showOutside(page, width);
  await press(page, page.locator('[data-note-row-more="n1"]'), width);
  await press(page, page.locator('#noteDocMenu [data-nx-select]'), width);
  await expect(page.locator('[data-nx-select-bar]')).toBeVisible();
  await expect(page.locator('[data-nx-select-count]')).toHaveText('1개 선택됨');
  // In select mode pressing a row picks it (it does not open).
  await press(page, noteRow(page, 'n3'), width);
  await expect(page.locator('[data-nx-select-count]')).toHaveText('2개 선택됨');
  await expect(page.locator('[data-note-detail]')).toBeHidden();
  // S69(명진 11/24 "선택된거 클릭하면 선택해제"): 고른 줄을 다시 누르면 풀리고, 또 누르면 다시 골라진다(자료실과 같은 규칙).
  await press(page, noteRow(page, 'n3'), width);
  await expect(page.locator('[data-nx-select-count]')).toHaveText('1개 선택됨');
  await press(page, noteRow(page, 'n3'), width);
  await expect(page.locator('[data-nx-select-count]')).toHaveText('2개 선택됨');
  await press(page, page.locator('[data-nx-select-bar] [data-nx-sel-move]'), width);
  await pickInSheet(page, ['회의']);
  await expect(page.locator('[data-nx-select-bar]')).toBeHidden();
  await expect(page.locator('#kptuNotice')).toContainText('옮겼어요 2개');
  expect(f.rows.filter(r => r.metadata.folder_id === U(1)).map(r => r.id).sort()).toEqual(['n1', 'n3']);
  // Esc leaves select mode without writing.
  const before = f.writes.length;
  await press(page, page.locator('[data-note-folder-more]'), width);
  await press(page, page.locator('#noteDocMenu [data-nx-select]'), width);
  await expect(page.locator('[data-nx-select-bar]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-nx-select-bar]')).toBeHidden();
  expect(f.writes.length).toBe(before);
  expect(f.errors).toEqual([]);
});

for (const width of [390, 1280]) test(`new folder inside a folder, delete moves its notes one level up, undo makes it again ${width}`, async ({ page }) => {
  const f = await fixture(page, width);
  // Folder ⋯ → [새 폴더] (inside), then move 나 노트 (old by-name folder) into the new one through the picker.
  await press(page, page.locator(`#noteRows [data-nx-folder-more="${U(1)}"], [data-nx-tree] [data-nx-folder-more="${U(1)}"]`).first(), width);
  await press(page, page.locator('#noteDocMenu [data-nx-new-in]'), width);
  await answerText(page, '하위');
  await expect.poll(() => f.folders.map(x => x.name)).toEqual(['회의', '하위']);
  const sub = f.folders[1];
  expect(sub.parent_id).toBe(U(1));
  await showFolder(page, width, U(1));
  // Phone: the sub folder row comes first in 회의's screen, before its notes.
  if (width<761) await expect(page.locator('#noteRows .ft-box-body > *').first()).toHaveAttribute('data-nx-folder', sub.id);
  // S69-27: PC 왼쪽 나무에도 펼친 폴더의 노트 줄이 있어 오른쪽 목록 줄을 고른다.
  await press(page, page.locator('#noteRows [data-note-row-more="n2"]'), width);
  await press(page, page.locator('#noteDocMenu [data-note-folder-move]'), width);
  await pickInSheet(page, ['회의', '하위']);
  await expect.poll(() => f.rows.find(r => r.id === 'n2').metadata).toEqual({ folder_id: sub.id, folder: '하위' });
  // Delete the sub folder: its note goes up to 회의 (not deleted); [되돌리기] makes the folder again with the same id.
  await press(page, page.locator(`[data-nx-folder-more="${sub.id}"]`).first(), width);
  await press(page, page.locator('#noteDocMenu [data-nx-delete-folder]'), width);
  await press(page, page.locator('.kptu-ask button', { hasText: '삭제' }), width);
  await expect.poll(() => f.folders.map(x => x.name)).toEqual(['회의']);
  expect(f.rows.find(r => r.id === 'n2').metadata).toEqual({ folder_id: U(1), folder: '회의' });
  await press(page, page.locator('#kptuNotice .kptu-notice-undo'), width);
  await expect.poll(() => f.folders.map(x => x.id)).toEqual([U(1), sub.id]);
  await expect.poll(() => f.rows.find(r => r.id === 'n2').metadata.folder_id).toBe(sub.id);
  expect(f.rows.length).toBe(3);
  expect(f.errors).toEqual([]);
});

// S67-34: 들어간 폴더의 위 ⋯에 [이 폴더 삭제] — 폴더 ⋯의 [폴더 삭제]와 같은 길(안의 노트는 한 단 위로, 삭제하지 않음), 삭제 뒤 위 폴더로.
// 맨 위 '노트'(들어간 폴더 없음)에서는 이 항목이 메뉴에 없다.
for (const width of [390, 1280]) test(`entered folder head ⋯ [이 폴더 삭제] → notes go up, lands on the parent; not at the top ${width}`, async ({ page }) => {
  const sub = { id: U(2), workspace_id: 'w', parent_id: U(1), name: '하위', sort_order: 1024, created_at: '2026-10-02T00:00:00Z' };
  const f = await fixture(page, width, { more: [sub] });
  // 맨 위: 항목 없음(렌더 안 함).
  await press(page, page.locator('[data-note-folder-more]'), width);
  await expect(page.locator('#noteDocMenu [data-nx-select]')).toBeVisible();
  await expect(page.locator('#noteDocMenu [data-nx-delete-folder]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#noteDocMenu')).toBeHidden();
  // 나 노트를 하위로 옮겨 둔다(폴더 ⋯ 경로와 같은 picker).
  await showFolder(page, width, U(1));
  // S69-27: PC 왼쪽 나무에도 펼친 폴더의 노트 줄이 있어 오른쪽 목록 줄을 고른다.
  await press(page, page.locator('#noteRows [data-note-row-more="n2"]'), width);
  await press(page, page.locator('#noteDocMenu [data-note-folder-move]'), width);
  await pickInSheet(page, ['회의', '하위']);
  await expect.poll(() => f.rows.find(r => r.id === 'n2').metadata.folder_id).toBe(sub.id);
  // 하위로 들어간다.
  if (width >= 761) { await press(page, page.locator(`[data-nx-tree] [data-nx-folder-more="${sub.id}"]`), width); await page.locator('#noteDocMenu [data-nx-enter]').click(); }
  else { await press(page, page.locator(`#noteRows [data-nx-folder-more="${sub.id}"]`).first(), width); await press(page, page.locator('#noteDocMenu [data-nx-enter]'), width); }
  await expect(here(page)).toContainText('하위');
  await press(page, page.locator('[data-note-folder-more]'), width);
  const del = page.locator('#noteDocMenu [data-nx-delete-folder]');
  await expect(del).toHaveText('이 폴더 삭제');
  await press(page, del, width);
  await expect(page.locator('.kptu-ask')).toContainText('노트 1개·폴더 0개');
  await press(page, page.locator('.kptu-ask button', { hasText: '삭제' }), width);
  await expect.poll(() => f.folders.map(x => x.name)).toEqual(['회의']);
  expect(f.rows.find(r => r.id === 'n2').metadata).toEqual({ folder_id: U(1), folder: '회의' });
  expect(f.rows.length).toBe(3);
  // 위 폴더(회의)로 와 있고, 주소도 회의.
  await expect(here(page)).toContainText('회의');
  await expect.poll(() => new URL(page.url()).searchParams.get('folder')).toBe(U(1));
  await expect(noteRow(page, 'n2')).toBeVisible();
  expect(f.errors).toEqual([]);
});

for (const width of [390, 1280]) test(`before the folder table exists: folders by name, read only ${width}`, async ({ page }) => {
  const f = await fixture(page, width, { table: false });
  await expect(page.locator('[data-nx-folder="name:회의"]').first()).toContainText('회의');
  await expect(page.locator('[data-nx-new-top]')).toHaveCount(0);
  await showOutside(page, width);
  await press(page, page.locator('[data-note-row-more="n1"]'), width);
  await press(page, page.locator('#noteDocMenu [data-note-folder-move]'), width);
  await expect(page.locator('[data-note-folder-status]')).toContainText('준비 중');
  await expect(picker(page)).toBeHidden();
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});

// NOTE-탐색기 후속 ②: 마우스로 노트·폴더 끌어 놓기(PC). 폰은 17:55부터 끌지 않고 꾹 누르기 메뉴·선택 모드로 옮긴다.
const extra = [{ id: U(2), workspace_id: 'w', parent_id: null, name: '기록', sort_order: 2048, created_at: '2026-10-01T00:00:00Z' }];
// 진짜 마우스로 끌기: from 줄을 잡아 to 줄의 zone 자리(before 위 25% 안 / inside 가운데 / after 아래 25% 안)에 놓는다. (S49-38: 공용 끌기 부품 reorder-drag.js)
async function mouseDrop(page, from, to, zone = 'inside') {
  const a = await page.locator(from).first().boundingBox(), b = await page.locator(to).first().boundingBox();
  const ty = zone === 'before' ? b.y + b.height * 0.1 : zone === 'after' ? b.y + b.height * 0.9 : b.y + b.height * 0.5;
  await page.mouse.move(a.x + 30, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + a.height / 2 + 6, { steps: 3 });
  await page.mouse.move(b.x + 30, ty, { steps: 8 });
  await page.mouse.up();
}
test('PC 1280: drag a note onto a folder in the left tree, then drag a folder into another folder; both undo', async ({ page }) => {
  const f = await fixture(page, 1280, { more: extra });
  await expect(page.locator('#noteRows [data-nx-note="n1"]')).toHaveAttribute('data-reorder-id', 'n:n1');
  await mouseDrop(page, '#noteRows [data-nx-note="n1"]', `[data-nx-tree] [data-nx-folder="${U(1)}"]`);
  await expect.poll(() => f.rows.find(r => r.id === 'n1').metadata).toEqual({ tasks: [{ task_id: 't1' }], folder_id: U(1), folder: '회의' });
  await expect(page.locator('#kptuNotice')).toContainText('옮겼어요 1개');
  await expect(page.locator(`[data-nx-tree] [data-nx-folder="${U(1)}"] .ft-num`)).toHaveText('2');
  // A folder dropped on another folder goes inside it (the folder row's parent changes; the notes keep their folder id).
  await mouseDrop(page, `[data-nx-tree] [data-nx-folder="${U(2)}"]`, `[data-nx-tree] [data-nx-folder="${U(1)}"]`);
  await expect.poll(() => f.folders.find(x => x.id === U(2)).parent_id).toBe(U(1));
  await expect(page.locator('#kptuNotice')).toContainText('옮겼어요 1개');
  await page.locator('#kptuNotice .kptu-notice-undo').click();
  await expect.poll(() => f.folders.find(x => x.id === U(2)).parent_id).toBe(null);
  expect(f.errors).toEqual([]);
});

test.describe('PC mouse (no touch)', () => { test.use({ hasTouch: false }); test('PC 1280: a row ⋯ shows only while the mouse is over the row', async ({ page }) => {
  const f = await fixture(page, 1280);
  const more = page.locator('[data-note-row-more="n1"]');
  await page.mouse.move(5, 5);
  await expect.poll(() => more.evaluate(el => getComputedStyle(el).opacity)).toBe('0');
  await page.locator('[data-note-row="n1"]').hover();
  await expect.poll(() => more.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
  // Right-click opens the same menu, with [복사] inside.
  await page.locator('[data-note-row="n1"]').click({ button: 'right' });
  await expect(page.locator('#noteDocMenu')).toBeVisible();
  await expect(page.locator('#noteDocMenu [data-note-copy]')).toHaveText('복사');
  expect(f.errors).toEqual([]);
}); });

// S69 LONGPRESS-선택(명진 11/24): 꾹 눌렀다 움직이지 않고 떼면 메뉴가 아니라 선택 모드 + 그 줄 선택. 메뉴는 줄 ⋯로만.
test('phone 390: long-press a note and let go without moving picks it (select mode); the row ⋯ opens the menu; [폴더로 옮기기] moves it', async ({ page }) => {
  const f = await fixture(page, 390);
  await showOutside(page, 390);
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i })) });
  const at = sel => page.locator(sel).evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await expect(page.locator('#noteRows [data-nx-note="n1"]')).toHaveAttribute('data-reorder-id', 'n:n1');
  await touch('touchStart', [await at('#noteRows [data-nx-note="n1"] .basket-title-text')]); await page.waitForTimeout(700);
  await touch('touchEnd', []);
  await expect(page.locator('#noteDocMenu')).toBeHidden();
  await expect(page.locator('[data-nx-select-bar]')).toBeVisible();
  await expect(page.locator('[data-nx-select-count]')).toHaveText('1개 선택됨');
  await expect(page.locator('#noteRows [data-nx-note="n1"]')).toHaveClass(/nx-picked/);
  await expect(page.locator('[data-note-detail]')).toBeHidden();
  // 다시 꾹 눌러도 풀리지 않는다(토글 아님).
  await touch('touchStart', [await at('#noteRows [data-nx-note="n1"] .basket-title-text')]); await page.waitForTimeout(700);
  await touch('touchEnd', []);
  await expect(page.locator('[data-nx-select-count]')).toHaveText('1개 선택됨');
  await cdp.detach();
  // 메뉴는 ⋯로: 고른 줄의 ⋯ = 고른 것 메뉴 → [1개 — 폴더로 옮기기].
  await press(page, page.locator('#noteRows [data-note-row-more="n1"]'), 390);
  await expect(page.locator('#noteDocMenu')).toBeVisible();
  await press(page, page.locator('#noteDocMenu [data-nx-sel-move]'), 390);
  await pickInSheet(page, ['회의']);
  await expect.poll(() => f.rows.find(r => r.id === 'n1').metadata.folder_id).toBe(U(1));
  await expect(page.locator('#kptuNotice')).toContainText('옮겼어요 1개');
  expect(f.errors).toEqual([]);
});

test('phone 390: 나무에서 그 자리 펼치기 → 두 손가락 그 폴더만(하위 폴더 먼저, 위치 [‹]) → [‹]·뒤로 = 펼친 자리 그대로 나무', async ({ page }) => {
  const f = await fixture(page, 390, { more: [{ id: U(3), workspace_id: 'w', parent_id: U(1), name: '하위', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' }] });
  // 누르면 화면이 바뀌지 않고 그 자리에서 하위 폴더 + 노트까지 펼친다.
  await press(page, page.locator(`#noteRows [data-nx-open="${U(1)}"]`), 390);
  await expect(here(page)).toBeHidden();
  await expect(page.locator(`#noteRows [data-nx-folder="${U(3)}"]`)).toBeVisible();
  await expect(noteRow(page, 'n2')).toBeVisible();
  await showFolder(page, 390, U(1));
  await expect(page.locator('#noteRows [data-nx-focus] .ft-focus-anc')).toHaveText('노트›');
  await expect(here(page)).toHaveText('‹회의 폴더 1 · 노트 1');
  await expect(page.locator('#noteRows .ft-box-body > *').first()).toHaveAttribute('data-nx-folder', U(3));
  await expect(noteRow(page, 'n2')).toBeVisible();
  await expect(noteRow(page, 'n1')).toHaveCount(0);
  // 폰 '그 폴더만'은 위치를 [‹] 줄 안에 보이고 따로 위치 줄을 두지 않는다.
  // UI-폴더이름펼치기(명진 11/24 18:09, 전의 OPS-빠진일2차 1 '하위 없는 폴더 = 한 번에 열기'를 대신함): 그 안 빈 폴더(하위)도 누르면 그 자리 펼침('빈 폴더' 한 줄),
  // 한 단계 더 들어가기는 ⋯ 첫 줄 [이 폴더로 들어가기].
  await expect(page.locator('[data-nx-where]')).toBeHidden();
  await press(page, page.locator(`#noteRows [data-nx-open="${U(3)}"]`), 390);
  await expect(page.locator(`#noteRows .ft-empty-row[data-ft-parent="${U(3)}"]`)).toContainText('빈 폴더');
  await expect(page.locator('#noteRows [data-nx-focus] .ft-focus-anc')).toHaveText('노트›');
  await press(page, page.locator(`#noteRows [data-nx-folder-more="${U(3)}"]`), 390);
  await page.locator('#noteDocMenu [data-nx-enter]').click();
  await expect(page.locator('#noteRows [data-nx-focus] .ft-focus-anc')).toHaveText('노트›회의›');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  // [‹] = 나무로(펼친 자리 그대로).
  await press(page, page.locator('[data-nx-back]'), 390);
  await expect(here(page)).toBeHidden();
  await expect(page.locator(`#noteRows [data-nx-folder="${U(3)}"]`)).toBeVisible();
  // 갤럭시 뒤로도 같다.
  await showFolder(page, 390, U(1));
  await page.goBack();
  await expect(here(page)).toBeHidden();
  await expect(page.locator(`#noteRows [data-nx-folder="${U(1)}"]`)).toBeVisible();
  await expect(noteRow(page, 'n2')).toBeVisible();
  await expect(page.locator('#basketView')).toBeVisible();
  expect(f.errors).toEqual([]);
});

// UI-칸폭끌기전수(요청함 10/30 10:29): PC [폴더]의 폴더 나무 | 노트 사이 경계를 끌어 폭을 바꾸고, 폭은 서버(view_prefs.split_ratio.notes)에 기억한다.
test('PC 1280: 폴더 나무 | 노트 경계 끌기·키보드·새로고침 유지·두 번 눌러 기본', async ({ page }) => {
  const server = await installViewPrefsServer(page);
  const { errors } = await fixture(page, 1280);
  // 새로고침 직후에는 사이드바가 아직 없을 수 있어(그러면 도우미가 폰 메뉴를 찾는다) 사이드바 [노트] 줄부터 기다린다.
  const open = async () => { await expect(page.locator('#appView > .app-nav [data-basket-kind-nav="note"]')).toBeVisible(); await chooseBasketKind(page, 'note'); await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3'); await expect(page.locator('[data-nx-tree]')).toBeVisible(); };
  await expect(page.locator('[data-nx-tree]')).toBeVisible();
  await checkSplit(page, { container: '[data-note-list] [data-nx-body]', left: ':scope>[data-nx-tree]', right: ':scope>.nx-pane', name: 'notes', share: 0.3, server, reopen: open });
  expect(errors).toEqual([]);
});

// UI-고르기막대(S69-85, 명진 11/25 "두줄로 삐져나오지 않게"): 노트 고르기 막대도 파일·자료실과 같은 공용 막대 — 늘 한 줄(높이 = 목록 줄 하나 이하),
// 테두리 없는 [전체 선택][폴더로 옮기기][삭제](삭제는 맨 끝·글자색만 경고색), 좁으면 아이콘만 → ⋯.
// S70-64b: [✕]·'N개 선택됨' 글자는 없다(개수는 화면 읽기에만). 맨 왼쪽은 [전체 선택].
for (const width of [390, 768, 1280]) test(`UI-고르기막대: 노트 선택 막대 한 줄 ${width}`, async ({ page }) => {
  const { mkdirSync } = await import('node:fs');
  const DIR = 'test-results/ui-audit'; mkdirSync(DIR, { recursive: true });
  const f = await fixture(page, width);
  await showOutside(page, width);
  await press(page, page.locator('[data-note-row-more="n1"]'), width);
  await press(page, page.locator('#noteDocMenu [data-nx-select]'), width);
  const bar = page.locator('[data-nx-select-bar]');
  await expect(bar).toBeVisible();
  const m = await bar.evaluate(el => {
    const b = el.getBoundingClientRect();
    const kids = [...el.querySelectorAll('.kptu-sb-count, button.kptu-sb-act')].filter(x => x.getClientRects().length && getComputedStyle(x).visibility !== 'hidden');
    const mids = kids.map(x => { const r = x.getBoundingClientRect(); return r.top + r.height / 2; });
    const buttons = kids.filter(x => x.matches('button'));
    return { height: b.height, spread: Math.max(...mids) - Math.min(...mids), outside: kids.filter(x => x.getBoundingClientRect().right > b.right + 1).length,
      first: (buttons[0]?.querySelector('.kptu-act-tx')?.textContent || buttons[0]?.getAttribute('aria-label') || '').trim(), close: !!el.querySelector('.kptu-sb-close'), last: buttons.at(-1)?.matches('[data-nx-sel-delete]'),
      danger: getComputedStyle(el.querySelector('[data-nx-sel-delete]')).color, ink: getComputedStyle(el.querySelector('[data-nx-sel-all]')).color,
      borders: buttons.map(x => getComputedStyle(x).borderTopWidth) };
  });
  expect(m.height, '한 줄 높이').toBeLessThanOrEqual(40);
  expect(m.spread, '칸이 모두 한 줄').toBeLessThanOrEqual(2);
  expect(m.outside).toBe(0);
  expect(m.first).toBe('전체 선택');
  expect(m.close, '✕ 없음').toBe(false);
  expect(m.last, '삭제는 맨 끝').toBe(true);
  expect(m.danger, '삭제만 경고색').not.toBe(m.ink);
  expect(m.borders.every(w => w === '0px')).toBe(true);
  await expect(page.locator('[data-nx-select-count]')).toHaveText('1개 선택됨'); // 화면 읽기용(눈에는 안 보임)
  await expect(page.locator('[data-nx-select-count]')).toHaveClass(/kptu-sb-sr/);
  await page.screenshot({ path: `${DIR}/s69-85-notes-${width}.png` });
  process.stdout.write(`::notice title=select-bar notes ${width}::${JSON.stringify(m)}\n`);
  await page.keyboard.press('Escape');
  expect(f.errors).toEqual([]);
});

// UI-줄꼬리표(요청함 11/04 00:17): '최근' 노트 줄 오른쪽 폴더 이름은 제목이 아주 길어도 줄어들지 않고 온전히 보이며, 제목만 …로 줄어든다.
for (const width of [412, 840, 1280]) {
  test(`노트 최근 줄: 긴 제목에서도 오른쪽 폴더 이름이 다 보인다 (${width}px)`, async ({ page }) => {
    const { errors } = await fixture(page, width, { longRow: true });
    await chooseBasketKind(page, 'note');
    const scope = width < 761 ? '[data-nx-recent]' : '#noteRows';
    const tail = page.locator(`${scope} [data-nx-note="n1"] [data-nx-recent-folder]`);
    await expect(tail).toBeVisible({ timeout: 15000 });
    const m = await page.evaluate(() => {
      const row = document.querySelector('[data-nx-recent] [data-nx-note="n1"], #noteRows [data-nx-note="n1"]');
      const path = row.querySelector('[data-nx-recent-folder]'), title = row.querySelector('.basket-title-text'), time = row.querySelector('time');
      return { pathFull: path.scrollWidth <= path.clientWidth, pathW: path.getBoundingClientRect().width, timeFull: time.scrollWidth <= time.clientWidth,
        titleCut: title.scrollWidth > title.clientWidth || getComputedStyle(title).textOverflow === 'ellipsis', over: document.documentElement.scrollWidth > innerWidth };
    });
    expect(m.pathFull).toBe(true); expect(m.pathW).toBeGreaterThan(20); expect(m.timeFull).toBe(true); expect(m.over).toBe(false);
    await expect(tail).toContainText('회의');
    await page.locator(scope).first().screenshot({ path: `test-results/note-recent-tail-${width}.png` });
    expect(errors).toEqual([]);
  });
}
