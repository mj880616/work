import { test, expect } from '@playwright/test';
import { start, openFiles, treeGo, enterRow } from './helpers/files-server.mjs';
// S61-17 FILE-옮긴뒤CtrlZ(요청함 11/12 14:23 "파일 이동 후 ctrl + z로 되돌리기"):
// [파일] 같은 저장소 안 옮기기·이름 바꾸기의 [되돌리기]는 공용 되돌리기 기록(app/small-notice.js)에도 올라 PC Ctrl+Z로 되돌린다(같은 undo 하나).
// 다른 저장소로 보내기(서버 작업표)처럼 단추가 없는 일은 기록에 오르지 않아 Ctrl+Z가 아무것도 하지 않는다. 서버는 흉내(이름은 모두 지어낸 것).
const root = page => page.locator('#filesRoot');
const row = (page, key) => root(page).locator(`[data-fx-row="${key}"]`);
const names = page => root(page).locator('[data-fx-list] [data-fx-row] :is(.fx-name, .ft-name)').allTextContents();
const ask = page => page.locator('.kptu-ask');
const bar = page => root(page).locator('[data-fx-bar]');
const notice = page => page.locator('#kptuNotice:not([hidden])');
const edgeCalls = (server, action) => server.calls.filter(c => c.what === 'edge' && c.action === action);
const SHOTS = process.env.S61_17_SHOTS;

async function intoDocs(page, width) {
  await openFiles(page, width);
  await treeGo(page, 'od', '');
  await enterRow(page, row(page, 'od:OD!1'));
  await expect.poll(() => names(page)).toEqual(['가짜 2026', '가짜 메모.txt', '가짜 안내문.pdf', '가짜 예산표.xlsx']);
}

test('PC 1280: 파일을 다른 폴더로 옮긴 뒤 Ctrl+Z → 원래 폴더로, 이름 바꾸기도 Ctrl+Z, 다른 저장소로 보내기는 Ctrl+Z가 아무것도 안 함', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 1280);
  await intoDocs(page, 1280);
  // 잘라 붙이기로 '가짜 메모.txt'를 하위 폴더 '가짜 2026'에 옮긴다.
  await row(page, 'od:OD!13').click({ modifiers: ['Control'] });
  await page.keyboard.press('Control+x');
  await enterRow(page, row(page, 'od:OD!10'));
  await bar(page).locator('[data-fx-paste]').click();
  await expect.poll(() => edgeCalls(server, 'move').length).toBe(1);
  expect(edgeCalls(server, 'move')[0].body).toEqual({ action: 'move', source: 'od', ids: ['OD!13'], to: 'OD!10', confirm: true });
  await expect(notice(page).locator('.kptu-notice-undo')).toHaveText('되돌리기');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pc-1280-1-moved.png` });
  // 알림이 사라진 뒤에도 Ctrl+Z = 같은 되돌리기(원래 폴더로 다시 move).
  await expect(notice(page)).toHaveCount(0, { timeout: 8000 });
  await page.keyboard.press('Control+z');
  await expect.poll(() => edgeCalls(server, 'move').length).toBe(2);
  expect(edgeCalls(server, 'move')[1].body).toMatchObject({ action: 'move', source: 'od', ids: ['OD!13'], to: 'OD!1', confirm: true });
  await expect(notice(page)).toContainText('되돌렸어요: 옮기기 1개');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pc-1280-2-ctrlz.png` });
  // 한 번 되돌린 것은 다시 돌지 않는다.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  expect(edgeCalls(server, 'move')).toHaveLength(2);

  // 이름 바꾸기 → Ctrl+Z = 원래 이름으로.
  await treeGo(page, 'od', '');
  await enterRow(page, row(page, 'od:OD!1'));
  await row(page, 'od:OD!13').click();
  await root(page).locator('[data-fx-prev] [data-fx-rename-one]').click();
  await ask(page).locator('.kptu-ask-field').fill('가짜 메모 고침');
  await ask(page).getByRole('button', { name: '바꾸기' }).click();
  await expect(row(page, 'od:OD!13').locator(':is(.fx-name, .ft-name)')).toHaveText('가짜 메모 고침.txt');
  await row(page, 'od:OD!13').focus();
  await page.keyboard.press('Control+z');
  await expect.poll(() => edgeCalls(server, 'rename').length).toBe(2);
  expect(edgeCalls(server, 'rename')[1].body).toMatchObject({ action: 'rename', source: 'od', id: 'OD!13', name: '가짜 메모.txt' });
  await expect(notice(page)).toContainText("되돌렸어요: 이름 바꾸기 '가짜 메모 고침.txt'");

  // 다른 저장소(구글 드라이브)로 옮기기 = 서버 작업표. [되돌리기]가 없으니 Ctrl+Z도 아무것도 하지 않는다.
  await row(page, 'od:OD!13').click({ modifiers: ['Control'] });
  await page.keyboard.press('Control+x');
  await treeGo(page, 'gd', '');
  await enterRow(page, row(page, 'gd:gdFolder1'));
  await bar(page).locator('[data-fx-paste]').click();
  await ask(page).getByRole('button', { name: '옮기기' }).click();
  await expect(row(page, 'gd:gdJob01')).toBeVisible({ timeout: 15000 });
  await expect(notice(page).locator('.kptu-notice-undo')).toHaveCount(0);
  const before = server.calls.filter(c => c.what === 'edge').length;
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  expect(server.calls.filter(c => c.what === 'edge').length).toBe(before);
  await expect(page.getByText('되돌렸어요')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('폴드 884(키보드): 옮긴 뒤 Ctrl+Z → 원래 폴더로, 글 쓰는 칸 안에서는 Ctrl+Z가 글자 되돌리기', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 884);
  await intoDocs(page, 884);
  await row(page, 'od:OD!13').click({ modifiers: ['Control'] });
  await page.keyboard.press('Control+x');
  await enterRow(page, row(page, 'od:OD!10'));
  await bar(page).locator('[data-fx-paste]').click();
  await expect.poll(() => edgeCalls(server, 'move').length).toBe(1);
  // 이름 입력창 안 Ctrl+Z는 그 칸 몫(옮기기를 되돌리지 않음).
  await root(page).locator('[data-fx-mkdir]').click();
  await ask(page).locator('.kptu-ask-field').fill('가');
  await ask(page).locator('.kptu-ask-field').press('Control+z');
  await page.waitForTimeout(300);
  expect(edgeCalls(server, 'move')).toHaveLength(1);
  await page.keyboard.press('Escape');
  await expect(ask(page)).toHaveCount(0);
  await page.locator('body').press('Control+z');
  await expect.poll(() => edgeCalls(server, 'move').length).toBe(2);
  expect(edgeCalls(server, 'move')[1].body).toMatchObject({ ids: ['OD!13'], to: 'OD!1' });
  await expect(notice(page)).toContainText('되돌렸어요: 옮기기 1개');
  expect(errors).toEqual([]);
});

test('폰 412: 옮기기 알림의 [되돌리기] 단추는 그대로(같은 되돌리기), 누른 뒤 Ctrl+Z가 두 번 돌지 않음', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 412);
  await intoDocs(page, 412);
  await row(page, 'od:OD!13').click({ modifiers: ['Control'] });
  await page.keyboard.press('Control+x');
  await enterRow(page, row(page, 'od:OD!10'));
  await bar(page).locator('[data-fx-paste]').click();
  await expect.poll(() => edgeCalls(server, 'move').length).toBe(1);
  const undo = notice(page).locator('.kptu-notice-undo');
  await expect(undo).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-412-1-moved.png` });
  await undo.click();
  await expect.poll(() => edgeCalls(server, 'move').length).toBe(2);
  await expect(notice(page)).toContainText('되돌렸어요: 옮기기 1개');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-412-2-undone.png` });
  await page.locator('body').press('Control+z');
  await page.waitForTimeout(300);
  expect(edgeCalls(server, 'move')).toHaveLength(2);
  expect(errors).toEqual([]);
});
