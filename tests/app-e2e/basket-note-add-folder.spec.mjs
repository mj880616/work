import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { expectPickerAtButton } from './helpers/picker-anchor.mjs';

// NOTE-추가폴더표시 → NOTE-탐색기 (2026-10-28): the note input shows which folder a NEW note goes into as a small [폴더 ▾] button
// ("회의 ▾" / "폴더 없음 ▾"): the entered folder (folder ⋯ [이 폴더로 들어가기]), unless another one is picked on the button, which opens
// the shared folder list (library-move-picker.js). A new note is put there with the folder id and name. PC 1280 and phone 390.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture(page, width, made = null) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], writes = [], failOnce = new Set();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await openHome(page);
  const row = (id, title, updated_at, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문', occurred_at: updated_at, created_at: updated_at, updated_at, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
  const rows = made ? made(row) : [
    row('n1', '가 노트', '2026-10-16T01:00:00Z', { tasks: [{ task_id: 't1' }] }),
    row('n2', '나 노트', '2026-10-12T01:00:00Z'),
    row('n3', '다 노트', '2026-10-10T01:00:00Z'),
  ];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', async r => {
    const req = r.request(), q = new URL(req.url()).searchParams;
    const metaOk = (x, key) => !q.has('metadata->>' + key) || (q.get('metadata->>' + key) === 'is.null' ? x.metadata[key] == null : 'eq.' + x.metadata[key] === q.get('metadata->>' + key));
    const pick = x => (!q.get('kind') || 'eq.' + x.kind === q.get('kind')) && (!q.get('id') || 'eq.' + x.id === q.get('id'))
      && (!q.get('updated_at') || 'eq.' + x.updated_at === q.get('updated_at')) && metaOk(x, 'pinned_at') && metaOk(x, 'folder');
    if (req.method() === 'GET') return r.fulfill({ json: rows.filter(pick).slice(Number(q.get('offset') || 0)).map(x => structuredClone(x)) });
    if (req.method() === 'PATCH') {
      const id = (q.get('id') || '').slice(3);
      if (failOnce.has(id)) { failOnce.delete(id); return r.fulfill({ status: 503, json: { message: 'busy' } }); }
      const body = req.postDataJSON(); writes.push({ query: Object.fromEntries(q), body });
      const hit = rows.filter(pick); hit.forEach(x => Object.assign(x, structuredClone(body))); return r.fulfill({ json: hit.map(x => structuredClone(x)) });
    }
    if (req.method() === 'POST') { const body = req.postDataJSON(); writes.push({ method: 'POST', body }); const x = { ...row('n-new', body.title, '2026-10-20T01:00:00Z'), raw_text: body.raw_text }; rows.unshift(x); return r.fulfill({ status: 201, json: [structuredClone(x)] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  const folders = [{ id: U(1), workspace_id: 'w', parent_id: null, name: '회의', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' }, { id: U(2), workspace_id: 'w', parent_id: null, name: '개발', sort_order: 2048, created_at: '2026-10-01T00:00:00Z' }];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page,'note');
  // 10/28 17:55: the phone's first screen is the folder list (no note rows), so wait on the count in the head.
  await expect(page.locator('[data-nx-count]')).toHaveText(`노트 · ${rows.length}`);
  return { rows, writes, errors, failOnce };
}

const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
const input = page => page.locator('[data-note-list] [data-quick-input]');
const folderBtn = page => page.locator('[data-note-list] [data-quick-folder]');
const picker = page => page.locator('#luMovePicker');
async function addNote(page, width, text) {
  await input(page).fill(text);
  await press(page, page.locator('[data-note-list] [data-quick-save]'), width);
}

for (const width of [1280, 390]) test(`the note input names the folder a new note goes into and [폴더 ▾] picks another ${width}`, async ({ page }) => {
  const f = await fixture(page, width);
  // At the top: 폴더 없음.
  await expect(folderBtn(page)).toHaveText('폴더 없음 ▾');
  await expect(input(page)).toHaveAttribute('placeholder', '노트를 입력하세요');
  // Entering a folder → that folder, in the button and the placeholder.
  await press(page, page.locator(`[data-nx-folder-more="${U(2)}"]`).first(), width);
  await press(page, page.locator('#noteDocMenu [data-nx-enter]'), width);
  await expect(folderBtn(page)).toHaveText('개발 ▾');
  // NOTE-큰창잘림: 폰은 옆 [폴더 ▾]가 폴더를 보이므로 안내 글은 '노트 추가'만(한 줄 칸에서 둘째 줄로 잘리지 않게).
  await expect(input(page)).toHaveAttribute('placeholder', width < 761 ? '노트 추가' : '개발에 노트 추가');
  const box = await folderBtn(page).boundingBox();
  expect(box.height).toBeLessThanOrEqual(36);
  expect(box.width).toBeLessThan(200);
  // [폴더 ▾] opens the shared folder list; picking 회의 changes this add only.
  await press(page, folderBtn(page), width);
  await expect(picker(page)).toBeVisible();
  await press(page, picker(page).locator('.lu-move-item', { hasText: '회의' }), width);
  await expect(folderBtn(page)).toHaveText('회의 ▾');
  // The new note goes into 회의 with the folder id and name (one metadata write after the save).
  await addNote(page, width, '새 노트 글');
  await expect.poll(() => f.rows.find(r => r.id === 'n-new')?.metadata).toEqual({ folder_id: U(1), folder: '회의' });
  // [폴더 ▾] → [폴더 밖으로]: the next note goes to 폴더 없음.
  await press(page, folderBtn(page), width);
  await press(page, picker(page).locator('[data-lu-move-out]'), width);
  await expect(folderBtn(page)).toHaveText('폴더 없음 ▾');
  expect(f.errors).toEqual([]);
});

// NOTE-폴더메뉴새노트(11/07): 폴더 줄 ⋯ 맨 위 [새 노트] → 기존 새 노트 창이 그 폴더가 골라진 채로 열리고, 저장하면 그 폴더에 들어간다.
// 폴더 안 화면의 머리 ⋯ 에는 [이 폴더에 새 노트]. 폰 412 · PC 1280.
for (const width of [1280, 412]) test(`folder ⋯ [새 노트] opens the new note window in that folder and saves there ${width}`, async ({ page }) => {
  const f = await fixture(page, width);
  const win = page.locator('#edWindow');
  await expect(folderBtn(page)).toHaveText('폴더 없음 ▾');
  await press(page, page.locator(`[data-nx-folder-more="${U(2)}"]`).first(), width);
  await expect(page.locator('#noteDocMenu button').first()).toHaveText('새 노트');
  await press(page, page.locator('#noteDocMenu [data-nx-new-note]'), width);
  await expect(page.locator('#noteDocMenu')).toBeHidden();
  await expect(win).toBeVisible();
  await expect(win.locator('[data-edw-folder]')).toHaveText('개발 ▾');
  await expect(folderBtn(page)).toHaveText('개발 ▾');
  await win.locator('[data-edw-title]').fill('폴더 메뉴 새 노트');
  await win.locator('.ed-window-body .ProseMirror').click(); await page.keyboard.type('합성 본문');
  await win.locator('[data-edw-save]').click();
  await expect(win).toHaveCount(0);
  await expect.poll(() => f.rows.find(r => r.id === 'n-new')?.metadata?.folder_id).toBe(U(2));
  expect(f.rows.find(r => r.id === 'n-new').metadata.folder).toBe('개발');
  expect(f.writes.filter(w => w.method === 'POST')).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

for (const width of [1280, 412]) test(`inside a folder the head ⋯ has [이 폴더에 새 노트] ${width}`, async ({ page }) => {
  await fixture(page, width);
  await press(page, page.locator(`[data-nx-folder-more="${U(1)}"]`).first(), width);
  await press(page, page.locator('#noteDocMenu [data-nx-enter]'), width);
  await expect(folderBtn(page)).toHaveText('회의 ▾');
  await press(page, page.locator('[data-note-folder-more]'), width);
  await expect(page.locator('#noteDocMenu button').first()).toHaveText('이 폴더에 새 노트');
  await press(page, page.locator('#noteDocMenu [data-nx-new-note]'), width);
  await expect(page.locator('#edWindow [data-edw-folder]')).toHaveText('회의 ▾');
});

// S54-04 UI-고르기창버튼아래(11/08 명진 결정 B): 노트 입력 줄 [폴더 ▾] 창은 폰·폴드·PC 모두 누른 버튼 바로 아래(자리가 모자라면 위) 작은 창.
for (const width of [390, 884, 1280]) test(`노트 [폴더 ▾] 고르기 창은 누른 버튼에 붙어 열린다 ${width}`, async ({ page }) => {
  const f = await fixture(page, width);
  await press(page, folderBtn(page), width);
  await expectPickerAtButton(page, picker(page), folderBtn(page));
  await press(page, picker(page).locator('.lu-move-item', { hasText: '회의' }), width);
  await expect(folderBtn(page)).toHaveText('회의 ▾');
  expect(f.errors).toEqual([]);
});
