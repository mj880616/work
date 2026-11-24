import { test, expect } from '@playwright/test';
import { appOrigin } from './helpers/test-origin.mjs';
import { bootLibrary, libFolder } from './helpers/library-folder-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
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
