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

// S69-75 LONGPRESS-폰나무(2026-11-24 21:15 사용자 "파일 목록에 보이는 파일 폴더 꾹 눌러도 선택 안되는데?"): 폰 첫 화면 나무(저장소 상자)의
// 폴더 줄·파일 줄도 목록 줄과 같다 — 꾹 누르기 = 선택 모드 + 그 줄, 선택 모드에서 누르기 = 더하기/빼기(펼치기·미리보기 아님), 고르기 막대, 꾹 눌러 끌기.
const tree = page => root(page).locator('[data-fx-tree]');
const tfold = (page, key) => tree(page).locator(`[data-fx-tog="${key}"]`);
const tfile = (page, key) => tree(page).locator(`[data-fx-box]:not([data-fx-box="recent"]) [data-fx-tfile="${key}"]`);
const barText = page => root(page).locator('[data-fx-bar] .fx-bar-t');

test('폰 412 나무: 파일 줄 꾹 누르기 = 선택, 선택 모드에서 폴더 누르기 = 더하기(펼치지 않음)·다시 누르면 빼기, 막대 [자료실로][휴지통]', async ({ page }) => {
  test.setTimeout(60000);
  const { errors } = await start(page, 412);
  await openFiles(page, 412);
  await tfold(page, 'od:OD!1').click();
  await expect(tfile(page, 'od:OD!11')).toBeVisible();
  await touchDrag(page, tfile(page, 'od:OD!11'));
  await expect(tfile(page, 'od:OD!11')).toHaveClass(/fx-picked/);
  await expect(barText(page)).toHaveText('1개');
  await expect(root(page).locator('[data-fx-prev]')).toBeHidden();
  await expect(page.locator('#rowMenu')).toBeHidden();
  const bar = root(page).locator('[data-fx-bar]');
  await expect(bar.locator('[data-fx-tolib]')).toBeVisible();
  await expect(bar.locator('[data-fx-trash]')).toBeVisible();
  await expect(bar.locator('[data-fx-cut]')).toBeVisible();
  // 선택 모드에서 폴더 줄 누르기 = 더하기(펼치기·접기 아님).
  const expanded = await tfold(page, 'od:OD!2').getAttribute('aria-expanded');
  await tfold(page, 'od:OD!2').click();
  await expect(barText(page)).toHaveText('2개');
  await expect(tfold(page, 'od:OD!2')).toHaveClass(/fx-picked/);
  expect(await tfold(page, 'od:OD!2').getAttribute('aria-expanded')).toBe(expanded);
  // 다시 누르면 빼기, 마지막 하나를 빼면 막대가 사라진다.
  await tfold(page, 'od:OD!2').click();
  await expect(barText(page)).toHaveText('1개');
  await tfile(page, 'od:OD!11').click();
  await expect(bar).toBeHidden();
  // 고르지 않은 상태의 파일 줄 누르기는 그대로 미리보기.
  await tfile(page, 'od:OD!13').click();
  await expect(root(page).locator('[data-fx-prev]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('폰 412 나무: 폴더 줄 꾹 눌러 다른 폴더 줄로 끌면 [복사][옮기기] → 옮기기 · 꾹 누르기 전에 움직이면 스크롤(고르지 않음)', async ({ page }) => {
  test.setTimeout(60000);
  const { errors, server } = await start(page, 412);
  await openFiles(page, 412);
  const from = tfold(page, 'od:OD!2'), to = tree(page).locator('[data-fx-fold="od:OD!1"]');
  await expect(from).toBeVisible();
  // 짧게(꾹 누르기 전에) 움직이면 고르지도 끌지도 않는다.
  await touchDrag(page, from, { x: 60, y: 60 }, { hold: 60, steps: 4 });
  await expect(root(page).locator('[data-fx-bar]')).toBeHidden();
  await expect(ask(page)).toBeHidden();
  let dashed = false;
  await touchDrag(page, from, to, { before: async () => { dashed = await to.evaluate(e => e.classList.contains('fx-drop-on')); await expect(page.locator('.td-ghost')).toHaveText('가짜 사진함'); } });
  expect(dashed).toBe(true);
  await expect(ask(page)).toBeVisible();
  await ask(page).locator('[data-fx-drop-go="move"]').click();
  await expect.poll(() => edgeCalls(server, 'move').length).toBe(1);
  expect(edgeCalls(server, 'move')[0].body).toMatchObject({ source: 'od', ids: ['OD!2'], to: 'OD!1' });
  expect(errors).toEqual([]);
});

// S70-33 QA-간헐실패: 꾹 누르는 동안(집어 들기 전) 다른 저장소 상자가 늦게 읽혀 나무가 통째로 다시 그려져도, 손가락 아래 그 줄을 고른다.
// 예전에는 떼어진 옛 줄을 집으려다 아무것도 집지 못하고, 손을 뗀 뒤 브라우저 누르기(click)가 그 줄을 펼쳤다(S10 파일 390 간헐 실패의 원인).
test('폰 390 나무: 꾹 누르는 동안 나무가 다시 그려져도 손가락 아래 그 폴더 줄 고르기(펼치지 않음)', async ({ page }) => {
  test.setTimeout(60000);
  const { errors } = await start(page, 390);
  const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
  let release, held = false;
  const gate = new Promise(r => { release = r; });
  await page.route(SB + '/rest/v1/rpc/app_cloud_list', async r => {
    if (r.request().postDataJSON()?.p_source === 'gd') { held = true; await gate; }
    return r.fallback();
  });
  await openFiles(page, 390);
  const f = tfold(page, 'od:OD!1');
  await expect(f).toBeVisible();
  await expect.poll(() => held).toBe(true);
  await expect(f).toHaveAttribute('aria-expanded', 'false');
  const b = await f.boundingBox(), p = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await f.evaluate(e => { window.__s7033 = e; });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...p, id: 0 }] });
  release();
  // 구글 상자가 읽혀 나무가 다시 그려질 때까지(누른 줄이 새 줄로 바뀜) — 집어 들기(380ms) 전에 일어나는 경우.
  await page.waitForFunction(() => window.__s7033 && !window.__s7033.isConnected);
  await page.waitForTimeout(600);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await expect(f).toHaveClass(/fx-picked/);
  await expect(barText(page)).toHaveText('1개');
  await expect(f).toHaveAttribute('aria-expanded', 'false');
  expect(errors).toEqual([]);
});
