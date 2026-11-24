import { test, expect } from '@playwright/test';
import { appOrigin } from './helpers/test-origin.mjs';
import { bootLibrary, libFolder } from './helpers/library-folder-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
import { start as startFiles, openFiles, treeGo, enterRow } from './helpers/files-server.mjs';
// STD-기본동작(docs/design/standard-interactions.md): 윈도우 탐색기·구글 드라이브·노션에서 당연한 기본 동작을 화면마다 같은 시험으로 반복 확인한다.
// 기준표 항목 ID(K4·D4·S6·Z3…)를 시험 이름 앞에 붙인다. 새 목록·나무 화면이 생기면 아래 SCREENS 표에 한 줄 더한다.
// 이름은 모두 지어낸 것이다. 서버 쓰기는 없다(가짜 서버).

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const N = 6;

// ---------- 화면 열기(나무가 있는 화면) ----------
async function library(page, width) {
  const folders = Array.from({ length: N }, (_, i) => libFolder('f' + i, null, { name: '가상 폴더 ' + i, sort_order: 1024 * (i + 1) }));
  const r = await bootLibrary(page, width, { folders, items: [] });
  await page.locator('#libraryGroupBy').selectOption({ label: '폴더' });
  return { errors: r.errors, tree: page.locator('#libraryFolderNav [role="tree"]'), main: '.ft-row .ft-main' };
}
async function notes(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await openHome(page);
  await installViewPrefsServer(page);
  const folders = Array.from({ length: N }, (_, i) => ({ id: U(100 + i), workspace_id: 'w', parent_id: null, name: '가상 폴더 ' + i, sort_order: 1024 * (i + 1), created_at: '2026-10-01T00:00:00Z' }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  return { errors, tree: page.locator('[data-nx-tree][role="tree"]'), main: '.ft-row .ft-main' };
}
async function photos(page, width) {
  const folders = Array.from({ length: N }, (_, i) => ({ id: 'S' + i, name: '가상 폴더 ' + i, parent_id: 'T' }));
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
  return { errors, tree: page.locator('#photosRoot [data-photos-fx-tree][role="tree"]'), main: '.nx-row .nx-main' };
}
const SCREENS = [['자료실', library], ['노트', notes], ['사진', photos]];

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
