import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
// NOTE-큰창잘림 ③ 같은 종류 전수(입력칸 옆 잘림): 내 프로필 '폰 알림' 조용한 시간 칸이 7.2em 고정 폭이라 시각 글자 끝이 잘렸다('07:00 A').
// 이제 칸은 글자만큼 넓어지고(최소 7.2em), 옆 [시험 알림]도 줄 안에 남는다. PC 1280 · 폰 412 · 360.
for (const width of [1280, 412, 360]) test(`프로필 조용한 시간 칸은 시각 글자가 잘리지 않는다 ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await openHome(page);
  await page.evaluate(() => window.KPTURouter.go('profile'));
  const times = page.locator('#profileView .ps-push-time');
  await expect(times).toHaveCount(2);
  for (const t of await times.all()) {
    // 칸 폭이 시각 글자(시·분·오전오후·시계 단추)가 다 들어가는 제 폭보다 좁지 않다(시각 칸 속은 바깥에서 재지 못해 제 폭과 비교).
    expect(await t.evaluate(n => { const w = n.getBoundingClientRect().width, keep = n.getAttribute('style');
      n.style.setProperty('width', 'max-content', 'important'); n.style.setProperty('min-width', '0', 'important');
      const need = n.getBoundingClientRect().width; if (keep == null) n.removeAttribute('style'); else n.setAttribute('style', keep); return w + 0.5 >= need; })).toBe(true);
  }
  const test = page.locator('#profileView [data-ps-push-test]');
  expect(await test.evaluate(b => b.getBoundingClientRect().right <= b.closest('.ps-calref-row').getBoundingClientRect().right + 0.5)).toBe(true);
  if (width !== 360) { await test.scrollIntoViewIfNeeded(); const row = await times.first().locator('xpath=..').boundingBox();
    await page.screenshot({ path: `docs/design/screens/s61-30/profile-quiet-time-${width}.png`, clip: { x: 0, y: Math.max(0, row.y - 120), width, height: 220 } }); }
});
