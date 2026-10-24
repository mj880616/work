import { test, expect } from '@playwright/test';
import { installViewPrefsServer, leftoverDeviceKeys } from './helpers/view-prefs-server.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { expectNoteTitle } from './helpers/note-title.mjs';

// UI-노트폴더 1단계 (docs/design/note-folders.md): a note's folder is metadata.folder in its existing row (no database change).
// The note list has one folder row under the search box ([전체] [folders…] [폴더 없음] + ⋯), the note ⋯ has [폴더로 옮기기],
// and folder rename/delete write note by note with [다시 시도] for the rest. Folder and pin share metadata and never drop each
// other. Phone 390 and PC 1280. Names are made up.
test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
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
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page,'note');
  await expect(page.locator('[data-note-row]')).toHaveCount(rows.length);
  return { rows, writes, errors, failOnce };
}
const press = async (page, l, width) => { await expect(l).toBeVisible(); if (width < 761) await l.tap(); else await l.click(); };
const titles = page => page.locator('[data-note-row] .basket-title-text').allTextContents();
const chips = page => page.locator('[data-note-folder-filter] [data-filter-value]').allTextContents();
const chip = (page, name) => page.locator('[data-note-folder-filter]').getByRole('radio', { name, exact: true });
// Answers the next prompt/confirm with value (prompt) or accept (confirm) and keeps the message.
function answerNext(page, value) {
  return new Promise(resolve => page.once('dialog', async d => { const message = d.message(); if (d.type() === 'prompt') await d.accept(value); else await d.accept(); resolve(message); }));
}
async function moveFromRow(page, id, width, target, newName = null) {
  await press(page, page.locator(`[data-note-row-more="${id}"]`), width);
  await press(page, page.locator('#noteDocMenu [data-note-folder-move]'), width);
  const sheet = page.locator('#noteFolderChoice');
  await expect(sheet).toBeVisible();
  const asked = newName === null ? null : answerNext(page, newName);
  await press(page, sheet.getByRole('button', { name: target, exact: true }), width);
  if (asked) await asked;
  await expect(sheet).toBeHidden();
}

for (const width of [390, 1280]) test(`move notes into folders, filter by folder and "폴더 없음" ${width}`, async ({ page }, info) => {
  const f = await fixture(page, width);
  // No folder yet: the row has only [전체] and the folder ⋯.
  expect(await chips(page)).toEqual(['전체']);
  await expect(page.locator('[data-note-folder-more]')).toBeVisible();
  // Row ⋯ → [폴더로 옮기기] → [+ 새 폴더]: the name is typed and the note goes in at once (metadata only, updated_at kept).
  await moveFromRow(page, 'n2', width, '+ 새 폴더', '  회의 폴더 ');
  await expect(page.locator('#toast')).toHaveText("'회의 폴더' 폴더로 옮겼어요.");
  expect(f.writes).toHaveLength(1);
  expect(Object.keys(f.writes[0].body)).toEqual(['metadata']);
  expect(f.writes[0].body.metadata).toEqual({ folder: '회의 폴더' });
  expect(f.writes[0].query).toMatchObject({ id: 'eq.n2', kind: 'eq.note', updated_at: 'eq.2026-10-12T01:00:00Z', 'metadata->>pinned_at': 'is.null', 'metadata->>folder': 'is.null' });
  expect(f.rows.find(r => r.id === 'n2').updated_at).toBe('2026-10-12T01:00:00Z');
  expect(await chips(page)).toEqual(['전체', '회의 폴더', '폴더 없음']);
  // [전체] names the folder on the row; other metadata (tasks) stays when the first note moves.
  await expect(page.locator('[data-note-row="n2"] [data-note-row-folder]')).toHaveText('폴더: 회의 폴더');
  // The open note's ⋯ has the same item; the sheet marks the current folder; the read view shows the folder.
  await press(page, page.locator('[data-note-row="n1"]'), width);
  await press(page, page.locator('[data-note-more]'), width);
  await press(page, page.locator('#noteDocMenu [data-note-folder-move]'), width);
  await expect(page.locator('#noteFolderChoice [aria-pressed="true"]')).toHaveText('폴더 없음');
  await press(page, page.locator('#noteFolderChoice').getByRole('button', { name: '회의 폴더', exact: true }), width);
  await expect.poll(() => f.writes.length).toBe(2);
  expect(f.writes[1].body.metadata).toEqual({ tasks: [{ task_id: 't1' }], folder: '회의 폴더' });
  await expect(page.locator('[data-note-meta-folder]')).toHaveText('폴더 회의 폴더');
  await press(page, page.locator('[data-note-close]'), width);
  // Filtering: the folder, then "폴더 없음", then 전체 again. Inside a folder rows do not repeat the folder name.
  await press(page, chip(page, '회의 폴더'), width);
  expect(await titles(page)).toEqual(['가 노트', '나 노트']);
  await expect(page.locator('[data-note-row-folder]')).toHaveCount(0);
  await expect(page.locator('[data-note-list-status]')).toHaveText('2개 노트');
  await page.screenshot({ path: info.outputPath(`note-folder-${width}.png`) });
  await press(page, chip(page, '폴더 없음'), width);
  expect(await titles(page)).toEqual(['다 노트']);
  // Search stays inside the chosen folder; with no hit it offers [전체에서 찾기].
  await page.locator('[data-note-search]').fill('가 노트');
  await expect(page.locator('[data-note-list-status]')).toHaveText('이 폴더에 찾는 노트가 없어요');
  await press(page, page.locator('[data-note-search-all]'), width);
  await expect(chip(page, '전체')).toHaveAttribute('aria-checked', 'true');
  expect(await titles(page)).toEqual(['가 노트']);
  await page.locator('[data-note-search]').fill('');
  // Back to "폴더 없음" for one note: the folder key goes away.
  await moveFromRow(page, 'n2', width, '폴더 없음');
  await expect(page.locator('#toast')).toHaveText("'폴더 없음'으로 옮겼어요.");
  expect(f.rows.find(r => r.id === 'n2').metadata).toEqual({});
  // Keyboard: the folder row is one radio group (arrow keys).
  await chip(page, '전체').focus(); await page.keyboard.press('ArrowRight');
  await expect(chip(page, '회의 폴더')).toHaveAttribute('aria-checked', 'true');
  expect(await titles(page)).toEqual(['가 노트']);
  expect(f.errors).toEqual([]);
});

test('folder and pin share metadata without dropping each other; pinned notes stay on top inside a folder', async ({ page }) => {
  const f = await fixture(page, 390, row => [
    row('n1', '가 노트', '2026-10-16T01:00:00Z', { folder: '자료 폴더' }),
    row('n2', '나 노트', '2026-10-12T01:00:00Z', { folder: '자료 폴더' }),
    row('n3', '다 노트', '2026-10-10T01:00:00Z', { pinned_at: '2026-10-01T00:00:00.000Z' }),
  ]);
  // Pin a note that is in a folder: the folder stays, and the pin guard also checks the folder.
  await page.locator('[data-note-row="n2"]').tap();
  await page.locator('[data-note-more]').tap(); await page.locator('#noteDocMenu [data-note-pin]').tap();
  await expect(page.locator('#toast')).toHaveText('노트를 맨 위에 고정했어요.');
  expect(f.writes[0].body.metadata).toMatchObject({ folder: '자료 폴더' });
  expect(f.writes[0].query['metadata->>folder']).toBe('eq.자료 폴더');
  await page.locator('[data-note-close]').tap();
  // Move a pinned note into the folder: the pin stays.
  await moveFromRow(page, 'n3', 390, '자료 폴더');
  await expect.poll(() => f.writes.length).toBe(2);
  expect(f.writes[1].body.metadata).toEqual({ pinned_at: '2026-10-01T00:00:00.000Z', folder: '자료 폴더' });
  expect(f.writes[1].query['metadata->>pinned_at']).toBe('eq.2026-10-01T00:00:00.000Z');
  // Inside the folder: pinned first (most recently pinned on top), then by last change.
  await chip(page, '자료 폴더').tap();
  expect(await titles(page)).toEqual(['나 노트', '다 노트', '가 노트']);
  await expect(page.locator('[data-note-row="n2"] [data-note-pinned]')).toBeVisible();
  // A folder changed on another device after this screen read the note: the guarded write is made against the fresh row.
  f.rows.find(r => r.id === 'n1').metadata = { folder: '다른 폴더' };
  await moveFromRow(page, 'n1', 390, '폴더 없음');
  await expect.poll(() => f.writes.length).toBe(3);
  expect(f.writes[2].query['metadata->>folder']).toBe('eq.다른 폴더');
  expect(f.errors).toEqual([]);
});

for (const width of [390, 1280]) test(`rename a folder note by note: a failed part is finished with [다시 시도]; delete keeps the notes ${width}`, async ({ page }) => {
  const f = await fixture(page, width, row => [
    row('n1', '가 노트', '2026-10-16T01:00:00Z', { folder: '옛 폴더', tasks: [] }),
    row('n2', '나 노트', '2026-10-12T01:00:00Z', { folder: '옛 폴더', pinned_at: '2026-10-18T00:00:00.000Z' }),
    row('n3', '다 노트', '2026-10-10T01:00:00Z', { folder: '옛 폴더' }),
    row('n4', '라 노트', '2026-10-09T01:00:00Z', { folder: '남는 폴더' }),
  ]);
  // [전체] chosen: the folder ⋯ has only [새 폴더].
  await press(page, page.locator('[data-note-folder-more]'), width);
  // ED③ 1단계(1회용, 다음 PR에서 삭제): owner에게는 폴더 ⋯ 끝에 [옛 마크다운 노트 변환]이 있다.
  await expect(page.locator('#noteDocMenu button')).toHaveText(['새 폴더', '옛 마크다운 노트 변환']);
  await page.keyboard.press('Escape');
  await press(page, chip(page, '옛 폴더'), width);
  await press(page, page.locator('[data-note-folder-more]'), width);
  await expect(page.locator('#noteDocMenu button')).toHaveText(['새 폴더', '폴더 이름 바꾸기', '폴더 지우기', '옛 마크다운 노트 변환']);
  // Rename while one note's write fails once.
  f.failOnce.add('n2');
  const asked = answerNext(page, '새 폴더 이름');
  await press(page, page.locator('#noteDocMenu [data-note-folder-rename]'), width);
  expect(await asked).toContain('폴더 이름 바꾸기');
  await expect(page.locator('[data-note-folder-status]')).toHaveText('노트 3개 중 2개만 바뀌었어요. [다시 시도]를 누르면 나머지 1개를 마저 바꿔요.');
  await expect(page.locator('[data-note-folder-retry]')).toBeVisible();
  expect(await chips(page)).toEqual(['전체', '남는 폴더', '새 폴더 이름', '옛 폴더', '폴더 없음']);
  expect(f.rows.map(r => r.metadata.folder)).toEqual(['새 폴더 이름', '옛 폴더', '새 폴더 이름', '남는 폴더']);
  await press(page, page.locator('[data-note-folder-retry]'), width);
  await expect(page.locator('#toast')).toHaveText("폴더 이름을 '새 폴더 이름'(으)로 바꿨어요.");
  await expect(page.locator('[data-note-folder-status]')).toBeHidden();
  await expect(page.locator('[data-note-folder-retry]')).toBeHidden();
  expect(await chips(page)).toEqual(['전체', '남는 폴더', '새 폴더 이름', '폴더 없음']);
  await expect(chip(page, '새 폴더 이름')).toHaveAttribute('aria-checked', 'true');
  // Each note kept its other metadata and its "고친 날"; only the retried note was written again.
  expect(f.rows[0].metadata).toEqual({ folder: '새 폴더 이름', tasks: [] });
  expect(f.rows[1].metadata).toEqual({ folder: '새 폴더 이름', pinned_at: '2026-10-18T00:00:00.000Z' });
  expect(f.rows[1].updated_at).toBe('2026-10-12T01:00:00Z');
  expect(f.writes.map(w => w.query.id)).toEqual(['eq.n1', 'eq.n3', 'eq.n2']);
  expect(f.writes.every(w => w.query['metadata->>folder'] === 'eq.옛 폴더')).toBe(true);
  // Delete: asks with the count, the notes stay in "폴더 없음".
  await press(page, page.locator('[data-note-folder-more]'), width);
  const confirmed = answerNext(page);
  await press(page, page.locator('#noteDocMenu [data-note-folder-delete]'), width);
  expect(await confirmed).toBe("'새 폴더 이름' 폴더를 지울까요? 노트 3개는 '폴더 없음'으로 가요.");
  await expect(page.locator('#toast')).toHaveText("'새 폴더 이름' 폴더를 지웠어요. 노트는 '폴더 없음'에 있어요.");
  expect(await chips(page)).toEqual(['전체', '남는 폴더', '폴더 없음']);
  await expect(chip(page, '전체')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-note-row]')).toHaveCount(4);
  expect(f.rows.map(r => r.metadata)).toEqual([{ tasks: [] }, { pinned_at: '2026-10-18T00:00:00.000Z' }, {}, { folder: '남는 폴더' }]);
  await press(page, chip(page, '폴더 없음'), width);
  expect(await titles(page)).toEqual(['나 노트', '가 노트', '다 노트']);
  expect(f.errors).toEqual([]);
});

test('names: 1~20 letters, not 전체/폴더 없음, at most 30 folders; a new empty folder lives until a note moves in', async ({ page }) => {
  const f = await fixture(page, 1280, row => Array.from({ length: 30 }, (_, i) => row('n' + i, `노트 ${i}`, `2026-10-${String(10 + (i % 9)).padStart(2, '0')}T0${i % 10}:00:00Z`, { folder: `폴더 ${String(i).padStart(2, '0')}` })));
  // 31st folder from the move sheet: refused, nothing written.
  await moveFromRow(page, 'n0', 1280, '+ 새 폴더', '서른한째 폴더');
  await expect(page.locator('[data-note-list-status]')).toHaveText('폴더는 30개까지 만들 수 있어요.');
  // The folder ⋯ [새 폴더] checks the same rules.
  const tryNew = async name => { const asked = answerNext(page, name); await page.locator('[data-note-folder-more]').click(); await page.locator('#noteDocMenu [data-note-folder-new]').click(); await asked; };
  await tryNew('넘치는 폴더');
  await expect(page.locator('[data-note-folder-status]')).toHaveText('폴더는 30개까지 만들 수 있어요.');
  // An existing name is reused (no new folder, no limit).
  await moveFromRow(page, 'n0', 1280, '+ 새 폴더', '폴더 05');
  await expect(page.locator('#toast')).toHaveText("'폴더 05' 폴더로 옮겼어요.");
  expect(f.writes).toHaveLength(1);
  // Now 29 folders are left (폴더 00 is empty): a 21-letter name and the reserved names are refused, a 20-letter one is made.
  await tryNew('가'.repeat(21));
  await expect(page.locator('[data-note-folder-status]')).toHaveText('폴더 이름은 20자까지 쓸 수 있어요.');
  await tryNew('폴더 없음');
  await expect(page.locator('[data-note-folder-status]')).toHaveText("'폴더 없음'은 폴더 이름으로 쓸 수 없어요.");
  await tryNew('   ');
  await expect(page.locator('[data-note-folder-status]')).toHaveText('폴더 이름을 입력해 주세요.');
  await tryNew('나'.repeat(20));
  await expect(page.locator('[data-note-folder-status]')).toHaveText(`'${'나'.repeat(20)}' 폴더를 만들었어요. 노트 ⋯의 [폴더로 옮기기]로 노트를 넣으면 남아요.`);
  await expect(chip(page, '나'.repeat(20))).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('[data-note-row]')).toHaveCount(0);
  await expect(page.locator('[data-note-list-status]')).toHaveText('이 폴더에 노트가 없어요');
  expect(await page.locator('[data-note-folder-filter] [data-filter-value]').count()).toBe(1 + 30 + 1);
  expect(f.writes).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

test('moving a note in a folder back to the basket drops the folder in the same guarded write', async ({ page }) => {
  const f = await fixture(page, 1280, row => [row('n1', '가 노트', '2026-10-16T01:00:00Z', { folder: '자료 폴더', pinned_at: '2026-10-18T00:00:00.000Z' })]);
  await page.locator('[data-note-row="n1"]').click();
  page.once('dialog', d => d.accept());
  await page.locator('[data-note-more]').click(); await page.locator('#noteDocMenu [data-note-to-basket]').click();
  await expect.poll(() => f.writes.length).toBe(1);
  expect(f.writes[0].body).toMatchObject({ kind: 'basket', title: null, metadata: { pinned_at: '2026-10-18T00:00:00.000Z' } });
  expect(f.writes[0].query).toMatchObject({ id: 'eq.n1', kind: 'eq.note', 'metadata->>folder': 'eq.자료 폴더' });
  expect(f.errors).toEqual([]);
});

test('a note written while a folder is shown goes into that folder', async ({ page }) => {
  const f = await fixture(page, 1280, row => [row('n1', '가 노트', '2026-10-16T01:00:00Z', { folder: '자료 폴더' }), row('n2', '나 노트', '2026-10-12T01:00:00Z')]);
  await chip(page, '자료 폴더').click();
  // BASKET-노트입력창: [크게] on the note input opens the same write window (was [+ 노트]).
  await page.locator('[data-note-list] [data-quick-big]').click();
  const editor = page.locator('#mdEditor');
  await editor.locator('[data-md-title]').fill('새 자료 노트');
  await editor.locator('.md-editor-text').fill('본문');
  await editor.locator('[data-md-save-icon]').click();
  await expectNoteTitle(page,'새 자료 노트');
  await expect(page.locator('[data-note-meta-folder]')).toHaveText('폴더 자료 폴더');
  expect(f.writes.map(w => w.method || 'PATCH')).toEqual(['POST', 'PATCH']);
  expect(f.writes[1].body).toEqual({ metadata: { folder: '자료 폴더' } });
  await page.locator('[data-note-close]').click();
  expect(await titles(page)).toEqual(['새 자료 노트', '가 노트']);
  expect(f.errors).toEqual([]);
});

// UI-노트폴더 기억 (SET-보기선택서버저장): the last chosen folder is kept on the server with the other view choices (profile view_prefs.note_folder,
// view-prefs.js; no device storage), restored after another screen / a reload, and falls back to [전체] without a message when the folder is gone.
const backToNotes = async page => { await page.evaluate(() => window.KPTURouter.go('basket')); await chooseBasketKind(page,'note'); };
const two = row => [row('n1', '가 노트', '2026-10-16T01:00:00Z', { folder: '자료 폴더' }), row('n2', '나 노트', '2026-10-12T01:00:00Z', { folder: '다른 폴더' }), row('n3', '다 노트', '2026-10-10T01:00:00Z')];
test('the chosen folder is remembered on the server: other screen, reload, deleted folder', async ({ page }) => {
  const prefs = await installViewPrefsServer(page);
  const f = await fixture(page, 1280, two);
  expect(prefs.value?.note_folder ?? 'all').toBe('all');
  await chip(page, '자료 폴더').click();
  expect(await titles(page)).toEqual(['가 노트']);
  await expect.poll(() => prefs.value?.note_folder).toBe('f:자료 폴더');
  // Another screen and back: the same folder.
  // The calendar screen loads on first use and switches to itself when ready; wait for that before going back, so its late
  // switch cannot land after [노트] (it would cover the list and leave the address on the calendar for the reload).
  await page.evaluate(() => window.KPTURouter.go('calendar'));
  await expect.poll(() => page.evaluate(() => window.KPTURouter.current)).toBe('calendar');
  await backToNotes(page);
  await expect(chip(page, '자료 폴더')).toBeChecked();
  expect(await titles(page)).toEqual(['가 노트']);
  // The calendar asked for above finishes loading after [바구니] was opened: it must not take the screen or the address back.
  await expect.poll(() => page.evaluate(() => window.KPTUViewLoader.isLoaded('calendar')), { timeout: 20000 }).toBe(true);
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))));
  expect(await page.evaluate(() => [window.KPTURouter.current, new URL(location.href).searchParams.get('view')])).toEqual(['basket', 'basket']);
  // The calendar's background organization load runs on after it; a reload cutting its request would log a network error.
  await expect.poll(() => page.evaluate(() => !!window.__KPTU_SUBORGANIZATIONS_READY__), { timeout: 20000 }).toBe(true);
  expect(await page.evaluate(() => window.__KPTU_SUBORGANIZATIONS_READY__)).toBe(true);
  // Reload (app opened again): the same folder.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
  await backToNotes(page);
  await expect(chip(page, '자료 폴더')).toBeChecked();
  expect(await titles(page)).toEqual(['가 노트']);
  expect(await leftoverDeviceKeys(page)).toEqual([]);
  expect(f.errors).toEqual([]);
});

test('a remembered folder that no longer exists opens at [전체] quietly and the server value follows', async ({ page }) => {
  const prefs = await installViewPrefsServer(page);
  const f = await fixture(page, 390, two);
  await chip(page, '자료 폴더').click();
  await expect(chip(page, '자료 폴더')).toBeChecked();
  await expect.poll(() => prefs.value?.note_folder).toBe('f:자료 폴더');
  // The folder is gone (its only note was moved out elsewhere) before the app is opened again.
  f.rows.find(r => r.id === 'n1').metadata = {};
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 });
  await backToNotes(page);
  await expect(chip(page, '전체')).toBeChecked();
  expect(await titles(page)).toEqual(['가 노트', '나 노트', '다 노트']);
  await expect(page.locator('[data-note-folder-status]')).toBeHidden();
  await expect.poll(() => prefs.value?.note_folder).toBe('all');
  expect(f.errors).toEqual([]);
});

test('when the server value cannot be read or saved the note list still works', async ({ page }) => {
  await installViewPrefsServer(page, null, { failRead: true, failWrite: true });
  const f = await fixture(page, 1280, two);
  await chip(page, '자료 폴더').click();
  expect(await titles(page)).toEqual(['가 노트']);
  await chip(page, '전체').click();
  expect(await titles(page)).toEqual(['가 노트', '나 노트', '다 노트']);
  expect(f.errors).toEqual([]);
});
