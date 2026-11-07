import { test, expect } from '@playwright/test';
import { start, openFiles } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S52-44 ② FILES-관리자마무리(요청함 11/08 "칸마다 마지막으로 보던 폴더 서버 기억(다시 열면 그 자리)"):
// 칸마다 마지막으로 보던 원드라이브·구글 드라이브 폴더는 서버 view_prefs.files_last에 두고, 다시 열면 그 폴더로 연다.
// 없어진 폴더면 맨 위로 열고 기억을 지운다. 서버·클라우드는 흉내(폴더 이름은 모두 가짜).
const root = page => page.locator('#filesRoot');
const row = (page, key) => root(page).locator(`[data-fx-row="${key}"]`);
const pane = (page, i) => root(page).locator(`[data-fx-pane-i="${i}"]`);
async function begin(page, width, prefs = null) {
  const { errors, server } = await start(page, width);
  const store = await installViewPrefsServer(page, prefs);
  await page.reload();
  await openFiles(page, width, { two: !!prefs?.files_two });
  return { errors, server, prefs: store };
}
// 주소에 자리(at) 없이 앱을 새로 열고 메뉴로 [파일]에 들어간다(다시 열기).
async function reopen(page, width, two = false) {
  await page.goto(new URL('/app/', page.url()).href);
  await openFiles(page, width, { two });
}

test('PC 1440: 연 폴더를 서버에 기억 → 다시 열면 그 폴더, 맨 위로 가면 기억을 지움', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, prefs } = await begin(page, 1440);
  await expect(row(page, 'od:OD!1')).toBeVisible();
  await row(page, 'od:OD!1').click();
  await expect(row(page, 'od:OD!11')).toBeVisible();
  await expect.poll(() => prefs.value?.files_last).toEqual([{ od: 'OD!1' }]);
  await reopen(page, 1440);
  await expect(row(page, 'od:OD!11')).toBeVisible();
  await expect(row(page, 'od:OD!1')).toHaveCount(0);
  // 맨 위로(위치 줄 첫 단계) → 기억에서 빠짐.
  await root(page).locator('[data-fx-tree] [data-fx-go="od"][data-fx-id=""]').first().click();
  await expect(row(page, 'od:OD!1')).toBeVisible();
  await expect.poll(() => prefs.value?.files_last ?? null).toBe(null);
  expect(errors).toEqual([]);
});

test('PC 1440: 기억한 폴더가 없어졌으면 맨 위로 열고 기억을 지운다', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, prefs } = await begin(page, 1440, { files_last: [{ od: 'GONE!9' }] });
  await expect(row(page, 'od:OD!1')).toBeVisible();
  await expect.poll(() => prefs.value?.files_last ?? null).toBe(null);
  expect(errors).toEqual([]);
});

test('PC 1440 두 칸: 칸마다 따로 — 왼쪽 원드라이브 폴더, 오른쪽 구글 드라이브 폴더로 다시 열림', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await begin(page, 1440, { files_two: { pc: { wide: true } }, files_last: [{ od: 'OD!1' }, { gd: 'gdFolder1' }] });
  await expect(pane(page, 0).locator('[data-fx-row="od:OD!11"]')).toBeVisible();
  await expect(pane(page, 1).locator('[data-fx-row="gd:gdDoc1"]')).toBeVisible();
  expect(errors).toEqual([]);
});
