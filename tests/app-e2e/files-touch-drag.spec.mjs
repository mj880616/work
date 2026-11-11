import { test, expect } from '@playwright/test';
import { start, openFiles, phoneFolder, enterRow } from './helpers/files-server.mjs';
import { installViewPrefsServer } from './helpers/view-prefs-server.mjs';
import { touchDrag } from './helpers/touch-drag.mjs';
// S51-20 FILES-폰보기끌기 ③(요청함 11/06 01:12, 시안 docs/design/mockups/files-phone-grid-two-drag.html ③): 꾹 눌러 끌기.
// 꾹 누르면 집어 들고 손가락을 따라 폴더(같은 칸·다른 칸) 위에서 보라 점선, 놓으면 [복사][옮기기] 고르기. 움직이지 않고 떼면 지금처럼 고르기.
// 같은 저장소 안 옮기기는 알림의 [되돌리기]로 원래 폴더로. 서버는 흉내(이름은 모두 지어낸 것).
const root = page => page.locator('#filesRoot');
const pane = (page, i) => root(page).locator(`[data-fx-pane-i="${i}"]`);
const prow = (page, i, key) => pane(page, i).locator(`[data-fx-row="${key}"]`);
const ask = page => root(page).locator('[data-fx-dropask]');
const edgeCalls = (server, action) => server.calls.filter(c => c.what === 'edge' && c.action === action);

test('폰 412 한 칸: 꾹 눌러 폴더 위로 끌면 점선 → 놓으면 [복사][옮기기] → 옮기기 → [되돌리기]로 원래 자리', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 412);
  await openFiles(page, 412);
  await phoneFolder(page, 'od');
  const from = prow(page, 0, 'od:OD!2'), to = prow(page, 0, 'od:OD!1');
  await expect(from).toBeVisible();
  let dashed = false;
  await touchDrag(page, from, to, { before: async () => { dashed = await to.evaluate(e => e.classList.contains('fx-drop-on')); await expect(page.locator('.td-ghost')).toHaveText('가짜 사진함'); } });
  expect(dashed).toBe(true);
  await expect(page.locator('.td-ghost')).toHaveCount(0);
  await expect(ask(page)).toBeVisible();
  await expect(ask(page).locator('b')).toHaveText('가짜 문서함');
  await ask(page).locator('[data-fx-drop-go="move"]').click();
  await expect.poll(() => edgeCalls(server, 'move').length).toBe(1);
  expect(edgeCalls(server, 'move')[0].body).toMatchObject({ action: 'move', source: 'od', ids: ['OD!2'], to: 'OD!1', confirm: true });
  await expect(prow(page, 0, 'od:OD!2')).toHaveCount(0);
  const undo = page.locator('#kptuNotice:not([hidden]) button', { hasText: '되돌리기' });
  await expect(undo).toBeVisible();
  await undo.click();
  await expect.poll(() => edgeCalls(server, 'move').length).toBe(2);
  expect(edgeCalls(server, 'move')[1].body).toMatchObject({ action: 'move', source: 'od', ids: ['OD!2'], to: null, confirm: true });
  await expect(prow(page, 0, 'od:OD!2')).toBeVisible();
  expect(errors).toEqual([]);
});

test('폰 412 한 칸: 꾹 누르고 움직이지 않고 떼면 지금처럼 선택(끌기·선택 창 없음)', async ({ page }) => {
  test.setTimeout(60000);
  const { errors } = await start(page, 412);
  await openFiles(page, 412);
  await phoneFolder(page, 'od', 'OD!1');
  await touchDrag(page, prow(page, 0, 'od:OD!11'));
  await expect(prow(page, 0, 'od:OD!11')).toHaveClass(/fx-picked/);
  await expect(root(page).locator('[data-fx-bar] .fx-bar-t')).toContainText('1개');
  await expect(ask(page)).toBeHidden();
  // 짧게 누르기는 그대로(고른 상태에서는 하나 더 고르기).
  expect(errors).toEqual([]);
});

test('폰 412 두 칸: 위 칸 파일을 꾹 눌러 아래 칸으로 끌어 놓기 → [복사] → 서버 작업표', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 412);
  await installViewPrefsServer(page, { files_two: { phone: { narrow: true } } });
  await page.reload();
  await openFiles(page, 412);
  await expect(root(page)).toHaveAttribute('data-fx-two', 'phone');
  // 아래 칸: 원드라이브 › 가짜 문서함, 위 칸: 구글 드라이브 › 가짜 업무 공간.
  await pane(page, 1).locator('[data-fx-pdrop]').click();
  await pane(page, 1).locator('[data-fx-ptree] [data-fx-go="od"][data-fx-id=""]').click();
  await enterRow(page, prow(page, 1, 'od:OD!1'));
  await expect(pane(page, 1).locator('.fx-ptop .fx-crumb-now')).toHaveText('가짜 문서함');
  await pane(page, 0).locator('[data-fx-pdrop]').click();
  const ptree = pane(page, 0).locator('[data-fx-ptree]');
  await ptree.locator('[data-fx-go="gd"][data-fx-id="gdFolder1"]').click();
  await expect(prow(page, 0, 'gd:gdDoc1')).toBeVisible();
  // 아래 칸의 파일 줄(폴더 아님) 위에 놓으면 그 칸의 지금 폴더로.
  const target = prow(page, 1, 'od:OD!13');
  let dashed = false;
  await touchDrag(page, prow(page, 0, 'gd:gdDoc1'), target, { before: async () => { dashed = await pane(page, 1).evaluate(e => e.classList.contains('fx-drop-on')); } });
  expect(dashed).toBe(true);
  await expect(ask(page)).toBeVisible();
  await expect(pane(page, 0)).toHaveClass(/fx-cur/);
  server.jobsHold = true;
  await ask(page).locator('[data-fx-drop-go="copy"]').click();
  await expect.poll(() => edgeCalls(server, 'job_add').length).toBe(1);
  expect(edgeCalls(server, 'job_add')[0].body).toEqual({ action: 'job_add', confirm: true, kind: 'copy', to_source: 'od', to: 'OD!1', items: [{ source: 'gd', id: 'gdDoc1' }] });
  server.jobsHold = false;
  expect(errors).toEqual([]);
});

test('폴드 884 한 칸(손가락 기기): 격자에서 꾹 눌러 폴더 칸으로 끌어 놓기 → [옮기기]', async ({ browser }) => {
  test.setTimeout(90000);
  const context = await browser.newContext({ hasTouch: true, isMobile: false, viewport: { width: 884, height: 900 } });
  const page = await context.newPage();
  await installViewPrefsServer(page, { files_look: { pc: { fold: 'grid' } } });
  const { errors, server } = await start(page, 884);
  await openFiles(page, 884);
  const { treeGo } = await import('./helpers/files-server.mjs');
  await treeGo(page, 'od', '');
  await expect(root(page).locator('[data-fx-pane-i="0"] [data-fx-list]')).toHaveAttribute('data-fx-look', 'grid');
  const from = prow(page, 0, 'od:OD!2'), to = prow(page, 0, 'od:OD!1');
  await touchDrag(page, from, to);
  await expect(ask(page)).toBeVisible();
  await ask(page).locator('[data-fx-drop-go="move"]').click();
  await expect.poll(() => edgeCalls(server, 'move').length).toBe(1);
  expect(edgeCalls(server, 'move')[0].body).toMatchObject({ ids: ['OD!2'], to: 'OD!1' });
  expect(errors).toEqual([]);
  await context.close();
});
