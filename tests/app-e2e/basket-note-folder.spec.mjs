import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';

// NOTE-탐색기 (2026-10-28 09:24·10:34·11:01): the note list is a folder tree (app_note_folders, migration 20261028170000).
// Phone: folders and notes on one screen (open folder → its notes indented below); PC: left folder tree, right the entered folder.
// Notes without a folder sit in '🗂 폴더 밖'. A note written before the table keeps its folder by name (top folder of the same name).
// Row ⋯ / right-click / long-press = one menu with [선택] on top; select mode moves several at once; every move has [되돌리기].
// Phone 390 and PC 1280. Names are made up.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture(page, width, {table = true} = {}) {
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
  const folders = [{ id: U(1), workspace_id: 'w', parent_id: null, name: '회의', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' }];
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
const picker = page => page.locator('#luMovePicker');
const noteRow = (page, id) => page.locator(`#noteRows [data-note-row="${id}"]`);
// Shows the notes of folder id: phone opens it in the tree, PC enters it from the left tree.
async function showFolder(page, width, id) {
  if (width >= 1024) await press(page, page.locator(`[data-nx-tree] [data-nx-open="${id}"]`), width);
  else await press(page, page.locator(`#noteRows [data-nx-open="${id}"]`), width);
}

for (const width of [390, 1280]) test(`folder tree: old folder by name, 폴더 밖, move with the shared picker and undo ${width}`, async ({ page }) => {
  const f = await fixture(page, width);
  // The old folder (metadata.folder '회의', no id) is the top folder of that name; the others are in 폴더 밖 (open from the start).
  await expect(page.locator(`[data-nx-folder="${U(1)}"]`).first()).toContainText('회의');
  await expect(page.locator(`[data-nx-folder="${U(1)}"] .nx-num`).first()).toHaveText('1');
  await expect(noteRow(page, 'n1')).toBeVisible(); await expect(noteRow(page, 'n3')).toBeVisible();
  await expect(page.locator('[data-note-row] .basket-preview')).toHaveCount(0);
  await showFolder(page, width, U(1));
  await expect(noteRow(page, 'n2')).toBeVisible();
  if (width >= 1024) {
    await expect(page.locator('[data-nx-where]')).toContainText('노트');
    await expect(page.locator('[data-nx-where] [aria-current]')).toHaveText('회의');
    await press(page, page.locator('[data-nx-where] [data-nx-at=""]'), width);
  }
  // Row ⋯: [선택] first, then [폴더로 옮기기] opens the shared folder list; the note gets the folder id and name, nothing else changes.
  await press(page, page.locator('[data-note-row-more="n1"]'), width);
  await expect(page.locator('#noteDocMenu button').first()).toHaveText('선택');
  await press(page, page.locator('#noteDocMenu [data-note-folder-move]'), width);
  await expect(picker(page)).toBeVisible();
  await press(page, picker(page).locator('.lu-move-item', { hasText: '회의' }), width);
  await expect(picker(page)).toBeHidden();
  await expect.poll(() => f.writes.filter(x => x.table === 'notes').length).toBe(1);
  const w = f.writes.filter(x => x.table === 'notes');
  expect(w[0].body).toEqual({ metadata: { tasks: [{ task_id: 't1' }], folder_id: U(1), folder: '회의' } });
  expect(f.rows.find(r => r.id === 'n1').updated_at).toBe('2026-10-16T01:00:00Z');
  await expect(page.locator('#kptuNotice')).toContainText('옮겼어요 1개');
  await expect(page.locator(`[data-nx-folder="${U(1)}"] .nx-num`).first()).toHaveText('2');
  // [되돌리기] puts it back in 폴더 밖.
  await press(page, page.locator('#kptuNotice .kptu-notice-undo'), width);
  await expect.poll(() => f.rows.find(r => r.id === 'n1').metadata).toEqual({ tasks: [{ task_id: 't1' }] });
  await expect(page.locator(`[data-nx-folder="${U(1)}"] .nx-num`).first()).toHaveText('1');
  expect(f.errors).toEqual([]);
});

for (const width of [390, 1280]) test(`select mode: [선택] → pick rows → move together → mode ends; Esc ends it ${width}`, async ({ page }) => {
  const f = await fixture(page, width);
  await press(page, page.locator('[data-note-row-more="n1"]'), width);
  await press(page, page.locator('#noteDocMenu [data-nx-select]'), width);
  await expect(page.locator('[data-nx-select-bar]')).toBeVisible();
  await expect(page.locator('[data-nx-select-count]')).toHaveText('1개 골랐음');
  // In select mode pressing a row picks it (it does not open).
  await press(page, noteRow(page, 'n3'), width);
  await expect(page.locator('[data-nx-select-count]')).toHaveText('2개 골랐음');
  await expect(page.locator('[data-note-detail]')).toBeHidden();
  await press(page, page.locator('[data-nx-select-bar] [data-nx-sel-move]'), width);
  await press(page, picker(page).locator('.lu-move-item', { hasText: '회의' }), width);
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
  page.once('dialog', d => d.accept('하위'));
  await press(page, page.locator(`#noteRows [data-nx-folder-more="${U(1)}"], [data-nx-tree] [data-nx-folder-more="${U(1)}"]`).first(), width);
  await press(page, page.locator('#noteDocMenu [data-nx-new-in]'), width);
  await expect.poll(() => f.folders.map(x => x.name)).toEqual(['회의', '하위']);
  const sub = f.folders[1];
  expect(sub.parent_id).toBe(U(1));
  // The phone tree already opened 회의 when the folder was made inside it; the PC enters it.
  if (width >= 1024) await showFolder(page, width, U(1));
  await press(page, page.locator('[data-note-row-more="n2"]'), width);
  await press(page, page.locator('#noteDocMenu [data-note-folder-move]'), width);
  await press(page, picker(page).locator('.lu-move-item', { hasText: '하위' }), width);
  await expect.poll(() => f.rows.find(r => r.id === 'n2').metadata).toEqual({ folder_id: sub.id, folder: '하위' });
  // Delete the sub folder: its note goes up to 회의 (not deleted); [되돌리기] makes the folder again with the same id.
  await press(page, page.locator(`[data-nx-folder-more="${sub.id}"]`).first(), width);
  await press(page, page.locator('#noteDocMenu [data-nx-delete-folder]'), width);
  await press(page, page.locator('.kptu-ask button', { hasText: '지우기' }), width);
  await expect.poll(() => f.folders.map(x => x.name)).toEqual(['회의']);
  expect(f.rows.find(r => r.id === 'n2').metadata).toEqual({ folder_id: U(1), folder: '회의' });
  await press(page, page.locator('#kptuNotice .kptu-notice-undo'), width);
  await expect.poll(() => f.folders.map(x => x.id)).toEqual([U(1), sub.id]);
  await expect.poll(() => f.rows.find(r => r.id === 'n2').metadata.folder_id).toBe(sub.id);
  expect(f.rows.length).toBe(3);
  expect(f.errors).toEqual([]);
});

for (const width of [390, 1280]) test(`before the folder table exists: folders by name, read only ${width}`, async ({ page }) => {
  const f = await fixture(page, width, { table: false });
  await expect(page.locator('[data-nx-folder="name:회의"]').first()).toContainText('회의');
  await press(page, page.locator('[data-note-row-more="n1"]'), width);
  await press(page, page.locator('#noteDocMenu [data-note-folder-move]'), width);
  await expect(page.locator('[data-note-folder-status]')).toContainText('준비 중');
  await expect(picker(page)).toBeHidden();
  expect(f.writes).toEqual([]);
  expect(f.errors).toEqual([]);
});
