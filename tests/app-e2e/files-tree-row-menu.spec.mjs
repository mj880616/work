import { test, expect } from '@playwright/test';
import { start, openFiles } from './helpers/files-server.mjs';
// S51-22 (요청함 11/06 19:51): [파일] 폰 나무 줄 ⋯ = 그 자리 메뉴(하단바 위 판). 화면·펼친 자리·스크롤은 그대로, 옛 '폴더 안 + 고르기 줄'로 가지 않는다.
// 메뉴 항목은 예전 고르기 줄 기능 그대로(휴지통 맨 아래, 한 번 묻기). 서버는 흉내(이름 모두 가짜).
const root = page => page.locator('#filesRoot');
const tree = page => root(page).locator('[data-fx-tree]');
const menu = page => page.locator('#rowMenu');
const ask = page => page.locator('.kptu-ask');
const edgeCalls = (server, action) => server.calls.filter(c => c.what === 'edge' && c.action === action);
// 화면이 나무 그대로인가: 나무 보임, 폴더 목록·고르기 줄 숨김.
async function stillTree(page) {
  await expect(tree(page)).toBeVisible();
  await expect(root(page).locator('[data-fx-list] [data-fx-row]')).toHaveCount(0);
  await expect(root(page).locator('[data-fx-bar]')).toBeHidden();
}

test('파일 폰 412: 펼친 폴더 안 파일 ⋯ = 그 자리 아래 판 · 화면·펼친 자리·스크롤 그대로 · 이름 바꾸기·휴지통', async ({ page }) => {
  const { errors, server } = await start(page, 412);
  await openFiles(page, 412);
  const od = tree(page).locator('[data-fx-box="od"]');
  await od.locator('[data-fx-fold="od:OD!1"] .ft-main').click();
  const file = od.locator('[data-ft-parent="od:OD!1"]').filter({ hasText: '가짜 안내문.pdf' });
  await expect(file).toBeVisible();
  const y = await page.evaluate(() => window.scrollY);
  const url = page.url();
  await file.locator('[data-fx-tmenu]').click();
  await expect(menu(page)).toBeVisible();
  await expect(menu(page)).toHaveClass(/am-sheet/);
  await expect(menu(page).locator('.row-menu-title')).toHaveText('가짜 안내문.pdf');
  await expect(menu(page).locator('button')).toHaveText(['열기', '복사', '옮기기', '이름 바꾸기', '별표', '휴지통']);
  await expect(menu(page).locator('button').last()).toHaveClass(/row-menu-last/);
  await stillTree(page);
  expect(await od.locator('[data-fx-fold="od:OD!1"] .ft-ico').getAttribute('data-ft-shape')).toBe('open');
  expect(await page.evaluate(() => window.scrollY)).toBe(y);
  // 판은 하단바 위(가리지 않음).
  const tab = await page.locator('#mobileMenuTab').boundingBox();
  const box = await menu(page).boundingBox();
  if (tab && box) expect(box.y + box.height).toBeLessThanOrEqual(tab.y + 1);
  await page.screenshot({ path: 'test-results/files-tree-row-menu-phone.png' });
  // 뒤로 키 = 메뉴만 닫힘(나무 그대로).
  await page.goBack();
  await expect(menu(page)).toBeHidden();
  await stillTree(page);
  expect(page.url()).toBe(url);
  // 이름 바꾸기: 그 자리에서 묻고 저장, 나무 그대로.
  await file.locator('[data-fx-tmenu]').click();
  await menu(page).getByRole('button', { name: '이름 바꾸기' }).click();
  await expect(ask(page).locator('.kptu-ask-field')).toHaveValue('가짜 안내문');
  await ask(page).locator('.kptu-ask-field').fill('가짜 안내문 고침');
  await ask(page).getByRole('button', { name: '바꾸기' }).click();
  await expect.poll(() => edgeCalls(server, 'rename').length).toBe(1);
  expect(edgeCalls(server, 'rename')[0].body).toMatchObject({ action: 'rename', source: 'od', id: 'OD!11', name: '가짜 안내문 고침.pdf' });
  await stillTree(page);
  // 휴지통: 맨 아래 항목 → 한 번 묻기 → 보냄, 나무 그대로.
  const memo = od.locator('[data-ft-parent="od:OD!1"]').filter({ hasText: '가짜 메모.txt' });
  await memo.locator('[data-fx-tmenu]').click();
  await menu(page).getByRole('button', { name: '휴지통' }).click();
  await expect(ask(page)).toContainText('휴지통으로 보낼까요?');
  await ask(page).getByRole('button', { name: '휴지통으로' }).click();
  await expect.poll(() => edgeCalls(server, 'trash').length).toBe(1);
  expect(edgeCalls(server, 'trash')[0].body).toMatchObject({ action: 'trash', source: 'od', ids: ['OD!13'] });
  await stillTree(page);
  expect(errors).toEqual([]);
});

test('파일 폰 412: 폴더 줄 ⋯ = 새 폴더·올리기·복사·옮기기·이름·색·순서·별표·휴지통, \'최근\' 줄 ⋯도 같은 그 자리 메뉴', async ({ page }) => {
  const { errors, server } = await start(page, 412);
  await openFiles(page, 412);
  const od = tree(page).locator('[data-fx-box="od"]');
  await od.locator('[data-fx-fold="od:OD!1"] [data-fx-tmenu]').click();
  await expect(menu(page).locator('button')).toHaveText(['이 폴더만 보기', '새 폴더', '올리기', '복사', '옮기기', '이름 바꾸기', '색', '아래로', '별표', '휴지통']);
  await stillTree(page);
  // 새 폴더: 그 폴더 안에 만든다(화면 그대로).
  await menu(page).getByRole('button', { name: '새 폴더' }).click();
  await ask(page).locator('.kptu-ask-field').fill('가짜 새 폴더');
  await ask(page).getByRole('button', { name: '만들기' }).click();
  await expect.poll(() => edgeCalls(server, 'mkdir').length).toBe(1);
  expect(edgeCalls(server, 'mkdir')[0].body).toMatchObject({ action: 'mkdir', source: 'od', parent: 'OD!1', name: '가짜 새 폴더' });
  await stillTree(page);
  // 두 번째 폴더는 '위로'가 있고 '아래로'는 없다(맨 끝).
  await od.locator('[data-fx-fold="od:OD!2"] [data-fx-tmenu]').click();
  await expect(menu(page).getByRole('button', { name: '위로' })).toBeVisible();
  await expect(menu(page).getByRole('button', { name: '아래로' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
  // '최근' 상자 줄 ⋯.
  const recent = tree(page).locator('[data-fx-box="recent"] [data-fx-tmenu]').first();
  await recent.click();
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).locator('button').first()).toHaveText('열기');
  await stillTree(page);
  // '이 폴더만 보기'는 고른 때만 그 폴더 목록으로(⋯ 자체는 화면을 바꾸지 않음).
  await page.keyboard.press('Escape');
  await od.locator('[data-fx-fold="od:OD!1"] [data-fx-tmenu]').click();
  await menu(page).getByRole('button', { name: '이 폴더만 보기' }).click();
  await expect(root(page).locator('[data-fx-list] [data-fx-row]').first()).toBeVisible();
  await expect(root(page).locator('[data-fx-bar]')).toBeHidden();
  expect(errors).toEqual([]);
});
