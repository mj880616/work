import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import { noteAction } from './helpers/basket-more.mjs';

// UI-업데이트편집한줄(2026-10-20 사용자 결정): 바구니 업데이트 수정 화면 아래 버튼은 노트처럼 한 줄 —
// [📎 첨부] [큰 창에서 수정] [수정 저장] [취소](노트 [큰 창에서 수정][저장][취소] 순서). 공용 작은 버튼(보이는 32px, 누르는 범위 44px),
// 360·390·1280에서 한 줄·글자 잘림 없음. [첨부 저장]은 파일을 골랐을 때만 고른 파일 옆에 보인다(저장 경로는 그대로).
test.use({ hasTouch: true });
async function openEdit(page, width) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width, height: 900 });
  await openHome(page);
  await page.route('**/rest/v1/app_notes**', r => r.request().method() === 'GET' ? r.fulfill({ json: [{ id: 'n', kind: 'basket', raw_text: '고칠 업데이트', occurred_at: '2026-10-06', attachments: [] }] }) : r.fallback());
  await page.locator('#homeView [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').click();
  await page.locator('[data-basket-row="n"]').click();
  await noteAction(page, '[data-basket-edit]');
  return errors;
}
const measure = locator => locator.evaluate(el => { const r = el.getBoundingClientRect(), a = getComputedStyle(el, '::after'); return { top: r.top, left: r.left, right: r.right, height: r.height, touch: parseFloat(a.height) || 0, font: getComputedStyle(el).fontSize, cut: el.scrollWidth > el.clientWidth + 1 }; });

for (const width of [360, 390, 1280]) test(`update edit buttons [첨부][큰 창에서 수정][수정 저장][취소] on one uncut line ${width}`, async ({ page }) => {
  const errors = await openEdit(page, width);
  const bar = page.locator('[data-basket-detail] [data-basket-edit-actions]');
  await expect(bar).toBeVisible();
  const order = await bar.locator('button:visible').evaluateAll(list => list.map(b => b.getAttribute('aria-label') || b.textContent.trim()));
  expect(order).toEqual(['파일 첨부', '큰 창에서 수정', '수정 저장', '취소']);
  const boxes = [];
  for (const b of await bar.locator('button:visible').all()) boxes.push(await measure(b));
  for (const [i, m] of boxes.entries()) {
    expect(m.cut, order[i]).toBe(false);
    expect(m.height, order[i]).toBe(32);
    expect(m.touch, order[i]).toBe(44);
    expect(m.font, order[i]).toBe('13px');
    expect(Math.abs(m.top - boxes[0].top), order[i]).toBeLessThanOrEqual(0.5);
    if (i) expect(m.left, order[i]).toBeGreaterThan(boxes[i - 1].right - 0.5);
  }
  expect(boxes.at(-1).right).toBeLessThanOrEqual(width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // [수정 저장] stays the one filled button; [첨부 저장] waits until files are chosen, then sits by them.
  await expect(bar.locator('[data-basket-save]')).toHaveCSS('background-color', await page.evaluate(() => { const e = document.createElement('i'); e.style.color = 'var(--kptu-primary)'; document.querySelector('#appView').append(e); const c = getComputedStyle(e).color; e.remove(); return c; }));
  const upload = page.locator('[data-basket-detail] [data-basket-upload]');
  await expect(upload).toBeHidden();
  const chooser = page.waitForEvent('filechooser');
  await bar.getByRole('button', { name: '파일 첨부', exact: true }).click();
  await (await chooser).setFiles([{ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('a') }]);
  await expect(upload).toBeVisible();await expect(page.locator('[data-basket-detail] [data-basket-file]')).toHaveCount(1);
  const u = await measure(upload);expect(u.height).toBe(32);expect(u.touch).toBe(44);expect(u.cut).toBe(false);
  // The row is still one line with the count badge.
  await expect(bar.locator('[data-basket-count]')).toHaveText('1');
  const tops = await bar.locator('button:visible').evaluateAll(list => list.map(b => Math.round(b.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  // [취소] keeps its meaning: it asks before dropping the chosen file, and [큰 창에서 수정] still opens the big window.
  page.once('dialog', d => d.dismiss());await bar.locator('[data-basket-cancel]').click();await expect(bar).toBeVisible();
  await bar.locator('[data-basket-big-write]').click();await expect(page.locator('#edWindow')).toBeVisible();
  expect(errors).toEqual([]);
});
