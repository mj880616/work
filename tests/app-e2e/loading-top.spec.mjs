import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { start, openFiles } from './helpers/files-server.mjs';
// UI-로딩맨위(S49-24, 명진 결정 11/04): 폰·PC 모두 움직이는 로딩 막대는 화면 맨 위 한 곳(.top-wait) 하나뿐.
// 칸 안 막대(.wait-bar) 0개, 회색 빈 줄만 남음, 모두 끝나면 사라짐, 아래로 내려도 보임(fixed), 실패해도 남지 않음.
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const SHOTS = 'test-results/loading-top';
mkdirSync(SHOTS, { recursive: true });
const WIDTHS = [412, 884, 1440];

async function topBarOk(page, width) {
  await expect(page.locator('.top-wait')).toHaveCount(1, { timeout: 10000 }); // 막대는 하나
  await expect(page.locator('.wait-bar')).toHaveCount(0); // 칸 안 막대 없음
  const box = await page.locator('.top-wait').boundingBox();
  expect(box.y).toBe(0);
  expect(box.width).toBeGreaterThan(width - 2);
  expect(await page.locator('.top-wait').evaluate(el => getComputedStyle(el).position)).toBe('fixed');
}

for (const width of WIDTHS) {
  test(`[파일] 세 칸 동시 불러오기 (${width}px): 맨 위 막대 하나, 칸 안 막대 없음, 아래로 내려도 보임, 끝나면 사라짐`, async ({ page }) => {
    test.setTimeout(90000);
    const { errors } = await start(page, width);
    let release;
    const gate = new Promise(ok => { release = ok; });
    await page.route('**/rest/v1/rpc/app_cloud_find_in', async route => { await gate; await route.fallback(); });
    await page.route('**/rest/v1/rpc/app_cloud_list', async route => { await gate; await route.fallback(); });
    await openFiles(page, width).catch(() => {});
    // FOLDER-나무새기준 ②: 폰 첫 화면 상자 나무는 저장소마다 맨 위 폴더 줄과 '최근'을 바로 읽는다(누를 것 없음).
    await expect(page.locator('#filesRoot .wait').first()).toBeVisible({ timeout: 10000 });
    await topBarOk(page, width);
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.locator('#filesRoot').evaluate(el => { el.scrollTop = 200; });
    await topBarOk(page, width); // 아래로 내려도 같은 자리
    await page.screenshot({ path: `${SHOTS}/files-${width}-loading.png` });
    release();
    await expect(page.locator('.top-wait')).toHaveCount(0, { timeout: 15000 });
    await expect(page.locator('#filesRoot .wait')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/files-${width}-done.png` });
    expect(errors).toEqual([]);
  });

  test(`[파일] 읽기 실패 (${width}px): 막대가 남지 않는다`, async ({ page }) => {
    test.setTimeout(90000);
    await start(page, width);
    let release;
    const gate = new Promise(ok => { release = ok; });
    await page.route('**/rest/v1/rpc/app_cloud_list', async route => { await gate; await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"fail"}' }); });
    await page.route('**/rest/v1/rpc/app_cloud_find_in', async route => { await gate; await route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"fail"}' }); });
    await openFiles(page, width).catch(() => {});
    await expect(page.locator('.top-wait')).toHaveCount(1, { timeout: 10000 });
    release();
    await expect(page.locator('.top-wait')).toHaveCount(0, { timeout: 15000 });
    await expect(page.locator('#filesRoot .wait')).toHaveCount(0);
  });

  test(`홈·정리함·일정·사진·자료실 (${width}px): 읽는 동안 맨 위 막대 하나, 칸 안 막대 없음, 끝나면 사라짐, 화면을 옮겨도 남지 않음`, async ({ page }) => {
    test.setTimeout(120000);
    await start(page, width);
    let release;
    const gate = new Promise(ok => { release = ok; });
    let holding = true;
    await page.route(SB + '/**', async route => { if (holding && /\/rest\/v1\/|\/functions\/v1\//.test(route.request().url())) await Promise.race([gate, new Promise(r => setTimeout(r, 2500))]); await route.fallback(); });
    for (const view of ['home', 'basket', 'calendar', 'photos', 'library']) {
      await page.evaluate(v => window.KPTURouter?.go?.(v, { source: 'delegated' }), view);
      await page.waitForTimeout(900);
      expect(await page.locator('.top-wait').count(), `${view}: 맨 위 막대는 많아야 하나`).toBeLessThanOrEqual(1);
      await expect(page.locator('.wait-bar'), `${view}: 칸 안 막대 없음`).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/${view}-${width}.png` });
    }
    holding = false;
    release();
    await expect(page.locator('.top-wait')).toHaveCount(0, { timeout: 20000 });
  });
}
