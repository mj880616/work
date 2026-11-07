import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { start, openFiles } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S52-41 ④ FILES-폴더고정(요청함 11/08, 시안 docs/design/mockups/files-pinned-folders.html): 나무 맨 위(별표 위) '📌 고정한 폴더' 상자.
// 폴더 ⋯·우클릭 [위에 고정]·[고정 풀기], 줄 오른쪽 흐린 출처 글자, 누르면 그 폴더(두 칸이면 지금 칸), ⠿로 순서(키보드 ↑↓),
// 클라우드 고정은 서버 view_prefs.files_pins(모든 기기 같게, 별표와 따로), 출처를 끄면 흐리게 '연결 안 됨'(지우지 않음). 나무 이름 옆 작은 📌.
// 서버는 흉내(폴더 이름은 모두 가짜). 내 PC 고정(그 PC에만)은 files-pc.spec.mjs가 본다.
const root = page => page.locator('#filesRoot');
const tree = page => root(page).locator('[data-fx-tree]');
const box = page => tree(page).locator('[data-fx-box="pins"]');
const pane = (page, i) => root(page).locator(`[data-fx-pane-i="${i}"]`);
const menuItem = (page, id) => page.locator(`[data-row-item="${id}"]`).first();
const SHOTS = process.env.FILES_PIN_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };
async function begin(page, width, prefs = null) {
  const { errors, server } = await start(page, width);
  const store = await installViewPrefsServer(page, prefs);
  await page.reload();
  await openFiles(page, width, { two: !!prefs?.files_two });
  return { errors, server, prefs: store };
}
async function pinFromTree(page, key) {
  await tree(page).locator(`[data-fx-fold="${key}"] [data-fx-tmenu]`).click();
  await menuItem(page, 'pin').click();
}

test('PC 1440: ⋯ [위에 고정] → 별표 위 상자(출처 글자), 나무 이름 옆 📌, 서버 기억 · ↑↓로 순서 · 누르면 그 폴더 · [고정 풀기]', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, prefs } = await begin(page, 1440);
  await expect(box(page)).toHaveCount(0);
  await pinFromTree(page, 'od:OD!1');
  await expect(box(page)).toBeVisible();
  await expect.poll(() => prefs.value?.files_pins).toEqual(['od:OD!1']);
  // 상자는 별표 위.
  const boxes = await tree(page).locator('[data-fx-box]').evaluateAll(els => els.map(e => e.dataset.fxBox));
  expect(boxes.indexOf('pins')).toBeLessThan(boxes.indexOf('shelves'));
  await expect(box(page).locator('.fx-pin')).toHaveCount(1);
  await expect(box(page).locator('.fx-pin .ft-name')).toHaveText(['가짜 문서함']);
  await expect(box(page).locator('.fx-pin .ft-num')).toHaveText(['원드라이브']);
  await expect(tree(page).locator('[data-fx-fold="od:OD!1"]')).toHaveClass(/fx-pinned/);
  await pinFromTree(page, 'gd:gdFolder1');
  await expect.poll(() => prefs.value?.files_pins).toEqual(['od:OD!1', 'gd:gdFolder1']);
  await expect(box(page).locator('.fx-pin .ft-name')).toHaveText(['가짜 문서함', '가짜 업무 공간']);
  // 키보드: 둘째 줄 ⠿에서 ↑ → 맨 위로.
  await box(page).locator('[data-reorder-id="gd:gdFolder1"] [data-reorder-handle]').focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => prefs.value?.files_pins).toEqual(['gd:gdFolder1', 'od:OD!1']);
  await expect(box(page).locator('.fx-pin .ft-name')).toHaveText(['가짜 업무 공간', '가짜 문서함']);
  await shot(page, 'files-pins-1440');
  // 누르면 그 폴더.
  await box(page).locator('[data-fx-pin-go="od:OD!1"]').click();
  await expect(pane(page, 0).locator('[data-fx-row="od:OD!11"]')).toBeVisible();
  // 다시 열어도 그대로(이름은 색인에서 다시 찾음).
  await page.reload();
  await openFiles(page, 1440);
  await expect(box(page).locator('.fx-pin .ft-name')).toHaveText(['가짜 업무 공간', '가짜 문서함']);
  // [고정 풀기].
  await box(page).locator('[data-fx-pin-menu="gd:gdFolder1"]').click();
  await menuItem(page, 'unpin').click();
  await expect.poll(() => prefs.value?.files_pins).toEqual(['od:OD!1']);
  await tree(page).locator('[data-fx-fold="od:OD!1"] [data-fx-tmenu]').click();
  await menuItem(page, 'unpin').click();
  await expect(box(page)).toHaveCount(0);
  await expect.poll(() => prefs.value?.files_pins ?? null).toBe(null);
  expect(errors).toEqual([]);
});

test('출처를 끄면 그 고정은 흐리게 "연결 안 됨"(지우지 않음), 다시 켜면 그대로', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, prefs } = await begin(page, 1440, { files_pins: ['gd:gdFolder1', 'od:OD!2'] });
  await expect(box(page).locator('.fx-pin .ft-name')).toHaveText(['가짜 업무 공간', '가짜 사진함']);
  await root(page).locator('[data-fx-src="gd"]').click();
  const gd = box(page).locator('[data-reorder-id="gd:gdFolder1"]');
  await expect(gd.locator('.ft-row')).toHaveClass(/ft-off/);
  await expect(gd.locator('.ft-num')).toHaveText('연결 안 됨');
  await gd.locator('[data-fx-pin-go]').click();
  await expect(page.getByText('꺼져 있거나 연결이 끊겼어요').first()).toBeVisible();
  expect(prefs.value?.files_pins).toEqual(['gd:gdFolder1', 'od:OD!2']);
  await root(page).locator('[data-fx-src="gd"]').click();
  await expect(gd.locator('.ft-num')).toHaveText('구글 드라이브');
  expect(errors).toEqual([]);
});

test('PC 1440 두 칸: 칸 위 [출처 ▾] 맨 위에 고정한 폴더 → 그 칸에 열림(다른 칸은 그대로)', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await begin(page, 1440, { files_two: { pc: { wide: true } }, files_pins: ['od:OD!1'] });
  await pane(page, 1).locator('[data-fx-psrc]').click();
  const first = pane(page, 1).locator('[data-fx-psrc-menu] .fx-psrc-item').first();
  await expect(first).toContainText('가짜 문서함');
  await first.click();
  await expect(pane(page, 1).locator('[data-fx-row="od:OD!11"]')).toBeVisible();
  await expect(pane(page, 0).locator('[data-fx-row="od:OD!1"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('폰 412: 나무 맨 위 같은 상자, 누르면 그 폴더 목록', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await begin(page, 412, { files_pins: ['od:OD!1'] });
  await expect(box(page).locator('.fx-pin .ft-name')).toHaveText(['가짜 문서함']);
  await box(page).locator('[data-fx-pin-go="od:OD!1"]').click();
  await expect(pane(page, 0).locator('[data-fx-row="od:OD!11"]')).toBeVisible();
  expect(errors).toEqual([]);
});
