import { test, expect } from '@playwright/test';
import { start, openFiles } from './helpers/files-server.mjs';
import { bootLibrary, libFolder } from './helpers/library-folder-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
import { pinch } from './helpers/pinch.mjs';
// OPS-빠진일2차 1(S59-17, 명진 11/11 14:55 '가'): 폴더 누르기 한 규칙 — 자료실·[파일]·노트·사진의 모든 나무·목록(폰·폴드·PC).
//  ① [파일] PC·폴드 오른쪽 목록 칸도 왼쪽 나무처럼 폴더 누르기 = 그 자리 펼치기·접기(들어가기는 우클릭 [이 폴더로 들어가기]·펼친 폴더 위 두 손가락 벌리기).
//  ② 하위 폴더가 없는 폴더는 한 번 누르면 그 폴더를 연다(전에는 아무 일도 없었음). 판정은 app/folder-tree-press.mjs folderPressAction 한 곳 —
//     폴더만 보이는 나무(PC·폴드 왼쪽 나무)는 하위 폴더가 없으면 열기, 안 자료까지 들여 보이는 목록·폰 나무는 펼쳐 보일 것(하위 폴더·안 자료)이 없으면 열기.
// 화면 사진(S59_17_SHOTS=폴더): PC 1280·폰 412·폴드 884. 이름은 모두 지어낸 것이다.
const shot = async (page, name) => { if (process.env.S59_17_SHOTS) await page.screenshot({ path: `${process.env.S59_17_SHOTS}/${name}.png` }); };
const files = page => page.locator('#filesRoot');
// 가짜 빈 폴더(가짜 문서함 안): 펼쳐 보일 것이 없는 폴더.
const EMPTY = () => ({ source: 'od', item_id: 'OD!19', parent_id: 'OD!1', name: '가짜 빈 폴더', is_folder: true, mime: null, size_bytes: null, modified_at: '2026-10-01T01:00:00Z', hash: null, trashed: false, starred: false, library_doc_id: null });

// ---------- [파일] ----------
for (const width of [884, 1280]) test(`[파일] ${width}: 오른쪽 목록 폴더 누르기 = 그 자리 펼치기·접기, 하위 폴더 없는 폴더는 한 번에 열기`, async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, width);
  server.items.push(EMPTY());
  await openFiles(page, width);
  const list = files(page).locator('[data-fx-list]'), crumb = files(page).locator('[data-fx-crumb] .fx-crumb-now');
  const docs = list.locator('[data-fx-row="od:OD!1"]'), sub = list.locator('[data-fx-row="od:OD!10"]'), inFile = list.locator('[data-fx-row="od:OD!11"]'), empty = list.locator('[data-fx-row="od:OD!19"]');
  await expect(docs).toBeVisible();
  const crumb0 = (await crumb.textContent()).trim();
  // ① 하위 폴더가 있는 폴더: 누르면 그 자리에서 하위 폴더·파일이 들여 보이고(위치 줄 그대로), 다시 누르면 접힌다.
  await expect(docs).toHaveAttribute('aria-expanded', 'false');
  await docs.click();
  await expect(docs).toHaveAttribute('aria-expanded', 'true');
  await expect(sub).toBeVisible();
  await expect(inFile).toBeVisible();
  await expect(sub).toHaveClass(/fx-xin/);
  await expect(crumb).toHaveText(crumb0);
  const [a, b] = [await docs.boundingBox(), await sub.locator('.fx-ico').boundingBox()];
  expect(b.x).toBeGreaterThan(a.x + 8); // 안 줄은 들여 보인다
  await shot(page, `files-${width}-1-expand`);
  // 펼친 폴더 안 파일 누르기 = 지금처럼 고르기·미리보기(들어가지 않음)
  await docs.click();
  await expect(sub).toHaveCount(0);
  await expect(docs).toHaveAttribute('aria-expanded', 'false');
  await expect(docs).toBeFocused();
  // 키보드: → 펼치기, ← 접기, Enter = 누르기와 같음
  await docs.focus(); await page.keyboard.press('ArrowRight');
  await expect(sub).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(sub).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(sub).toBeVisible();
  // 하위 폴더 없이 파일만 든 폴더(가짜 2026)는 그 자리 펼침에 파일이 들여 보인다(한 단 더).
  await sub.click();
  await expect(sub).toHaveAttribute('aria-expanded', 'true');
  await expect(list.locator('[data-fx-row="od:OD!14"]')).toBeVisible();
  await expect(crumb).toHaveText(crumb0);
  // ② 펼친 폴더 안의 빈 폴더(펼쳐 보일 것이 없음) 누르기 = 한 번에 그 폴더로
  await empty.click();
  await expect(crumb).toHaveText('가짜 빈 폴더');
  await shot(page, `files-${width}-2-leaf-open`);
  // 들어가기는 우클릭 [이 폴더로 들어가기](하위 폴더가 있어도)
  await files(page).locator('[data-fx-crumb] [data-fx-go]').first().click();
  await expect(docs).toBeVisible();
  if (width >= 761) {
    await docs.click({ button: 'right' });
    await page.locator('#rowMenu').getByRole('button', { name: '이 폴더로 들어가기' }).click();
    await expect(crumb).toHaveText('가짜 문서함');
    await files(page).locator('[data-fx-crumb] [data-fx-go]').first().click();
  }
  // 하위 폴더 없이 파일만 든 맨 위 폴더(가짜 사진함)는 목록에서 그 자리 펼침(파일이 들여 보임)
  await list.locator('[data-fx-row="od:OD!2"]').click();
  // LIB-사진숨김(S60-10): 펼친 폴더 안 사진은 [사진 1] 하나, 누르면 그 자리(들여 보인 칸)에 작은 그림.
  await list.locator('[data-fx-photos="od:OD!2"]').click();
  await expect(list.locator('[data-fx-row="od:OD!20"]')).toBeVisible();
  await expect(list.locator('[data-fx-row="od:OD!20"]')).toHaveAttribute('data-fx-xof', 'od:OD!2');
  // 왼쪽 나무(폴더만 보임)는 하위 폴더 없는 폴더 이름 누르기 = 그 폴더 열기, 하위 폴더 있는 폴더 = 그 자리 펼치기
  await files(page).locator('[data-fx-tree] [data-fx-fold="od:OD!2"] .ft-main').click();
  await expect(crumb).toHaveText('가짜 사진함');
  const tree = files(page).locator('[data-fx-tree]'), name1 = tree.locator('[data-fx-fold="od:OD!1"] .ft-main'), tog1 = tree.locator('[data-fx-fold="od:OD!1"] > .ft-tog');
  // 앞에서 가짜 2026에 들어가 그 위 폴더(가짜 문서함)는 나무에서 펼쳐져 있다 — 누르면 접히고, 다시 누르면 펼쳐진다(들어가지 않음).
  if (await tog1.getAttribute('aria-expanded') === 'true') { await name1.click(); await expect(tog1).toHaveAttribute('aria-expanded', 'false'); }
  await name1.click();
  await expect(tog1).toHaveAttribute('aria-expanded', 'true');
  await expect(tree.locator('[data-fx-fold="od:OD!10"]')).toBeVisible();
  await expect(crumb).toHaveText('가짜 사진함');
  await tree.locator('[data-fx-fold="od:OD!10"] .ft-main').click();
  await expect(crumb).toHaveText('가짜 2026');
  expect(errors).toEqual([]);
});

test('[파일] 폴드 884: 펼친 폴더 위 두 손가락 벌리기 = 그 폴더로 들어가기, 그 밖은 지금처럼 보기 바꾸기', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await start(page, 884);
  await openFiles(page, 884);
  const list = files(page).locator('[data-fx-list]'), crumb = files(page).locator('[data-fx-crumb] .fx-crumb-now');
  const docs = list.locator('[data-fx-row="od:OD!1"]');
  await docs.click();
  await expect(list.locator('[data-fx-row="od:OD!11"]')).toBeVisible();
  await pinch(page, list.locator('[data-fx-row="od:OD!11"]'), 'out');
  await expect(crumb).toHaveText('가짜 문서함');
  expect(errors).toEqual([]);
});

test('[파일] 폰 412: 나무 폴더 누르기 — 하위 폴더 있으면 그 자리 펼치기, 없으면 그 폴더만', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 412);
  server.items.push(EMPTY());
  await openFiles(page, 412);
  const tree = files(page).locator('[data-fx-tree]');
  await tree.locator('[data-fx-tog="od:OD!1"]').click();
  await expect(tree.locator('[data-fx-fold="od:OD!10"]')).toBeVisible(); // 그 자리 펼침(화면 그대로)
  await expect(files(page)).toHaveAttribute('data-fx-pane', 'tree');
  await tree.locator('[data-fx-tog="od:OD!10"]').click(); // 파일만 든 폴더 = 그 자리 펼침(파일까지)
  await expect(tree.locator('[data-ft-parent="od:OD!10"] [data-fx-tfile]')).toHaveCount(1);
  await shot(page, 'files-412-1-expand');
  await tree.locator('[data-fx-tog="od:OD!19"]').click(); // 빈 폴더(펼쳐 보일 것 없음) → 그 폴더만
  await expect(tree).toBeHidden();
  await expect(files(page).locator('[data-fx-list]')).toContainText('빈 폴더');
  await shot(page, 'files-412-2-leaf-open');
  await page.goBack();
  await expect(tree).toBeVisible();
  // '그 폴더만' 안 하위 폴더도 같은 규칙: 하위 폴더가 있으면 그 자리 펼치기
  await pinch(page, tree.locator('[data-fx-fold="od:OD!1"]'), 'out');
  const focus = files(page).locator('[data-fx-list]');
  await focus.locator('[data-fx-row="od:OD!10"]').click();
  await expect(focus.locator('[data-fx-row="od:OD!14"]')).toBeVisible(); // 가짜 2026(파일만) = 그 자리 펼침
  await expect(files(page).locator('.ft-focus-name')).toHaveText('가짜 문서함');
  await focus.locator('[data-fx-row="od:OD!19"]').click(); // 빈 폴더 = 한 단계 들어감
  await expect(files(page).locator('.ft-focus-name')).toHaveText('가짜 빈 폴더');
  expect(errors).toEqual([]);
});

// ---------- 자료실 ----------
const FOLDERS = [libFolder('fa', 'top-a', { name: '가상 A', sort_order: 1024 }), libFolder('fc', 'child-a1', { name: '가상 C', parent_id: 'fa', sort_order: 0 }), libFolder('fn', null, { name: '가상 N', sort_order: 2048 })];
const ITEMS = [{ document_id: 'a-1', folder_id: 'fc' }, { document_id: 'n-1', folder_id: 'fa' }];
const nav = page => page.locator('#libraryFolderNav');
const tops = page => page.locator('#documentList > details').evaluateAll(xs => xs.map(x => x.dataset.luNode));
const pickGroup = (page, label) => page.locator('#libraryGroupBy').selectOption({ label });

test('자료실 PC 1280: 나무는 하위 폴더 없는 폴더, 목록은 빈 폴더를 한 번에 열기 — 그 밖은 그 자리 펼치기', async ({ page }) => {
  test.setTimeout(90000);
  const { s, errors } = await bootLibrary(page, 1280, { folders: FOLDERS, items: ITEMS });
  await pickGroup(page, '폴더');
  // 왼쪽 나무: 가상 A(하위 있음) = 펼침, 가상 C(하위 없음) = 한 번에 열기
  await nav(page).locator('[data-lu-nav="fa"]').click();
  await expect(nav(page).locator('[data-lu-nav="fc"]')).toBeVisible();
  await expect.poll(() => tops(page)).toEqual(['x:out', 'f:fa', 'f:fn']);
  await nav(page).locator('[data-lu-nav="fc"]').click();
  await expect.poll(() => tops(page)).toEqual(['f:fc']);
  await expect(nav(page).locator('[data-lu-nav="fc"]')).toHaveAttribute('aria-current', 'true');
  await shot(page, 'library-1280-1-tree-leaf');
  // 오른쪽 목록: 맨 위로 돌아와 가상 N(하위 없음) 머리 누르기 = 그 폴더 열기, 가상 A 머리 = 지금처럼 펼치기·접기
  await nav(page).locator('[data-lu-nav=""]').click();
  await expect.poll(() => tops(page)).toEqual(['x:out', 'f:fa', 'f:fn']);
  const head = id => page.locator(`#documentList details[data-lu-node="f:${id}"] > summary`);
  const openA = await page.locator('#documentList details[data-lu-node="f:fa"]').evaluate(d => d.open);
  await head('fa').click();
  await expect.poll(() => page.locator('#documentList details[data-lu-node="f:fa"]').evaluate(d => d.open)).toBe(!openA);
  await expect.poll(() => tops(page)).toEqual(['x:out', 'f:fa', 'f:fn']);
  await head('fn').click();
  await expect.poll(() => tops(page)).toEqual(['f:fn']);
  expect(s.writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('자료실 두 칸 884: 칸 안 빈 폴더 누르기 = 그 칸에서 열기, 자료만 든 폴더 = 그 자리 펼침', async ({ page }) => {
  test.setTimeout(90000);
  const { s, errors } = await bootLibrary(page, 884, { folders: FOLDERS, items: ITEMS });
  await pickGroup(page, '폴더');
  const btn = page.locator('#libraryTwoBtn');
  await expect(btn).toBeVisible();
  if (await btn.getAttribute('aria-pressed') !== 'true') await btn.click();
  const right = page.locator('[data-lu-pane-i="1"]');
  await expect(right.locator('[data-lu-nav="fa"]')).toBeVisible();
  await right.locator('[data-lu-nav="fa"]').click(); // 하위 있음 = 그 칸 안 펼치기
  await expect(right.locator('[data-lu-nav="fc"]')).toBeVisible();
  await expect(right.locator('.lu-pane-here')).toHaveText('자료실');
  await shot(page, 'library-884-two-1-expand');
  await right.locator('[data-lu-nav="fc"]').click(); // 자료만 든 폴더 = 그 칸 안 펼침(펼친 폴더 안 놓기 그대로)
  await expect(right.locator('[data-lu-pane-sub="fc"]')).toBeVisible();
  await expect(right.locator('.lu-pane-here')).toHaveText('자료실');
  await right.locator('[data-lu-nav="fn"]').click(); // 빈 폴더 = 그 칸에서 열기
  await expect(right.locator('.lu-pane-here')).toHaveText('가상 N');
  await shot(page, 'library-884-two-2-leaf-open');
  expect(s.writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('자료실 폰 412: 목록 폴더 머리 — 빈 폴더는 한 번에 그 폴더', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await bootLibrary(page, 412, { folders: FOLDERS, items: ITEMS });
  await pickGroup(page, '폴더');
  await expect.poll(() => tops(page)).toEqual(['x:out', 'f:fa', 'f:fn']);
  await page.locator('#documentList details[data-lu-node="f:fn"] > summary').click();
  await expect.poll(() => tops(page)).toEqual(['f:fn']);
  await shot(page, 'library-412-leaf-open');
  expect(errors).toEqual([]);
});

// ---------- 노트 ----------
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const note = (id, title, t, metadata = {}) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문', occurred_at: t, created_at: t, updated_at: t, archived_at: null, ai_export_allowed: true, attachments: [], metadata });
async function notes(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  await installViewPrefsServer(page);
  const folders = [
    { id: U(1), workspace_id: 'w', parent_id: null, name: '가상 메모', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: U(2), workspace_id: 'w', parent_id: null, name: '가상 개발', sort_order: 2048, created_at: '2026-10-01T00:00:00Z' },
    { id: U(3), workspace_id: 'w', parent_id: U(1), name: '가상 회의', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' },
    { id: U(4), workspace_id: 'w', parent_id: null, name: '가상 빈 폴더', sort_order: 3072, created_at: '2026-10-01T00:00:00Z' },
  ];
  const rows = [note('a1', '가상 노트 1', '2026-10-02T01:00:00Z', { folder_id: U(1), folder: '가상 메모' }), note('b1', '가상 개발 노트', '2026-10-04T01:00:00Z', { folder_id: U(2), folder: '가상 개발' }), note('c1', '가상 회의 노트', '2026-10-05T01:00:00Z', { folder_id: U(3), folder: '가상 회의' })];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(rows) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await expect(page.locator('[data-nx-count]')).toHaveText('노트 · 3');
  return { errors };
}
for (const width of [884, 1280]) test(`노트 ${width}: 나무 폴더 누르기 — 하위 폴더 있으면 펼치기, 없으면 한 번에 그 폴더`, async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await notes(page, width);
  const tree = page.locator('[data-nx-tree]');
  await tree.locator(`[data-nx-folder="${U(1)}"] .ft-main`).click();
  await expect(tree.locator(`[data-nx-folder="${U(3)}"]`)).toBeVisible();
  await expect(tree.locator(`[data-nx-folder="${U(1)}"]`)).not.toHaveClass(/ft-current/);
  await tree.locator(`[data-nx-folder="${U(2)}"] .ft-main`).click();
  await expect(page.locator('[data-nx-here]')).toHaveText('가상 개발 · 1');
  await expect(page.locator('#noteRows [data-note-row]')).toHaveCount(1);
  await shot(page, `notes-${width}-leaf-open`);
  await tree.locator(`[data-nx-folder="${U(3)}"] .ft-main`).click();
  await expect(page.locator('[data-nx-here]')).toHaveText('가상 회의 · 1');
  expect(errors).toEqual([]);
});
test('노트 폰 412: 폴더 누르기 — 펼쳐 보일 것(하위 폴더·노트)이 있으면 그 자리 펼치기, 빈 폴더는 그 폴더만', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await notes(page, 412);
  const rows = page.locator('#noteRows');
  await rows.locator(`[data-nx-folder="${U(1)}"] .ft-main`).click();
  await expect(rows.locator(`[data-nx-folder="${U(3)}"]`)).toBeVisible();
  await expect(rows.locator('.ft-focus')).toHaveCount(0);
  await rows.locator(`[data-nx-folder="${U(2)}"] .ft-main`).click(); // 노트만 든 폴더 = 그 자리 펼침(노트까지)
  await expect(rows.locator(`[data-ft-parent="${U(2)}"] [data-note-row]`)).toHaveCount(1);
  await expect(rows.locator('.ft-focus')).toHaveCount(0);
  await rows.locator(`[data-nx-folder="${U(4)}"] .ft-main`).click(); // 빈 폴더 = 그 폴더만
  await expect(rows.locator('.ft-focus')).toBeVisible();
  await shot(page, 'notes-412-leaf-open');
  await page.goBack();
  await expect(rows.locator('.ft-focus')).toHaveCount(0);
  expect(errors).toEqual([]);
});

// ---------- 사진 ----------
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const media = (id, parent, day) => ({ id, parent, name: id + '.jpg', day, taken_at: `${day}T03:00:00.000Z`, approx: false, kind: 'photo', screenshot: false, duration_ms: null });
async function photos(page, width) {
  const state = { errors: [], folders: [{ id: 'S1', name: '가상 2026', parent_id: 'T' }, { id: 'S2', name: '가상 여행', parent_id: 'T' }, { id: 'S21', name: '가상 제주', parent_id: 'S2' }, { id: 'S3', name: '가상 빈 폴더', parent_id: 'T' }],
    media: [media('A1', 'T', '2026-10-05'), media('B1', 'S1', '2026-10-03'), media('B2', 'S1', '2026-10-02'), media('C1', 'S21', '2026-09-20')] };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.setViewportSize({ width, height: 900 });
  await openHome(page);
  await installViewPrefsServer(page);
  await page.route(u => u.origin === SB && ['/rest/v1/app_diary_stars', '/rest/v1/app_photo_tags', '/rest/v1/app_photo_tag_items'].includes(u.pathname), r => r.fulfill({ json: [] }));
  const total = id => state.media.filter(m => m.parent === id).length + state.folders.filter(f => f.parent_id === id).reduce((n, f) => n + total(f.id), 0);
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
    const body = r.request().postDataJSON();
    if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '가상 카메라' }, can_delete: true } });
    if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false } });
    if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': 3, '2026-09': 1 }, total: 4 } });
    if (body.action === 'library') {
      const list = state.media.filter(m => (body.folder_id ? m.parent === body.folder_id : true)).sort((a, b) => b.taken_at.localeCompare(a.taken_at));
      return r.fulfill({ json: { items: list.slice(0, body.limit).map(({ parent, ...m }) => m), next_cursor: null, indexing: false } });
    }
    if (body.action === 'folders-tree') return r.fulfill({ json: { top: { id: 'T', name: '가상 카메라', count: 1, total: total('T') }, folders: state.folders.map(f => ({ ...f, enabled: true, count: state.media.filter(m => m.parent === f.id).length, total: total(f.id) })), indexing: false } });
    return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
  });
  await clickView(page, 'photos');
  await expect(page.locator('#photosView')).toBeVisible();
  await page.locator('#photosRoot [data-photos-view]').selectOption('folders');
  return state;
}
const ph = page => page.locator('#photosRoot');
const photoIds = page => ph(page).locator('[data-photos-open]').evaluateAll(list => list.map(b => b.dataset.photosId));
test('사진 PC 1280: 나무 폴더 누르기 — 하위 폴더 있으면 펼치기, 없으면 한 번에 그 폴더', async ({ page }) => {
  test.setTimeout(90000);
  const f = await photos(page, 1280);
  const tree = ph(page).locator('[data-photos-fx-tree]');
  await expect(tree.locator('.nx-name')).toHaveText(['가상 카메라', '가상 2026', '가상 빈 폴더', '가상 여행']);
  await tree.locator('[data-photos-fx-open="S2"]').click();
  await expect(tree.locator('.nx-name')).toHaveText(['가상 카메라', '가상 2026', '가상 빈 폴더', '가상 여행', '가상 제주']);
  await expect(tree.locator('[data-photos-folder="S2"]')).not.toHaveClass(/nx-current/);
  await tree.locator('[data-photos-fx-open="S1"]').click();
  await expect(tree.locator('[data-photos-folder="S1"]')).toHaveClass(/nx-current/);
  await expect.poll(() => photoIds(page)).toEqual(['B1', 'B2']);
  await shot(page, 'photos-1280-leaf-open');
  expect(f.errors).toEqual([]);
});
for (const width of [412, 884]) test(`사진 ${width}: 폴더 누르기 — 펼쳐 보일 것(하위 폴더·사진)이 있으면 그 자리 펼치기, 빈 폴더는 그 폴더만`, async ({ page }) => {
  test.setTimeout(90000);
  const f = await photos(page, width);
  const box = ph(page).locator('[data-photos-box="onedrive"]');
  await expect(box.locator('.ft-folder .ft-name')).toHaveText(['가상 2026', '가상 빈 폴더', '가상 여행']);
  await box.locator('[data-photos-ftog="o:S2"]').click();
  await expect(box.locator('.ft-folder .ft-name')).toHaveText(['가상 2026', '가상 빈 폴더', '가상 여행', '가상 제주']);
  await expect(ph(page).locator('.photos-fx-path')).toHaveCount(0);
  await box.locator('[data-photos-ftog="o:S1"]').click(); // 사진만 든 폴더 = 그 자리 펼침(사진 한 줄)
  await expect(ph(page).locator('[data-photos-strip="o:S1"]')).toBeVisible();
  await expect(ph(page).locator('.photos-fx-path')).toHaveCount(0);
  await box.locator('[data-photos-ftog="o:S3"]').click(); // 빈 폴더 = 그 폴더만
  await expect(ph(page).locator('.photos-fx-path')).toBeVisible();
  await shot(page, `photos-${width}-leaf-open`);
  await page.goBack();
  await expect(ph(page).locator('.photos-fx-path')).toHaveCount(0);
  expect(f.errors).toEqual([]);
});
