import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
import { noticeText } from './helpers/small-notice.mjs';
// S49-3 NOW-줄밀기(명진 11/03 08:55): Now 글 줄을 왼쪽으로 밀면 숨기기, 오른쪽으로 밀면 보관(뉴스 = 별표). 공용 줄 밀기(row-swipe.js)와 서버 저장(now-marks.js) 그대로.
// PC는 밀기 대신 줄에 마우스를 올리면 [보관][숨기기]. 탭 이동은 탭 줄 위 밀기·누르기만. 서버 흉내(helpers/news-server.mjs), 글은 모두 가짜.
const item = (page, id) => page.locator(`#newsRoot [data-nc-item="${id}"]`);
async function swipe(locator, dx) {
  await expect(locator).toBeVisible();
  const b = await locator.boundingBox();
  await locator.evaluate((el, { dx, x, y }) => {
    const fire = (type, cx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: y }));
    fire('pointerdown', x); for (let i = 1; i <= 10; i++) fire('pointermove', x + dx * i / 10); fire('pointerup', x + dx);
  }, { dx, x: b.x + b.width / 2, y: b.y + b.height / 2 });
}

test('Now 뉴스 412: 왼쪽 끝까지 밀면 숨기고 [되돌리기], 오른쪽 끝까지 밀면 보관(별표)·다시 밀면 풀기', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 412);
  await openNews(page, 412);
  await expect(item(page, 'c1')).toBeVisible();

  await swipe(item(page, 'c1'), -320);
  await expect(item(page, 'c1')).toHaveCount(0);
  const hide = server.calls.filter(c => c.what === 'app_news_items' && c.method === 'PATCH').at(-1);
  expect(Object.keys(hide.body).sort()).toEqual(['hidden_at', 'updated_at']);
  expect(hide.body.hidden_at).toBeTruthy();
  await expect.poll(() => server.calls.some(c => c.what === 'app_now_signals' && c.body?.news_item_id === 'c1' && c.body?.action === 'dismiss')).toBe(true);
  expect(await noticeText(page)).toBe('숨겼어요');
  await page.locator('#kptuNotice .kptu-notice-undo').click();
  await expect(item(page, 'c1')).toBeVisible();
  expect(server.calls.filter(c => c.what === 'app_news_items' && c.method === 'PATCH').at(-1).body.hidden_at).toBeNull();

  await swipe(item(page, 'k1'), 320);
  await expect(item(page, 'k1').locator('[data-nc-star]')).toHaveAttribute('aria-pressed', 'true');
  expect(Object.keys(server.calls.filter(c => c.what === 'app_news_items' && c.method === 'PATCH').at(-1).body).sort()).toEqual(['starred_at', 'updated_at']);
  await expect.poll(() => server.calls.some(c => c.what === 'app_now_signals' && c.body?.news_item_id === 'k1' && c.body?.action === 'star')).toBe(true);
  await swipe(item(page, 'k1'), 320);
  await expect(item(page, 'k1').locator('[data-nc-star]')).toHaveAttribute('aria-pressed', 'false');
  expect(server.calls.filter(c => c.what === 'app_news_items' && c.method === 'PATCH').at(-1).body).toMatchObject({ starred_at: null, folder_id: null });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('Now 뉴스 412: 글 줄 위 좌우 밀기는 탭을 옮기지 않는다', async ({ page }) => {
  const { errors } = await start(page, 412);
  await openNews(page, 412);
  await item(page, 'c1').evaluate(el => {
    const t = (type, x) => { const p = new Touch({ identifier: 1, target: el, clientX: x, clientY: 300 }); el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === 'touchend' ? [] : [p], changedTouches: [p] })); };
    t('touchstart', 300); t('touchmove', 150); t('touchend', 150);
  });
  await expect(page.locator('#outsideRoot [data-os-tab="news"]')).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('Now 뉴스 1440: 줄에 마우스를 올리면 [보관][숨기기], 눌러서 숨기기·보관', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 1440);
  await openNews(page, 1440);
  const c1 = item(page, 'c1');
  await expect(c1.locator('[data-now-act]')).toHaveCount(2);
  await expect(c1.locator('[data-now-act="save"]')).toBeHidden();
  await c1.hover();
  await expect(c1.locator('[data-now-act="save"]')).toBeVisible();
  await c1.locator('[data-now-act="save"]').click();
  await expect(c1.locator('[data-nc-star]')).toHaveAttribute('aria-pressed', 'true');
  await c1.hover();
  await c1.locator('[data-now-act="hide"]').click();
  await expect(item(page, 'c1')).toHaveCount(0);
  expect(server.calls.filter(c => c.what === 'app_news_items' && c.method === 'PATCH').at(-1).body.hidden_at).toBeTruthy();
  expect(errors).toEqual([]);
});
