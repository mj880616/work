import { test, expect } from '@playwright/test';
import { start, openFiles } from './helpers/files-server.mjs';
// S51-22 (요청함 11/06 19:51): [파일] 폰 나무 줄 ⋯ = 그 자리 메뉴. 화면·펼친 자리·스크롤은 그대로, 옛 '폴더 안 + 고르기 줄'로 가지 않는다.
// S51-31 (요청함 11/06 23:28): 화면 아래를 덮는 판 대신 누른 ⋯ 바로 아래(모자라면 위)의 작은 상자 — 줄을 가리지 않고, 누른 줄은 연보라, 아래 바 위, 화면 절반 넘게 덮지 않음.
// 메뉴 항목은 예전 고르기 줄 기능 그대로(휴지통 맨 아래, 한 번 묻기). 서버는 흉내(이름 모두 가짜).
const root = page => page.locator('#filesRoot');
const tree = page => root(page).locator('[data-fx-tree]');
const menu = page => page.locator('#rowMenu');
const ask = page => page.locator('.kptu-ask');
const edgeCalls = (server, action) => server.calls.filter(c => c.what === 'edge' && c.action === action);
// 화면이 나무 그대로인가: 나무 보임, 폴더 목록·고르기 줄 숨김.
// 작은 상자 판정: 폭 ≤ 200px, 화면 넓이의 절반 미만, 누른 줄 바로 아래(또는 바로 위)로 붙고 줄과 겹치지 않음, 하단바 위, 누른 줄 표시.
async function smallBoxBy(page, row) {
  const box = await menu(page).boundingBox(), r = await row.boundingBox(), vp = page.viewportSize();
  expect(box && r).toBeTruthy();
  expect(box.width).toBeLessThanOrEqual(200);
  expect(box.width * box.height).toBeLessThan(vp.width * vp.height / 2);
  const below = box.y >= r.y + r.height - 1, above = box.y + box.height <= r.y + 1;
  expect(below || above).toBe(true);
  expect(below ? box.y - (r.y + r.height) : r.y - (box.y + box.height)).toBeLessThanOrEqual(12);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  const tab = await page.locator('#mobileMenuTab').boundingBox();
  if (tab) expect(box.y + box.height).toBeLessThanOrEqual(tab.y + 1);
  await expect(row).toHaveClass(/row-menu-owner/);
  await expect(menu(page)).not.toHaveClass(/am-sheet/);
  const rowHeight = await menu(page).locator('button').first().evaluate(b => b.getBoundingClientRect().height);
  expect(rowHeight).toBeLessThanOrEqual(36);
  return {box, row: r, below};
}
async function stillTree(page) {
  await expect(tree(page)).toBeVisible();
  await expect(root(page).locator('[data-fx-list] [data-fx-row]')).toHaveCount(0);
  await expect(root(page).locator('[data-fx-bar]')).toBeHidden();
}

test('파일 폰 412: 펼친 폴더 안 파일 ⋯ = 그 줄 바로 옆 작은 상자 · 화면·펼친 자리·스크롤 그대로 · 이름 바꾸기·휴지통', async ({ page }) => {
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
  await expect(menu(page).locator('.row-menu-title')).toHaveCount(0);
  await expect(menu(page)).toHaveAttribute('aria-label', '가짜 안내문.pdf 메뉴');
  await expect(menu(page).locator('button')).toHaveText(['열기', '자료실로 보내기', '복사', '옮기기', '이름 바꾸기', '경로 복사', '별표', '휴지통']); // S52-43 ③ [경로 복사]
  await expect(menu(page).locator('button').last()).toHaveClass(/row-menu-last/);
  await expect(menu(page).locator('button .row-menu-ico')).toHaveCount(8);
  await expect(menu(page).locator('[data-row-item="trash"]')).toHaveCSS('color', await page.evaluate(() => { const d = document.createElement('i'); d.style.color = 'var(--kptu-danger)'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; }));
  await expect(menu(page).getByRole('button', { name: '열기' })).toBeFocused();
  await smallBoxBy(page, file);
  await stillTree(page);
  expect(await od.locator('[data-fx-fold="od:OD!1"] .ft-ico').getAttribute('data-ft-shape')).toBe('open');
  expect(await page.evaluate(() => window.scrollY)).toBe(y);
  await page.screenshot({ path: 'test-results/files-tree-row-menu-phone.png' });
  // 뒤로 키 = 메뉴만 닫힘(나무 그대로), 줄 표시도 지워짐.
  await page.goBack();
  await expect(menu(page)).toBeHidden();
  await expect(file).not.toHaveClass(/row-menu-owner/);
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
  // S52-43 ②: 알림 [되돌리기] = 원래 이름으로 같은 rename(confirm:true).
  await page.locator('.kptu-notice-undo').click();
  await expect.poll(() => edgeCalls(server, 'rename').length).toBe(2);
  expect(edgeCalls(server, 'rename')[1].body).toEqual({ action: 'rename', source: 'od', id: 'OD!11', name: '가짜 안내문.pdf', confirm: true });
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
  await expect(menu(page).locator('button')).toHaveText(['이 폴더로 들어가기', '새 폴더', '올리기', '자료실로 보내기', '복사', '옮기기', '이름 바꾸기', '경로 복사', '위에 고정', '별표', '색', '아래로', '휴지통']); // S52-41 ④: 폴더는 [위에 고정] · S53-8 ②: 폴더째 [자료실로 보내기]
  await expect(menu(page).locator('.row-menu-sep')).toHaveText(['위에 고정']);
  await smallBoxBy(page, od.locator('[data-fx-fold="od:OD!1"]'));
  await page.screenshot({ path: 'test-results/files-tree-row-menu-folder-phone.png' });
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
  // '이 폴더로 들어가기'는 고른 때만 그 폴더 목록으로(⋯ 자체는 화면을 바꾸지 않음).
  await page.keyboard.press('Escape');
  await od.locator('[data-fx-fold="od:OD!1"] [data-fx-tmenu]').click();
  await menu(page).getByRole('button', { name: '이 폴더로 들어가기' }).click();
  await expect(root(page).locator('[data-fx-list] [data-fx-row]').first()).toBeVisible();
  await expect(root(page).locator('[data-fx-bar]')).toBeHidden();
  expect(errors).toEqual([]);
});

test('파일 폰 412·폴드 접힘 360: 화면 아래쪽 줄 ⋯ = 줄 바로 위 작은 상자(아래 바에 가리지 않음) · 바깥 누르기 = 닫힘', async ({ page }) => {
  const { errors } = await start(page, 360);
  await page.setViewportSize({ width: 360, height: 640 });
  await openFiles(page, 360);
  const od = tree(page).locator('[data-fx-box="od"]');
  const row = od.locator('[data-fx-fold="od:OD!2"]');
  await expect(row).toBeVisible();
  // 줄을 하단바 바로 위로 내린다(화면 맨 아래 줄을 누른 것과 같음).
  const tab = await page.locator('#mobileMenuTab').boundingBox();
  await page.evaluate(() => { const s = document.createElement('div'); s.id = 'e2eSpacer'; s.style.height = '2000px'; document.querySelector('#filesRoot').append(s); });
  const r0 = await row.boundingBox();
  await page.evaluate(dy => window.scrollBy(0, dy), r0.y + r0.height - ((tab?.y ?? 640) - 8));
  await row.locator('[data-fx-tmenu]').click();
  await expect(menu(page)).toBeVisible();
  const { below } = await smallBoxBy(page, row);
  expect(below).toBe(false);
  await page.screenshot({ path: 'test-results/files-tree-row-menu-bottom-phone.png' });
  // 바깥 누르기 = 닫힘(누른 것은 그대로 전달 — 여기서는 빈 곳).
  await page.mouse.click(5, 200);
  await expect(menu(page)).toBeHidden();
  await expect(row).not.toHaveClass(/row-menu-owner/);
  await stillTree(page);
  expect(errors).toEqual([]);
});
