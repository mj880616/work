import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { expectNoteTitle } from './helpers/note-title.mjs';
import { edWin, edWinText, typeInto } from './helpers/note-editor.mjs';

// NOTE-추가폴더표시 (2026-10-23 사용자 요청 10:42·10:43): the note input shows which folder a NEW note goes into as a small
// [폴더 ▾] button ("개발 ▾" / "폴더 없음 ▾"), the placeholder says "<폴더>에 노트 추가", and the button opens a small list right under
// it (PC) / a bottom sheet (phone) to pick another folder for this add. The ⤢ write window has the same button beside the title.
// The pick is kept while the same folder chip stays selected; another chip starts over from the chip. PC 1280 and phone 390.
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
const input = page => page.locator('[data-note-list] [data-quick-input]');
const folderBtn = page => page.locator('[data-note-list] [data-quick-folder]');
const chip = (page, name) => page.locator('[data-note-folder-filter]').getByRole('radio', { name, exact: true });
const sheet = page => page.locator('#noteAddFolderChoice');
const three = row => [row('n1', '가 노트', '2026-10-16T01:00:00Z', { folder: '개발' }), row('n2', '나 노트', '2026-10-12T01:00:00Z', { folder: '회의' }), row('n3', '다 노트', '2026-10-10T01:00:00Z')];
async function addNote(page, width, text) {
  await input(page).fill(text);
  await press(page, page.locator('[data-note-list] [data-quick-save]'), width);
}

for (const width of [1280, 390]) test(`the note input names the folder a new note goes into and [폴더 ▾] picks another ${width}`, async ({ page }, info) => {
  const f = await fixture(page, width, three);
  // 전체 → 폴더 없음.
  await expect(folderBtn(page)).toHaveText('폴더 없음 ▾');
  await expect(input(page)).toHaveAttribute('placeholder', '노트를 입력하세요');
  // A folder chip → that folder, in the button and the placeholder.
  await press(page, chip(page, '개발'), width);
  await expect(folderBtn(page)).toHaveText('개발 ▾');
  await expect(input(page)).toHaveAttribute('placeholder', '개발에 노트 추가');
  // Small text button: visible height 32px at most 36, press range kept by ::after (44px).
  const box = await folderBtn(page).boundingBox();
  expect(box.height).toBeLessThanOrEqual(36);
  expect(box.width).toBeLessThan(200);
  // The list opens right under the button on a PC (not a full-width band); the current folder is marked.
  await press(page, folderBtn(page), width);
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).locator('[aria-pressed="true"]')).toHaveText('개발');
  expect(await sheet(page).locator('button[data-sheet-value]').allTextContents()).toEqual(['개발', '회의', '폴더 없음']);
  if (width >= 761) {
    const s = await sheet(page).boundingBox();
    expect(s.width).toBeLessThan(400);
    expect(s.x).toBeLessThanOrEqual(box.x + box.width); expect(s.x + s.width).toBeGreaterThanOrEqual(box.x); // under the button (kept inside the window)
    expect(s.y).toBeGreaterThanOrEqual(box.y + box.height - 2);
  }
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/note-folder-after-${width}.png` });
  // Pick another folder for this add: the chip stays, the button and placeholder follow the pick.
  await press(page, sheet(page).getByRole('button', { name: '회의', exact: true }), width);
  await expect(sheet(page)).toBeHidden();
  await expect(folderBtn(page)).toHaveText('회의 ▾');
  await expect(input(page)).toHaveAttribute('placeholder', '회의에 노트 추가');
  await expect(chip(page, '개발')).toHaveAttribute('aria-checked', 'true');
  await addNote(page, width, '새 회의 노트');
  await expect.poll(() => f.writes.map(w => w.method || 'PATCH')).toEqual(['POST', 'PATCH']);
  expect(f.writes[1].body).toEqual({ metadata: { folder: '회의' } });
  // The pick is kept for the next add while the same chip stays selected.
  await expect(folderBtn(page)).toHaveText('회의 ▾');
  // Another chip starts over from the chip; [폴더 없음] can be picked from a folder chip too.
  await press(page, chip(page, '회의'), width);
  await expect(folderBtn(page)).toHaveText('회의 ▾');
  await press(page, chip(page, '전체'), width);
  await expect(folderBtn(page)).toHaveText('폴더 없음 ▾');
  await press(page, chip(page, '개발'), width);
  await expect(folderBtn(page)).toHaveText('개발 ▾');
  await press(page, folderBtn(page), width);
  await press(page, sheet(page).getByRole('button', { name: '폴더 없음', exact: true }), width);
  await expect(folderBtn(page)).toHaveText('폴더 없음 ▾');
  const before = f.writes.length;
  await addNote(page, width, '폴더 없는 노트');
  await expect.poll(() => f.writes.length).toBe(before + 1);
  expect(f.writes.at(-1).method).toBe('POST');
  await page.waitForTimeout(300);
  expect(f.writes.length).toBe(before + 1);
  expect(f.errors).toEqual([]);
});

for (const width of [1280, 390]) test(`with 전체 shown a folder can be picked on the input and the note goes there ${width}`, async ({ page }) => {
  const f = await fixture(page, width, three);
  await press(page, folderBtn(page), width);
  await press(page, sheet(page).getByRole('button', { name: '개발', exact: true }), width);
  await expect(folderBtn(page)).toHaveText('개발 ▾');
  await addNote(page, width, '전체에서 개발로');
  await expect.poll(() => f.writes.map(w => w.method || 'PATCH')).toEqual(['POST', 'PATCH']);
  expect(f.writes[1].body).toEqual({ metadata: { folder: '개발' } });
  expect(f.errors).toEqual([]);
});

for (const width of [1280, 390]) test(`the write window has the same [폴더 ▾] beside the title and shares the pick ${width}`, async ({ page }) => {
  const f = await fixture(page, width, three);
  await press(page, chip(page, '개발'), width);
  await press(page, page.locator('[data-note-list] [data-quick-big]'), width);
  // ED③ 노트: the note's new big window. It writes a note only (no [업데이트|노트] switch), so its [폴더 ▾] is always there.
  const editor = edWin(page);
  const wb = editor.locator('[data-edw-folder]');
  await expect(wb).toHaveText('개발 ▾');
  expect((await wb.boundingBox()).height).toBeLessThanOrEqual(36);
  await expect(editor.getByRole('button', { name: '업데이트', exact: true })).toHaveCount(0);
  await press(page, wb, width);
  await expect(sheet(page)).toBeVisible();
  await press(page, sheet(page).getByRole('button', { name: '회의', exact: true }), width);
  await expect(wb).toHaveText('회의 ▾');
  await editor.locator('[data-edw-title]').fill('창에서 쓴 노트');
  await typeInto(page, edWinText(page), '본문');
  await editor.locator('[data-edw-save]').click();
  await expectNoteTitle(page, '창에서 쓴 노트');
  await expect(page.locator('[data-note-meta-folder]')).toHaveText('폴더 회의');
  expect(f.writes.map(w => w.method || 'PATCH')).toEqual(['POST', 'PATCH']);
  expect(f.writes[1].body).toEqual({ metadata: { folder: '회의' } });
  expect(f.errors).toEqual([]);
});
