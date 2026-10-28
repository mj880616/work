import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import {noteAction} from './helpers/basket-more.mjs';

// UI-PC바구니첨부버튼: the attach control is the shared button [📎 첨부]. PC basket input: outside the input, left of
// [추가], same line and height. Phone: the icon stays inside the input (label hidden). The edit screen's tool row shows
// the labeled button on both widths. One part (basket-upload.js mountBasketPicker) serves all three places.
test.use({ hasTouch: true });
for (const width of [390, 1280]) test(`basket attach button placement and shared button look ${width}`, async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width, height: 900 });
  await openHome(page);
  await page.route('**/rest/v1/app_notes**', r => r.fulfill({ json: [{ id: 'n', raw_text: '테스트 업데이트', occurred_at: '2026-10-06', attachments: [] }] }));
  await page.locator('#homeView [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').click();
  const quick = page.locator('#basketView [data-basket-list] .home-quick');
  const clip = quick.getByRole('button', { name: '파일 첨부', exact: true });
  await expect(clip).toBeVisible();
  const box = await clip.boundingBox(), input = await quick.locator('[data-quick-input]').boundingBox(), save = await quick.locator('[data-quick-save]').boundingBox();
  // UI-PC버튼36: on PC the button paints the input height (36px) and keeps a 44px touch area (::after).
  expect(box.height).toBeGreaterThanOrEqual(width === 1280 ? 36 : 44);
  if (width === 1280) expect(await clip.evaluate(el => parseFloat(getComputedStyle(el, '::after').height))).toBe(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
  if (width === 1280) {
    await expect(clip.locator('.basket-clip-label')).toBeVisible();
    expect(box.x).toBeGreaterThanOrEqual(input.x + input.width);
    expect(box.x + box.width).toBeLessThanOrEqual(save.x);
    expect(save.x - (box.x + box.width)).toBeLessThanOrEqual(12);
    expect(Math.abs(box.y - save.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - save.height)).toBeLessThanOrEqual(1);
    const look = await clip.evaluate(el => { const s = getComputedStyle(el); return { border: s.borderTopStyle, radius: s.borderTopLeftRadius, size: s.fontSize }; });
    expect(look).toEqual({ border: 'solid', radius: '8px', size: '13px' });
    // Text no longer starts after an icon gap inside the input.
    expect(parseFloat(await quick.locator('[data-quick-input]').evaluate(el => getComputedStyle(el).paddingLeft))).toBeLessThanOrEqual(12);
  } else {
    await expect(clip.locator('.basket-clip-label')).toBeHidden();
    expect(box.x).toBeGreaterThanOrEqual(input.x);
    expect(box.x + box.width).toBeLessThanOrEqual(input.x + 46);
  }
  // The button opens the same file chooser (keyboard on PC, a tap on the phone); a chosen file shows the count badge.
  const chooser = page.waitForEvent('filechooser');
  if (width === 1280) await clip.press('Enter'); else await clip.tap();
  await (await chooser).setFiles([{ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('a') }]);
  await expect(clip.locator('[data-basket-count]')).toHaveText('1');
  await quick.getByRole('button', { name: 'a.txt 선택 취소' }).click();
  // Edit screen (UI-업데이트편집한줄): the labeled button is first in the one button row, the same small size as [수정 저장].
  await page.locator('[data-basket-row="n"]').click();
  await noteAction(page, '[data-basket-edit]');
  const editClip = page.locator('[data-basket-detail] .basket-edit-actions').getByRole('button', { name: '파일 첨부', exact: true });
  await expect(editClip.locator('.basket-clip-label')).toBeVisible();
  const eb = await editClip.boundingBox(), sv = await page.locator('[data-basket-save]').boundingBox();
  expect(Math.abs(eb.height - sv.height)).toBeLessThanOrEqual(1);expect(Math.abs(eb.y - sv.y)).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});
