// STAB-폴더상자시험(S61-10): 두 손가락 벌리는 도중 화면이 자료를 받아 폴더 나무를 다시 그려도(innerHTML) 벌리기가 사라지지 않는다.
// 손가락 이벤트는 손가락을 댄 요소로만 가서, 그 요소가 다시 그려져 문서에서 떨어지면 칸까지 올라오지 않았다(folder-pinch.js).
// 다른 폴더를 읽는 응답을 붙잡아 두었다가 손가락을 댄 뒤에 풀어, 진짜 다시 그리기가 손짓 한가운데에 오게 한다. 이름은 모두 지어낸 것이다.
import { test, expect } from '@playwright/test';
import { start, openFiles } from './helpers/files-server.mjs';

test.use({ hasTouch: true });
const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';

// 'OD!2'(가짜 사진함) 하위 목록 읽기를 붙잡는다. release()를 부르면 원래 흉내 서버로 넘긴다.
async function holdList(page, parent) {
  let release, asked;
  const gate = new Promise(r => { release = r; }), seen = new Promise(r => { asked = r; });
  await page.route(SB + '/rest/v1/rpc/app_cloud_list', async route => {
    if (route.request().postDataJSON()?.p_parent_id !== parent) return route.fallback();
    asked();
    await gate;
    return route.fallback();
  });
  return { release, seen };
}
// 손가락 두 개를 대고(touchStart) → between() → 벌린다(touchMove) → 뗀다.
async function pinchOutAround(page, locator, between) {
  const b = await locator.boundingBox(), cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const pts = d => [{ x: cx - d, y: cy, id: 0 }, { x: cx + d, y: cy, id: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(20) });
  await between();
  for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(20 + 70 * i / 6) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('파일 폰 412: 벌리는 도중 나무가 다시 그려져도 그 폴더만이 열린다', async ({ page }) => {
  const { errors } = await start(page, 412);
  const hold = await holdList(page, 'OD!2');
  await openFiles(page, 412);
  const tree = page.locator('#filesRoot [data-fx-tree]');
  await expect(tree.locator('[data-fx-fold="od:OD!1"]')).toBeVisible();
  // 다른 폴더(가짜 사진함)를 눌러 읽기를 걸어 둔다(응답은 붙잡힘).
  await tree.locator('[data-fx-fold="od:OD!2"] .ft-main').tap();
  await hold.seen;
  const row = tree.locator('[data-fx-fold="od:OD!1"]');
  const marked = await row.evaluate(e => { e.dataset.old = '1'; return true; });
  expect(marked).toBe(true);
  await pinchOutAround(page, row, async () => {
    hold.release();
    // 응답이 와서 나무가 다시 그려졌다(손가락을 댄 옛 줄은 문서에서 떨어짐).
    await expect(tree.locator('[data-fx-fold="od:OD!1"][data-old]')).toHaveCount(0);
  });
  await expect(tree).toBeHidden();
  const box = page.locator('#filesRoot [data-fx-list] .ft-focus');
  await expect(box.locator('.ft-focus-head .ft-focus-name')).toHaveText('가짜 문서함');
  expect(errors).toEqual([]);
});
