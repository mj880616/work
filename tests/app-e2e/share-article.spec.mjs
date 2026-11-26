import { test, expect } from '@playwright/test';
import { openSavedDoc, openNewsDoc, READ_ID } from './helpers/doc-view.mjs';
import { noticeText } from './helpers/small-notice.mjs';
// S71-69 SHARE-글공유 ①(사용자 결정 2026-11-26 "기사는 링크로 공유"): 읽을 거리·저장한 글 [공유] = 제목 + 원래 주소.
// - 글 보기 머리 줄 ↗ 옆 [공유] 아이콘, 저장한 글 목록 줄 ⋯ [공유], 읽을 거리 줄 우클릭·⋯ [공유](숨기기 바로 앞).
// - 폰 390 = 기기 공유 창(navigator.share 흉내), PC 1280 = 복사 + '복사했어요'(공유 창을 열지 않음). 주소는 http·https만.
// 서버로 새로 보내는 요청 없음(공유는 이 기기 안에서만). 서버는 흉내, 글·주소는 모두 예시.
async function fakeShare(page) {
  await page.addInitScript(() => {
    window.__copied = []; window.__shared = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__copied.push(t); }, write: async () => {} } });
    Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: async d => { window.__shared.push(d); } });
  });
}
const got = page => page.evaluate(() => ({ shared: window.__shared, copied: window.__copied }));
const shareIcon = detail => detail.locator('.ds-doc-top .ds-doc-icons [aria-label="공유"]');

for (const width of [390, 1280]) {
  test(`저장한 글 ${width}: 머리 [공유] 아이콘·목록 줄 ⋯ [공유] = 제목 + 원래 주소`, async ({ page }) => {
    test.setTimeout(60000);
    await fakeShare(page);
    const { errors, detail } = await openSavedDoc(page, width, { title: '예시 기사 하나' });
    // 아이콘 차례: [공유][↗ 원래 페이지] …
    const names = await detail.locator('.ds-doc-top .ds-doc-icons > .ds-doc-icon').evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
    expect(names.slice(0, 2)).toEqual(['공유', '원래 페이지 (새 창)']);
    await shareIcon(detail).click();
    if (width <= 760) {
      await expect.poll(async () => (await got(page)).shared.length).toBe(1);
      expect((await got(page)).shared[0]).toEqual({ title: '예시 기사 하나', text: '예시 기사 하나', url: 'https://example.com/a' });
      expect((await got(page)).copied).toEqual([]);
    } else {
      await expect.poll(async () => (await got(page)).copied.at(-1)).toBe('예시 기사 하나\nhttps://example.com/a');
      expect((await got(page)).shared).toEqual([]);
      expect(await noticeText(page)).toBe('복사했어요');
    }
    // 목록 줄 ⋯ [공유]도 같은 일(PC는 두 칸이라 목록이 보이고, 폰은 목록으로 돌아가서).
    if (width <= 760) await detail.locator('[data-rd-back]').click();
    const more = page.locator(`#readingView .rd-row [data-rd-more="${READ_ID}"]:not([data-rd-head-more])`).first();
    await more.click();
    const menu = page.locator('#rdRowMenu');
    await expect(menu.getByRole('button', { name: '공유' })).toBeVisible();
    await menu.getByRole('button', { name: '공유' }).click();
    if (width <= 760) await expect.poll(async () => (await got(page)).shared.length).toBe(2);
    else await expect.poll(async () => (await got(page)).copied.length).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`읽을 거리 ${width}: 글 보기 머리 [공유] 아이콘 = 제목 + 원래 주소`, async ({ page }) => {
    test.setTimeout(60000);
    await fakeShare(page);
    const { errors, detail } = await openNewsDoc(page, width);
    const title = (await detail.locator('.ds-doc-title, .nd-title').first().textContent()).replace(/\s+/g, ' ').trim();
    const url = await detail.locator('.ds-doc-top a.nd-site').getAttribute('href');
    expect(url).toMatch(/^https?:\/\//);
    await shareIcon(detail).click();
    if (width <= 760) {
      await expect.poll(async () => (await got(page)).shared.length).toBe(1);
      expect((await got(page)).shared[0]).toEqual({ title, text: title, url });
    } else {
      await expect.poll(async () => (await got(page)).copied.at(-1)).toBe(`${title}\n${url}`);
      expect((await got(page)).shared).toEqual([]);
      expect(await noticeText(page)).toBe('복사했어요');
    }
    expect(errors).toEqual([]);
  });
}

test('읽을 거리 1280: 줄 우클릭 메뉴 [공유] = 제목 + 원래 주소 복사(숨기기 바로 앞)', async ({ page }) => {
  test.setTimeout(60000);
  await fakeShare(page);
  const { errors } = await openNewsDoc(page, 1280);
  const row = page.locator('#newsRoot [data-nc-item="c1"]');
  await row.locator('.nw-title').click({ button: 'right' });
  const items = page.locator('[data-row-item]:visible');
  await expect(items).toHaveText(['수정', '저장', '공유', '숨기기']);
  await items.filter({ hasText: '공유' }).click();
  await expect.poll(async () => (await got(page)).copied.at(-1)).toBe('가짜 채널 기사\nhttps://example.org/c1');
  expect(errors).toEqual([]);
});
