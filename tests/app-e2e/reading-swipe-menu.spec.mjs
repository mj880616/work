import { test, expect } from '@playwright/test';
import { start, openNews } from './helpers/news-server.mjs';
import { noticeText } from './helpers/small-notice.mjs';
// S70-62 READ-밀기메뉴(명진 11/26 07:41 "보관은 저장으로 통일 … 읽을 거리에서는 수정 저장 숨기기 / 근데 숨기기는 어떻게 다시 보지? / 저장된 글에서는 수정 삭제로"):
// 폰 390 — 읽을 거리 글 줄 왼쪽 밀기 칸 [수정][저장][숨기기], [수정]은 그 글 보기의 기존 ⋯ [수정] 칸, 숨긴 글은 머리 ⋯ [숨긴 글] → 밀어서 [다시 보이기](서버 hidden_at 끄기).
// 화면에 '보관' 글자가 없다. 저장한 글 줄 [수정][삭제]는 row-swipe-more.spec.mjs. 서버는 흉내(helpers/news-server.mjs), 기사는 모두 가짜.
const item = (page, id) => page.locator(`#newsRoot [data-nc-item="${id}"]`);
async function swipe(locator, dx) {
  await expect(async () => {
    await expect(locator).toBeVisible();
    const sent = await locator.evaluate((el, { dx }) => {
      if (!el.isConnected) return false;
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const fire = (type, cx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: cx, clientY: y }));
      fire('pointerdown', x); for (let i = 1; i <= 10; i++) fire('pointermove', x + dx * i / 10); fire('pointerup', x + dx);
      return true;
    }, { dx });
    expect(sent).toBe(true);
  }).toPass({ timeout: 10000 });
}
async function touchTap(locator) {
  await locator.dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, bubbles: true });
  await locator.dispatchEvent('click');
}
const noKeep = async page => expect(await page.locator('#outsideView').evaluate(el => el.innerText)).not.toContain('보관');

test('읽을 거리 390: 줄 밀기 [수정][저장][숨기기] — [수정]은 그 기사 글 보기의 수정 칸', async ({ page }) => {
  test.setTimeout(90000);
  const { errors } = await start(page, 390);
  await openNews(page, 390);
  await swipe(item(page, 'c1'), -50);
  // HOME-읽을거리평가(W4): 세 칸 왼쪽에 평가 칸(그림만 [좋아요]·[별로예요])이 따로 하나 — 세 칸 글자·순서는 그대로.
  const cells = page.locator('#newsRoot [data-row-swipe-act="end"]:not(.row-swipe-half)');
  await expect(cells).toHaveCount(3);
  await expect(cells).toHaveText(['수정', '저장', '숨기기']);
  await expect(cells.nth(0)).toHaveAttribute('data-row-swipe-key', 'edit');
  await noKeep(page);
  await touchTap(page.locator('#newsRoot [data-row-swipe-key="edit"]'));
  const form = page.locator('#outsideRoot [data-now-detail] [data-nd-hand-form]');
  await expect(form).toBeVisible();
  await expect(form.locator('[data-nd-hand-in="title"]')).toHaveValue('가짜 채널 기사');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('읽을 거리 390: 숨긴 글은 머리 ⋯ [숨긴 글]에서 밀어 [다시 보이기] — 서버에 숨김을 끄고 목록에 돌아온다', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 390);
  await openNews(page, 390);
  await swipe(item(page, 'c1'), -50);
  await touchTap(page.locator('#newsRoot [data-row-swipe-key="hide"]'));
  await expect(item(page, 'c1')).toHaveCount(0);
  expect(server.items.find(i => i.id === 'c1').hidden_at).toBeTruthy();
  // 머리 ⋯ → [숨긴 글]: 탭 줄은 감추고 숨긴 글 칸(최근 숨긴 것 먼저, 서버에서 읽음).
  await page.locator('[data-os-more]').click();
  const menuItem = page.locator('#osMenu [data-os-act="hidden"]');
  await expect(menuItem).toHaveText('숨긴 글');
  await menuItem.click();
  const panel = page.locator('#outsideRoot [data-now-hidden]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.os-src-head b')).toHaveText('숨긴 글');
  await expect(page.locator('#outsideRoot [data-os-tabs]')).toBeHidden();
  const row = panel.locator('.now-row[data-nw-key="news:c1"]');
  await expect(row).toBeVisible();
  await expect(panel.locator('.now-row')).toHaveCount(1);
  expect(server.calls.some(c => c.what === 'app_news_marks' && c.method === 'GET' && /hidden_at=not\.is\.null/.test(c.query))).toBe(true);
  await noKeep(page);
  // 왼쪽으로 밀면 [다시 보이기] 한 칸 → 누르면 숨김을 끄고(hidden_at = null) 칸에서 빠진다. 알림 '다시 보이게 했어요' + [되돌리기].
  await swipe(row, -50);
  const cell = panel.locator('[data-row-swipe-key="unhide"]');
  await expect(cell).toHaveText('다시 보이기');
  await touchTap(cell);
  await expect(row).toHaveCount(0);
  await expect.poll(() => server.items.find(i => i.id === 'c1').hidden_at ?? null).toBeNull();
  expect(server.calls.filter(c => c.what === 'app_news_marks' && c.method === 'PATCH').at(-1).body.hidden_at).toBeNull();
  await expect.poll(() => server.calls.some(c => c.what === 'app_news_now_signals' && c.body?.article_id === 'c1' && c.body?.action === 'undismiss')).toBe(true);
  expect(await noticeText(page)).toBe('다시 보이게 했어요');
  await expect(panel.locator('[data-nhd-empty]')).toBeVisible();
  // 뒤로 = 목록: 그 글이 다시 보인다.
  await panel.locator('[data-now-hidden-back]').click();
  await expect(panel).toBeHidden();
  await expect(item(page, 'c1')).toBeVisible();
  await noKeep(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('읽을 거리 1280: PC는 줄 마우스 단추 [수정][저장][숨기기], 숨긴 글 칸은 마우스 단추 [다시 보이기]', async ({ page }) => {
  test.setTimeout(90000);
  const { errors, server } = await start(page, 1280);
  await openNews(page, 1280);
  const c1 = item(page, 'c1');
  await c1.hover();
  await expect(c1.locator('.now-hov [data-now-act]')).toHaveText(['수정', '저장', '숨기기']);
  await c1.locator('[data-now-act="hide"]').click();
  await expect(item(page, 'c1')).toHaveCount(0);
  await page.locator('[data-os-more]').click();
  await page.locator('#osMenu [data-os-act="hidden"]').click();
  const row = page.locator('#outsideRoot [data-now-hidden] .now-row[data-nw-key="news:c1"]');
  await row.hover();
  await row.locator('[data-nhd-act="unhide"]').click();
  await expect(row).toHaveCount(0);
  await expect.poll(() => server.items.find(i => i.id === 'c1').hidden_at ?? null).toBeNull();
  await noKeep(page);
  expect(errors).toEqual([]);
});
