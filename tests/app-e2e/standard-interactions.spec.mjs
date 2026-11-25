import { test, expect } from '@playwright/test';
import { appOrigin } from './helpers/test-origin.mjs';
import { bootLibrary, libFolder, libDoc, openMove, movePicker, pickMove } from './helpers/library-folder-server.mjs';
import { expandLibraryTree, revealLibraryRow } from './helpers/library-tree.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
import { start as startFiles, openFiles, treeGo, enterRow } from './helpers/files-server.mjs';
import { touchDrag } from './helpers/touch-drag.mjs';
import { boardFixture, nbNode, nbBox } from './helpers/note-board-fixture.mjs';
// STD-기본동작(docs/design/standard-interactions.md): 윈도우 탐색기·구글 드라이브·노션에서 당연한 기본 동작을 화면마다 같은 시험으로 반복 확인한다.
// 기준표 항목 ID(K4·D4·S6·Z3…)를 시험 이름 앞에 붙인다. 새 목록·나무 화면이 생기면 아래 SCREENS 표에 한 줄 더한다.
// 이름은 모두 지어낸 것이다. 서버 쓰기는 없다(가짜 서버).

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const N = 6;

// ---------- 화면 열기(나무가 있는 화면) ----------
async function library(page, width, { first = '' } = {}) {
  const folders = Array.from({ length: N }, (_, i) => libFolder('f' + i, null, { name: (i === 0 && first) || '가상 폴더 ' + i, sort_order: 1024 * (i + 1) }));
  const r = await bootLibrary(page, width, { folders, items: [] });
  await page.locator('#libraryGroupBy').selectOption({ label: '폴더' });
  return { errors: r.errors, tree: page.locator('#libraryFolderNav [role="tree"]'), main: '.ft-row .ft-main' };
}
async function notes(page, width, { first = '' } = {}) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  await installViewPrefsServer(page);
  const folders = Array.from({ length: N }, (_, i) => ({ id: U(100 + i), workspace_id: 'w', parent_id: null, name: (i === 0 && first) || '가상 폴더 ' + i, sort_order: 1024 * (i + 1), created_at: '2026-10-01T00:00:00Z' }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  return { errors, tree: page.locator('[data-nx-tree][role="tree"]'), main: '.ft-row .ft-main' };
}
async function photos(page, width, { first = '' } = {}) {
  const folders = Array.from({ length: N }, (_, i) => ({ id: 'S' + i, name: (i === 0 && first) || '가상 폴더 ' + i, parent_id: 'T' }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width, height: 900 });
  await openHome(page);
  await installViewPrefsServer(page);
  await page.route(u => u.origin === SB && ['/rest/v1/app_diary_stars', '/rest/v1/app_photo_tags', '/rest/v1/app_photo_tag_items'].includes(u.pathname), r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
    const body = r.request().postDataJSON();
    if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '가상 카메라' }, can_delete: true } });
    if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false } });
    if (body.action === 'months') return r.fulfill({ json: { months: {}, total: 0 } });
    if (body.action === 'library') return r.fulfill({ json: { items: [], next_cursor: null, indexing: false } });
    if (body.action === 'folders-tree') return r.fulfill({ json: { top: { id: 'T', name: '가상 카메라', count: 0, total: 0 }, folders: folders.map(f => ({ ...f, enabled: true, count: 0, total: 0 })), indexing: false } });
    return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
  });
  await clickView(page, 'photos');
  await page.locator('#photosRoot [data-photos-view]').selectOption('folders');
  return { errors, tree: page.locator('#photosRoot [data-photos-fx-tree][role="tree"]'), main: '.ft-row .ft-main' };
}
const SCREENS = [['자료실', library], ['노트', notes], ['사진', photos]];

// L2(UI-긴폴더이름 S70-19): PC 나무에서 … 로 잘린 폴더 이름은 마우스를 올리면 전체 이름이 보인다(이름 칸 title = 전체 이름).
// 공용 줄 app/folder-tree-ui.mjs ftFolderRowHtml 한 곳. 새 나무 화면이 생기면 LONG_SCREENS에 한 줄 더한다({tree, name 그 폴더 이름 칸}).
const LONG = '가상 "아주" 긴 폴더 & 이름 '.repeat(4) + '끝';
async function filesLong(page, width) {
  const { errors, server } = await startFiles(page, width);
  server.items.find(i => i.item_id === 'OD!1').name = LONG;
  await openFiles(page, width);
  const tree = page.locator('#filesRoot [data-fx-tree]');
  return { errors, name: tree.locator('[data-fx-fold="od:OD!1"] .ft-name') };
}
const longOf = open => async (page, width) => {
  const { errors, tree } = await open(page, width, { first: LONG });
  return { errors, name: tree.locator('.ft-row .ft-name').filter({ hasText: '끝' }).first() };
};
const LONG_SCREENS = [['자료실', longOf(library)], ['파일', filesLong], ['노트', longOf(notes)], ['사진', longOf(photos)]];
for (const [name, open] of LONG_SCREENS) test(`L2 ${name} PC 1280: 잘린 폴더 이름에 전체 이름(title)`, async ({ page }) => {
  const s = await open(page, 1280);
  await expect(s.name).toBeVisible();
  // 정말 … 로 잘려 보이는지(글자 폭 > 보이는 폭) 먼저 본다 — 안 잘리면 이 시험이 뜻이 없다.
  await expect.poll(() => s.name.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(s.name).toHaveAttribute('title', LONG);
  expect(s.errors).toEqual([]);
});

// K4: 왼쪽 폴더 나무에서 ↑↓ = 보이는 앞·뒤 줄로 커서 이동(공용 app/folder-tree-press.mjs ftTreeArrow).
for (const [name, open] of SCREENS) test(`K4 ${name} PC 1280: 폴더 나무에서 ↑↓로 줄을 옮겨 다닌다`, async ({ page }) => {
  const { errors, tree, main } = await open(page, 1280);
  await expect(tree).toBeVisible();
  const rows = tree.locator(main);
  await expect.poll(() => rows.count()).toBeGreaterThan(3);
  const label = () => page.evaluate(() => document.activeElement?.textContent?.trim() || '');
  await rows.nth(1).focus();
  const first = await label();
  await page.keyboard.press('ArrowDown');
  const second = await label();
  expect(second).not.toBe(first);
  expect(await rows.nth(2).evaluate(el => el === document.activeElement)).toBe(true);
  await page.keyboard.press('ArrowUp');
  expect(await label()).toBe(first);
  // 나무 안에서 ↑↓는 페이지를 굴리지 않는다(기본 동작 막음).
  expect(errors).toEqual([]);
});

// Z3: 폰 360·412, PC 1280에서 화면이 옆으로 넘치지 않는다(가로 스크롤 없음).
for (const [name, open] of SCREENS) for (const width of [360, 412, 1280]) test(`Z3 ${name} ${width}: 가로로 넘치지 않는다`, async ({ page }) => {
  const { errors } = await open(page, width);
  await page.waitForTimeout(300);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

// D4: 끄는 중 Esc = 취소(제자리, 저장 없음). 조직 보고 묶음 끌기(app/org-groups-drag.js).
const orgBase = `${appOrigin}/tests/app-e2e/suborganization-filters-canonical-fixture.html`;
test('D4 조직 1280: 조직을 끄는 중 Esc를 누르면 놓아도 옮겨지지 않는다', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(orgBase + '?orgs=order');
  const heads = page.locator('.so-group-heading');
  await expect(heads.first()).toBeVisible();
  const before = await heads.allTextContents();
  const prefs = () => page.evaluate(() => JSON.stringify(window.__orgOrderPrefs?.org_order ?? null));
  const saved = await prefs();
  const grip = page.locator('#soOrganizationList .so-org-group[data-so-group="민자철도"] [data-so-grip="group"]');
  const target = page.locator('#soOrganizationList .so-org-group[data-so-group="철도"] .so-group-heading');
  const a = await grip.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 12, { steps: 3 });
  const b = await target.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 6, { steps: 8 });
  await expect(page.locator('#soOrganizationList')).toHaveClass(/is-dragging/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#soOrganizationList')).not.toHaveClass(/is-dragging/);
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await prefs()).toBe(saved);
  await expect(heads).toHaveText(before);
  expect(errors).toEqual([]);
});

// ---------- H. 머리 줄이 있는 목록(UI-머리눌러정렬, 명진 11/24 15:47) ----------
// H1: 머리 칸(이름·바뀐 날·크기·종류)을 누르면 그 칸 오름차순 → 다시 누르면 내림차순. 지금 칸에 ▲/▼·aria-sort, Enter·Space로도.
// 폴더는 늘 위. 너비 손잡이를 눌러도 정렬되지 않는다. 정렬 고르기(오른쪽 위)와 같은 값. 서버(view_prefs.files_sort)에 기억해 다시 열어도 그대로.
// 폰(600 미만)은 머리 줄이 없는 두 줄 목록이라(예전 결정) 같은 값을 정렬 고르기로 바꾼다.
// 새 머리 줄 목록이 생기면 HEAD_SCREENS에 한 줄 더한다(전수 조사: docs/design/standard-interactions.md 9절).
async function filesList(page, width) {
  const prefs = await installViewPrefsServer(page);
  const { errors } = await startFiles(page, width);
  const open = async () => {
    await openFiles(page, width);
    const inside = page.locator('#filesRoot [data-fx-list] [data-fx-row="od:OD!11"]');
    // 다시 열 때는 마지막에 연 폴더(files_last)로 바로 열릴 수 있다.
    await page.waitForTimeout(400);
    if (!(await inside.isVisible())) {
      await treeGo(page, 'od');
      await enterRow(page, page.locator('#filesRoot [data-fx-list] [data-fx-row="od:OD!1"]'));
    }
    await expect(inside).toBeVisible();
  };
  await open();
  const list = page.locator('#filesRoot [data-fx-list]');
  return { errors, prefs, open, saved: () => prefs.value?.files_sort ?? null,
    names: () => list.locator('[data-fx-row] :is(.fx-name, .ft-name)').allTextContents(),
    head: key => list.locator(`.fx-head [data-head-sort="${key}"]`),
    select: page.locator('#filesRoot .fx-top [data-fx-sort]'),
    // 가짜 문서함: 폴더 '가짜 2026' + 메모(3KB, 9/20)·안내문(1.2MB, 10/5)·예산표(62KB, 10/6)
    order: { name: ['가짜 2026', '가짜 메모.txt', '가짜 안내문.pdf', '가짜 예산표.xlsx'], size: ['가짜 2026', '가짜 메모.txt', '가짜 예산표.xlsx', '가짜 안내문.pdf'],
      modified: ['가짜 2026', '가짜 메모.txt', '가짜 안내문.pdf', '가짜 예산표.xlsx'] } };
}
const HEAD_SCREENS = [['파일', filesList]];
const flip = list => [list[0], ...list.slice(1).reverse()];

for (const [name, open] of HEAD_SCREENS) test(`H1 ${name} PC 1280: 머리 칸 누르기 = 오름 → 다시 = 내림, 키보드·손잡이·정렬 고르기·다시 열어도 기억`, async ({ page }) => {
  test.setTimeout(120000);
  const s = await open(page, 1280);
  await expect.poll(s.names).toEqual(s.order.name);
  await expect(s.head('name').locator('xpath=..')).toHaveAttribute('aria-sort', 'ascending');
  for (const key of ['size', 'modified', 'name']) {
    const cell = s.head(key).locator('xpath=..');
    await s.head(key).click();
    await expect.poll(s.names).toEqual(s.order[key]);
    await expect(cell).toHaveAttribute('aria-sort', 'ascending');
    await expect(s.head(key)).toContainText('▲');
    await expect(s.select).toHaveValue(key + ':asc');
    await s.head(key).click();
    await expect.poll(s.names).toEqual(flip(s.order[key]));
    await expect(cell).toHaveAttribute('aria-sort', 'descending');
    await expect(s.head(key)).toContainText('▼');
    await expect(s.select).toHaveValue(key + ':desc');
    await expect(page.locator('#filesRoot [data-fx-list] .fx-head [aria-sort="none"]')).toHaveCount(3);
  }
  // 키보드: 머리 칸에 초점 → Enter = 그 칸 오름, Space = 반대. 다시 그린 뒤에도 초점은 그 칸.
  await s.head('size').focus();
  await page.keyboard.press('Enter');
  await expect.poll(s.names).toEqual(s.order.size);
  expect(await s.head('size').evaluate(el => el === document.activeElement)).toBe(true);
  await page.keyboard.press('Space');
  await expect.poll(s.names).toEqual(flip(s.order.size));
  // 너비 손잡이를 눌러도(움직이지 않고) 정렬은 그대로.
  const grip = page.locator('#filesRoot [data-fx-list] .fx-head [data-col-grip="day"]');
  const g = await grip.boundingBox();
  await page.mouse.click(g.x + g.width / 2, g.y + g.height / 2);
  await page.waitForTimeout(200);
  expect(await s.names()).toEqual(flip(s.order.size));
  // 정렬 고르기로 바꾸면 머리 칸도 같은 값(상태 주인 하나).
  await s.select.selectOption('modified:desc');
  await expect.poll(s.names).toEqual(flip(s.order.modified));
  await expect(s.head('modified').locator('xpath=..')).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(s.saved).toEqual({ key: 'modified', dir: 'desc' });
  // 새로 열어도 기억(서버 값).
  await page.reload();
  await s.open();
  await expect.poll(s.names).toEqual(flip(s.order.modified));
  await expect(s.head('modified').locator('xpath=..')).toHaveAttribute('aria-sort', 'descending');
  await expect(s.select).toHaveValue('modified:desc');
  // 종류 칸도 누를 수 있다(크기 칸과 따로).
  await s.head('kind').click();
  await expect(s.head('kind').locator('xpath=..')).toHaveAttribute('aria-sort', 'ascending');
  await expect(s.head('size').locator('xpath=..')).toHaveAttribute('aria-sort', 'none');
  expect(s.errors).toEqual([]);
});

for (const [name, open] of HEAD_SCREENS) test(`H1 ${name} 폰 390: 머리 줄 없는 목록은 정렬 고르기로 오름·내림, 다시 열어도 기억`, async ({ page }) => {
  test.setTimeout(120000);
  const s = await open(page, 390);
  await expect(page.locator('#filesRoot .fx-head:visible')).toHaveCount(0);
  await expect.poll(s.names).toEqual(s.order.name);
  for (const key of ['size', 'modified', 'name']) {
    await s.select.selectOption(key + ':asc');
    await expect.poll(s.names).toEqual(s.order[key]);
    await s.select.selectOption(key + ':desc');
    await expect.poll(s.names).toEqual(flip(s.order[key]));
  }
  await s.select.selectOption('size:desc');
  await expect.poll(s.saved).toEqual({ key: 'size', dir: 'desc' });
  await page.reload();
  await s.open();
  await expect.poll(s.names).toEqual(flip(s.order.size));
  await expect(s.select).toHaveValue('size:desc');
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over).toBeLessThanOrEqual(1);
  expect(s.errors).toEqual([]);
});

// F1(S69-62, 명진 11/24 18:16·18:18 "파일 옮기는 UI ... 다른 데서도" / "이쪽을 모델로 다 통일"): 폴더 고르기 = [파일] '옮길 곳' 창 하나.
// 자료실·노트·사진에서 폴더 ⋯ [옮기기]를 누르면 [파일]과 같은 모양의 창(제목 · 폴더 나무 · 아래 경로 + [새 폴더] + [여기에 옮기기])이 열리고,
// 줄을 누르면 고르기·펼치기만(쓰기 없음), [여기에 옮기기]로만 옮긴다(쓰기 한 번).
const PICK_SCREENS = [
  ['자료실', library, async (page, width) => {
    const menu = page.locator('#documentList details[data-lu-node="f:f0"] > summary [data-lu-node-menu], #libraryFolderNav [data-lu-nav="f0"]').first();
    if (width >= 761 && await page.locator('#libraryFolderNav [data-lu-nav="f0"]').count()) await page.locator('#libraryFolderNav [data-lu-nav="f0"]').click({ button: 'right' });
    else await menu.click();
    await page.locator('#luFolderMenu').getByRole('button', { name: '옮기기…', exact: true }).click();
  }, req => req.url().includes('/rest/v1/app_library_folders') && req.method() === 'PATCH'],
  ['노트', notes, async page => {
    await page.locator(`[data-nx-folder-more="${U(100)}"]`).first().click();
    await page.locator('#noteDocMenu').getByRole('button', { name: /옮기기/ }).first().click();
  }, req => req.url().includes('/rest/v1/app_note_folders') && req.method() === 'PATCH'],
  ['사진', photos, async page => {
    await page.locator('#photosRoot [data-photos-fx-more="S0"]').first().click();
    await page.locator('#photosFolderMenu').getByRole('button', { name: '옮기기…' }).click();
  }, req => req.url().includes('/functions/v1/onedrive-photos') && /folder-move|move/.test(req.postData() || '')],
];
for (const [name, open, openMove, isWrite] of PICK_SCREENS) for (const width of [390, 1280]) test(`F1 ${name} ${width}: 폴더 옮기기 = [파일] '옮길 곳' 창 — 누르면 고르기·펼치기만, [여기에 옮기기]로만 옮김`, async ({ page }) => {
  const { errors } = await open(page, width);
  const writes = [];
  page.on('request', req => { if (isWrite(req)) writes.push(req.url()); });
  await openMove(page, width);
  const sheet = page.locator('dialog[data-fd-sheet][open]');
  await expect(sheet).toBeVisible();
  // [파일] 창과 같은 틀(같은 모양 파일·같은 부분).
  await expect(sheet).toHaveClass(/fx-dest/);
  await expect(sheet.locator('.fx-dest-h [data-fx-dest-close]')).toBeVisible();
  await expect(sheet.locator('.fx-dest-tree [data-fx-dest-pick]').first()).toBeVisible();
  await expect(sheet.locator('.fx-dest-f [data-fx-dest-go]')).toBeVisible();
  const target = sheet.locator('.fx-dest-tree [data-fx-dest-name="가상 폴더 2"]');
  await target.click();
  await expect(target).toHaveAttribute('aria-current', 'true');
  await expect(sheet.locator('.fx-dest-at')).toContainText('가상 폴더 2');
  await page.waitForTimeout(150);
  expect(writes).toEqual([]);
  const box = await sheet.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(900);
  await sheet.locator('[data-fx-dest-go]').click();
  await expect(sheet).toHaveCount(0);
  await expect.poll(() => writes.length).toBe(1);
  expect(errors.filter(e => !/500|failed|Failed/.test(e))).toEqual([]);
});

// T5(UI-폴더이름펼치기, 명진 11/24 18:09): 그 자리 펼치는 폰 목록의 폴더 이름 누르기 = 펼치기·접기만(빈 폴더도 '빈 폴더' 한 줄, 주소 그대로),
// 들어가기는 ⋯ 첫 줄 [이 폴더로 들어가기]. 새 그 자리 펼치는 목록이 생기면 PRESS_SCREENS에 한 줄 더한다.
const EMPTY_OD = { source: 'od', item_id: 'OD!19', parent_id: 'OD!1', name: '가상 빈 폴더', is_folder: true, mime: null, size_bytes: null, modified_at: '2026-10-01T01:00:00Z', hash: null, trashed: false, starred: false, library_doc_id: null };
async function libraryPress(page, width) {
  const { errors } = await library(page, width);
  const d = page.locator('#documentList details[data-lu-node="f:f0"]');
  return { errors, press: () => d.locator(':scope > summary').click(), dbl: () => d.locator(':scope > summary').dblclick(), open: () => d.evaluate(x => x.open), empty: d.locator('.lu-node-empty'),
    more: d.locator(':scope > summary [data-lu-node-menu]'), panel: page.locator('#luFolderMenu') };
}
async function notesPress(page, width) {
  const { errors } = await notes(page, width);
  const row = page.locator(`#noteRows [data-nx-folder="${U(100)}"]`);
  return { errors, press: () => row.locator('.ft-main').click(), dbl: () => row.locator('.ft-main').dblclick(), open: async () => (await row.locator('.ft-main').getAttribute('aria-expanded')) === 'true',
    empty: page.locator(`#noteRows .ft-empty-row[data-ft-parent="${U(100)}"]`), more: page.locator(`#noteRows [data-nx-folder-more="${U(100)}"]`), panel: page.locator('#noteDocMenu') };
}
async function photosPress(page, width) {
  const { errors } = await photos(page, width);
  const main = page.locator('#photosRoot [data-photos-ftog="o:S0"]');
  return { errors, press: () => main.click(), dbl: () => main.dblclick(), where: () => page.locator('#photosRoot [data-photos-fx-back]').count(), open: async () => (await main.getAttribute('aria-expanded')) === 'true',
    empty: page.locator('#photosRoot .ft-empty-row[data-ft-parent="o:S0"]'), more: page.locator('#photosRoot [data-photos-fx-more="S0"]'), panel: page.locator('#photosFolderMenu') };
}
async function filesPress(page, width) {
  const { errors, server } = await startFiles(page, width);
  server.items.push(structuredClone(EMPTY_OD));
  await openFiles(page, width);
  const tree = page.locator('#filesRoot [data-fx-tree]');
  await tree.locator('[data-fx-tog="od:OD!1"]').click();
  const main = tree.locator('[data-fx-tog="od:OD!19"]');
  await expect(main).toBeVisible();
  return { errors, press: () => main.click(), dbl: () => main.dblclick(), open: async () => (await main.getAttribute('aria-expanded')) === 'true',
    empty: tree.locator('.ft-empty-row[data-ft-parent="od:OD!19"]'), more: tree.locator('[data-fx-fold="od:OD!19"] [data-fx-tmenu]'), panel: page.locator('#rowMenu') };
}
const PRESS_SCREENS = [['자료실', libraryPress], ['파일', filesPress], ['노트', notesPress], ['사진', photosPress]];
for (const [name, open] of PRESS_SCREENS) test(`T5 ${name} 폰 390: 폴더 이름 누르기 = 그 자리 펼치기·접기(빈 폴더 한 줄, 주소 그대로), 들어가기는 ⋯ 첫 줄`, async ({ page }) => {
  test.setTimeout(90000);
  const s = await open(page, 390);
  const url0 = page.url();
  await s.press();
  await expect.poll(s.open).toBe(true);
  await expect(s.empty).toContainText('빈 폴더');
  expect(page.url()).toBe(url0);
  await s.press();
  await expect.poll(s.open).toBe(false);
  await expect(s.empty).toBeHidden();
  await s.more.click();
  await expect(s.panel.locator('button').first()).toHaveText('이 폴더로 들어가기');
  expect(page.url()).toBe(url0);
  expect(s.errors).toEqual([]);
});

// T5 PC(S69-68 UI-오른쪽목록펼치기, 명진 11/24 20:09 "여기서 노조를 클릭하면 노조가 펼쳐지는거야 거기로 들어가는게아니고 들어가는건 무조건 왼쪽에서 클릭했을 때"):
// PC 탐색기 오른쪽 목록의 폴더 줄 누르기 = 그 자리 펼치기·접기(안의 하위 폴더·파일이 들여 보임). 주소·위치 줄·왼쪽 나무(지금 폴더·펼침)는 그대로.
// 새 탐색기 화면이 생기면 RIGHT_SCREENS에 한 줄 더한다({press 오른쪽 폴더 줄, open 펼쳤나, inner 안 줄, here 위치 글자, treeOpen 왼쪽 나무에서 그 폴더가 보이나}).
async function filesRight(page, width = 1280) {
  const { errors } = await startFiles(page, width);
  await openFiles(page, width);
  await page.locator('#filesRoot [data-fx-tree] [data-fx-fold="od:OD!1"] .ft-main').click();
  const row = page.locator('#filesRoot [data-fx-pane-i="0"] [data-fx-list] [data-fx-row="od:OD!10"]');
  await expect(row).toBeVisible();
  return { errors, press: () => row.click(), dbl: () => row.dblclick(), menu: () => row.click({ button: 'right' }), panel: page.locator('#rowMenu'), open: async () => (await row.getAttribute('aria-expanded')) === 'true',
    inner: page.locator('#filesRoot [data-fx-pane-i="0"] [data-fx-list] [data-fx-row="od:OD!14"]'), here: () => page.locator('#filesRoot [data-fx-crumb] .fx-crumb-now').textContent(),
    treeSub: page.locator('#filesRoot [data-fx-tree] [data-fx-fold="od:OD!14"], #filesRoot [data-fx-tree] .ft-row.ft-current [data-fx-go][data-fx-id="OD!10"]') };
}
async function libraryRight(page, width = 1280) {
  const folders = [libFolder('ra', null, { name: '가상 노조', sort_order: 1024 }), libFolder('rb', null, { name: '가상 회의', parent_id: 'ra', sort_order: 1024 }), libFolder('rc', null, { name: '가상 안건', parent_id: 'rb', sort_order: 1024 })];
  const { errors } = await bootLibrary(page, width, { folders, items: [{ document_id: 'd1', folder_id: 'rb' }], docs: [libDoc('d1', null)], group: '폴더', init: { viewPrefs: { library_two: false } } });
  await page.locator('#libraryFolderNav [data-lu-nav="ra"]').click();
  const d = page.locator('#documentList details[data-lu-node="f:rb"]');
  await expect(d).toBeVisible();
  return { errors, press: () => d.locator(':scope > summary').click(), dbl: () => d.locator(':scope > summary').dblclick(), menu: () => d.locator(':scope > summary').click({ button: 'right' }), panel: page.locator('#luFolderMenu'), open: () => d.evaluate(x => x.open),
    inner: d.locator('[data-lu-document="d1"]'), here: () => page.locator('#libraryPath').textContent(),
    treeSub: page.locator('#libraryFolderNav [data-lu-nav="rc"], #libraryFolderNav .ft-current [data-lu-nav="rb"]') };
}
async function notesRight(page, width = 1280) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  await installViewPrefsServer(page);
  const f = (id, parent_id, name) => ({ id: U(id), workspace_id: 'w', parent_id, name, sort_order: 1024, created_at: '2026-10-01T00:00:00Z' });
  const folders = [f(301, null, '가상 노조'), f(302, U(301), '가상 회의'), f(303, U(302), '가상 안건')];
  const note = { id: 'rn1', workspace_id: 'w', kind: 'note', title: '가짜 회의 노트', raw_text: '가짜', occurred_at: '2026-10-12T01:00:00Z', created_at: '2026-10-12T01:00:00Z', updated_at: '2026-10-12T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: { folder_id: U(302) } };
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: [structuredClone(note)] }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await page.locator(`[data-nx-tree] [data-nx-open="${U(301)}"]`).click();
  const main = page.locator(`#noteRows [data-nx-open="${U(302)}"]`);
  await expect(main).toBeVisible();
  return { errors, press: () => main.click(), dbl: () => main.dblclick(), menu: () => main.click({ button: 'right' }), panel: page.locator('#noteDocMenu'), open: async () => (await main.getAttribute('aria-expanded')) === 'true',
    inner: page.locator('#noteRows [data-note-row="rn1"]'), here: async () => (await page.locator(`[data-nx-tree] .ft-current [data-nx-open]`).getAttribute('data-nx-open')),
    treeSub: page.locator(`[data-nx-tree] [data-nx-open="${U(303)}"], [data-nx-tree] .ft-current [data-nx-open="${U(302)}"]`) };
}
const RIGHT_SCREENS = [['파일', filesRight], ['자료실', libraryRight], ['노트', notesRight]];
for (const [name, open] of RIGHT_SCREENS) test(`T5 ${name} PC 1280: 오른쪽 목록 폴더 줄 누르기 = 그 자리 펼치기·접기, 주소·위치·왼쪽 나무 그대로`, async ({ page }) => {
  test.setTimeout(90000);
  const s = await open(page);
  const url0 = page.url(), here0 = await s.here();
  await s.press();
  await expect.poll(s.open).toBe(true);
  await expect(s.inner).toBeVisible();
  expect(page.url()).toBe(url0);
  expect(await s.here()).toBe(here0);
  await expect(s.treeSub).toHaveCount(0); // 왼쪽 나무는 따라 펼치거나 강조하지 않는다
  await s.press();
  await expect.poll(s.open).toBe(false);
  await expect(s.inner).toBeHidden();
  expect(page.url()).toBe(url0);
  expect(s.errors).toEqual([]);
});

// T8(S69-76 UI-두번누르기없앰, 명진 11/24 21:30 "폴더 두번 누르면 들어가지는데 너무 민감 더블클릭 없애고 그 폴더에 들어가는 건 ... 해서 들어가기로만"):
// 폴더 줄 두 번 누르기(PC 더블클릭·폰 두 번 탭) = 한 번 누르기 두 번(펼치기 → 접기)과 같다 — 주소·위치 그대로, 들어가지 않는다.
// 들어가기는 ⋯ 첫 줄 [이 폴더로 들어가기](PC는 우클릭도 같은 메뉴)로만. 폰 그 자리 펼치는 목록(PRESS_SCREENS)·PC 오른쪽 목록(RIGHT_SCREENS) 모두.
for (const [name, open] of PRESS_SCREENS) test(`T8 ${name} 폰 390: 폴더 두 번 누르기 = 들어가지 않음(펼치기·접기 두 번), ⋯ 첫 줄로만 들어감`, async ({ page }) => {
  test.setTimeout(90000);
  const s = await open(page, 390);
  const where = s.where || (async () => page.url()); // 들어갔는지: 주소(사진은 주소가 같아 '폴더 나무로' ‹ 단추가 생겼는지)
  const url0 = page.url(), at0 = await where();
  await s.dbl();
  await page.waitForTimeout(400);
  await expect.poll(s.open).toBe(false);
  expect(page.url()).toBe(url0);
  expect(await where()).toBe(at0);
  await s.more.click();
  const enter = s.panel.locator('button').first();
  await expect(enter).toHaveText('이 폴더로 들어가기');
  await enter.click();
  await expect.poll(where).not.toBe(at0);
  expect(s.errors).toEqual([]);
});
// S69-84: 폴드 펼침 880(왼쪽 나무 + 오른쪽 목록)도 PC와 같은 규칙.
for (const [name, open] of RIGHT_SCREENS) for (const width of [880, 1280]) test(`T8 ${name} ${width}: 오른쪽 목록 폴더 두 번 누르기 = 들어가지 않음, 우클릭(⋯ 같은 메뉴) 첫 줄로만 들어감`, async ({ page }) => {
  test.setTimeout(90000);
  const s = await open(page, width);
  const url0 = page.url(), here0 = await s.here();
  await s.dbl();
  await page.waitForTimeout(400);
  await expect.poll(s.open).toBe(false);
  expect(page.url()).toBe(url0);
  expect(await s.here()).toBe(here0);
  await s.menu();
  const enter = s.panel.locator('button').first();
  await expect(enter).toHaveText('이 폴더로 들어가기');
  await enter.click();
  await expect.poll(s.here).not.toBe(here0);
  expect(s.errors).toEqual([]);
});

// T6(S69-68 UI-두칸따로, 명진 11/24 20:14 "우측에서의 폴더조작이 왼쪽에 영향 안미치게 반대로도. 원래 따로 조작하는게 의도임"):
// 두 칸 보기의 칸마다 펼침·지금 폴더가 따로 — 한 칸에서 펼치기·접기·들어가기를 해도 다른 칸은 그대로.
const TWO_FOLDERS = () => Array.from({ length: 24 }, (_, i) => libFolder('w' + i, null, { name: '가상 칸 폴더 ' + String(i).padStart(2, '0'), sort_order: 1024 * (i + 1) }));
const TWO_DOCS = () => Array.from({ length: 30 }, (_, i) => libDoc('w' + i, null));
const TWO_ITEMS = () => TWO_DOCS().map((d, i) => ({ document_id: d.id, folder_id: 'w' + (i % 3) }));
const lp = i => `#documentList [data-lu-pane-i="${i}"]`;
test('T6 자료실 1280 두 칸: 칸마다 펼침·들어가기가 따로', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await bootLibrary(page, 1280, { folders: TWO_FOLDERS(), items: TWO_ITEMS(), docs: TWO_DOCS(), group: '폴더', init: { viewPrefs: { library_two: true } } });
  await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
  const row = (i, id) => page.locator(`${lp(i)} [data-lu-nav="${id}"]`);
  // 왼쪽 칸에서 펼치면 오른쪽 칸 같은 폴더는 접힌 채, 오른쪽에서 펼쳐도 왼쪽은 그대로.
  await row(0, 'w0').click();
  await expect(row(0, 'w0')).toHaveAttribute('aria-expanded', 'true');
  await expect(row(1, 'w0')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator(`${lp(1)} [data-lu-document="w0"]`)).toHaveCount(0);
  await row(1, 'w1').click();
  await expect(row(1, 'w1')).toHaveAttribute('aria-expanded', 'true');
  await expect(row(0, 'w1')).toHaveAttribute('aria-expanded', 'false');
  await row(1, 'w0').click();
  await expect(row(1, 'w0')).toHaveAttribute('aria-expanded', 'true');
  await row(1, 'w0').click();
  await expect(row(1, 'w0')).toHaveAttribute('aria-expanded', 'false');
  await expect(row(0, 'w0')).toHaveAttribute('aria-expanded', 'true'); // 오른쪽에서 접어도 왼쪽은 펼친 채
  // 오른쪽 칸에서 들어가도 왼쪽 칸 위치·펼침은 그대로.
  await row(1, 'w2').click({ button: 'right' });
  await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
  await expect(page.locator(`${lp(1)} .lu-pane-here`)).toHaveText('가상 칸 폴더 02');
  await expect(page.locator(`${lp(0)} .lu-pane-here`)).toHaveText('자료실');
  await expect(row(0, 'w0')).toHaveAttribute('aria-expanded', 'true');
  expect(errors).toEqual([]);
});
test('T6 파일 1280 두 칸: 칸마다 펼침·들어가기가 따로', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await startFiles(page, 1280);
  await openFiles(page, 1280, { two: true });
  const two = page.locator('#filesRoot [data-fx-two]');
  if ((await two.getAttribute('aria-pressed')) !== 'true') await two.click();
  await expect(page.locator('#filesRoot [data-fx-pane-i="1"]')).toHaveCount(1);
  const pane = i => page.locator(`#filesRoot [data-fx-pane-i="${i}"] [data-fx-list]`);
  await expect(pane(0).locator('[data-fx-row="od:OD!1"]')).toBeVisible();
  // 오른쪽 칸은 구글 드라이브 맨 위에서 시작한다(서버 기억 없음 — 두 칸이 다른 곳).
  await expect(pane(1).locator('[data-fx-row="gd:gdFolder1"]')).toBeVisible();
  await pane(0).locator('[data-fx-row="od:OD!1"]').click();
  await expect(pane(0).locator('[data-fx-row="od:OD!1"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(pane(1).locator('[data-fx-row="gd:gdFolder1"]')).toHaveAttribute('aria-expanded', 'false');
  await pane(1).locator('[data-fx-row="gd:gdFolder1"]').click();
  await expect(pane(1).locator('[data-fx-row="gd:gdDoc1"]')).toBeVisible();
  await expect(pane(0).locator('[data-fx-row="od:OD!10"]')).toBeVisible(); // 오른쪽 칸에서 펼쳐도 왼쪽 칸 펼침 그대로
  await pane(0).locator('[data-fx-row="od:OD!1"]').click();
  await expect(pane(0).locator('[data-fx-row="od:OD!10"]')).toHaveCount(0);
  await expect(pane(1).locator('[data-fx-row="gd:gdDoc1"]')).toBeVisible(); // 왼쪽 칸에서 접어도 오른쪽 칸 펼침 그대로
  await pane(0).locator('[data-fx-row="od:OD!1"]').click();
  // 오른쪽 칸에서 들어가도 왼쪽 칸 위치·펼침은 그대로.
  await pane(1).locator('[data-fx-row="gd:gdFolder1"]').click({ button: 'right' });
  await page.locator('#rowMenu').getByRole('button', { name: '이 폴더로 들어가기' }).click();
  await expect(pane(1).locator('[data-fx-row="gd:gdFolder1"]')).toHaveCount(0);
  await expect(pane(1).locator('[data-fx-row="gd:gdDoc1"]')).toBeVisible();
  await expect(pane(0).locator('[data-fx-row="od:OD!1"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(pane(0).locator('[data-fx-row="od:OD!10"]')).toBeVisible();
  expect(errors).toEqual([]);
});

// T7(S69-68, 명진 11/24 20:15 "왼쪽에서 오른쪽으로 드래그를 하거나 조작을 하면 그 조작하기 직전 화면에 멈춰져있어야하는데 자꾸 위치가 바뀌어"):
// 두 칸을 각각 내려 둔 채 왼쪽 칸 자료를 오른쪽 칸 폴더에 끌어 놓으면 두 칸 모두 스크롤 자리·펼침이 그대로(옮긴 곳을 저절로 펼치지 않음).
test('T7 자료실 1280 두 칸: 끌어 놓기·펼치기 뒤 두 칸 스크롤·펼침 그대로', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, s } = await bootLibrary(page, 1280, { folders: TWO_FOLDERS(), items: TWO_ITEMS(), docs: TWO_DOCS(), group: '폴더', init: { viewPrefs: { library_two: true } } });
  await expect(page.locator('#documentList [data-lu-two]')).toBeVisible();
  await page.locator(`${lp(0)} [data-lu-nav="w0"]`).click();
  await page.locator(`${lp(1)} [data-lu-nav="w1"]`).click();
  const list = i => page.locator(`${lp(i)} .lu-pane-list`);
  for (const i of [0, 1]) expect(await list(i).evaluate(el => el.scrollHeight > el.clientHeight + 100)).toBe(true);
  await list(0).evaluate(el => { el.scrollTop = 150; });
  await list(1).evaluate(el => { el.scrollTop = el.scrollHeight; });
  const tops = () => Promise.all([0, 1].map(i => list(i).evaluate(el => Math.round(el.scrollTop))));
  const opened = () => Promise.all([0, 1].map(i => page.locator(`${lp(i)} [data-lu-nav][aria-expanded="true"]`).evaluateAll(xs => xs.map(x => x.dataset.luNav))));
  const top0 = await tops(), open0 = await opened();
  expect(top0[0]).toBe(150); expect(top0[1]).toBeGreaterThan(150);
  // 보이는 자료 줄(왼쪽)과 보이는 폴더 줄(오른쪽)을 고른다(시험 도구가 스크롤하지 않게).
  const inView = (i, sel) => page.evaluate(([p, q]) => { const l = document.querySelector(p + ' .lu-pane-list').getBoundingClientRect(); return [...document.querySelectorAll(p + ' ' + q)].find(x => { const r = x.getBoundingClientRect(); return r.top > l.top + 20 && r.bottom < l.bottom - 20; })?.getAttribute(q.slice(1, -1)); }, [lp(i), sel]);
  const doc = await inView(0, '[data-lu-document]'), to = await inView(1, '[data-lu-nav]');
  expect(doc && to).toBeTruthy();
  await page.locator(`${lp(0)} [data-lu-document="${doc}"]`).dragTo(page.locator(`${lp(1)} [data-lu-nav="${to}"]`));
  await expect.poll(() => s.items.find(x => x.document_id === doc)?.folder_id).toBe(to);
  await expect.poll(tops).toEqual(top0);
  expect(await opened()).toEqual(open0);
  // 펼치기·접기(보이는 줄)도 두 칸 자리 그대로.
  const fold = await inView(1, '[data-lu-nav]');
  await page.locator(`${lp(1)} [data-lu-nav="${fold}"]`).click();
  await page.locator(`${lp(1)} [data-lu-nav="${fold}"]`).click();
  await expect.poll(tops).toEqual(top0);
  expect(errors).toEqual([]);
});

// ---------- S9. 폴더 고르기 창(LIB-폴더창들어가기, 명진 11/24 18:04 → S69-62 [파일] '옮길 곳' 창 하나로) ----------
// 폴더를 눌러도 바로 실행하지 않는다: 누르면 선택 + 펼치기(하위 폴더가 보임), 실행 단추([여기에 옮기기])에만 실행, ✕(닫기)면 그대로.
async function libraryPick(page, width) {
  const folders = [libFolder('top', null, { name: '가상 위 폴더', sort_order: 1024 }), libFolder('mid', null, { name: '가상 가운데', parent_id: 'top', sort_order: 1024 }),
    libFolder('leaf', null, { name: '가상 끝', parent_id: 'mid', sort_order: 1024 }), libFolder('side', null, { name: '가상 옆', sort_order: 2048 })];
  const { s, errors } = await bootLibrary(page, width, { folders, items: [], docs: [libDoc('d1', null)], group: '폴더' });
  await expandLibraryTree(page);
  await openMove(page, 'd1', width);
  return { errors, panel: movePicker(page), writes: () => s.writes.length, tap: width < 761 };
}
const S9_SCREENS = [['자료실 폴더로 옮기기', libraryPick]];
for (const [name, open] of S9_SCREENS) for (const width of [390, 1280]) test.describe(`S9 ${name} ${width}`, () => {
  test.use({ hasTouch: width < 761 });
  test(`S9 ${name} ${width}: 상위 폴더 누르기 = 선택·펼치기(실행 없음), 실행 단추에만 실행, 닫으면 그대로`, async ({ page }) => {
    const { errors, panel, writes, tap } = await open(page, width);
    const press = l => tap ? l.tap() : l.click();
    const row = id => panel.locator(`.fx-dest-tree [data-fx-dest-pick="${id}"]`);
    const ok = panel.locator('[data-fx-dest-go]');
    await expect(row('mid')).toHaveCount(0);
    await press(row('top'));
    await expect(panel).toBeVisible();
    await expect(row('mid')).toBeVisible();
    await press(row('mid'));
    await press(row('leaf'));
    await expect(row('leaf')).toHaveAttribute('aria-current', 'true');
    await expect(ok).toBeEnabled();
    expect(writes()).toBe(0);
    await press(panel.locator('[data-fx-dest-close]'));
    await expect(panel).toHaveCount(0);
    expect(writes()).toBe(0);
    expect(errors).toEqual([]);
  });
});

// ---------- P4. 폰 길게 누르기 = 선택 모드 + 그 줄 선택, 메뉴는 ⋯ (S69 LONGPRESS-선택, 명진 11/24 18:06) ----------
// "이 상태에서 꾹 누르면 선택이 활성화되는 거야. … 이거는 선택한 상태가 되는 거야. 우클릭 메뉴는 옆에 점점점으로 활성화"
// 공용 규칙: app/select-mode.js holdPick(꺼져 있으면 켜고 그 줄을 고름, 켜져 있으면 더함 — 토글 아님). 끌기는 움직였을 때만(library-folder-drag.spec.mjs).
// 새 목록 화면이 생기면 HOLD_SCREENS에 한 줄 더한다. 노트는 basket-note-folder.spec.mjs, 파일 목록 줄은 files-touch-drag.spec.mjs, 사진 작은 그림은 library-photo-pick.spec.mjs.
// 화면마다 돌려줄 것: first·second(꾹 누를 줄·누를 줄), bar(선택 막대), countIs(n)(막대 개수 글), isPicked(줄)(고름 표시), tap(줄)(한 번 누르기), more(줄)(⋯), menu(메뉴 상자).
const P4_FOLDERS = [libFolder('fa', 'top-a', { name: '가상 A', sort_order: 1024 }), libFolder('fc', 'child-a1', { name: '가상 C', parent_id: 'fa', sort_order: 0 })];
async function libraryRows(page, width = 390) {
  const r = await bootLibrary(page, width, { folders: P4_FOLDERS, items: [{ document_id: 'a-1', folder_id: 'fc' }], group: '폴더' });
  if (width < 600) await expandLibraryTree(page);
  const rows = page.locator('#documentList [data-lu-document]:visible');
  await expect.poll(() => rows.count()).toBeGreaterThan(1);
  const [a, b] = [await rows.nth(0).getAttribute('data-lu-document'), await rows.nth(1).getAttribute('data-lu-document')];
  const row = id => page.locator(`#documentList [data-lu-document="${id}"]`);
  const count = page.locator('#librarySelectCount');
  return {
    errors: r.errors, first: row(a), second: row(b),
    bar: page.locator('#librarySelectBar'), countIs: n => expect(count).toHaveText(`${n}개 선택됨`),
    isPicked: l => expect(l.locator('[data-lu-pick]')).toBeChecked(), tap: l => l.locator('h3,.lu-row-title').first().tap(),
    more: l => l.locator('[data-lu-menu]'), menu: page.locator('#luMorePanel'),
  };
}
// S69-84 목록 엔진 통일 ①(명진 11/24 23:57 "폴드 펼침 화면에서도 꾹 눌러 선택 등 움직임 통일"): 폴드 펼침·PC 왼쪽 나무 폴더 줄도 같은 규칙(폴더째 고름).
// 원인(사실): 길게 누르기를 오른쪽 목록에만 걸어 두어 왼쪽 나무 줄은 꾹 눌러도 아무 일이 없었고, 나무 줄에는 ⋯도 없었다.
async function libraryTree(page, width) {
  const folders = [libFolder('fa', 'top-a', { name: '가상 A', sort_order: 1024 }), libFolder('fb', 'top-b', { name: '가상 B', sort_order: 2048 })];
  const r = await bootLibrary(page, width, { folders, items: [{ document_id: 'a-1', folder_id: 'fa' }], group: '폴더' });
  const nav = id => page.locator(`#libraryFolderNav [data-lu-nav="${id}"]`);
  await expect(nav('fb')).toBeVisible();
  const count = page.locator('#librarySelectCount');
  const rowOf = l => l.locator('xpath=ancestor::*[contains(@class,"ft-row")][1]');
  return {
    errors: r.errors, first: nav('fa'), second: nav('fb'),
    bar: page.locator('#librarySelectBar'), countIs: n => expect(count).toHaveText(`폴더 ${n} 선택됨`),
    isPicked: l => expect(rowOf(l)).toHaveClass(/lu-folder-picked/), tap: l => l.tap(),
    more: l => rowOf(l).locator('[data-lu-nav-more]'), menu: page.locator('#luFolderMenu'),
  };
}
// S69-75 LONGPRESS-폰나무(2026-11-24 명진 "파일 목록에 보이는 파일 폴더 꾹 눌러도 선택 안되는데?"): [파일] 폰 첫 화면 나무(저장소 상자)의 폴더 줄·파일 줄.
async function filesTreeRows(page, width = 390) {
  const { errors } = await startFiles(page, width);
  await openFiles(page, width);
  const tree = page.locator('#filesRoot [data-fx-tree]');
  const bar = page.locator('#filesRoot [data-fx-bar]');
  const base = { errors, bar, countIs: n => expect(bar.locator('.fx-bar-t')).toHaveText(`${n}개`), isPicked: l => expect(l).toHaveClass(/fx-picked/), tap: l => l.tap(), menu: page.locator('#rowMenu') };
  if (width < 600) {
    const fold = key => tree.locator(`[data-fx-tog="${key}"]`);
    await expect(fold('od:OD!1')).toBeVisible();
    return { ...base, first: fold('od:OD!1'), second: fold('gd:gdFolder1'), more: l => l.locator('xpath=..').locator('[data-fx-tmenu]') };
  }
  // 폴드 펼침·PC 한 칸 왼쪽 나무: 폴더 줄 이름 단추(data-fx-go). 저장소 맨 위 줄(폴더 아님)은 빼고 처음 두 폴더.
  const mains = tree.locator('.ft-row[data-fx-fold] > .ft-main[data-fx-go]:not([data-fx-id=""])');
  await expect.poll(() => mains.count()).toBeGreaterThan(1);
  const key = async i => mains.nth(i).locator('xpath=..').getAttribute('data-fx-fold');
  const main = k => tree.locator(`.ft-row[data-fx-fold="${k}"] > .ft-main`);
  return { ...base, first: main(await key(0)), second: main(await key(1)), more: l => l.locator('xpath=..').locator('[data-fx-tmenu]') };
}
// 노트 목록 줄(폴드·PC 오른쪽 목록)과 왼쪽 나무 폴더 줄. 폰 390 노트 줄은 basket-note-folder.spec.mjs.
async function notesRows(page, width, { tree = false } = {}) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  await installViewPrefsServer(page);
  const row = (id, title) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title, occurred_at: '2026-10-10T00:00:00Z', created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: { folder_id: U(1) } });
  const rows = [row('n1', '가상 노트 1'), row('n2', '가상 노트 2')];
  const folders = [{ id: U(1), workspace_id: 'w', parent_id: null, name: '가상 회의', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' }, { id: U(2), workspace_id: 'w', parent_id: null, name: '가상 기획', sort_order: 2048, created_at: '2026-10-01T00:00:00Z' }];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(rows) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  const count = page.locator('[data-nx-select-count]');
  // 노트는 꾹 누른 뒤 0.6초 동안 따라오는 누르기를 먹는다(Date.now 기준). openHome이 시계를 멈춰 두므로 꾹 누른 뒤 시계를 1초 돌린다.
  const afterHold = async () => page.clock.setFixedTime(await page.evaluate(() => Date.now() + 1000));
  const base = { errors, afterHold, bar: page.locator('[data-nx-select-bar]'), countIs: n => expect(count).toHaveText(`${n}개 선택됨`), menu: page.locator('#noteDocMenu') };
  if (tree) {
    const folder = id => page.locator(`[data-nx-tree] [data-nx-folder="${id}"]`);
    await expect(folder(U(2))).toBeVisible();
    return { ...base, first: folder(U(1)).locator('.ft-main'), second: folder(U(2)).locator('.ft-main'),
      isPicked: l => expect(l.locator('xpath=..')).toHaveClass(/ft-picked/), tap: l => l.tap(), more: l => l.locator('xpath=..').locator('[data-nx-folder-more]') };
  }
  await page.locator(`[data-nx-tree] [data-nx-folder="${U(1)}"] .ft-main`).click();
  const note = id => page.locator(`#noteRows [data-nx-note="${id}"]`);
  await expect(note('n2')).toBeVisible();
  return { ...base, first: note('n1'), second: note('n2'),
    isPicked: l => expect(l).toHaveClass(/nx-picked/), tap: l => l.locator('.basket-title-text').tap(), more: l => l.locator('[data-note-row-more]') };
}
// 사진 격자 작은 그림(전부터 같은 동작 — 폭과 상관없이 꾹 누르기 = 고르기). 메뉴는 PC 우클릭이라 ⋯ 확인은 없다.
async function photoTiles(page, width) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width, height: 900 });
  await openHome(page);
  await installViewPrefsServer(page);
  const media = [0, 1, 2, 3].map(i => ({ id: 'P' + i, name: 'p.jpg', day: '2026-10-05', taken_at: `2026-10-05T03:00:0${4 - i}.000Z`, approx: false, kind: 'photo', screenshot: false, duration_ms: null }));
  await page.route(u => u.origin === SB && ['/rest/v1/app_diary_stars', '/rest/v1/app_photo_tags', '/rest/v1/app_photo_tag_items'].includes(u.pathname), r => r.fulfill({ json: [] }));
  await page.route(u => u.origin === SB && u.pathname === '/functions/v1/onedrive-photos', async r => {
    const body = r.request().postDataJSON();
    if (body.action === 'photo') return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    if (body.action === 'status') return r.fulfill({ json: { configured: true, connected: true, folder: { name: '가상 카메라' }, can_delete: true } });
    if (body.action === 'sync') return r.fulfill({ json: { more: false, indexing: false } });
    if (body.action === 'photo-urls') return r.fulfill({ json: { urls: {}, failed: {} } });
    if (body.action === 'months') return r.fulfill({ json: { months: { '2026-10': media.length }, total: media.length } });
    if (body.action === 'library') return r.fulfill({ json: { items: media, next_cursor: null, indexing: false } });
    return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
  });
  await clickView(page, 'photos');
  const tile = i => page.locator(`#photosRoot [data-photos-open="${i}"]`);
  await expect(tile(1)).toBeVisible();
  return { errors, first: tile(0), second: tile(1), bar: page.locator('#photosRoot [data-photos-sel]'),
    countIs: n => expect(page.locator('#photosRoot [data-photos-sel-count]')).toHaveText(`${n}개 선택됨`),
    isPicked: l => expect(l).toHaveClass(/photo-picked/), tap: l => l.tap(), more: null, menu: null };
}
// [이름, 여는 함수(page, 폭), 폭들]. 폰 390·폴드 펼침 880·PC 1280(손가락 화면 노트북) — 폭이 아니라 손가락이냐 마우스냐로 같은 규칙.
const HOLD_SCREENS = [
  ['자료실 목록 줄', libraryRows, [390, 880, 1280]],
  ['자료실 왼쪽 나무 폴더 줄', libraryTree, [880, 1280]],
  ['파일 나무 줄', filesTreeRows, [390, 880, 1280]],
  ['노트 목록 줄', notesRows, [880, 1280]],
  ['노트 왼쪽 나무 폴더 줄', (page, w) => notesRows(page, w, { tree: true }), [880, 1280]],
  ['사진 작은 그림', photoTiles, [390, 880, 1280]],
];
const centerOf = l => l.evaluate(el => { el.scrollIntoView({ block: 'center', behavior: 'instant' }); const t = el.querySelector('h3,.lu-row-title') || el; const r = t.getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 60), y: r.top + r.height / 2 }; });
async function holdAt(page, l) {
  const p = await centerOf(l), cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y, id: 0 }] });
  await page.waitForTimeout(700);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  // 꾹 누른 뒤 따라오는 클릭 하나는 화면이 잠깐 먹는다(꾹 누르기 끝 표시). 사람처럼 잠깐 뒤에 다음 손짓.
  await page.waitForTimeout(650);
}
test.describe('P4 손가락 화면(폰 390·폴드 880·PC 1280) 터치', () => {
  test.use({ hasTouch: true });
  for (const [name, open, widths] of HOLD_SCREENS) for (const width of widths) test(`P4 ${name} ${width}: 줄 길게 누르기 = 선택 모드 + 그 줄 선택(메뉴 없음), 다른 줄 누르면 2개, ⋯ = 메뉴`, async ({ page }) => {
    const s = await open(page, width);
    const hold = async l => { await holdAt(page, l); await s.afterHold?.(); };
    await expect(s.bar).toBeHidden();
    const url = page.url();
    await hold(s.first);
    await expect(s.bar).toBeVisible();
    await s.countIs(1);
    await s.isPicked(s.first);
    if (s.menu) await expect(s.menu).toBeHidden();
    // 다시 길게 눌러도 풀리지 않는다(토글 아님).
    await hold(s.first);
    await s.countIs(1);
    if (s.menu) await expect(s.menu).toBeHidden();
    // 선택 모드에서 다른 줄을 한 번 누르면 더한다(나무 폴더 줄도 들어가기·펼치기 아님 — 주소 그대로).
    await s.tap(s.second);
    await s.countIs(2);
    await s.isPicked(s.second);
    expect(page.url()).toBe(url);
    // 메뉴는 줄 오른쪽 ⋯로(꾹 누른 바로 뒤에도 ⋯는 삼키지 않는다).
    if (s.more) {
      await s.more(s.second).tap();
      await expect(s.menu).toBeVisible();
    }
    expect(s.errors).toEqual([]);
  });
});

// D5 폴드 880 손가락(S69-84): 오른쪽 목록 자료 줄을 꾹 눌러 왼쪽 나무 폴더 줄로 끌어 놓으면 그 폴더로 옮긴다. 왼쪽 나무 폴더 줄도 꾹 눌러 끌면 폴더째 옮긴다.
// 원인(사실): 손가락 길게 누르기를 오른쪽 목록에만 걸어 두어 나무 줄은 잡히지 않았다(놓기는 나무도 받았다).
test.describe('D5 폴드 880 손가락', () => {
  test.use({ hasTouch: true });
  test('D5 자료실 폴드 880: 목록 줄 → 왼쪽 나무 폴더로 끌어 놓기, 나무 폴더 줄 → 다른 나무 폴더로 끌어 놓기', async ({ page }) => {
    test.setTimeout(90000);
    const folders = [libFolder('fa', 'top-a', { name: '가상 A', sort_order: 1024 }), libFolder('fb', 'top-b', { name: '가상 B', sort_order: 2048 }), libFolder('fc', 'top-c', { name: '가상 C', sort_order: 3072 })];
    const { s, errors } = await bootLibrary(page, 880, { folders, items: [{ document_id: 'a-1', folder_id: 'fa' }], group: '폴더' });
    const nav = id => page.locator(`#libraryFolderNav [data-lu-nav="${id}"]`);
    await nav('fa').click();
    const docRow = page.locator('#documentList [data-lu-document="a-1"]');
    await expect(docRow).toBeVisible();
    await touchDrag(page, docRow, nav('fb'), { hold: 700 });
    await expect.poll(() => s.items.find(x => x.document_id === 'a-1')?.folder_id).toBe('fb');
    await page.waitForTimeout(700);
    await touchDrag(page, nav('fc'), nav('fb'), { hold: 700 });
    await expect.poll(() => s.folders.find(f => f.id === 'fc')?.parent_id ?? null).toBe('fb');
    // 끌기는 고르기가 아니다(선택 모드가 켜지지 않음).
    await expect(page.locator('#librarySelectBar')).toBeHidden();
    expect(errors).toEqual([]);
  });
});

// ---------- S4 폴더 줄: 사각형으로 폴더 줄 고르기(S69-69 LIB-사각형폴더, 명진 11/24 20:18 "이렇게 드래그하면 다 선택이 돼야하는데") ----------
// 두 칸 보기 오른쪽 칸에서 빈 폴더 줄 여럿을 사각형으로 덮으면 폴더째 골라지고(위 막대 '폴더 N 선택됨'), [폴더로 옮기기]는 폴더째 옮기고, [삭제]는 폴더째 휴지통으로.
// 한 칸 탐색기 폴더 줄도 같은 규칙(tests/app-e2e/library-marquee-anywhere.spec.mjs). 이름은 지어낸 것, 가짜 서버.
async function libraryFolderRows(page) {
  const folders = [libFolder('top', null, { name: '가상 위원회', sort_order: 1024 }), libFolder('dst', null, { name: '가상 보관', sort_order: 2048 }),
    ...[0, 1, 2, 3].map(i => libFolder('k' + i, null, { name: `가상 ${i + 1}차`, parent_id: 'top', sort_order: 1024 * (i + 1) }))];
  const r = await bootLibrary(page, 1440, { folders, items: [], docs: [libDoc('d-1', null)], group: '폴더', init: { viewPrefs: null } });
  const pane = '#documentList [data-lu-pane-i="1"]';
  await page.locator(`${pane} [data-lu-nav="top"]`).click({ button: 'right' });
  await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
  for (let i = 0; i < 4; i++) await expect(page.locator(`${pane} [data-lu-nav="k${i}"]`)).toBeVisible();
  return { ...r, pane };
}
// 오른쪽 칸 마지막 폴더 줄 아래 빈 곳에서 k1 줄 가운데까지 위로 끈다(처음 고르면 위 막대가 나타나 줄이 내려가므로 그 뒤 화면에서 끝점을 다시 잰다).
async function marqueeFolders(page, pane) {
  const from = await page.locator(`${pane} .lu-pane-list`).evaluate(list => { const rows = [...list.querySelectorAll('.ft-row')], last = rows[rows.length - 1].getBoundingClientRect(), b = list.getBoundingClientRect(); return { x: last.left + last.width / 2, y: Math.min(b.bottom - 10, last.bottom + 40) }; });
  const mid = () => page.locator(`${pane} [data-lu-nav="k1"]`).evaluate(el => { const b = el.closest('.ft-row').getBoundingClientRect(); return b.top + b.height / 2; });
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + 6, from.y - 8, { steps: 3 });
  await expect(page.locator('.marquee-box')).toBeVisible();
  await page.mouse.move(from.x + 20, await mid(), { steps: 6 });
  await page.waitForTimeout(80);
  await page.mouse.move(from.x + 24, await mid(), { steps: 3 });
  await page.mouse.up();
  await expect(page.locator('.marquee-box')).toHaveCount(0);
}
test('S4 자료실 두 칸 PC 1440: 사각형으로 폴더 줄 고르기 — 폴더째 골라지고 [폴더로 옮기기]는 폴더째 옮긴다', async ({ page }) => {
  test.setTimeout(60000);
  const { s, errors, pane } = await libraryFolderRows(page);
  await marqueeFolders(page, pane);
  await expect(page.locator('#librarySelectBar')).toBeVisible();
  await expect(page.locator('#librarySelectCount')).toHaveText('폴더 3 선택됨');
  await expect(page.locator(`${pane} .ft-row.lu-folder-picked`)).toHaveCount(3);
  await expect(page.locator(`${pane} .ft-row:has([data-lu-nav="k0"])`)).not.toHaveClass(/lu-folder-picked/);
  await page.locator('#librarySelectFolder').click();
  await expect(movePicker(page)).toBeVisible();
  await pickMove(page, 'dst', 1440);
  await expect.poll(() => ['k1', 'k2', 'k3'].map(id => s.folders.find(f => f.id === id)?.parent_id)).toEqual(['dst', 'dst', 'dst']);
  expect(s.folders.find(f => f.id === 'k0').parent_id).toBe('top');
  await expect(page.locator('#librarySelectBar')).toBeHidden();
  expect(errors).toEqual([]);
});
test('S4 자료실 두 칸 PC 1440: 사각형으로 고른 폴더 줄 [삭제]는 한 번 묻고 폴더째 휴지통으로, 되돌리기 한 번에 모두', async ({ page }) => {
  test.setTimeout(60000);
  const { s, errors, pane } = await libraryFolderRows(page);
  await marqueeFolders(page, pane);
  await expect(page.locator('#librarySelectCount')).toHaveText('폴더 3 선택됨');
  await page.locator('#librarySelectDelete').click();
  await expect(page.locator('.kptu-ask-text')).toHaveText('폴더 3개를 삭제할까요?');
  await page.locator('.kptu-ask button', { hasText: '삭제' }).click();
  await expect.poll(() => s.trash.map(t => t.root).sort()).toEqual(['k1', 'k2', 'k3']);
  await expect(page.locator(`${pane} [data-lu-nav="k1"]`)).toHaveCount(0);
  await expect(page.locator('#librarySelectBar')).toBeHidden();
  await page.locator('.kptu-undo-notice [data-undo-action]').click();
  await expect.poll(() => s.rpc.filter(r => r.fn === 'app_trash_restore').map(r => r.id).sort()).toEqual(['k1', 'k2', 'k3']);
  expect(errors).toEqual([]);
});

// S10(S69-89 UI-고르기모드통일, 2026-11-25 명진 "선택 가능 화면에서는 폴더 이름을 클릭해도 선택 되게 앞 네모 클릭이 아니라 / 파일에서는 되는데"):
// 고르기 중에는 폴더 줄 이름·그림·빈 곳 어디를 눌러도 그 폴더 고르기·풀기. 펼치기·접기·들어가기는 하지 않는다(⋯만 예외). 고르기가 아닐 때는 T5 그대로.
// 화면마다 돌려줄 것: first·second(폴더 줄), tap(줄), isPicked(줄)·notPicked(줄), opened(줄)(펼쳐졌나), afterHold(꾹 누른 뒤 시계).
async function libraryFolderTap(page, width) {
  const folders = [libFolder('fa', null, { name: '가상 A', sort_order: 1024 }), libFolder('fb', null, { name: '가상 B', sort_order: 2048 })];
  const r = await bootLibrary(page, width, { folders, items: [{ document_id: 'a-1', folder_id: 'fa' }, { document_id: 'a-2', folder_id: 'fb' }], group: '폴더' });
  await page.evaluate(() => window.__KPTU_LIBRARY_UPLOAD_READY__);
  const head = id => page.locator(`#documentList details[data-lu-node="f:${id}"] > summary`).first();
  await expect(head('fb')).toBeVisible();
  return { errors: r.errors, first: head('fa'), second: head('fb'), tap: l => l.tap({ position: { x: 120, y: 12 } }),
    isPicked: l => expect(l).toHaveClass(/lu-(node|folder)-picked/), notPicked: l => expect(l).not.toHaveClass(/lu-(node|folder)-picked/),
    opened: l => l.evaluate(x => x.parentElement.open) };
}
async function notesFolderTap(page, width) {
  const { errors } = await notes(page, width);
  const row = id => page.locator(`#noteRows [data-nx-folder="${id}"]`);
  await expect(row(U(101))).toBeVisible();
  return { errors, first: row(U(100)).locator('.ft-main'), second: row(U(101)).locator('.ft-main'), tap: l => l.tap(),
    afterHold: async () => page.clock.setFixedTime(await page.evaluate(() => Date.now() + 1000)),
    isPicked: l => expect(l.locator('xpath=..')).toHaveClass(/ft-picked/), notPicked: l => expect(l.locator('xpath=..')).not.toHaveClass(/ft-picked/),
    opened: async l => (await l.getAttribute('aria-expanded')) === 'true' };
}
async function filesFolderTap(page, width) {
  const s = await filesTreeRows(page, width);
  return { errors: s.errors, first: s.first, second: s.second, tap: l => l.tap(), isPicked: s.isPicked, notPicked: l => expect(l).not.toHaveClass(/fx-picked/),
    opened: async l => (await l.getAttribute('aria-expanded')) === 'true' };
}
const FOLDER_TAP_SCREENS = [['자료실', libraryFolderTap, [390, 880, 1280]], ['노트', notesFolderTap, [390]], ['파일', filesFolderTap, [390]]];
test.describe('S10 고르기 중 폴더 줄 누르기', () => {
  test.use({ hasTouch: true });
  for (const [name, open, widths] of FOLDER_TAP_SCREENS) for (const width of widths) test(`S10 ${name} ${width}: 고르기 중 폴더 이름 누르기 = 고르기·다시 누르면 풀기, 펼치지 않음`, async ({ page }) => {
    const s = await open(page, width);
    const url = page.url();
    await holdAt(page, s.first);
    await s.afterHold?.();
    await s.isPicked(s.first);
    const was = await s.opened(s.second);
    await s.tap(s.second);
    await s.isPicked(s.second);
    expect(await s.opened(s.second)).toBe(was);
    await s.tap(s.second);
    await s.notPicked(s.second);
    expect(await s.opened(s.second)).toBe(was);
    await s.isPicked(s.first);
    expect(page.url()).toBe(url);
    expect(s.errors).toEqual([]);
  });
});

// S11(S69-89, 명진 11/25 "선택 가능 모드에서 폰 뒤로가기 버튼 누르면 선택 가능 모드에서 나오게 선택도 취소되고 (지금은 직전 페이지로 가는 듯)"):
// 고르기 중 뒤로가기 한 번 = 고르기 끝 + 고른 것 0개, 주소·화면 그대로(공용 select-mode.js createBackLayer). 고르기가 아닐 때 뒤로가기는 지금처럼 이전 화면.
// 화면 표는 P4의 HOLD_SCREENS(폰 390·폴드 880·PC 1280 손가락)를 그대로 쓴다 — 새 고르기 화면은 거기에 더하면 이 시험도 함께 돈다.
test.describe('S11 고르기 중 뒤로가기', () => {
  test.use({ hasTouch: true });
  for (const [name, open, widths] of HOLD_SCREENS) for (const width of widths) test(`S11 ${name} ${width}: 뒤로가기 한 번 = 고르기 끝·고른 것 0개·화면 그대로, 고르기 아닐 때는 이전 화면`, async ({ page }) => {
    const s = await open(page, width);
    const hold = async l => { await holdAt(page, l); await s.afterHold?.(); };
    const here = () => page.evaluate(() => [location.href, window.KPTURouter?.current]);
    const at = await here();
    await hold(s.first);
    await s.tap(s.second);
    await s.countIs(2);
    await page.goBack();
    await expect(s.bar).toBeHidden();
    expect(await here()).toEqual(at);
    // 다시 고르면 처음부터(앞에 고른 것이 남지 않음).
    await hold(s.first);
    await s.countIs(1);
    await page.goBack();
    await expect(s.bar).toBeHidden();
    expect(await here()).toEqual(at);
    // 고르기가 아닐 때 뒤로가기는 이 화면을 떠난다(앞 기록이 없으면 앱 밖).
    await page.goBack();
    await expect.poll(async () => JSON.stringify(await here().catch(() => null))).not.toBe(JSON.stringify(at));
    expect(s.errors).toEqual([]);
  });
});

// ---------- K1·R2 판 화면(목록이 아닌 곳) — S70-03 노트 보드 ----------
// 고른 것 Delete = 바로 지우고 [되돌리기] 한 번에 모두 돌아온다. 새 판 화면이 생기면 BOARD_SCREENS에 한 줄 더한다.
async function noteBoard(page) {
  const bid = 'bs70003';
  await boardFixture(page, 1280, { bid, seed: [{ id: 'T1', board_id: bid, body: '가 주제', x: 160, y: 380 }, { id: 'T2', board_id: bid, body: '나 주제', x: 360, y: 380 }] });
  return { items: [nbNode(page, '가 주제'), nbNode(page, '나 주제')] };
}
const BOARD_SCREENS = [['노트 보드', noteBoard]];
for (const [name, open] of BOARD_SCREENS) test(`K1·R2 ${name} PC 1280: 두 개 골라 Delete = 바로 지움, [되돌리기] 한 번에 둘 다`, async ({ page }) => {
  const { items } = await open(page);
  const a = await nbBox(items[0]), b = await nbBox(items[1]);
  await page.mouse.move(a.x - 16, a.y - 16); await page.mouse.down(); await page.mouse.move(b.x + b.width + 4, b.y + b.height + 4, { steps: 8 }); await page.mouse.up();
  await page.keyboard.press('Delete');
  for (const it of items) await expect(it).toHaveCount(0);
  await page.getByRole('button', { name: '되돌리기' }).click();
  for (const it of items) await expect(it).toHaveCount(1);
});

// ---------- D6 순서 바꾸기 = 끌기만(S70-04 UI-순서는끌기로, 2026-11-25 명진 "위로 아래로 버튼 이거 불편함. 드래그하는걸로 다 통일해줘") ----------
// ⋯ 메뉴·줄에 순서용 [위로][아래로]가 없다 / 끌어서(PC 마우스·폰 꾹 눌러 끌기) 순서를 바꾸면 서버에 저장돼 새로고침해도 그대로 / 키보드 Alt+↑↓로도 바뀐다.
// 화면마다 {rows(): 줄 locator 목록 선택자, order(), more(id), menu, focus(id), reopen(), writes}를 돌려주는 여는 함수를 ORDER_SCREENS 표에 더한다.
async function notesOrder(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [], writes = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  await installViewPrefsServer(page);
  const folders = Array.from({ length: 4 }, (_, i) => ({ id: U(100 + i), workspace_id: 'w', parent_id: null, name: '가상 폴더 ' + i, sort_order: 1024 * (i + 1), created_at: '2026-10-01T00:00:00Z', color: null }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => {
    const req = r.request();
    if (req.method() === 'GET') return r.fulfill({ json: structuredClone(folders) });
    if (req.method() === 'PATCH') { const id = (new URL(req.url()).searchParams.get('id') || '').slice(3), body = req.postDataJSON(), x = folders.find(f => f.id === id); writes.push({ id, body }); Object.assign(x, body); return r.fulfill({ json: [structuredClone(x)] }); }
    return r.fulfill({ status: 500, json: {} });
  });
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  const show = async () => { await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/, { timeout: 20000 }); await page.waitForFunction(() => window.KPTURouter?.go); await page.evaluate(() => window.KPTURouter.go('basket')); await chooseBasketKind(page, 'note'); };
  await show();
  const box = width >= 1000 ? '[data-nx-tree]' : '#noteRows';
  const row = id => page.locator(`${box} [data-nx-folder="${id}"]`).first();
  await expect(row(U(100))).toBeVisible();
  return {
    errors, writes, ids: folders.map(f => f.id).sort(), row,
    order: () => page.locator(`${box} [data-nx-folder]`).evaluateAll(els => els.map(el => el.dataset.nxFolder)),
    openMenu: async id => { await page.locator(`${box} [data-nx-folder-more="${id}"]`).first().click(); await expect(page.locator('#noteDocMenu')).toBeVisible(); return page.locator('#noteDocMenu'); },
    focus: id => row(id).locator('button').first().focus(),
    reopen: async () => { await page.reload(); await show(); await expect(row(U(100))).toBeVisible(); },
  };
}
const ORDER_SCREENS = [['노트 폴더', notesOrder]];
for (const [name, open] of ORDER_SCREENS) for (const width of [390, 1280]) test.describe(`D6 ${name} ${width}`, () => {
  if (width < 1000) test.use({ hasTouch: true });
  test(`D6 ${name} ${width}: ⋯ 메뉴에 위로·아래로 없음, 끌어서 순서 바꾸기(새로고침해도 그대로), Alt+↑↓`, async ({ page }) => {
    const s = await open(page, width);
    const [a, b, c, d] = s.ids;
    expect(await s.order()).toEqual([a, b, c, d]);
    for (const id of s.ids) {
      const menu = await s.openMenu(id);
      await expect(menu.locator('button, [role="menuitem"]', { hasText: /^\s*(위로|아래로|↑|↓)\s*$/ })).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
    }
    // 끌기: 마지막 줄(d)을 첫 줄(a) 윗부분(위 25% 안)에 놓는다 → d가 맨 앞.
    const to = await s.row(a).boundingBox(), from = await s.row(d).boundingBox();
    const target = { x: to.x + Math.min(60, to.width / 2), y: to.y + to.height * 0.1 };
    if (width < 1000) {
      await page.waitForTimeout(700);
      await touchDrag(page, { x: from.x + Math.min(60, from.width / 2), y: from.y + from.height / 2 }, target, { hold: 650 });
    } else {
      await page.mouse.move(from.x + 60, from.y + from.height / 2); await page.mouse.down();
      await page.mouse.move(from.x + 70, from.y + from.height / 2 + 6, { steps: 3 });
      await page.mouse.move(target.x, target.y, { steps: 8 }); await page.mouse.up();
    }
    await expect.poll(s.order).toEqual([d, a, b, c]);
    await s.reopen();
    await expect.poll(s.order).toEqual([d, a, b, c]);
    // 키보드: 초점 둔 줄에서 Alt+↓ = 한 칸 아래, Alt+↑ = 한 칸 위(눈에 보이는 단추 없이).
    await s.focus(a);
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(s.order).toEqual([d, b, a, c]);
    await s.focus(c);
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(s.order).toEqual([d, b, c, a]);
    await s.reopen();
    await expect.poll(s.order).toEqual([d, b, c, a]);
    expect(s.errors).toEqual([]);
  });
});

// ---------- S5·K1·K2 목록 공용 키(UI-목록공용키 S70-18, docs/qa/folder-tree-audit-20261125.md N2·N3·N4) ----------
// 공용 부품 app/select-keys.js: 목록 줄에 커서를 두고 Ctrl+A = 그 목록 전체 고르기(화면 글자 전체가 아님), Delete = 그 화면 [삭제](확인 창·되돌리기 알림 그대로),
// F2 = 고른 줄, 없으면 커서 줄 이름 바꾸기. 글 쓰는 칸 안 Ctrl+A·Delete는 글자 동작 그대로. 새 목록 화면은 KEY_SCREENS에 한 줄 더한다.
// 화면마다 돌려줄 것: rows(목록 줄 locator), focus(i)(i번째 줄에 커서), picked()(고른 줄 수), total(줄 수), pickTwo()(두 줄 고르기),
// renameOpen(i)(이름 칸이 i번째 줄 이름으로 열렸나), field(글 쓰는 칸), id(i)(줄 열쇠), deleteOne(id)·deleteMany()(Delete 뒤 확인 창·되돌리기 확인).
const textSelected = page => page.evaluate(() => String(window.getSelection?.() || '').trim().length);
const askBox = page => page.locator('.kptu-ask').filter({ visible: true });
async function keyLibrary(page) {
  const docs = ['가', '나', '다', '라'].map((n, i) => libDoc('k' + i, null, { title: '가상 ' + n + ' 자료', file_name: 'k' + i + '.pdf' }));
  const { errors } = await bootLibrary(page, 1280, { folders: [], items: [], docs, init: { deletes: [] } });
  await page.evaluate(() => window.__KPTU_LIBRARY_UPLOAD_READY__);
  for (const d of docs) await revealLibraryRow(page, d.id);
  const rows = page.locator('#documentList .lu-row[data-lu-document]').filter({ visible: true });
  await expect(rows).toHaveCount(4);
  return { errors, rows, total: 4,
    focus: i => rows.nth(i).focus(),
    picked: () => page.locator('#documentList .lu-row.lu-picked').count(),
    pickTwo: async () => { await rows.nth(0).click({ modifiers: ['Control'] }); await rows.nth(1).click({ modifiers: ['Control'] }); await expect(page.locator('#documentList .lu-row.lu-picked')).toHaveCount(2); },
    renameOpen: async i => { const input = rows.nth(i).locator('.lu-rename-input'); await expect(input).toBeFocused(); await expect(input).toHaveValue(/가상 . 자료/); await input.press('Escape'); },
    field: page.locator('#documentSearch'),
    id: i => rows.nth(i).getAttribute('data-lu-document'),
    deleteOne: async id => {
      await expect(page.locator(`#documentList [data-lu-document="${id}"]`)).toHaveCount(0);
      await page.locator('#kptuNotice .kptu-notice-undo').click();
      await expect(page.locator(`#documentList [data-lu-document="${id}"]`)).toHaveCount(1);
    },
    deleteMany: async () => {
      await expect(page.locator('.kptu-ask-text')).toHaveText('2개를 삭제할까요?');
      await page.locator('.kptu-ask button', { hasText: '삭제' }).click();
      await expect(rows).toHaveCount(2);
      await page.locator('#kptuNotice .kptu-notice-undo').click();
      await expect(rows).toHaveCount(4);
    } };
}
async function keyNotes(page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  await installViewPrefsServer(page);
  const note = (id, title) => ({ id, workspace_id: 'w', kind: 'note', title, raw_text: title + ' 본문', occurred_at: '2026-10-10T01:00:00Z', created_at: '2026-10-10T01:00:00Z', updated_at: '2026-10-1' + id.slice(-1) + 'T01:00:00Z', archived_at: null, ai_export_allowed: true, attachments: [], metadata: {} });
  const rowsData = [note('n1', '가상 가 노트'), note('n2', '가상 나 노트'), note('n3', '가상 다 노트')];
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(rowsData) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  await page.locator('[data-nx-tree] [data-nx-open]').first().click(); // 왼쪽 나무 '폴더 없음' = 오른쪽에 노트 3개
  const rows = page.locator('#noteRows [data-nx-note]').filter({ visible: true });
  await expect(rows).toHaveCount(3);
  return { errors, rows, total: 3,
    focus: i => rows.nth(i).locator('[data-note-row]').focus(),
    picked: () => page.locator('#noteRows [data-nx-note].nx-picked').count(),
    pickTwo: async () => { await rows.nth(0).locator('[data-note-row-more]').click(); await page.locator('#noteDocMenu [data-nx-select]').click(); await rows.nth(1).locator('[data-note-row]').click(); await expect(page.locator('#noteRows .nx-picked')).toHaveCount(2); await rows.nth(1).locator('[data-note-row]').focus(); },
    renameOpen: async () => { const input = page.locator('[data-note-title-input]'); await expect(input).toBeFocused(); await expect(input).toHaveValue(/가상 . 노트/); },
    field: page.locator('[data-note-search]'),
    id: i => rows.nth(i).getAttribute('data-nx-note'),
    deleteOne: async () => { await expect(askBox(page)).toBeVisible(); await expect(page.locator('.kptu-ask-text')).toContainText('노트를 휴지통으로 옮길까요?'); await page.keyboard.press('Escape'); await expect(rows).toHaveCount(3); },
    deleteMany: async () => { await expect(page.locator('.kptu-ask-text')).toHaveText('노트 2개를 삭제할까요?'); await page.keyboard.press('Escape'); await expect(rows).toHaveCount(3); } };
}
async function keyFiles(page) {
  const { errors } = await startFiles(page, 1280);
  await openFiles(page, 1280);
  await treeGo(page, 'od');
  await enterRow(page, page.locator('#filesRoot [data-fx-list] [data-fx-row="od:OD!1"]'));
  const rows = page.locator('#filesRoot [data-fx-list] [data-fx-row]').filter({ visible: true });
  await expect(page.locator('#filesRoot [data-fx-list] [data-fx-row="od:OD!11"]')).toBeVisible();
  const total = await rows.count();
  return { errors, rows, total,
    focus: i => rows.nth(i).focus(),
    picked: () => page.locator('#filesRoot [data-fx-list] [data-fx-row][aria-selected="true"], #filesRoot [data-fx-list] [data-fx-row].fx-picked').count(),
    pickTwo: async () => { await rows.nth(1).click({ modifiers: ['Control'] }); await rows.nth(2).click({ modifiers: ['Control'] }); },
    renameOpen: async () => { await expect(askBox(page).locator('.kptu-ask-field')).toBeVisible(); await expect(askBox(page).locator('.kptu-ask-field')).toHaveValue(/가짜/); await page.keyboard.press('Escape'); },
    field: page.locator('#filesRoot [data-fx-search]'),
    id: i => rows.nth(i).getAttribute('data-fx-row'),
    deleteOne: async () => { await expect(askBox(page)).toBeVisible(); await expect(page.locator('.kptu-ask-text')).toContainText('휴지통'); await page.keyboard.press('Escape'); },
    deleteMany: async () => { await expect(page.locator('.kptu-ask-text')).toContainText('2개'); await page.keyboard.press('Escape'); } };
}
const KEY_SCREENS = [['자료실', keyLibrary], ['노트', keyNotes], ['파일', keyFiles]];
for (const [name, open] of KEY_SCREENS) test(`S5 ${name} PC 1280: Ctrl+A = 목록 전체`, async ({ page }) => {
  const s = await open(page);
  await s.focus(1);
  await page.keyboard.press('Control+a');
  await expect.poll(s.picked).toBe(s.total);
  expect(await textSelected(page), '화면 글자 전체가 골라지지 않는다').toBe(0);
  expect(s.errors).toEqual([]);
});
for (const [name, open] of KEY_SCREENS) test(`K1 ${name} PC 1280: Delete = 고른 것 지우기(확인 창·되돌리기)`, async ({ page }) => {
  const s = await open(page);
  // 커서만 둔 줄 하나: 그 화면 ⋯ [삭제]와 같은 길.
  const id = await s.id(1);
  await s.focus(1);
  await page.keyboard.press('Delete');
  await s.deleteOne(id);
  // 고른 둘: 선택 막대 [삭제]와 같은 길(한 번 묻기).
  await s.pickTwo();
  await page.keyboard.press('Delete');
  await s.deleteMany();
  expect(s.errors).toEqual([]);
});
for (const [name, open] of KEY_SCREENS) test(`F2 ${name} PC 1280: 커서 줄 이름 바꾸기`, async ({ page }) => {
  const s = await open(page);
  await s.focus(1);
  await page.keyboard.press('F2');
  await s.renameOpen(1);
  expect(s.errors).toEqual([]);
});
for (const [name, open] of KEY_SCREENS) test(`S5·K1 ${name} PC 1280: 글 칸 안 Ctrl+A·Delete는 글자 동작 그대로`, async ({ page }) => {
  const s = await open(page);
  await s.field.fill('가상');
  await s.field.focus();
  await page.keyboard.press('Control+a');
  expect(await s.field.evaluate(el => [el.selectionStart, el.selectionEnd])).toEqual([0, 2]);
  expect(await s.picked()).toBe(0);
  await page.keyboard.press('Delete');
  await expect(s.field).toHaveValue('');
  await expect(askBox(page)).toHaveCount(0);
  expect(await s.picked()).toBe(0);
  expect(s.errors).toEqual([]);
});
