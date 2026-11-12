import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { start, openFiles } from './helpers/files-server.mjs';
import { bootLibrary, libFolder } from './helpers/library-folder-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
// UI-폴더펼치면위로(S61-7, 요청함 11/13 04:24): 나무를 아래로 내려 아래쪽 폴더를 눌러 펼치고 접어도 나무가 맨 위로 가지 않고,
// 누른 폴더가 화면에서 같은 높이에 남는다 — 자료실·[파일]·노트·사진, 폰 412·폴드 884·PC 1280. 다시 그려도 자리를 지키는 일은
// 공용 부품 한 곳(app/folder-tree-press.mjs ftKeepPlace). 화면 사진(S61_7_SHOTS=폴더): 펼치기 전·후. 이름은 모두 지어낸 것이다.
const SHOTS = process.env.S61_7_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };
const N = 40;

// 누른 줄을 그 줄이 든 스크롤 상자(없으면 화면)의 가운데까지 내려 둔다.
async function scrollToMiddle(page, row) {
  const inView = async () => { const y = (await row.boundingBox())?.y; return y > 200 && y < page.viewportSize().height - 200 ? y : null; };
  for (let i = 0; i < 8; i++) {
    await expect(row).toBeVisible();
    const y = await inView();
    if (y !== null) return y;
    await row.evaluate((el, step) => {
      let box = null;
      for (let e = el.parentElement; e && !box; e = e.parentElement) if (/(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 20) box = e;
      if (box && step % 2 === 0) { const r = box.getBoundingClientRect(); box.scrollTo({ top: box.scrollTop + el.getBoundingClientRect().top - (r.top + r.height / 2), behavior: 'instant' }); }
      else window.scrollBy({ top: el.getBoundingClientRect().top - innerHeight / 2, behavior: 'instant' });
    }, i);
    await page.waitForTimeout(100);
  }
  throw new Error('줄을 가운데로 내리지 못함');
}
// 누르기 전후 그 줄의 화면 높이·그 줄을 품은 스크롤 상자 위치가 같다(늦게 그리기까지 기다린 뒤에도).
async function pressStays(page, row, { press = row, open, shots = '' } = {}) {
  const y0 = await scrollToMiddle(page, row);
  if (shots) await shot(page, `${shots}-1-before`);
  await press.click();
  await open();
  await page.waitForTimeout(400); // 하위 폴더를 읽어 온 뒤 한 번 더 그리는 때까지
  expect(Math.abs((await row.boundingBox()).y - y0)).toBeLessThanOrEqual(2);
  if (shots) await shot(page, `${shots}-2-after`);
  return y0;
}

// ---------- 자료실 ----------
const LIB = Array.from({ length: N }, (_, i) => [libFolder('f' + i, null, { name: '가상 폴더 ' + String(i).padStart(2, '0'), sort_order: 1024 * (i + 1) }), libFolder('c' + i, null, { name: '가상 하위 ' + i, parent_id: 'f' + i, sort_order: 0 })]).flat();
async function library(page, width, two = false) {
  const r = await bootLibrary(page, width, { folders: LIB, items: [] });
  await page.locator('#libraryGroupBy').selectOption({ label: '폴더' });
  const btn = page.locator('#libraryTwoBtn');
  if (width >= 761 || two) { await expect(btn).toBeVisible(); if ((await btn.getAttribute('aria-pressed') === 'true') !== two) await btn.click(); }
  return r;
}
for (const width of [1280, 884]) test(`자료실 ${width}: 왼쪽 나무를 내려 아래 폴더를 펼치고 접어도 그 자리`, async ({ page }) => {
  test.setTimeout(90000);
  const { errors, s } = await library(page, width);
  const nav = page.locator('#libraryFolderNav'), row = nav.locator('[data-lu-nav="f22"]'), kid = nav.locator('[data-lu-nav="c22"]');
  await expect(row).toBeVisible();
  const box = nav.locator('.lu-fnav-in');
  const same = await box.elementHandle();
  await pressStays(page, row, { open: () => expect(kid).toBeVisible(), shots: `library-${width}` });
  expect(await box.evaluate(b => b.scrollTop)).toBeGreaterThan(100);
  expect(await same.evaluate(b => b.isConnected)).toBe(true); // 스크롤 상자는 그대로, 안쪽만 바뀐다
  await pressStays(page, row, { open: () => expect(kid).toHaveCount(0) });
  // 아이콘 누르기도 같다
  await pressStays(page, row, { press: nav.locator('[data-lu-nav-tog="f22"]'), open: () => expect(kid).toBeVisible() });
  expect(s.writes).toEqual([]);
  expect(errors).toEqual([]);
});
test('자료실 두 칸 884: 칸 안을 내려 폴더를 펼치고 접어도 그 자리(두 칸 모두)', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await library(page, 884, true);
  for (const i of ['0', '1']) {
    const pane = page.locator(`[data-lu-pane-i="${i}"]`), row = pane.locator('[data-lu-nav="f22"]'), kid = pane.locator('[data-lu-nav="c22"]');
    await expect(row).toBeVisible();
    await pressStays(page, row, { open: () => expect(kid).toBeVisible() });
    await pressStays(page, row, { open: () => expect(kid).toHaveCount(0) });
  }
  expect(errors).toEqual([]);
});
test('자료실 폰 412: 목록 폴더 묶음을 아래에서 펼치고 접어도 그 자리', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await library(page, 412);
  const d = page.locator('#documentList details[data-lu-node="f:f22"]'), row = d.locator('> summary');
  const open0 = await d.evaluate(x => x.open);
  await pressStays(page, row, { open: () => expect.poll(() => d.evaluate(x => x.open)).toBe(!open0), shots: 'library-412' });
  await pressStays(page, row, { open: () => expect.poll(() => d.evaluate(x => x.open)).toBe(open0) });
  expect(errors).toEqual([]);
});

// ---------- [파일] ----------
const fold = o => ({ parent_id: null, is_folder: true, mime: null, size_bytes: null, modified_at: '2026-10-01T01:00:00Z', hash: null, trashed: false, starred: false, library_doc_id: null, source: 'od', ...o });
const manyFolders = (server, parent = null) => { for (let i = 0; i < N; i++) server.items.push(fold({ item_id: 'OD!' + (100 + i), parent_id: parent, name: '가짜 폴더 ' + String(i).padStart(2, '0') }), fold({ item_id: 'OD!' + (200 + i), parent_id: 'OD!' + (100 + i), name: '가짜 하위 ' + i })); };
for (const width of [1280, 884, 412]) test(`[파일] ${width}: 나무를 내려 아래 폴더를 펼치고 접어도 그 자리`, async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, width);
  manyFolders(server);
  await openFiles(page, width);
  const tree = page.locator('#filesRoot [data-fx-tree]'), row = tree.locator('[data-fx-fold="od:OD!122"] > .ft-main'), kid = tree.locator('[data-fx-fold="od:OD!222"]');
  await expect(row).toBeVisible();
  await pressStays(page, row, { open: () => expect(kid).toBeVisible(), shots: `files-${width}` });
  await pressStays(page, row, { open: () => expect(kid).toHaveCount(0) });
  expect(errors).toEqual([]);
});
test('[파일] 두 칸 884: 칸 안을 내려 폴더를 펼치고 접어도 그 자리', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 884);
  manyFolders(server, 'OD!1');
  await openFiles(page, 884, { two: true });
  const b = page.locator('#filesRoot [data-fx-two]');
  if ((await b.textContent()).trim() === '두 칸 보기') await b.click();
  const col = page.locator('#filesRoot [data-fx-pane-i="0"]');
  await col.locator('[data-fx-row="od:OD!1"]').click({ button: 'right' });
  await page.locator('#rowMenu').getByRole('button', { name: '이 폴더로 들어가기' }).click();
  const row = col.locator('[data-fx-row="od:OD!122"]'), kid = col.locator('[data-fx-row="od:OD!222"]');
  await expect(row).toBeVisible();
  await pressStays(page, row, { open: () => expect(kid).toBeVisible() });
  await pressStays(page, row, { open: () => expect(kid).toHaveCount(0) });
  expect(errors).toEqual([]);
});
test('[파일] 받을 곳 창 1280: 창 안 나무를 내려 폴더를 펼치고 접어도 그 자리', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 1280);
  manyFolders(server);
  await openFiles(page, 1280);
  await page.locator('#filesRoot [data-fx-tree] [data-fx-fold="od:OD!1"] > .ft-main').click({ button: 'right' });
  await page.locator('#rowMenu').getByRole('button', { name: '이 폴더로 들어가기' }).click();
  const file = page.locator('#filesRoot [data-fx-row="od:OD!11"]');
  await file.click({ button: 'right' });
  await page.locator('#rowMenu').getByRole('button', { name: /옮기기/ }).first().click();
  const sheet = page.locator('#filesRoot [data-fx-dest]');
  await expect(sheet).toBeVisible();
  const top = sheet.locator('[data-fx-dest-twist="od:"]').first();
  if (await top.getAttribute('aria-expanded') !== 'true') await top.click();
  const twist = sheet.locator('[data-fx-dest-twist="od:OD!122"]'), kid = sheet.locator('[data-fx-dest-pick="od:OD!222"]');
  await expect(twist).toBeVisible();
  await pressStays(page, twist, { open: () => expect(kid).toBeVisible() });
  expect(await sheet.locator('.fx-dest-tree').evaluate(b => b.scrollTop)).toBeGreaterThan(100);
  await pressStays(page, twist, { open: () => expect(kid).toHaveCount(0) });
  expect(errors).toEqual([]);
});

// ---------- 노트 ----------
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const note = (id, title, t, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문', occurred_at: t, created_at: t, updated_at: t, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
for (const width of [1280, 884, 412]) test(`노트 ${width}: 나무를 내려 아래 폴더를 펼치고 접어도 그 자리`, async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  await installViewPrefsServer(page);
  const folders = [], rows = [];
  for (let i = 0; i < N; i++) {
    folders.push({ id: U(100 + i), workspace_id: 'w', parent_id: null, name: '가상 폴더 ' + String(i).padStart(2, '0'), sort_order: 1024 * (i + 1), created_at: '2026-10-01T00:00:00Z' }, { id: U(200 + i), workspace_id: 'w', parent_id: U(100 + i), name: '가상 하위 ' + i, sort_order: 0, created_at: '2026-10-01T00:00:00Z' });
    rows.push(note('n' + i, '가상 노트 ' + i, '2026-10-02T01:00:00Z', { folder_id: U(200 + i) }));
  }
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(rows) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  const row = page.locator(`[data-nx-folder="${U(122)}"] .ft-main:visible`), kid = page.locator(`[data-nx-folder="${U(222)}"]:visible`);
  await expect(row).toBeVisible();
  await pressStays(page, row, { open: () => expect(kid).toBeVisible() });
  await pressStays(page, row, { open: () => expect(kid).toHaveCount(0) });
  expect(errors).toEqual([]);
});

// ---------- 사진 ----------
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
for (const width of [1280, 884, 412]) test(`사진 ${width}: 폴더 나무를 내려 아래 폴더를 펼치고 접어도 그 자리`, async ({ page }) => {
  test.setTimeout(90000);
  const folders = [], media = [], errors = [];
  for (let i = 0; i < N; i++) {
    folders.push({ id: 'S' + i, name: '가상 폴더 ' + String(i).padStart(2, '0'), parent_id: 'T' }, { id: 'K' + i, name: '가상 하위 ' + i, parent_id: 'S' + i });
    media.push({ id: 'M' + i, parent: 'K' + i, name: 'm.jpg', day: '2026-10-01', taken_at: '2026-10-01T03:00:00.000Z', approx: false, kind: 'photo', screenshot: false, duration_ms: null });
  }
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width, height: 900 });
  await openHome(page);
  await installViewPrefsServer(page);
  await page.route(u => u.origin === SB && ['/rest/v1/app_diary_stars', '/rest/v1/app_photo_tags', '/rest/v1/app_photo_tag_items'].includes(u.pathname), r => r.fulfill({ json: [] }));
  const total = id => media.filter(m => m.parent === id).length + folders.filter(f => f.parent_id === id).reduce((n, f) => n + total(f.id), 0);
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
    const body = r.request().postDataJSON();
    if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '가상 카메라' }, can_delete: true } });
    if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false } });
    if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': N }, total: N } });
    if (body.action === 'library') { const list = media.filter(m => (body.folder_id ? m.parent === body.folder_id : true)); return r.fulfill({ json: { items: list.slice(0, body.limit).map(({ parent, ...m }) => m), next_cursor: null, indexing: false } }); }
    if (body.action === 'folders-tree') return r.fulfill({ json: { top: { id: 'T', name: '가상 카메라', count: 0, total: total('T') }, folders: folders.map(f => ({ ...f, enabled: true, count: media.filter(m => m.parent === f.id).length, total: total(f.id) })), indexing: false } });
    return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
  });
  await clickView(page, 'photos');
  await page.locator('#photosRoot [data-photos-view]').selectOption('folders');
  const root = page.locator('#photosRoot');
  const wide = width >= 1200;
  const row = wide ? root.locator('[data-photos-fx-tree] [data-photos-fx-open="S22"]') : root.locator('[data-photos-ftog="o:S22"]');
  const kid = wide ? root.locator('[data-photos-fx-tree] [data-photos-folder="K22"]') : root.locator('[data-photos-ftog="o:K22"]');
  await expect(row).toBeVisible();
  await pressStays(page, row, { open: () => expect(kid).toBeVisible() });
  await pressStays(page, row, { open: () => expect(kid).toHaveCount(0) });
  expect(errors).toEqual([]);
});
