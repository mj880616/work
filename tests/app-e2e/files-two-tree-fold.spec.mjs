import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { start, openFiles } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
// S52-41 ③ FILES-두칸나무접기(명진 결정 (가) 11/08, 시안 docs/design/mockups/files-two-pane-tree.html):
// 두 칸 보기(폴드 펼침·PC)면 왼쪽 나무를 접어 두고 맨 위 줄 왼쪽 ◫로 열고 닫는다(서버 view_prefs.files_tree.<기기>.<fold|wide>).
// 나무에서 누른 폴더는 지금 칸에 열리고, 칸 위 [출처 ▾] 맨 위에 별표·큰 파일. 나무 폴더 줄을 칸으로 끌면 [복사][옮기기]. 한 칸·폰은 그대로.
// 서버는 흉내(파일·폴더 이름은 모두 가짜).
const root = page => page.locator('#filesRoot');
const tree = page => root(page).locator('[data-fx-tree]');
const tog = page => root(page).locator('[data-fx-tree-tog]');
const pane = (page, i) => root(page).locator(`[data-fx-pane-i="${i}"]`);
const SHOTS = process.env.FILES_TREE_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }); } };
async function begin(page, width, prefs, opts = {}) {
  const { errors, server } = await start(page, width);
  const store = await installViewPrefsServer(page, prefs, opts);
  await page.reload();
  await openFiles(page, width, { two: true });
  return { errors, server, prefs: store };
}

test('PC 1440 두 칸: 나무는 접혀 있고 두 칸이 넓게 · ◫로 열면 나무 폴더가 지금 칸에 열림 · 다시 열어도 기억 · 다시 ◫로 닫음', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, prefs } = await begin(page, 1440, { files_two: { pc: { wide: true } } });
  await expect(pane(page, 1)).toBeVisible();
  await expect(tree(page)).toBeHidden();
  await expect(root(page)).toHaveAttribute('data-fx-tree-shut', '');
  await expect(tog(page)).toBeVisible();
  await expect(tog(page)).toHaveAttribute('aria-label', '폴더 나무 열기');
  // 두 칸이 화면을 반씩(나무 몫 없음).
  expect(await pane(page, 0).evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(500);
  await shot(page, 'files-two-tree-shut-1440');
  await tog(page).click();
  await expect(tree(page)).toBeVisible();
  await expect(tog(page)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => prefs.value?.files_tree).toEqual({ pc: { wide: true } });
  // 오른쪽 칸을 지금 칸으로 → 나무의 구글 드라이브 › 가짜 업무 공간은 오른쪽 칸에 열린다.
  await pane(page, 1).locator('.fx-ptop').click({ position: { x: 300, y: 5 } });
  await expect(pane(page, 1)).toHaveClass(/fx-cur/);
  await tree(page).locator('[data-fx-go="gd"][data-fx-id=""]').click();
  await expect(pane(page, 1).locator('.fx-ptop .fx-psrc-name')).toHaveText('구글 드라이브');
  await expect(pane(page, 0).locator('.fx-ptop .fx-psrc-name')).toHaveText('원드라이브');
  await shot(page, 'files-two-tree-open-1440');
  // 다시 열어도 열린 채(서버 기억).
  await page.reload();
  await openFiles(page, 1440, { two: true });
  await expect(tree(page)).toBeVisible();
  await tog(page).click();
  await expect(tree(page)).toBeHidden();
  await expect.poll(() => prefs.value?.files_tree).toEqual({ pc: { wide: false } });
  expect(errors).toEqual([]);
});

test('PC 1440 두 칸: 칸 위 [출처 ▾] 맨 위에 별표·큰 파일 → 그 칸에 열림 · 나무 폴더 줄을 반대 칸으로 끌면 [복사][옮기기]', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await begin(page, 1440, { files_two: { pc: { wide: true } }, files_tree: { pc: { wide: true } } });
  await expect(tree(page)).toBeVisible();
  await pane(page, 1).locator('[data-fx-psrc]').click();
  const menu = pane(page, 1).locator('[data-fx-psrc-menu]');
  await expect(menu.locator('.fx-psrc-item').first()).toHaveText('별표');
  await expect(menu.locator('.fx-psrc-item').nth(1)).toHaveText('큰 파일');
  await menu.locator('[data-fx-psrc-shelf="starred"]').click();
  await expect(pane(page, 1).locator('[data-fx-row="od:OD!12"]')).toBeVisible(); // 별표한 가짜 예산표
  await expect(pane(page, 0).locator('[data-fx-row="od:OD!1"]')).toBeVisible(); // 왼쪽 칸은 그대로
  // 나무의 '가짜 사진함'을 오른쪽 칸으로 끌어 놓기 → [복사][옮기기] 고르기.
  await pane(page, 1).locator('.fx-ptop').click({ position: { x: 300, y: 5 } });
  await tree(page).locator('[data-fx-go="gd"][data-fx-id=""]').click();
  const row = tree(page).locator('[data-fx-fold="od:OD!2"]');
  await expect(row).toHaveAttribute('draggable', 'true');
  await row.dragTo(pane(page, 1).locator('[data-fx-list]'));
  const ask = root(page).locator('[data-fx-dropask]');
  await expect(ask).toBeVisible();
  await expect(ask.locator('[data-fx-drop-go]')).toHaveText(['복사', '옮기기']);
  await ask.locator('[data-fx-drop-x]').click();
  expect(errors).toEqual([]);
});

test('폴드 884 두 칸도 같게: 나무 접힘 → ◫로 열면 나무 | 두 칸, 서버가 거절해도(DB 적용 전) 이번 접속은 열린 채', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await begin(page, 884, { files_two: { pc: { fold: true } } }, { denyKeys: ['files_tree'] });
  await expect(root(page)).toHaveAttribute('data-fx-two', 'fold');
  await expect(tree(page)).toBeHidden();
  await tog(page).click();
  await expect(tree(page)).toBeVisible();
  await expect(pane(page, 0)).toBeVisible();
  await expect(pane(page, 1)).toBeVisible();
  // 나무 오른쪽에 두 칸(나무가 칸을 덮지 않음).
  const treeRight = await tree(page).evaluate(el => el.getBoundingClientRect().right), paneLeft = await pane(page, 0).evaluate(el => el.getBoundingClientRect().left);
  expect(paneLeft).toBeGreaterThanOrEqual(treeRight - 1);
  await page.waitForTimeout(600);
  await expect(tree(page)).toBeVisible();
  await expect(tog(page)).toHaveAttribute('aria-pressed', 'true');
  await shot(page, 'files-two-tree-open-884');
  expect(errors).toEqual([]);
});

test('한 칸 1440·폰 412 두 칸: ◫ 없음(지금대로)', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await start(page, 1440);
  await installViewPrefsServer(page, null);
  await page.reload();
  await openFiles(page, 1440);
  await expect(tog(page)).toBeHidden();
  await expect(tree(page)).toBeVisible();
  await page.setViewportSize({ width: 412, height: 900 });
  await expect(tog(page)).toBeHidden();
  expect(errors).toEqual([]);
});
