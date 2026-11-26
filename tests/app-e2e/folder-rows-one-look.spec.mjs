import { test, expect } from '@playwright/test';
import { start as startFiles, openFiles } from './helpers/files-server.mjs';
import { bootLibrary, libFolder, libDoc } from './helpers/library-folder-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { openHome } from './helpers/home-entry.mjs';
import { chooseBasketKind } from './helpers/basket-kind.mjs';
import { clickView } from './helpers/shell-navigation.mjs';
import { treeEnter } from './helpers/tree-enter.mjs';
// UI-폴더목록한모양(S69-90, 명진 11/25 "파일 인터페이스로 자료실도 바꿔 … 모든 폴더 쓰는 ui를 통일 시키는 거 맞지? 노트 사진 등 모두"):
// 폴더를 쓰는 화면(자료실·노트·사진)의 폴더 줄이 [파일] 폴더 줄과 같은 모양인지 계산된 값으로 비교한다 — 줄 높이·글자 크기·폴더 그림 폭·⋯ 크기·⋯ 자리(줄 오른쪽 끝에서),
// 고른 줄 표시(옅은 강조 바탕 + 왼쪽 세로줄, 줄 앞 체크칸 없음), 개수 글씨(작은 흐린 글씨), 주소 줄 하나(이름이 두 번 보이지 않음).
// 폰 390 · 폴드 펼침 880 · PC 1280. 이름은 모두 지어낸 것이다(가짜 서버, 쓰기 없음).

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
const SHOTS = 'test-results/ui-audit';
const watch = page => { const errors = []; page.on('pageerror', e => errors.push(e.message)); return errors; };

// ---------- 화면 열기 ----------
async function files(page, width) {
  const { errors } = await startFiles(page, width);
  await openFiles(page, width);
  // 폰: 원드라이브 상자 첫 폴더 줄, 넓은 화면: 왼쪽 나무 폴더 줄(아이콘이 따로인 줄).
  const row = width < 761 ? page.locator('#filesRoot [data-fx-box="od"] .ft-row.ft-folder').first() : page.locator('#filesRoot [data-fx-tree] .ft-row.ft-folder.ft-has-tog').first();
  return { errors, row, main: '.ft-main', ico: '.ft-ico', dots: '.ft-dots', num: '.ft-num' };
}
async function library(page, width) {
  const folders = [libFolder('fa', null, { name: '가상 사업', sort_order: 1024 }), libFolder('fb', null, { name: '가상 둘', sort_order: 2048 })];
  const r = await bootLibrary(page, width, { folders, items: [{ document_id: 'd-1', folder_id: 'fa' }], docs: [libDoc('d-1', null), libDoc('d-2', null)], group: '폴더' });
  const row = width < 761 ? page.locator('#documentList summary.lu-node-head[data-lu-top]', { hasText: '가상 사업' }).first() : page.locator('#libraryFolderNav .ft-row.ft-folder.ft-has-tog').first();
  return width < 761 ? { errors: r.errors, row, main: null, ico: '.lu-folder-shape, .fl-ico, svg', dots: '.lu-node-more', num: '.lu-node-count' }
    : { errors: r.errors, row, main: '.ft-main', ico: '.ft-ico', dots: '.ft-dots', num: '.ft-num' };
}
async function notesServer(page, width, { deep = false } = {}) {
  await page.setViewportSize({ width, height: 900 });
  const errors = watch(page);
  await openHome(page);
  await installViewPrefsServer(page);
  const folders = [0, 1, 2].map(i => ({ id: U(100 + i), workspace_id: 'w', parent_id: null, name: '가상 폴더 ' + i, sort_order: 1024 * (i + 1), created_at: '2026-10-01T00:00:00Z' }));
  if (deep) folders.push({ id: U(110), workspace_id: 'w', parent_id: U(100), name: '가상 안쪽', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' });
  const notes = [0, 1].map(i => ({ id: U(200 + i), workspace_id: 'w', folder_id: deep ? U(110) : U(100), title: '가상 노트 ' + i, body: '', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_notes', r => r.request().method() === 'GET' ? r.fulfill({ json: notes }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_note_folders', r => r.request().method() === 'GET' ? r.fulfill({ json: structuredClone(folders) }) : r.fulfill({ status: 500, json: {} }));
  await page.route(SB + '/rest/v1/app_record_links?**', r => { const q = new URL(r.request().url()).searchParams; return q.has('note_id') ? r.fulfill({ json: [] }) : r.fallback(); });
  await page.evaluate(() => window.KPTURouter.go('basket'));
  await chooseBasketKind(page, 'note');
  return errors;
}
async function notes(page, width) {
  const errors = await notesServer(page, width);
  const row = width < 600 ? page.locator('#noteRows [data-nx-folder]').first() : page.locator('[data-nx-tree] [data-nx-folder]').first();
  return { errors, row, main: '.ft-main', ico: '.ft-ico', dots: '.ft-dots', num: '.ft-num' };
}
async function photosServer(page, width) {
  const folders = [0, 1, 2].map(i => ({ id: 'S' + i, name: '가상 폴더 ' + i, parent_id: 'T' }));
  await page.setViewportSize({ width, height: 900 });
  const errors = watch(page);
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
    if (body.action === 'folders-tree') return r.fulfill({ json: { top: { id: 'T', name: '가상 카메라', count: 0, total: 9 }, folders: folders.map(f => ({ ...f, enabled: true, count: 3, total: 3 })), indexing: false } });
    return r.fulfill({ status: 400, json: { error: 'action_invalid' } });
  });
  await clickView(page, 'photos');
  await page.locator('#photosRoot [data-photos-view]').selectOption('folders');
  return errors;
}
async function photos(page, width) {
  const errors = await photosServer(page, width);
  // 폰: 원드라이브 상자 폴더 줄. PC: 왼쪽 나무 폴더 줄(맨 위 '카메라' 아래 첫 폴더). 폴드 펼침 첫 화면은 표지 카드라(격자) 줄 비교에서 뺀다.
  const row = width >= 1200 ? page.locator('#photosRoot [data-photos-fx-tree] [data-photos-folder="S0"]') : page.locator('#photosRoot [data-photos-folder="S0"]').first();
  return { errors, row, main: '.ft-main', ico: '.ft-ico', dots: '.ft-dots', num: '.ft-num' };
}

// S70-83 READ-저장한글폴더: 저장한 글 왼쪽 위 폴더 상자(공용 folder-tree-ui.mjs 상자·줄).
async function reading(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const errors = watch(page);
  await openHome(page);
  await installViewPrefsServer(page);
  const item = { id: U(310), url: 'https://example.com/1', title: '가상 저장 글', site: 'example.com', saved_at: '2026-11-25T01:00:00Z', read_at: null, body_state: 'ok',
    body_at: '2026-11-25T01:00:10Z', business_area_id: null, updated_at: '2026-11-25T01:00:10Z', folder_id: U(300), body: '가상 본문' };
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_reading_items', r => r.request().method() === 'GET' ? r.fulfill({ json: [item] }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_reading_folders', r => r.request().method() === 'GET'
    ? r.fulfill({ json: [{ id: U(300), name: '가상 폴더', sort_order: 1024, created_at: '2026-10-01T00:00:00Z' }] }) : r.fulfill({ status: 500, json: {} }));
  await page.route(u => u.origin === SB && u.pathname === '/rest/v1/app_news_highlights', r => r.fulfill({ json: [] }));
  await page.evaluate(() => window.KPTURouter.go('reading'));
  const row = page.locator('#readingView [data-rd-folders] .ft-row.ft-folder').first();
  return { errors, row, main: '.ft-main', ico: '.ft-ico', dots: '.ft-dots', num: '.ft-num' };
}

async function look(o) {
  await expect(o.row).toBeVisible();
  return o.row.evaluate((row, { main, ico, dots, num }) => {
    const m = main ? row.querySelector(main) : row, r = row.getBoundingClientRect(), cs = getComputedStyle(m);
    const i = row.querySelector(ico), d = row.querySelector(dots), n = row.querySelector(num);
    const db = d?.getBoundingClientRect();
    return {
      height: Math.round(m.getBoundingClientRect().height), font: cs.fontSize,
      icon: i ? Math.round(i.getBoundingClientRect().width) : null,
      iconLeft: i ? Math.round(i.getBoundingClientRect().left - r.left) : null, // 줄 왼쪽 끝에서 폴더 그림까지(왼쪽 여백)
      dotsW: db ? Math.round(db.width) : null, dotsH: db ? Math.round(db.height) : null, dotsRight: db ? Math.round(r.right - db.right) : null,
      numFont: n ? getComputedStyle(n).fontSize : null,
      // 옛 사진·노트 줄(.nx-row)이 남아 있지 않은지.
      old: !!row.closest('.nx-row') || row.classList.contains('nx-row'),
    };
  }, { main: o.main, ico: o.ico, dots: o.dots, num: o.num });
}

const SCREENS = [['자료실', 'library', library], ['노트', 'notes', notes], ['사진', 'photos', photos], ['저장한 글', 'reading', reading]];
const baseline = {};
async function filesLook(browser, width) {
  if (baseline[width]) return baseline[width];
  const page = await browser.newPage();
  const f = await files(page, width);
  await expect.poll(async () => (await look(f)).icon).toBe(20); // 나무가 다 그려진 뒤 잰다
  const v = await look(f);
  // 개수 글씨는 [파일] 줄 개수 칸(.ft-num) 아무 것(가짜 자료 첫 폴더에는 개수가 없을 수 있다).
  v.numFont = await page.locator('#filesRoot .ft-row .ft-num').first().evaluate(el => getComputedStyle(el).fontSize);
  await page.screenshot({ path: `${SHOTS}/s69-90-files-${width}.png` });
  expect(f.errors).toEqual([]);
  await page.close();
  return (baseline[width] = v);
}
for (const width of [390, 880, 1280]) for (const [name, slug, open] of SCREENS) {
  // 폴드 펼침 사진 첫 화면은 표지 카드(격자) — 줄 목록이 아니라 비교하지 않는다.
  if (name === '사진' && width === 880) continue;
  test(`L1 ${name} ${width}: 폴더 줄이 [파일] 폴더 줄과 같은 높이·글자·폴더 그림·⋯ 크기·⋯ 자리·개수 글씨`, async ({ browser, page }) => {
    test.setTimeout(90_000);
    const base = await filesLook(browser, width);
    expect(base.icon).toBe(20);
    const o = await open(page, width);
    await expect.poll(async () => (await look(o)).icon).toBe(20);
    const got = await look(o);
    await page.screenshot({ path: `${SHOTS}/s69-90-${slug}-${width}.png` });
    expect(got.old, `${name}: 옛 줄 모양(.nx-row)이 없다`).toBe(false);
    // UI-폴더줄크기(S69-99, 명진 11/25 08:23 "자료실 파일 폴더크기 위아래 간격 등 다름 파일 기준으로"): 자료실 폰 목록 폴더 묶음 머리도 모든 값이 [파일]과 같다
    // (전의 LIB-목록간격 ②·LIB-토글트리 ③ 예외를 대신함).
    const keys = ['height', 'font', 'icon', 'dotsW', 'dotsH', 'dotsRight', 'numFont', ...(width < 761 ? ['iconLeft'] : [])];
    for (const k of keys) expect(got[k], `${name} ${width} ${k}`).toBe(base[k]);
    expect(o.errors).toEqual([]);
  });
}

// 고른 줄 표시: [파일]과 같은 옅은 강조 바탕 + 왼쪽 세로줄, 줄 앞 체크칸 없음(노트 폴더 줄·노트 줄).
for (const width of [390, 1280]) test(`노트 ${width}: 고르기 중 폴더 줄·노트 줄에 체크칸이 없고 고른 줄은 [파일]처럼 바탕 + 왼쪽 세로줄`, async ({ page }) => {
  const errors = await notesServer(page, width);
  // 노트 줄 ⋯ [선택] = 고르기 시작(그 노트 하나 고름).
  const noteRow = page.locator('[data-note-list] [data-nx-note]:visible').first();
  await noteRow.locator('[data-note-row-more]').click();
  await page.locator('#noteDocMenu [data-nx-select]').click();
  await expect(page.locator('[data-nx-select-count]')).toHaveText('1개 선택됨');
  await expect(noteRow).toHaveClass(/nx-picked/);
  const noteLook = await noteRow.evaluate(el => getComputedStyle(el).boxShadow);
  expect(noteLook, '고른 노트 줄도 왼쪽 세로줄').toMatch(/inset/);
  const folder = (width < 600 ? page.locator('#noteRows [data-nx-folder]') : page.locator('[data-nx-tree] [data-nx-folder]')).first();
  await expect(folder).toBeVisible();
  await expect(page.locator('[data-note-list] .nx-pick')).toHaveCount(0);
  await folder.locator('.ft-name').click();
  await expect(folder).toHaveClass(/ft-picked/);
  await expect(folder.locator('.ft-main')).toHaveAttribute('aria-pressed', 'true');
  const pickedLook = await folder.locator('.ft-main').evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, bar: getComputedStyle(el).boxShadow, ref: (() => {
    // [파일] 고른 줄과 같은 값: 같은 규칙 이름(--kptu-primary-soft·--kptu-shadow-select)을 이 문서에서 풀어 본다.
    const t = document.createElement('div'); t.style.cssText = 'background:var(--kptu-primary-soft);box-shadow:var(--kptu-shadow-select)'; document.body.append(t);
    const v = { bg: getComputedStyle(t).backgroundColor, bar: getComputedStyle(t).boxShadow }; t.remove(); return v; })() }));
  expect(pickedLook.bar).toMatch(/inset/);
  expect(pickedLook.bg).toBe(pickedLook.ref.bg);
  expect(pickedLook.bar).toBe(pickedLook.ref.bar);
  await page.screenshot({ path: `${SHOTS}/s69-90-notes-picked-${width}.png` });
  expect(errors).toEqual([]);
});

// 주소 줄 하나: 넓은 화면 폴더 안 폴더에서 위치 줄과 '이름 · 개수' 줄이 따로 보이지 않는다(이름이 한 번만).
test('노트 PC 1280: 폴더 안 폴더에서 주소 줄이 하나(노트 › 위 폴더 › 지금 폴더 · 개수)', async ({ page }) => {
  const errors = await notesServer(page, 1280, { deep: true });
  const tree = page.locator('[data-nx-tree]');
  await treeEnter(tree.locator(`[data-nx-folder="${U(100)}"] .ft-main`));
  await treeEnter(tree.locator(`[data-nx-folder="${U(110)}"] .ft-main`));
  const here = page.locator('[data-nx-here]');
  await expect(here).toBeVisible();
  await expect(here).toHaveText(/^노트›가상 폴더 0›가상 안쪽 · \d+$/);
  await expect(page.locator('[data-nx-where]')).toBeHidden();
  const names = await page.locator('[data-note-list] :is([data-nx-where],[data-nx-here]):visible').evaluateAll(els => els.map(e => e.textContent).join(' '));
  expect(names.split('가상 안쪽').length - 1, '지금 폴더 이름은 한 번').toBe(1);
  // 위치 줄의 위 단계를 누르면 그 폴더로.
  await here.locator('[data-nx-at]', { hasText: '가상 폴더 0' }).click();
  await expect(here).toHaveText(/^가상 폴더 0 · \d+$/); // 맨 위 단 폴더는 위치 줄 없이 '이름 · 개수'
  expect(errors).toEqual([]);
});

test('사진 PC 1280: 폴더 안에서 주소 줄이 하나(사진 › 카메라 › 지금 폴더 · n장)', async ({ page }) => {
  const errors = await photosServer(page, 1280);
  const tree = page.locator('#photosRoot [data-photos-fx-tree]');
  await treeEnter(tree.locator('[data-photos-fx-open="S1"]'));
  const pane = page.locator('#photosRoot .photos-fx-pane');
  const here = pane.locator('.photos-fx-here');
  await expect(here).toHaveCount(1);
  await expect(here.locator('.photos-fx-path')).toHaveCount(1);
  await expect(pane.locator('.photos-fx-path')).toHaveCount(1); // 위치 줄은 이 한 줄 안에만
  await expect(here).toContainText('가상 폴더 1');
  await expect(here).toContainText('3장');
  const text = await pane.locator('.photos-fx-here').innerText();
  expect(text.split('가상 폴더 1').length - 1, '지금 폴더 이름은 한 번').toBe(1);
  const h = await here.evaluate(el => el.getBoundingClientRect().height);
  expect(h).toBeLessThan(40);
  await page.screenshot({ path: `${SHOTS}/s69-90-photos-path-1280.png` });
  expect(errors).toEqual([]);
});
