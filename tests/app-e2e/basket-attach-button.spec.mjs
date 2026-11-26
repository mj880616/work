import { test, expect } from '@playwright/test';
import { openHome } from './helpers/home-entry.mjs';
import {noteAction} from './helpers/basket-more.mjs';

// UI-PC바구니첨부버튼 → NOTE-입력줄높이(S71-67): the quick input's attach control is the clip inside the input's left edge on
// every width (label hidden). The edit screen's tool row shows
// the labeled button on both widths. One part (basket-upload.js mountBasketPicker) serves all three places.
test.use({ hasTouch: true });
for (const width of [390, 1280]) test(`basket attach button placement and shared button look ${width}`, async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width, height: 900 });
  await openHome(page);
  await page.route('**/rest/v1/app_notes**', r => r.fulfill({ json: [{ id: 'n', raw_text: '테스트 업데이트', occurred_at: '2026-10-06', attachments: [] }] }));
  await page.locator('#homeView [data-home-quick] [data-goto="basket"]:visible,.mobile-tabs [data-view="basket"]:visible').first().click();
  const quick = page.locator('#basketView [data-basket-list] .home-quick');
  const clip = quick.getByRole('button', { name: '파일 첨부', exact: true });
  await expect(clip).toBeVisible();
  const box = await clip.boundingBox(), input = await quick.locator('[data-quick-input]').boundingBox(), save = await quick.locator('[data-quick-save]').boundingBox();
  // NOTE-입력줄높이(S71-67, 2026-11-26 사용자 결정): 빠른 입력 줄의 첨부는 폰·PC 모두 입력칸 안 왼쪽 클립(글자 숨김) —
  // 칸 안쪽 높이의 정사각, 누르는 범위(::after)는 44px. 따로 있던 PC [📎 첨부] 단추는 없다.
  const touch = await clip.evaluate(el => { const p = getComputedStyle(el, '::after'); return [parseFloat(p.width), parseFloat(p.height)]; });
  expect(touch[0]).toBeGreaterThanOrEqual(44); expect(touch[1]).toBeGreaterThanOrEqual(44);
  await expect(clip.locator('.basket-clip-label')).toBeHidden();
  expect(box.x).toBeGreaterThanOrEqual(input.x);
  expect(box.x + box.width).toBeLessThanOrEqual(input.x + 46);
  expect(box.y).toBeGreaterThanOrEqual(input.y - 0.5); expect(box.y + box.height).toBeLessThanOrEqual(input.y + input.height + 0.5);
  expect(Math.abs(input.height - save.height)).toBeLessThanOrEqual(1);
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
